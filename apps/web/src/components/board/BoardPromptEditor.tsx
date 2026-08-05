import { PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL } from "@aqqua/client-runtime/state/provider-skills";
import type { ProviderDriverKind } from "@aqqua/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";
import { formatProviderSkillDisplayName, providerSkillStableId } from "~/providerSkillPresentation";
import { detectComposerTrigger } from "../../composer-logic";
import { useTheme } from "../../hooks/useTheme";
import type { ProviderWorkspaceSkillsState } from "../../lib/providerSkillsState";
import { searchProviderSkills } from "../../providerSkillSearch";
import { type ComposerCommandItem, ComposerCommandMenu } from "../chat/ComposerCommandMenu";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  isValidParameterName,
  segmentTemplate,
  type TemplatePlaceholderOption,
} from "./BoardEditorDialog.logic";

export function SkillsMenu({
  skills,
  onInsert,
}: {
  readonly skills: ProviderWorkspaceSkillsState;
  readonly onInsert: (skillName: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger className="flex items-center gap-1.5 rounded-sm py-0.5 pr-1 pl-0.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <span className="rounded-sm bg-muted px-1 py-0.5 font-medium font-mono text-[10px] text-muted-foreground">
          $
        </span>
        <span className="text-[11px] text-muted-foreground">insert an agent skill</span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80">
        {skills.skills.map((skill) => (
          <MenuItem key={skill.path} onClick={() => onInsert(skill.name)}>
            <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
              <span className="truncate font-mono text-foreground text-xs">${skill.name}</span>
              {(skill.shortDescription ?? skill.description) === undefined ? null : (
                <span className="truncate text-muted-foreground text-xs">
                  {skill.shortDescription ?? skill.description}
                </span>
              )}
            </span>
          </MenuItem>
        ))}
        {skills.skills.length === 0 && !skills.isPending ? (
          <MenuItem disabled>No skills found for this agent</MenuItem>
        ) : null}
        {skills.isPending ? (
          <div className="px-2 py-1.5 text-muted-foreground text-xs">
            {PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL}
          </div>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function StepCommandMenuLayer({
  anchor,
  children,
}: {
  readonly anchor: HTMLElement | null;
  readonly children: React.ReactNode;
}) {
  const [position, setPosition] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (anchor === null) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setPosition(
        spaceBelow < 180
          ? {
              bottom: window.innerHeight - rect.top + 6,
              left: rect.left,
              width: rect.width,
              maxHeight: Math.max(96, rect.top - 24),
            }
          : {
              top: rect.bottom + 6,
              left: rect.left,
              width: rect.width,
              maxHeight: Math.max(96, spaceBelow - 24),
            },
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, {
      capture: true,
      passive: true,
    });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [anchor]);

  if (position === null) return null;

  return createPortal(
    <div
      className="starting:translate-y-1 starting:opacity-0 pointer-events-auto fixed z-[70] transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none"
      style={position}
    >
      {children}
    </div>,
    document.body,
  );
}

const SKILL_QUERY_RE = /^[a-zA-Z0-9:_-]*$/;

type PromptEditorTrigger = {
  readonly kind: "skill" | "placeholder";
  readonly query: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
};

function detectPlaceholderTrigger(text: string, cursor: number): PromptEditorTrigger | null {
  const start = text.lastIndexOf("${", cursor - 2);
  if (start === -1) return null;
  const query = text.slice(start + 2, cursor);
  if (/[}\n$]/.test(query)) return null;
  return { kind: "placeholder", query, rangeStart: start, rangeEnd: cursor };
}

function detectPromptTrigger(text: string, cursor: number): PromptEditorTrigger | null {
  const placeholder = detectPlaceholderTrigger(text, cursor);
  if (placeholder !== null) return placeholder;
  const composer = detectComposerTrigger(text, cursor);
  return composer?.kind === "skill" && SKILL_QUERY_RE.test(composer.query)
    ? {
        kind: "skill",
        query: composer.query,
        rangeStart: composer.rangeStart,
        rangeEnd: composer.rangeEnd,
      }
    : null;
}

export function PromptEditor({
  value,
  ariaLabel,
  textareaRef,
  skills,
  skillsDriver,
  placeholderOptions,
  onChange,
}: {
  readonly value: string;
  readonly ariaLabel: string;
  readonly textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly skills: ProviderWorkspaceSkillsState | null;
  readonly skillsDriver: ProviderDriverKind | null;
  readonly placeholderOptions: ReadonlyArray<TemplatePlaceholderOption>;
  readonly onChange: (value: string) => void;
}) {
  const segments = useMemo(() => segmentTemplate(value), [value]);
  const { resolvedTheme } = useTheme();
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [trigger, setTrigger] = useState<PromptEditorTrigger | null>(null);
  const [dismissedRangeStart, setDismissedRangeStart] = useState<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const assignTextarea = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (textareaRef) textareaRef.current = node;
  };

  const syncTrigger = (textarea: HTMLTextAreaElement) => {
    const next = detectPromptTrigger(textarea.value, textarea.selectionStart ?? 0);
    setTrigger(next);
    if (next === null || dismissedRangeStart !== next.rangeStart) setDismissedRangeStart(null);
  };

  const activeTrigger =
    focused && trigger !== null && trigger.rangeStart !== dismissedRangeStart ? trigger : null;

  const items = useMemo<ComposerCommandItem[]>(() => {
    if (activeTrigger === null) return [];
    if (activeTrigger.kind === "placeholder") {
      const query = activeTrigger.query.trim().toLowerCase();
      const result: ComposerCommandItem[] = (
        query === ""
          ? placeholderOptions
          : placeholderOptions.filter(
              (option) =>
                option.token.toLowerCase().includes(query) ||
                option.description.toLowerCase().includes(query),
            )
      ).map((option) => ({
        id: `placeholder:${option.token}`,
        type: "template-placeholder" as const,
        token: option.token,
        label: option.label,
        description: option.description,
      }));
      const raw = activeTrigger.query.trim();
      if (
        raw !== "" &&
        isValidParameterName(raw) &&
        raw !== "card_title" &&
        !raw.startsWith("artifact") &&
        !placeholderOptions.some((option) => option.token === `\${${raw}}`)
      ) {
        result.push({
          id: `placeholder-new:${raw}`,
          type: "template-placeholder",
          token: `\${${raw}}`,
          label: `\${${raw}}`,
          description: "New card field",
        });
      }
      return result;
    }
    if (skills === null || skillsDriver === null) return [];
    return searchProviderSkills(skills.skills, activeTrigger.query).map((skill) => ({
      id: providerSkillStableId(skill, skillsDriver),
      type: "skill" as const,
      provider: skillsDriver,
      skill,
      label: formatProviderSkillDisplayName(skill),
      description:
        skill.shortDescription ??
        skill.description ??
        (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
    }));
  }, [activeTrigger, placeholderOptions, skills, skillsDriver]);

  const activeItem = items.find((item) => item.id === highlightedId) ?? items[0] ?? null;
  const menuVisible =
    activeTrigger !== null &&
    (activeTrigger.kind === "placeholder" || (skills !== null && skillsDriver !== null));

  const commitReplacement = (rangeStart: number, rangeEnd: number, replacement: string) => {
    onChange(value.slice(0, rangeStart) + replacement + value.slice(rangeEnd));
    const caret = rangeStart + replacement.length;
    setTrigger(null);
    setHighlightedId(null);
    requestAnimationFrame(() => {
      const node = innerRef.current;
      if (node === null) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const applyItem = (item: ComposerCommandItem) => {
    if (activeTrigger === null) return;
    if (item.type === "skill" && activeTrigger.kind === "skill") {
      const rangeEnd =
        value[activeTrigger.rangeEnd] === " " ? activeTrigger.rangeEnd + 1 : activeTrigger.rangeEnd;
      commitReplacement(activeTrigger.rangeStart, rangeEnd, `$${item.skill.name} `);
      return;
    }
    if (item.type === "template-placeholder" && activeTrigger.kind === "placeholder") {
      let rangeEnd = activeTrigger.rangeEnd;
      const rest = value.slice(rangeEnd);
      const boundary = rest.search(/[}\s$]/);
      if (boundary !== -1 && rest[boundary] === "}") rangeEnd += boundary + 1;
      commitReplacement(activeTrigger.rangeStart, rangeEnd, item.token);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuVisible || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedRangeStart(activeTrigger?.rangeStart ?? null);
      return;
    }
    if (items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = items.findIndex((item) => item.id === activeItem?.id);
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + offset + items.length) % items.length;
      setHighlightedId(items[nextIndex]?.id ?? null);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && activeItem) {
      event.preventDefault();
      event.stopPropagation();
      applyItem(activeItem);
    }
  };

  return (
    <div ref={setAnchor} className="grid min-h-14 font-mono text-xs leading-[1.6]">
      <div
        aria-hidden
        className="pointer-events-none col-start-1 row-start-1 select-none whitespace-pre-wrap break-words font-mono text-foreground/90 text-xs leading-[1.6]"
      >
        {segments.map((segment, segmentIndex) =>
          segment.kind === "text" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            <span key={segmentIndex}>{segment.text}</span>
          ) : (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
              key={segmentIndex}
              className={cn(
                "rounded-[3px]",
                segment.kind === "artifact"
                  ? "bg-success/12 text-success-foreground"
                  : segment.kind === "skill"
                    ? "bg-accent text-foreground"
                    : "bg-primary/12 text-primary",
              )}
            >
              {segment.text}
            </span>
          ),
        )}
        {value.endsWith("\n") ? " " : null}
      </div>
      <textarea
        ref={assignTextarea}
        aria-label={ariaLabel}
        value={value}
        rows={1}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder={`Implement \${issue_id}. Write your summary to \${artifact}.`}
        className="col-start-1 row-start-1 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent font-mono text-transparent text-xs caret-foreground leading-[1.6] outline-none placeholder:text-muted-foreground/50"
        onChange={(event) => {
          onChange(event.target.value);
          syncTrigger(event.target);
        }}
        onSelect={(event) => syncTrigger(event.currentTarget)}
        onFocus={(event) => {
          setFocused(true);
          syncTrigger(event.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
      />
      {menuVisible ? (
        <StepCommandMenuLayer anchor={anchor}>
          <ComposerCommandMenu
            items={items}
            resolvedTheme={resolvedTheme}
            isLoading={activeTrigger?.kind === "skill" && skills !== null && skills.isPending}
            triggerKind={activeTrigger?.kind === "skill" ? "skill" : null}
            emptyStateText={
              activeTrigger?.kind === "placeholder"
                ? "No matching card fields or artifacts."
                : "No skills found for this agent."
            }
            activeItemId={activeItem?.id ?? null}
            onHighlightedItemChange={setHighlightedId}
            onSelect={applyItem}
          />
        </StepCommandMenuLayer>
      ) : null}
    </div>
  );
}
