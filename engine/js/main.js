// Player: renders the scenes to canvas, syncs to the Web Audio clock, exposes export hooks.
// Boot: theme (applied when the style module loads) -> manifest images -> scenes sorted by start ->
// timeline T + TRANSITIONS -> AudioEngine with every scene's sfx -> player loop or export mode.
import { W, H, OUT_W, OUT_H, SCALE, CROP_X, CROP_Y, FMT, LKEY, DURATION, hash } from './util.js';
import { S, C, THEME_DATA, initLayer, makePaperTexture, loadImages, makeVignette, drawTransitions, transitionSfx } from './style/collage/index.js';
import { AudioEngine } from './audio.js';
import T, * as TL from '@project/timeline.js';
import MANIFEST from '@project/manifest.json';
import SCENE_MODULES from '@scenes';
import { FONTS_CSS } from '@build/media-data.js';

const TRANSITIONS = TL.TRANSITIONS ?? [];

// ---------------- scenes: resolve starts against T, order = film order, end = next start
const LAYOUT_ORDER = ['land', 'vert', 'sq'];
const warnedLayout = new Set();
export const SCENES = SCENE_MODULES.map((m) => {
  const start = typeof m.start === 'function' ? m.start(T) : m.start ?? 0;
  if (!Number.isFinite(start)) throw new Error(`scene ${m.id}: start is not a number`);
  return { ...m, start };
}).sort((a, b) => a.start - b.start);
SCENES.forEach((sc, i) => (sc.end = i + 1 < SCENES.length ? SCENES[i + 1].start : DURATION + 1));

/** the layout for the current format; falls back to another format's layout (with a warning) */
function layoutOf(sc) {
  const lay = sc.layout ?? {};
  if (lay[LKEY]) return lay[LKEY];
  const alt = LAYOUT_ORDER.find((k) => lay[k]);
  if (alt && !warnedLayout.has(sc.id)) { warnedLayout.add(sc.id); console.warn(`scene ${sc.id}: no '${LKEY}' layout yet, using '${alt}'`); }
  return alt ? lay[alt] : {};
}
for (const sc of SCENES) sc.L = layoutOf(sc);

/** every SFX cue of the film: scene sfx(T) + transition sounds */
function collectSfx() {
  const out = [];
  for (const sc of SCENES) {
    if (!sc.sfx) continue;
    const list = typeof sc.sfx === 'function' ? sc.sfx(T, sc.L) : sc.sfx;
    for (const c of list ?? []) out.push({ ...c, scene: sc.id });
  }
  return out.concat(transitionSfx(TRANSITIONS));
}

// ---------------- canvas
const canvas = document.getElementById('stage');
canvas.width = OUT_W;
canvas.height = OUT_H;
document.documentElement.style.setProperty('--ar', `${OUT_W} / ${OUT_H}`);
document.documentElement.style.setProperty('--arw', String(OUT_W / OUT_H));
document.title = `${THEME_DATA.name ?? 'Promo'}${FMT !== 'landscape' ? ` (${FMT})` : ''}`;
const ctx = canvas.getContext('2d');
let paper, vignette;

export function renderFrame(t) {
  S.t = t;
  S.boil = Math.floor(t * 8);
  ctx.setTransform(SCALE, 0, 0, SCALE, -CROP_X, -CROP_Y); // design units (W x H) -> canvas pixels
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  for (const sc of SCENES) {
    if (t >= sc.start && t < sc.end) {
      ctx.save();
      S.scene = sc.id; // tracked for window.__frameBoxes QA hook
      sc.draw(ctx, t - sc.start, t, sc.L);
      ctx.restore();
    }
  }
  ctx.save();
  drawTransitions(ctx, t, TRANSITIONS);
  ctx.restore();
  // unify everything with paper grain + soft vignette
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.6;
  const ox = Math.floor(hash(S.boil, 1) * 120);
  const oy = Math.floor(hash(S.boil, 2) * 120);
  ctx.drawImage(paper, -ox, -oy);
  ctx.restore();
  ctx.drawImage(vignette, 0, 0);
}

// ---------------- player UI
const params = new URLSearchParams(location.search);
const audio = new AudioEngine(collectSfx());
let playing = false;
let pausedAt = params.has('t') ? parseFloat(params.get('t')) : 0;
const ui = {
  overlay: document.getElementById('start'),
  play: document.getElementById('play'),
  bar: document.getElementById('bar'),
  fill: document.getElementById('fill'),
  time: document.getElementById('time'),
  controls: document.getElementById('controls'),
  fs: document.getElementById('fs'),
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const now = () => (playing ? audio.time() : pausedAt);

function play(from = now()) {
  if (from >= DURATION - 0.05) from = 0;
  audio.play(from);
  playing = true;
  ui.play.textContent = '❚❚';
  ui.overlay.classList.add('hidden');
}
function pause() {
  pausedAt = now();
  audio.stop();
  playing = false;
  ui.play.textContent = '▶';
}
function seek(t) {
  t = Math.max(0, Math.min(DURATION, t));
  if (playing) audio.play(t);
  else pausedAt = t;
}

function loop() {
  let t = now();
  if (playing && t >= DURATION) {
    t = DURATION - 0.001;
    pause();
    pausedAt = DURATION;
    ui.overlay.classList.remove('hidden');
    ui.overlay.querySelector('span').textContent = 'Replay';
  }
  renderFrame(Math.min(t, DURATION - 0.001));
  ui.fill.style.width = `${(t / DURATION) * 100}%`;
  ui.time.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
  requestAnimationFrame(loop);
}

/** installs the embedded @font-face rules, then loads every family the theme names */
function loadFonts() {
  const st = document.createElement('style');
  st.textContent = FONTS_CSS;
  document.head.appendChild(st);
  const fams = new Set(Object.values(THEME_DATA.fonts ?? {}).concat(['Inter', 'Caveat', '"Permanent Marker"']));
  const loads = [];
  for (const f of fams) for (const w of [400, 500, 700, 900]) loads.push(document.fonts.load(`${w} 40px ${f}`).catch(() => null));
  return Promise.all(loads);
}

async function boot() {
  await Promise.all([loadFonts(), loadImages(MANIFEST), audio.load()]);
  initLayer(OUT_W, OUT_H);
  paper = makePaperTexture();
  vignette = makeVignette();
  window.__ready = true;
  if (params.has('export')) {
    renderFrame(pausedAt);
    return;
  }
  document.body.classList.add('ready');
  ui.overlay.addEventListener('click', () => play());
  ui.play.addEventListener('click', () => (playing ? pause() : play()));
  ui.bar.addEventListener('pointerdown', (e) => {
    const r = ui.bar.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * DURATION);
    if (!playing) ui.overlay.classList.add('hidden');
  });
  ui.fs.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.getElementById('wrap').requestFullscreen();
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    if (e.code === 'ArrowRight') seek(now() + 2);
    if (e.code === 'ArrowLeft') seek(now() - 2);
    if (e.key === 'f') ui.fs.click();
  });
  let hideT;
  addEventListener('pointermove', () => {
    ui.controls.classList.add('show');
    clearTimeout(hideT);
    hideT = setTimeout(() => ui.controls.classList.remove('show'), 2200);
  });
  loop();
}

// ---------------- export hooks (used by tools/export.mjs, stills.mjs, qa)
window.__duration = DURATION;
window.__size = [OUT_W, OUT_H];
window.__format = FMT;
window.__T = T;
window.__scenes = SCENES.map((s) => ({ id: s.id, start: s.start, end: Math.min(s.end, DURATION), layout: s.L, placeholder: s.placeholder === true || /^draw\s*\(\s*\)\s*\{\s*\}$/.test(String(s.draw ?? '').trim()) }));
window.__renderFrame = renderFrame;
window.__audio = audio;
window.__renderAudio = async (solo) => {
  const buf = await audio.renderOffline(solo);
  return audio.toWavBase64(buf);
};
window.__frameJPEG = (t, q = 0.92) => {
  renderFrame(t);
  return canvas.toDataURL('image/jpeg', q);
};
window.__framePNG = (t) => {
  renderFrame(t);
  return canvas.toDataURL('image/png');
};
/**
 * Render frame t and return all sticker bboxes in design units.
 * [{x0, y0, x1, y1, scene, text}] (text = the sticker contains text) — design units = (device px + crop) / scale.
 * Used by the QA layout checker.
 */
window.__frameBoxes = (t) => {
  S.collect = [];
  renderFrame(t);
  const boxes = S.collect.map((b) => ({
    x0: (b.x0 + CROP_X) / SCALE,
    y0: (b.y0 + CROP_Y) / SCALE,
    x1: (b.x1 + CROP_X) / SCALE,
    y1: (b.y1 + CROP_Y) / SCALE,
    scene: b.scene,
    text: b.text,
  }));
  S.collect = null;
  return boxes;
};
boot();
