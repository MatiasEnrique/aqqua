import { BoardId, type OrchestrationBoard } from "@aqqua/contracts";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { boardEnvironment } from "../../state/boards";
import { useAtomCommand } from "../../state/use-atom-command";
import type { BoardEditorSubmit } from "./BoardEditorDialog";
import { reportBoardCommandResult } from "./boardCommandFeedback";
import type { FlowProject } from "./flowSelection";

export interface FlowEditorTarget {
  readonly project: FlowProject;
  /** `null` creates a flow in the project; a flow edits it. */
  readonly flow: OrchestrationBoard | null;
}

export interface FlowDeletionTarget {
  readonly project: FlowProject;
  readonly flow: OrchestrationBoard;
}

/**
 * Flow creation, editing, and deletion, hoisted above the cards. The picker can
 * start a flow in any project — including one with no flows to render a section
 * for — so the editor cannot live inside the selected project's card list.
 */
export function useFlowEditorController({
  onFlowCreated,
  onFlowDeleted,
}: {
  readonly onFlowCreated: (boardId: BoardId, project: FlowProject) => void;
  readonly onFlowDeleted: (boardId: BoardId) => void;
}) {
  const createBoard = useAtomCommand(boardEnvironment.createBoard);
  const updateBoard = useAtomCommand(boardEnvironment.updateBoard);
  const deleteBoard = useAtomCommand(boardEnvironment.deleteBoard);
  const [target, setTarget] = useState<FlowEditorTarget | null>(null);
  const [deletion, setDeletion] = useState<FlowDeletionTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const submit = async (input: BoardEditorSubmit): Promise<boolean> => {
    if (target === null) return false;
    const { environmentId, id: projectId } = target.project;
    if (target.flow === null) {
      const boardId = BoardId.make(randomUUID());
      const result = await createBoard({
        environmentId,
        input: { boardId, projectId, name: input.name, steps: input.steps },
      });
      if (!reportBoardCommandResult(result, "Could not create flow")) return false;
      onFlowCreated(boardId, target.project);
      return true;
    }
    const result = await updateBoard({
      environmentId,
      input: { boardId: target.flow.id, name: input.name, steps: input.steps },
    });
    return reportBoardCommandResult(result, "Could not update flow");
  };

  /**
   * Deleting is a two-step: the editor hands the flow over and closes, and the
   * confirmation carries the consequences, since a deleted flow takes its cards
   * out of the sidebar with it.
   */
  const requestDelete = (project: FlowProject, flow: OrchestrationBoard) => {
    setTarget(null);
    setDeletion({ project, flow });
  };
  const confirmDelete = async () => {
    if (deletion === null) return;
    const { project, flow } = deletion;
    setIsDeleting(true);
    try {
      const result = await deleteBoard({
        environmentId: project.environmentId,
        input: { boardId: flow.id },
      });
      if (!reportBoardCommandResult(result, "Could not delete flow")) return;
      setDeletion(null);
      onFlowDeleted(flow.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    target,
    deletion,
    isDeleting,
    openNewFlow: (project: FlowProject) => setTarget({ project, flow: null }),
    /** Retarget the open editor at another project, keeping the draft intact. */
    setTargetProject: (project: FlowProject) =>
      setTarget((current) =>
        current === null || current.flow !== null ? current : { ...current, project },
      ),
    openEditFlow: (project: FlowProject, flow: OrchestrationBoard) => setTarget({ project, flow }),
    close: () => setTarget(null),
    requestDelete,
    cancelDelete: () => setDeletion(null),
    confirmDelete,
    submit,
  };
}
