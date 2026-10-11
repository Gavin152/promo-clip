// Output formats and sizes. Pure module (no DOM), shared by the player and the CLI.
// Scenes draw in a fixed design space per format; the output canvas is design space x scale.
// Custom sizes use the layout with the nearest aspect ratio, scaled to cover and centre-cropped.

export const FORMATS = ['landscape', 'vertical', 'square'];
/** short layout keys used in scene `layout` objects */
export const LAYOUT_KEY = { landscape: 'land', vertical: 'vert', square: 'sq' };

export const DESIGN = {
  landscape: [1920, 1080],
  vertical: [1260, 2240],
  square: [1260, 1260],
};

/** preset output sizes in px, per format */
export const SIZE_PRESETS = {
  landscape: { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4K': [3840, 2160] },
  vertical: { '720p': [720, 1280], '1080p': [1080, 1920], '1440p': [1440, 2560], '4K': [2160, 3840] },
  square: { '720p': [720, 720], '1080p': [1080, 1080], '1440p': [1440, 1440], '4K': [2160, 2160] },
};

/**
 * Max share of the scaled design space that a custom size may crop away, on the cropped axis
 * (both edges together). 0.2 = up to 10 % per edge, which admits 4:5 (1080x1350) from the square layout.
 */
export const MAX_CROP = 0.2;

/** the format whose design aspect ratio is closest to w:h (log distance) */
export function nearestFormat(w, h) {
  const ar = Math.log(w / h);
  let best = FORMATS[0], bd = Infinity;
  for (const f of FORMATS) {
    const [dw, dh] = DESIGN[f];
    const d = Math.abs(Math.log(dw / dh) - ar);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** parses '1080x1350' -> [1080, 1350], else null */
export function parseCustom(size) {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size ?? '').trim());
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

/**
 * Resolves the output canvas for a format and a size (preset name or 'WxH').
 * Returns { format, outW, outH, scale, cropX, cropY, designW, designH }:
 *   canvas px = design units * scale - [cropX, cropY]
 * For a custom size the layout is chosen by aspect ratio (`format` may differ from the request).
 */
export function resolveSize(format = 'landscape', size = '1080p') {
  if (!FORMATS.includes(format)) throw new Error(`unknown format "${format}" (use ${FORMATS.join(', ')})`);
  const preset = SIZE_PRESETS[format][size];
  if (preset) {
    const [designW, designH] = DESIGN[format];
    const [outW, outH] = preset;
    return { format, outW, outH, scale: outW / designW, cropX: 0, cropY: 0, designW, designH };
  }
  const custom = parseCustom(size);
  if (!custom) throw new Error(`unknown size "${size}" (use ${Object.keys(SIZE_PRESETS[format]).join(', ')} or WxH)`);
  const [outW, outH] = custom;
  if (outW < 16 || outH < 16) throw new Error(`size ${size} is too small`);
  if (outW % 2 || outH % 2) throw new Error(`size ${size}: width and height must be even (H.264 4:2:0)`);
  const f = nearestFormat(outW, outH);
  const [designW, designH] = DESIGN[f];
  const scale = Math.max(outW / designW, outH / designH);
  const sw = designW * scale, sh = designH * scale;
  const crop = Math.max(1 - outW / sw, 1 - outH / sh);
  if (crop > MAX_CROP + 1e-9) {
    throw new Error(`size ${size} would crop ${(crop * 100).toFixed(0)}% of the ${f} layout (max ${MAX_CROP * 100}%); pick a preset or a size closer to ${designW}:${designH}`);
  }
  return { format: f, outW, outH, scale, cropX: (sw - outW) / 2, cropY: (sh - outH) / 2, designW, designH };
}

/** file-name label for a size: preset name or 'WxH' */
export const sizeLabel = (size) => (parseCustom(size) ? parseCustom(size).join('x') : String(size));
