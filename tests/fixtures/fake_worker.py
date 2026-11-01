#!/usr/bin/env python3
"""Fake worker for integration tests — responds with hardcoded messages."""
import json
import sys

def emit(msg: dict):
    print(json.dumps(msg, ensure_ascii=False), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    t = msg["type"]

    if t == "init":
        emit({"type": "ready"})

    elif t == "transcribe_file":
        job_id = msg["id"]
        emit({"type": "total", "id": job_id, "count": 1})
        emit({
            "type": "chunk",
            "id": job_id,
            "index": 0,
            "base_idx": 0,
            "segments": [
                {"start": 0.0, "end": 2.5, "text": "สวัสดีครับ", "suspect": False}
            ]
        })
        emit({"type": "correction", "id": job_id, "start_idx": 0, "texts": ["สวัสดีครับ"]})
        emit({"type": "done", "id": job_id})

    elif t == "cancel":
        emit({"type": "cancelled", "id": msg["id"]})
