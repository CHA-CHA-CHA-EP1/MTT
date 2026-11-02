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

.PHONY: install install-worker install-recorder sign-dev dev build build-release test test-rust test-ts test-init test-transcribe test-recorder test-record clean check-deps

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

# Full release build: PyInstaller worker + screen-recorder → bundle into .app/.dmg
build-release: install-worker install-recorder
	@echo "→ Building Python worker with PyInstaller..."
	$(PIP) install pyinstaller --quiet
	mkdir -p src-tauri/binaries
	cd $(WORKER) && ../$(VENV)/bin/pyinstaller main.py \
		--onefile --name mtt-worker \
		--distpath ../src-tauri/binaries \
		--workpath /tmp/mtt-pyinstaller \
		--specpath /tmp/mtt-pyinstaller \
		--collect-all mlx \
		--collect-all mlx_whisper \
		--clean --noconfirm
	mv src-tauri/binaries/mtt-worker src-tauri/binaries/mtt-worker-aarch64-apple-darwin
	@echo "→ Copying screen-recorder sidecar..."
	cp $(RECORDER_BIN) src-tauri/binaries/screen-recorder-aarch64-apple-darwin
	codesign --sign - --force src-tauri/binaries/screen-recorder-aarch64-apple-darwin
	@echo "→ Building Tauri app..."
	pnpm tauri build
	@echo "→ Injecting sidecars into .app bundle..."
	@app=$$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1); \
	echo "  app: $$app"; \
	cp src-tauri/binaries/mtt-worker-aarch64-apple-darwin "$$app/Contents/MacOS/mtt-worker"; \
	cp src-tauri/binaries/screen-recorder-aarch64-apple-darwin "$$app/Contents/MacOS/screen-recorder"; \
	codesign --sign - --force "$$app/Contents/MacOS/mtt-worker"; \
	codesign --sign - --force "$$app/Contents/MacOS/screen-recorder"; \
	echo "→ Repackaging DMG..."; \
	dmg_dir=src-tauri/target/release/bundle/dmg; \
	rm -f $$dmg_dir/*.dmg; \
	hdiutil create -volname "mtt" -srcfolder "$$app" -ov -format UDZO "$$dmg_dir/mtt_0.0.1.dmg"; \
	echo "✓ Done → $$dmg_dir/mtt_0.0.1.dmg"

# --- Misc ---

clean:
	@cd "$(dir $(abspath $(lastword $(MAKEFILE_LIST))))" && \
	for path in "$(VENV)" "node_modules" "src-tauri/target" "$(RECORDER)/.build" "$(RECORDER)/.swiftpm"; do \
	    [ -n "$$path" ]         || { echo "ERROR: empty path, aborting"; exit 1; }; \
	    case "$$path" in /*|~*) echo "ERROR: refusing absolute path: $$path"; exit 1 ;; esac; \
	    [ -d "$$path" ] && rm -rf "$$path" && echo "  removed $$path" || true; \
	done
	@find "$(WORKER)" -name "__pycache__" -o -name "*.pyc" 2>/dev/null | xargs rm -rf || true
