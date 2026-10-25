#!/usr/bin/env bun
// Remove the retired best-of-N preset assets from an existing OpenCode config.
// Dry-run by default; --apply backs up every changed path first.
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const kit = resolve(import.meta.dir, '..');
const REMOVED_AGENTS = [
  'designer-alpha', 'designer-beta', 'designer-gamma', 'designer-delta',
  'explorer-alpha', 'explorer-beta',
  'fixer-alpha', 'fixer-beta', 'fixer-gamma', 'fixer-delta',
  'librarian-alpha', 'librarian-beta',
  'oracle-alpha', 'oracle-beta', 'oracle-gamma', 'oracle-delta',
  'wildcard',
] as const;
const SKILL_DIR = 'best-of-n-with-judge';
const usage = 'bun scripts/remove-best-of-n.ts [--config-dir path] [--apply]';

type Change =
  | { type: 'write'; path: string; content: string }
  | { type: 'remove-file' | 'remove-dir'; path: string };

function fail(message: string): never {
  throw new Error(message);
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`Path escapes the config directory: ${path}`);
  }
}

function assertNoSymlink(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) fail(`Symlink refused: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) break;
  }
}

function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    out += char;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseConfig(text: string): Record<string, any> {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsonc(text));
  }
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function backupPath(configDir: string, backupRoot: string, path: string) {
  within(configDir, path);
  const destination = join(backupRoot, relative(configDir, path));
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  if (statSync(path).isDirectory()) {
    for (const file of walkFiles(path)) {
      const target = join(backupRoot, relative(configDir, file));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(file, target);
      writeFileSync(target, readFileSync(target), { mode: 0o600 });
    }
  } else {
    copyFileSync(path, destination);
    writeFileSync(destination, readFileSync(destination), { mode: 0o600 });
  }
}

function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let configDir = process.env.OPENCODE_CONFIG_DIR?.trim() ||
    join(process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config'), 'opencode');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      return;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--config-dir' && args[i + 1] && !args[i + 1].startsWith('--')) {
      configDir = args[++i];
      continue;
    }
    fail(`Invalid arguments. ${usage}`);
  }
  configDir = resolve(configDir);
  assertNoSymlink(configDir);

  const configPath = ['oh-my-opencode-slim.jsonc', 'oh-my-opencode-slim.json']
    .map((name) => join(configDir, name))
    .find((path) => existsSync(path));
  if (!configPath) fail(`No oh-my-opencode-slim.jsonc/json in ${configDir}`);
  within(configDir, configPath);
  const before = readFileSync(configPath, 'utf8');
  const config = parseConfig(before);
  const presetName = typeof config.preset === 'string' ? config.preset : 'superpowers-bridge';
  const preset = config.presets && typeof config.presets === 'object'
    ? config.presets[presetName]
    : undefined;
  const changes: Change[] = [];

  let presetChanged = false;
  if (preset && typeof preset === 'object') {
    for (const name of REMOVED_AGENTS) {
      if (Object.prototype.hasOwnProperty.call(preset, name)) {
        delete preset[name];
        presetChanged = true;
      }
    }
  }
  if (presetChanged) {
    changes.push({ type: 'write', path: configPath, content: `${JSON.stringify(config, null, 2)}\n` });
  }

  for (const name of REMOVED_AGENTS) {
    const path = join(configDir, 'agents', `${name}.md`);
    within(configDir, path);
    assertNoSymlink(path);
    if (existsSync(path)) changes.push({ type: 'remove-file', path });
  }

  const skillDir = join(configDir, 'skills', SKILL_DIR);
  within(configDir, skillDir);
  assertNoSymlink(skillDir);
  if (existsSync(skillDir)) changes.push({ type: 'remove-dir', path: skillDir });

  const bridgeSource = join(kit, 'prompt-bridges', 'orchestrator_append.md');
  const bridgeDestination = join(configDir, 'oh-my-opencode-slim', presetName, 'orchestrator_append.md');
  within(configDir, bridgeDestination);
  assertNoSymlink(bridgeDestination);
  if (existsSync(bridgeSource) && existsSync(bridgeDestination)) {
    const next = readFileSync(bridgeSource, 'utf8');
    if (readFileSync(bridgeDestination, 'utf8') !== next) {
      changes.push({ type: 'write', path: bridgeDestination, content: next });
    }
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${changes.length} changes (${configDir})`);
  for (const change of changes) {
    const label = change.type === 'write' ? 'UPDATE' : change.type === 'remove-dir' ? 'REMOVE DIR' : 'REMOVE';
    console.log(`${label} ${relative(configDir, change.path)}`);
  }
  if (!apply || changes.length === 0) {
    if (!apply) console.log('No files written. Re-run with --apply after reviewing.');
    return;
  }

  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backupRoot = join(configDir, 'migration-backups', `${stamp}-remove-best-of-n`);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  for (const change of changes) {
    if (!existsSync(change.path)) continue;
    backupPath(configDir, backupRoot, change.path);
    if (change.type === 'write') {
      writeFileSync(change.path, change.content);
    } else if (change.type === 'remove-file') {
      rmSync(change.path);
    } else {
      rmSync(change.path, { recursive: true, force: true });
    }
  }
  console.log(`Backup: ${backupRoot}`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
