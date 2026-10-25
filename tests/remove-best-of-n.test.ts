import { afterEach, expect, test } from 'bun:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const kit = resolve(import.meta.dir, '..');
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'remove-bon-'));
  roots.push(root);
  const config = join(root, 'config');
  const removed = ['fixer-alpha', 'oracle-gamma', 'designer-delta', 'wildcard'];
  const preset: Record<string, any> = {
    orchestrator: { model: 'example/main', temperature: 1 },
    fixer: { model: 'example/fixer' },
    scout: { model: 'example/scout' },
    validator: { model: 'example/validator' },
    gist: { model: 'example/gist' },
    'orchestrator-beta': { model: 'example/beta' },
    'keep-custom': { model: 'example/custom' },
  };
  for (const name of removed) preset[name] = { model: 'example/removed' };
  mkdirSync(join(config, 'agents'), { recursive: true });
  mkdirSync(join(config, 'skills/best-of-n-with-judge'), { recursive: true });
  mkdirSync(join(config, 'oh-my-opencode-slim/superpowers-bridge'), { recursive: true });
  writeFileSync(join(config, 'oh-my-opencode-slim.jsonc'), `${JSON.stringify({
    preset: 'superpowers-bridge', presets: { 'superpowers-bridge': preset },
  }, null, 2)}\n`);
  for (const name of removed) writeFileSync(join(config, `agents/${name}.md`), `agent ${name}\n`);
  writeFileSync(join(config, 'agents/scout.md'), 'agent scout\n');
  writeFileSync(join(config, 'skills/best-of-n-with-judge/SKILL.md'), 'retired skill\n');
  writeFileSync(join(config, 'oh-my-opencode-slim/superpowers-bridge/orchestrator_append.md'),
    'Before\nBest-of-N:\n- old\nAfter\n');
  function run(args: string[] = []) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(kit, 'scripts/remove-best-of-n.ts'), '--config-dir', config, ...args],
      cwd: kit, stdout: 'pipe', stderr: 'pipe',
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  }
  return { root, config, preset, removed, run };
}
afterEach(() => { for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true }); });

test('dry run changes nothing; apply removes only the retired best-of-N assets and is idempotent', () => {
  const f = fixture();
  const before = readFileSync(join(f.config, 'oh-my-opencode-slim.jsonc'), 'utf8');
  expect(f.run().code).toBe(0);
  expect(readFileSync(join(f.config, 'oh-my-opencode-slim.jsonc'), 'utf8')).toBe(before);
  expect(existsSync(join(f.config, 'agents/fixer-alpha.md'))).toBe(true);
  expect(existsSync(join(f.config, 'skills/best-of-n-with-judge'))).toBe(true);

  const applied = f.run(['--apply']);
  expect(applied.code).toBe(0);
  const config = JSON.parse(readFileSync(join(f.config, 'oh-my-opencode-slim.jsonc'), 'utf8'));
  const roles = config.presets['superpowers-bridge'];
  for (const name of f.removed) expect(roles[name]).toBeUndefined();
  for (const name of ['orchestrator', 'fixer', 'scout', 'validator', 'gist', 'orchestrator-beta', 'keep-custom']) {
    expect(roles[name]).toBeDefined();
  }
  expect(roles.orchestrator.temperature).toBe(1);
  for (const name of f.removed) expect(existsSync(join(f.config, `agents/${name}.md`))).toBe(false);
  expect(existsSync(join(f.config, 'agents/scout.md'))).toBe(true);
  expect(existsSync(join(f.config, 'skills/best-of-n-with-judge'))).toBe(false);
  expect(readFileSync(join(f.config, 'oh-my-opencode-slim/superpowers-bridge/orchestrator_append.md'), 'utf8'))
    .not.toContain('Best-of-N');
  const backups = readdirSync(join(f.config, 'migration-backups'));
  expect(backups.some((name) => name.endsWith('-remove-best-of-n'))).toBe(true);

  const second = f.run(['--apply']);
  expect(second.code).toBe(0);
  expect(second.out).toContain('0 changes');
});
