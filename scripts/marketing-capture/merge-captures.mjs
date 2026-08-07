// Merge non-overlapping sub-agent capture lanes into the raw directory that
// ../remotion consumes. Each lane owns its own directory, so recordings can run
// concurrently without racing on media files or manifest.json.
//
// Usage:
//   node scripts/marketing-capture/merge-captures.mjs \
//     --output-dir scripts/marketing-capture/raw \
//     /tmp/aqqua-demo-lane-a /tmp/aqqua-demo-lane-b
import * as fs from "node:fs/promises";
import * as path from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-dir");
const outputDir = outputIndex === -1 ? null : args[outputIndex + 1];
const inputDirs = args.filter(
  (arg, index) => index !== outputIndex && index !== outputIndex + 1 && !arg.startsWith("--"),
);

if (!outputDir || inputDirs.length === 0) {
  console.error(
    "Usage: node scripts/marketing-capture/merge-captures.mjs --output-dir <dir> <lane-dir>...",
  );
  process.exit(1);
}

const resolvedOutput = path.resolve(outputDir);
await fs.mkdir(resolvedOutput, { recursive: true });

const merged = {};
for (const inputDir of inputDirs) {
  const resolvedInput = path.resolve(inputDir);
  const manifestPath = path.join(resolvedInput, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  for (const [slug, entry] of Object.entries(manifest)) {
    if (merged[slug]) {
      throw new Error(`Duplicate capture slug "${slug}" in ${manifestPath}.`);
    }
    const sourceVideoName = entry.file;
    if (typeof sourceVideoName !== "string" || sourceVideoName.length === 0) {
      throw new Error(`${manifestPath}: ${slug} has no video file.`);
    }

    const videoName = `${slug}${path.extname(sourceVideoName) || ".webm"}`;
    await fs.copyFile(
      path.join(resolvedInput, sourceVideoName),
      path.join(resolvedOutput, videoName),
    );

    let posterName;
    if (typeof entry.poster === "string" && entry.poster.length > 0) {
      posterName = `${slug}${path.extname(entry.poster) || ".png"}`;
      await fs.copyFile(
        path.join(resolvedInput, entry.poster),
        path.join(resolvedOutput, posterName),
      );
    }

    const { video: _duplicateVideoName, ...metadata } = entry;
    merged[slug] = {
      ...metadata,
      file: videoName,
      ...(posterName ? { poster: posterName } : {}),
    };
  }
}

const ordered = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
const outputManifest = path.join(resolvedOutput, "manifest.json");
await fs.writeFile(outputManifest, `${JSON.stringify(ordered, null, 2)}\n`);
console.log(`Merged ${Object.keys(ordered).length} captures into ${outputManifest}`);
