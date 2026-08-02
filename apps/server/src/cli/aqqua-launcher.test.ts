import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveAqquaEntrypoint } from "./aqqua-launcher.ts";

describe("resolveAqquaEntrypoint", () => {
  it.effect("prefers the built cli when dist/bin.mjs exists", () =>
    Effect.sync(() => {
      const resolved = resolveAqquaEntrypoint("/repo/apps/server", (path) =>
        path.endsWith("/dist/bin.mjs"),
      );

      assert.deepStrictEqual(resolved, {
        distEntrypointPath: "/repo/apps/server/dist/bin.mjs",
        sourceEntrypointPath: "/repo/apps/server/src/bin.ts",
        selectedEntrypointPath: "/repo/apps/server/dist/bin.mjs",
      });
    }),
  );

  it.effect("falls back to the source entrypoint in a dev checkout", () =>
    Effect.sync(() => {
      const resolved = resolveAqquaEntrypoint("/repo/apps/server", () => false);

      assert.deepStrictEqual(resolved, {
        distEntrypointPath: "/repo/apps/server/dist/bin.mjs",
        sourceEntrypointPath: "/repo/apps/server/src/bin.ts",
        selectedEntrypointPath: "/repo/apps/server/src/bin.ts",
      });
    }),
  );
});
