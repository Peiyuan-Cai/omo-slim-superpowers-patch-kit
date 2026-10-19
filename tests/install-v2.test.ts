import { afterEach, expect, test } from 'bun:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const kit = resolve(import.meta.dir, '..');
const sourceOmo = resolve(kit, '../oh-my-opencode-slim');
const roots: string[] = [];
function fixture() {
  let parent = '/tmp/opencode';
  try { mkdirSync(parent, { recursive: true }); }
  catch { parent = mkdtempSync(join(tmpdir(), 'install-v2-parent-')); roots.push(parent); }
  const root = mkdtempSync(join(parent, 'install-v2-'));
  roots.push(root);
  const lite = join(root, 'lite checkout with spaces');
  const omo = join(root, 'omo checkout with spaces');
  const config = join(root, 'config with spaces');
  const home = join(root, 'home');
  for (const dir of [lite, join(lite, 'skills'), join(omo, 'dist/v2'), home]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(lite, 'server.js'), 'export default {};');
  writeFileSync(join(omo, 'server.js'), 'export default {};');
  writeFileSync(join(omo, 'dist/v2/index.js'), 'export function setup() {}');
  symlinkSync(join(sourceOmo, 'src'), join(omo, 'src'), 'dir');
  function put(file: string, value: unknown) {
    mkdirSync(dirname(join(config, file)), { recursive: true });
    writeFileSync(join(config, file), typeof value === 'string' ? value : JSON.stringify(value));
  }
  function run(args: string[] = [], env: Record<string, string> = {}) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(kit, 'scripts/install-v2.ts'), '--lite', lite,
        '--omo', omo, '--config-dir', config, ...args],
      cwd: root,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'xdg'),
        OPENCODE_CONFIG_DIR: '', OH_MY_OPENCODE_SLIM_PRESET: '', ...env },
      stdout: 'pipe', stderr: 'pipe',
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  }
  const json = (file: string) => JSON.parse(readFileSync(join(config, file), 'utf8'));
  return { root, lite, omo, config, home, put, run, json };
}
afterEach(() => { for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true }); });

function snapshot(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  const result: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result[file.slice(root.length + 1)] = readFileSync(file, 'base64');
    }
  }
  walk(root);
  return result;
}

test('dry run creates no config directory; apply generates 32 portable roles and ordered plugins', () => {
  const f = fixture();
  const preview = f.run(['--model', 'example/shared']);
  expect(preview.code).toBe(0);
  expect(preview.out).toContain('DRY RUN');
  expect(existsSync(f.config)).toBe(false);
  const applied = f.run(['--model', 'example/shared', '--apply']);
  expect(applied.code).toBe(0);
  expect(f.json('opencode.json').plugins).toEqual([f.lite, f.omo]);
  const config = f.json('oh-my-opencode-slim.json');
  expect(config.preset).toBe('superpowers-bridge');
  const roles = config.presets[config.preset];
  expect(Object.keys(roles)).toHaveLength(32);
  for (const role of Object.values(roles) as any[]) {
    expect(role.model).toBe('example/shared');
    expect(role.variant).toBeUndefined();
  }
  expect(roles.laborer.prompt).toContain('You are Laborer');
  expect(config.fallback.enabled).toBe(false);
  expect(config.multiplexer.type).toBe('none');
  expect(config.showStartupToast).toBe(false);
  expect(config.superpowersSkillsDir).toBe(join(f.lite, 'skills'));
  expect(config.$schema).toContain('oh-my-opencode-slim.schema.json');
  expect(readFileSync(join(f.config, 'agents/laborer.md'), 'utf8')).toContain('task: deny');
});

test('merges legacy plugin registration without losing providers, MCP, credentials or plugin options', () => {
  const f = fixture();
  const providers = { custom: { options: { apiKey: '{env:USER_KEY}' }, models: { shared: {} } } };
  const mcp = { servers: { custom: { type: 'remote', url: 'https://example.invalid/mcp' } } };
  f.put('opencode.jsonc', `// user comment\n${JSON.stringify({
    plugin: ['other-plugin', ['oh-my-opencode-slim@1.0', { old: true }],
      'file:///old/superpowers-lite/.opencode/plugins/superpowers.js'],
    plugins: [{ package: 'third-plugin', options: { custom: true } }], providers, mcp,
    model: 'example/existing', options: { user: true }, credentials: { untouched: 'secret-fixture' },
  })}`);
  const before = snapshot(f.config);
  expect(f.run().code).toBe(0);
  expect(snapshot(f.config)).toEqual(before);
  const result = f.run(['--apply']);
  expect(result.code).toBe(0);
  expect(result.out + result.err).not.toContain('secret-fixture');
  expect(existsSync(join(f.config, 'opencode.json'))).toBe(false);
  const host = f.json('opencode.jsonc');
  expect(host.plugin).toBeUndefined();
  expect(host.plugins).toEqual([f.lite, f.omo, { package: 'third-plugin', options: { custom: true } }, 'other-plugin']);
  expect(host.providers).toEqual(providers);
  expect(host.mcp).toEqual(mcp);
  expect(host.options).toEqual({ user: true });
  expect(host.credentials).toEqual({ untouched: 'secret-fixture' });
  const backups = snapshot(join(f.config, 'migration-backups'));
  const hostBackup = Object.keys(backups).find(path => path.endsWith('/opencode.jsonc'))!;
  expect(backups[hostBackup]).toBe(before['opencode.jsonc']);
  expect(statSync(join(f.config, 'migration-backups')).mode & 0o777).toBe(0o700);
  expect(statSync(join(f.config, 'migration-backups', hostBackup)).mode & 0o777).toBe(0o600);
  expect(Object.keys(snapshot(join(f.config, 'agents'))).some(path => /bak|backup/.test(path))).toBe(false);
});

test('preserves selected preset, root agents and preferences, inferring model from active orchestrator chain', () => {
  const f = fixture();
  const selected = {
    orchestrator: { model: [{ id: 'example/primary', variant: 'custom' }, 'example/backup'] },
    fixer: { model: 'example/fixer', options: { reasoning: 'user-choice' } },
    laborer: { model: 'example/laborer', prompt: 'My laborer' },
  };
  const rootAgents = { oracle: { model: 'example/root' } };
  f.put('oh-my-opencode-slim.jsonc', {
    preset: 'my-preset', presets: { 'my-preset': selected, other: { fixer: { model: 'other/model' } } },
    agents: rootAgents, fallback: { enabled: true }, multiplexer: { type: 'tmux' },
    showStartupToast: true, disabled_agents: ['observer'],
  });
  expect(f.run(['--apply']).code).toBe(0);
  const config = f.json('oh-my-opencode-slim.jsonc');
  expect(config.preset).toBe('my-preset');
  for (const [name, definition] of Object.entries(selected)) expect(config.presets['my-preset'][name]).toEqual(definition);
  expect(config.agents).toEqual(rootAgents);
  expect(config.presets['my-preset'].scout.model).toBe('example/primary');
  expect(config.presets.other).toEqual({ fixer: { model: 'other/model' } });
  expect(config.fallback.enabled).toBe(true);
  expect(config.multiplexer.type).toBe('tmux');
  expect(config.showStartupToast).toBe(true);
  expect(config.disabled_agents).toEqual(['observer']);
});

test('missing model fails before creating config; invalid model also fails', () => {
  const f = fixture();
  expect(f.run(['--apply']).code).not.toBe(0);
  expect(f.run(['--apply']).err).toContain('--model provider/model');
  expect(f.run(['--model', 'invalid', '--apply']).code).not.toBe(0);
  expect(existsSync(f.config)).toBe(false);
});

test('normalizes unrelated legacy plugin tuples and preserves native package/options entries', () => {
  const f = fixture();
  f.put('opencode.json', { model: 'example/shared', plugin: [['legacy-plugin', { enabled: true }]],
    plugins: [{ package: 'native-plugin', options: { strict: true } }] });
  expect(f.run(['--apply']).code).toBe(0);
  expect(f.json('opencode.json').plugins).toEqual([f.lite, f.omo,
    { package: 'native-plugin', options: { strict: true } },
    { package: 'legacy-plugin', options: { enabled: true } }]);
});

for (const base of ['opencode', 'oh-my-opencode-slim']) {
  test(`refuses duplicate ${base} JSON and JSONC without writes`, () => {
    const f = fixture();
    f.put(`${base}.json`, {}); f.put(`${base}.jsonc`, '{} // duplicate');
    const before = snapshot(f.config);
    expect(f.run(['--model', 'example/shared', '--apply']).code).not.toBe(0);
    expect(snapshot(f.config)).toEqual(before);
  });
}

for (const spec of ['superpowers', 'superpowers@6.1', 'file:///old/superpowers/.opencode/plugins/superpowers.js']) {
  test(`refuses stock Superpowers coexistence (${spec})`, () => {
    const f = fixture(); f.put('opencode.json', { plugins: [spec] });
    const before = snapshot(f.config);
    const result = f.run(['--model', 'example/shared', '--apply']);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('stock Superpowers');
    expect(snapshot(f.config)).toEqual(before);
  });
}

test('copies assets with source prompt expansion, callable bestof variants, preserves conflicts, and is idempotent', () => {
  const f = fixture();
  f.put('skills/best-of-n-with-judge/candidate-prompt-template.md', 'user-owned');
  expect(f.run(['--model', 'example/shared', '--apply']).code).toBe(0);
  const agent = readFileSync(join(f.config, 'agents/fixer-alpha.md'), 'utf8');
  const sourcePrompt = readFileSync(join(kit, 'opencode-config/prompts/fixer-base.md'), 'utf8').trim();
  expect(agent).toContain(sourcePrompt);
  expect(agent).not.toContain('prompt: "{file:');
  expect(agent).toContain('hidden: false');
  expect(agent).toContain('task: deny');
  expect(readFileSync(join(f.config, 'skills/best-of-n-with-judge/candidate-prompt-template.md'), 'utf8')).toBe('user-owned');
  expect(readFileSync(join(f.config, 'oh-my-opencode-slim/superpowers-bridge/orchestrator_append.md'), 'utf8'))
    .toBe(readFileSync(join(kit, 'prompt-bridges/orchestrator_append.md'), 'utf8'));
  const before = snapshot(f.config);
  const second = f.run(['--model', 'example/shared', '--apply']);
  expect(second.code).toBe(0);
  expect(second.out).toContain('0 changes');
  expect(second.out).toContain('SKIP');
  expect(snapshot(f.config)).toEqual(before);
});

test('converts existing supported agents only on apply, backs up exact original outside discovery', () => {
  const f = fixture();
  const original = '---\nmode: subagent\nhidden: true\nprompt: "{file:../prompts/fixer-base.md}"\n---\nMy contract\n';
  f.put('agents/fixer-alpha.md', original);
  f.put('prompts/fixer-base.md', 'User base prompt');
  const before = snapshot(f.config);
  expect(f.run(['--model', 'example/shared']).code).toBe(0);
  expect(snapshot(f.config)).toEqual(before);
  expect(f.run(['--model', 'example/shared', '--apply']).code).toBe(0);
  const converted = readFileSync(join(f.config, 'agents/fixer-alpha.md'), 'utf8');
  expect(converted).toContain('User base prompt');
  expect(converted).toContain('My contract');
  expect(converted).toContain('hidden: false');
  const backups = snapshot(join(f.config, 'migration-backups'));
  expect(Object.entries(backups).find(([path]) => path.endsWith('/agents/fixer-alpha.md'))?.[1])
    .toBe(Buffer.from(original).toString('base64'));
});

test('missing build and invalid late asset prompt fail before any config writes', () => {
  const f = fixture();
  rmSync(join(f.omo, 'dist/v2/index.js'));
  const missingBuild = f.run(['--model', 'example/shared', '--apply']);
  expect(missingBuild.code).not.toBe(0);
  expect(missingBuild.err).toContain('bun run build');
  expect(existsSync(f.config)).toBe(false);
  writeFileSync(join(f.omo, 'dist/v2/index.js'), 'export {};');
  f.put('agents/fixer-alpha.md', '---\nprompt: "{file:../prompts/missing.md}"\n---\nbody');
  const before = snapshot(f.config);
  expect(f.run(['--model', 'example/shared', '--apply']).code).not.toBe(0);
  expect(snapshot(f.config)).toEqual(before);
});

test('refuses destination symlink escapes without touching outside assets', () => {
  const f = fixture();
  const outside = join(f.root, 'outside'); mkdirSync(outside);
  mkdirSync(f.config); symlinkSync(outside, join(f.config, 'agents'), 'dir');
  expect(f.run(['--model', 'example/shared', '--apply']).code).not.toBe(0);
  expect(readdirSync(outside)).toEqual([]);
  expect(existsSync(join(f.config, 'opencode.json'))).toBe(false);
});
