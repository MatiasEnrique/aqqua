import { describe, expect, it } from "vite-plus/test";
import type { VcsRef } from "@aqqua/contracts";
import {
  buildBaseRefChoices,
  filterBaseRefChoices,
  filterRefPickerOptions,
  toRefPickerOptions,
} from "./baseRefChoices";

function ref(name: string, remoteName?: string): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: remoteName !== undefined,
    ...(remoteName ? { remoteName } : {}),
    worktreePath: null,
  };
}

describe("buildBaseRefChoices", () => {
  it("pairs matching local and remote branches and prefers origin", () => {
    const choices = buildBaseRefChoices(
      [ref("main")],
      [ref("upstream/main", "upstream"), ref("origin/main", "origin")],
    );

    expect(choices).toEqual([
      expect.objectContaining({
        label: "main",
        local: expect.objectContaining({ name: "main" }),
        remote: expect.objectContaining({ name: "origin/main" }),
      }),
      expect.objectContaining({
        label: "upstream/main",
        local: null,
        remote: expect.objectContaining({ name: "upstream/main" }),
      }),
    ]);
  });
});

describe("filterRefPickerOptions", () => {
  it("keeps only the rows whose own ref name matches the query", () => {
    const options = toRefPickerOptions(
      buildBaseRefChoices([ref("main")], [ref("origin/main", "origin")]),
    );

    expect(options.map((option) => [option.value, option.badge])).toEqual([
      ["main", null],
      ["origin/main", "remote"],
    ]);
    expect(filterRefPickerOptions(options, "ORIGIN").map((option) => option.value)).toEqual([
      "origin/main",
    ]);
    expect(filterRefPickerOptions(options, "  ").map((option) => option.value)).toEqual([
      "main",
      "origin/main",
    ]);
  });
});

describe("filterBaseRefChoices", () => {
  it("filters stale server results against the current query", () => {
    const choices = buildBaseRefChoices(
      [ref("main"), ref("feature/search")],
      [ref("origin/main", "origin"), ref("origin/feature/search", "origin")],
    );

    expect(filterBaseRefChoices(choices, "SEARCH").map((choice) => choice.label)).toEqual([
      "feature/search",
    ]);
    expect(filterBaseRefChoices(choices, "origin/main").map((choice) => choice.label)).toEqual([
      "main",
    ]);
  });
});
