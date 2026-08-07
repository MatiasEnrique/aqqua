# Marketing product captures

These scripts record the real Aqqua web client against an isolated, disposable
environment. The repository, conversations, usage, CLI sessions, and pull
request responses are fixtures; the browser interactions, application code,
WebSocket commands, and rendered UI are the product itself.

Raw Playwright recordings are intentionally separate from shipping assets:

1. `seed.ts` creates safe product data and throwaway Git repositories.
2. `setup-phase-b.mjs` provides private, deterministic external-service inputs.
3. `capture.mjs` drives actual Aqqua controls and writes raw WebM clips.
4. Parallel lanes write to separate directories and `merge-captures.mjs` joins
   them without a shared-manifest race.
5. `../remotion` crops the declared product region, trims around interaction
   beats, adds a subtle camera move and an end-to-start dissolve, and renders
   WebM, MP4, and WebP assets into `apps/marketing/public/demos`.

Never point these scripts at `~/.aqqua`. Start the server once against a fresh
base directory so migrations run, stop it before `seed.ts`, then restart it
with the fake home and shims printed by `setup-phase-b.mjs`.

Install the standalone recorder once with `npm ci` from this directory. The
seeder canonicalizes its disposable base path before writing workspace and CLI
session fixtures, so macOS's `/tmp` to `/private/tmp` alias cannot make a real
resume-session lookup miss its cwd-keyed transcript store.

`capture.mjs` accepts `--only slug,slug`, `--output-dir <lane-dir>`, and
`--pair-only`. The server and web ports must always come from the current
`[dev-runner]` line; do not assume the defaults.

After merging the raw lanes, render from the sibling project:

```console
cd ../remotion
DEMO_CAPTURE_DIR=../aqqua/scripts/marketing-capture/raw \
DEMO_OUTPUT_DIR=../aqqua/apps/marketing/public/demos \
npm run demo:render
```

Do not use `npm run demo:synthetic` for anything that ships. That command exists
only to develop the Remotion composition before real footage is available.
