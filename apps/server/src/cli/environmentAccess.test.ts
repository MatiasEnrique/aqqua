import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";

import { isLiveServerTransportFailure } from "./environmentAccess.ts";

it("classifies only transport-level live probe failures as offline candidates", () => {
  const request = HttpClientRequest.get("http://127.0.0.1:9/api/orchestration/snapshot");
  assert.isTrue(
    isLiveServerTransportFailure(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: "connection refused",
        }),
      }),
    ),
  );
  assert.isTrue(isLiveServerTransportFailure(new Cause.TimeoutError()));
  assert.isFalse(
    isLiveServerTransportFailure(
      new Error("declared protocol failure must not clear live runtime state"),
    ),
  );
});
