import { areFilesEqual, areOptionsEqual, type FileContents } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  formatFileCommentRange,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import {
  beginFileEditingSession,
  projectFileCacheKey,
  resolveFileEditingSession,
  type FileEditingSession,
} from "./fileContentRevision";
import { isMarkdownPreviewFile, setMarkdownTaskChecked } from "./filePreviewMode";

describe("file comment annotations", () => {
  it("normalizes and formats selected line ranges", () => {
    expect(normalizeFileCommentRange({ start: 16, end: 7 })).toEqual({
      startLine: 7,
      endLine: 16,
    });
    expect(formatFileCommentRange(7, 7)).toBe("L7");
    expect(formatFileCommentRange(7, 16)).toBe("L7 to L16");
  });

  it("keeps an annotation range attached when Pierre remaps its anchor line", () => {
    expect(
      remapFileCommentAnnotations([
        {
          lineNumber: 20,
          metadata: {
            entries: [
              {
                id: "comment-1",
                kind: "comment",
                startLine: 7,
                endLine: 16,
                text: "Keep this guarded.",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        lineNumber: 20,
        metadata: {
          entries: [
            {
              id: "comment-1",
              kind: "comment",
              startLine: 11,
              endLine: 20,
              text: "Keep this guarded.",
            },
          ],
        },
      },
    ]);
  });
});

describe("isMarkdownPreviewFile", () => {
  it("recognizes markdown and MDX files case-insensitively", () => {
    expect(isMarkdownPreviewFile("README.md")).toBe(true);
    expect(isMarkdownPreviewFile("docs/guide.MDX")).toBe(true);
  });

  it("does not treat other text files as markdown", () => {
    expect(isMarkdownPreviewFile("docs/guide.txt")).toBe(false);
    expect(isMarkdownPreviewFile("docs/markdown.ts")).toBe(false);
  });
});

describe("setMarkdownTaskChecked", () => {
  const markdown = "- [ ] First\n- [x] Second\n";

  it("checks and unchecks the task marker at the supplied offset", () => {
    expect(setMarkdownTaskChecked(markdown, 2, true)).toBe("- [x] First\n- [x] Second\n");
    expect(setMarkdownTaskChecked(markdown, 14, false)).toBe("- [ ] First\n- [ ] Second\n");
    expect(setMarkdownTaskChecked("1. [X] Ordered\n", 3, false)).toBe("1. [ ] Ordered\n");
  });

  it("leaves the document unchanged for a stale or invalid marker offset", () => {
    expect(setMarkdownTaskChecked(markdown, 0, true)).toBe(markdown);
    expect(setMarkdownTaskChecked(markdown, 200, true)).toBe(markdown);
  });
});

/**
 * A stand-in for the parts of `@pierre/diffs` that decide whether a keystroke
 * lands, modelled directly on the shipped source:
 *
 * - `File.render` skips everything when the options match and the file is equal
 *   (`components/File.js`, the `render` early return).
 * - A render that does go through re-syncs the attached editor, and
 *   `Editor.__syncRenderView` (`editor/editor.js`) throws away its `TextDocument`
 *   — and with it the selection the caret lives in — as soon as the `name`,
 *   `contents`, `lang` or `cacheKey` it attached with stop matching the props.
 *
 * The real comparison functions are imported rather than reimplemented, so this
 * stays honest about what counts as "the same file".
 */
class PierreSurfaceModel {
  onChange: ((contents: string) => void) | undefined;
  buffer = "";
  hasCaret = false;
  /** Renders that were not skipped by the early return. */
  renders = 0;
  /** Times the editor threw away its document and rebuilt it from the props. */
  documentRebuilds = 0;
  droppedKeystrokes = 0;
  private renderedFile: FileContents | undefined;
  private attachedFile: FileContents | undefined;
  private options: object | undefined;

  render(file: FileContents, options: object): void {
    const forceRender = !areOptionsEqual(this.options, options);
    this.options = options;
    if (!forceRender && areFilesEqual(this.renderedFile, file)) return;
    this.renderedFile = file;
    this.renders += 1;
    if (areFilesEqual(this.attachedFile, file)) return;
    this.attachedFile = file;
    this.buffer = file.contents;
    this.hasCaret = false;
    this.documentRebuilds += 1;
  }

  click(): void {
    this.hasCaret = true;
  }

  type(text: string): void {
    if (!this.hasCaret) {
      this.droppedKeystrokes += 1;
      return;
    }
    this.buffer += text;
    this.onChange?.(this.buffer);
  }
}

const STABLE_HANDLERS = {
  onGutterUtilityClick: () => {},
  onLineSelectionChange: () => {},
  onLineSelectionEnd: () => {},
};

/**
 * Mirrors the `fileOptions` memo in `FilePreviewPanel.tsx`: nothing derived from
 * the current line selection is allowed in, and the only callback whose identity
 * moves is the line-reveal one.
 */
function surfaceOptions(input: { commentFormOpen: boolean; onPostRender: () => void }) {
  return {
    disableFileHeader: true,
    enableGutterUtility: !input.commentFormOpen,
    enableLineSelection: !input.commentFormOpen,
    ...STABLE_HANDLERS,
    overflow: "scroll",
    themeType: "dark",
    onPostRender: input.onPostRender,
  };
}

const CWD = "/repo";
const RELATIVE_PATH = "src/app.ts";
const INITIAL_CONTENTS = "const a = 1;\n";

/**
 * The panel's data flow around an editable file: the editor writes through the
 * optimistic store, the store feeds the query, and the query re-renders the
 * surface. `documentSource` is the one thing under test — how the surface turns
 * the contents it is handed back into the `file` prop.
 */
function createSurface(documentSource: "session" | "live-contents") {
  const model = new PierreSurfaceModel();
  const store = { disk: INITIAL_CONTENTS, optimistic: null as string | null };
  const saved: string[] = [];
  let session: FileEditingSession = beginFileEditingSession({
    cwd: CWD,
    relativePath: RELATIVE_PATH,
    contents: INITIAL_CONTENTS,
  });
  let editorContents = session.document.contents;
  let commentFormOpen = false;
  // The panel rebuilds this callback exactly when a line reveal is requested.
  let onPostRender = () => {};
  const documents: FileContents[] = [];

  const render = () => {
    const contents = store.optimistic ?? store.disk;
    let document: FileContents;
    if (documentSource === "session") {
      const next = resolveFileEditingSession(session, {
        cwd: CWD,
        relativePath: RELATIVE_PATH,
        contents,
        editorContents,
      });
      if (next !== session) {
        session = next;
        editorContents = next.document.contents;
      }
      document = session.document;
    } else {
      document = {
        name: RELATIVE_PATH,
        contents,
        cacheKey: projectFileCacheKey(CWD, RELATIVE_PATH, contents),
      };
    }
    documents.push(document);
    model.render(document, surfaceOptions({ commentFormOpen, onPostRender }));
  };

  model.onChange = (contents) => {
    editorContents = contents;
    store.optimistic = contents;
    saved.push(contents);
    render();
  };

  render();
  return {
    model,
    saved,
    documents,
    render,
    requestLineReveal: () => {
      onPostRender = () => {};
      render();
    },
    openCommentForm: () => {
      commentFormOpen = true;
      render();
    },
    writeExternally: (contents: string) => {
      store.disk = contents;
      store.optimistic = null;
      render();
    },
  };
}

describe("editable file surface", () => {
  it("accepts a run of keystrokes after a single click", () => {
    const surface = createSurface("session");
    surface.model.click();

    const typed = "hello continuous typing";
    for (const character of typed) surface.model.type(character);

    expect(surface.model.buffer).toBe(INITIAL_CONTENTS + typed);
    expect(surface.model.droppedKeystrokes).toBe(0);
    expect(surface.model.documentRebuilds).toBe(1);
    expect(new Set(surface.documents).size).toBe(1);
  });

  it("would drop every keystroke after the first if the live contents were fed back in", () => {
    // The shape of the original bug, kept as a guard on the model above: if the
    // file prop tracks the editor's own output, the editor rebuilds its
    // document on every change and the caret is gone by the next keystroke.
    const surface = createSurface("live-contents");
    surface.model.click();

    for (const character of "hello") surface.model.type(character);

    expect(surface.model.buffer).toBe(`${INITIAL_CONTENTS}h`);
    expect(surface.model.droppedKeystrokes).toBe(4);
  });

  it("still feeds every keystroke to the save buffer", () => {
    const surface = createSurface("session");
    surface.model.click();
    for (const character of "abc") surface.model.type(character);

    expect(surface.saved).toEqual([
      `${INITIAL_CONTENTS}a`,
      `${INITIAL_CONTENTS}ab`,
      `${INITIAL_CONTENTS}abc`,
    ]);
  });

  it("keeps the caret across a line reveal and an opened comment form", () => {
    const surface = createSurface("session");
    surface.model.click();
    surface.model.type("a");

    surface.requestLineReveal();
    expect(surface.model.renders).toBe(2);
    surface.openCommentForm();
    expect(surface.model.renders).toBe(3);

    // Both re-render the file — that is how the reveal scrolls and how the
    // gutter options change — but neither may cost the editor its document.
    expect(surface.model.documentRebuilds).toBe(1);
    expect(surface.model.hasCaret).toBe(true);

    surface.model.type("b");
    expect(surface.model.buffer).toBe(`${INITIAL_CONTENTS}ab`);
    expect(surface.model.droppedKeystrokes).toBe(0);
  });

  it("re-seeds the editor when the file changes underneath it", () => {
    const surface = createSurface("session");
    surface.model.click();
    surface.model.type("a");

    surface.writeExternally("rewritten by an agent\n");

    expect(surface.model.documentRebuilds).toBe(2);
    expect(surface.model.buffer).toBe("rewritten by an agent\n");
  });

  it("does not re-seed when a confirmed save clears the optimistic entry", () => {
    const surface = createSurface("session");
    surface.model.click();
    surface.model.type("a");

    // What `confirmProjectFileQueryData` leaves behind: the write landed, the
    // optimistic entry is dropped, and the query now returns the same bytes.
    surface.writeExternally(`${INITIAL_CONTENTS}a`);

    expect(surface.model.documentRebuilds).toBe(1);
    expect(surface.model.hasCaret).toBe(true);
  });
});
