import type { BoardId, EnvironmentId, OrchestrationBoard, ProjectId } from "@aqqua/contracts";

/** The project identity the flow picker needs to label and route a flow. */
export interface FlowProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly projectKey: string;
  readonly displayName: string;
  readonly workspaceRoot: string;
}

/** One project and the flows it owns, in picker order. */
export interface FlowGroup {
  readonly project: FlowProject;
  readonly flows: ReadonlyArray<OrchestrationBoard>;
}

/** A flow with the project it belongs to — the unit the sidebar selects. */
export interface FlowChoice {
  readonly project: FlowProject;
  readonly flow: OrchestrationBoard;
}

export function flowChoices(groups: ReadonlyArray<FlowGroup>): ReadonlyArray<FlowChoice> {
  return groups.flatMap((group) => group.flows.map((flow) => ({ project: group.project, flow })));
}

/**
 * The one flow the sidebar shows. The sidebar holds a single flow, so every
 * source that can name one is ranked: what the user picked wins, then the flow
 * the open card lives in, then the routed project's first flow, and finally the
 * first flow anywhere — a fresh Flows tab lands on something rather than empty.
 */
export function resolveSelectedFlow(input: {
  readonly groups: ReadonlyArray<FlowGroup>;
  readonly chosenBoardId: BoardId | null;
  readonly routedBoardId: BoardId | null;
  readonly routedProjectKey: string | null;
}): FlowChoice | null {
  const choices = flowChoices(input.groups);
  const byId = (boardId: BoardId | null) =>
    boardId === null ? null : (choices.find((choice) => choice.flow.id === boardId) ?? null);
  const chosen = byId(input.chosenBoardId);
  if (chosen !== null) return chosen;
  const routed = byId(input.routedBoardId);
  if (routed !== null) return routed;
  const routedProject =
    input.routedProjectKey === null
      ? null
      : (choices.find((choice) => choice.project.projectKey === input.routedProjectKey) ?? null);
  return routedProject ?? choices[0] ?? null;
}
