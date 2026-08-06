import { describe, expect, it } from "vite-plus/test";

import {
  projectAvatarGradient,
  projectAvatarGradientId,
  projectAvatarHue,
  projectAvatarInitials,
  remapProjectAvatarSeed,
  projectAvatarSeedVariants,
  projectAvatarSvg,
  truncateProjectAvatarText,
} from "./projectAvatar.ts";

describe("projectAvatarGradient", () => {
  // Captured from avatar.vercel.sh so drift from the upstream artwork is loud.
  it.each([
    ["rauchg", "#06f91f", "#1f06f9"],
    ["vercel", "#f9f506", "#06f9f5"],
    ["leerob", "#6306f9", "#f96306"],
    ["party", "#06f9cc", "#cc06f9"],
  ])("matches vercel/avatar for %s", (seed, fromColor, toColor) => {
    expect(projectAvatarGradient(seed)).toEqual({ fromColor, toColor });
  });

  it("is deterministic", () => {
    expect(projectAvatarGradient("aqqua")).toEqual(projectAvatarGradient("aqqua"));
  });

  it("keeps the hue on the wheel", () => {
    for (const seed of ["", "a", "some-project", "/Users/me/code/api"]) {
      expect(projectAvatarHue(seed)).toBeGreaterThanOrEqual(0);
      expect(projectAvatarHue(seed)).toBeLessThan(360);
    }
  });
});

describe("projectAvatarGradientId", () => {
  it("shares an id only between seeds that share a hue", () => {
    expect(projectAvatarGradientId("rauchg")).toBe("aqqua-project-avatar-126");
    expect(projectAvatarGradientId("rauchg")).not.toBe(projectAvatarGradientId("vercel"));
  });
});

describe("projectAvatarInitials", () => {
  it.each([
    ["Aqqua Server", "AS"],
    ["my-api", "MA"],
    ["aqqua", "AQ"],
    ["a", "A"],
    ["  spaced   out  ", "SO"],
    ["用户 项目", "用项"],
    ["𐐀𐐁", "𐐀𐐁"],
    ["𐐀 project", "𐐀P"],
  ])("derives %s -> %s", (title, expected) => {
    expect(projectAvatarInitials(title)).toBe(expected);
  });

  it("returns nothing when there is no letter or digit", () => {
    expect(projectAvatarInitials("---")).toBe("");
    expect(projectAvatarInitials("")).toBe("");
  });

  it("truncates by Unicode code point", () => {
    expect(truncateProjectAvatarText("𐐀𐐁𐐂𐐃")).toBe("𐐀𐐁𐐂");
  });
});

describe("projectAvatarSeedVariants", () => {
  it("leads with the base seed", () => {
    expect(projectAvatarSeedVariants("my-api", 6)[0]).toBe("my-api");
  });

  it("returns the requested count with visually distinct hues", () => {
    const seeds = projectAvatarSeedVariants("my-api", 12);
    expect(seeds).toHaveLength(12);
    const hues = seeds.map(projectAvatarHue);
    expect(new Set(hues).size).toBe(hues.length);
    for (const [index, hue] of hues.entries()) {
      for (const other of hues.slice(index + 1)) {
        const distance = Math.abs(hue - other);
        expect(Math.min(distance, 360 - distance)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("is deterministic for a given base", () => {
    expect(projectAvatarSeedVariants("aqqua", 8)).toEqual(projectAvatarSeedVariants("aqqua", 8));
  });

  it("keeps long workspace-derived seeds within the wire limit", () => {
    const seeds = projectAvatarSeedVariants(`/workspace/${"nested/".repeat(50)}`, 12);
    expect(seeds).toHaveLength(12);
    expect(new Set(seeds).size).toBe(12);
    expect(seeds.every((seed) => seed.length <= 256)).toBe(true);
  });

  it("remaps a selected variant when a clone canonicalizes its root", () => {
    const beforeRoot = "/tmp/repository/../project";
    const afterRoot = "/tmp/project";
    const selected = projectAvatarSeedVariants(beforeRoot, 12)[4];
    if (selected === undefined) throw new Error("Expected a fifth avatar variant.");
    expect(remapProjectAvatarSeed(selected, beforeRoot, afterRoot)).toBe(
      projectAvatarSeedVariants(afterRoot, 12)[4],
    );
  });

  it("preserves seeds that did not come from the picker", () => {
    expect(remapProjectAvatarSeed("custom-seed", "/tmp/old", "/tmp/new")).toBe("custom-seed");
  });
});

describe("projectAvatarSvg", () => {
  it("renders a gradient rect with a unique gradient id", () => {
    const svg = projectAvatarSvg({ seed: "rauchg", size: 32, rounded: 8 });
    expect(svg).toContain('width="32"');
    expect(svg).toContain('rx="8"');
    expect(svg).toContain('id="aqqua-project-avatar-126"');
    expect(svg).toContain('fill="url(#aqqua-project-avatar-126)"');
    expect(svg).toContain('stop-color="#06f91f"');
    expect(svg).not.toContain("<text");
  });

  it("sizes text the way vercel/avatar does", () => {
    expect(projectAvatarSvg({ seed: "rauchg", text: "GR", size: 120 })).toContain('font-size="54"');
  });

  it("escapes text so a title cannot break the document", () => {
    const svg = projectAvatarSvg({ seed: "rauchg", text: "<&>" });
    expect(svg).toContain("&lt;&amp;&gt;");
    expect(svg).not.toContain("<&>");
  });
});
