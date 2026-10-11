// QA suite: probe exports, check loudness, decode QR, check layout.
// Called by cli.mjs as `qa.run({ project, pos, flags, log, json })`.
// Exit code 2 on issues (QaFail).
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadState } from './lib/state.mjs';
import { readJson, projectName } from './lib/paths.mjs';
import { loudness } from './lib/audio.mjs';
import { openPlayer, frameJpeg, frameBoxes } from './lib/page.mjs';
import { probeFile, streamDuration } from './lib/qa-probe.mjs';
import { checkLayout } from './lib/layout-check.mjs';
import { QaFail } from './lib/errors.mjs';
import { buildPaths } from './build-assets.mjs';
import { sizeLabel } from '../js/formats.js';
import sharp from 'sharp';

// jsqr is a CommonJS module; load it via createRequire
const require = createRequire(import.meta.url);
const jsQR = require('jsqr');

// ---- tolerances (documented) ----
// Loudness: target -14 LUFS ± 1 LUFS, true peak ≤ -1.0 + 0.2 = -0.8 dBTP
const LUFS_TARGET = -14;
const LUFS_TOL = 1; // ± 1 LUFS
const TP_LIMIT = -0.8; // -1.0 dBTP with +0.2 tolerance

// Audio / video duration delta: ≤ 0.1 s
const AV_DELTA_LIMIT = 0.1;

// FPS tolerance: ± 0.5 (handles 30.0 vs 29.97)
const FPS_TOL = 0.5;

// ---- helpers ----

/**
 * Decode a QR code from a JPEG buffer via jsqr + sharp (density 300, white quiet zone).
 * Returns the decoded string, or null if nothing found.
 */
async function decodeQr(jpegBuf) {
  // jsQR requires RGBA (4 channels); ensureAlpha() pads RGB → RGBA if needed
  const { data, info } = await sharp(jpegBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height)?.data ?? null;
}

/**
 * Probe an output file and accumulate issues/checks.
 * Returns { issues, checks }.
 */
async function probeOutput(file, { format, size, expectedFps, log }) {
  const issues = [];
  const checks = [];

  const { containerDuration, videoW, videoH, fps, hasAudio } = probeFile(file);
  log(`  probe: ${videoW}x${videoH} @${fps}fps, duration=${containerDuration?.toFixed(3)}s`);

  // resolution
  if (videoW !== null && videoH !== null) {
    checks.push({ check: 'resolution', value: `${videoW}x${videoH}`, ok: true });
  } else {
    issues.push({ severity: 'error', check: 'resolution', msg: `could not read resolution from ${file}` });
  }

  // fps
  if (fps !== null && expectedFps !== null) {
    const ok = Math.abs(fps - expectedFps) <= FPS_TOL;
    checks.push({ check: 'fps', value: fps, expected: expectedFps, ok });
    if (!ok) issues.push({ severity: 'error', check: 'fps', msg: `fps ${fps} != expected ${expectedFps} (±${FPS_TOL})` });
  }

  // audio / video stream duration delta
  if (hasAudio && containerDuration !== null) {
    const vDur = streamDuration(file, '0:v:0');
    const aDur = streamDuration(file, '0:a:0');
    if (vDur !== null && aDur !== null) {
      const delta = Math.abs(vDur - aDur);
      const ok = delta <= AV_DELTA_LIMIT;
      checks.push({ check: 'av_delta', value: delta.toFixed(3), ok });
      if (!ok) {
        issues.push({ severity: 'error', check: 'av_delta', msg: `audio (${aDur.toFixed(3)}s) vs video (${vDur.toFixed(3)}s) duration delta ${delta.toFixed(3)}s > ${AV_DELTA_LIMIT}s` });
      }
    }
  } else if (!hasAudio) {
    issues.push({ severity: 'error', check: 'audio', msg: `no audio stream in ${file}` });
  }

  return { issues, checks };
}

/** Check loudness of an MP4 file. Returns { issues, checks }. */
function checkLoudness(file, log) {
  const issues = [];
  const checks = [];
  const { lufs, truePeak, lra } = loudness(file);
  log(`  loudness: ${lufs} LUFS, true peak ${truePeak} dBFS, LRA ${lra} LU`);

  const lufsOk = Math.abs(lufs - LUFS_TARGET) <= LUFS_TOL;
  checks.push({ check: 'lufs', value: lufs, target: LUFS_TARGET, tolerance: LUFS_TOL, ok: lufsOk });
  if (!lufsOk) {
    issues.push({ severity: 'error', check: 'lufs', msg: `integrated loudness ${lufs} LUFS, expected ${LUFS_TARGET} ±${LUFS_TOL} LUFS` });
  }

  const tpOk = truePeak <= TP_LIMIT;
  checks.push({ check: 'true_peak', value: truePeak, limit: TP_LIMIT, ok: tpOk });
  if (!tpOk) {
    issues.push({ severity: 'error', check: 'true_peak', msg: `true peak ${truePeak} dBFS > ${TP_LIMIT} dBFS` });
  }

  return { issues, checks };
}

/**
 * Check QR code in the rendered end-card scene.
 * Renders the last scene at (scene.end - 0.5 s), decodes the QR, compares to theme.endCard.qrUrl.
 * Returns { issues, checks }.
 */
async function checkQr(page, info, theme, log) {
  const issues = [];
  const checks = [];
  const qrUrl = theme?.endCard?.qrUrl;

  if (!qrUrl) {
    checks.push({ check: 'qr', skipped: true, reason: 'theme has no endCard.qrUrl' });
    log('  QR: skipped (no endCard.qrUrl in theme.json)');
    return { issues, checks };
  }

  // use the last scene's end-card time: end - 0.5 s (past all entrances)
  const lastScene = info.scenes[info.scenes.length - 1];
  const t = Math.max(lastScene.start, lastScene.end - 0.5);

  // capture JPEG and decode
  const jpegBuf = await frameJpeg(page, t);
  const decoded = await decodeQr(jpegBuf);

  const ok = decoded === qrUrl;
  checks.push({ check: 'qr', value: decoded, expected: qrUrl, ok });
  if (!ok) {
    if (decoded === null) {
      issues.push({ severity: 'error', check: 'qr', msg: `QR not found in end-card frame at t=${t.toFixed(2)}s` });
    } else {
      issues.push({ severity: 'error', check: 'qr', msg: `QR decoded "${decoded}" but expected "${qrUrl}"` });
    }
  } else {
    log(`  QR: ${decoded} ✓`);
  }

  return { issues, checks };
}

/**
 * Run layout check for all scenes (at end - 0.5 s) using __frameBoxes.
 * Returns { issues, checks }.
 */
export async function checkLayouts(page, info, format, log) {
  const issues = [];
  const checks = [];

  for (const sc of info.scenes) {
    const t = Math.max(sc.start, sc.end - 0.5);
    const boxes = await frameBoxes(page, t);
    const { warnings, errors } = checkLayout(boxes, format);

    log(`  layout ${sc.id} t=${t.toFixed(2)}s: ${boxes.length} boxes, ${warnings.length} overlaps, ${errors.length} errors`);

    for (const w of warnings) {
      checks.push({ check: 'layout', scene: sc.id, ...w });
    }
    for (const e of errors) {
      issues.push({ severity: 'error', check: 'layout', scene: sc.id, ...e });
    }
  }

  return { issues, checks };
}

/**
 * Check one format+size output file.
 * Opens the player once for QR + layout checks (reuses the same browser).
 */
async function checkOutput(project, state, theme, format, size, log) {
  const name = projectName(project);
  const tag = `${format}_${sizeLabel(size)}`;
  const webFile = join(project, 'out', `${name}_${tag}_web.mp4`);
  const masterFile = join(project, 'out', `${name}_${tag}.mp4`);

  // prefer web file (smaller), fall back to master
  const file = existsSync(webFile) ? webFile : existsSync(masterFile) ? masterFile : null;

  if (!file) {
    return {
      format,
      size,
      skipped: true,
      issues: [{ severity: 'warning', check: 'file', msg: `output file not found: ${webFile} or ${masterFile}` }],
      checks: [],
    };
  }

  log(`checking ${format} ${size}: ${file}`);

  const allIssues = [];
  const allChecks = [];

  // 1. probe
  const { issues: pi, checks: pc } = await probeOutput(file, { format, size, expectedFps: state.output.fps ?? 30, log });
  allIssues.push(...pi); allChecks.push(...pc);

  // 2. loudness
  const { issues: li, checks: lc } = checkLoudness(file, log);
  allIssues.push(...li); allChecks.push(...lc);

  // 3. open player for QR + layout
  let playerResult;
  try {
    const { page, info, close } = await openPlayer(project, { format, size });
    try {
      // 3a. QR
      const { issues: qi, checks: qc } = await checkQr(page, info, theme, log);
      allIssues.push(...qi); allChecks.push(...qc);

      // 3b. layout
      const { issues: layi, checks: layc } = await checkLayouts(page, info, format, log);
      allIssues.push(...layi); allChecks.push(...layc);

      playerResult = { duration: info.duration, size: info.size };
    } finally {
      await close();
    }
  } catch (e) {
    allIssues.push({ severity: 'error', check: 'player', msg: `could not open player: ${e.message}` });
  }

  return { format, size, file, skipped: false, issues: allIssues, checks: allChecks, ...playerResult };
}

/** Write qa_report.json and qa_report.md to project/out/ */
async function writeReports(project, report) {
  mkdirSync(join(project, 'out'), { recursive: true });
  await writeFile(join(project, 'out', 'qa_report.json'), JSON.stringify(report, null, 2) + '\n');

  const errorCount = report.results.reduce((n, r) => n + r.issues.filter(i => i.severity === 'error').length, 0);
  const warnCount = report.results.reduce((n, r) => n + r.issues.filter(i => i.severity === 'warning').length, 0);
  const lines = [
    '# QA Report',
    '',
    `**Status:** ${report.passed ? 'PASSED' : 'FAILED'} — ${errorCount} error(s), ${warnCount} warning(s)`,
    '',
  ];
  for (const r of report.results) {
    if (r.skipped) {
      lines.push(`## ${r.format} ${r.size} — SKIPPED`);
      lines.push('');
      for (const i of r.issues) lines.push(`- ⚠ ${i.msg}`);
      lines.push('');
      continue;
    }
    const rErrors = r.issues.filter(i => i.severity === 'error');
    const rWarns = r.issues.filter(i => i.severity === 'warning');
    lines.push(`## ${r.format} ${r.size} — ${rErrors.length === 0 ? 'OK' : 'FAIL'}`);
    lines.push('');
    lines.push(`**File:** \`${r.file}\``);
    if (r.duration != null) lines.push(`**Duration:** ${r.duration.toFixed(2)} s`);
    lines.push('');
    if (rErrors.length) {
      lines.push('### Errors');
      for (const i of rErrors) lines.push(`- ❌ [${i.check}] ${i.msg}`);
      lines.push('');
    }
    if (rWarns.length) {
      lines.push('### Warnings');
      for (const i of rWarns) lines.push(`- ⚠ [${i.check}] ${i.msg}`);
      lines.push('');
    }
    lines.push('### Checks');
    for (const c of r.checks) {
      if (c.skipped) { lines.push(`- ⊘ [${c.check}] skipped: ${c.reason}`); continue; }
      if (c.severity === 'warning') continue; // already in warnings section
      const ok = c.ok !== undefined;
      lines.push(`- ${ok ? (c.ok ? '✓' : '✗') : '·'} [${c.check}] ${JSON.stringify(c)}`);
    }
    lines.push('');
  }
  await writeFile(join(project, 'out', 'qa_report.md'), lines.join('\n'));
}

/** Main entry point: called by cli.mjs `qa` command. */
export async function run({ project, flags = {}, log = console.log } = {}) {
  const state = loadState(project);
  const theme = readJson(join(project, 'theme.json'), {});

  const formats = flags.format ? [flags.format] : state.output.formats;
  const sizes = flags.size ? [flags.size] : state.output.sizes;

  log(`QA: checking ${formats.length * sizes.length} output(s)…`);

  const results = [];
  for (const fmt of formats) {
    for (const sz of sizes) {
      const r = await checkOutput(project, state, theme, fmt, sz, log);
      results.push(r);
    }
  }

  const errorCount = results.reduce((n, r) => n + r.issues.filter(i => i.severity === 'error').length, 0);
  const report = { passed: errorCount === 0, errorCount, results };

  await writeReports(project, report);

  if (!report.passed) {
    throw new QaFail(`QA failed: ${errorCount} error(s)`, report);
  }

  log(`QA passed. Reports in ${join(project, 'out')}`);
  return report;
}

/**
 * layout [--format F] [--tag T --scene S]: overlap / clipping / safe-zone check on every scene's final state, without
 * exporting (the scenes and formats stages run it after writing layouts). Exit 2 on errors.
 */
export async function layout({ project, flags = {}, log = console.log } = {}) {
  const state = loadState(project);
  const formats = flags.format ? [flags.format] : state.output?.formats ?? ['landscape'];
  const out = [];
  for (const format of formats) {
    const { page, info, close } = await openPlayer(project, { format, size: '720p', bundle: flags.tag ? buildPaths(project, flags.tag).bundle : null });
    try {
      log(`${format}:`);
      const shown = flags.scene ? { ...info, scenes: info.scenes.filter((x) => x.id === flags.scene) } : info;
      const r = await checkLayouts(page, shown, format, log);
      for (const c of r.checks) log(`  warning ${c.scene}: ${c.msg ?? c.kind}`);
      for (const i of r.issues) log(`  ERROR ${i.scene}: ${i.msg ?? i.kind}`);
      out.push({ format, ...r });
    } finally {
      await close();
    }
  }
  const errors = out.reduce((n, r) => n + r.issues.length, 0);
  if (errors) throw new QaFail(`layout check: ${errors} error(s)`, out);
  return out;
}
