"use client";

import { useAtomValue } from "@effect/atom-react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { PROVIDER_DISPLAY_NAMES, type AgentProfile } from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentProfileDialog } from "./AgentProfileDialog";
import {
  AGENT_PROFILE_RUNTIME_LABELS,
  type AgentProfileDraft,
  type AgentProfileRow,
  buildAgentProfileRows,
  buildProviderChoices,
  builtInImplementerDraft,
  DEFAULT_AGENT_PROFILE_DRAFT,
  deleteAgentProfile,
  describeAgentProfileModel,
  describeAgentProfileProvider,
  draftFromAgentProfile,
  findProviderChoice,
  selectOptionDescriptorsForModel,
  summarizeAgentProfileOptions,
  toAgentProfileName,
  upsertAgentProfile,
} from "./AgentProfilesSettings.logic";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

/** Editor target: `null` name means "add", a string means "edit that key". */
interface EditorState {
  readonly key: string;
  readonly originalName: string | null;
  readonly draft: AgentProfileDraft;
}

export function AgentProfilesSettingsPanel() {
  const agentProfiles = usePrimarySettings((settings) => settings.agentProfiles);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const choices = useMemo(
    () => buildProviderChoices({ entries, driverLabels: PROVIDER_DISPLAY_NAMES }),
    [entries],
  );
  const rows = useMemo(() => buildAgentProfileRows(agentProfiles), [agentProfiles]);
  const existingNames = useMemo(() => Object.keys(agentProfiles ?? {}), [agentProfiles]);

  const openEditor = (state: EditorState) => setEditor(state);

  const handleSubmit = (result: {
    readonly originalName: string | null;
    readonly name: string;
    readonly profile: AgentProfile;
  }) => {
    updateSettings({
      agentProfiles: upsertAgentProfile({
        map: agentProfiles,
        originalName: result.originalName,
        name: toAgentProfileName(result.name),
        profile: result.profile,
      }),
    });
    setEditor(null);
  };

  const handleDelete = (name: string) => {
    updateSettings({ agentProfiles: deleteAgentProfile(agentProfiles, name) });
    setPendingDelete(null);
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Agent Profiles"
        headerAction={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() =>
              openEditor({
                key: "new",
                originalName: null,
                draft: DEFAULT_AGENT_PROFILE_DRAFT,
              })
            }
          >
            <PlusIcon className="size-3.5" />
            Add profile
          </Button>
        }
      >
        <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Machine-local roles that orchestrator agents spawn sub-agents with —{" "}
          <code className="rounded bg-muted px-1 py-px text-[11px]">
            3T agent spawn --profile &lt;name&gt;
          </code>
          . Each profile pins the provider, model, and runtime the sub-agent runs under.
        </p>

        {rows.map((row) => (
          <AgentProfileListRow
            key={row.name}
            row={row}
            providerLabel={describeAgentProfileProvider({
              profile: row.profile,
              entries,
              driverLabels: PROVIDER_DISPLAY_NAMES,
            })}
            optionsSummary={summarizeAgentProfileOptions({
              options: row.profile.options,
              descriptors: selectOptionDescriptorsForModel(
                findProviderChoice(choices, row.profile.target)?.models ?? [],
                row.profile.model ?? null,
              ),
            })}
            onEdit={() =>
              openEditor({
                key: row.name,
                originalName: row.isBuiltIn ? null : row.name,
                draft: row.isBuiltIn
                  ? builtInImplementerDraft()
                  : draftFromAgentProfile(row.name, row.profile),
              })
            }
            onDelete={row.isBuiltIn ? undefined : () => setPendingDelete(row.name)}
          />
        ))}

        {existingNames.length === 0 ? (
          <p className="px-3 text-xs text-muted-foreground sm:px-4">
            Nothing configured yet — <code>implementer</code> above is the built-in role. Add
            profiles like <code>grok</code>, <code>cc</code>, or <code>fable</code> so an
            orchestrator can pick the right provider per lane.
          </p>
        ) : null}
      </SettingsSection>

      {editor ? (
        <AgentProfileDialog
          key={editor.key}
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          originalName={editor.originalName}
          initialDraft={editor.draft}
          existingNames={existingNames}
          entries={entries}
          driverLabels={PROVIDER_DISPLAY_NAMES}
          onSubmit={handleSubmit}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete '{pendingDelete}'?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete === "implementer"
                ? "Orchestrators asking for 'implementer' fall back to the built-in role: the first enabled Codex instance, session runtime, inheriting the project's default model."
                : `Orchestrators asking for '${pendingDelete}' will fail until the profile is recreated. Running sub-agents are unaffected.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete !== null) handleDelete(pendingDelete);
              }}
            >
              Delete profile
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}

function AgentProfileListRow({
  row,
  providerLabel,
  optionsSummary,
  onEdit,
  onDelete,
}: {
  readonly row: AgentProfileRow;
  readonly providerLabel: string;
  readonly optionsSummary: string | null;
  readonly onEdit: () => void;
  /** Omitted for the implicit built-in row, which has nothing to remove. */
  readonly onDelete?: (() => void) | undefined;
}) {
  const details = [providerLabel, describeAgentProfileModel(row.profile)];
  if (optionsSummary) details.push(optionsSummary);
  if (row.profile.titlePrefix) details.push(`Title prefix: ${row.profile.titlePrefix}`);

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
              {row.name}
            </span>
            {row.isBuiltIn ? (
              <Badge variant="secondary" size="sm">
                Built-in
              </Badge>
            ) : null}
            {row.profile.runtime === "terminal" ? (
              <Badge variant="outline" size="sm">
                {AGENT_PROFILE_RUNTIME_LABELS.terminal}
              </Badge>
            ) : null}
          </div>
          <p className="text-[13px] leading-[1.45] text-muted-foreground/80">
            {details.join(" · ")}
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {row.isBuiltIn ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEdit}>
              Customize
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Edit agent profile ${row.name}`}
                    onClick={onEdit}
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Edit profile</TooltipPopup>
            </Tooltip>
          )}
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Delete agent profile ${row.name}`}
                    onClick={onDelete}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Delete profile</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
