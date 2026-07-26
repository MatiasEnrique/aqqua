/**
 * generate-sigma-icon - Draw the app icon for Sigma desktop builds.
 *
 * A Sigma build sits in the Dock beside the release it was built from, so it
 * cannot wear the same artwork: with identical icons there is no way to tell
 * which tile or window belongs to which app. The other channels ship designed
 * artwork under `assets/`; this one is generated, because it only has to be
 * unmistakable, not pretty.
 *
 * Everything is rasterized here rather than pulled from a dependency: encoding a
 * non-interlaced RGBA PNG is a header, a zlib stream and three CRCs, and a
 * Vista-era `.ico` is a 22-byte header wrapped around a PNG. Committing the
 * generator alongside its output keeps the artwork reviewable and reproducible.
 *
 * Run `node scripts/generate-sigma-icon.ts` after changing it, and commit the
 * regenerated files in `assets/sigma/`.
 *
 * @module generate-sigma-icon
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

const OUTPUT_DIR_NAME = NodePath.join("assets", "sigma");

/** Violet reads as neither the production black nor the nightly artwork. */
const BACKGROUND: RGB = [124, 58, 237];
const GLYPH: RGB = [255, 255, 255];
/** Samples per pixel axis. 2 is enough to keep the diagonals from stair-stepping. */
const SUPERSAMPLE = 2;

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
    `sips` and `magick` downscale from in the build. */
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

/** Wrap a PNG in a single-image `.ico`. Windows has read PNG-backed icons since
    Vista, and electron-builder only requires the 256px entry. */
function encodeIco(png: Buffer, size: number): Buffer {
  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(1, 4); // image count
  directory[6] = size >= 256 ? 0 : size; // 0 encodes 256
  directory[7] = size >= 256 ? 0 : size;
  directory[8] = 0; // palette size
  directory[9] = 0; // reserved
  directory.writeUInt16LE(1, 10); // colour planes
  directory.writeUInt16LE(32, 12); // bits per pixel
  directory.writeUInt32LE(png.length, 14);
  directory.writeUInt32LE(directory.length, 18);
  return Buffer.concat([directory, png]);
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
 * the machine that made it. `padding` insets the plate so macOS gets the shape it
 * expects; full-bleed output (Linux, Windows) passes 0.
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

function main(): void {
  const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const outputDir = NodePath.join(repoRoot, OUTPUT_DIR_NAME);
  NodeFS.mkdirSync(outputDir, { recursive: true });

  // macOS art carries its own inset and rounding; the icns is built from this.
  const macPng = encodePng(1024, 1024, drawIcon(1024, Math.round(1024 * 0.09)));
  // Linux and Windows tile the full square.
  const universalPng = encodePng(1024, 1024, drawIcon(1024, 0));
  const windowsPng = encodePng(256, 256, drawIcon(256, 0));

  const written: Array<readonly [string, Buffer]> = [
    ["sigma-macos-1024.png", macPng],
    ["sigma-universal-1024.png", universalPng],
    ["sigma-windows.ico", encodeIco(windowsPng, 256)],
  ];

  for (const [name, contents] of written) {
    const target = NodePath.join(outputDir, name);
    NodeFS.writeFileSync(target, contents);
    console.log(`${NodePath.join(OUTPUT_DIR_NAME, name)} (${contents.length} bytes)`);
  }
}

main();
