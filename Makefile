PYTHON   := python3
WORKER   := transcription-worker
VENV     := $(WORKER)/.venv
PIP      := $(VENV)/bin/pip
PY       := $(VENV)/bin/python
RECORDER := screen-recorder

MODEL  ?= mlx-community/whisper-large-v3-turbo
FILE   ?= $(WORKER)/tests/videos/demo.mp4
JOB_ID ?= test-1

.PHONY: install install-worker install-recorder dev build test test-rust test-ts test-init test-transcribe clean check-deps

# --- Dependency check ---

check-deps:
	@echo "Checking dependencies..."
	@ok=true; \
	check() { \
	    if command -v "$$1" >/dev/null 2>&1; then \
	        echo "  [ok] $$1 $$($$1 $$2 2>&1 | head -1)"; \
	    else \
	        echo "  [missing] $$1  →  $$3"; ok=false; \
	    fi; \
	}; \
	check python3   "--version"  "brew install python"; \
	check swift     "--version"  "xcode-select --install"; \
	check cargo     "--version"  "curl https://sh.rustup.rs -sSf | sh"; \
	check node      "--version"  "brew install node"; \
	check pnpm      "--version"  "npm install -g pnpm"; \
	check ffmpeg    "-version"   "brew install ffmpeg"; \
	$$ok || { echo ""; echo "Run the commands above to install missing dependencies."; exit 1; }; \
	echo "All dependencies OK."

# --- Python worker ---

install-worker:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -r $(WORKER)/requirements.txt

# --- Swift screen recorder ---

install-recorder:
	cd $(RECORDER) && swift build -c release

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

install: install-worker install-recorder
	pnpm install

test-ts:
	pnpm tsc --noEmit

dev:
	pnpm tauri dev

build:
	pnpm tauri build

# --- Misc ---

clean:
	@cd "$(dir $(abspath $(lastword $(MAKEFILE_LIST))))" && \
	for path in "$(VENV)" "node_modules" "src-tauri/target" "$(RECORDER)/.build" "$(RECORDER)/.swiftpm"; do \
	    [ -n "$$path" ]         || { echo "ERROR: empty path, aborting"; exit 1; }; \
	    case "$$path" in /*|~*) echo "ERROR: refusing absolute path: $$path"; exit 1 ;; esac; \
	    [ -d "$$path" ] && rm -rf "$$path" && echo "  removed $$path" || true; \
	done
	@find "$(WORKER)" -name "__pycache__" -o -name "*.pyc" 2>/dev/null | xargs rm -rf || true
