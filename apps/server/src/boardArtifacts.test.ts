import { BoardId, CardId, ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  readBoardArtifact,
  resolveBoardArtifactPath,
  sanitizeBoardStepName,
  writeBoardArtifact,
} from "./boardArtifacts.ts";
import { ServerConfig } from "./config.ts";
import { ProjectionCardRepositoryLive } from "./persistence/Layers/ProjectionCards.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { ProjectionCardRepository } from "./persistence/Services/ProjectionCards.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";

const NOW = "2026-01-01T00:00:00.000Z";

it("sanitizeBoardStepName rejects path traversal and leading dots", () => {
  assert.equal(sanitizeBoardStepName("../etc/passwd"), null);
  assert.equal(sanitizeBoardStepName(".."), null);
  assert.equal(sanitizeBoardStepName(".hidden"), null);
  assert.equal(sanitizeBoardStepName("foo/bar"), null);
  assert.equal(sanitizeBoardStepName("foo\\bar"), null);
  assert.equal(sanitizeBoardStepName(""), null);
  assert.equal(sanitizeBoardStepName("Implement"), "Implement");
  assert.equal(sanitizeBoardStepName("Code Review"), "Code-Review");
});

it("resolveBoardArtifactPath keeps files under the board-artifacts root", () => {
  const resolved = resolveBoardArtifactPath({
    stateDir: "/tmp/state",
    cardId: "card-1",
    stepName: "Implement",
  });
  assert.ok(resolved);
  assert.equal(resolved?.path, "/tmp/state/board-artifacts/card-1/Implement.md");

  assert.equal(
    resolveBoardArtifactPath({
      stateDir: "/tmp/state",
      cardId: "../escape",
      stepName: "Implement",
    }),
    null,
  );
  assert.equal(
    resolveBoardArtifactPath({
      stateDir: "/tmp/state",
      cardId: "card-1",
      stepName: "../../escape",
    }),
    null,
  );
});

const BoardArtifactsTestLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provideMerge(ProjectionCardRepositoryLive),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-board-artifacts-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(BoardArtifactsTestLayer)("boardArtifacts IO", (it) => {
  it.effect("rejects missing cards and writes/reads artifacts atomically", () =>
    Effect.gen(function* () {
      const cards = yield* ProjectionCardRepository;
      const cardId = CardId.make("card-artifact-1");

      const missing = yield* readBoardArtifact({
        cardId,
        stepName: "Implement",
      }).pipe(Effect.flip);
      assert.equal(missing._tag, "BoardArtifactError");

      yield* cards.upsert({
        cardId,
        boardId: BoardId.make("board-1"),
        projectId: ProjectId.make("project-1"),
        title: "Card",
        parameters: {},
        positionKind: "todo",
        positionStepIndex: null,
        status: null,
        snapshot: null,
        branch: null,
        worktreePath: null,
        stepThreads: [],
        releasedAt: null,
        completedAt: null,
        settledAt: null,
        archivedAt: null,
        operation: null,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      });

      const written = yield* writeBoardArtifact({
        cardId,
        stepName: "Implement",
        content: "# Implement notes\n",
      });
      assert.ok(written.path.includes("/board-artifacts/card-artifact-1/Implement.md"));

      const read = yield* readBoardArtifact({
        cardId,
        stepName: "Implement",
      });
      assert.equal(read.exists, true);
      assert.equal(read.content, "# Implement notes\n");
      assert.equal(read.path, written.path);

      const missingStep = yield* readBoardArtifact({
        cardId,
        stepName: "Review",
      });
      assert.equal(missingStep.exists, false);
      assert.equal(missingStep.content, null);

      const badName = yield* writeBoardArtifact({
        cardId,
        stepName: "../escape",
        content: "nope",
      }).pipe(Effect.flip);
      assert.equal(badName._tag, "BoardArtifactError");
    }),
  );
});
