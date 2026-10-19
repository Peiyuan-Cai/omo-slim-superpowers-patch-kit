#!/usr/bin/env bun
// Local-only installer: build a complete in-memory plan before any write.
import {
  accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, renameSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ObjectValue = Record<string, any>;
type Change = { path: string; content: string; before?: string };
const kit = resolve(import.meta.dir, '..');
const usage = 'bun scripts/install-v2.ts [--lite path] [--omo path] [--config-dir path] [--model provider/model] [--apply]';

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as ObjectValue;
}

// Reject links in managed paths, including missing paths' existing ancestors.
// Do not follow a user asset directory or prompt reference outside its tree.
function noLinks(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) break;
  }
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Asset reference escapes its tree: ${path}`);
  }
  noLinks(path);
}

function files(root: string): string[] {
  noLinks(root);
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    if (entry.isDirectory()) result.push(...files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported asset: ${path}`);
  }
  return result;
}

async function main() {
  const options: Record<string, string> = {};
  let apply = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); return; }
    if (arg === '--apply') { apply = true; continue; }
    if (!['--lite', '--omo', '--config-dir', '--model'].includes(arg) ||
      !args[i + 1] || args[i + 1].startsWith('--') || options[arg] !== undefined) {
      throw new Error(`Invalid arguments. Usage: ${usage}`);
    }
    options[arg] = args[++i];
  }
  const lite = resolve(options['--lite'] ?? join(kit, '../superpowers-lite'));
  const omo = resolve(options['--omo'] ?? join(kit, '../oh-my-opencode-slim'));
  const configDir = resolve(options['--config-dir'] ??
    (process.env.OPENCODE_CONFIG_DIR?.trim() ||
      join(process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config'), 'opencode')));
  noLinks(configDir);

  const build = `cd ${JSON.stringify(omo)} && bun install --frozen-lockfile --ignore-scripts && bun run build`;
  for (const path of [join(lite, 'server.js'), join(omo, 'server.js'), join(omo, 'dist/v2/index.js')]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Missing V2 entrypoint: ${path}. Clone the Peiyuan-Cai V2 forks, then run: ${build}`);
    }
  }
  if (!existsSync(join(lite, 'skills'))) throw new Error(`Missing Lite skills: ${join(lite, 'skills')}`);

  // Use the selected checkout's canonical JSONC parser and V1->V2 migration.
  // Absolute file URLs also handle checkout names containing spaces.
  let stripJsonComments: (source: string) => string;
  let migrateAgentFile: (file: string, source: string) => string;
  let schema: { safeParse(value: unknown): { success: boolean } };
  try {
    ({ stripJsonComments } = await import(pathToFileURL(join(omo, 'src/cli/config-io.ts')).href));
    ({ migrateAgentFile } = await import(pathToFileURL(join(omo, 'src/v2/agent-files.ts')).href));
    ({ PluginConfigSchema: schema } = await import(pathToFileURL(join(omo, 'src/config/schema.ts')).href));
  } catch {
    throw new Error(`Cannot load OMO installer helpers. Use the complete V2 checkout and run: ${build}`);
  }
  function parse(path: string): ObjectValue {
    try { return object(JSON.parse(stripJsonComments(readFileSync(path, 'utf8'))), 'Configuration'); }
    catch { throw new Error(`Invalid JSON/JSONC object: ${path}`); } // Never echo credentials or JSON snippets.
  }
  function choose(base: string) {
    const json = join(configDir, `${base}.json`);
    const jsonc = join(configDir, `${base}.jsonc`);
    noLinks(json); noLinks(jsonc);
    if (existsSync(json) && existsSync(jsonc)) throw new Error(`Both ${base}.json and ${base}.jsonc exist; resolve the duplicate before installing.`);
    return existsSync(jsonc) ? jsonc : json;
  }
  const hostPath = choose('opencode');
  const omoPath = choose('oh-my-opencode-slim');
  const host = existsSync(hostPath) ? parse(hostPath) : {};
  const config = existsSync(omoPath) ? parse(omoPath) : {};
  const changes: Change[] = [];
  const skips: string[] = [];

  function plan(path: string, content: string) {
    within(configDir, path);
    if (existsSync(path) && !lstatSync(path).isFile()) throw new Error(`Expected a file: ${path}`);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (before !== content) changes.push({ path, content, before });
  }
  function planJson(path: string, value: ObjectValue) {
    // Keep untouched JSONC comments/formatting when no semantic change is needed.
    if (existsSync(path) && JSON.stringify(parse(path)) === JSON.stringify(value)) return;
    plan(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  function registrations(value: unknown, name: string): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
    for (const entry of value) {
      if (typeof entry !== 'string' &&
        !(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1])) &&
        !(entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as ObjectValue).package === 'string')) {
        throw new Error(`Unsupported entry in ${name}; resolve it before installing.`);
      }
    }
    return value.map(entry => Array.isArray(entry) ? { package: entry[0], options: entry[1] } : entry);
  }
  function pluginKind(entry: unknown): 'managed' | 'stock' | 'other' {
    const spec = (typeof entry === 'string' ? entry : (entry as ObjectValue).package) as string;
    let normalized = spec.replaceAll('\\', '/');
    if (normalized.startsWith('file://')) {
      try { normalized = fileURLToPath(normalized).replaceAll('\\', '/'); }
      catch { throw new Error('Invalid file URL in plugin registration'); }
    }
    const segments = normalized.split('/');
    // Match complete package/path components, not similarly named unrelated plugins.
    if (segments.some(part => /^(?:superpowers-lite|oh-my-opencode-slim)(?:@[^/]*)?$/.test(part)) ||
      normalized === lite || normalized === omo || normalized.startsWith(`${lite}/`) || normalized.startsWith(`${omo}/`)) return 'managed';
    if (segments.some(part => /^superpowers(?:@[^/]*)?$/.test(part)) ||
      /(?:^|\/)\.opencode\/plugins\/superpowers\.(?:js|ts)$/.test(normalized)) return 'stock';
    // A renamed local checkout can still identify itself by package name.
    if (isAbsolute(normalized) || normalized.startsWith('.')) {
      let dir = resolve(normalized);
      while (true) {
        const pkg = join(dir, 'package.json');
        if (existsSync(pkg)) {
          try {
            const name = JSON.parse(readFileSync(pkg, 'utf8')).name;
            if (name === 'superpowers-lite' || name === 'oh-my-opencode-slim') return 'managed';
            if (name === 'superpowers') return 'stock';
          } catch { /* Unrelated package metadata is not ours to change. */ }
          break;
        }
        if (dirname(dir) === dir) break;
        dir = dirname(dir);
      }
    }
    return 'other';
  }
  const previousPlugins = [...registrations(host.plugins, 'plugins'), ...registrations(host.plugin, 'plugin')];
  const kept: unknown[] = [];
  for (const entry of previousPlugins) {
    const kind = pluginKind(entry);
    if (kind === 'stock') throw new Error('Ambiguous stock Superpowers coexistence. Remove/disable stock Superpowers explicitly before installing Lite.');
    if (kind === 'other') kept.push(entry);
  }
  delete host.plugin;
  host.plugins = [lite, omo, ...kept];
  host.$schema ??= 'https://opencode.ai/config.json';

  config.preset ??= 'superpowers-bridge';
  if (typeof config.preset !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(config.preset)) {
    throw new Error('Active OMO preset must be a safe directory name (letters, digits, underscores, hyphens).');
  }
  const presets = object(config.presets ??= {}, 'OMO presets');
  const selected = object(presets[config.preset] ??= {}, 'Selected OMO preset');
  const rootAgents = object(config.agents ?? {}, 'OMO root agents');
  function firstModel(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return firstModel(value[0]);
    if (value && typeof value === 'object') return firstModel((value as ObjectValue).id);
  }
  // Existing active orchestrator assignments are preferable to the host fallback.
  const model = options['--model'] ?? firstModel(rootAgents.orchestrator?.model) ??
    firstModel(selected.orchestrator?.model) ??
    firstModel(rootAgents['orchestrator-beta']?.model) ?? firstModel(selected['orchestrator-beta']?.model) ??
    firstModel(rootAgents['orchestrator-delta']?.model) ?? firstModel(selected['orchestrator-delta']?.model) ??
    firstModel(host.model);
  if (!model || !/^[^/\s]+\/[^\s]+$/.test(model)) {
    throw new Error('A connected provider is required. Supply --model provider/model (or configure an existing active orchestrator/host model).');
  }
  const template = parse(join(kit, 'config-templates/oh-my-opencode-slim.superpowers-bridge.jsonc'));
  const roles = object(template.presets['superpowers-bridge'], 'Shipped role template');
  if (Object.keys(roles).length !== 32) throw new Error('Expected the 32 shipped local roles.');
  for (const name of Object.keys(roles)) {
    if (selected[name] !== undefined) {
      const existing = object(selected[name], `Selected role ${name}`);
      // Never replace an explicit preset model, variant, options, or custom prompt.
      // A root assignment also prevents a default from shadowing user intent.
      if (existing.model === undefined && rootAgents[name]?.model === undefined) existing.model = model;
      continue;
    }
    const definition: ObjectValue = { model };
    if (name === 'laborer') {
      definition.skills = [];
      definition.mcps = [];
      definition.prompt = roles.laborer.prompt;
      definition.orchestratorPrompt = roles.laborer.orchestratorPrompt;
    } else if (!['orchestrator', 'oracle', 'librarian', 'explorer', 'designer', 'fixer', 'observer', 'council', 'councillor'].includes(name) && !name.startsWith('orchestrator-')) {
      definition.orchestratorPrompt = `@${name}: Follow the shipped ${name} agent contract; use only for its bounded specialist role.`;
    }
    selected[name] = definition;
  }
  config.showStartupToast ??= false;
  config.$schema ??= pathToFileURL(join(omo, 'oh-my-opencode-slim.schema.json')).href;
  config.disabled_agents ??= [];
  config.superpowersSkillsDir ??= join(lite, 'skills');
  object(config.fallback ??= {}, 'OMO fallback').enabled ??= false;
  // A legacy explicit tmux preference must not be silently disabled.
  if (config.tmux === undefined || config.multiplexer !== undefined) {
    object(config.multiplexer ??= {}, 'OMO multiplexer').type ??= 'none';
  }
  if (!schema.safeParse(config).success) {
    throw new Error('OMO configuration does not match this checkout\'s schema; fix its existing settings before installing. No files were written.');
  }
  planJson(hostPath, host);
  planJson(omoPath, config);

  function migrated(path: string, source: string, root: string) {
    // Guard the legacy helper's file reads, which otherwise follow arbitrary references.
    const header = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    const reference = header?.match(/^prompt:\s*["']?\{file:(.+?)\}["']?\s*$/m)?.[1];
    if (reference) {
      if (reference.startsWith('~/')) throw new Error(`Home-relative asset prompt refused: ${path}`);
      within(root, resolve(dirname(path), reference));
    }
    try { return migrateAgentFile(path, source); }
    catch { throw new Error(`Cannot expand agent prompt for ${path}; check its referenced prompt file. No files were written.`); }
  }
  function asset(source: string, destination: string, agent = false) {
    within(configDir, destination);
    const raw = readFileSync(source, 'utf8');
    // Expand against the SOURCE tree, not a destination prompt not copied yet.
    const content = agent ? migrated(source, raw, join(kit, 'opencode-config')) : raw;
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile()) throw new Error(`Expected asset file: ${destination}`);
      const existing = readFileSync(destination, 'utf8');
      const converted = agent ? migrated(destination, existing, configDir) : existing;
      if (converted !== content) skips.push(relative(configDir, destination));
      // Migration changes compatibility fields only, preserving user bodies/permissions.
      if (converted !== existing) plan(destination, converted);
    } else plan(destination, content);
  }
  for (const category of ['agents', 'prompts', 'skills']) {
    const sourceRoot = join(kit, 'opencode-config', category);
    for (const source of files(sourceRoot)) asset(source, join(configDir, category, relative(sourceRoot, source)), category === 'agents' && source.endsWith('.md'));
  }
  for (const source of files(join(kit, 'prompt-bridges'))) {
    asset(source, join(configDir, 'oh-my-opencode-slim', config.preset, relative(join(kit, 'prompt-bridges'), source)));
  }
  const laborerPath = join(configDir, 'agents/laborer.md');
  within(configDir, laborerPath);
  const laborer = `---\ndescription: "Execution worker for bounded implementation tasks"\nmode: subagent\npermission:\n  task: deny\n---\n\n${roles.laborer.prompt}\n`;
  if (!existsSync(laborerPath)) plan(laborerPath, laborer);
  else if (readFileSync(laborerPath, 'utf8') !== laborer) skips.push('agents/laborer.md');

  // Finish all path/permission validation before even creating the backup tree.
  const backupRoot = join(configDir, 'migration-backups');
  within(configDir, backupRoot);
  for (const change of changes) {
    let parent = dirname(change.path);
    while (!existsSync(parent)) parent = dirname(parent);
    if (!lstatSync(parent).isDirectory()) throw new Error(`Expected directory: ${parent}`);
    accessSync(parent, constants.W_OK | constants.X_OK);
  }
  if (existsSync(backupRoot)) {
    if (!lstatSync(backupRoot).isDirectory()) throw new Error('migration-backups must be a directory');
    accessSync(backupRoot, constants.W_OK | constants.X_OK);
  }
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${changes.length} changes (${configDir})`);
  for (const change of changes) console.log(`${change.before === undefined ? 'CREATE' : 'UPDATE'} ${relative(configDir, change.path)}`);
  for (const path of skips) console.log(`SKIP conflicting user asset: ${path}`);
  if (!apply) { console.log('No files or directories written. Re-run with --apply after reviewing.'); return; }
  if (changes.length === 0) return;

  const ensure = (path: string) => mkdirSync(path, { recursive: true, mode: 0o700 });
  const backupDir = join(backupRoot, `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}`);
  ensure(backupDir);
  // Back up ALL changed existing files before the first target write. Backups and
  // the created-file manifest are intentionally outside agent/skill discovery.
  for (const change of changes) {
    if (change.before === undefined) continue;
    const backup = join(backupDir, relative(configDir, change.path));
    ensure(dirname(backup));
    writeFileSync(backup, change.before, { mode: 0o600, flag: 'wx' });
  }
  writeFileSync(join(backupDir, 'manifest.json'), `${JSON.stringify({
    configDir,
    created: changes.filter(change => change.before === undefined).map(change => relative(configDir, change.path)),
    updated: changes.filter(change => change.before !== undefined).map(change => relative(configDir, change.path)),
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  for (const change of changes) {
    ensure(dirname(change.path));
    const temporary = join(dirname(change.path), `.${crypto.randomUUID()}.install-v2.tmp`);
    writeFileSync(temporary, change.content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, change.path);
  }
  console.log(`Backups/rollback manifest: ${backupDir}`);
  console.log('No builds, model calls, or service restarts were performed.');
}

main().catch((error: unknown) => {
  console.error(`Install refused: ${error instanceof Error ? error.message : 'unexpected failure'}`);
  process.exitCode = 1;
});
