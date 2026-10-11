// Art image pipeline: chroma key + despill, autocrop, die-cut white border, downscale.
// Also: contact-sheet generation via sharp + SVG labels.
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── chroma key ───────────────────────────────────────────────────────────────

/** Key out #FF00FF, de-spill, return { data, width, height } in raw RGBA. */
function keyMagenta(data, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const m = Math.min(r, b) - g; // magenta-ness: positive = magenta influence
    let a = Math.min(1, Math.max(0, (190 - m) / 110));
    let R = r, G = g, B = b;
    if (a > 0 && a < 1) {
      // de-spill: un-mix the magenta colour cast from semi-transparent edges
      R = (r - (1 - a) * 255) / a;
      G = g / a;
      B = (b - (1 - a) * 255) / a;
    } else if (a === 1 && m > 20) {
      // de-spill fully-opaque edge pixels (subtle magenta halo)
      const k = m - 20;
      R = r - k;
      B = b - k;
    }
    out[i * 4] = Math.max(0, Math.min(255, R));
    out[i * 4 + 1] = Math.max(0, Math.min(255, G));
    out[i * 4 + 2] = Math.max(0, Math.min(255, B));
    out[i * 4 + 3] = Math.round(a * 255);
  }
  // remove stray specks (alpha < 10 %)
  for (let i = 0; i < width * height; i++) if (out[i * 4 + 3] < 26) out[i * 4 + 3] = 0;
  return out;
}

/** Bounding box of opaque (alpha > 25) pixels; returns { x0, y0, x1, y1 } or null. */
function bbox(data, width, height) {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 25) {
      const x = i % width, y = (i / width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * Detect a probable stray ground line under the subject.
 * Checks the bottom 3 rows of the bounding box using the FULL IMAGE width as the denominator.
 * A ground line typically spans most of the original image width (e.g. the full horizon under
 * a hull), so coverage relative to the full width is more reliable than coverage relative to the
 * subject bounding box (which would false-positive on wide rectangular subjects).
 * Warns if any of the 3 bottom rows has > 70 % of the full image width covered by opaque pixels.
 */
export function detectGroundLine(data, width, height, box) {
  if (!box) return false;
  const { y1 } = box;
  for (let row = Math.max(0, y1 - 2); row <= y1; row++) {
    let opaque = 0;
    for (let x = 0; x < width; x++) {
      if (data[(row * width + x) * 4 + 3] > 25) opaque++;
    }
    if (opaque / width > 0.70) return true;
  }
  return false;
}

// ── die-cut border ───────────────────────────────────────────────────────────

/** Dilate alpha by blurring the alpha channel and hard-thresholding, then fill white beneath. */
async function dieCut(buf, border) {
  const meta = await sharp(buf).metadata();
  const { width, height } = meta;
  const blurred = await sharp(buf).extractChannel(3).blur(border / 2).raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4, 255); // all white
  for (let i = 0; i < width * height; i++) {
    const v = blurred[i];
    // hard die-cut edge with 1 px anti-aliasing
    rgba[i * 4 + 3] = v > 14 ? 255 : v > 4 ? Math.round(((v - 4) / 10) * 255) : 0;
  }
  const white = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return sharp(white).composite([{ input: buf }]).png().toBuffer();
}

// ── main pipeline ─────────────────────────────────────────────────────────────

/**
 * Process a raw image into a collage sticker.
 *   nokey  — skip chroma key (photos/screenshots); just resize
 *   jpeg   — write JPEG (opaque backdrops / photos)
 *   border — die-cut border radius in px (0 = no border)
 *   maxSide — longest output side in px
 * Returns { width, height, groundLine }.
 */
export async function processImage(srcPath, destPath, { border = 14, maxSide = 900, nokey = false, jpeg = false } = {}) {
  mkdirSync(dirname(destPath), { recursive: true });

  if (nokey) {
    const img = sharp(srcPath).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
    const info = await (jpeg ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }) : img.png({ compressionLevel: 9 })).toFile(destPath);
    return { width: info.width, height: info.height, groundLine: false };
  }

  // load RGBA
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  // key + despill
  const keyed = keyMagenta(data, W, H);

  // bounding box
  const box = bbox(keyed, W, H);
  const groundLine = detectGroundLine(keyed, W, H, box);

  // autocrop with padding
  const pad = border + 6;
  let buf;
  if (box) {
    const cw = box.x1 - box.x0 + 1, ch = box.y1 - box.y0 + 1;
    buf = await sharp(keyed, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: box.x0, top: box.y0, width: cw, height: ch })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
  } else {
    buf = await sharp(keyed, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  }

  // die-cut white border
  if (border > 0) buf = await dieCut(buf, border);

  // downscale
  const finalInfo = await sharp(buf)
    .resize(maxSide, maxSide, { fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toFile(destPath);

  return { width: finalInfo.width, height: finalInfo.height, groundLine };
}

// ── contact sheet ─────────────────────────────────────────────────────────────

const COLS_DEFAULT = 4;
const BG = { r: 248, g: 248, b: 248, alpha: 1 };
const LABEL_H = 30; // label strip below each thumbnail

/** cell geometry for a thumbnail fit-inside box of thumbW x thumbH */
const cells = (thumbW, thumbH) => ({ THUMB_W: thumbW, THUMB_H: thumbH, CELL_W: thumbW + 20, CELL_H: thumbH + LABEL_H + 10 });

/** SVG label strip for one cell. */
function labelSvg(text, CELL_W) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="${LABEL_H}">` +
    `<rect width="${CELL_W}" height="${LABEL_H}" fill="#e8e8e8"/>` +
    `<text x="${CELL_W / 2}" y="${LABEL_H - 9}" font-family="monospace" font-size="14" ` +
    `text-anchor="middle" fill="#222">${safe}</text></svg>`
  );
}

/** Load a thumbnail buffer for one entry; returns null on failure. */
async function loadThumb(filePath, THUMB_W, THUMB_H) {
  try {
    return await sharp(filePath)
      .resize(THUMB_W, THUMB_H, { fit: 'inside', background: BG })
      .flatten({ background: BG })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Build a contact sheet.
 * entries: [{ key, path, fullPath, meta? }] where fullPath is the absolute path to load.
 * thumb: fit-inside box per image (art sheets 260x180; still sheets pass a larger one).
 */
export async function makeContactSheet(entries, outPath, { cols = COLS_DEFAULT, thumb = [260, 180] } = {}) {
  mkdirSync(dirname(outPath), { recursive: true });
  const { THUMB_W, THUMB_H, CELL_W, CELL_H } = cells(thumb[0], thumb[1]);

  if (!entries.length) {
    const width = CELL_W * cols, height = CELL_H;
    const msg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="#f8f8f8"/>` +
      `<text x="${width / 2}" y="${height / 2}" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#999">no art assets yet</text></svg>`
    );
    await sharp(msg).jpeg({ quality: 85 }).toFile(outPath);
    return;
  }

  const rows = Math.ceil(entries.length / cols);
  const totalW = CELL_W * cols, totalH = CELL_H * rows;
  const bg = await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png().toBuffer();

  const composites = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const col = idx % cols, row = Math.floor(idx / cols);
    const cellX = col * CELL_W, cellY = row * CELL_H;
    const { key, fullPath, meta } = entries[idx];

    const th = await loadThumb(fullPath, THUMB_W, THUMB_H);
    if (th) {
      const tm = await sharp(th).metadata();
      composites.push({ input: th, top: cellY + Math.floor((THUMB_H - tm.height) / 2), left: cellX + Math.floor((CELL_W - tm.width) / 2) });
    } else {
      // placeholder for an unreadable image
      const ph = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_W}" height="${THUMB_H}">` +
        `<rect width="${THUMB_W}" height="${THUMB_H}" fill="#ddd" rx="4"/>` +
        `<text x="${THUMB_W / 2}" y="${THUMB_H / 2 + 5}" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#888">?</text></svg>`
      );
      composites.push({ input: ph, top: cellY, left: cellX + Math.floor((CELL_W - THUMB_W) / 2) });
    }
    const dims = meta ? ` (${meta.width}×${meta.height})` : '';
    composites.push({ input: labelSvg(`${key}${dims}`, CELL_W), top: cellY + THUMB_H, left: cellX });
  }

  await sharp(bg).composite(composites).jpeg({ quality: 88 }).toFile(outPath);
}

// ── QR SVG ────────────────────────────────────────────────────────────────────

/** Generate a QR code SVG string. Returns the SVG source. */
export async function makeQrSvg(url, { dark = '#000000', light = '#ffffff' } = {}) {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toString(url, { type: 'svg', color: { dark, light }, margin: 2 });
}
