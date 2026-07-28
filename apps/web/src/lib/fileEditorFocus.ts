/**
 * Focus ownership for the workspace file editor, mirroring `terminalFocus`.
 *
 * The editable surface `@pierre/diffs` renders lives inside an *open* shadow
 * root under a `diffs-container` host, so from the page's point of view
 * `document.activeElement` is the host and never the element that actually
 * holds the caret. Descending one level into `shadowRoot.activeElement` and
 * looking for `data-content` — the attribute the library puts on the content
 * column it makes `contenteditable` when an editor attaches — is what
 * distinguishes "the user is typing into a file" from "a read-only file is on
 * screen".
 */
export function isFileEditorFocused(): boolean {
  if (typeof document === "undefined") return false;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;

  const host = activeElement.closest<HTMLElement>("diffs-container");
  const content = host?.shadowRoot?.activeElement;
  if (!(content instanceof HTMLElement)) return false;

  // `isContentEditable` keeps a read-only preview — which renders the same
  // `data-content` column but never attaches an editor — from claiming focus.
  return content.hasAttribute("data-content") && content.isContentEditable;
}
