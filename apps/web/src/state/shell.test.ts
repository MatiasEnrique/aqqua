import { AVAILABLE_CONNECTION_STATE } from "@aqqua/client-runtime/connection";
import type { EnvironmentShellState } from "@aqqua/client-runtime/state/shell";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { areEnvironmentShellsBootstrapped } from "./shell";

const emptyShellState: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

describe("areEnvironmentShellsBootstrapped", () => {
  it("waits through the connection atom's initial available placeholder", () => {
    expect(
      areEnvironmentShellsBootstrapped([
        {
          shell: emptyShellState,
          connection: AVAILABLE_CONNECTION_STATE,
        },
      ]),
    ).toBe(false);
  });

  it("accepts an intentional disconnect after a completed connection generation", () => {
    expect(
      areEnvironmentShellsBootstrapped([
        {
          shell: emptyShellState,
          connection: {
            ...AVAILABLE_CONNECTION_STATE,
            generation: 1,
          },
        },
      ]),
    ).toBe(true);
  });
});
