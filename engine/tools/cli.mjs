#!/usr/bin/env node
// promo-clip engine CLI. Run inside a video folder (or pass --project <dir>).
// Every command returns a result object; --json prints it on stdout (logs go to stderr), so the
// plugin's skills can parse it. Exit codes: 0 ok, 1 error, 2 QA failed, 3 over budget.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProject, ENGINE_VERSION, readJson } from './lib/paths.mjs';
import * as P from './project.mjs';
import { parseArgs } from './lib/args.mjs';

// Everything that needs the npm packages (esbuild, sharp, puppeteer, ffmpeg) loads on first use, so
// the project commands (setup, check, status, upgrade …) also run from a fresh plugin install that
// has no node_modules of its own — setup installs them into the new video folder.
const build = async (...a) => (await import('./build-assets.mjs')).build(...a);
const stills = async (...a) => (await import('./stills.mjs')).stills(...a);
const exportVideo = async (...a) => (await import('./export.mjs')).exportVideo(...a);
const loadQa = () => import('./qa.mjs');
const GROUPS = { vo: () => import('./vo.mjs'), music: () => import('./music.mjs'), art: () => import('./art.mjs') };

async function usage() {
  let assets;
  try {
    const [vo, music, art] = await Promise.all([GROUPS.vo(), GROUPS.music(), GROUPS.art()]);
    assets = `${vo.USAGE}\n${music.USAGE}\n${art.USAGE}`;
  } catch {
    assets = '  vo | music | art …                     (run `npm ci` in this tools/ folder to list them)';
  }
  return `promo-clip engine ${ENGINE_VERSION}
usage: cli.mjs <command> [args] [--project dir] [--json] [--quiet]

project
  setup [dir] [--name N] [--no-install]   create a video folder (copies the engine)
  check [--need-key]                      check Node, Chrome, ffmpeg, packages, API key
  status                                  stage table, next stage, budget
  next                                    first stage that is not done
  cost                                    spend per stage
  stage <name> start|done|fail|stale [--reason R]
  gate <stage> <choice> [--by human|auto] [--why W]
  mode [gated|auto]                       show / set gate mode
  budget [usd]                            show / set the cost limit
  output [--formats a,b] [--primary f] [--sizes s,t] [--fps n]
  upgrade [--no-install]                  replace the video's engine with this one

render
  build [--tag T --scene S]               bundle the player (promo.bundle.js); --tag = a private build in .work/build-T for one parallel scene writer
  stills <dir> [t …] [--scenes] [--sheet] proof frames (--format, --size, --png); --sheet = one labelled image; --tag T --scene S = a writer's own build / scene
  export [--format F|--all] [--size S] [--fps N] [--web-only] [--audio-only] [--stems] [--out file] [--no-build]
  qa [--format F] [--size S]              QA report on the exports (exit 2 on issues)
  layout [--format F] [--tag T --scene S] overlap / clipping / safe-zone check of every scene, or one (exit 2 on errors)

assets
${assets}`;
}

async function run(cmd, pos, flags, ctx) {
  const { project } = ctx;
  const format = flags.format ?? 'landscape';
  const size = flags.size ?? '1080p';
  switch (cmd) {
    case 'setup': return P.setup({ dir: pos[0] ?? flags.project ?? '.', name: flags.name, install: !flags['no-install'], log: ctx.log });
    case 'check': {
      const r = await P.check({ project, needKey: !!flags['need-key'] });
      for (const d of r) ctx.log(`${d.optional ? '-- ' : d.ok ? 'ok ' : 'NO '} ${d.name.padEnd(18)} ${d.detail}${d.hint ? `\n    -> ${d.hint}` : ''}`);
      if (r.some((d) => !d.ok)) { const e = new Error('some dependencies are missing'); e.code = 1; e.result = r; throw e; }
      return r;
    }
    case 'status': { const r = P.status(project); ctx.log(P.formatStatus(r)); return r; }
    case 'next': { const r = P.status(project).next; ctx.log(r ?? 'done'); return { next: r }; }
    case 'cost': { const r = P.cost(project); ctx.log(P.formatCost(r)); return r; }
    case 'stage': return P.stage(project, pos[0], pos[1], { reason: flags.reason });
    case 'gate': return P.gate(project, pos[0], pos[1], { by: flags.by, why: flags.why });
    case 'mode': { const m = P.mode(project, pos[0]); ctx.log(m); return { mode: m }; }
    case 'budget': { const b = P.budget(project, pos[0]); ctx.log(`$${b.spentUsd.toFixed(3)} of $${b.limitUsd.toFixed(2)}`); return b; }
    case 'output': return P.output(project, flags);
    case 'upgrade': return P.upgrade(project, { install: !flags['no-install'], log: ctx.log });
    case 'build': return build(project, { quiet: flags.quiet, tag: flags.tag, scene: flags.scene });
    case 'stills': {
      const [out, ...times] = pos;
      if (!out || (!times.length && !flags.scenes)) throw new Error('usage: stills <dir> <t…> | --scenes');
      if (!flags['no-build']) await build(project, { quiet: true, tag: flags.tag, scene: flags.scene });
      return stills(project, out, { times: times.map(Number), scenes: !!flags.scenes, format, size, quiet: flags.quiet, png: flags.png, sheet: !!flags.sheet, tag: flags.tag, scene: flags.scene });
    }
    case 'export': {
      const o = { size, fps: flags.fps, webOnly: !!flags['web-only'], audioOnly: !!flags['audio-only'], stems: !!flags.stems, out: flags.out, noBuild: !!flags['no-build'], quiet: flags.quiet };
      if (!flags.all) return exportVideo(project, { ...o, format });
      // --all: every format x size from promo.json output, one build
      const st = readJson(join(project, 'promo.json'));
      const res = [];
      let built = !!flags['no-build'];
      for (const f of st.output.formats) for (const s of flags.size ? [flags.size] : st.output.sizes) {
        res.push(await exportVideo(project, { ...o, format: f, size: s, fps: flags.fps ?? st.output.fps, noBuild: built }));
        built = true;
      }
      return res;
    }
    case 'qa': return (await loadQa()).run({ ...ctx, pos, flags });
    case 'layout':
      if (flags.tag && !flags['no-build']) await build(project, { quiet: true, tag: flags.tag, scene: flags.scene });
      return (await loadQa()).layout({ ...ctx, pos, flags });
    default: {
      if (!GROUPS[cmd]) throw new Error(`unknown command "${cmd}"\n\n${await usage()}`);
      const g = await GROUPS[cmd]();
      const [sub, ...rest] = pos;
      const fn = g.commands[sub];
      if (!fn) throw new Error(`unknown ${cmd} command "${sub ?? ''}"\n${g.USAGE}`);
      return fn({ ...ctx, pos: rest, flags });
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (!cmd || cmd === 'help' || flags.help) { console.log(await usage()); return; }
  const json = !!flags.json;
  const log = flags.quiet ? () => {} : json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const project = cmd === 'setup' ? null : findProject(flags.project);
  // engine version check: warn, never block (the user upgrades explicitly)
  if (project && existsSync(join(project, 'promo.json'))) {
    const e = readJson(join(project, 'promo.json')).engine;
    if (e && e !== ENGINE_VERSION && cmd !== 'upgrade') console.error(`warning: this video uses engine ${e}, these tools are ${ENGINE_VERSION} (run /promo-clip:upgrade to update)`);
  }
  try {
    const result = await run(cmd, pos, flags, { project, log, json });
    if (json) process.stdout.write(JSON.stringify(result ?? null, null, 1) + '\n');
  } catch (e) {
    if (json) process.stdout.write(JSON.stringify({ error: e.message, code: e.code ?? 1, ...(e.report ? { report: e.report } : {}), ...(e.result ? { result: e.result } : {}) }, null, 1) + '\n');
    console.error(`error: ${e.message}`);
    process.exit(typeof e.code === 'number' ? e.code : 1);
  }
}

main();
