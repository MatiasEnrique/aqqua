# Agent Profiles

An agent profile is a named preset that selects the provider target, model,
runtime, permissions, and interaction mode used when aqqua starts an agent. The
same profiles are available in **Settings** → **Agent profiles**.

Profiles are machine-local. They are stored in the aqqua environment's
`settings.json`, not in a project or repository.

## Profiles are a compatibility surface

Naming a provider instance and model directly is now the primary way to say
which agent runs something — see [Agent models](./agent-models.md). Profiles
are kept, and keep working, for three reasons:

- flow steps and spawns written before model-first selection still name a
  profile, and still resolve;
- a saved profile is a convenient preset when you want one name to stand for a
  target plus its model and options;
- a `terminal`-runtime agent is only reachable through a profile. A terminal
  agent is the provider's own CLI in a PTY, which cannot be made to honour a
  chosen model or its options, so direct model selection always launches a
  session instead.

Prefer `agent: { instanceId, model, reasoning? }` in new flow steps and the
model-first spawn flags in new delegation. Nothing here is being removed.

## What a profile resolves to

A profile resolves its provider instance from `target`: an explicit instance,
or the first **enabled** instance of the named driver. It then resolves a model
from, in order, the profile's own `model`, the owning project's default model
when that default targets the instance the profile resolved, and finally a
built-in per-provider fallback. Unlike a canonical agent selection, the model
name is not checked against what that instance advertises.

An unknown profile name fails loudly rather than quietly running as the default
one.

## Managing profiles from the CLI

Use `aqqua profile` to create and manage profiles without opening the web UI:

```sh
aqqua profile list
aqqua profile show reviewer
aqqua profile create reviewer --file reviewer.json
aqqua profile update reviewer --file reviewer.json
aqqua profile delete reviewer
aqqua profile schema
```

`create` fails if a stored profile with that name already exists. `update`
replaces the entire stored definition. Profile names must start with a letter,
may contain letters, numbers, underscores, or dashes, and are limited to 64
characters.

Profile definition files are JSON. Run `aqqua profile schema` for the complete
shape, allowed values, option-id conventions, and a canonical example:

```json
{
  "target": { "kind": "instance", "instanceId": "claudeAgent" },
  "model": "claude-fable-5",
  "options": [{ "id": "effort", "value": "high" }],
  "titlePrefix": "reviewer"
}
```

`target` is required and is what makes a profile different from a canonical
agent selection: it can name a driver rather than an exact instance. It can
select a provider driver, such as
`{"kind":"driver","driver":"codex"}`, or a configured provider instance.
The optional `model` is a free-form slug; omit it to inherit the project's
default. `runtime` is `session` or `terminal`, `runtimeMode` controls access,
and `interactionMode` is `default` or `plan`. For provider options, use
`reasoningEffort` with Codex, Cursor, and Grok, and `effort` with Claude.
OpenCode and pi accept no provider option ids today — omit `options` for those
targets.

The built-in `implementer` profile always appears in `list` and is marked
`built-in` until customized. Updating it creates a stored customization.
Deleting that customization restores the built-in default; the never-customized
built-in profile cannot be deleted.

The CLI uses a running aqqua server when one is available. Otherwise it updates
the environment's settings file directly; a running server also picks up that
file change. Add `--json` to any subcommand for machine-readable output.
