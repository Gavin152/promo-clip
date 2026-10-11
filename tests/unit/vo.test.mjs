// vo.mjs unit tests: canon/diff, timing builder, gaps fixture, generate w/ fake client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCanon, analyseTranscript, buildSentences, brandNormalize } from '../../engine/tools/lib/vo-analyse.mjs';
import { parseScript } from '../../engine/tools/lib/script.mjs';
import { commands, setClient, computeGapInsertions } from '../../engine/tools/vo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../../fixtures/sample-15s');

// guard: block any accidental real API calls (individual tests set their own fake)
const GUARD = { tts: () => { throw new Error('unexpected API call in test'); }, actualCost: async () => null };
setClient(GUARD);

// ── 1. canonicalization ────────────────────────────────────────────────────────

test('buildCanon: BASE_CANON normalises wi-fi variants', () => {
  const apply = (s) => buildCanon({}).reduce((a, [re, v]) => a.replace(re, v), s);
  assert.equal(apply('Wi-Fi'), 'wifi');
  assert.equal(apply('wi-fi'), 'wifi');
  assert.equal(apply('WI FI'), 'wifi');
  assert.equal(apply('hello'), 'hello'); // unchanged
});

test('buildCanon: project spoken overrides take precedence', () => {
  const theme = { spoken: { 'snap\\s*tra(x|cks)': 'snaptrax', 'nineteen ninety|€\\s?19[.,]90': 'EUR1990' } };
  const apply = (s) => buildCanon(theme).reduce((a, [re, v]) => a.replace(re, v), s);
  assert.equal(apply('Snap Tracks'), 'snaptrax');
  assert.equal(apply('SnapTrax'), 'snaptrax');
  assert.equal(apply('nineteen ninety'), 'EUR1990');
  assert.equal(apply('€19.90'), 'EUR1990');
  assert.equal(apply('Wi-Fi'), 'wifi'); // BASE_CANON still applies
});

// ── 2. analyseTranscript diff ──────────────────────────────────────────────────

const SIMPLE_STT = {
  words: [
    { word: 'Hello', start: 0.0, end: 0.3, confidence: 1.0 },
    { word: 'world.', start: 0.5, end: 0.9, confidence: 1.0 },
  ],
};

test('analyseTranscript: perfect match → no ops', () => {
  const r = analyseTranscript(SIMPLE_STT, 'Hello world.', buildCanon({}));
  assert.equal(r.ops.length, 0);
  assert.equal(r.nHyp, 2);
  assert.equal(r.nRef, 2);
});

test('analyseTranscript: missing script word → MISSING op', () => {
  const r = analyseTranscript(SIMPLE_STT, 'Hello beautiful world.', buildCanon({}));
  assert.equal(r.ops.length, 1);
  assert.match(r.ops[0], /^MISSING/);
});

test('analyseTranscript: extra STT word → EXTRA op', () => {
  const stt = {
    words: [
      { word: 'Hello', start: 0.0, end: 0.3, confidence: 1.0 },
      { word: 'lovely', start: 0.4, end: 0.6, confidence: 0.9 },
      { word: 'world.', start: 0.7, end: 1.1, confidence: 1.0 },
    ],
  };
  const r = analyseTranscript(stt, 'Hello world.', buildCanon({}));
  assert.equal(r.ops.length, 1);
  assert.match(r.ops[0], /^EXTRA/);
});

test('analyseTranscript: project canon merges multi-word to single token', () => {
  // STT returns "Snap" + "Tracks"; script has "SnapTrax"
  const stt = {
    words: [
      { word: 'Snap', start: 0.0, end: 0.3, confidence: 1.0 },
      { word: 'Tracks', start: 0.35, end: 0.7, confidence: 0.9 },
    ],
  };
  const canon = buildCanon({ spoken: { 'snap\\s*tra(x|cks)': 'snaptrax' } });
  const r = analyseTranscript(stt, 'SnapTrax', canon);
  assert.equal(r.ops.length, 0, `expected no diff ops but got: ${r.ops.join('; ')}`);
});

test('analyseTranscript: long mid-phrase pause detected (> 250 ms)', () => {
  const stt = {
    words: [
      { word: 'Hello', start: 0.0, end: 0.3, confidence: 1.0 },
      { word: 'world.', start: 0.7, end: 1.1, confidence: 1.0 }, // 400 ms gap, no punctuation before
    ],
  };
  // script has no comma between Hello and world → this should be a mid-phrase pause
  const r = analyseTranscript(stt, 'Hello world.', buildCanon({}));
  // "Hello" has no trailing punctuation, gap = 0.4 s > 0.25 s → longMid
  assert.equal(r.longMid.length, 1);
  assert.ok(r.longMid[0].gap > 0.25);
});

test('analyseTranscript: [tags] in script text are stripped before diff', () => {
  const stt = {
    words: [
      { word: 'Hello', start: 0.0, end: 0.3, confidence: 1.0 },
      { word: 'world.', start: 0.4, end: 0.8, confidence: 1.0 },
    ],
  };
  const r = analyseTranscript(stt, '[excited] Hello world.', buildCanon({}));
  assert.equal(r.ops.length, 0);
});

// ── 3. timing builder: buildSentences + brandNormalize ────────────────────────

test('buildSentences: groups words into sentences at punctuation', () => {
  const words = [
    { i: 0, w: 'Hello', start: 0.0, end: 0.3, conf: 1 },
    { i: 1, w: 'world.', start: 0.4, end: 0.8, conf: 1 },
    { i: 2, w: 'Goodbye.', start: 1.0, end: 1.5, conf: 1 },
  ];
  const sents = buildSentences(words);
  assert.equal(sents.length, 2);
  assert.equal(sents[0].text, 'Hello world.');
  assert.equal(sents[0].first, 0);
  assert.equal(sents[0].last, 1);
  assert.ok(Math.abs(sents[0].start - 0.0) < 0.001);
  assert.ok(Math.abs(sents[0].end - 0.8) < 0.001);
  assert.equal(sents[1].text, 'Goodbye.');
  assert.equal(sents[1].first, 2);
});

test('buildSentences: trailing run of words without punctuation becomes last sentence', () => {
  const words = [
    { i: 0, w: 'Hello', start: 0.0, end: 0.3, conf: 1 },
    { i: 1, w: 'world', start: 0.4, end: 0.8, conf: 1 }, // no trailing punctuation
  ];
  const sents = buildSentences(words);
  assert.equal(sents.length, 1);
  assert.equal(sents[0].text, 'Hello world');
  assert.equal(sents[0].last, 1);
});

test('brandNormalize: capitalises matching brand word tokens', () => {
  assert.equal(brandNormalize('demo', ['demo', 'product']), 'Demo');
  assert.equal(brandNormalize('product.', ['demo', 'product']), 'Product.');
  assert.equal(brandNormalize('something', ['demo', 'product']), 'something');
  assert.equal(brandNormalize('Demo', ['demo']), 'Demo'); // already capitalised
});

test('timing builder: canned STT → correct word/sentence structure', () => {
  const stt = {
    words: [
      { word: 'Introducing', start: 0.05, end: 0.59, confidence: 1.0 },
      { word: 'demo', start: 0.68, end: 1.0, confidence: 1.0 },
      { word: 'product.', start: 1.09, end: 1.41, confidence: 1.0 },
    ],
  };
  const scriptText = 'Introducing Demo Product.';
  const canon = buildCanon({});
  const r = analyseTranscript(stt, scriptText, canon);
  assert.equal(r.ops.length, 0);

  const brandWords = ['demo', 'product'];
  const words = r.words.map((w, i) => ({
    i, w: brandNormalize(w.word, brandWords),
    start: +w.start.toFixed(3), end: +w.end.toFixed(3), conf: w.conf,
  }));
  // brand words should be capitalised
  assert.equal(words[1].w, 'Demo');
  assert.equal(words[2].w, 'Product.');

  const sentences = buildSentences(words);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Introducing Demo Product.');
  assert.equal(sentences[0].first, 0);
  assert.equal(sentences[0].last, 2);
});

// ── 4. gaps: fixture scene-boundary computation ────────────────────────────────

test('fixture timing_nogaps.json: both scene boundaries are ~0.55 s', () => {
  const { boundaries } = parseScript(readFileSync(join(FIXTURE, 'script.md'), 'utf8'));
  const { words } = JSON.parse(readFileSync(join(FIXTURE, 'vo/timing_nogaps.json'), 'utf8'));
  assert.equal(boundaries.length, 2, 'sample-15s has 2 scene boundaries');
  for (const b of boundaries) {
    const bare = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
    const i = words.findIndex((w, k) =>
      bare(w.w) === bare(b.after) && words[k + 1] && bare(words[k + 1].w) === bare(b.before));
    assert.ok(i >= 0, `boundary "${b.after} | ${b.before}" not found`);
    const gap = +(words[i + 1].start - words[i].end).toFixed(3);
    assert.ok(Math.abs(gap - 0.55) < 0.01, `"${b.after}|${b.before}" gap ${gap} s ≠ ~0.55 s`);
  }
});

test('fixture timing.json: both scene boundaries are ~1.00 s (nogaps + 0.45 s)', () => {
  const { boundaries } = parseScript(readFileSync(join(FIXTURE, 'script.md'), 'utf8'));
  const { words } = JSON.parse(readFileSync(join(FIXTURE, 'vo/timing.json'), 'utf8'));
  for (const b of boundaries) {
    const bare = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
    const i = words.findIndex((w, k) =>
      bare(w.w) === bare(b.after) && words[k + 1] && bare(words[k + 1].w) === bare(b.before));
    assert.ok(i >= 0, `boundary "${b.after} | ${b.before}" not found in timing.json`);
    const gap = +(words[i + 1].start - words[i].end).toFixed(3);
    assert.ok(Math.abs(gap - 1.00) < 0.01, `"${b.after}|${b.before}" gap ${gap} s ≠ ~1.00 s`);
  }
});

test('computeGapInsertions: fixture no-gaps boundaries → +0.45 s each with --max 1.0', () => {
  const { boundaries } = parseScript(readFileSync(join(FIXTURE, 'script.md'), 'utf8'));
  const { words } = JSON.parse(readFileSync(join(FIXTURE, 'vo/timing_nogaps.json'), 'utf8'));
  const cuts = computeGapInsertions(words, boundaries, 1.0);
  assert.equal(cuts.length, 2, 'both boundaries need widening');
  for (const c of cuts) {
    assert.ok(Math.abs(c.added - 0.45) < 0.005, `expected +0.45 s, got ${c.added.toFixed(3)} s`);
  }
});

test('computeGapInsertions: skips boundaries already at target', () => {
  const words = [
    { w: 'scene.', start: 0.0, end: 0.3 },
    { w: 'Next', start: 1.4, end: 1.7 }, // gap = 1.1 s > 1.0 s target → skip
  ];
  const boundaries = [{ after: 'scene.', before: 'Next' }];
  const cuts = computeGapInsertions(words, boundaries, 1.0);
  assert.equal(cuts.length, 0);
});

// ── 5. generate with fake client ──────────────────────────────────────────────

test('generate: writes wav + meta.json, records cost in promo.json', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vo-gen-'));
  try {
    // minimal project setup
    writeFileSync(join(tmp, 'promo.json'), JSON.stringify({
      name: 'test', engine: '1.0.0', mode: 'gated',
      budget: { limitUsd: 10, spentUsd: 0 },
      output: { formats: ['landscape'], primary: 'landscape', sizes: ['720p'], fps: 30 },
      stages: {}, gates: [], spend: [], provider_overrides: {},
    }, null, 2));
    writeFileSync(join(tmp, 'theme.json'), JSON.stringify({ brandWords: [] }));
    writeFileSync(join(tmp, 'script.md'), '## 01-intro\n> Hello world.\n');

    // 1 second of silence: 24000 samples × 2 bytes = 48000 bytes (s16le 24 kHz mono)
    const fakePcm = Buffer.alloc(48000, 0);
    setClient({
      tts: async () => ({ audio: fakePcm, id: 'fake-gen-id' }),
      actualCost: async () => 0.001,
    });

    // use explicit model to avoid both audition models being called
    await commands.generate({
      project: tmp, pos: ['t01'], flags: { model: 'google/gemini-3.8-flash-tts' }, log: () => {},
    });

    assert.ok(existsSync(join(tmp, 'assets/vo_raw/t01.wav')), 'wav file written');
    assert.ok(existsSync(join(tmp, 'assets/vo_raw/t01.meta.json')), 'meta.json written');

    const meta = JSON.parse(readFileSync(join(tmp, 'assets/vo_raw/t01.meta.json'), 'utf8'));
    assert.equal(meta.model, 'google/gemini-3.8-flash-tts');

    const state = JSON.parse(readFileSync(join(tmp, 'promo.json'), 'utf8'));
    assert.ok(state.budget.spentUsd > 0, 'cost recorded in promo.json');
    assert.equal(state.spend.length, 1);
    assert.equal(state.spend[0].stage, 'voice');
  } finally {
    setClient(GUARD); // restore guard
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('generate --takes 2: two wavs with suffixed names, two spend entries', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vo-gen2-'));
  try {
    writeFileSync(join(tmp, 'promo.json'), JSON.stringify({
      name: 'test', engine: '1.0.0', mode: 'gated',
      budget: { limitUsd: 10, spentUsd: 0 },
      output: { formats: ['landscape'], primary: 'landscape', sizes: ['720p'], fps: 30 },
      stages: {}, gates: [], spend: [], provider_overrides: {},
    }, null, 2));
    writeFileSync(join(tmp, 'theme.json'), JSON.stringify({ brandWords: [] }));
    writeFileSync(join(tmp, 'script.md'), '## 01-intro\n> Hello world.\n');

    let callCount = 0;
    const fakePcm = Buffer.alloc(48000, 0);
    setClient({
      tts: async () => { callCount++; return { audio: fakePcm, id: `fake-${callCount}` }; },
      actualCost: async () => 0.001,
    });

    const result = await commands.generate({
      project: tmp, pos: ['t'], flags: { model: 'google/gemini-3.8-flash-tts', takes: '2' }, log: () => {},
    });

    assert.equal(result.takes.length, 2);
    assert.equal(callCount, 2);
    // both files should exist
    for (const take of result.takes) {
      assert.ok(existsSync(take.path), `${take.path} should exist`);
    }
    const state = JSON.parse(readFileSync(join(tmp, 'promo.json'), 'utf8'));
    assert.equal(state.spend.length, 2, 'two spend entries for two takes');
  } finally {
    setClient(GUARD);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('gap insertions: digits and accents match, --min leaves long pauses alone', async () => {
  const { computeGapInsertions } = await import('../../engine/tools/vo.mjs');
  const words = [{ w: '7', start: 0, end: 0.3 }, { w: 'Café.', start: 0.6, end: 1.0 }, { w: 'Go', start: 1.9, end: 2.1 }];
  const b = [{ after: '7', before: 'Café.' }, { after: 'Café.', before: 'Go' }];
  assert.deepEqual(computeGapInsertions(words, b, 1.0, 0.85).map((c) => [c.after, c.added]), [['7', 0.7]]);
  assert.equal(computeGapInsertions(words, b, 1.0, 0).length, 2);
});

test('vo timing --words: own word times instead of STT (no API), seeds the no-gaps pair', async () => {
  const { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { commands } = await import('../../engine/tools/vo.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'vo-words-'));
  const fx = fileURLToPath(new URL('../../fixtures/sample-15s/', import.meta.url));
  for (const f of ['promo.json', 'theme.json', 'script.md', 'assets/vo/vo_nogaps.wav']) cpSync(join(fx, f), join(dir, f === 'assets/vo/vo_nogaps.wav' ? 'assets/vo/vo.wav' : f), { recursive: true });
  rmSync(join(dir, 'vo'), { recursive: true, force: true });
  const r = await commands.timing({ project: dir, pos: [], flags: { words: join(fx, 'vo/timing_nogaps.json'), 'vo-start': '0.5' }, log: () => {} });
  assert.equal(r.words, 21);
  const t = JSON.parse(readFileSync(join(dir, 'vo/timing.json'), 'utf8'));
  assert.equal(t.transcriber, 'own word times');
  assert.equal(t.words[17].w, 'Get');
  assert.ok(existsSync(join(dir, 'vo/timing_nogaps.json')) && existsSync(join(dir, 'assets/vo/vo_nogaps.wav')));
  await assert.rejects(commands.timing({ project: dir, pos: [], flags: {}, log: () => {} }), /vo stt|--words/);
});

test('compound brand words: one STT token for two script words, and the reverse', async () => {
  const { analyseTranscript, buildCanon } = await import('../../engine/tools/lib/vo-analyse.mjs');
  const canon = buildCanon({});
  const w = (word, start, end) => ({ word, start, end, confidence: 0.9 });
  const a = analyseTranscript({ words: [w('Hello', 0, 0.4), w('from', 0.45, 0.6), w('PromoClip,', 0.65, 1.25), w('hi.', 1.4, 1.6)] }, 'Hello from promo clip, hi.', canon);
  assert.deepEqual(a.ops, []);
  assert.deepEqual(a.words.slice(2, 4).map((x) => [x.word, x.start, x.end]), [['promo', 0.65, 0.983], ['clip,', 0.983, 1.25]]);
  assert.equal(a.tight.length, 0);
  const b = analyseTranscript({ words: [w('Get', 0, 0.2), w('Demo', 0.3, 0.5), w('Product', 0.55, 0.9)] }, 'Get DemoProduct', canon);
  assert.deepEqual(b.ops, []);
  assert.equal(b.words.length, 2);
  assert.equal(b.words[1].end, 0.9);
});
