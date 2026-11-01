PYTHON := python3
WORKER := transcription-worker
VENV   := $(WORKER)/.venv
PIP    := $(VENV)/bin/pip
PY     := $(VENV)/bin/python

MODEL  ?= mlx-community/whisper-large-v3-turbo
FILE   ?= $(WORKER)/tests/videos/demo.mp4
JOB_ID ?= test-1

.PHONY: install test test-init test-transcribe clean

install:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -r $(WORKER)/requirements.txt

test-init:
	echo '{"type":"init","whisper_model":"$(MODEL)"}' | $(PY) $(WORKER)/main.py

test-transcribe:
	printf '{"type":"init","whisper_model":"$(MODEL)"}\n{"type":"transcribe_file","id":"$(JOB_ID)","file":"$(FILE)","mode":"offline"}\n' \
		| $(PY) $(WORKER)/main.py

test: test-transcribe

clean:
	rm -rf $(VENV) $(WORKER)/__pycache__ $(WORKER)/*.pyc
