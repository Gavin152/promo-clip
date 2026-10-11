// Proof stills: JPEG frames at given film times, or one per scene (its final state, just before the cut).
//   stills(project, outDir, { times: [2, 8], format, size })      -> f_00002.00.jpg …
//   stills(project, outDir, { scenes: true, format, size })       -> <scene-id>.jpg …
//   sheet: true also writes <outDir>/sheet.jpg, all stills in one labelled image
//   tag / scene: render a writer's private build (build --tag) / only that scene's still
// A scene's still is taken HOLD seconds before its end: after its last entrance, before the cut's
// swipe (±0.32 s) or the closing fade (0.45 s) covers it.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPlayer, frameJpeg, framePng } from './lib/page.mjs';
import { makeContactSheet } from './lib/art-pipeline.mjs';
import { buildPaths } from './build-assets.mjs';

export const HOLD = 0.5;
/** sheet thumbnail box with the frame's aspect: 560 wide (landscape/square) or 560 tall (vertical) */
const sheetThumb = ([w, h]) => (w >= h ? [560, Math.round((560 * h) / w)] : [Math.round((560 * w) / h), 560]);
/** time label used in still file names: 2 -> '00002.00' */
export const tLabel = (t) => t.toFixed(2).padStart(8, '0');

export async function stills(project, outDir, { times = [], scenes = false, format = 'landscape', size = '1080p', quality = 0.85, quiet = false, png = false, sheet = false, tag = null, scene = null } = {}) {
  await mkdir(outDir, { recursive: true });
  const usePng = png === true || png === 'true';
  const { page, info, close } = await openPlayer(project, { format, size, bundle: tag ? buildPaths(project, tag).bundle : null });
  const ext = usePng ? '.png' : '.jpg';
  const jobs = times.map((t) => ({ t: Number(t), file: `f_${tLabel(Number(t))}${ext}` }));
  if (scenes) for (const s of info.scenes.filter((x) => !scene || x.id === scene)) jobs.push({ t: Math.max((s.start + s.end) / 2, s.end - HOLD), file: `${s.id}${ext}` });
  const written = [];
  try {
    for (const j of jobs) {
      const t0 = Date.now();
      const file = join(outDir, j.file);
      await writeFile(file, usePng ? await framePng(page, j.t) : await frameJpeg(page, j.t, quality));
      written.push({ t: j.t, file });
      if (!quiet) console.log(`still t=${j.t.toFixed(2)} -> ${file} (${Date.now() - t0} ms)`);
    }
  } finally {
    await close();
  }
  // one image with every still, labelled (what a gate shows)
  let sheetPath = null;
  if (sheet && written.length) {
    sheetPath = join(outDir, 'sheet.jpg');
    const label = (w) => jobs.find((j) => join(outDir, j.file) === w.file).file.replace(/\.(jpg|png)$/, '');
    await makeContactSheet(written.map((w) => ({ key: label(w), path: w.file, fullPath: w.file, meta: null })), sheetPath, { cols: Math.min(info.size[0] >= info.size[1] ? 3 : 4, written.length), thumb: sheetThumb(info.size) });
    if (!quiet) console.log(`sheet -> ${sheetPath}`);
  }
  return { info, written, sheet: sheetPath };
}
