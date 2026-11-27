from __future__ import annotations

import sys
import threading
from typing import Any

import mlx_whisper
import numpy as np
from pydantic import TypeAdapter, ValidationError
from silero_vad import load_silero_vad

from corrector import Corrector
from protocol import (
    CancelMessage,
    ErrorMessage,
    IncomingMessage,
    InitMessage,
    OutgoingMessage,
    ReadyMessage,
    TranscribeFileMessage,
)
from transcriber import transcribe_file

_adapter: TypeAdapter[Any] = TypeAdapter(IncomingMessage)


def _emit(msg: OutgoingMessage) -> None:
    sys.stdout.write(msg.model_dump_json() + "\n")
    sys.stdout.flush()


def _log(text: str) -> None:
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def _is_qwen3(model_id: str) -> bool:
    return "Qwen3-ASR" in model_id or "qwen3-asr" in model_id.lower()


def _warmup(model_path: str) -> None:
    if _is_qwen3(model_path):
        return  # from_pretrained in init is sufficient
    dummy = np.zeros(SR, dtype=np.float32)
    mlx_whisper.transcribe(dummy, path_or_hf_repo=model_path, language="th")


SR = 16_000


def main() -> None:
    vad_model = None
    whisper_model_path: str | None = None
    qwen3_model = None
    corrector: Corrector | None = None
    active_jobs: dict[str, threading.Event] = {}
    active_threads: list[threading.Thread] = []
    job_next_idx: dict[str, int] = {}  # tracks next segment idx for stream-mode jobs
    # Qwen3 weights are heavy; cache per model_id so we don't reload on every job.
    qwen3_cache: dict[str, Any] = {}

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            msg = _adapter.validate_json(line)
        except ValidationError as e:
            _log(f"protocol error: {e}")
            continue

        if isinstance(msg, InitMessage):
            _log(f"loading models: {msg.whisper_model}")
            try:
                if vad_model is None:
                    vad_model = load_silero_vad()
                    corrector = Corrector()
                if _is_qwen3(msg.whisper_model):
                    # Warm the Qwen3 cache so the first real job doesn't pay the load.
                    if msg.whisper_model not in qwen3_cache:
                        from qwen3_asr_mlx import Qwen3ASR
                        qwen3_cache[msg.whisper_model] = Qwen3ASR.from_pretrained(msg.whisper_model)
                else:
                    _warmup(msg.whisper_model)
                whisper_model_path = msg.whisper_model
                _emit(ReadyMessage())
            except Exception as e:
                _log(f"init error: {e}")
                _emit(ErrorMessage(id="", message=f"Failed to load model '{msg.whisper_model}': {e}"))

        elif isinstance(msg, TranscribeFileMessage):
            if vad_model is None or whisper_model_path is None or corrector is None:
                _log("received transcribe_file before init")
                continue

            cancel_event = threading.Event()
            active_jobs[msg.id] = cancel_event

            job_id = msg.id
            file_path = msg.file
            lang = msg.language
            chunk_offset = msg.chunk_offset_secs or 0.0
            is_stream = msg.mode == "stream"
            start_idx = job_next_idx.get(job_id, 0) if is_stream else 0

            mp = whisper_model_path
            def run(jid: str = job_id, fp: str = file_path, ce: threading.Event = cancel_event, lg: str = lang, mp: str = mp, co: float = chunk_offset, si: int = start_idx, stream: bool = is_stream) -> None:
                qm = None
                if _is_qwen3(mp):
                    qm = qwen3_cache.get(mp)
                    if qm is None:
                        from qwen3_asr_mlx import Qwen3ASR
                        qm = Qwen3ASR.from_pretrained(mp)
                        qwen3_cache[mp] = qm
                next_idx = si
                terminal: str | None = None
                for out in transcribe_file(fp, jid, vad_model, mp, corrector, ce, lg, qwen3_model=qm, chunk_offset_secs=co, start_idx=si):
                    _emit(out)
                    if hasattr(out, "segments"):
                        next_idx += len(out.segments)
                    t = getattr(out, "type", None)
                    if t in ("done", "cancelled", "error"):
                        terminal = t
                if stream:
                    # For stream jobs: keep next_idx between chunks so segment indices
                    # stay monotonic across chunks. Drop it only on terminal states so
                    # the dict doesn't grow unbounded across many finished jobs.
                    if terminal in ("done", "cancelled", "error"):
                        job_next_idx.pop(jid, None)
                    else:
                        job_next_idx[jid] = next_idx
                active_jobs.pop(jid, None)

            t = threading.Thread(target=run, daemon=True)
            t.start()
            active_threads.append(t)

        elif isinstance(msg, CancelMessage):
            event = active_jobs.get(msg.id)
            if event:
                event.set()

    for t in active_threads:
        t.join()


if __name__ == "__main__":
    main()
