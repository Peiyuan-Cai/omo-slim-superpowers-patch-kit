# OMO1 + Superpowers Lite — three-fork installer

Install Peiyuan-Cai's **OMO1 multi-agent architecture on OpenCode V2** from
three source repositories. This does not upgrade to OMO2/OMO3 or require another
maintainer's private provider. The tested host is OpenCode **2.0.32**.

## Clone, build, preview, apply

Prerequisites: Git, Bun 1.3.1 or newer, and OpenCode V2. Connect your own model
provider in OpenCode and choose a valid `provider/model` ID. Node.js 22 and
Python 3 are used for optional test/host-smoke suites. No credentials are shipped.

```sh
git clone https://github.com/Peiyuan-Cai/superpowers-lite.git
git clone https://github.com/Peiyuan-Cai/oh-my-opencode-slim.git
git clone https://github.com/Peiyuan-Cai/omo-slim-superpowers-patch-kit.git

cd oh-my-opencode-slim
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../omo-slim-superpowers-patch-kit

# Replace this placeholder with an available model from your own provider.
bun scripts/install-v2.ts --model your-provider/your-model
# Review the preview before allowing writes:
bun scripts/install-v2.ts --model your-provider/your-model --apply
```

The installer defaults to sibling clones. Pass `--lite`, `--omo`, or
`--config-dir` for another layout. It defaults to a **read-only dry run**, backs
up changed files on `--apply`, and preserves unrelated providers, MCPs,
credentials, and explicit role models. It does not build, invoke models, restart
services, or modify session data. Read [the full guide](docs/install-v2.md),
including existing-config conflicts, backup, and rollback, before applying.
Reload/restart the intended OpenCode host when convenient after installation.

## Responsibilities and source of truth

| Repository | Role |
| --- | --- |
| [Peiyuan-Cai/oh-my-opencode-slim](https://github.com/Peiyuan-Cai/oh-my-opencode-slim) | Runnable, already-patched OMO1 fork, including V2 adapter and local customizations. |
| [Peiyuan-Cai/superpowers-lite](https://github.com/Peiyuan-Cai/superpowers-lite) | Runnable Lite skills/bootstrap plugin. |
| This repository | Installer, 32-role configuration, native assets, prompt bridges, tests, historical patch provenance. |

**Only Lite and OMO are runtime plugins. Do not register this kit as a plugin.**
The OMO fork is the executable source of truth; this kit does not carry a second
V2 runtime. **Do not apply the historical V1 patches to the fork.** The default
branches are the normal install path; `feat/opencode-v2-compat` also retains the
compatibility source.

## Installed architecture

- Three primary orchestrators, eight OMO1 built-in specialists, laborer,
  sixteen best-of-N variants, and four utilities: **32 roles** in total.
- Your model is the portable default; existing assignments win. Customize roles
  afterward to use different models available from your provider.
- Native agent, base-prompt, best-of-N skill, and prompt-bridge assets.
- Runtime directories ordered Lite then OMO, with an explicit Lite skills path.
  No stock Superpowers fallback, second Lite clone, or fourth repository.

Image tasks need a vision-capable model. Installation does not prove that a
provider supports a model or every role-specific tool.

## Verification and boundaries

```sh
bun test tests/install-v2.test.ts
node tests/prompt-bridge-contract.mjs
cd ../oh-my-opencode-slim
python3 scripts/verify-v2-host.py ../superpowers-lite --mock-model
```

The private-host mock exercises tools, continuation preserving **agent plus
manual model/variant**, native delegation, and two council seats without paid
model calls. Installer tests use temporary configuration only.

V1 automatic replay/fallback, legacy tmux/zellij/TUI surfaces, and transient
countdown notifications are not enabled on V2. Some advanced integrations remain
unverified. See [migration boundaries](docs/opencode-v2-migration.md) and the
[OMO adapter guide](https://github.com/Peiyuan-Cai/oh-my-opencode-slim/blob/feat/opencode-v2-compat/docs/opencode-v2-omo1.md).

## History and attribution

Derived from [BB-84C's patch kit](https://github.com/BB-84C/omo-slim-superpowers-patch-kit).
OMO derives from [alvinunreal/oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)
v1.1.2. Lite retains its authorship and MIT license. See [UPSTREAM.md](UPSTREAM.md)
and [the upstream license](UPSTREAM-LICENSE-oh-my-opencode-slim.txt).

[README.v1.md](README.v1.md), `patches/`, and `snapshots/` retain V1 installation
history. Snapshots are partial comparison material, not runnable checkouts or
the V2 installation route.
