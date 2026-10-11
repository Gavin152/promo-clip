// art sub-commands: generate (AI image), process (key+die-cut), contact sheet, resolution check,
// manifest scan, QR code.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, extname, basename, dirname, sep } from 'node:path';
import { processImage, makeContactSheet, makeQrSvg, detectGroundLine } from './lib/art-pipeline.mjs';
import { paid, quote } from './lib/paid.mjs';
import { readJson } from './lib/paths.mjs';

// ── constants ─────────────────────────────────────────────────────────────────

// Models for image generation (keeps in sync with providers.json).
const IMAGE_NEED = 'images';

/**
 * House-style suffix appended to every generate prompt.
 * Subjects must be on a solid #FF00FF background so chroma-key can isolate them.
 */
const HOUSE_STYLE =
  ' Draw in a flat 2-D paper-collage illustration style: bold outlines, saturated colours, ' +
  'simple textures, no photorealism. Place the subject centred on a solid #FF00FF magenta ' +
  'background — the entire background must be exactly #FF00FF, no gradients, no shadows falling ' +
  'onto the background. Do not add a ground line, floor, shadow, or horizon under the subject.';

export const USAGE = `  art generate <name> "<prompt>" [--ref F …] [--hires=true] [--size 2K]
  art process <name|file> [--border N] [--max N] [--nokey] [--out key]
  art contact                            contact sheet → .work/contact_sheet.jpg
  art check [--max N]                    resolution check (default --max 900)
  art manifest                           scan assets/art + img into manifest.json
  art qr <url> [--name qr] [--dark #hex] [--light #hex]`;

export const commands = { generate, process: processCmd, contact, check, manifest, qr };

// ── helpers ───────────────────────────────────────────────────────────────────

function artRawDir(project) { return join(project, 'assets', 'art', 'raw'); }
function artDir(project) { return join(project, 'assets', 'art'); }
function imgDir(project) { return join(project, 'assets', 'img'); }
function workDir(project) { return join(project, '.work'); }
function manifestPath(project) { return join(project, 'manifest.json'); }

function readManifest(project) {
  const p = manifestPath(project);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

function writeManifest(project, data) {
  writeFileSync(manifestPath(project), JSON.stringify(data, null, 2) + '\n');
}

/** Parse image data-URL → Buffer. Returns null if not an image data-URL. */
/** asset names become file names and manifest keys: letters, digits, - and _ only */
export function safeName(n, what = 'name') {
  const v = String(n ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v)) throw new Error(`${what} "${v}" must be 1-64 letters, digits, - or _`);
  return v;
}
const REF_EXT = /\.(png|jpe?g|webp)$/i;
/** project-relative manifest path -> absolute path, refusing anything outside the project */
function inProject(project, rel) {
  const full = resolve(project, rel);
  if (full !== resolve(project) && !full.startsWith(resolve(project) + sep)) throw new Error(`path outside the project: ${rel}`);
  return full;
}

function dataUrlToBuffer(url) {
  if (!url || !url.startsWith('data:')) return null;
  const semi = url.indexOf(';');
  if (semi < 0) return null;
  const comma = url.indexOf(',', semi);
  if (comma < 0) return null;
  const enc = url.slice(semi + 1, comma);
  if (enc !== 'base64') return null;
  return Buffer.from(url.slice(comma + 1), 'base64');
}

/** Collect reference image buffers from --ref flag (comma-sep paths) and assets/ref/ folder. */
async function collectRefs(project, refFlag) {
  const refs = [];
  // from --ref flag (comma-separated)
  if (refFlag) {
    for (const p of [refFlag].flat().flatMap((r) => String(r).split(',')).map(s => s.trim()).filter(Boolean)) {
      const full = resolve(project, p);
      // refs are sent to the image API: only image files, so a typo can't upload e.g. a key file
      if (!REF_EXT.test(full)) throw new Error(`--ref must be a .png, .jpg or .webp image: ${p}`);
      if (!existsSync(full)) throw new Error(`--ref file not found: ${p}`);
      refs.push(full);
    }
  }
  // from assets/ref/ auto-load
  const refDir = join(project, 'assets', 'ref');
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir).sort()) {
      if (/\.(png|jpg|jpeg|webp)$/i.test(f)) refs.push(join(refDir, f));
    }
  }
  return refs;
}

// ── generate ──────────────────────────────────────────────────────────────────

async function generate({ project, pos, flags, log }) {
  const [rawName, prompt] = pos;
  if (!rawName || !prompt) throw new Error('usage: art generate <name> "<prompt>"');
  const name = safeName(rawName);

  const hires = flags.hires === 'true' || flags.hires === true || flags.size === '2K';
  const imageSize = hires ? '2K' : undefined;

  // build prompt: user text + house style
  const fullPrompt = prompt.trim() + HOUSE_STYLE;

  // collect reference images
  const refPaths = await collectRefs(project, flags.ref);

  // build content array for OpenRouter chat
  const content = [];
  for (const rp of refPaths) {
    const ext = extname(rp).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${readFileSync(rp).toString('base64')}` } });
  }
  content.push({ type: 'text', text: fullPrompt });

  const body = {
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: '16:9', ...(imageSize ? { image_size: imageSize } : {}) },
  };

  // show estimate
  const q = quote(project, IMAGE_NEED, { hires });
  log(`estimate: ~$${q.usd.toFixed(3)} (${q.model})`);

  // paid call with auto-retry once on empty image
  let imgUrl = null, result;
  for (let attempt = 0; attempt < 2; attempt++) {
    result = await paid({
      project, stage: 'art', need: IMAGE_NEED, what: `generate ${name}`, params: { hires },
      call: async (model, c) => c.chat({ model, ...body }),
      log,
    });
    imgUrl = result.reply?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
    if (imgUrl) break;
    if (attempt === 0) log('empty image response, retrying…');
  }

  if (!imgUrl) {
    const text = result?.reply?.choices?.[0]?.message?.content ?? '';
    throw Object.assign(new Error(`no image returned (${text.slice(0, 120)})`), { code: 1 });
  }

  // save PNG + JSON
  const rawDir = artRawDir(project);
  mkdirSync(rawDir, { recursive: true });
  const imgBuf = dataUrlToBuffer(imgUrl);
  if (!imgBuf) throw new Error('unexpected image URL format');

  writeFileSync(join(rawDir, `${name}.png`), imgBuf);
  writeFileSync(join(rawDir, `${name}.json`), JSON.stringify({
    name, prompt, fullPrompt, refs: refPaths.map(p => basename(p)),
    model: result.model, usd: result.usd, hires: !!hires,
    at: new Date().toISOString(),
  }, null, 2) + '\n');

  log(`saved assets/art/raw/${name}.png  cost $${result.usd.toFixed(3)}`);
  return { name, model: result.model, usd: result.usd };
}

// ── process ───────────────────────────────────────────────────────────────────

async function processCmd({ project, pos, flags, log }) {
  const [nameOrFile] = pos;
  if (!nameOrFile) throw new Error('usage: art process <name|file> [--border N] [--max N] [--nokey] [--out key]');

  // resolve source path: explicit file, or look in assets/art/raw/<name>.{png,jpg,webp}
  let srcPath, stemName;
  if (existsSync(resolve(project, nameOrFile))) {
    srcPath = resolve(project, nameOrFile);
    stemName = safeName(basename(nameOrFile).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_'), 'file name');
  } else {
    safeName(nameOrFile);
    const rawDir = artRawDir(project);
    const src = ['png', 'jpg', 'jpeg', 'webp']
      .map(e => join(rawDir, `${nameOrFile}.${e}`))
      .find(existsSync);
    if (!src) throw new Error(`raw image not found: ${nameOrFile} (looked in assets/art/raw/)`);
    srcPath = src;
    stemName = nameOrFile;
  }

  const border = flags.border != null ? Number(flags.border) : 14;
  const maxSide = flags.max != null ? Number(flags.max) : 900;
  const nokey = !!flags.nokey;
  const outKey = flags.out != null ? safeName(flags.out, '--out') : stemName;

  const destPath = join(artDir(project), `${stemName}.png`);

  log(`processing ${basename(srcPath)} → assets/art/${stemName}.png …`);
  const { width, height, groundLine } = await processImage(srcPath, destPath, { border, maxSide, nokey });

  if (groundLine) {
    log(`warning: probable stray ground line detected under "${stemName}" — check the raw image and erase any line below the subject before re-processing`);
  }

  // update manifest
  const mf = readManifest(project);
  mf[outKey] = `assets/art/${stemName}.png`;
  writeManifest(project, mf);

  log(`→ ${width}×${height}  manifest["${outKey}"] set`);
  return { name: stemName, key: outKey, width, height, groundLine };
}

// ── contact ───────────────────────────────────────────────────────────────────

async function contact({ project, log }) {
  const mf = readManifest(project);
  const entries = [];

  for (const [key, relPath] of Object.entries(mf)) {
    const fullPath = inProject(project, relPath);
    if (!existsSync(fullPath)) {
      log(`warning: manifest entry "${key}" → ${relPath} not found, skipping`);
      continue;
    }
    // skip non-raster (SVG etc.) for metadata, but still include in sheet
    let meta = null;
    if (/\.(png|jpg|jpeg|webp)$/i.test(relPath)) {
      try {
        const { default: sharp } = await import('sharp');
        meta = await sharp(fullPath).metadata().then(m => ({ width: m.width, height: m.height }));
      } catch { /* ignore */ }
    }
    entries.push({ key, path: relPath, fullPath, meta });
  }

  const outPath = join(workDir(project), 'contact_sheet.jpg');
  log(`building contact sheet (${entries.length} entries) → .work/contact_sheet.jpg …`);
  await makeContactSheet(entries, outPath);
  log('contact sheet ready');
  return { path: outPath, count: entries.length };
}

// ── check ─────────────────────────────────────────────────────────────────────

async function check({ project, flags, log }) {
  const maxFlag = Number(flags.max ?? 900);
  const state = readJson(join(project, 'promo.json'), {});
  const sizes = state?.output?.sizes ?? ['1080p'];
  const formats = state?.output?.formats ?? ['landscape'];

  // compute max output scale across all format × size combinations
  const { resolveSize } = await import('../js/formats.js');
  let maxScale = 0;
  let maxScaleLabel = '';
  for (const f of formats) {
    for (const s of sizes) {
      try {
        const r = resolveSize(f, s);
        if (r.scale > maxScale) { maxScale = r.scale; maxScaleLabel = `${f} ${s}`; }
      } catch { /* ignore unknown combo */ }
    }
  }
  if (maxScale === 0) maxScale = 1;

  const threshold = maxFlag * maxScale;
  const mf = readManifest(project);
  const { default: sharp } = await import('sharp');

  const results = [];
  let warnings = 0;
  for (const [key, relPath] of Object.entries(mf)) {
    if (!/\.(png|jpg|jpeg|webp)$/i.test(relPath)) {
      results.push({ key, relPath, skip: true, reason: 'vector' });
      continue;
    }
    const fullPath = inProject(project, relPath);
    if (!existsSync(fullPath)) {
      results.push({ key, relPath, skip: true, reason: 'missing' });
      continue;
    }
    const m = await sharp(fullPath).metadata();
    const longest = Math.max(m.width, m.height);
    const soft = longest < threshold - 0.5;
    if (soft) {
      warnings++;
      log(
        `soft  ${key}: ${m.width}×${m.height} (longest side ${longest}) — needs ${Math.ceil(threshold)} for ${maxScaleLabel} ` +
        `(rule: longest side ≥ ${maxFlag} × scale ${maxScale.toFixed(2)}). ` +
        `Re-process with --max ${Math.ceil(maxFlag * maxScale)} or regenerate at 2K.`
      );
    } else {
      log(`ok    ${key}: ${m.width}×${m.height}`);
    }
    results.push({ key, relPath, width: m.width, height: m.height, longest, threshold, soft });
  }

  log(`\n${warnings} soft asset(s) out of ${results.filter(r => !r.skip).length} rasters checked`);
  log(`rule: warn if longest side < ${maxFlag} × max output scale (${maxScale.toFixed(2)} for ${maxScaleLabel})`);
  return { warnings, threshold, maxScale, maxScaleLabel, results };
}

// ── manifest ──────────────────────────────────────────────────────────────────

async function manifest({ project, log }) {
  const ART_EXTS = /\.(png|jpg|jpeg|webp)$/i;
  const IMG_EXTS = /\.(png|jpg|jpeg|svg|webp)$/i;

  const mf = readManifest(project);
  const added = [], updated = [], collisions = [];

  function addEntry(key, relPath, force = false) {
    if (key in mf) {
      if (mf[key] !== relPath) {
        if (force) {
          updated.push({ key, old: mf[key], new: relPath });
          mf[key] = relPath;
        } else {
          collisions.push({ key, existing: mf[key], candidate: relPath });
        }
      }
    } else {
      mf[key] = relPath;
      added.push(key);
    }
  }

  // scan assets/art/
  const ad = artDir(project);
  if (existsSync(ad)) {
    for (const f of readdirSync(ad).sort()) {
      if (ART_EXTS.test(f)) addEntry(basename(f, extname(f)), `assets/art/${f}`);
    }
  }

  // scan assets/img/
  const id = imgDir(project);
  if (existsSync(id)) {
    for (const f of readdirSync(id).sort()) {
      if (IMG_EXTS.test(f)) addEntry(basename(f, extname(f)), `assets/img/${f}`);
    }
  }

  writeManifest(project, mf);

  if (added.length) log(`added: ${added.join(', ')}`);
  if (updated.length) log(`updated: ${updated.map(c => `${c.key} (${c.old} → ${c.new})`).join(', ')}`);
  if (collisions.length) {
    for (const c of collisions) log(`collision: key "${c.key}" already maps to ${c.existing}; ignoring ${c.candidate}`);
  }
  if (!added.length && !updated.length && !collisions.length) log('manifest up to date');

  return { added, updated, collisions };
}

// ── qr ────────────────────────────────────────────────────────────────────────

async function qr({ project, pos, flags, log }) {
  const [url] = pos;
  if (!url) throw new Error('usage: art qr <url> [--name qr]');

  const name = safeName(flags.name ?? 'qr', '--name');
  const dark = flags.dark ?? '#000000';
  const light = flags.light ?? '#ffffff';

  const svg = await makeQrSvg(url, { dark, light });
  const imgd = imgDir(project);
  mkdirSync(imgd, { recursive: true });

  const outPath = join(imgd, `${name}.svg`);
  writeFileSync(outPath, svg);

  const mf = readManifest(project);
  mf[name] = `assets/img/${name}.svg`;
  writeManifest(project, mf);

  log(`saved assets/img/${name}.svg  manifest["${name}"] set`);
  return { name, url, path: outPath };
}
