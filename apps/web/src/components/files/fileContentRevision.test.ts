import { describe, expect, it } from "vite-plus/test";

import {
  areFileCommentAnnotationsEqual,
  beginFileEditingSession,
  fileContentRevision,
  projectFileCacheKey,
  resolveFileEditingSession,
} from "./fileContentRevision";

describe("fileContentRevision", () => {
  it("changes for same-length edits", () => {
    expect(fileContentRevision("nodeVersion")).not.toBe(fileContentRevision("nodeVeasdrs"));
  });

  it("keeps identical contents stable", () => {
    expect(projectFileCacheKey("/repo", "file.json", "contents")).toBe(
      projectFileCacheKey("/repo", "file.json", "contents"),
    );
  });
});

const SEED = { cwd: "/repo", relativePath: "src/app.ts", contents: "const a = 1;\n" };

describe("file editing sessions", () => {
  it("seeds a document named for the file it edits", () => {
    const session = beginFileEditingSession(SEED);
    expect(session.document.name).toBe("src/app.ts");
    expect(session.document.contents).toBe(SEED.contents);
    expect(session.generation).toBe(0);
  });

  it("gives a re-seeded session a fresh key even when the contents did not change", () => {
    // The editor's own buffer has drifted away from the seed by then, so a
    // repeated key would leave it rendering its stale document.
    const first = beginFileEditingSession(SEED);
    const second = beginFileEditingSession(SEED, first);
    expect(second.document.cacheKey).not.toBe(first.document.cacheKey);
  });

  it("keeps the seeded document when the contents are the editor's own output", () => {
    const session = beginFileEditingSession(SEED);
    const typed = "const a = 12;\n";
    const resolved = resolveFileEditingSession(session, {
      ...SEED,
      contents: typed,
      editorContents: typed,
    });
    expect(resolved).toBe(session);
    expect(resolved.document.contents).toBe(SEED.contents);
  });

  it("re-seeds when someone else writes the file", () => {
    const session = beginFileEditingSession(SEED);
    const resolved = resolveFileEditingSession(session, {
      ...SEED,
      contents: "const a = 2;\n",
      editorContents: SEED.contents,
    });
    expect(resolved).not.toBe(session);
    expect(resolved.document.contents).toBe("const a = 2;\n");
    expect(resolved.generation).toBe(1);
  });

  it("re-seeds when an external write disagrees with unsaved local edits", () => {
    const session = beginFileEditingSession(SEED);
    const resolved = resolveFileEditingSession(session, {
      ...SEED,
      contents: "from disk\n",
      editorContents: "typed but not saved\n",
    });
    expect(resolved.document.contents).toBe("from disk\n");
  });

  it("starts a fresh session for a different file", () => {
    const session = beginFileEditingSession(SEED);
    const resolved = resolveFileEditingSession(session, {
      cwd: SEED.cwd,
      relativePath: "src/other.ts",
      contents: "other\n",
      editorContents: SEED.contents,
    });
    expect(resolved.generation).toBe(0);
    expect(resolved.document.name).toBe("src/other.ts");
  });
});

describe("areFileCommentAnnotationsEqual", () => {
  const annotations = [
    {
      lineNumber: 12,
      metadata: {
        entries: [{ id: "c1", kind: "comment", startLine: 10, endLine: 12, text: "Guard this." }],
      },
    },
  ];

  it("treats a freshly allocated but identical remap as unchanged", () => {
    expect(areFileCommentAnnotationsEqual(annotations, structuredClone(annotations))).toBe(true);
  });

  it("detects a moved anchor, an edited body, and added or removed entries", () => {
    const moved = structuredClone(annotations);
    moved[0]!.lineNumber = 13;
    expect(areFileCommentAnnotationsEqual(annotations, moved)).toBe(false);

    const edited = structuredClone(annotations);
    edited[0]!.metadata.entries[0]!.text = "Guard this harder.";
    expect(areFileCommentAnnotationsEqual(annotations, edited)).toBe(false);

    expect(areFileCommentAnnotationsEqual(annotations, [])).toBe(false);
    expect(
      areFileCommentAnnotationsEqual(annotations, [
        ...annotations,
        { lineNumber: 20, metadata: { entries: [] } },
      ]),
    ).toBe(false);
  });
});
