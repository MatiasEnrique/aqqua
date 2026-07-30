import { describe, expect, it } from "vite-plus/test";

import {
  collectBoardParameterNames,
  extractBoardTemplatePlaceholders,
  renderBoardTemplate,
} from "./boardTemplate.ts";

describe("extractBoardTemplatePlaceholders", () => {
  it("extracts parameters, artifacts, and card_title in order and dedupes", () => {
    const template =
      "Title ${card_title}: do ${ticket_id} then ${ticket_id} with ${artifact} and ${artifact:Plan}";
    expect(extractBoardTemplatePlaceholders(template)).toEqual([
      { kind: "card-title" },
      { kind: "parameter", name: "ticket_id" },
      { kind: "artifact-previous" },
      { kind: "artifact-step", stepName: "Plan" },
    ]);
  });

  it("treats reserved names as non-parameters and trims artifact step names", () => {
    const template = "Use ${artifact:  Review Notes  } and ${artifact} not ${card_title}";
    expect(extractBoardTemplatePlaceholders(template)).toEqual([
      { kind: "artifact-step", stepName: "Review Notes" },
      { kind: "artifact-previous" },
      { kind: "card-title" },
    ]);
  });

  it("ignores invalid placeholder bodies", () => {
    expect(extractBoardTemplatePlaceholders("bad ${1ticket} and ${has space}")).toEqual([]);
  });

  it("allows underscore-leading parameter names", () => {
    expect(extractBoardTemplatePlaceholders("x ${_private}")).toEqual([
      { kind: "parameter", name: "_private" },
    ]);
  });
});

describe("collectBoardParameterNames", () => {
  it("unions parameter names across steps in first-seen order", () => {
    const names = collectBoardParameterNames([
      "Plan ${ticket_id} for ${repo}",
      "Implement ${ticket_id} with ${artifact} and ${branch}",
      "PR ${branch} titled ${card_title}",
    ]);
    expect(names).toEqual(["ticket_id", "repo", "branch"]);
  });

  it("returns empty when only reserved placeholders are used", () => {
    expect(
      collectBoardParameterNames(["${artifact}", "${card_title}", "${artifact:Plan}"]),
    ).toEqual([]);
  });
});

describe("renderBoardTemplate", () => {
  it("substitutes resolved placeholders", () => {
    const result = renderBoardTemplate(
      "Card ${card_title}: ${ticket_id} prev=${artifact} plan=${artifact:Plan}",
      {
        parameters: { ticket_id: "SHIP-1" },
        artifactPathForPrevious: "/artifacts/implement.md",
        artifactPathForStep: (stepName) => (stepName === "Plan" ? "/artifacts/plan.md" : null),
        cardTitle: "Ship it",
      },
    );
    expect(result.text).toBe(
      "Card Ship it: SHIP-1 prev=/artifacts/implement.md plan=/artifacts/plan.md",
    );
    expect(result.missing).toEqual([]);
  });

  it("leaves unknown and unresolvable placeholders verbatim and reports missing", () => {
    const result = renderBoardTemplate(
      "A ${ticket_id} B ${missing_param} C ${artifact} D ${artifact:Plan} E ${1bad}",
      {
        parameters: { ticket_id: "SHIP-1" },
        artifactPathForPrevious: null,
        artifactPathForStep: () => null,
        cardTitle: "Ship",
      },
    );
    expect(result.text).toBe(
      "A SHIP-1 B ${missing_param} C ${artifact} D ${artifact:Plan} E ${1bad}",
    );
    expect(result.missing).toEqual(["missing_param", "artifact", "artifact:Plan", "1bad"]);
  });

  it("dedupes missing labels across repeated unresolvable placeholders", () => {
    const result = renderBoardTemplate("${x} ${x} ${artifact} ${artifact}", {
      parameters: {},
      artifactPathForPrevious: null,
      artifactPathForStep: () => null,
      cardTitle: "t",
    });
    expect(result.missing).toEqual(["x", "artifact"]);
  });
});
