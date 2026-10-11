import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProviders, modelChain, estimate, ensureBudget, recordSpend, costReport, remaining, BudgetError } from '../../engine/tools/lib/cost.mjs';
import { defaultState } from '../../engine/tools/lib/state.mjs';

const P = loadProviders(null, null);

test('providers.json has a default + prices for every model in each chain', () => {
  for (const need of ['tts', 'music', 'images', 'stt', 'judge']) {
    const chain = modelChain(P, need);
    assert.ok(chain.length >= 2, `${need} has fallbacks`);
    for (const m of chain) assert.ok(P[need].prices[m], `${need} price for ${m}`);
  }
  for (const m of P.tts.audition) assert.ok(P.tts.prices[m], `audition model ${m} priced`);
});

test('estimates per need', () => {
  assert.equal(estimate(P, 'tts', 'google/gemini-3.8-flash-tts', { chars: 1000 }), 0.016);
  assert.equal(estimate(P, 'tts', 'google/gemini-3.8-flash-tts', { chars: 1000 }, 3), 0.048);
  assert.equal(estimate(P, 'music', 'google/lyria-3-pro-preview'), 0.08);
  assert.equal(estimate(P, 'images', 'google/gemini-3.1-flash-image', { hires: true }), 0.1);
  assert.equal(estimate(P, 'stt', 'assemblyai/universal-3-5-pro', { seconds: 120 }), 0.015);
  assert.throws(() => estimate(P, 'tts', 'nope/model', {}), /no price/);
});

test('provider overrides from promo.json replace fields per need', () => {
  const p = loadProviders(null, { provider_overrides: { tts: { default: 'microsoft/mai-voice-2', fallbacks: [] } } });
  assert.deepEqual(modelChain(p, 'tts'), ['microsoft/mai-voice-2']);
  assert.ok(p.tts.prices['microsoft/mai-voice-2']);
});

test('budget: refuses over the limit, records spend per stage', () => {
  const s = defaultState('t', '1');
  s.budget.limitUsd = 0.1;
  assert.equal(ensureBudget(s, 0.08), 0.1 - 0.08);
  recordSpend(s, { stage: 'music', what: 'candidate A', model: 'm', usd: 0.08 });
  assert.equal(remaining(s), 0.02);
  assert.throws(() => ensureBudget(s, 0.08, 'candidate B'), (e) => e instanceof BudgetError && e.code === 3 && /candidate B/.test(e.message));
  recordSpend(s, { stage: 'music', what: 'x', model: 'm', usd: 0.01, estimated: true });
  const r = costReport(s);
  assert.deepEqual(r.byStage.music, { usd: 0.09, n: 2, estimated: 1 });
  assert.equal(s.stages.music.cost, 0.09);
  assert.equal(r.remainingUsd, 0.01);
});
