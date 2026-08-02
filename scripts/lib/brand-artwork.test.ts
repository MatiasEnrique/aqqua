// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

import { BRAND_ASSET_PATHS } from "./brand-assets.ts";

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

const pathData = (svg: string): ReadonlyArray<string> =>
  [...svg.matchAll(/<(?:path|Path)\s+d="([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

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
