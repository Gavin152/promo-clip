// One door for every paid API call: estimate -> budget check -> call (with model fallbacks) ->
// record the actual cost (or the estimate if OpenRouter reports none) in promo.json.
import { loadState, updateState } from './state.mjs';
import { loadProviders, modelChain, estimate, ensureBudget, recordSpend } from './cost.mjs';
import { client as makeClient, withFallback } from '../providers/openrouter.mjs';

let shared = null;
/** a shared OpenRouter client for this process (title = project name) */
export function getClient(project) {
  if (!shared) {
    let title = 'promo-clip';
    try { title = `promo-clip: ${loadState(project).name}`; } catch { /* no promo.json yet */ }
    shared = makeClient({ project, title });
  }
  return shared;
}
/** tests inject a fake client */
export function setClient(c) { shared = c; }

/**
 * dry estimate for n calls without calling anything.
 * returns { model, usd, models }
 */
export function quote(project, need, params = {}, n = 1, model) {
  const state = loadState(project);
  const providers = loadProviders(project, state);
  const models = model ? [model] : modelChain(providers, need);
  return { model: models[0], models, usd: estimate(providers, need, models[0], params, n) };
}

/**
 * paid({ project, stage, need, what, params, model?, call })
 *   need:   'tts' | 'stt' | 'music' | 'images' | 'judge' (providers.json section)
 *   params: estimate inputs (tts {chars}, stt {seconds}, images {hires})
 *   model:  force one model (no fallbacks); default = providers default + fallbacks
 *   call:   async (model, client) => reply  (reply.usage.cost or reply.id lets us read the actual cost)
 * Throws BudgetError (code 3) before calling if the estimate exceeds what is left.
 * Returns { model, reply, usd, estimated }.
 */
export async function paid({ project, stage, need, what, params = {}, model, call, log = console.warn }) {
  const state = loadState(project);
  const providers = loadProviders(project, state);
  const models = model ? [model] : modelChain(providers, need);
  const est = estimate(providers, need, models[0], params);
  ensureBudget(state, est, what ?? need);
  const c = getClient(project);
  const { model: used, result: reply } = await withFallback(models, (m) => call(m, c), { log });
  let usd = null;
  try { usd = await c.actualCost(reply); } catch { /* stats unavailable */ }
  const estimated = usd == null;
  if (estimated) usd = estimate(providers, need, used, params);
  updateState(project, (s) => recordSpend(s, { stage, what: what ?? need, model: used, usd, estimated, generationId: reply?.id }));
  return { model: used, reply, usd, estimated };
}
