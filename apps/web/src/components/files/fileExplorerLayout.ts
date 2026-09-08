export const FILE_EXPLORER_REPLACE_MAX_WIDTH = 560;

export function shouldReplaceExplorerWithFile(panelWidth: number): boolean {
  return panelWidth <= FILE_EXPLORER_REPLACE_MAX_WIDTH;
}
