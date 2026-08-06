import { arrayMove } from "@dnd-kit/sortable";
import { useAtomValue } from "@effect/atom-react";
import type {
  BoardStepId,
  EnvironmentId,
  OrchestrationBoard,
  ServerProviderSkill,
} from "@aqqua/contracts";
import { collectBoardParameterNames } from "@aqqua/shared/boardTemplate";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useProviderWorkspaceSkills } from "../../lib/providerSkillsState";
import { isMacPlatform, randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { buildAgentProfileRows } from "../settings/AgentProfilesSettings.logic";
import {
  type BoardDraft,
  type BoardStepDraft,
  buildPlaceholderOptions,
  createStepDraft,
  draftFromBoard,
  isBoardDraftSubmittable,
  makeBoardStepId,
  moveStep,
  resolveProfileSkillsProvider,
  toBoardSteps,
  updateStep,
  validateBoardDraft,
} from "./BoardEditorDialog.logic";

export interface BoardEditorSubmit {
  readonly name: string;
  readonly steps: ReturnType<typeof toBoardSteps>;
}

const EMPTY_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

export function useBoardEditorController({
  board,
  environmentId,
  workspaceRoot,
  isSaving,
  onSave,
}: {
  readonly board: OrchestrationBoard | null;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot?: string | null | undefined;
  readonly isSaving: boolean;
  readonly onSave: (input: BoardEditorSubmit) => Promise<void>;
}) {
  const agentProfiles = usePrimarySettings((settings) => settings.agentProfiles);
  const profileRows = useMemo(() => buildAgentProfileRows(agentProfiles), [agentProfiles]);
  const profileNames = useMemo(() => profileRows.map((row) => row.name), [profileRows]);
  const defaultProfileName = profileNames[0] ?? "implementer";
  const [draft, setDraft] = useState<BoardDraft>(() =>
    board === null
      ? {
          name: "",
          steps: [createStepDraft(makeBoardStepId(randomUUID()), defaultProfileName)],
        }
      : draftFromBoard(board),
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [focusedStepId, setFocusedStepId] = useState<BoardStepId | null>(() =>
    board === null ? (draft.steps[0]?.id ?? null) : null,
  );
  const stepNameRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingStepFocusRef = useRef<string | null>(null);
  const boardNameRef = useRef<HTMLInputElement | null>(null);
  const isMac = useMemo(() => isMacPlatform(navigator.platform), []);

  useEffect(() => {
    const id = pendingStepFocusRef.current;
    if (id === null) return;
    pendingStepFocusRef.current = null;
    stepNameRefs.current.get(id)?.focus();
  });
  useEffect(() => {
    if (board === null) boardNameRef.current?.focus();
  }, [board]);

  const errors = validateBoardDraft(draft);
  const canSubmit = !isSaving && isBoardDraftSubmittable(errors);
  const cardFieldCount = useMemo(
    () => collectBoardParameterNames(draft.steps.map((step) => step.promptTemplate)).length,
    [draft.steps],
  );
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const focusedStep = draft.steps.find((step) => step.id === focusedStepId) ?? null;
  const focusedSkillsProvider = useMemo(() => {
    if (focusedStep === null) return null;
    if (focusedStep.agent !== undefined) {
      const instanceId = focusedStep.agent.instanceId;
      return serverConfig?.providers.find((provider) => provider.instanceId === instanceId) ?? null;
    }
    const profile =
      profileRows.find((row) => row.name === focusedStep.profileName)?.profile ?? null;
    return resolveProfileSkillsProvider(profile?.target ?? null, serverConfig?.providers ?? []);
  }, [focusedStep, profileRows, serverConfig?.providers]);
  const focusedStepSkills = useProviderWorkspaceSkills(
    {
      environmentId,
      instanceId: focusedSkillsProvider?.instanceId ?? null,
      cwd: workspaceRoot ?? null,
    },
    focusedSkillsProvider?.skills ?? EMPTY_SKILLS,
  );
  const focusedPlaceholderOptions = useMemo(() => {
    if (focusedStep === null) return [];
    const index = draft.steps.findIndex((step) => step.id === focusedStep.id);
    return buildPlaceholderOptions(draft.steps, index);
  }, [draft.steps, focusedStep]);

  const focusStep = (id: BoardStepId) => {
    setFocusedStepId(id);
    pendingStepFocusRef.current = id;
  };
  const patchStep = (index: number, patch: Partial<Omit<BoardStepDraft, "id">>) =>
    setDraft((current) => ({
      ...current,
      steps: updateStep(current.steps, index, patch),
    }));
  const addStep = () => {
    const step = createStepDraft(makeBoardStepId(randomUUID()), defaultProfileName);
    setDraft((current) => ({ ...current, steps: [...current.steps, step] }));
    focusStep(step.id);
  };
  const moveFocusedStep = (direction: "up" | "down") => {
    if (focusedStepId === null) return;
    setDraft((current) => {
      const index = current.steps.findIndex((step) => step.id === focusedStepId);
      if (index === -1) return current;
      return { ...current, steps: moveStep(current.steps, index, direction) };
    });
  };
  const removeStepById = (id: BoardStepId) => {
    setFocusedStepId((current) => (current === id ? null : current));
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== id),
    }));
  };
  const reorderSteps = (activeId: string, overId: string) => {
    setDraft((current) => {
      const from = current.steps.findIndex((step) => step.id === activeId);
      const to = current.steps.findIndex((step) => step.id === overId);
      if (from === -1 || to === -1) return current;
      return { ...current, steps: arrayMove([...current.steps], from, to) };
    });
  };
  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit) {
      const firstErrored = draft.steps.find((step) => errors.steps[step.id] !== undefined);
      if (firstErrored) focusStep(firstErrored.id);
      return;
    }
    await onSave({ name: draft.name.trim(), steps: toBoardSteps(draft) });
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) void handleSubmit();
      else addStep();
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (focusedStepId === null) return;
      event.preventDefault();
      moveFocusedStep(event.key === "ArrowUp" ? "up" : "down");
    }
  };

  return {
    addStep,
    boardNameRef,
    cardFieldCount,
    draft,
    errors,
    focusStep,
    focusedPlaceholderOptions,
    focusedSkillsProvider,
    focusedStepId,
    focusedStepSkills,
    handleKeyDown,
    handleSubmit,
    hasAttemptedSubmit,
    isMac,
    patchStep,
    profileNames,
    registerNameRef(id: BoardStepId, node: HTMLInputElement | null) {
      if (node === null) stepNameRefs.current.delete(id);
      else stepNameRefs.current.set(id, node);
    },
    removeStepById,
    reorderSteps,
    setBoardName(name: string) {
      setDraft((current) => ({ ...current, name }));
    },
  };
}
