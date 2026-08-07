import { useCallback, useMemo, type RefObject } from "react";

import type { PreviewAnnotationPayload, ScopedThreadRef } from "@aqqua/contracts";

import {
  useComposerDraftStore,
  type ComposerImageAttachment,
  type ComposerResumeSessionSelection,
  type DraftId,
} from "../../composerDraftStore";
import type { ElementContextDraft } from "../../lib/elementContext";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import type { ReviewCommentContext } from "../../reviewCommentContext";

type ComposerThreadTarget = ScopedThreadRef | DraftId;
import { isComposerDraftUntouched, mergeComposerDraftForRetry } from "../ChatView.logic";

/**
 * Everything a submission takes out of the composer, kept so a failed send or
 * queue can put it back.
 */
export interface ComposerDraftContent {
  readonly prompt: string;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly elementContexts: ReadonlyArray<ElementContextDraft>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly resumeSession: ComposerResumeSessionSelection | null;
}

export interface ComposerSubmissionLifecycleRefs {
  readonly promptRef: RefObject<string>;
  readonly composerImagesRef: RefObject<ComposerImageAttachment[]>;
  readonly composerTerminalContextsRef: RefObject<TerminalContextDraft[]>;
  readonly composerElementContextsRef: RefObject<ElementContextDraft[]>;
  readonly resetCursorState: (state?: {
    cursor: number;
    prompt: string;
    detectTrigger: boolean;
  }) => void;
  readonly collapseCursor: (prompt: string, cursor: number) => number;
}

/**
 * Both submission paths — send and queue — take the same content out of the
 * composer and, on failure, have to put it back. They differ only in *when*
 * they release the draft, which is what decides how a restore may behave:
 *
 * - queue releases before the RPC, so a failure merges the submitted content
 *   back in ahead of anything typed since.
 * - send holds the draft across the RPC, so a failure restores only while the
 *   composer is still untouched.
 *
 * This hook owns those two strategies and the store writes they share, so the
 * call sites state the intent instead of re-listing every draft slice.
 */
export function useComposerSubmissionLifecycle(input: {
  readonly target: ComposerThreadTarget;
  readonly refs: ComposerSubmissionLifecycleRefs;
}) {
  const { target, refs } = input;
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addImages = useComposerDraftStore((store) => store.addImages);
  const setTerminalContexts = useComposerDraftStore((store) => store.setTerminalContexts);
  const setElementContexts = useComposerDraftStore((store) => store.setElementContexts);
  const setPreviewAnnotations = useComposerDraftStore((store) => store.setPreviewAnnotations);
  const setReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const setResumeSession = useComposerDraftStore((store) => store.setResumeSession);
  const clearComposerContent = useComposerDraftStore((store) => store.clearComposerContent);
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  /** Empty the composer and its mirrored refs; the caller keeps the snapshot. */
  const releaseDraft = useCallback(() => {
    refs.promptRef.current = "";
    clearComposerContent(target);
    setResumeSession(target, null);
    refs.resetCursorState();
  }, [clearComposerContent, refs, setResumeSession, target]);

  const writeDraft = useCallback(
    (content: ComposerDraftContent) => {
      const images = [...content.images];
      const terminalContexts = [...content.terminalContexts];
      const elementContexts = [...content.elementContexts];
      refs.promptRef.current = content.prompt;
      refs.composerImagesRef.current = images;
      refs.composerTerminalContextsRef.current = terminalContexts;
      refs.composerElementContextsRef.current = elementContexts;
      setPrompt(target, content.prompt);
      addImages(target, images);
      setTerminalContexts(target, terminalContexts);
      setElementContexts(target, elementContexts);
      setPreviewAnnotations(target, content.previewAnnotations);
      setReviewComments(target, content.reviewComments);
      setResumeSession(target, content.resumeSession);
      refs.resetCursorState({
        cursor: refs.collapseCursor(content.prompt, content.prompt.length),
        prompt: content.prompt,
        detectTrigger: true,
      });
    },
    [
      addImages,
      refs,
      setElementContexts,
      setPreviewAnnotations,
      setPrompt,
      setResumeSession,
      setReviewComments,
      setTerminalContexts,
      target,
    ],
  );

  /**
   * Queue-path restore: the draft was already released, so merge the submitted
   * content back in ahead of anything typed since.
   */
  const restoreDraftMerging = useCallback(
    (snapshot: ComposerDraftContent): void => {
      const currentDraft = getComposerDraft(target);
      const merged = mergeComposerDraftForRetry({
        snapshot,
        currentDraft,
      });
      // Clear first: `addImages` appends, so writing over a populated draft
      // would duplicate every attachment the merge already accounted for.
      clearComposerContent(target);
      writeDraft(merged);
    },
    [clearComposerContent, getComposerDraft, target, writeDraft],
  );

  /**
   * Send-path restore: the draft was held across the RPC, so only put it back
   * while the composer is still empty. Returns whether the restore happened.
   */
  const restoreDraftIfUntouched = useCallback(
    (
      snapshot: ComposerDraftContent,
      options?: {
        readonly transformImages?: (
          images: ReadonlyArray<ComposerImageAttachment>,
        ) => ComposerImageAttachment[];
      },
    ): boolean => {
      const currentDraft = getComposerDraft(target);
      const untouched = isComposerDraftUntouched({
        prompt: refs.promptRef.current,
        imageCount: refs.composerImagesRef.current.length,
        terminalContextCount: refs.composerTerminalContextsRef.current.length,
        elementContextCount: refs.composerElementContextsRef.current.length,
        previewAnnotationCount: currentDraft?.previewAnnotations.length ?? 0,
        reviewCommentCount: currentDraft?.reviewComments.length ?? 0,
      });
      if (!untouched) {
        return false;
      }
      writeDraft({
        ...snapshot,
        images: options?.transformImages
          ? options.transformImages(snapshot.images)
          : [...snapshot.images],
      });
      return true;
    },
    [getComposerDraft, refs, target, writeDraft],
  );

  return useMemo(
    () => ({ releaseDraft, restoreDraftMerging, restoreDraftIfUntouched }),
    [releaseDraft, restoreDraftIfUntouched, restoreDraftMerging],
  );
}
