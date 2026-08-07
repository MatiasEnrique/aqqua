# Marketing product captures

Shipping marketing assets must come from the real Aqqua client running against
an isolated, disposable environment. Never point this harness at
`~/.aqqua/userdata`, and never use an existing project as demo material.

The current asset set uses one video and ten screenshots:

- `orchestration` is a real browser recording of a Claude parent thread running
  `aqqua agent spawn`, with its actual Codex and pi children visible in the
  sub-agent popover. The sibling `../remotion` project trims and encodes that
  recording into MP4, WebM, and a WebP poster.
- Every other demo is a direct screenshot of the running product. The Git
  history, worktrees, thread tabs, flow, queue, project picker, provider/model
  picker, usage ledger, and `/resume` session all came from real operations in
  newly created demo repositories.
- The pull-request screenshot uses the real Aqqua pull-request panel and real
  commits from the disposable repository. `setup-capture-home.mjs` supplies the
  external GitHub CLI boundary locally so capture never creates or mutates a
  GitHub repository.

Start with a fresh temporary base and create only the throwaway repositories:

```console
node scripts/marketing-capture/seed.ts --base-dir <temporary-base> --repos-only
```

Before the first server start, install the capture shims:

```console
node scripts/marketing-capture/setup-capture-home.mjs \
  --base-dir <temporary-base> \
  --shims-only
```

Start the isolated server with the command it prints. Its shell keeps the Grok
shim ahead of the real xAI CLI while preserving the inherited paths for the
authenticated providers used in the real orchestration.

Add the repositories as projects, then create the threads, worktrees, flow,
queued turn, and agents through normal product commands. For Usage and
`/resume`, run real CLI sessions from inside the demo repository. Stop the
server, then prepare the capture-only HOME:

```console
node scripts/marketing-capture/setup-capture-home.mjs \
  --base-dir <temporary-base> \
  --source-home "$HOME"
```

The full setup copies only Claude and Codex transcripts whose recorded cwd is
inside the disposable base. Restart using the HOME, SHELL, and PATH it prints.
Read the server and web ports from the current `[dev-runner]` line rather than
assuming defaults.

Render the real orchestration recording from the sibling project:

```console
cd ../remotion
DEMO_CAPTURE_DIR=../aqqua/scripts/marketing-capture/raw-real \
DEMO_OUTPUT_DIR=../aqqua/apps/marketing/public/demos \
npm run demo:render
```

The older projection seeding mode (`seed.ts` without `--repos-only`) and
`capture.mjs` remain useful for developing capture choreography. They are
fixtures and must not be used for assets that ship. Likewise, never ship output
from `npm run demo:synthetic`.
