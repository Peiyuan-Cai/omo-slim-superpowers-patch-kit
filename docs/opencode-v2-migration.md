# Keep the OMO1 architecture on OpenCode V2

The maintained fork branches port the existing patched OMO Slim
1.1.2 + Lite combination to OpenCode 2.0.32. This does not mean upgrading to OMO2
or OMO3. OMO's version and OpenCode's version are different version axes.

Implementation lives in the **plugin repositories**, not a second external
runtime:

- OMO: `src/v2/`, root `server.js`, and package `./server` export.
- Lite: root `server.js`, package `./server`, shared existing skill/bootstrap
  policy, and V1 entrypoint-specific tool mapping.
- This kit: V2 configuration example and coordination/verification guidance.
  Historical V1 patches and snapshots are unchanged.

The OMO fork publishes the complete local OMO1 baseline, including custom work
beyond the historical snapshot and the V2 adapter. Use the fork directly: there
is no incremental V2 patch to apply after the old 0001/0002 pair. Applying those
again would duplicate changes. Executable source lives only in the OMO fork.

## Enable only after private validation

Start with [the portable installer](install-v2.md). For existing installations:

1. Keep the existing Lite checkout and shared skills; do not install stock
   Superpowers alongside Lite.
2. Build the OMO migration branch and read its `docs/opencode-v2-omo1.md` feature
   matrix. The old architecture is preserved, but V1 replay fallback, legacy
   multiplexer/TUI features, and countdown notifications are not enabled on V2.
3. Run both plugins' focused tests and OMO's private-host smoke:

   ```sh
   bun run build
   python3 scripts/verify-v2-host.py /absolute/path/to/superpowers-lite --mock-model
   ```

4. Back up host configuration, then merge
   `config-templates/opencode.v2.plugin-snippet.jsonc`, replacing only the old
   plugin registrations. Preserve provider credentials, MCPs, prompts, custom
   agent files, and the existing OMO `superpowers-bridge` preset.
   Preview OMO's `scripts/migrate-v2-agent-files.ts <config-dir>` and explicitly
   apply it when ready: V2's host-precedence Markdown fields otherwise keep
   best-of-N agents hidden and ignore their V1 prompt references. The helper
   backs up changed files and preserves their base plus variant methodology.
5. Reload/restart the intended host as a separate operator action. Merely
   checking out these branches does not enable the new global registrations.

## Required behavioral gates

- All expected OMO1 specialist agents, custom variants, models, and prompts
  survive. Primary orchestrator variants stay primary; read-only roles stay
  read-only. No OMO2/3 architecture is substituted.
- Auto-continue preserves the **active orchestrator variant and active model
  override together**, including reasoning variant and changes during cooldown.
  It must not reset either to a preset default.
- V2 errors and explicit user interruption never count as successful idle.
- V1 `noReply` countdown/status messages must not be queued as real V2 prompts:
  doing so can create an extra model turn. Omit the transient notification.
- Test native delegation and council model routing against a local mock
  provider before using paid providers. A registry-only check is insufficient.
- Keep global config and the shared service untouched during tests. Test preset
  persistence only under temporary config directories.

V2's native agent selector does not automatically change a session's separately
stored model. Select the desired model explicitly when switching primary agents.
