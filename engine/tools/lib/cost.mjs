// Cost estimates (from providers.json prices) and the budget. Every paid step estimates first;
// a step that would go over budget is refused. spentUsd sums the actual costs OpenRouter reports
// (estimate only when no actual cost came back).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from './paths.mjs';

export class BudgetError extends Error {
  constructor(msg) { super(msg); this.name = 'BudgetError'; this.code = 3; }
}

/** providers.json: the project's copy if present, else the engine's; promo.json provider_overrides merged per need */
export function loadProviders(project, state) {
  const p = project && existsSync(join(project, 'providers.json')) ? join(project, 'providers.json') : join(ENGINE, 'providers.json');
  const base = JSON.parse(readFileSync(p, 'utf8'));
  for (const [need, o] of Object.entries(state?.provider_overrides ?? {})) base[need] = { ...base[need], ...o };
  return base;
}

/** ordered model list for a need: default, then fallbacks (deduplicated) */
export function modelChain(providers, need) {
  const p = providers[need];
  if (!p) throw new Error(`no provider config for "${need}"`);
  return [...new Set([p.default, ...(p.fallbacks ?? [])].filter(Boolean))];
}

/**
 * estimate in USD. params by need:
 *   tts {chars} | stt {seconds} | music {} | images {hires} | judge {}
 * n = how many generations.
 */
export function estimate(providers, need, model, params = {}, n = 1) {
  const price = providers[need]?.prices?.[model];
  if (!price) throw new Error(`no price for ${need} model ${model} in providers.json`);
  let one;
  switch (need) {
    case 'tts': one = (params.chars ?? 0) * price.per_char; break;
    case 'stt': one = ((params.seconds ?? 60) / 60) * price.per_minute; break;
    case 'music': one = price.per_generation; break;
    case 'images': one = params.hires ? price.per_image_2k ?? price.per_image : price.per_image; break;
    case 'judge': one = price.per_call; break;
    default: throw new Error(`unknown need ${need}`);
  }
  return round(one * n);
}
export const round = (x) => Math.round(x * 1e4) / 1e4;

export function remaining(state) {
  const { limitUsd = 0, spentUsd = 0 } = state.budget ?? {};
  return round(limitUsd - spentUsd);
}

/** throws BudgetError if spending `usd` would exceed the limit */
export function ensureBudget(state, usd, what = 'this step') {
  const left = remaining(state);
  if (usd > left + 1e-9) {
    throw new BudgetError(`${what} is estimated at $${usd.toFixed(3)} but only $${left.toFixed(3)} of the $${(state.budget?.limitUsd ?? 0).toFixed(2)} budget is left (raise it with: cli.mjs budget <usd>)`);
  }
  return left - usd;
}

/** adds a spend entry and updates spentUsd; usd = actual cost if known, else the estimate */
export function recordSpend(state, { stage, what, model, usd, estimated = false, generationId }) {
  state.spend ??= [];
  state.budget ??= { limitUsd: 0, spentUsd: 0 };
  const entry = { at: new Date().toISOString(), stage, what, model, usd: round(usd), ...(estimated ? { estimated: true } : {}), ...(generationId ? { id: generationId } : {}) };
  state.spend.push(entry);
  state.budget.spentUsd = round((state.budget.spentUsd ?? 0) + usd);
  if (stage && state.stages?.[stage]) state.stages[stage].cost = round((state.stages[stage].cost ?? 0) + usd);
  return entry;
}

/** per-stage totals for the cost report */
export function costReport(state) {
  const by = {};
  for (const s of state.spend ?? []) {
    const k = s.stage ?? 'other';
    by[k] ??= { usd: 0, n: 0, estimated: 0 };
    by[k].usd = round(by[k].usd + s.usd);
    by[k].n++;
    if (s.estimated) by[k].estimated++;
  }
  return { byStage: by, spentUsd: state.budget?.spentUsd ?? 0, limitUsd: state.budget?.limitUsd ?? 0, remainingUsd: remaining(state) };
}
