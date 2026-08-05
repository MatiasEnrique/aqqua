import { useState } from "react";

import { composerSubmitEnabled } from "../PullRequestPanel.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function PullRequestCommentComposer(props: {
  readonly placeholder: string;
  readonly buttonLabel: string;
  readonly compact?: boolean;
  readonly onSubmit: (body: string) => Promise<string | null>;
}) {
  const [body, setBody] = useState("");
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!composerSubmitEnabled(body, pending)) return;
    setPending(true);
    setError(null);
    const failure = await props.onSubmit(body.trim());
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setBody("");
    if (props.compact) setFocused(false);
  };

  if (props.compact && !focused && body.length === 0) {
    return (
      <Input
        readOnly
        value=""
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onFocus={() => setFocused(true)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        autoFocus={props.compact}
        rows={props.compact ? 2 : 3}
        value={body}
        placeholder={props.placeholder}
        disabled={pending}
        onFocus={() => setFocused(true)}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
          if (props.compact && event.key === "Escape" && body.length === 0) setFocused(false);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <p role="alert" className="min-w-0 text-xs text-destructive">
            {error}
          </p>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={!composerSubmitEnabled(body, pending)}
          onClick={() => void submit()}
        >
          {pending ? "Submitting…" : props.buttonLabel}
        </Button>
      </div>
    </div>
  );
}
