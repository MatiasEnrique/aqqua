import type { ScopedThreadRef } from "@aqqua/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { ScrollArea } from "~/components/ui/scroll-area";

export function RenderedMarkdownPreview(props: {
  readonly cwd: string;
  readonly contents: string;
  readonly threadRef: ScopedThreadRef;
  readonly onTaskListChange: (change: { markerOffset: number; checked: boolean }) => void;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ChatMarkdown
        text={props.contents}
        cwd={props.cwd}
        threadRef={props.threadRef}
        className="mx-auto max-w-4xl px-6 py-5"
        onTaskListChange={props.onTaskListChange}
      />
    </ScrollArea>
  );
}
