import type { CardActionAvailability, CardOperationKind } from "@aqqua/client-runtime/state/boards";
import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CardComposerActions, type CardComposerActionsProps } from "./CardComposerActions";

const availability: CardActionAvailability = {
  operation: null,
  canReset: false,
  canRetry: false,
  canContinue: false,
};

function render(overrides: Partial<CardComposerActionsProps> = {}) {
  const props: CardComposerActionsProps = {
    promptHasText: false,
    disabled: false,
    availability,
    operation: null,
    canResumeWithoutMessage: true,
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onMarkDone: vi.fn(),
    onReset: vi.fn(),
    isLastStep: false,
    ...overrides,
  };
  return CardComposerActions(props) as ReactElement<{
    readonly children: ReactNode;
  }>;
}

function primaryButton(overrides: Partial<CardComposerActionsProps> = {}) {
  return Children.toArray(render(overrides).props.children)[0] as ReactElement<{
    readonly disabled: boolean;
    readonly children: ReactNode;
  }>;
}

function menuItems(overrides: Partial<CardComposerActionsProps> = {}) {
  const menu = Children.toArray(render(overrides).props.children)[1] as ReactElement<{
    readonly children: ReactNode;
  }>;
  const popup = Children.toArray(menu.props.children)[1] as ReactElement<{
    readonly children: ReactNode;
  }>;
  return Children.toArray(popup.props.children) as ReadonlyArray<
    ReactElement<{ readonly disabled?: boolean }>
  >;
}

/** Menu order: Resume, Retry, Mark done, separator, Reset. */
const RETRY_ITEM = 1;
const RESET_ITEM = 4;

describe("CardComposerActions", () => {
  it("mutes Resume when the empty composer cannot advance directly", () => {
    expect(primaryButton({ canResumeWithoutMessage: false }).props.disabled).toBe(true);
  });

  it("keeps Resume enabled for a paused step that can advance without a message", () => {
    expect(primaryButton().props.disabled).toBe(false);
  });

  it("enables full-card reset for a failed step", () => {
    expect(
      menuItems({ availability: { ...availability, canReset: true } })[RESET_ITEM]?.props.disabled,
    ).toBe(false);
  });

  it("offers retry once the step is flagged", () => {
    expect(
      menuItems({ availability: { ...availability, canRetry: true } })[RETRY_ITEM]?.props.disabled,
    ).toBe(false);
  });

  it("says what it is doing while an operation is in flight", () => {
    const labels: ReadonlyArray<readonly [CardOperationKind, string]> = [
      ["advancing", "Resuming…"],
      ["retrying", "Retrying…"],
      ["resetting", "Resetting…"],
      ["starting", "Starting…"],
      ["deleting", "Deleting…"],
    ];

    for (const [operation, label] of labels) {
      expect(primaryButton({ operation }).props.children).toBe(label);
    }
    expect(primaryButton().props.children).toBe("Resume");
  });

  it("locks every action from the click until the operation is projected", () => {
    // The local guard arrives before the server clears availability, so the
    // pending operation alone has to be enough to close the buttons.
    const pending: Partial<CardComposerActionsProps> = {
      operation: "advancing",
      availability: {
        operation: null,
        canReset: true,
        canRetry: true,
        canContinue: true,
      },
    };

    expect(primaryButton(pending).props.disabled).toBe(true);
    for (const item of menuItems(pending)) {
      expect(item.props.disabled ?? true).toBe(true);
    }
  });

  it("blocks a second send while the card is already advancing", () => {
    const submit = render({
      promptHasText: true,
      operation: "advancing",
    }) as unknown as ReactElement<{
      readonly disabled: boolean;
    }>;
    expect(submit.props.disabled).toBe(true);
  });
});
