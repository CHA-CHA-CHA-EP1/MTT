# E2E QA harness (standalone — not wired into build/CI)

Headless-browser checks for the Notes editor vim features. The app is a Tauri
frontend; these scripts run it in plain Chromium against the vite dev server
and mock the Tauri IPC **in-browser only** (`addInitScript`). No app source is
modified, no Rust backend needed.

## Scripts

| Script | Covers |
|---|---|
| `e2e.mjs` | Vim mode indicator: NORMAL/INSERT badge next to "Notes", caret colors (amber/emerald), badge hidden on blur / before focus / when vim off, toggle off→on while focused, plain typing with vim off. Saves screenshots to `shots/`. |
| `jk-ac.mjs` | Block-based `j`/`k` navigation: goal-column preservation (clamp on short lines, restore on long), item-by-item movement through task items and headings, no-op at first/last block, ArrowUp/Down streak sharing, goal reset on other keys and on click, plus indicator regression (i/Esc/blur/refocus). |

Both scripts print one `PASS`/`FAIL` line per assertion, end with
`RESULT: ALL PASS` or `RESULT: N FAILURE(S)`, and exit `0`/`1` accordingly.
`console errors` must be `[]`.

## Setup (once)

```sh
cd tests/e2e
bun add playwright-core          # or: npm install playwright-core
bunx playwright install chromium # or: npx playwright install chromium
```

## Run

```sh
# 1. from the repo root, start the dev server (fixed port 1420):
bun run dev

# 2. in another terminal:
cd tests/e2e
bun e2e.mjs
bun jk-ac.mjs
```

If port 1420 is taken (e.g. another dev server is already running), point the
scripts at it instead of starting a second one:

```sh
MTT_URL=http://localhost:1421 bun e2e.mjs
```

## Notes / pitfalls

- `ERR_CONNECTION_REFUSED` → the dev server isn't running (step 1) or `MTT_URL`
  points at the wrong port.
- The scripts enable Vim Mode themselves via the Settings UI; localStorage is
  fresh per run (new browser context), so runs are independent.
- Cursor placement inside the editor must use vim keys (`g`, `0`, `l`, …).
  Setting a DOM Range directly gets re-normalized by ProseMirror on focus and
  lands at the document end — don't "fix" the harness that way.
- Screenshots (`shots/`) and `node_modules/` here are git-ignored; never commit
  them.