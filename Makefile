PYTHON := python3
WORKER := transcription-worker
VENV   := $(WORKER)/.venv
PIP    := $(VENV)/bin/pip
PY     := $(VENV)/bin/python

MODEL  ?= mlx-community/whisper-large-v3-turbo
FILE   ?= $(WORKER)/tests/videos/demo.mp4
JOB_ID ?= test-1

.PHONY: install install-worker dev build test test-rust test-ts test-init test-transcribe clean

# --- Python worker ---

install-worker:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -r $(WORKER)/requirements.txt

test-init:
	echo '{"type":"init","whisper_model":"$(MODEL)"}' | $(PY) $(WORKER)/main.py

test-transcribe:
	printf '{"type":"init","whisper_model":"$(MODEL)"}\n{"type":"transcribe_file","id":"$(JOB_ID)","file":"$(FILE)","mode":"offline"}\n' \
		| $(PY) $(WORKER)/main.py

test: test-rust test-ts test-transcribe

# --- Rust ---

test-rust:
	cd src-tauri && cargo test

# --- Frontend ---

install:
	pnpm install

test-ts:
	pnpm tsc --noEmit

dev:
	pnpm tauri dev

build:
	pnpm tauri build

# --- Misc ---

clean:
	rm -rf $(VENV) $(WORKER)/__pycache__ $(WORKER)/*.pyc
	rm -rf node_modules src-tauri/target
