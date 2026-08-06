import {
  CommandId,
  EventId,
  ProjectId,
  type OrchestrationReadModel,
  type ProjectIcon,
} from "@aqqua/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-icon");
const ICON: ProjectIcon = { _tag: "avatar", seed: "my-api~3", text: "MA" };

/** Read model holding one project, created with `icon` when provided. */
const readModelWithProject = (icon?: ProjectIcon | null) =>
  projectEvent(createEmptyReadModel(NOW), {
    sequence: 1,
    eventId: EventId.make("evt-project-create-icon"),
    aggregateKind: "project",
    aggregateId: PROJECT_ID,
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-project-create-icon"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-project-create-icon"),
    metadata: {},
    payload: {
      projectId: PROJECT_ID,
      title: "My API",
      workspaceRoot: "/tmp/my-api",
      defaultModelSelection: null,
      scripts: [],
      ...(icon === undefined ? {} : { icon }),
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

/** Update the project's icon, or rename it instead when `icon` is omitted. */
const updateIcon = (readModel: OrchestrationReadModel, ...icon: [] | [ProjectIcon | null]) =>
  decideOrchestrationCommand({
    command: {
      type: "project.meta.update",
      commandId: CommandId.make("cmd-project-update-icon"),
      projectId: PROJECT_ID,
      ...(icon.length === 0 ? { title: "Renamed" } : { icon: icon[0] }),
    },
    readModel,
  });

it.layer(NodeServices.layer)("decider project icon", (it) => {
  it.effect("carries a chosen icon onto project.created", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.make("cmd-project-create-icon"),
          projectId: PROJECT_ID,
          title: "My API",
          workspaceRoot: "/tmp/my-api",
          icon: ICON,
          createdAt: NOW,
        },
        readModel: createEmptyReadModel(NOW),
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.created");
      expect((event.payload as { icon?: unknown }).icon).toEqual(ICON);
    }),
  );

  it.effect("defaults to no icon so favicon discovery stays in charge", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.make("cmd-project-create-no-icon"),
          projectId: PROJECT_ID,
          title: "My API",
          workspaceRoot: "/tmp/my-api",
          createdAt: NOW,
        },
        readModel: createEmptyReadModel(NOW),
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect((event.payload as { icon?: unknown }).icon).toBeNull();
    }),
  );

  it.effect("projects a chosen icon onto the read model", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithProject(ICON);
      expect(readModel.projects[0]?.icon).toEqual(ICON);
    }),
  );

  it.effect("projects events recorded before project icons as having none", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithProject();
      expect(readModel.projects[0]?.icon).toBeNull();
    }),
  );

  it.effect("applies an icon through project.meta.update", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithProject();
      const result = yield* updateIcon(readModel, ICON);

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.meta-updated");
      expect((event.payload as { icon?: unknown }).icon).toEqual(ICON);

      const projected = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(projected.projects[0]?.icon).toEqual(ICON);
    }),
  );

  it.effect("clears an icon with an explicit null, restoring favicon discovery", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithProject(ICON);
      const result = yield* updateIcon(readModel, null);

      const event = Array.isArray(result) ? result[0] : result;
      expect((event.payload as { icon?: unknown }).icon).toBeNull();

      const projected = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(projected.projects[0]?.icon).toBeNull();
    }),
  );

  it.effect("leaves the icon untouched when an update omits it", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithProject(ICON);
      const result = yield* updateIcon(readModel);

      const event = Array.isArray(result) ? result[0] : result;
      expect((event.payload as { icon?: unknown }).icon).toBeUndefined();

      const projected = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(projected.projects[0]?.icon).toEqual(ICON);
      expect(projected.projects[0]?.title).toBe("Renamed");
    }),
  );
});
