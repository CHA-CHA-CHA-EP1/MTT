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


def _warmup(whisper_model_path: str) -> None:
    dummy = np.zeros(SR, dtype=np.float32)
    mlx_whisper.transcribe(dummy, path_or_hf_repo=whisper_model_path, language="th")


SR = 16_000


def main() -> None:
    vad_model = None
    whisper_model_path: str | None = None
    corrector: Corrector | None = None
    active_jobs: dict[str, threading.Event] = {}
    active_threads: list[threading.Thread] = []

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

            def run(jid: str = job_id, fp: str = file_path, ce: threading.Event = cancel_event, lg: str = lang) -> None:
                for out in transcribe_file(fp, jid, vad_model, whisper_model_path, corrector, ce, lg):
                    _emit(out)
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
