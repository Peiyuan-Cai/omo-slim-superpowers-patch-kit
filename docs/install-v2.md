# Portable OpenCode V2 install

This installs the local OMO1 orchestration architecture on **OpenCode 2.0.32**
(the tested host), using the three Peiyuan-Cai forks. Use Bun, not Node, to run
the installer and tests; installer tests have been run with **Bun 1.3.1**. OMO's
locked development dependencies include `bun-types` 1.3.12. Other host/Bun
versions are not guaranteed by this guide.

## Prerequisites and checkouts

Connect your own provider in OpenCode first, and choose an available
`provider/model` ID. The installer does not configure authentication, copy a
maintainer's provider, check model availability, or make model/network calls.
Never put API keys in command arguments.

Clone these as sibling directories (or pass explicit paths below):

```sh
git clone https://github.com/Peiyuan-Cai/superpowers-lite.git
git clone https://github.com/Peiyuan-Cai/oh-my-opencode-slim.git
git clone https://github.com/Peiyuan-Cai/omo-slim-superpowers-patch-kit.git

cd oh-my-opencode-slim
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../omo-slim-superpowers-patch-kit
```

Use the V2-capable fork revisions: Lite must contain `server.js`; OMO must
contain `server.js`, `src/v2/agent-files.ts`, and built `dist/v2/index.js`.
**Do not apply the old patch series to these forks.** Lite's server entrypoint
is checked in; it has no separate build step. Keep the checkouts installed at
their chosen paths: the resulting registrations refer directly to them.

## Preview, then apply

Replace `your-provider/your-model` with a model from your connected provider:

```sh
# Default: validate and preview only. Creates no config files/directories.
bun scripts/install-v2.ts --model your-provider/your-model

# Only this explicit flag writes config/assets, after complete validation.
bun scripts/install-v2.ts --model your-provider/your-model --apply
```

All options:

```sh
bun scripts/install-v2.ts \
  --lite "/path with spaces/superpowers-lite" \
  --omo "/path with spaces/oh-my-opencode-slim" \
  --config-dir "/path with spaces/opencode" \
  --model your-provider/your-model \
  --apply
```

Config directory precedence is `--config-dir`, `OPENCODE_CONFIG_DIR`,
`$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode`. Paths are resolved from
the current directory; default checkouts are siblings of this patch kit,
independent of the current directory. If installing into a custom directory,
also use the matching environment/configuration when starting OpenCode.
Project-local config and environment preset overrides are not modified or
resolved by this global installer; they can still override the installation.

The installer never runs git, dependency installation, builds, services, or
models. A missing build produces a command for you to run, not an automatic
build. It **does not restart the OpenCode service**. Reload/restart your own
OpenCode instance when convenient, then check its agent/skill picker. This
installer test suite does not substitute for a live provider/host smoke test.

## Merge and asset policy

- Native `plugins` begins with Lite, then OMO. Legacy `plugin` is normalized;
  only recognized Lite/OMO registrations are replaced. Other plugins and
  their options, providers, MCP servers, credentials, and unrelated settings
  stay intact. Stock Superpowers plus Lite is refused: resolve that conflict
  explicitly rather than loading both.
- If both `.json` and `.jsonc` exist for either host or OMO config, installation
  is refused. Resolve that duplicate yourself. The original selected filename
  is retained; new configs use `.json`.
- JSONC uses the OMO checkout's existing `stripJsonComments` parser. A changed
  config is serialized as JSON **in its original file**, so comments and
  formatting are normalized only on `--apply`, after saving an exact backup.
  Semantically unchanged configs are not rewritten.
- Existing active preset, model chains, reasoning variants, provider options,
  root agents, and preferences are retained. The 32 local roles are completed
  in the active preset: three orchestrators, eight built-in specialists
  (including councillor), laborer, sixteen best-of variants, and four utilities.
  Missing definitions use the supplied shared model, with no reasoning variant
  invented by the installer. Existing definitions/models win. Existing root
  overrides retain OMO's normal runtime precedence.
- A new setup requires `--model provider/model`. For existing setups, omission
  can use an active root/preset orchestrator model (including a chain's first
  model), then the host default model. `--model` fills gaps, not replacements
  for explicit role model assignments. The installer does not check whether
  the chosen model supports vision, tools, or other role-specific features.
- Missing preferences default to preset `superpowers-bridge`,
  `fallback.enabled: false`, `multiplexer.type: none`, `showStartupToast: false`,
  and `superpowersSkillsDir` pointing to the Lite checkout's `skills` directory.
  Explicit existing preferences are not reset (including legacy tmux).
- Shipped `opencode-config/agents`, `prompts`, and `skills` go to the matching
  native directories. Prompt bridges go to
  `oh-my-opencode-slim/<active-preset>/`. Laborer receives its inline role and
  a native leaf/no-delegation contract. Other shipped leaf permissions remain.
- New Markdown agents expand legacy prompt-file references against the
  **source checkout before copying**, and make best-of variants callable in V2.
  Existing supported agent compatibility fields are converted only on explicit
  apply, with backups; user bodies and permissions are preserved. Conflicting
  user asset files are retained and reported as `SKIP`; review those skips to
  decide whether to merge newer shipped content manually.
- Symlinks in managed destination paths or source asset paths are refused,
  never traversed to another asset tree. Unsafe prompt references or invalid
  config fail validation before any config directory/file write.
- Applying the same plan again makes zero changes and creates no new backups.

## Backups and rollback

Each nonempty apply records a timestamped run in
`<config-dir>/migration-backups/`, **outside agent/skill auto-discovery**.
Backup directories are created with mode `0700`; backup files, the manifest,
and written config/assets use `0600`. Existing directory permissions are not
silently changed. All changed pre-existing files are backed up before any
target file is written. The `manifest.json` lists `created` and `updated`
relative paths, without embedding credentials or file contents.

To roll back, close/reload OpenCode as appropriate and inspect the chosen
manifest. Restore each `updated` file from that run's same relative backup
path; remove only the `created` files listed in that manifest **if you have not
since edited them**. Retain other user files. For multiple runs, undo newest
first. Keep backup permissions private: original configs may contain secrets.
Unexpected filesystem/I/O failures during apply can leave a partial install;
the already-written backups/manifest are the recovery record. Validation
failures, in contrast, leave config untouched.

## Focused verification

After building/installing the sibling OMO fork's dependencies:

```sh
bun test tests/install-v2.test.ts
```

These tests spawn separate Bun processes and use temporary homes/config dirs
under `/tmp/opencode` (with a temporary-directory fallback), never the real
global config. They cover preview safety, merge preservation, 32-role output,
model prerequisites, conflict refusals, source prompt migration, backups,
idempotence, and paths containing spaces.
