import type { ProviderExternalSession } from "@aqqua/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";

export const ComposerResumePicker = memo(function ComposerResumePicker(props: {
  readonly sessions: ReadonlyArray<ProviderExternalSession>;
  readonly supported: boolean | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly providerLabel: string;
  readonly projectRoot: string;
  readonly onSelect: (session: ProviderExternalSession) => void;
  readonly onRequestClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const sessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return props.sessions;
    return props.sessions.filter((session) =>
      [session.title, session.cwd, session.gitBranch, session.sessionId]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalized)),
    );
  }, [props.sessions, query]);

  let emptyCopy = "No CLI conversations found in this project.";
  if (props.error) emptyCopy = props.error;
  else if (props.supported === false) emptyCopy = "Resuming conversations is not supported here.";
  else if (props.isPending) emptyCopy = "Searching CLI conversations…";
  else if (query.trim()) emptyCopy = "No matching conversations.";

  return (
    <div
      className="dropdown-glass flex max-h-[min(32rem,70vh)] w-full flex-col overflow-hidden rounded-xl border border-border/60 shadow-xl"
      data-composer-resume-picker
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor="composer-resume-search" className="sr-only">
          Search earlier conversations
        </label>
        <input
          id="composer-resume-search"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search earlier conversations"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onRequestClose();
          }}
        />
        <button
          type="button"
          onClick={props.onRequestClose}
          aria-label="Close earlier conversation picker"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-1.5">
        {sessions.length > 0 ? (
          <section aria-label={props.providerLabel}>
            <div className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {props.providerLabel}
            </div>
            {sessions.map((session) => {
              const isProjectRoot = session.cwd === props.projectRoot;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => props.onSelect(session)}
                  className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {session.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {session.messageCount > 0 ? (
                        <>
                          <span>{session.messageCount} messages</span>
                          <span aria-hidden="true">·</span>
                        </>
                      ) : null}
                      <span>{formatRelativeTimeLabel(session.updatedAt)}</span>
                      {session.gitBranch ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="max-w-48 truncate">{session.gitBranch}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {!isProjectRoot ? (
                    <code
                      className={cn(
                        "max-w-48 shrink-0 truncate rounded-md bg-muted/70 px-1.5 py-0.5",
                        "text-[10px] text-muted-foreground",
                      )}
                      title={session.cwd}
                    >
                      {session.cwd}
                    </code>
                  ) : null}
                </button>
              );
            })}
          </section>
        ) : (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyCopy}</p>
        )}
      </div>
    </div>
  );
});
