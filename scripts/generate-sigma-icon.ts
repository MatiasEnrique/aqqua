#!/usr/bin/env node

/**
 * generate-sigma-icon - Draw the app icon for Sigma desktop builds.
 *
 * A Sigma build sits in the Dock beside the release it was built from, so it
 * cannot wear the same artwork: with identical icons there is no way to tell
 * which tile or window belongs to which app. The other channels export designed
 * artwork from Icon Composer projects (see `export-brand-icons`); this one is
 * drawn here, because it only has to be unmistakable, not pretty, and a
 * self-built channel should not need design tooling installed to produce it.
 *
 * The PNG encoder is local because nothing else in the repo rasterizes from
 * scratch — a non-interlaced RGBA PNG is a header, a zlib stream and three
 * CRCs. The `.ico` goes through the same `encodePngIco` the designed channels
 * use.
 *
 * Run `node scripts/generate-sigma-icon.ts` after changing it and commit the
 * regenerated files in `assets/sigma/`; the output is byte-reproducible.
 *
 * @module generate-sigma-icon
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Command } from "effect/unstable/cli";
import * as NodeZlib from "node:zlib";

import { encodePngIco } from "./lib/icon-export.ts";

const OUTPUT_DIR_SEGMENTS = ["assets", "sigma"] as const;

/** Violet reads as neither the production black nor the nightly artwork. */
const BACKGROUND: RGB = [124, 58, 237];
const GLYPH: RGB = [255, 255, 255];
/** Samples per pixel axis. 2 is enough to keep the diagonals from stair-stepping. */
const SUPERSAMPLE = 2;
const WINDOWS_ICON_SIZE = 256;

type RGB = readonly [number, number, number];

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly halfWidth: number;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode straight RGBA pixels as a non-interlaced, filter-0 PNG, which is what
    `sips` and `magick` downscale from during a desktop build. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // per-scanline filter type
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", NodeZlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function distanceToSegment(px: number, py: number, segment: Segment): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - segment.x1) * dx + (py - segment.y1) * dy) / lengthSquared));
  const cx = segment.x1 + t * dx;
  const cy = segment.y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Whether a point falls inside a rounded rectangle. */
function insideRoundedRect(
  px: number,
  py: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): boolean {
  const cx = Math.max(left + radius, Math.min(right - radius, px));
  const cy = Math.max(top + radius, Math.min(bottom - radius, py));
  if (px >= left + radius && px <= right - radius) return py >= top && py <= bottom;
  if (py >= top + radius && py <= bottom - radius) return px >= left && px <= right;
  return Math.hypot(px - cx, py - cy) <= radius;
}

/**
 * A `>_` prompt on a violet field: a shell mark for a build that only exists on
 * the machine that made it. `padding` insets the plate so macOS gets the shape
 * it expects; full-bleed output (Linux, Windows) passes 0.
 */
function drawIcon(size: number, padding: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const left = padding;
  const top = padding;
  const right = size - padding;
  const bottom = size - padding;
  const plateRadius = (right - left) * (padding === 0 ? 0 : 0.22);

  const unit = size / 32;
  const centreX = size / 2;
  const centreY = size / 2;
  const chevronHalf = unit * 4;
  const strokeHalf = unit * 1.5;
  const chevronX = centreX - unit * 4.5;
  const strokes: readonly Segment[] = [
    {
      x1: chevronX,
      y1: centreY - chevronHalf,
      x2: chevronX + chevronHalf,
      y2: centreY,
      halfWidth: strokeHalf,
    },
    {
      x1: chevronX + chevronHalf,
      y1: centreY,
      x2: chevronX,
      y2: centreY + chevronHalf,
      halfWidth: strokeHalf,
    },
    {
      x1: centreX + unit * 2,
      y1: centreY + chevronHalf,
      x2: centreX + unit * 8,
      y2: centreY + chevronHalf,
      halfWidth: strokeHalf,
    },
  ];

  const step = 1 / SUPERSAMPLE;
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plateHits = 0;
      let glyphHits = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (!insideRoundedRect(px, py, left, top, right, bottom, plateRadius)) {
            continue;
          }
          plateHits += 1;
          if (strokes.some((stroke) => distanceToSegment(px, py, stroke) <= stroke.halfWidth)) {
            glyphHits += 1;
          }
        }
      }

      const offset = (y * size + x) * 4;
      if (plateHits === 0) {
        continue;
      }

      const glyphRatio = glyphHits / plateHits;
      const [br, bg, bb] = BACKGROUND;
      const [gr, gg, gb] = GLYPH;
      rgba[offset] = Math.round(br + (gr - br) * glyphRatio);
      rgba[offset + 1] = Math.round(bg + (gg - bg) * glyphRatio);
      rgba[offset + 2] = Math.round(bb + (gb - bb) * glyphRatio);
      rgba[offset + 3] = Math.round((plateHits / samplesPerPixel) * 255);
    }
  }

  return rgba;
}

const generateSigmaIcon = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const outputDir = path.join(repoRoot, ...OUTPUT_DIR_SEGMENTS);

  yield* fileSystem.makeDirectory(outputDir, { recursive: true });

  const windowsPng = encodePng(
    WINDOWS_ICON_SIZE,
    WINDOWS_ICON_SIZE,
    drawIcon(WINDOWS_ICON_SIZE, 0),
  );
  const artifacts = [
    // macOS art carries its own inset and rounding; the icns is built from this.
    {
      name: "sigma-macos-1024.png",
      contents: encodePng(1024, 1024, drawIcon(1024, Math.round(1024 * 0.09))),
    },
    // Linux tiles the full square.
    { name: "sigma-universal-1024.png", contents: encodePng(1024, 1024, drawIcon(1024, 0)) },
    {
      name: "sigma-windows.ico",
      contents: encodePngIco([{ size: WINDOWS_ICON_SIZE, contents: windowsPng }]),
    },
  ] as const;

  for (const artifact of artifacts) {
    yield* fileSystem.writeFile(path.join(outputDir, artifact.name), artifact.contents);
    yield* Console.log(
      `${OUTPUT_DIR_SEGMENTS.join("/")}/${artifact.name} (${artifact.contents.length} bytes)`,
    );
  }
});

const generateSigmaIconCommand = Command.make(
  "generate-sigma-icon",
  {},
  () => generateSigmaIcon,
).pipe(Command.withDescription("Draw the app icon assets for Sigma desktop builds."));

if (import.meta.main) {
  Command.run(generateSigmaIconCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
