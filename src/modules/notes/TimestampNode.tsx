import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Timer } from "lucide-react";
import { formatDuration } from "@/lib/utils";

export interface TimestampContextValue {
  isLiveRecording: boolean;
  onSeek?: (time: number) => void;
}

export const TimestampContext = createContext<TimestampContextValue>({
  isLiveRecording: false,
});

function TimestampChip({ node }: { node: any }) {
  const { isLiveRecording, onSeek } = useContext(TimestampContext);
  const time = node.attrs.time as number;
  const clickable = !isLiveRecording && !!onSeek;

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        contentEditable={false}
        onClick={clickable ? () => onSeek!(time) : undefined}
        className={[
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium mx-0.5 select-none font-mono",
          clickable
            ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors"
            : "bg-muted text-muted-foreground cursor-default",
        ].join(" ")}
        title={clickable ? `Go to ${formatDuration(time)}` : undefined}
      >
        <Timer className="h-3 w-3 shrink-0" />
        {formatDuration(time)}
      </span>
    </NodeViewWrapper>
  );
}

export const TimestampNode = Node.create({
  name: "timestamp",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      time: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="timestamp"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "timestamp",
        "data-time": node.attrs.time,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimestampChip);
  },
});
