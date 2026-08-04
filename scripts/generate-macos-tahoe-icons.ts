#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - This host-side asset generator drives native macOS icon tools directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const swiftRendererPath = NodePath.join(repoRoot, "scripts/render-macos-tahoe-icon.swift");
const iconSizes = [16, 32, 128, 256, 512] as const;

const variants = [
  {
    label: "preview",
    icnsSource: BRAND_ASSET_PATHS.previewMacIconPng,
    output: BRAND_ASSET_PATHS.previewMacDockIconPng,
  },
  {
    label: "development",
    icnsSource: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    output: BRAND_ASSET_PATHS.developmentMacDockIconPng,
  },
  {
    label: "production",
    icnsSource: BRAND_ASSET_PATHS.productionMacIconPng,
    output: BRAND_ASSET_PATHS.productionMacDockIconPng,
  },
  {
    label: "sigma",
    icnsSource: BRAND_ASSET_PATHS.sigmaMacIconPng,
    output: BRAND_ASSET_PATHS.sigmaMacDockIconPng,
  },
] as const;

const plist = (
  bundleIdentifier: string,
  executableName: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>${executableName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`;

async function writeIconset(sourcePath: string, iconsetPath: string): Promise<void> {
  await NodeFSP.mkdir(iconsetPath, { recursive: true });
  for (const size of iconSizes) {
    await sharp(sourcePath)
      .resize(size, size)
      .png()
      .toFile(NodePath.join(iconsetPath, `icon_${size}x${size}.png`));
    await sharp(sourcePath)
      .resize(size * 2, size * 2)
      .png()
      .toFile(NodePath.join(iconsetPath, `icon_${size}x${size}@2x.png`));
  }
}

async function validateTahoeGeometry(outputPath: string): Promise<void> {
  const { data, info } = await sharp(outputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 1024 || info.height !== 1024) {
    throw new Error(`Tahoe rendered ${info.width}x${info.height}; expected 1024x1024.`);
  }

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  const spans = new Map<number, readonly [number, number]>();
  for (let y = 0; y < info.height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < info.width; x += 1) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) <= 127) continue;
      if (left === -1) left = x;
      right = x;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (left !== -1) spans.set(y, [left, right]);
  }

  const actual = JSON.stringify({
    minX,
    minY,
    maxX,
    maxY,
    rows: [spans.get(100), spans.get(120), spans.get(220), spans.get(511)],
  });
  const expected = JSON.stringify({
    minX: 100,
    minY: 100,
    maxX: 923,
    maxY: 923,
    rows: [
      [351, 672],
      [225, 798],
      [122, 901],
      [100, 923],
    ],
  });
  if (actual !== expected) {
    throw new Error(`The native render does not match the macOS Tahoe mask: ${actual}`);
  }
}

async function renderVariant(
  temporaryRoot: string,
  variant: (typeof variants)[number],
): Promise<void> {
  const sourcePath = NodePath.join(repoRoot, variant.icnsSource);
  const outputPath = NodePath.join(repoRoot, variant.output);
  const sourceHash = await hashFile(sourcePath);
  const executableName = `AqquaIconRenderer-${variant.label}`;
  const appPath = NodePath.join(temporaryRoot, `${executableName}.app`);
  const contentsPath = NodePath.join(appPath, "Contents");
  const macOsPath = NodePath.join(contentsPath, "MacOS");
  const resourcesPath = NodePath.join(contentsPath, "Resources");
  const iconsetPath = NodePath.join(temporaryRoot, `${variant.label}.iconset`);
  const icnsPath = NodePath.join(resourcesPath, "AppIcon.icns");
  const executablePath = NodePath.join(macOsPath, executableName);

  await Promise.all([
    NodeFSP.mkdir(macOsPath, { recursive: true }),
    NodeFSP.mkdir(resourcesPath, { recursive: true }),
    NodeFSP.mkdir(NodePath.dirname(outputPath), { recursive: true }),
  ]);
  await writeIconset(sourcePath, iconsetPath);
  await execFile("iconutil", ["-c", "icns", iconsetPath, "-o", icnsPath]);
  await NodeFSP.writeFile(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await NodeFSP.writeFile(
    NodePath.join(contentsPath, "Info.plist"),
    plist(`codes.aqqua.icon-renderer.${variant.label}.v${sourceHash}`, executableName),
  );
  await execFile("swift", [swiftRendererPath, appPath, outputPath]);
  await validateTahoeGeometry(outputPath);
  NodeProcess.stdout.write(`${variant.output}\n`);
}

async function hashFile(path: string): Promise<string> {
  return NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(path))
    .digest("hex")
    .slice(0, 12);
}

async function main(): Promise<void> {
  if (NodeProcess.platform !== "darwin") {
    throw new Error("Tahoe Dock icons can only be rendered on macOS.");
  }
  const { stdout } = await execFile("sw_vers", ["-productVersion"]);
  const majorVersion = Number.parseInt(stdout.trim().split(".")[0] ?? "", 10);
  if (!Number.isFinite(majorVersion) || majorVersion < 26) {
    throw new Error(`macOS Tahoe 26 or newer is required; found ${stdout.trim()}.`);
  }

  const temporaryRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "aqqua-tahoe-icons-"));
  try {
    const outputBySourceHash = new Map<string, string>();
    for (const variant of variants) {
      const sourceHash = await hashFile(NodePath.join(repoRoot, variant.icnsSource));
      const existingOutput = outputBySourceHash.get(sourceHash);
      if (existingOutput === undefined) {
        await renderVariant(temporaryRoot, variant);
        outputBySourceHash.set(sourceHash, NodePath.join(repoRoot, variant.output));
      } else {
        const outputPath = NodePath.join(repoRoot, variant.output);
        await NodeFSP.copyFile(existingOutput, outputPath);
        await validateTahoeGeometry(outputPath);
        NodeProcess.stdout.write(`${variant.output}\n`);
      }
    }
  } finally {
    await NodeFSP.rm(temporaryRoot, { recursive: true, force: true });
  }

  const productionDockIcon = NodePath.join(repoRoot, BRAND_ASSET_PATHS.productionMacDockIconPng);
  await sharp(productionDockIcon)
    .resize(512, 512)
    .png()
    .toFile(NodePath.join(repoRoot, "apps/desktop/resources/icon.png"));
}

if (import.meta.main) {
  await main();
}
