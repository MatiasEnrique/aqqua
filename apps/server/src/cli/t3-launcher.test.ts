import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveT3Entrypoint } from "./t3-launcher.ts";

describe("resolveT3Entrypoint", () => {
  it.effect("prefers the built cli when dist/bin.mjs exists", () =>
    Effect.sync(() => {
      const resolved = resolveT3Entrypoint("/repo/apps/server", (path) =>
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
      const resolved = resolveT3Entrypoint("/repo/apps/server", () => false);

      assert.deepStrictEqual(resolved, {
        distEntrypointPath: "/repo/apps/server/dist/bin.mjs",
        sourceEntrypointPath: "/repo/apps/server/src/bin.ts",
        selectedEntrypointPath: "/repo/apps/server/src/bin.ts",
      });
    }),
  );
});
