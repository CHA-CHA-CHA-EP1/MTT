import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useVimModeState } from "@/lib/vimModeState";

// Minimal vim-like mode for ProseMirror. Since the published `prosemirror-vim`
// package is not available on npm, this provides a pragmatic subset of vim
// keybindings that is sufficient for note-taking while keeping the normal/insert
// mode state in sync with the global `useVimModeState` store so hotkey handlers
// elsewhere can guard against mode-sensitive conflicts.

type VimMode = "normal" | "insert";

const vimPluginKey = new PluginKey<{ mode: VimMode }>("mtt-vim");

function setMode(view: EditorView, mode: VimMode) {
  const tr = view.state.tr.setMeta(vimPluginKey, { mode });
  view.dispatch(tr);
  useVimModeState.getState().setNormalMode(mode === "normal");
  updateCursorClass(view, mode);
}

function updateCursorClass(view: EditorView, mode: VimMode) {
  const dom = view.dom as HTMLElement;
  dom.classList.toggle("vim-normal", mode === "normal");
  dom.classList.toggle("vim-insert", mode === "insert");
}

function getMode(view: EditorView): VimMode {
  return vimPluginKey.getState(view.state)?.mode ?? "insert";
}

function moveCursor(view: EditorView, delta: number) {
  const { selection, doc } = view.state;
  const pos = Math.min(Math.max(selection.from + delta, 1), doc.content.size);
  const resolved = doc.resolve(pos);
  const tr = view.state.tr.setSelection(TextSelection.near(resolved, delta >= 0 ? 1 : -1));
  view.dispatch(tr);
}

function moveLine(view: EditorView, dir: 1 | -1) {
  const { state } = view;
  const coords = view.coordsAtPos(state.selection.from);
  const targetY = dir > 0 ? coords.bottom + 4 : coords.top - 4;
  const target = view.posAtCoords({ left: coords.left, top: targetY });
  if (!target) return;
  const resolved = state.doc.resolve(target.pos);
  const tr = state.tr.setSelection(TextSelection.near(resolved));
  view.dispatch(tr);
}

function moveToLineStart(view: EditorView) {
  const { state } = view;
  const $pos = state.selection.$from;
  const start = $pos.start($pos.depth);
  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(start)));
  view.dispatch(tr);
}

function moveToLineEnd(view: EditorView) {
  const { state } = view;
  const $pos = state.selection.$from;
  const end = $pos.end($pos.depth);
  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(end), -1));
  view.dispatch(tr);
}

function deleteCharUnder(view: EditorView) {
  const { state } = view;
  const from = state.selection.from;
  const to = Math.min(from + 1, state.doc.content.size);
  if (to > from) view.dispatch(state.tr.delete(from, to));
}

function deleteLine(view: EditorView) {
  const { state } = view;
  const $pos = state.selection.$from;
  const start = $pos.start($pos.depth);
  const end = $pos.end($pos.depth);
  view.dispatch(state.tr.delete(start, end));
}

function openLineBelow(view: EditorView) {
  const $pos = view.state.selection.$from;
  const end = $pos.end($pos.depth);
  const moveTr = view.state.tr.setSelection(
    TextSelection.near(view.state.doc.resolve(end), -1),
  );
  view.dispatch(moveTr);
  view.dispatch(view.state.tr.split(view.state.selection.from));
}

function openLineAbove(view: EditorView) {
  const $pos = view.state.selection.$from;
  const start = $pos.start($pos.depth);
  const moveTr = view.state.tr.setSelection(
    TextSelection.near(view.state.doc.resolve(start)),
  );
  view.dispatch(moveTr);
  view.dispatch(view.state.tr.split(view.state.selection.from));
  // Move cursor back up into the new empty line
  const upCoords = view.coordsAtPos(view.state.selection.from);
  const target = view.posAtCoords({ left: upCoords.left, top: upCoords.top - 4 });
  if (target) {
    const resolved = view.state.doc.resolve(target.pos);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(resolved)));
  }
}

function handleNormalKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = event.key;

  // Mode exits
  if (key === "i") { setMode(view, "insert"); return true; }
  if (key === "a") { moveCursor(view, 1); setMode(view, "insert"); return true; }
  if (key === "I") { moveToLineStart(view); setMode(view, "insert"); return true; }
  if (key === "A") { moveToLineEnd(view); setMode(view, "insert"); return true; }
  if (key === "o") { openLineBelow(view); setMode(view, "insert"); return true; }
  if (key === "O") { openLineAbove(view); setMode(view, "insert"); return true; }
  if (key === "s") { deleteCharUnder(view); setMode(view, "insert"); return true; }
  if (key === "S") { deleteLine(view); setMode(view, "insert"); return true; }
  if (key === "c") { deleteCharUnder(view); setMode(view, "insert"); return true; }
  if (key === "C") { moveToLineEnd(view); setMode(view, "insert"); return true; }

  // Movement
  if (key === "h" || key === "ArrowLeft") { moveCursor(view, -1); return true; }
  if (key === "l" || key === "ArrowRight") { moveCursor(view, 1); return true; }
  if (key === "j" || key === "ArrowDown") { moveLine(view, 1); return true; }
  if (key === "k" || key === "ArrowUp") { moveLine(view, -1); return true; }
  if (key === "0" || key === "Home") { moveToLineStart(view); return true; }
  if (key === "$" || key === "End") { moveToLineEnd(view); return true; }
  if (key === "G") {
    const resolved = view.state.doc.resolve(view.state.doc.content.size - 1);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(resolved, -1)));
    return true;
  }
  if (key === "g") {
    // Minimal gg -> jump to top (no multi-key tracking; treat single g as top)
    const resolved = view.state.doc.resolve(1);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(resolved)));
    return true;
  }

  // Editing
  if (key === "x") { deleteCharUnder(view); return true; }
  if (key === "D") {
    const { state } = view;
    const $pos = state.selection.$from;
    const end = $pos.end($pos.depth);
    view.dispatch(state.tr.delete(state.selection.from, end));
    return true;
  }
  if (key === "u") {
    // Trigger ProseMirror history undo via synthesized Mod-z keydown so we
    // reuse Tiptap's registered history keymap instead of reaching into it.
    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    view.dom.dispatchEvent(undoEvent);
    return true;
  }

  // Swallow any other plain letter keys in normal mode so they don't type.
  if (key.length === 1) return true;
  return false;
}

export const VimExtension = Extension.create({
  name: "vim",

  addProseMirrorPlugins() {
    return [
      new Plugin<{ mode: VimMode }>({
        key: vimPluginKey,
        state: {
          init: () => ({ mode: "insert" as VimMode }),
          apply(tr, value) {
            const meta = tr.getMeta(vimPluginKey);
            if (meta && (meta.mode === "normal" || meta.mode === "insert")) {
              return { mode: meta.mode };
            }
            return value;
          },
        },
        view(view) {
          // Start in normal mode by vim convention, then sync global store.
          queueMicrotask(() => setMode(view, "normal"));
          return {
            destroy() {
              useVimModeState.getState().setNormalMode(false);
              const dom = view.dom as HTMLElement;
              dom.classList.remove("vim-normal", "vim-insert");
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            const mode = getMode(view);
            if (event.key === "Escape") {
              if (mode === "insert") {
                setMode(view, "normal");
                event.preventDefault();
                return true;
              }
              return true;
            }
            if (mode === "normal") {
              const handled = handleNormalKey(view, event);
              if (handled) event.preventDefault();
              return handled;
            }
            return false;
          },
          handleDOMEvents: {
            blur(view) {
              // On blur, treat the editor as back in insert mode so global
              // hotkeys (u, t, etc.) are not blocked while the editor isn't
              // focused.
              useVimModeState.getState().setNormalMode(false);
              const dom = view.dom as HTMLElement;
              dom.classList.remove("vim-normal", "vim-insert");
              return false;
            },
            focus(view) {
              const mode = getMode(view);
              useVimModeState.getState().setNormalMode(mode === "normal");
              updateCursorClass(view, mode);
              return false;
            },
          },
        },
      }),
    ];
  },
});
