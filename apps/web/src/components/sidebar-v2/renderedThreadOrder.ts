/** Read the displayed row order when a shortcut or range selection is invoked. */
export function resolveRenderedSidebarThreadKeys(input: {
  readonly conversationListPresent: boolean;
  readonly renderedKeys: readonly string[];
  readonly fallback: readonly string[];
}): readonly string[] {
  return input.conversationListPresent ? input.renderedKeys : input.fallback;
}

export function readRenderedSidebarThreadKeys(fallback: readonly string[]): readonly string[] {
  const sidebar = document.querySelector("[data-app-sidebar]");
  if (!sidebar) return fallback;
  const conversationList = sidebar.querySelector("[data-sidebar-thread-list]");
  const renderedKeys =
    conversationList === null
      ? []
      : Array.from(
          conversationList.querySelectorAll<HTMLElement>("[data-sidebar-thread-key]"),
          (row) => row.dataset.sidebarThreadKey,
        ).filter((key) => key !== undefined);
  return resolveRenderedSidebarThreadKeys({
    conversationListPresent: conversationList !== null,
    renderedKeys,
    fallback,
  });
}
