import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, status, upgrade, stage, gate, budget, output, mode } from '../../engine/tools/project.mjs';
import { ENGINE_VERSION } from '../../engine/tools/lib/paths.mjs';

const quiet = () => {};

test('setup copies the engine and writes skeleton files; a second run leaves it alone', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'promo-setup-')), 'My Clip');
  const r = await setup({ dir, install: false, checkFirst: false, log: quiet });
  assert.equal(r.created, true);
  for (const f of ['js/main.js', 'tools/cli.mjs', 'index.html', 'VERSION', 'assets/fonts/inter.woff2', 'providers.json', 'theme.json', 'manifest.json', 'promo.json', '.gitignore', '.env.example', 'scenes', 'assets/art/raw']) assert.ok(existsSync(join(dir, f)), f);
  assert.ok(!existsSync(join(dir, 'tools/node_modules')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'theme.json'))).name, 'My Clip');
  const st = status(dir);
  assert.equal(st.engine, ENGINE_VERSION);
  assert.equal(st.next, 'discover');
  const again = await setup({ dir, install: false, checkFirst: false, log: quiet });
  assert.equal(again.created, false);
});

test('stage / gate / budget / mode / output commands update promo.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'promo-cmd-'));
  await setup({ dir, install: false, checkFirst: false, log: quiet });
  stage(dir, 'discover', 'start');
  assert.equal(stage(dir, 'discover', 'done').status, 'done');
  assert.equal(status(dir).next, 'script');
  assert.equal(gate(dir, 'discover', 'approved', { by: 'human' }).choice, 'approved');
  assert.equal(budget(dir, 2.5).limitUsd, 2.5);
  assert.throws(() => budget(dir, -1), /budget/);
  assert.equal(mode(dir, 'auto'), 'auto');
  assert.deepEqual(output(dir, { formats: 'landscape,square', primary: 'square', sizes: '720p,4K', fps: '60' }), { formats: ['landscape', 'square'], primary: 'square', sizes: ['720p', '4K'], fps: 60 });
});

test('upgrade replaces engine files, keeps project files, bumps version, marks scenes stale', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'promo-up-'));
  await setup({ dir, install: false, checkFirst: false, log: quiet });
  const p = JSON.parse(readFileSync(join(dir, 'promo.json')));
  p.engine = '0.9.0';
  p.stages.scenes = { status: 'done' };
  writeFileSync(join(dir, 'promo.json'), JSON.stringify(p));
  writeFileSync(join(dir, 'js/old-module.js'), '// removed upstream');
  writeFileSync(join(dir, 'scenes/01-a.js'), '// mine');
  writeFileSync(join(dir, 'theme.json'), '{"name":"kept"}');
  const r = upgrade(dir, { install: false, checkFirst: false, log: quiet });
  assert.deepEqual([r.from, r.to], ['0.9.0', ENGINE_VERSION]);
  assert.ok(!existsSync(join(dir, 'js/old-module.js')));
  assert.ok(existsSync(join(dir, 'js/main.js')));
  assert.ok(existsSync(join(dir, '.work/engine-0.9.0/js/old-module.js')), 'old engine backed up');
  assert.equal(readFileSync(join(dir, 'scenes/01-a.js'), 'utf8'), '// mine');
  assert.equal(JSON.parse(readFileSync(join(dir, 'theme.json'))).name, 'kept');
  const s = status(dir);
  assert.equal(s.engine, ENGINE_VERSION);
  assert.equal(s.stages.find((x) => x.stage === 'scenes').status, 'stale');
});
