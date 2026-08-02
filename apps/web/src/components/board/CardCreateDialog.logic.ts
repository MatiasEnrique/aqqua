import type { CardParameters, OrchestrationBoard } from "@aqqua/contracts";
import { collectBoardParameterNames } from "@aqqua/shared/boardTemplate";

/**
 * The creation form is generated, never configured: every `${placeholder}`
 * across the board's step templates becomes a field, in first-seen order.
 * Reserved forms (`${artifact}`, `${artifact:step}`, `${card_title}`) are
 * classified out by the shared extractor.
 */
export function boardParameterNames(board: OrchestrationBoard | null): ReadonlyArray<string> {
  if (board === null) return [];
  return collectBoardParameterNames(board.steps.map((step) => step.promptTemplate));
}

/** Fields the user left blank — every parameter has to resolve to something. */
export function missingParameterNames(
  names: ReadonlyArray<string>,
  values: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  return names.filter((name) => (values[name] ?? "").trim() === "");
}

const MAX_TITLE_CHARS = 60;

/**
 * Placeholder title from the parameter values, in template order. The server
 * may replace it with a generated one later; this only has to be recognizable.
 */
export function buildPlaceholderCardTitle(
  names: ReadonlyArray<string>,
  values: Readonly<Record<string, string>>,
): string {
  const parts = names.flatMap((name) => {
    const value = (values[name] ?? "").trim();
    return value === "" ? [] : [value];
  });
  const joined = parts.join(" · ");
  if (joined === "") {
    return "Untitled card";
  }
  return joined.length <= MAX_TITLE_CHARS ? joined : `${joined.slice(0, MAX_TITLE_CHARS - 1)}…`;
}

/** Trimmed values for the named parameters only — stray keys never ship. */
export function toCardParameters(
  names: ReadonlyArray<string>,
  values: Readonly<Record<string, string>>,
): CardParameters {
  const parameters: Record<string, string> = {};
  for (const name of names) {
    parameters[name] = (values[name] ?? "").trim();
  }
  return parameters;
}
