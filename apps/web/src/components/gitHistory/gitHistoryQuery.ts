import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitHistoryCommitSummary,
  VcsListHistoryResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { vcsEnvironment } from "../../state/vcs";

const HISTORY_PAGE_SIZE = 100;
/** First page has no cursor; later pages carry opaque server-issued tokens. */
const INITIAL_CURSORS: ReadonlyArray<string | undefined> = [undefined];

function errorMessage(
  result: AsyncResult.AsyncResult<unknown, unknown> | undefined,
): string | null {
  if (result?._tag !== "Failure") return null;
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Failed to load Git history.";
}

export function combineHistoryPages(
  pages: ReadonlyArray<VcsListHistoryResult>,
): VcsListHistoryResult | null {
  const first = pages[0];
  const last = pages.at(-1);
  if (!first || !last) return null;
  const commitsById = new Map<string, GitHistoryCommitSummary>();
  for (const page of pages) {
    for (const commit of page.commits) {
      if (!commitsById.has(commit.id)) {
        commitsById.set(commit.id, commit);
      }
    }
  }
  return {
    commits: [...commitsById.values()],
    isRepo: first.isRepo,
    nextCursor: last.nextCursor,
    referencesTruncated: pages.some((page) => page.referencesTruncated),
  };
}

export function usePaginatedGitHistory(target: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}) {
  const targetKey = JSON.stringify([target.environmentId, target.cwd]);
  const [pagination, setPagination] = useState<{
    readonly targetKey: string;
    /** Opaque cursors only — never interpret server tokens as offsets. */
    readonly cursors: ReadonlyArray<string | undefined>;
  }>({ targetKey, cursors: INITIAL_CURSORS });
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_CURSORS;
  const pageAtoms = useMemo(
    () =>
      cursors.map((cursor) =>
        vcsEnvironment.listHistory({
          environmentId: target.environmentId,
          input: {
            cwd: target.cwd,
            ...(cursor === undefined ? {} : { cursor }),
            limit: HISTORY_PAGE_SIZE,
          },
        }),
      ),
    [cursors, target.cwd, target.environmentId],
  );
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`web:git-history-pages:${targetKey}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value ? [value] : [];
  });
  const data = combineHistoryPages(values);
  const initialError = errorMessage(results[0]);
  const olderFailure = results.slice(1).find((result) => result._tag === "Failure");
  const olderError = errorMessage(olderFailure);
  const retryOlder = useCallback(() => {
    const failedIndex = results.findIndex(
      (result, index) => index > 0 && result._tag === "Failure",
    );
    const failedPage = failedIndex < 0 ? undefined : pageAtoms[failedIndex];
    if (failedPage) appAtomRegistry.refresh(failedPage);
  }, [pageAtoms, results]);
  const refresh = useCallback(() => {
    const firstPage = pageAtoms[0];
    setPagination({ targetKey, cursors: INITIAL_CURSORS });
    if (firstPage) appAtomRegistry.refresh(firstPage);
  }, [pageAtoms, targetKey]);
  const loadOlder = useCallback(() => {
    const nextCursor = data?.nextCursor;
    if (nextCursor === null || nextCursor === undefined) return;
    setPagination((current) => {
      const currentCursors = current.targetKey === targetKey ? current.cursors : INITIAL_CURSORS;
      return currentCursors.includes(nextCursor)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, nextCursor] };
    });
  }, [data?.nextCursor, targetKey]);

  return {
    data,
    commits: data?.commits ?? [],
    initialError,
    olderError,
    isPending: results[0]?.waiting ?? true,
    isLoadingOlder: results.slice(1).some((result) => result.waiting),
    refresh,
    loadOlder,
    retryOlder,
  };
}
