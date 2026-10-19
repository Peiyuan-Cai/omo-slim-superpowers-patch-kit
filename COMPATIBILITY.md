# Compatibility

## OpenCode V2 migration branch

The maintained Peiyuan-Cai forks target OpenCode 2.0.32 while retaining OMO Slim
1.1.2's architecture and local customizations. Clone the three repositories and
use [`docs/install-v2.md`](docs/install-v2.md). The OMO fork already contains the
bridge/V2 changes; do not apply the historical patches below to it. See
[`docs/opencode-v2-migration.md`](docs/opencode-v2-migration.md) for boundaries.

## Validated OMO basis

This kit supports `oh-my-opencode-slim v1.1.2` on the OMO 1.x line only. OMO 2.x
is unsupported.

Start from upstream v1.1.2 and apply these patches in order:

```text
patches/oh-my-opencode-slim/v1.1.2/0001-superpowers-bridge-rollup.patch
patches/oh-my-opencode-slim/v1.1.2/0002-auto-continue-agent-model-preservation.patch
```

The top-level `0001`-`0007` files and the v1.0.7 rollup are historical reference
material, not the current installation path.

## Superpowers Lite runtime

Use one direct local Superpowers Lite development checkout. It is the supported
runtime source; no commit pin, second clone, junction, alias, stock path, or
automatic upstream fallback is needed. Configure OMO's top-level
`superpowersSkillsDir` to that checkout's `skills` directory. If the path is
absent or unreadable, OMO disables the overlay instead of discovering upstream
Superpowers.

Lite supports Claude Code, Cursor, Copilot CLI, Codex CLI/App, Kimi, OpenCode,
Pi, Antigravity, and Factory-compatible consumers. Gemini is end-of-life and
unsupported.

Local Lite edits take effect after a fresh OpenCode process starts; an already
running process does not reload plugins automatically.

## Nearby versions

Other OMO versions are unvalidated. If the patches do not apply, compare the
affected files against the versioned snapshot before porting the change. The
snapshot is partial and is not a runnable checkout.
