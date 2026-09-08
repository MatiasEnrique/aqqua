import { describe, expect, it } from "vite-plus/test";

import {
  DRAG_SELECT_THRESHOLD_PX,
  dragBand,
  exceedsDragThreshold,
  rowsWithinBand,
} from "./dragSelection";

const ROWS = [
  { key: "row-a", top: 0, bottom: 32 },
  { key: "row-b", top: 32, bottom: 64 },
  { key: "row-c", top: 64, bottom: 96 },
] as const;

describe("exceedsDragThreshold", () => {
  it("keeps a small wobble a click, so opening a conversation tolerates an unsteady hand", () => {
    const origin = { x: 100, y: 100 };

    expect(exceedsDragThreshold(origin, { x: 100, y: 100 })).toBe(false);
    expect(
      exceedsDragThreshold(origin, {
        x: 100 + DRAG_SELECT_THRESHOLD_PX - 1,
        y: 100 + DRAG_SELECT_THRESHOLD_PX - 1,
      }),
    ).toBe(false);
  });

  it("counts travel on either axis, so a purely sideways drag still starts a marquee", () => {
    const origin = { x: 100, y: 100 };

    expect(exceedsDragThreshold(origin, { x: 100 + DRAG_SELECT_THRESHOLD_PX, y: 100 })).toBe(true);
    expect(exceedsDragThreshold(origin, { x: 100, y: 100 - DRAG_SELECT_THRESHOLD_PX })).toBe(true);
  });
});

describe("dragBand", () => {
  it("normalises the band so dragging up covers the same rows as dragging down", () => {
    const downwards = dragBand({ x: 10, y: 20 }, { x: 40, y: 80 });
    const upwards = dragBand({ x: 40, y: 80 }, { x: 10, y: 20 });

    expect(downwards).toEqual({ top: 20, bottom: 80, left: 10, right: 40 });
    expect(upwards).toEqual(downwards);
  });
});

describe("rowsWithinBand", () => {
  it("covers every row the band touches, in list order", () => {
    const band = dragBand({ x: 0, y: 20 }, { x: 100, y: 70 });

    expect(rowsWithinBand(band, ROWS)).toEqual(["row-a", "row-b", "row-c"]);
  });

  it("ignores rows the band only reaches to the edge of, so a row is never half-selected", () => {
    const band = dragBand({ x: 0, y: 32 }, { x: 100, y: 64 });

    expect(rowsWithinBand(band, ROWS)).toEqual(["row-b"]);
  });

  it("covers the row a flat band lies inside, so a horizontal drag picks up where it began", () => {
    const band = dragBand({ x: 0, y: 40 }, { x: 100, y: 40 });

    expect(rowsWithinBand(band, ROWS)).toEqual(["row-b"]);
  });

  it("covers nothing when the band sits clear of every row", () => {
    const band = dragBand({ x: 0, y: 120 }, { x: 100, y: 160 });

    expect(rowsWithinBand(band, ROWS)).toEqual([]);
  });

  it("selects by vertical reach alone: a sideways drag past the list still catches its rows", () => {
    const band = dragBand({ x: 0, y: 10 }, { x: 9_000, y: 20 });

    expect(rowsWithinBand(band, ROWS)).toEqual(["row-a"]);
  });
});
