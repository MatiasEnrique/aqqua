import type { GitHistoryCommitSummary, GitObjectId } from "@t3tools/contracts";

export interface GitHistoryGraphLane {
  readonly targetId: GitObjectId;
  readonly colorSlot: number;
}

export interface GitHistoryGraphEdge {
  readonly phase: "incoming" | "outgoing" | "through";
  readonly fromLane: number;
  readonly toLane: number;
  readonly colorSlot: number;
}

export interface GitHistoryGraphRow {
  readonly nodeLane: number;
  readonly nodeColorSlot: number;
  readonly before: ReadonlyArray<GitHistoryGraphLane>;
  readonly after: ReadonlyArray<GitHistoryGraphLane>;
  readonly edges: ReadonlyArray<GitHistoryGraphEdge>;
  readonly laneCount: number;
}

interface MutableLane {
  targetId: GitObjectId;
  colorSlot: number;
}

function copyLanes(lanes: ReadonlyArray<MutableLane>): GitHistoryGraphLane[] {
  return lanes.map((lane) => ({ ...lane }));
}

export function layoutGitHistoryGraph(
  commits: ReadonlyArray<GitHistoryCommitSummary>,
): GitHistoryGraphRow[] {
  const rows: GitHistoryGraphRow[] = [];
  const lanes: MutableLane[] = [];
  let nextColorSlot = 0;

  for (const commit of commits) {
    let matchingLaneIndexes = lanes.flatMap((lane, index) =>
      lane.targetId === commit.id ? [index] : [],
    );
    const startsIndependentTip = matchingLaneIndexes.length === 0;
    let nodeLane: number;
    let nodeColorSlot: number;

    if (matchingLaneIndexes.length === 0) {
      nodeLane = lanes.length;
      nodeColorSlot = nextColorSlot++;
      lanes.push({ targetId: commit.id, colorSlot: nodeColorSlot });
      matchingLaneIndexes = [nodeLane];
    } else {
      nodeLane = matchingLaneIndexes[0]!;
      nodeColorSlot = lanes[nodeLane]!.colorSlot;
    }

    const before = copyLanes(lanes);
    for (const duplicateIndex of matchingLaneIndexes.slice(1).toReversed()) {
      lanes.splice(duplicateIndex, 1);
    }

    if (commit.parentIds.length === 0) {
      lanes.splice(nodeLane, 1);
    } else {
      lanes[nodeLane] = {
        targetId: commit.parentIds[0]!,
        colorSlot: nodeColorSlot,
      };
      const mergeParents = commit.parentIds.slice(1).map((targetId) => ({
        targetId,
        colorSlot: nextColorSlot++,
      }));
      lanes.splice(nodeLane + 1, 0, ...mergeParents);
    }

    const after = copyLanes(lanes);
    const edges: GitHistoryGraphEdge[] = [];
    for (let beforeIndex = 0; beforeIndex < before.length; beforeIndex += 1) {
      const lane = before[beforeIndex]!;
      if (lane.targetId === commit.id) {
        if (!startsIndependentTip) {
          edges.push({
            phase: "incoming",
            fromLane: beforeIndex,
            toLane: nodeLane,
            colorSlot: lane.colorSlot,
          });
        }
        continue;
      }
      const afterIndex = after.findIndex((candidate) => candidate.colorSlot === lane.colorSlot);
      if (afterIndex >= 0) {
        edges.push({
          phase: "through",
          fromLane: beforeIndex,
          toLane: afterIndex,
          colorSlot: lane.colorSlot,
        });
      }
    }
    for (const parentId of commit.parentIds) {
      const parentLane = after.findIndex((lane) => lane.targetId === parentId);
      if (parentLane >= 0) {
        edges.push({
          phase: "outgoing",
          fromLane: nodeLane,
          toLane: parentLane,
          colorSlot: after[parentLane]!.colorSlot,
        });
      }
    }

    rows.push({
      nodeLane,
      nodeColorSlot,
      before,
      after,
      edges,
      laneCount: Math.max(1, before.length, after.length, nodeLane + 1),
    });
  }
  return rows;
}
