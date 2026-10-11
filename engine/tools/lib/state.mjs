// promo.json: the video's state. Stages, gate decisions, mode, budget, output, engine version.
// Writes are atomic (temp file + rename). A stage records its result only when it finishes, so a
// crash resumes at that stage; partial outputs live in .work/.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const STAGES = ['discover', 'script', 'voice', 'music', 'art', 'scenes', 'formats', 'export'];
export const STATUSES = ['todo', 'running', 'done', 'stale', 'failed'];
/** direct dependents: re-running a stage makes these (and their dependents) stale */
export const DEPENDENTS = {
  discover: ['script'],
  script: ['voice', 'scenes'],
  voice: ['scenes', 'music'],
  music: ['export'],
  art: ['scenes'],
  scenes: ['formats', 'export'],
  formats: ['export'],
  export: [],
};
/** a 'running' stage whose `at` is older than this is treated as failed (crashed) */
export const HEARTBEAT_MS = 10 * 60 * 1000;
export const MODES = ['gated', 'auto'];
export const FPS = [24, 25, 30, 60];

export function defaultState(name, engine) {
  return {
    name,
    engine,
    mode: 'gated',
    budget: { limitUsd: 10, spentUsd: 0 },
    output: { formats: ['landscape'], primary: 'landscape', sizes: ['1080p'], fps: 30 },
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'todo' }])),
    gates: [],
    spend: [],
    provider_overrides: {},
  };
}

export const statePath = (project) => join(project, 'promo.json');

export function loadState(project) {
  const p = statePath(project);
  if (!existsSync(p)) throw new Error(`no promo.json in ${project} (run setup first)`);
  const s = JSON.parse(readFileSync(p, 'utf8'));
  s.stages ??= {};
  for (const st of STAGES) s.stages[st] ??= { status: 'todo' };
  s.gates ??= [];
  s.spend ??= [];
  s.budget ??= { limitUsd: 10, spentUsd: 0 };
  return s;
}

/** atomic write: temp file + rename */
export function saveState(project, state) {
  const p = statePath(project);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, p);
  return state;
}

/** load -> fn(state) -> save, returns fn's result */
export function updateState(project, fn) {
  const s = loadState(project);
  const r = fn(s);
  saveState(project, s);
  return r;
}

const now = (clock) => new Date(clock ? clock() : Date.now()).toISOString();
function check(stage) {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage "${stage}" (${STAGES.join(', ')})`);
}

/** every stage downstream of `stage` (transitively), in STAGES order */
export function downstream(stage) {
  check(stage);
  const seen = new Set();
  const walk = (s) => { for (const d of DEPENDENTS[s]) if (!seen.has(d)) { seen.add(d); walk(d); } };
  walk(stage);
  return STAGES.filter((s) => seen.has(s));
}

export function startStage(state, stage, clock) {
  check(stage);
  state.stages[stage] = { ...state.stages[stage], status: 'running', at: now(clock) };
  delete state.stages[stage].reason;
  return state;
}

/**
 * marks a stage done and every downstream stage that was done as stale (reason names the stage).
 * Stages that were never run stay 'todo'.
 */
export function finishStage(state, stage, extra = {}, clock) {
  check(stage);
  const prev = state.stages[stage] ?? {};
  state.stages[stage] = { ...prev, ...extra, status: 'done', at: now(clock) };
  delete state.stages[stage].reason;
  for (const d of downstream(stage)) {
    const st = state.stages[d];
    if (st?.status === 'done') state.stages[d] = { ...st, status: 'stale', reason: `${stage} changed` };
  }
  return state;
}

export function failStage(state, stage, reason, clock) {
  check(stage);
  state.stages[stage] = { ...state.stages[stage], status: 'failed', reason: String(reason), at: now(clock) };
  return state;
}

export function markStale(state, stage, reason) {
  check(stage);
  const st = state.stages[stage];
  if (st?.status === 'done') state.stages[stage] = { ...st, status: 'stale', reason };
  return state;
}

/** effective status: a 'running' stage without a heartbeat for HEARTBEAT_MS counts as failed */
export function effectiveStatus(st, clock) {
  if (st?.status === 'running' && st.at && (clock ? clock() : Date.now()) - Date.parse(st.at) > HEARTBEAT_MS) return 'failed';
  return st?.status ?? 'todo';
}

/** the first stage that is not done (todo, stale, failed, or stuck running) — where /promo-clip resumes */
export function nextStage(state, clock) {
  return STAGES.find((s) => effectiveStatus(state.stages[s], clock) !== 'done') ?? null;
}

/** records a gate decision: by 'human' or 'auto' (with why) */
export function recordGate(state, stage, choice, by = 'human', why = '', clock) {
  check(stage);
  if (!['human', 'auto'].includes(by)) throw new Error(`gate by must be human|auto`);
  state.gates.push({ stage, choice: String(choice), by, ...(why ? { why } : {}), at: now(clock) });
  return state;
}

export function setMode(state, mode) {
  if (!MODES.includes(mode)) throw new Error(`mode must be ${MODES.join('|')}`);
  state.mode = mode;
  return state;
}

/** validates and sets output settings; any field may be omitted */
export function setOutput(state, { formats, primary, sizes, fps } = {}, resolveSize) {
  const out = { ...state.output };
  if (formats) out.formats = formats;
  if (primary) out.primary = primary;
  if (sizes) out.sizes = sizes;
  if (fps != null) out.fps = Number(fps);
  for (const f of out.formats) if (!['landscape', 'vertical', 'square'].includes(f)) throw new Error(`unknown format ${f}`);
  if (!out.formats.includes(out.primary)) throw new Error(`primary ${out.primary} is not one of the formats`);
  if (!FPS.includes(out.fps)) throw new Error(`fps must be one of ${FPS.join(', ')}`);
  if (resolveSize) for (const f of out.formats) for (const s of out.sizes) resolveSize(f, s);
  state.output = out;
  return state;
}
