import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, buildPaths } from '../../engine/tools/build-assets.mjs';

const fixture = new URL('../../fixtures/sample-15s/', import.meta.url).pathname;
function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'promo-build-'));
  cpSync(fixture, dir, { recursive: true, filter: (s) => !/\/(\.work|out|ref)(\/|$)/.test(s) });
  return dir;
}

test('a tagged build writes its own bundle and leaves the shared one alone', async () => {
  const dir = copy();
  const r = await build(dir, { quiet: true, tag: '02-feature', scene: '02-feature' });
  assert.equal(r.bundle, buildPaths(dir, '02-feature').bundle);
  assert.ok(existsSync(join(dir, '.work/build-02-feature/promo.bundle.js')));
  assert.ok(!existsSync(join(dir, 'promo.bundle.js')));
  assert.throws(() => buildPaths(dir, '../x'), /--tag/);
});

test('foreign scenes that do not compile are stubbed out of a tagged build; own scene and shared builds fail', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'scenes/03-end.js'), 'export default {\n  start: (T) => T.s3,\n  draw( {\n');
  const r = await build(dir, { quiet: true, tag: '01-intro', scene: '01-intro' });
  assert.deepEqual(r.skipped, ['03-end.js']);
  assert.match(readFileSync(join(dir, '.work/build-01-intro/scenes.js'), 'utf8'), /id: "03-end", start: \(T\) => T\.s3, draw\(\) \{\}/);
  await assert.rejects(build(dir, { quiet: true, tag: '03-end', scene: '03-end' }), /03-end\.js:\d+/);
  await assert.rejects(build(dir, { quiet: true }), /build failed/);
  await assert.rejects(build(dir, { quiet: true, tag: 'x', scene: '09-nope' }), /no scenes\/09-nope\.js/);
});
