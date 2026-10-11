// Builds a video's player bundle: <project>/promo.bundle.js (classic IIFE, so index.html also works
// from file://). Embeds the fonts, the voice-over and the soundtrack as base64 and lists the scenes.
// Import aliases resolved here:
//   @engine/<p>   -> <engine>/js/<p>          (engine modules, used by scenes and timeline.js)
//   @project/<p>  -> <project>/<p>            (theme.json, manifest.json, timeline.js, vo/, assets/)
//   @scenes       -> .work/build/scenes.js    (generated: every scenes/*.js in file-name order)
//   @build/<p>    -> .work/build/<p>          (generated media data)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import * as esbuild from 'esbuild';
import { ENGINE, readJson } from './lib/paths.mjs';

const ENGINE_FONTS = [
  ['Orbitron', 'orbitron.woff2', '400 900'],
  ['Inter', 'inter.woff2', '100 900'],
  ['Caveat', 'caveat.woff2', '400 700'],
  ['Permanent Marker', 'permanent-marker.woff2', '400'],
];
const FONT_MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };

/** files a buildable project needs; returns the list of missing ones (project-relative) */
export function missingInputs(project, { audioOnly = false } = {}) {
  const need = ['theme.json', 'manifest.json', 'vo/timing.json', 'assets/music/cues.json', 'assets/vo/vo.wav'];
  if (!audioOnly) need.push('timeline.js');
  const miss = need.filter((p) => !existsSync(join(project, p)));
  if (!musicTrack(project)) miss.push('assets/music/track.(wav|mp3|m4a|ogg)');
  if (!audioOnly && !sceneFiles(project).length) miss.push('scenes/*.js');
  return miss;
}
export function musicTrack(project) {
  return ['wav', 'mp3', 'm4a', 'ogg'].map((e) => `assets/music/track.${e}`).find((p) => existsSync(join(project, p)));
}
export function sceneFiles(project) {
  const dir = join(project, 'scenes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.m?js$/.test(f) && !f.startsWith('_')).sort();
}

function fontsCss(project) {
  const b64 = (p) => readFileSync(p).toString('base64');
  const faces = ENGINE_FONTS.map(([fam, file, w]) => [fam, join(ENGINE, 'assets/fonts', file), w]);
  // extra project fonts: theme.json "fontFiles": [{ "family": "Brand Sans", "file": "assets/fonts/brand.woff2", "weight": "400 700" }]
  const theme = readJson(join(project, 'theme.json'), {});
  for (const f of theme.fontFiles ?? []) faces.push([f.family, join(project, f.file), f.weight ?? '400']);
  return faces
    .map(([fam, file, w]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:block;src:url(data:${FONT_MIME[extname(file)] ?? 'font/woff2'};base64,${b64(file)});}`)
    .join('\n');
}

// before the scenes stage there is no timeline.js yet: audio-only builds (music mix/check) use this stub
const STUB_TIMELINE = '// generated: no timeline.js yet (audio-only build)\nexport default {};\nexport const TRANSITIONS = [];\n';

const aliasPlugin = (project, buildDir) => ({
  name: 'promo-aliases',
  setup(b) {
    const map = (p) => {
      if (p === '@scenes') return join(buildDir, 'scenes.js');
      if (p.startsWith('@engine/')) return join(ENGINE, 'js', p.slice(8));
      if (p === '@project/timeline.js' && !existsSync(join(project, 'timeline.js'))) return join(buildDir, 'timeline.stub.js');
      if (p.startsWith('@project/')) return join(project, p.slice(9));
      if (p.startsWith('@build/')) return join(buildDir, p.slice(7));
      return null;
    };
    b.onResolve({ filter: /^@(engine|project|build)\/|^@scenes$/ }, (args) => {
      const path = map(args.path);
      if (!existsSync(path)) return { errors: [{ text: `${args.path} -> ${path} does not exist` }] };
      return { path };
    });
  },
});

/** builds <project>/promo.bundle.js; returns { bundle, bytes, scenes } */
/** where a build writes: the shared one, or a writer's own (tag) so parallel scene writers never collide */
export function buildPaths(project, tag) {
  if (tag != null && !/^[A-Za-z0-9_-]{1,64}$/.test(String(tag))) throw new Error(`--tag "${tag}" must be letters, digits, - or _`);
  const buildDir = join(project, tag ? `.work/build-${tag}` : '.work/build');
  return { buildDir, bundle: tag ? join(buildDir, 'promo.bundle.js') : join(project, 'promo.bundle.js') };
}

/**
 * audioOnly: allowed before timeline.js and scenes exist (the music stage renders stems).
 * tag: a private build (.work/build-<tag>/promo.bundle.js) for one parallel writer; other writers'
 * scenes that fail to compile are left out of it (reported in `skipped`) instead of failing the build —
 * except `scene`, the writer's own scene, which must compile.
 */
export async function build(project, { quiet = false, audioOnly = false, tag = null, scene = null } = {}) {
  project = resolve(project);
  const miss = missingInputs(project, { audioOnly });
  if (miss.length) throw new Error(`cannot build ${project}: missing ${miss.join(', ')}`);
  const { buildDir, bundle } = buildPaths(project, tag);
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'timeline.stub.js'), STUB_TIMELINE);

  const b64 = (p) => readFileSync(join(project, p)).toString('base64');
  const track = musicTrack(project);
  const media = `// generated by tools/build-assets.mjs — do not edit
export const FONTS_CSS = ${JSON.stringify(fontsCss(project))};
export const VO_B64 = '${b64('assets/vo/vo.wav')}';
export const MUSIC_FILE = '${track}';
export const MUSIC_B64 = '${b64(track)}';
`;
  writeFileSync(join(buildDir, 'media-data.js'), media);

  let scenes = sceneFiles(project);
  if (scene && !scenes.some((f) => f.replace(/\.m?js$/, '') === scene)) throw new Error(`no scenes/${scene}.js`);
  const skipped = [];
  const stubs = {};
  for (;;) {
    writeScenesIndex(project, buildDir, scenes, stubs);
    try {
      await esbuild.build({
        entryPoints: [join(ENGINE, 'js/main.js')],
        bundle: true,
        format: 'iife',
        target: ['chrome110', 'safari16', 'firefox115'],
        loader: { '.json': 'json' },
        outfile: bundle,
        plugins: [aliasPlugin(project, buildDir)],
        logLevel: 'silent',
      });
      break;
    } catch (e) {
      // in a tagged build, drop foreign scenes that break the bundle and try again
      const bad = new Set((e.errors ?? []).map((x) => x.location?.file).filter(Boolean).map((f) => basename(f)).filter((f) => scenes.includes(f)));
      const own = scene ? `${scene}.js` : null;
      const drop = tag ? [...bad].filter((f) => f !== own) : [];
      if (!drop.length) throw new Error(`build failed:\n${(e.errors ?? []).map((x) => `${x.location ? `${x.location.file}:${x.location.line}: ` : ''}${x.text}`).join('\n') || e.message}`);
      scenes = scenes.filter((f) => !drop.includes(f));
      skipped.push(...drop);
      // a dropped scene stays as a blank stub with its start (parsed from the file), so its neighbours keep their end times
      for (const f of drop) stubs[f] = /start:\s*\(?\s*T\s*\)?\s*=>\s*(T(?:\.[\w$]+|\[['"][^'"]+['"]\]))/.exec(readFileSync(join(project, 'scenes', f), 'utf8'))?.[1] ?? null;
    }
  }
  const bytes = readFileSync(bundle).length;
  const placeholders = scenes.filter((f) => /draw\s*\(\s*\)\s*\{\s*\}/.test(readFileSync(join(project, 'scenes', f), 'utf8')));
  if (placeholders.length && !quiet) console.warn(`warning: still empty placeholders (draw() {}): ${placeholders.join(', ')}`);
  if (!quiet) console.log(`built ${bundle} (${scenes.length} scenes, ${(bytes / 1e6).toFixed(1)} MB)${skipped.length ? `; left out (did not compile): ${skipped.join(', ')}` : ''}`);
  return { bundle, bytes, scenes, skipped, placeholders };
}

function writeScenesIndex(project, buildDir, scenes, stubs = {}) {
  const imports = scenes.map((f, i) => `import s${i} from ${JSON.stringify(join(project, 'scenes', f))};`).join('\n');
  const ids = scenes.map((f, i) => `withId(s${i}, ${JSON.stringify(f.replace(/\.m?js$/, ''))})`);
  for (const [f, start] of Object.entries(stubs)) if (start) ids.push(`{ id: ${JSON.stringify(f.replace(/\.m?js$/, ''))}, start: (T) => ${start}, draw() {} }`);
  writeFileSync(join(buildDir, 'scenes.js'), `// generated by tools/build-assets.mjs — do not edit\n${imports}\nconst withId = (m, id) => ({ id, ...m });\nexport default [${ids.join(', ')}];\n`);
}
