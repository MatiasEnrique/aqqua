# Agent Profiles

An agent profile selects the provider target, model, runtime, permissions, and
interaction mode used when aqqua starts an agent. Flows reference profiles by
name, and the same profiles are available in **Settings** → **Agent profiles**.

Profiles are machine-local. They are stored in the aqqua environment's
`settings.json`, not in a project or repository.

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

`target` is required. It can select a provider driver, such as
`{"kind":"driver","driver":"codex"}`, or a configured provider instance.
The optional `model` is a free-form slug; omit it to inherit the project's
default. `runtime` is `session` or `terminal`, `runtimeMode` controls access,
and `interactionMode` is `default` or `plan`. For provider options, use
`reasoningEffort` with Codex, Cursor, and Grok, and `effort` with Claude.

The built-in `implementer` profile always appears in `list` and is marked
`built-in` until customized. Updating it creates a stored customization.
Deleting that customization restores the built-in default; the never-customized
built-in profile cannot be deleted.

The CLI uses a running aqqua server when one is available. Otherwise it updates
the environment's settings file directly; a running server also picks up that
file change. Add `--json` to any subcommand for machine-readable output.
