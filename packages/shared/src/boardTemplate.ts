export type BoardTemplatePlaceholder =
  | { kind: "parameter"; name: string }
  | { kind: "artifact-previous" }
  | { kind: "artifact-step"; stepName: string }
  | { kind: "card-title" };

const PLACEHOLDER_RE = /\$\{([^}]*)\}/g;
const PARAMETER_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

function placeholderKey(placeholder: BoardTemplatePlaceholder): string {
  switch (placeholder.kind) {
    case "parameter":
      return `parameter:${placeholder.name}`;
    case "artifact-previous":
      return "artifact-previous";
    case "artifact-step":
      return `artifact-step:${placeholder.stepName}`;
    case "card-title":
      return "card-title";
  }
}

function parsePlaceholderBody(raw: string): BoardTemplatePlaceholder | null {
  if (raw === "artifact") {
    return { kind: "artifact-previous" };
  }
  if (raw.startsWith("artifact:")) {
    return {
      kind: "artifact-step",
      stepName: raw.slice("artifact:".length).trim(),
    };
  }
  if (raw === "card_title") {
    return { kind: "card-title" };
  }
  if (PARAMETER_NAME_RE.test(raw)) {
    return { kind: "parameter", name: raw };
  }
  return null;
}

/**
 * Ordered, deduped placeholders found in a step prompt template.
 * Reserved forms (`artifact`, `artifact:*`, `card_title`) are classified,
 * never returned as parameters.
 */
export function extractBoardTemplatePlaceholders(template: string): BoardTemplatePlaceholder[] {
  const seen = new Set<string>();
  const result: BoardTemplatePlaceholder[] = [];

  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const body = match[1] ?? "";
    const placeholder = parsePlaceholderBody(body);
    if (!placeholder) continue;
    const key = placeholderKey(placeholder);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(placeholder);
  }

  return result;
}

/**
 * Union of parameter names across step templates, first-seen order.
 * Drives the card-creation form fields.
 */
export function collectBoardParameterNames(templates: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const template of templates) {
    for (const placeholder of extractBoardTemplatePlaceholders(template)) {
      if (placeholder.kind !== "parameter") continue;
      if (seen.has(placeholder.name)) continue;
      seen.add(placeholder.name);
      names.push(placeholder.name);
    }
  }

  return names;
}

export type BoardTemplateRenderValues = {
  parameters: Record<string, string>;
  artifactPathForPrevious: string | null;
  artifactPathForStep: (stepName: string) => string | null;
  cardTitle: string;
};

/**
 * Substitute placeholders. Unknown or unresolvable forms stay verbatim and are
 * listed in `missing` (server decides how to react).
 */
export function renderBoardTemplate(
  template: string,
  values: BoardTemplateRenderValues,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const missingSeen = new Set<string>();

  const reportMissing = (label: string) => {
    if (missingSeen.has(label)) return;
    missingSeen.add(label);
    missing.push(label);
  };

  const text = template.replace(PLACEHOLDER_RE, (full, body: string) => {
    const placeholder = parsePlaceholderBody(body);
    if (!placeholder) {
      reportMissing(body);
      return full;
    }

    switch (placeholder.kind) {
      case "parameter": {
        if (!Object.prototype.hasOwnProperty.call(values.parameters, placeholder.name)) {
          reportMissing(placeholder.name);
          return full;
        }
        return values.parameters[placeholder.name]!;
      }
      case "artifact-previous": {
        if (values.artifactPathForPrevious === null) {
          reportMissing("artifact");
          return full;
        }
        return values.artifactPathForPrevious;
      }
      case "artifact-step": {
        const path = values.artifactPathForStep(placeholder.stepName);
        if (path === null) {
          reportMissing(`artifact:${placeholder.stepName}`);
          return full;
        }
        return path;
      }
      case "card-title":
        return values.cardTitle;
    }
  });

  return { text, missing };
}
