// Project-level commands: setup, check, status, next, cost, stage, gate, mode, budget, output, upgrade.
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENGINE, ENGINE_VERSION, readJson } from './lib/paths.mjs';
import { STAGES, defaultState, loadState, saveState, updateState, startStage, finishStage, failStage, markStale, recordGate, setMode, setOutput, nextStage, effectiveStatus } from './lib/state.mjs';
import { costReport, round } from './lib/cost.mjs';
import { checkDeps } from './lib/deps.mjs';
import { loadKey } from './providers/openrouter.mjs';
import { resolveSize } from '../js/formats.js';

/** engine files copied into a video folder (relative to the engine root) */
export const ENGINE_FILES = ['js', 'tools', 'index.html', 'VERSION', 'assets/fonts'];
const SKIP = new Set(['node_modules', '.DS_Store']);
const copyFilter = (src) => !SKIP.has(basename(src));

const GITIGNORE = `node_modules/
.work/
.env
promo.bundle.js
out/*.mp4
`;
const ENV_EXAMPLE = `# Copy to .env (gitignored). Only needed for AI voice, music and art.
OPENROUTER_API_KEY=
`;

function npmInstall(dir, log) {
  log(`installing tool packages in ${dir} …`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = existsSync(join(dir, 'package-lock.json')) ? ['ci', '--silent', '--no-audit', '--no-fund'] : ['install', '--silent', '--no-audit', '--no-fund'];
  execFileSync(npm, args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
}

/**
 * creates a video folder: copies the engine, writes promo.json / theme.json / manifest.json skeletons.
 * Existing folders with promo.json are left alone (returns their state).
 */
export async function setup({ dir, name, install = true, checkFirst = true, log = console.log }) {
  const target = resolve(dir ?? '.');
  const deps = checkFirst ? await checkDeps({ project: target, keyLoader: loadKey }) : [];
  const blocking = deps.filter((d) => !d.ok && ['node', 'chrome'].includes(d.name));
  if (blocking.length) {
    const e = new Error(`missing dependencies:\n${blocking.map((d) => `  - ${d.name}: ${d.hint}`).join('\n')}`);
    e.code = 1;
    throw e;
  }
  if (existsSync(join(target, 'promo.json'))) {
    log(`${target} already has promo.json; leaving it as is`);
    return { created: false, project: target, state: loadState(target), deps };
  }
  if (resolve(ENGINE) === target) throw new Error('cannot set up a video inside the engine folder');
  mkdirSync(target, { recursive: true });
  for (const f of ENGINE_FILES) cpSync(join(ENGINE, f), join(target, f), { recursive: true, filter: copyFilter });
  cpSync(join(ENGINE, 'providers.json'), join(target, 'providers.json'));
  for (const d of ['scenes', 'vo', 'assets/vo', 'assets/music', 'assets/art/raw', 'assets/img', 'assets/ref', 'out']) mkdirSync(join(target, d), { recursive: true });
  const nm = name ?? basename(target);
  const theme = readJson(join(ENGINE, 'theme.default.json'));
  theme.name = nm;
  theme.logo = { ...theme.logo, text: nm };
  writeFileSync(join(target, 'theme.json'), JSON.stringify(theme, null, 2) + '\n');
  writeFileSync(join(target, 'manifest.json'), '{}\n');
  if (!existsSync(join(target, '.gitignore'))) writeFileSync(join(target, '.gitignore'), GITIGNORE);
  writeFileSync(join(target, '.env.example'), ENV_EXAMPLE);
  const state = defaultState(nm, ENGINE_VERSION);
  saveState(target, state);
  if (install) npmInstall(join(target, 'tools'), log);
  log(`created ${target} (engine ${ENGINE_VERSION})`);
  return { created: true, project: target, state, deps };
}

export async function check({ project, needKey = false }) {
  return checkDeps({ project, needKey, keyLoader: loadKey });
}

/** stage table + next stage + budget; warns when the video's engine differs from these tools */
export function status(project) {
  const s = loadState(project);
  const stages = STAGES.map((st) => ({ stage: st, ...s.stages[st], status: effectiveStatus(s.stages[st]) }));
  return {
    name: s.name,
    engine: s.engine,
    toolsEngine: ENGINE_VERSION,
    engineMismatch: s.engine !== ENGINE_VERSION,
    mode: s.mode,
    output: s.output,
    budget: s.budget,
    next: nextStage(s),
    stages,
    gates: s.gates.length,
  };
}

export function formatStatus(st) {
  const pad = (x, n) => String(x ?? '').padEnd(n);
  const lines = [`${st.name} · engine ${st.engine}${st.engineMismatch ? ` (tools are ${st.toolsEngine}; run /promo-clip:upgrade to update)` : ''} · ${st.mode} mode`];
  lines.push(`budget $${(st.budget.spentUsd ?? 0).toFixed(2)} of $${(st.budget.limitUsd ?? 0).toFixed(2)} · output ${st.output.formats.join('/')} (primary ${st.output.primary}) ${st.output.sizes.join('/')} @${st.output.fps}fps`);
  lines.push('');
  for (const r of st.stages) lines.push(`  ${r.stage === st.next ? '→' : ' '} ${pad(r.stage, 9)} ${pad(r.status, 8)} ${pad(r.at?.slice(0, 16).replace('T', ' '), 17)} ${r.cost ? `$${r.cost.toFixed(3)}` : ''} ${r.reason ? `(${r.reason})` : ''}`.trimEnd());
  lines.push('', st.next ? `next: ${st.next}` : 'all stages done');
  return lines.join('\n');
}

export function cost(project) {
  return costReport(loadState(project));
}
export function formatCost(r) {
  const lines = Object.entries(r.byStage).map(([k, v]) => `  ${k.padEnd(9)} $${v.usd.toFixed(3)}  (${v.n} calls${v.estimated ? `, ${v.estimated} estimated` : ''})`);
  return [`spent $${r.spentUsd.toFixed(3)} of $${r.limitUsd.toFixed(2)} (left $${r.remainingUsd.toFixed(3)})`, ...lines].join('\n');
}

/** stage <name> start|done|fail|stale [--reason] */
export function stage(project, name, action, { reason, data } = {}) {
  return updateState(project, (s) => {
    if (action === 'start') startStage(s, name);
    else if (action === 'done') finishStage(s, name, data ?? {});
    else if (action === 'fail') failStage(s, name, reason ?? 'failed');
    else if (action === 'stale') markStale(s, name, reason ?? 'marked stale');
    else throw new Error('stage action must be start|done|fail|stale');
    return { stage: name, ...s.stages[name] };
  });
}

export function gate(project, stageName, choice, { by = 'human', why = '' } = {}) {
  return updateState(project, (s) => { recordGate(s, stageName, choice, by, why); return s.gates.at(-1); });
}

export function mode(project, m) {
  return updateState(project, (s) => (m ? setMode(s, m).mode : s.mode));
}

export function budget(project, usd) {
  return updateState(project, (s) => {
    if (usd != null) {
      const v = Number(usd);
      if (!(v >= 0)) throw new Error('budget must be a number >= 0');
      s.budget.limitUsd = round(v);
    }
    return s.budget;
  });
}

/** output [--formats a,b] [--primary f] [--sizes 1080p,4K] [--fps 30] */
export function output(project, o) {
  const list = (x) => (x == null ? undefined : String(x).split(',').map((v) => v.trim()).filter(Boolean));
  return updateState(project, (s) => setOutput(s, { formats: list(o.formats), primary: o.primary, sizes: list(o.sizes), fps: o.fps }, resolveSize).output);
}

/**
 * replaces the video's engine files (js/, tools/ except node_modules, index.html, VERSION, fonts) with
 * this engine's, bumps promo.json engine, marks scenes stale. The video's scenes/, timeline.js,
 * theme.json, manifest.json, providers.json and assets are untouched.
 */
export function upgrade(project, { install = true, log = console.log } = {}) {
  project = resolve(project);
  if (project === resolve(ENGINE)) throw new Error('run upgrade with the plugin\'s engine tools: node <plugin>/engine/tools/cli.mjs upgrade --project <video>');
  const s = loadState(project);
  const from = s.engine;
  const oldPkg = existsSync(join(project, 'tools/package.json')) ? readFileSync(join(project, 'tools/package.json'), 'utf8') : '';
  // clear old engine files first so removed modules don't linger (node_modules kept)
  for (const f of ['js', 'tools']) {
    const d = join(project, f);
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d)) if (e !== 'node_modules') rmSync(join(d, e), { recursive: true, force: true });
  }
  for (const f of ENGINE_FILES) cpSync(join(ENGINE, f), join(project, f), { recursive: true, filter: copyFilter });
  const newPkg = readFileSync(join(project, 'tools/package.json'), 'utf8');
  if (install && (newPkg !== oldPkg || !existsSync(join(project, 'tools/node_modules')))) npmInstall(join(project, 'tools'), log);
  s.engine = ENGINE_VERSION;
  markStale(s, 'scenes', `engine upgraded ${from} -> ${ENGINE_VERSION}`);
  saveState(project, s);
  log(`engine ${from} -> ${ENGINE_VERSION} in ${relative(process.cwd(), project) || '.'}; scenes marked stale — render stills to compare`);
  return { from, to: ENGINE_VERSION, project };
}
