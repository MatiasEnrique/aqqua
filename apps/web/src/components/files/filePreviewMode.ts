export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export type FilePreviewMode = "editable-source" | "read-only-source" | "rendered-markdown";

export function resolveFilePreviewMode(input: {
  readonly relativePath: string;
  readonly truncated: boolean;
  readonly renderMarkdown: boolean;
}): FilePreviewMode {
  if (input.truncated) return "read-only-source";
  if (input.renderMarkdown && isMarkdownPreviewFile(input.relativePath)) {
    return "rendered-markdown";
  }
  return "editable-source";
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
