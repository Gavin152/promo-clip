#!/usr/bin/env node
// promo-clip engine CLI. Run inside a video folder (or pass --project <dir>).
//   cli.mjs build
//   cli.mjs stills <out_dir> [t1 t2 …] [--scenes] [--format F] [--size S]
//   cli.mjs export [--format F] [--size S] [--fps N] [--web-only] [--audio-only] [--stems] [--out file] [--no-build]
// Formats: landscape | vertical | square. Sizes: 720p | 1080p | 1440p | 4K | WxH.
import { findProject, ENGINE_VERSION } from './lib/paths.mjs';
import { build } from './build-assets.mjs';
import { stills } from './stills.mjs';
import { exportVideo } from './export.mjs';

/** tiny argv parser: positionals + --flag [value]; BOOL flags never take a value */
const BOOL = new Set(['scenes', 'web-only', 'audio-only', 'stems', 'no-build', 'quiet', 'help']);
export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (BOOL.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

const USAGE = `promo-clip engine ${ENGINE_VERSION}
usage: cli.mjs <command> [args] [--project dir]
  build                                   bundle the player (promo.bundle.js)
  stills <dir> [t …] [--scenes]           proof frames (--format, --size)
  export                                  MP4 master + web (--format, --size, --fps, --web-only, --audio-only, --stems, --out, --no-build)`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (!cmd || cmd === 'help' || flags.help) { console.log(USAGE); return; }
  const project = findProject(flags.project);
  const format = flags.format ?? 'landscape';
  const size = flags.size ?? '1080p';
  switch (cmd) {
    case 'build':
      await build(project, { quiet: flags.quiet });
      break;
    case 'stills': {
      const [out, ...times] = pos;
      if (!out || (!times.length && !flags.scenes)) throw new Error('usage: stills <dir> <t…> | --scenes');
      if (!flags['no-build']) await build(project, { quiet: true });
      await stills(project, out, { times: times.map(Number), scenes: !!flags.scenes, format, size, quiet: flags.quiet });
      break;
    }
    case 'export':
      await exportVideo(project, { format, size, fps: flags.fps ?? 30, webOnly: !!flags['web-only'], audioOnly: !!flags['audio-only'], stems: !!flags.stems, out: flags.out, noBuild: !!flags['no-build'], quiet: flags.quiet });
      break;
    default:
      throw new Error(`unknown command "${cmd}"\n${USAGE}`);
  }
}

main().catch((e) => {
  console.error('error:', e.message);
  process.exit(1);
});
