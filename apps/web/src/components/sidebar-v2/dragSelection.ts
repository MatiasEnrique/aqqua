/**
 * Marquee ("rubber band") drag-selection geometry for the sidebar's settled
 * shelf, kept free of the DOM so the rules are testable on their own.
 *
 * The shelf is a vertical list of full-width rows, so a row is covered when
 * the band overlaps it vertically — the horizontal reach carries no meaning
 * and testing it would only make a sideways drag mysteriously select nothing.
 */

export interface DragPoint {
  readonly x: number;
  readonly y: number;
}

export interface DragBand {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface DragSelectableRow {
  readonly key: string;
  readonly top: number;
  readonly bottom: number;
}

/**
 * How far the pointer travels before a press becomes a drag. Below this a
 * press is still a click: opening a conversation must not depend on holding
 * the mouse perfectly still.
 */
export const DRAG_SELECT_THRESHOLD_PX = 4;

export function exceedsDragThreshold(origin: DragPoint, point: DragPoint): boolean {
  return (
    Math.abs(point.x - origin.x) >= DRAG_SELECT_THRESHOLD_PX ||
    Math.abs(point.y - origin.y) >= DRAG_SELECT_THRESHOLD_PX
  );
}

/** The band between press and pointer, normalised so either drag direction works. */
export function dragBand(origin: DragPoint, point: DragPoint): DragBand {
  return {
    top: Math.min(origin.y, point.y),
    bottom: Math.max(origin.y, point.y),
    left: Math.min(origin.x, point.x),
    right: Math.max(origin.x, point.x),
  };
}

export function rowsWithinBand(
  band: DragBand,
  rows: readonly DragSelectableRow[],
): readonly string[] {
  return rows.filter((row) => row.top < band.bottom && row.bottom > band.top).map((row) => row.key);
}
