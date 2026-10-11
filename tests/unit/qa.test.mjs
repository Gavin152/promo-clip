import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHMSS } from '../../engine/tools/lib/qa-probe.mjs';

// ---- parseHMSS ----
test('parseHMSS: parses HH:MM:SS.ms correctly', () => {
  assert.ok(Math.abs(parseHMSS('00:00:15.210') - 15.21) < 1e-6);
  assert.ok(Math.abs(parseHMSS('00:01:00.000') - 60) < 1e-6);
  assert.ok(Math.abs(parseHMSS('01:00:00.000') - 3600) < 1e-6);
  assert.ok(Math.abs(parseHMSS('00:00:00.000') - 0) < 1e-6);
});

test('parseHMSS: handles sub-second values', () => {
  assert.ok(Math.abs(parseHMSS('00:00:00.033') - 0.033) < 1e-4);
});

test('parseHMSS: returns NaN for invalid input', () => {
  assert.ok(Number.isNaN(parseHMSS('')));
  assert.ok(Number.isNaN(parseHMSS(null)));
  assert.ok(Number.isNaN(parseHMSS('not-a-time')));
});

// ---- loudness tolerance logic ----
// The actual loudness() function requires a media file. We test the tolerance math here.
const LUFS_TARGET = -14;
const LUFS_TOL = 1;
const TP_LIMIT = -0.8; // -1.0 dBTP + 0.2

function lufsOk(v) { return Math.abs(v - LUFS_TARGET) <= LUFS_TOL; }
function tpOk(v) { return v <= TP_LIMIT; }

test('loudness tolerance: -14 LUFS is within range', () => {
  assert.ok(lufsOk(-14));
});

test('loudness tolerance: -13 and -15 are at the boundary', () => {
  assert.ok(lufsOk(-13));
  assert.ok(lufsOk(-15));
});

test('loudness tolerance: -12.9 and -15.1 are outside range', () => {
  assert.ok(!lufsOk(-12.9));
  assert.ok(!lufsOk(-15.1));
});

test('true peak tolerance: -0.8 dBFS is exactly at limit', () => {
  assert.ok(tpOk(-0.8));
});

test('true peak tolerance: -0.9 is within limit', () => {
  assert.ok(tpOk(-0.9));
});

test('true peak tolerance: -0.7 exceeds limit', () => {
  assert.ok(!tpOk(-0.7));
});

// ---- audio/video delta check ----
const AV_DELTA = 0.1;
function avOk(videoDur, audioDur) { return Math.abs(videoDur - audioDur) <= AV_DELTA; }

test('av delta: equal durations pass', () => {
  assert.ok(avOk(15.21, 15.21));
});

test('av delta: within 0.1 s passes', () => {
  assert.ok(avOk(15.21, 15.20));
  assert.ok(avOk(15.50, 15.40)); // 0.10 exactly (clean float arithmetic)
});

test('av delta: exactly 0.1 s passes', () => {
  // use values that round cleanly in float64
  assert.ok(avOk(10.0, 9.9));  // delta = 0.1 exactly
});

test('av delta: over 0.1 s fails', () => {
  assert.ok(!avOk(15.00, 14.85)); // delta = 0.15 > 0.1
});
