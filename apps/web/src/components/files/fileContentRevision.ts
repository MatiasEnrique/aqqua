import type { FileContents } from "@pierre/diffs";

export function fileContentRevision(contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Content-derived cache key for a read-only `<File>` surface, where every
 * distinct byte sequence really is a distinct document.
 *
 * Do not use this for the editable surface: while the editor is attached it
 * owns the buffer, so hashing the live contents makes the key change on every
 * keystroke, which is one half of the feedback loop that used to make the
 * editor drop everything typed after the first character. Editable surfaces use
 * {@link beginFileEditingSession} instead.
 */
export function projectFileCacheKey(cwd: string, relativePath: string, contents: string): string {
  return `${cwd}:${relativePath}:${fileContentRevision(contents)}`;
}

/**
 * An editing session: the immutable document we seed the editor with, plus the
 * identity of what is being edited.
 *
 * `document` is the object handed to `<File>`, and it must stay referentially
 * and byte-stable for as long as the editor holds the buffer. `@pierre/diffs`
 * throws away its `TextDocument` (and with it the caret, the selection and the
 * undo stack) whenever the `name`/`contents`/`lang`/`cacheKey` it was attached
 * with stop matching the props, so any churn here is a dropped keystroke.
 */
export interface FileEditingSession {
  readonly cwd: string;
  readonly relativePath: string;
  /** Bumped on every re-seed so the seeded document always gets a fresh key. */
  readonly generation: number;
  readonly document: FileContents;
}

export interface FileEditingSessionSeed {
  readonly cwd: string;
  readonly relativePath: string;
  readonly contents: string;
}

export interface FileEditingSessionInput extends FileEditingSessionSeed {
  /**
   * The contents the attached editor last emitted, or the seeded contents when
   * nothing has been typed yet. This is what tells local echo apart from an
   * external change.
   */
  readonly editorContents: string;
}

export function beginFileEditingSession(
  seed: FileEditingSessionSeed,
  previous?: FileEditingSession,
): FileEditingSession {
  const generation =
    previous !== undefined &&
    previous.cwd === seed.cwd &&
    previous.relativePath === seed.relativePath
      ? previous.generation + 1
      : 0;
  return {
    cwd: seed.cwd,
    relativePath: seed.relativePath,
    generation,
    document: {
      name: seed.relativePath,
      contents: seed.contents,
      // Deliberately keyed on the session rather than only on the contents: a
      // re-seed that happens to restore byte-identical contents still has to
      // look like a new document, because the editor's own buffer has drifted
      // away from it and only a key change makes the editor re-read the seed.
      cacheKey: `${seed.cwd}:${seed.relativePath}@${generation}:${fileContentRevision(seed.contents)}`,
    },
  };
}

/**
 * Decide what the editable surface should render this pass.
 *
 * Returns the same session — same `document` object — whenever the incoming
 * contents are just the editor's own output coming back around through the
 * optimistic store. Only a genuinely different document (another path, or an
 * external write/reload that disagrees with the editor's buffer) re-seeds.
 */
export function resolveFileEditingSession(
  session: FileEditingSession,
  input: FileEditingSessionInput,
): FileEditingSession {
  if (session.cwd !== input.cwd || session.relativePath !== input.relativePath) {
    return beginFileEditingSession(input);
  }
  if (input.contents === input.editorContents) return session;
  return beginFileEditingSession(input, session);
}

interface CommentAnnotationEntryShape {
  readonly id: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

interface CommentLineAnnotationShape {
  readonly lineNumber: number;
  readonly metadata: { readonly entries: ReadonlyArray<CommentAnnotationEntryShape> };
}

/**
 * Structural comparison for the comment annotations handed to `<File>`.
 *
 * The editor hands its line annotations back on every change, and remapping
 * them always allocates. Feeding that fresh array straight into state makes
 * `File.render` see `annotationsChanged` on every keystroke and rebuild the
 * document, so we keep the previous array whenever nothing actually moved.
 */
export function areFileCommentAnnotationsEqual(
  a: ReadonlyArray<CommentLineAnnotationShape>,
  b: ReadonlyArray<CommentLineAnnotationShape>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((annotation, index) => {
    const other = b[index];
    if (other === undefined || other.lineNumber !== annotation.lineNumber) return false;
    const entries = annotation.metadata.entries;
    const otherEntries = other.metadata.entries;
    if (entries.length !== otherEntries.length) return false;
    return entries.every((entry, entryIndex) => {
      const otherEntry = otherEntries[entryIndex];
      return (
        otherEntry !== undefined &&
        otherEntry.id === entry.id &&
        otherEntry.kind === entry.kind &&
        otherEntry.startLine === entry.startLine &&
        otherEntry.endLine === entry.endLine &&
        otherEntry.text === entry.text
      );
    });
  });
}
