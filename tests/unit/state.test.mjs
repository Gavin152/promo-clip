import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES, defaultState, saveState, loadState, updateState, startStage, finishStage, failStage, markStale, downstream, nextStage, effectiveStatus, recordGate, setMode, setOutput, HEARTBEAT_MS } from '../../engine/tools/lib/state.mjs';
import { resolveSize } from '../../engine/js/formats.js';

const allDone = () => {
  const s = defaultState('t', '1.0.0');
  for (const st of STAGES) finishStage(s, st);
  for (const st of STAGES) s.stages[st].status = 'done';
  return s;
};

test('default state has every stage todo and starts at discover', () => {
  const s = defaultState('clip', '1.0.0');
  assert.deepEqual(Object.keys(s.stages), STAGES);
  assert.ok(STAGES.every((st) => s.stages[st].status === 'todo'));
  assert.equal(nextStage(s), 'discover');
});

test('todo -> running -> done records time and clears the reason', () => {
  const s = defaultState('clip', '1.0.0');
  startStage(s, 'discover', () => 1000);
  assert.equal(s.stages.discover.status, 'running');
  failStage(s, 'discover', 'boom');
  assert.equal(s.stages.discover.reason, 'boom');
  startStage(s, 'discover');
  finishStage(s, 'discover', { cost: 0 });
  assert.equal(s.stages.discover.status, 'done');
  assert.equal(s.stages.discover.reason, undefined);
  assert.equal(nextStage(s), 'script');
});

test('staleness propagates transitively to done stages only', () => {
  assert.deepEqual(downstream('script'), ['voice', 'music', 'scenes', 'formats', 'export']);
  assert.deepEqual(downstream('art'), ['scenes', 'formats', 'export']);
  assert.deepEqual(downstream('music'), ['export']);
  assert.deepEqual(downstream('export'), []);
  const s = allDone();
  finishStage(s, 'art');
  assert.equal(s.stages.scenes.status, 'stale');
  assert.equal(s.stages.scenes.reason, 'art changed');
  assert.equal(s.stages.export.status, 'stale');
  assert.equal(s.stages.voice.status, 'done');
  assert.equal(nextStage(s), 'scenes');
  const t = defaultState('x', '1');
  finishStage(t, 'discover');
  finishStage(t, 'script');
  assert.equal(t.stages.voice.status, 'todo'); // never run: stays todo
});

test('a running stage without heartbeat counts as failed', () => {
  const s = allDone();
  startStage(s, 'music', () => 0);
  assert.equal(effectiveStatus(s.stages.music, () => 1000), 'running');
  assert.equal(effectiveStatus(s.stages.music, () => HEARTBEAT_MS + 1), 'failed');
  assert.equal(nextStage(s, () => HEARTBEAT_MS + 1), 'music');
});

test('markStale, gates, mode, output validation', () => {
  const s = allDone();
  markStale(s, 'scenes', 'engine upgraded');
  assert.equal(s.stages.scenes.status, 'stale');
  recordGate(s, 'music', 'B', 'auto', 'best mix score');
  assert.deepEqual({ ...s.gates[0], at: undefined }, { stage: 'music', choice: 'B', by: 'auto', why: 'best mix score', at: undefined });
  assert.throws(() => recordGate(s, 'music', 'B', 'robot'), /human\|auto/);
  assert.throws(() => recordGate(s, 'nope', 'B'), /unknown stage/);
  setMode(s, 'auto');
  assert.equal(s.mode, 'auto');
  assert.throws(() => setMode(s, 'fast'), /mode/);
  setOutput(s, { formats: ['landscape', 'vertical'], primary: 'vertical', sizes: ['720p', '1080x1350'], fps: 25 }, resolveSize);
  assert.equal(s.output.primary, 'vertical');
  assert.throws(() => setOutput(s, { primary: 'square' }), /primary/);
  assert.throws(() => setOutput(s, { fps: 50 }), /fps/);
  assert.throws(() => setOutput(s, { sizes: ['8K'] }, resolveSize), /unknown size/);
});

test('atomic save + load round trip, no temp file left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promo-state-'));
  saveState(dir, defaultState('clip', '1.0.0'));
  assert.ok(!existsSync(join(dir, 'promo.json.tmp')));
  updateState(dir, (s) => finishStage(s, 'discover'));
  assert.equal(loadState(dir).stages.discover.status, 'done');
  assert.match(readFileSync(join(dir, 'promo.json'), 'utf8'), /"discover"/);
  assert.throws(() => loadState(join(dir, 'missing')), /no promo.json/);
});
