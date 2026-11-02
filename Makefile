PYTHON   := python3
WORKER   := transcription-worker
VENV     := $(WORKER)/.venv
PIP      := $(VENV)/bin/pip
PY       := $(VENV)/bin/python
RECORDER    := screen-recorder
RECORDER_BIN := $(RECORDER)/.build/release/screen-recorder
TAURI_BIN    := src-tauri/target/debug/mtt
TAURI_ID     := com.mtt.app

MODEL     ?= mlx-community/whisper-large-v3-turbo
FILE      ?= $(WORKER)/tests/videos/demo.mp4
JOB_ID    ?= test-1
WINDOW_ID ?= 0
DURATION  ?= 10

.PHONY: install install-worker install-recorder sign-dev dev build test test-rust test-ts test-init test-transcribe test-recorder test-record clean check-deps

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
	codesign --sign - -i com.mtt.screen-recorder \
		--entitlements $(RECORDER)/entitlements.plist \
		--force $(RECORDER)/.build/release/screen-recorder

test-init:
	echo '{"type":"init","whisper_model":"$(MODEL)"}' | $(PY) $(WORKER)/main.py

test-transcribe:
	printf '{"type":"init","whisper_model":"$(MODEL)"}\n{"type":"transcribe_file","id":"$(JOB_ID)","file":"$(FILE)","mode":"offline"}\n' \
		| $(PY) $(WORKER)/main.py

test-recorder:
	echo '{"type":"list_windows"}' | $(RECORDER_BIN)

test-record:
	@if [ "$(WINDOW_ID)" = "0" ]; then \
		echo "Usage: make test-record WINDOW_ID=<id> [DURATION=10]"; \
		echo "Run 'make test-recorder' first to list window IDs"; \
		exit 1; \
	fi
	@rm -rf /tmp/mtt-test && mkdir -p /tmp/mtt-test
	@echo "Recording window $(WINDOW_ID) for $(DURATION)s → /tmp/mtt-test/"
	@(printf '{"type":"start","id":"test-1","window_id":$(WINDOW_ID),"chunk_duration":5,"output_dir":"/tmp/mtt-test"}\n'; \
	  sleep $(DURATION); \
	  printf '{"type":"stop","id":"test-1"}\n') | $(RECORDER_BIN)
	@echo "--- output files ---"
	@ls -lh /tmp/mtt-test/ 2>/dev/null || echo "(none)"

test: test-rust test-ts test-transcribe

# --- Rust ---

test-rust:
	cd src-tauri && cargo test

# --- Frontend ---

install: install-worker install-recorder
	pnpm install

test-ts:
	pnpm tsc --noEmit

# Build + sign the Tauri debug binary (run this once before `make dev`,
# and again any time Rust source changes to re-apply the signature).
sign-dev:
	cd src-tauri && cargo build
	codesign --sign - -i $(TAURI_ID) --force $(TAURI_BIN)

dev:
	@pkill -f "screen-recorder/.build/release/screen-recorder" 2>/dev/null || true
	$(MAKE) install-recorder
	$(MAKE) sign-dev
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
