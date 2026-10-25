> **V2:** `scripts/install-v2.ts` uses the agents/prompts/skills below as source
> assets and converts legacy agent fields. See
> [`../docs/install-v2.md`](../docs/install-v2.md). The remaining prose describes
> the historical V1 setup, not automatic V2 model/provider settings.
>
> Installation steps are in [`../docs/install.md`](../docs/install.md).

---

# opencode user config

Personal OpenCode configuration: plugins, custom agents, skills, prompts.

## Layout

```text
.config/opencode/
├── opencode.json
├── oh-my-opencode-slim.jsonc
├── agents/
├── prompts/
├── skills/
├── superpowers/
├── oh-my-opencode-slim/
├── oh-my-opencode-slim-local/
├── plugins/
├── tools/
└── docs/plans/
```

## Fast-lane utility agents

- `@scout` — narrow file/code lookup
- `@validator` — format/syntax check
- `@gist` — 3-line file summarizer

The former best-of-N variant pool (`*-alpha/beta/gamma/delta`) and the
`best-of-n-with-judge` skill are no longer shipped.

## Root orchestrators

- `orchestrator` is Anthropic-primary and may automatically pivot on retry.
- `orchestrator-beta` is the only automatic pivot target and the only fallback-enforcing root identity for Claude child tasks.
- `orchestrator-delta` is a manual GPT root. It inherits root operator posture and reserved-skill access, but it does not force child fallback.

On V2, the three primary profiles remain, but automatic abort/switch/replay
fallback is disabled. Native host selection and user-assigned models take
precedence; the generator installs no private provider names.

Reserved orchestrator-only skill is `update-memory`. Only `orchestrator`, `orchestrator-beta`, and `orchestrator-delta` may invoke it.

## Model assignments

Utility model assignments live centrally in `oh-my-opencode-slim.jsonc` under `presets.superpowers-bridge`. Each entry specifies `model`, optional `variant`, optional `mcps`, and an `orchestratorPrompt` teaching the controller when to dispatch it.

The markdown files in `agents/` carry OpenCode-native behavioral fields (`permission`, `hidden`, `mode`, `temperature`, `description`, `prompt`). OMO Slim does not manage these fields.

`opencode.json` `agent` block should not carry per-variant overrides, because those would shallow-replace OMO Slim's synthesized permissions.
