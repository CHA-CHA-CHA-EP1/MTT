from __future__ import annotations

import subprocess
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
GLOSSARY = "Rust, Graydon Hoare, Mozilla, Ownership, Garbage Collector, Memory Bug, Crash, Microsoft, Amazon, Google"
PAUSE_SPLIT = 0.6  # split segment only at genuine speech pauses


def _split_long(seg: dict, suspect: bool, offset: float) -> list[Segment]:
    words = seg.get("words", [])
    if not words:
        text = seg["text"].strip()
        return [Segment(start=round(offset + seg["start"], 2), end=round(offset + seg["end"], 2), text=text, suspect=suspect)] if text else []

    result: list[Segment] = []
    group: list[dict] = []

    def flush():
        if not group:
            return
        # Join raw — Whisper prefixes English words with space, Thai syllables have none.
        text = "".join(w["word"] for w in group).strip()
        if text:
            result.append(Segment(
                start=round(offset + group[0]["start"], 2),
                end=round(offset + group[-1]["end"], 2),
                text=text,
                suspect=suspect,
            ))

    for w in words:
        if group and (w["start"] - group[-1]["end"]) >= PAUSE_SPLIT:
            flush()
            group = []
        group.append(w)

    flush()
    return result


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
) -> Generator[OutgoingMessage, None, None]:
    try:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
            capture_output=True,
            check=True,
        ).stdout
        audio = np.frombuffer(raw, dtype=np.float32)

        speech = get_speech_timestamps(
            torch.from_numpy(audio.copy()),
            vad_model,
            sampling_rate=SR,
            min_silence_duration_ms=500,
            speech_pad_ms=200,
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

        tail = ""
        all_segs: list[Segment] = []
        corrected_up_to = 0

        for i, (a, b) in enumerate(chunks):
            if cancel_event.is_set():
                yield CancelledMessage(id=job_id)
                return

            clip = audio[a:b]
            prompt = (GLOSSARY + " " + tail).strip()

            r = mlx_whisper.transcribe(
                clip,
                path_or_hf_repo=whisper_model_path,
                language="th",
                initial_prompt=prompt,
                condition_on_previous_text=False,
                word_timestamps=True,
            )
            text = r["text"].strip()
            suspect = _ratio(text) > 2.4 or not text

            if suspect:
                r = mlx_whisper.transcribe(
                    clip,
                    path_or_hf_repo=whisper_model_path,
                    language="th",
                    initial_prompt=GLOSSARY,
                    condition_on_previous_text=False,
                    temperature=(0.2, 0.4, 0.6),
                    word_timestamps=True,
                )
                text = r["text"].strip()
                suspect = _ratio(text) > 2.4 or not text

            offset = a / SR
            new_segs = [
                split
                for s in r["segments"]
                for split in _split_long(s, suspect, offset)
            ]

            if not suspect:
                tail = text[-200:]

            base_idx = len(all_segs)
            all_segs.extend(new_segs)

            yield ChunkMessage(id=job_id, index=i, base_idx=base_idx, segments=new_segs)

            is_last = i == len(chunks) - 1
            pending = len(all_segs) - corrected_up_to

            if pending >= BATCH_SIZE or (is_last and pending > 0):
                overlap_start = max(0, corrected_up_to - OVERLAP)
                batch = all_segs[overlap_start:]
                corrected_texts = corrector.correct_batch(batch)
                yield CorrectionMessage(id=job_id, start_idx=overlap_start, texts=corrected_texts)
                corrected_up_to = len(all_segs)

        yield DoneMessage(id=job_id)

    except subprocess.CalledProcessError as e:
        yield ErrorMessage(id=job_id, message="ffmpeg: " + e.stderr.decode())
    except Exception as e:
        yield ErrorMessage(id=job_id, message=str(e))
    finally:
        pass
