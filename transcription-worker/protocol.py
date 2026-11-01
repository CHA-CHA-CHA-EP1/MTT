from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# ── Shared ────────────────────────────────────────────────────────────────────


class Segment(BaseModel):
    start: float
    end: float
    text: str
    suspect: bool


# ── Incoming (Rust → Python) ──────────────────────────────────────────────────


class InitMessage(BaseModel):
    type: Literal["init"]
    whisper_model: str


class TranscribeFileMessage(BaseModel):
    type: Literal["transcribe_file"]
    id: str
    file: str
    mode: Literal["offline", "stream"] = "offline"


class CancelMessage(BaseModel):
    type: Literal["cancel"]
    id: str


IncomingMessage = Annotated[
    Union[InitMessage, TranscribeFileMessage, CancelMessage],
    Field(discriminator="type"),
]


# ── Outgoing (Python → Rust) ──────────────────────────────────────────────────


class ReadyMessage(BaseModel):
    type: Literal["ready"] = "ready"


class TotalMessage(BaseModel):
    type: Literal["total"] = "total"
    id: str
    count: int


class ChunkMessage(BaseModel):
    type: Literal["chunk"] = "chunk"
    id: str
    index: int
    base_idx: int
    segments: list[Segment]


class CorrectionMessage(BaseModel):
    type: Literal["correction"] = "correction"
    id: str
    start_idx: int
    texts: list[str]


class DoneMessage(BaseModel):
    type: Literal["done"] = "done"
    id: str


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    id: str
    message: str


class CancelledMessage(BaseModel):
    type: Literal["cancelled"] = "cancelled"
    id: str


OutgoingMessage = Union[
    ReadyMessage,
    TotalMessage,
    ChunkMessage,
    CorrectionMessage,
    DoneMessage,
    ErrorMessage,
    CancelledMessage,
]
