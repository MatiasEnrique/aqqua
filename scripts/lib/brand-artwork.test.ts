// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { PNG } from "pngjs";
import sharp from "sharp";

import { applyRoundedIconCorners } from "../export-brand-icons.ts";
import { BRAND_ASSET_PATHS } from "./brand-assets.ts";
import { WINDOWS_ICON_SIZES } from "./icon-export.ts";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

const read = (relativePath: string): Buffer =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relativePath));

const readText = (relativePath: string): string => read(relativePath).toString("utf8");

const readPngDimensions = (relativePath: string) => {
  const contents = read(relativePath);
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
};

const readIcoSizes = (relativePath: string): ReadonlyArray<number> => {
  const contents = read(relativePath);
  const imageCount = contents.readUInt16LE(4);
  return Array.from({ length: imageCount }, (_, index) => {
    const encodedSize = contents.readUInt8(6 + index * 16);
    return encodedSize === 0 ? 256 : encodedSize;
  });
};

const readIcoPngs = (relativePath: string): ReadonlyArray<Buffer> => {
  const contents = read(relativePath);
  const imageCount = contents.readUInt16LE(4);
  return Array.from({ length: imageCount }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const imageSize = contents.readUInt32LE(entryOffset + 8);
    const imageOffset = contents.readUInt32LE(entryOffset + 12);
    return contents.subarray(imageOffset, imageOffset + imageSize);
  });
};

const pathData = (svg: string): ReadonlyArray<string> =>
  [...svg.matchAll(/<(?:path|Path)\s+d="([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const pixelAt = (contents: Buffer, width: number, x: number, y: number) => {
  const offset = (y * width + x) * 4;
  return {
    red: contents[offset],
    green: contents[offset + 1],
    blue: contents[offset + 2],
    alpha: contents[offset + 3],
  };
};

describe("aqqua brand artwork", () => {
  it("uses the sidebar Waves geometry as the canonical mark", () => {
    const canonical = readText("assets/aqqua-waves.svg");
    const sidebar = readText("apps/web/public/aqqua-crest.svg");
    const mobile = readText("apps/mobile/src/components/AqquaMark.tsx");

    assert.deepEqual(pathData(canonical), pathData(sidebar));
    assert.deepEqual(pathData(canonical), pathData(mobile));
    assert.include(canonical, 'viewBox="55 915 340 105"');
    assert.include(canonical, 'fill="currentColor"');
  });

  it("keeps every Icon Composer project on the canonical Waves artwork", () => {
    const canonical = read(BRAND_ASSET_PATHS.brandLogoPng);
    const copies = [
      "assets/dev/app-icon.icon/Assets/logo.png",
      "assets/nightly/app-icon.icon/Assets/logo.png",
      "assets/prod/app-icon.icon/Assets/logo.png",
    ];

    for (const relativePath of copies) {
      assert.isTrue(canonical.equals(read(relativePath)), relativePath);
    }
  });

  it("uses the same white plate in every Icon Composer project", () => {
    const production = read("assets/prod/app-icon.icon/icon.json");
    assert.isTrue(production.equals(read("assets/dev/app-icon.icon/icon.json")));
    assert.isTrue(production.equals(read("assets/nightly/app-icon.icon/icon.json")));
  });

  it("keeps every mobile variant on the white platform-shaped icon", () => {
    const config = readText("apps/mobile/app.config.ts");
    assert.lengthOf(config.match(/androidAdaptiveBackgroundColor: "#FFFFFF"/g) ?? [], 3);
    assert.lengthOf(
      config.match(/androidAdaptiveForeground: "\.\/assets\/android-icon-mark\.png"/g) ?? [],
      3,
    );
  });

  it("ships opaque white iOS source icons for the native platform mask", () => {
    const production = read(BRAND_ASSET_PATHS.productionIosIconPng);
    for (const relativePath of [
      BRAND_ASSET_PATHS.developmentIosIconPng,
      BRAND_ASSET_PATHS.nightlyIosIconPng,
      BRAND_ASSET_PATHS.productionIosIconPng,
    ]) {
      assert.isTrue(production.equals(read(relativePath)), relativePath);
      const image = PNG.sync.read(read(relativePath));
      const corner = pixelAt(image.data, image.width, 0, 0);
      assert.deepEqual(corner, { red: 255, green: 255, blue: 255, alpha: 255 }, relativePath);
    }
  });

  it("uses the same native white macOS plate in every release channel", () => {
    const production = read(BRAND_ASSET_PATHS.productionMacIconPng);
    assert.isTrue(production.equals(read(BRAND_ASSET_PATHS.developmentDesktopIconPng)));
    assert.isTrue(production.equals(read(BRAND_ASSET_PATHS.nightlyMacIconPng)));
  });

  it("ships white icon plates with transparent rounded corners", () => {
    for (const relativePath of [
      BRAND_ASSET_PATHS.developmentUniversalIconPng,
      BRAND_ASSET_PATHS.developmentDesktopIconPng,
      BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      BRAND_ASSET_PATHS.nightlyMacIconPng,
      BRAND_ASSET_PATHS.productionLinuxIconPng,
      BRAND_ASSET_PATHS.productionMacIconPng,
      BRAND_ASSET_PATHS.sigmaLinuxIconPng,
      "apps/desktop/resources/icon.png",
      "apps/mobile/assets/widget/AqquaMark.png",
      "apps/web/public/apple-touch-icon.png",
      "apps/marketing/public/apple-touch-icon.png",
      "apps/marketing/public/icon.png",
    ]) {
      const image = PNG.sync.read(read(relativePath));
      const corner = pixelAt(image.data, image.width, 0, 0);
      const plate = pixelAt(
        image.data,
        image.width,
        Math.floor(image.width / 2),
        Math.floor(image.height * 0.11),
      );

      assert.equal(corner.alpha, 0, `${relativePath} has square corners`);
      assert.isAtLeast(plate.alpha ?? 0, 250, `${relativePath} plate is transparent`);
      assert.isAtLeast(plate.red ?? 0, 250, `${relativePath} plate is not white`);
      assert.isAtLeast(plate.green ?? 0, 250, `${relativePath} plate is not white`);
      assert.isAtLeast(plate.blue ?? 0, 250, `${relativePath} plate is not white`);
    }
  });

  it("keeps every Windows and browser ICO rendition rounded", () => {
    for (const relativePath of [
      BRAND_ASSET_PATHS.developmentWebFaviconIco,
      BRAND_ASSET_PATHS.developmentWindowsIconIco,
      BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      BRAND_ASSET_PATHS.nightlyWindowsIconIco,
      BRAND_ASSET_PATHS.productionWebFaviconIco,
      BRAND_ASSET_PATHS.productionWindowsIconIco,
      BRAND_ASSET_PATHS.sigmaWindowsIconIco,
      "apps/desktop/resources/icon.ico",
      "apps/web/public/favicon.ico",
      "apps/marketing/public/favicon.ico",
    ]) {
      for (const png of readIcoPngs(relativePath)) {
        const image = PNG.sync.read(png);
        const corner = pixelAt(image.data, image.width, 0, 0);
        assert.equal(corner.alpha, 0, `${relativePath} has a square rendition`);
      }
    }
  });

  it("derives every rounded size from the native 1024px iOS source", async () => {
    const source = read(BRAND_ASSET_PATHS.productionIosIconPng);
    const expectedBySize = new Map<number, Buffer>();
    for (const size of [...WINDOWS_ICON_SIZES, 180, 1024]) {
      const square =
        size === 1024 ? source : await sharp(source).resize(size, size).png().toBuffer();
      expectedBySize.set(size, applyRoundedIconCorners(square, size));
    }

    assert.isTrue(expectedBySize.get(1024)?.equals(read(BRAND_ASSET_PATHS.productionLinuxIconPng)));
    assert.isTrue(
      expectedBySize.get(180)?.equals(read(BRAND_ASSET_PATHS.productionWebAppleTouchIconPng)),
    );
    assert.isTrue(
      expectedBySize.get(16)?.equals(read(BRAND_ASSET_PATHS.productionWebFavicon16Png)),
    );
    assert.isTrue(
      expectedBySize.get(32)?.equals(read(BRAND_ASSET_PATHS.productionWebFavicon32Png)),
    );

    const icoPngs = readIcoPngs(BRAND_ASSET_PATHS.productionWindowsIconIco);
    for (const [index, size] of WINDOWS_ICON_SIZES.entries()) {
      const actual = icoPngs[index];
      if (actual === undefined) assert.fail(`missing ${size}px ICO rendition`);
      assert.isTrue(expectedBySize.get(size)?.equals(actual));
    }
  });

  it("ships correctly sized desktop, mobile, and browser renditions", () => {
    for (const relativePath of [
      BRAND_ASSET_PATHS.developmentIosIconPng,
      BRAND_ASSET_PATHS.developmentUniversalIconPng,
      BRAND_ASSET_PATHS.developmentDesktopIconPng,
      BRAND_ASSET_PATHS.nightlyIosIconPng,
      BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      BRAND_ASSET_PATHS.nightlyMacIconPng,
      BRAND_ASSET_PATHS.productionIosIconPng,
      BRAND_ASSET_PATHS.productionLinuxIconPng,
      BRAND_ASSET_PATHS.productionMacIconPng,
    ]) {
      assert.deepEqual(readPngDimensions(relativePath), { width: 1024, height: 1024 });
    }
    assert.deepEqual(readPngDimensions("apps/desktop/resources/icon.png"), {
      width: 512,
      height: 512,
    });
    assert.deepEqual(readPngDimensions("apps/mobile/assets/android-icon-mark.png"), {
      width: 432,
      height: 432,
    });
    assert.deepEqual(readPngDimensions("apps/mobile/assets/android-notification-icon.png"), {
      width: 96,
      height: 96,
    });
    assert.deepEqual(readPngDimensions("apps/web/public/apple-touch-icon.png"), {
      width: 180,
      height: 180,
    });
  });

  it("keeps checked-in consumer copies synchronized with their channel", () => {
    const copies = [
      [BRAND_ASSET_PATHS.developmentWebFaviconIco, "apps/web/public/favicon.ico"],
      [BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng, "apps/web/public/apple-touch-icon.png"],
      [BRAND_ASSET_PATHS.productionWebFaviconIco, "apps/marketing/public/favicon.ico"],
      [
        BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        "apps/marketing/public/apple-touch-icon.png",
      ],
      [BRAND_ASSET_PATHS.productionLinuxIconPng, "apps/marketing/public/icon.png"],
      [BRAND_ASSET_PATHS.productionWindowsIconIco, "apps/desktop/resources/icon.ico"],
    ] as const;

    for (const [source, consumer] of copies) {
      assert.isTrue(read(source).equals(read(consumer)), `${consumer} is stale`);
    }
  });

  it("ships every required Windows and browser ICO rendition", () => {
    const expectedSizes = [16, 24, 32, 48, 64, 128, 256];
    for (const relativePath of [
      BRAND_ASSET_PATHS.developmentWebFaviconIco,
      BRAND_ASSET_PATHS.developmentWindowsIconIco,
      BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      BRAND_ASSET_PATHS.nightlyWindowsIconIco,
      BRAND_ASSET_PATHS.productionWebFaviconIco,
      BRAND_ASSET_PATHS.productionWindowsIconIco,
      "apps/desktop/resources/icon.ico",
      "apps/web/public/favicon.ico",
      "apps/marketing/public/favicon.ico",
    ]) {
      assert.deepEqual(readIcoSizes(relativePath), expectedSizes, relativePath);
    }
  });
});
