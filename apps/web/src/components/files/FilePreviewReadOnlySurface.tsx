import { File, Virtualizer } from "@pierre/diffs/react";

import { resolveDiffThemeName } from "~/lib/diffRendering";

import { projectFileCacheKey } from "./fileContentRevision";
import { FILE_LINK_REVEAL_UNSAFE_CSS, type FilePostRender } from "./FilePreviewLineReveal";

export function FilePreviewReadOnlySurface(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly byteLength: number;
  readonly resolvedTheme: "light" | "dark";
  readonly wordWrap: boolean;
  readonly onPostRender: FilePostRender;
}) {
  return (
    <Virtualizer
      key={`${props.relativePath}:${props.resolvedTheme}:${props.byteLength}`}
      className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
      config={{
        overscrollSize: 600,
        intersectionObserverMargin: 1200,
      }}
    >
      <File
        file={{
          name: props.relativePath,
          contents: props.contents,
          cacheKey: projectFileCacheKey(props.cwd, props.relativePath, props.contents),
        }}
        options={{
          disableFileHeader: true,
          overflow: props.wordWrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(props.resolvedTheme),
          themeType: props.resolvedTheme,
          unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
          onPostRender: props.onPostRender,
        }}
        className="min-h-full"
      />
    </Virtualizer>
  );
}
