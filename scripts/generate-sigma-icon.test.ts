// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

/** Replace this image and rerun `generate-sigma-icon` to change the Sigma icon. */
const SIGMA_SOURCE_PATH = "assets/sigma/sigma-source.png";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const readAsset = (relativePath: string): Buffer =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relativePath));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR is always the first chunk, so its fields sit at fixed offsets. */
function readPngHeader(png: Buffer) {
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colourType: png[25],
    interlace: png[28],
  };
}

describe("Sigma build icon assets", () => {
  // The renditions are committed, so these guard what a Sigma build actually
  // consumes: `sips`, `iconutil` and `magick` are handed these files and fail
  // the whole build on anything they cannot decode. The source image is
  // deliberately unconstrained beyond being a square PNG.
  it("ships a square non-interlaced PNG for the macOS icns source", () => {
    const png = readAsset(BRAND_ASSET_PATHS.sigmaMacIconPng);

    assert.isTrue(png.subarray(0, 8).equals(PNG_SIGNATURE));
    const header = readPngHeader(png);
    assert.equal(header.width, 1024);
    assert.equal(header.height, 1024);
    assert.equal(header.bitDepth, 8);
    assert.equal(header.interlace, 0);
  });

  it("derives every rendition from one committed source image", () => {
    const source = readAsset(SIGMA_SOURCE_PATH);

    assert.isTrue(source.subarray(0, 8).equals(PNG_SIGNATURE));
    const header = readPngHeader(source);
    assert.equal(header.width, header.height, "source must be square");
    assert.isAtLeast(header.width, 1024, "source must cover the largest rendition");
  });

  it("ships a full-bleed PNG for the Linux icon", () => {
    const png = readAsset(BRAND_ASSET_PATHS.sigmaLinuxIconPng);

    assert.isTrue(png.subarray(0, 8).equals(PNG_SIGNATURE));
    const header = readPngHeader(png);
    assert.equal(header.width, 1024);
    assert.equal(header.height, 1024);
    assert.equal(header.interlace, 0);
  });

  it("ships a 256px PNG-backed ico for Windows", () => {
    const ico = readAsset(BRAND_ASSET_PATHS.sigmaWindowsIconIco);

    assert.equal(ico.readUInt16LE(0), 0, "reserved");
    assert.equal(ico.readUInt16LE(2), 1, "type: icon");
    assert.equal(ico.readUInt16LE(4), 1, "image count");
    // 0 encodes 256 in an icon directory entry; electron-builder requires 256.
    assert.equal(ico[6], 0, "width");
    assert.equal(ico[7], 0, "height");

    const imageSize = ico.readUInt32LE(14);
    const imageOffset = ico.readUInt32LE(18);
    assert.equal(imageOffset, 22);
    assert.equal(imageOffset + imageSize, ico.length, "declared payload spans the file");

    const embedded = ico.subarray(imageOffset, imageOffset + imageSize);
    assert.isTrue(embedded.subarray(0, 8).equals(PNG_SIGNATURE));
    assert.equal(readPngHeader(embedded).width, 256);
  });

  it("does not reuse another channel's artwork", () => {
    const sigmaMac = readAsset(BRAND_ASSET_PATHS.sigmaMacIconPng);

    assert.isFalse(sigmaMac.equals(readAsset(BRAND_ASSET_PATHS.productionMacIconPng)));
    assert.isFalse(sigmaMac.equals(readAsset(BRAND_ASSET_PATHS.nightlyMacIconPng)));
    assert.isFalse(sigmaMac.equals(readAsset(BRAND_ASSET_PATHS.developmentDesktopIconPng)));
  });
});
