import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const slashHintKey = new PluginKey("slashHint");

export function createSlashCommand(getCurrentTime: () => number) {
  return Extension.create({
    name: "slashCommand",

    addKeyboardShortcuts() {
      return {
        Enter: () => {
          const { state } = this.editor;
          const { $from } = state.selection;

          if (!state.selection.empty) return false;

          const lineStart = $from.start();
          const lineText = state.doc.textBetween(lineStart, $from.pos);

          const match = lineText.match(/(^|\s)(\/ts)$/);
          if (match) {
            const tsStart = $from.pos - match[2].length;
            this.editor
              .chain()
              .deleteRange({ from: tsStart, to: $from.pos })
              .insertContent({
                type: "timestamp",
                attrs: { time: Math.floor(getCurrentTime()) },
              })
              .run();
            return true;
          }

          return false;
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: slashHintKey,
          props: {
            decorations(state) {
              const { $from } = state.selection;
              if (!state.selection.empty) return DecorationSet.empty;

              const lineStart = $from.start();
              const lineText = state.doc.textBetween(lineStart, $from.pos);
              const match = lineText.match(/(^|\s)(\/ts)$/);
              if (!match) return DecorationSet.empty;

              const tsStart = $from.pos - match[2].length;
              const deco = Decoration.inline(tsStart, $from.pos, {
                class: "slash-command-hint",
              });
              return DecorationSet.create(state.doc, [deco]);
            },
          },
        }),
      ];
    },
  });
}
