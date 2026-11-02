from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import zlib
from collections.abc import Generator

import mlx_whisper
import numpy as np
import torch
from silero_vad import get_speech_timestamps

from corrector import Corrector
from protocol import (
    CancelledMessage,
    ChunkMessage,
    CorrectionMessage,
    DoneMessage,
    ErrorMessage,
    OutgoingMessage,
    Segment,
    TotalMessage,
)

SR = 16_000
MAX_CHUNK = 28 * SR
BATCH_SIZE = 15
OVERLAP = 3
GLOSSARY_TH = "การประชุม, สรุป, รายงาน, โปรเจกต์, ทีม, ผู้จัดการ, นักพัฒนา, ซอฟต์แวร์, แอปพลิเคชัน, ระบบ"
GLOSSARY_EN = "meeting, summary, report, project, team, manager, developer, software, application, system"

def _glossary(language: str) -> str:
    return GLOSSARY_TH if language == "th" else GLOSSARY_EN


def _ratio(text: str) -> float:
    b = text.encode()
    return len(b) / max(1, len(zlib.compress(b)))


def transcribe_file(
    file: str,
    job_id: str,
    vad_model,
    whisper_model_path: str,
    corrector: Corrector,
    cancel_event: threading.Event,
    language: str = "th",
) -> Generator[OutgoingMessage, None, None]:
    tmp_path = None
    try:
        # Decode audio to a temp file so numpy reads directly from disk —
        # avoids holding both the raw subprocess bytes AND the numpy array
        # in memory simultaneously (saves ~50% peak RAM for long recordings).
        with tempfile.NamedTemporaryFile(suffix=".pcm", delete=False) as tmp:
            tmp_path = tmp.name
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", tmp_path],
            check=True,
            stdin=subprocess.DEVNULL,
        )
        audio = np.fromfile(tmp_path, dtype=np.float32)
        os.unlink(tmp_path)
        tmp_path = None

        speech = get_speech_timestamps(
            torch.from_numpy(audio),
            vad_model,
            sampling_rate=SR,
            threshold=0.4,
            min_silence_duration_ms=800,
            speech_pad_ms=300,
        )

        chunks: list[list[int]] = []
        cur: list[int] | None = None
        for s in speech:
            if cur and s["end"] - cur[0] <= MAX_CHUNK:
                cur[1] = s["end"]
            else:
                if cur:
                    chunks.append(cur)
                cur = [s["start"], s["end"]]
                while cur[1] - cur[0] > MAX_CHUNK:
                    chunks.append([cur[0], cur[0] + MAX_CHUNK])
                    cur[0] += MAX_CHUNK
        if cur:
            chunks.append(cur)

        yield TotalMessage(id=job_id, count=len(chunks))

        glossary = _glossary(language)
        tail = ""
        seg_count = 0
        corrected_up_to = 0

        for i, (a, b) in enumerate(chunks):
            if cancel_event.is_set():
                yield CancelledMessage(id=job_id)
                return

            clip = audio[a:b]
            prompt = (glossary + " " + tail).strip()

            r = mlx_whisper.transcribe(
                clip,
                path_or_hf_repo=whisper_model_path,
                language=language,
                initial_prompt=prompt,
                condition_on_previous_text=False,
            )
            text = r["text"].strip()
            suspect = _ratio(text) > 2.4 or not text

            if suspect:
                r = mlx_whisper.transcribe(
                    clip,
                    path_or_hf_repo=whisper_model_path,
                    language=language,
                    initial_prompt=glossary,
                    condition_on_previous_text=False,
                    temperature=(0.2, 0.4, 0.6),
                )
                text = r["text"].strip()
                suspect = _ratio(text) > 2.4 or not text

            offset = a / SR
            new_segs = [
                Segment(
                    start=round(offset + s["start"], 2),
                    end=round(offset + s["end"], 2),
                    text=s["text"].strip(),
                    suspect=suspect,
                )
                for s in r["segments"]
            ]

            if not suspect:
                tail = text[-200:]

            base_idx = seg_count
            seg_count += len(new_segs)

            yield ChunkMessage(id=job_id, index=i, base_idx=base_idx, segments=new_segs)

            # corrector disabled — enable when API key is configured

        yield DoneMessage(id=job_id)

    except subprocess.CalledProcessError as e:
        yield ErrorMessage(id=job_id, message="ffmpeg: " + e.stderr.decode())
    except Exception as e:
        yield ErrorMessage(id=job_id, message=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
