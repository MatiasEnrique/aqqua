import type { ProjectIcon } from "@aqqua/contracts";
import {
  PROJECT_AVATAR_TEXT_MAX_LENGTH,
  projectAvatarInitials,
  projectAvatarSeedVariants,
} from "@aqqua/shared/projectAvatar";
import { useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ProjectAvatar } from "./ProjectAvatar";

const VARIANT_COUNT = 12;

function buildIcon(seed: string, text: string): ProjectIcon {
  return { _tag: "avatar", seed, ...(text.length > 0 ? { text } : {}) };
}

/**
 * Pick a generated avatar for a project, or leave it on favicon discovery.
 *
 * Seeds derive from the workspace root so two projects sharing a name still
 * get different artwork, and every swatch previews the initials currently in
 * the field. Initials are held locally while typing and committed on blur or
 * Enter, so a three-character edit is one update rather than three.
 */
export function ProjectIconPicker(props: {
  readonly title: string;
  readonly workspaceRoot: string;
  readonly value: ProjectIcon | null;
  readonly onChange: (icon: ProjectIcon | null) => void;
  readonly idPrefix: string;
  readonly className?: string | undefined;
}) {
  const { onChange, title, value, workspaceRoot } = props;
  const seeds = useMemo(
    () => projectAvatarSeedVariants(workspaceRoot, VARIANT_COUNT),
    [workspaceRoot],
  );
  const defaultText = useMemo(() => projectAvatarInitials(title), [title]);
  // Before a pick, swatches preview the initials the project would get.
  const committedText = value === null ? defaultText : (value.text ?? "");
  const [draftText, setDraftText] = useState<string | null>(null);
  const text = draftText ?? committedText;

  const commitText = () => {
    setDraftText(null);
    if (value === null || draftText === null) return;
    const next = draftText.trim();
    if (next === committedText) return;
    onChange(buildIcon(value.seed, next));
  };

  return (
    <div className={cn("grid gap-3", props.className)}>
      <fieldset>
        <legend className="sr-only">Project avatar</legend>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {seeds.map((seed, index) => {
            const selected = value !== null && value.seed === seed;
            return (
              <label key={seed} className="cursor-pointer rounded-lg">
                <input
                  type="radio"
                  name={`${props.idPrefix}-avatar`}
                  value={seed}
                  checked={selected}
                  aria-label={`Avatar option ${index + 1}`}
                  className="peer sr-only"
                  onChange={() => {
                    setDraftText(null);
                    onChange(buildIcon(seed, text.trim()));
                  }}
                />
                <span className="block rounded-lg p-1 transition-[box-shadow,scale] duration-150 ease-out hover:ring-2 hover:ring-border active:scale-[0.96] peer-checked:ring-2 peer-checked:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  <ProjectAvatar icon={buildIcon(seed, text.trim())} className="size-8 rounded" />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1.5" htmlFor={`${props.idPrefix}-initials`}>
          <span className="font-medium text-foreground">Initials</span>
          <Input
            id={`${props.idPrefix}-initials`}
            name={`${props.idPrefix}-initials`}
            autoComplete="off"
            className="w-24"
            value={text}
            maxLength={PROJECT_AVATAR_TEXT_MAX_LENGTH}
            placeholder={defaultText}
            disabled={value === null}
            onChange={(event) => setDraftText(event.currentTarget.value)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        {value === null ? (
          <span className="pb-2 text-pretty text-base text-muted-foreground">
            Using the project favicon or folder fallback.
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="mb-0.5"
            onClick={() => {
              setDraftText(null);
              onChange(null);
            }}
          >
            Use project favicon
          </Button>
        )}
      </div>
    </div>
  );
}
