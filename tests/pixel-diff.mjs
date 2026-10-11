#!/usr/bin/env node
// Pixel-diff checker for CI: compare rendered stills against reference stills.
// Usage:
//   node tests/pixel-diff.mjs <dir> <refdir> [--tol 8] [--out diffdir] [--project V]
//
// <dir>    - directory with newly rendered stills (.jpg or .png)
// <refdir> - reference stills directory (same file names)
// --tol    - per-channel max abs diff tolerance (default 8, matches GPU text-raster noise)
// --out    - directory to write red-highlight diff images for failures (optional)
// --project - video folder whose tools/ provides sharp (default: the nearest folder above <dir>
//             with promo.json, else engine/tools — a marketplace plugin install has no node_modules)
//
// Exit 0 = all within tolerance, Exit 1 = one or more pairs exceeded tolerance.
//
// Tolerance decision:
//   JPEG reference stills (quality 0.85) introduce ~3-5 levels of re-encoding noise.
//   GPU text rasterisation varies by ≤ 8/255 between runs.
//   Default tolerance 8/255 covers both. PNG references are also supported (0 re-encoding noise;
//   still allow 8/255 for GPU raster noise). Use --tol 0 only for known-identical renders.
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from '../engine/tools/lib/args.mjs';

// sharp: from the video's tools/ (--project, or the nearest promo.json folder above <dir>), else
// from engine/tools — whichever has it installed
function loadSharp(dir, project) {
  const roots = [];
  if (project) roots.push(resolve(project));
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, 'promo.json'))) { roots.push(d); break; }
    if (dirname(d) === d) break;
  }
  const pkgs = [...roots.map((r) => join(r, 'tools', 'package.json')), new URL('../engine/tools/package.json', import.meta.url)];
  for (const pkg of pkgs) {
    try { return createRequire(pkg)('sharp'); } catch { /* try the next */ }
  }
  throw new Error('sharp not found: pass --project <video folder> or run `npm install` in engine/tools');
}
let sharp;

async function main() {
  const [dir, refdir, ...rest] = process.argv.slice(2);
  if (!dir || !refdir) {
    console.error('usage: pixel-diff.mjs <dir> <refdir> [--tol 8] [--out diffdir]');
    process.exit(2);
  }
  const { flags } = parseArgs(rest);
  const tol = parseInt(flags.tol ?? '8', 10);
  const outDir = flags.out ?? null;
  sharp = loadSharp(dir, flags.project);

  if (outDir) mkdirSync(outDir, { recursive: true });

  // find image files in refdir
  const refFiles = readdirSync(refdir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  if (!refFiles.length) {
    console.error(`no reference images in ${refdir}`);
    process.exit(2);
  }

  let failed = 0;
  let passed = 0;
  let missing = 0;

  for (const fname of refFiles) {
    const refPath = join(refdir, fname);
    const testPath = join(dir, fname);

    if (!existsSync(testPath)) {
      console.log(`MISSING  ${fname}`);
      missing++;
      continue;
    }

    const result = await comparePair(refPath, testPath, tol, outDir ? join(outDir, fname) : null);
    if (result.ok) {
      console.log(`PASS     ${fname}  max=${result.maxDiff} @(${result.maxX},${result.maxY})  over=${result.overCount}`);
      passed++;
    } else {
      console.log(`FAIL     ${fname}  max=${result.maxDiff} @(${result.maxX},${result.maxY})  over=${result.overCount}  (tol=${tol})`);
      if (outDir && result.diffPath) console.log(`         diff -> ${result.diffPath}`);
      failed++;
    }
  }

  console.log(`\nresult: ${passed} passed, ${failed} failed, ${missing} missing  (tol=${tol}/255)`);
  if (failed > 0 || missing > 0) process.exit(1);
}

/**
 * Compare two image files pixel by pixel.
 * Returns { ok, maxDiff, maxX, maxY, overCount, diffPath }.
 * diffPath is set when outPath is given and the test failed.
 */
async function comparePair(refPath, testPath, tol, outPath) {
  // decode both images to raw RGBA
  const [refRaw, testRaw] = await Promise.all([
    sharp(refPath).raw().toBuffer({ resolveWithObject: true }),
    sharp(testPath).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const rInfo = refRaw.info;
  const tInfo = testRaw.info;

  // resize test to match ref if they differ (e.g. ref is JPEG 720p, test is too)
  let testBuf = testRaw.data;
  if (rInfo.width !== tInfo.width || rInfo.height !== tInfo.height) {
    const resized = await sharp(testPath)
      .resize(rInfo.width, rInfo.height, { fit: 'fill' })
      .raw()
      .toBuffer();
    testBuf = resized;
  }

  const refBuf = refRaw.data;
  const { width, height, channels } = rInfo;

  let maxDiff = 0;
  let maxX = 0, maxY = 0;
  let overCount = 0;

  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    let pixMax = 0;
    for (let c = 0; c < Math.min(channels, 3); c++) {
      const diff = Math.abs(refBuf[i * channels + c] - testBuf[i * channels + c]);
      if (diff > pixMax) pixMax = diff;
    }
    if (pixMax > maxDiff) { maxDiff = pixMax; maxX = x; maxY = y; }
    if (pixMax > tol) overCount++;
  }

  const ok = maxDiff <= tol;

  // write diff image (red pixels where diff > tol)
  let diffPath = null;
  if (!ok && outPath) {
    const diffBuf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      let pixMax = 0;
      for (let c = 0; c < Math.min(channels, 3); c++) {
        pixMax = Math.max(pixMax, Math.abs(refBuf[i * channels + c] - testBuf[i * channels + c]));
      }
      const over = pixMax > tol;
      // copy the reference pixel, but overlay red for exceeded diffs
      diffBuf[i * 4 + 0] = over ? 255 : refBuf[i * channels + 0];
      diffBuf[i * 4 + 1] = over ? 0 : refBuf[i * channels + 1];
      diffBuf[i * 4 + 2] = over ? 0 : refBuf[i * channels + 2];
      diffBuf[i * 4 + 3] = 255;
    }
    const diffExt = extname(outPath) || '.png';
    const diffFile = outPath.replace(/\.\w+$/, '_diff.png');
    await sharp(diffBuf, { raw: { width, height, channels: 4 } }).png().toFile(diffFile);
    diffPath = diffFile;
  }

  return { ok, maxDiff, maxX, maxY, overCount, diffPath };
}

main().catch((e) => { console.error(e); process.exit(2); });
