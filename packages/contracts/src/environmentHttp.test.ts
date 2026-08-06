import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { EnvironmentAgentModelsRequest } from "./environmentHttp.ts";

const decodeModelsRequest = Schema.decodeUnknownSync(EnvironmentAgentModelsRequest);

it("decodes the cwd used for ordinary-terminal agent model discovery", () => {
  assert.deepEqual(decodeModelsRequest({ cwd: "/worktrees/aqqua" }), {
    cwd: "/worktrees/aqqua",
  });
  assert.throws(() => decodeModelsRequest({}));
});
