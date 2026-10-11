import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN, SIZE_PRESETS, MAX_CROP, resolveSize, nearestFormat, parseCustom, sizeLabel } from '../../engine/js/formats.js';

test('design spaces are fixed per format', () => {
  assert.deepEqual(DESIGN, { landscape: [1920, 1080], vertical: [1260, 2240], square: [1260, 1260] });
});

test('every preset keeps the design aspect ratio and scales exactly', () => {
  for (const [fmt, presets] of Object.entries(SIZE_PRESETS)) {
    for (const [name, [w, h]] of Object.entries(presets)) {
      const r = resolveSize(fmt, name);
      assert.equal(r.format, fmt);
      assert.deepEqual([r.outW, r.outH], [w, h]);
      assert.equal(r.cropX, 0);
      assert.equal(r.cropY, 0);
      assert.ok(Math.abs(r.designW * r.scale - w) < 1e-6, `${fmt} ${name} width`);
      assert.ok(Math.abs(r.designH * r.scale - h) < 1e-6, `${fmt} ${name} height`);
    }
  }
});

test('named presets', () => {
  assert.deepEqual([resolveSize('vertical', '4K').outW, resolveSize('vertical', '4K').outH], [2160, 3840]);
  assert.equal(resolveSize('landscape', '1080p').scale, 1);
  assert.ok(Math.abs(resolveSize('landscape', '720p').scale - 2 / 3) < 1e-9);
});

test('custom size picks the nearest layout and centre-crops within the limit', () => {
  const r = resolveSize('landscape', '1080x1350'); // 4:5 -> square layout, crops width
  assert.equal(r.format, 'square');
  assert.equal(r.outW, 1080);
  assert.equal(r.outH, 1350);
  assert.ok(Math.abs(r.scale - 1350 / 1260) < 1e-9);
  assert.equal(r.cropY, 0);
  assert.ok(Math.abs(r.cropX - (1260 * r.scale - 1080) / 2) < 1e-9);
  assert.ok(1 - 1080 / (1260 * r.scale) <= MAX_CROP);
});

test('custom size with an exact design aspect needs no crop', () => {
  const r = resolveSize('landscape', '3200x1800');
  assert.equal(r.format, 'landscape');
  assert.equal(r.cropX, 0);
  assert.equal(r.cropY, 0);
});

test('custom size beyond the crop limit is refused with a hint', () => {
  assert.throws(() => resolveSize('landscape', '2400x1000'), /would crop .* pick a preset/);
});

test('odd, malformed and unknown sizes are refused', () => {
  assert.throws(() => resolveSize('landscape', '1081x1351'), /must be even/);
  assert.throws(() => resolveSize('landscape', '1080x1920x'), /unknown size/);
  assert.throws(() => resolveSize('landscape', '8K'), /unknown size/);
  assert.throws(() => resolveSize('portrait', '1080p'), /unknown format/);
});

test('nearestFormat / parseCustom / sizeLabel', () => {
  assert.equal(nearestFormat(1920, 1080), 'landscape');
  assert.equal(nearestFormat(1080, 1920), 'vertical');
  assert.equal(nearestFormat(1000, 1000), 'square');
  assert.deepEqual(parseCustom('1080 x 1350'), [1080, 1350]);
  assert.equal(parseCustom('4K'), null);
  assert.equal(sizeLabel('1080X1350'), '1080x1350');
  assert.equal(sizeLabel('4K'), '4K');
});
