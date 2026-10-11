import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeData, wordKey } from '../../engine/js/data-core.js';

const TIMING = {
  vo_start: 0.5,
  words: [
    { w: 'Now?', start: 0.0, end: 0.3 },
    { w: 'No', start: 0.5, end: 0.7 },
    { w: 'Wi-Fi,', start: 1.0, end: 1.4 },
    { w: '€19.90', start: 2.0, end: 2.6 },
    { w: 'no.', start: 3.0, end: 3.2 },
    { w: 'Café', start: 4.0, end: 4.4 },
  ],
  sentences: [{ text: 'Now? No Wi-Fi, €19.90 no.', start: 0 }, { text: 'Café', start: 4.0 }],
};
const CUES = { offset: 1, beatPeriod: 0.5, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3], downbeats: [0, 2], film: { reveal: 2, final: 4, end: 6 }, accents: [{ film: 3.05, change: 4 }] };

test('wordKey normalises case and punctuation, keeps letters with accents', () => {
  assert.equal(wordKey('Wi-Fi,'), 'wifi');
  assert.equal(wordKey('€19.90'), '€19.90');
  assert.equal(wordKey('no.'), 'no');
  assert.equal(wordKey('Café'), 'café');
});

test('W matches whole words, never a prefix ("no" is not "now")', () => {
  const D = makeData(TIMING, CUES);
  assert.equal(D.W('no'), 0.5 + 0.5);
  assert.equal(D.W('no', 1), 0.5 + 3.0);
  assert.equal(D.W('now'), 0.5);
});

test('W / WE / Wa normalise the query too and add vo_start', () => {
  const D = makeData(TIMING, CUES);
  assert.equal(D.W('Wi-Fi'), 1.5);
  assert.equal(D.WE('wifi'), 1.9);
  assert.equal(D.W('€19.90'), 2.5);
  assert.equal(D.Wa('no', 2), 3.5);
  assert.equal(D.W('café'), 4.5);
});

test('missing words throw with the word and index', () => {
  const D = makeData(TIMING, CUES);
  assert.throws(() => D.W('yes'), /word "yes" #0 not in timing.json/);
  assert.throws(() => D.W('no', 2), /#2/);
  assert.throws(() => D.Wa('now', 1), /after 1/);
  assert.throws(() => D.S('missing phrase'), /sentence/);
});

test('S finds the sentence containing a phrase', () => {
  const D = makeData(TIMING, CUES);
  assert.equal(D.S('café'), 4.5);
});

test('music lookups are in film time (track + offset)', () => {
  const D = makeData(TIMING, CUES);
  assert.deepEqual(D.BEATS.slice(0, 3), [1, 1.5, 2]);
  assert.deepEqual(D.DOWNBEATS, [1, 3]);
  assert.equal(D.onBeat(2.1), 2);
  assert.equal(D.onBeat(2.3), 2.3); // no beat within ±150 ms
  assert.equal(D.beatFrom(2.1), 2.5);
  assert.equal(D.beatFrom(2.1, 2), 3.5);
  assert.equal(D.accent(3.2), 3.05);
  assert.equal(D.accent(5), 5);
});

test('duration: last word + tail, or music end if later, optionally capped', () => {
  assert.equal(makeData(TIMING, CUES).DURATION, 0.5 + 4.4 + 3);
  assert.equal(makeData({ ...TIMING, tail: 1 }, CUES).DURATION, 6.2);
  assert.equal(makeData({ ...TIMING, maxDuration: 6 }, CUES).DURATION, 6);
});
