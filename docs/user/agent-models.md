# Agent Models

Every model that every configured provider instance advertises is directly
selectable when its instance is available. Unavailable rows remain visible
with their reason but cannot spawn until the instance is ready. There is no
settings record standing in front of an available row: you name a provider
instance and a model, and that is what runs.

This is the primary way to say which agent does a piece of work — when you
delegate to a sub-agent, and when you author a flow step. [Agent
profiles](./agent-profiles.md) remain supported as a legacy compatibility
surface.

## Agent model

An **agent model** is one provider-instance/model pair. Its identity is the
pair, not the model slug: two instances of the same provider can advertise the
same slug, and they stay separate choices. The instance id is the routing key
and is always exact — nothing is matched by prefix, driver, or display name.

List what this environment offers:

```sh
aqqua agent models
```

The listing covers every model advertised by the configured instances,
including rows whose instance cannot run an agent right now. An unavailable
row is shown with the reason in the provider's own words — not installed,
disabled in aqqua settings, not signed in, or an error the CLI reported. A row
you can fix is more useful than a row that silently disappeared.

The configured project default is marked as the default. With no configured
default, the effective fallback row is marked instead. An unavailable
configured default stays marked but fails clearly when selected.

## Agent selection

An **agent selection** is what one spawn or one flow step asks for: an exact
instance and model, plus an optional reasoning level. The instance and the
model travel together — half a selection is not expressible, so you cannot
accidentally ask for "this instance, whatever model".

```sh
aqqua agent spawn --instance codex --model gpt-5.6-sol --reasoning high --task-file task.md
```

### Defaults and fallback

When a spawn names no model at all, selection falls back in this order:

1. the owning project's default model selection, validated exactly like an
   explicit one — a stale project default fails loudly rather than running
   something else;
2. with no project default, the first instance in the environment's snapshot
   order that can actually host an agent, on that instance's own default model
   (or its first model if it advertises no default).

Snapshot order is stable for a run, so the same environment always falls back
the same way. If nothing can host an agent, the spawn fails and says to enable,
install, or sign in to a provider.

### Reasoning

`reasoning` is a semantic level — the same choice the model picker offers,
such as `low` or `high` — not a provider-native option id. aqqua looks up the
reasoning control the chosen model advertises and writes the level onto that
provider's own option, so `reasoning high` becomes `reasoningEffort=high` on
Codex and `effort=high` on Claude without you naming either.

That means reasoning is discovered from, and validated against, the chosen
model:

- a model that advertises no reasoning control rejects the level and tells you
  to spawn without one;
- a level the model does not advertise is rejected, listing the levels it does
  support;
- omitting `reasoning` leaves the provider's own default in place. aqqua does
  not invent a level, because inventing one would silently outrank what you
  would get from the picker.

Any other provider options already attached to the selection survive
untouched; only the reasoning option is replaced.

## Naming an agent in a flow step

A flow step names its agent canonically through `agent`:

```json
{
  "name": "Plan",
  "agent": {
    "instanceId": "codex",
    "model": "gpt-5.6-sol",
    "reasoning": "high"
  },
  "promptTemplate": "Plan ${card_title}: ${request}"
}
```

A step names its agent exactly one way — `agent`, or the legacy `profileName`.
Both at once is ambiguous and neither leaves the step unrunnable, so a
definition carrying both, or neither, is rejected when you save it.

Flow definitions are authored on one machine and can run on another, so
`instanceId`, `model`, and `reasoning` are **not** checked against a catalog
when the flow is saved. They are checked when the step actually starts, against
the provider snapshots of the environment running the card. `aqqua flow create`
and `aqqua flow update` therefore accept an instance you have never configured;
`--allow-unknown-profiles` has nothing to do with canonical steps and only ever
applies to legacy `profileName`.

When resolution fails at step entry — unknown instance, unavailable instance,
a model that instance does not offer, or an unsupported reasoning level — the
card's operation fails and the card carries that exact reason, so you can fix
the flow or the environment and start it again.

Steps launched this way always run as a normal session, so their reasoning,
tool calls, and file changes render as a regular transcript.

## Legacy agent profiles

Flows and spawns written before model-first selection keep working unchanged.
See [Agent profiles](./agent-profiles.md) for what a profile still resolves,
and for the one thing only a profile can do: run an agent as the provider's own
CLI in a terminal.
