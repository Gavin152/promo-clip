// Regenerates the sample-15s fixture's placeholder assets. Deterministic, no API calls, all licence-free:
//   assets/vo/vo.wav (+ vo_nogaps.wav)   procedural "babble" voice, one vowel-ish blip per word
//   vo/timing.json (+ timing_nogaps.json) exact word times (known, because we synthesise per word)
//   assets/music/track.mp3 + cues.json   120 BPM pad/kick/hat loop with a final hit on the last word
//   assets/art/*.png|jpg, assets/img/*   simple vector art rendered with sharp; QR via qrcode
// The committed files are the reference; re-running this script reproduces them.
// usage: node fixtures/sample-15s/make-fixture.mjs   (needs engine/tools/node_modules)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(here, '../../engine/tools/package.json'));
const sharp = req('sharp');
const QRCode = req('qrcode');
const ffmpeg = req('ffmpeg-static');
const out = (p) => { mkdirSync(dirname(join(here, p)), { recursive: true }); return join(here, p); };

// ---------------------------------------------------------------- deterministic helpers
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wav16(samples, sr, channels = 1) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

// ---------------------------------------------------------------- voice-over
// scenes are separated by '|'; sentence ends get a longer pause than words
const SCRIPT = 'Introducing Demo Product. Your week, sorted in seconds. | Try the feature. Tap once, and it just works. | Get Demo Product now.';
const VO_SR = 16000;
const VO_START = 0.5;
const GAP = { word: 0.09, sentence: 0.45, scene: 0.55 };
const SCENE_EXTRA = 0.45; // what the "gaps" step adds at scene boundaries (vo_nogaps -> vo)

function voice(withSceneGaps) {
  const words = [], sentences = [];
  let t = 0.05, sent = null;
  const scenes = SCRIPT.split('|').map((s) => s.trim());
  scenes.forEach((scene, si) => {
    const toks = scene.split(/\s+/);
    toks.forEach((w, wi) => {
      const syl = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
      const dur = 0.1 + syl * 0.11;
      if (!sent) sent = { text: '', start: t, first: words.length };
      words.push({ i: words.length, w, start: +t.toFixed(3), end: +(t + dur).toFixed(3), conf: 1 });
      sent.text += (sent.text ? ' ' : '') + w;
      t += dur;
      const end = /[.!?]$/.test(w);
      if (end) {
        sentences.push({ text: sent.text, start: +sent.start.toFixed(3), first: sent.first, end: +t.toFixed(3), last: words.length - 1 });
        sent = null;
      }
      const lastOfScene = wi === toks.length - 1 && si < scenes.length - 1;
      t += lastOfScene ? GAP.scene + (withSceneGaps ? SCENE_EXTRA : 0) : end ? GAP.sentence : GAP.word;
    });
  });
  const len = t + 0.3;
  const x = new Float32Array(Math.ceil(len * VO_SR));
  words.forEach((w, k) => {
    const r = rng(k * 31 + 7);
    const f0 = 135 + r() * 30, f1 = 500 + r() * 300, f2 = 1300 + r() * 900;
    const a = Math.round(w.start * VO_SR), b = Math.round(w.end * VO_SR);
    let ph = 0;
    for (let i = a; i < b; i++) {
      const u = (i - a) / (b - a);
      const f = f0 * (1.08 - 0.16 * u); // falling pitch per word
      ph += (2 * Math.PI * f) / VO_SR;
      let s = 0;
      for (let h = 1; h <= 24; h++) {
        const hf = f * h;
        if (hf > VO_SR / 2 - 200) break;
        const g = Math.exp(-(((hf - f1) / 180) ** 2)) + 0.6 * Math.exp(-(((hf - f2) / 260) ** 2)) + 0.25 / h;
        s += Math.sin(ph * h) * g;
      }
      const env = Math.min(1, u * 14) * Math.min(1, (1 - u) * 8) * (0.8 + 0.2 * Math.sin(u * Math.PI * 3));
      x[i] += s * env * 0.16;
    }
  });
  return { wav: wav16(x, VO_SR), words, sentences, duration: +len.toFixed(3) };
}

const nog = voice(false), vo = voice(true);
const timing = (v, src) => ({
  source: src,
  transcriber: 'none (fixture: synthesised per word, times are exact)',
  tts: 'procedural babble (make-fixture.mjs)',
  vo_start: VO_START,
  duration: v.duration,
  note: 'word times are seconds relative to vo.wav; film time = vo_start + t',
  sentences: v.sentences,
  words: v.words,
  tail: 4.0,
});
writeFileSync(out('assets/vo/vo_nogaps.wav'), nog.wav);
writeFileSync(out('assets/vo/vo.wav'), vo.wav);
writeFileSync(out('vo/timing_nogaps.json'), JSON.stringify(timing(nog, 'assets/vo/vo_nogaps.wav'), null, 1) + '\n');
writeFileSync(out('vo/timing.json'), JSON.stringify(timing(vo, 'assets/vo/vo.wav (vo_nogaps + scene pauses)'), null, 1) + '\n');

// ---------------------------------------------------------------- music
const M_SR = 22050, BPM = 120, BEAT = 60 / BPM, M_LEN = 20;
const HIT_TRACK = 16; // final button hit (a downbeat) in track seconds
const lastWord = vo.words[vo.words.length - 1];
const finalFilm = VO_START + lastWord.start; // the hit lands on the last word
const offset = +(finalFilm - HIT_TRACK).toFixed(3); // film = track + offset
const m = new Float32Array(M_LEN * M_SR);
const CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]; // C G Am F
const mtof = (n) => 440 * 2 ** ((n - 69) / 12);
const r = rng(99);
for (let i = 0; i < m.length; i++) {
  const t = i / M_SR;
  if (t > HIT_TRACK + 3.8) break; // ring-out after the hit, then silence
  const bar = Math.floor(t / (BEAT * 4));
  const chord = CHORDS[bar % 4];
  const end = t > HIT_TRACK ? Math.exp(-(t - HIT_TRACK) * 1.6) : 1;
  let s = 0;
  for (const n of chord) s += Math.sin(2 * Math.PI * mtof(n) * t) * 0.05 + Math.sin(2 * Math.PI * mtof(n - 12) * t) * 0.03;
  const bt = t % BEAT;
  if (t < HIT_TRACK) {
    s += Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 14) * 0.35; // kick
    const ht = (t + BEAT / 2) % BEAT;
    s += (r() * 2 - 1) * Math.exp(-ht * 60) * 0.06; // hat on the off-beat
  }
  if (t >= HIT_TRACK) {
    const ht = t - HIT_TRACK;
    for (const n of [48, 60, 64, 67, 72]) s += Math.sin(2 * Math.PI * mtof(n) * t) * 0.09 * Math.exp(-ht * 1.2);
    s += (r() * 2 - 1) * Math.exp(-ht * 5) * 0.12;
  }
  m[i] = s * end;
}
const mwav = out('.work/track.wav');
writeFileSync(mwav, wav16(m, M_SR));
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', mwav, '-ac', '1', '-b:a', '96k', out('assets/music/track.mp3')]);
const beats = [], downbeats = [];
for (let b = 0; b * BEAT < M_LEN - 1e-9; b++) { beats.push(+(b * BEAT).toFixed(3)); if (b % 4 === 0) downbeats.push(+(b * BEAT).toFixed(3)); }
const s2 = VO_START + vo.words.find((w) => w.w === 'Try').start - 0.3;
const revealTrack = downbeats.reduce((best, d) => (Math.abs(d + offset - s2) < Math.abs(best + offset - s2) ? d : best), 0);
const cues = {
  track: 'track.mp3',
  source: 'procedural fixture loop (make-fixture.mjs): C-G-Am-F pads, kick, off-beat hat, final hit',
  bpm: BPM,
  beatPeriod: BEAT,
  firstDownbeat: 0,
  offset,
  hits: { reveal: revealTrack, final: HIT_TRACK, end: HIT_TRACK + 3.8 },
  film: { reveal: +(revealTrack + offset).toFixed(3), final: +(HIT_TRACK + offset).toFixed(3), end: +(HIT_TRACK + 3.8 + offset).toFixed(3) },
  accents: [{ film: +(revealTrack + offset).toFixed(3), track: revealTrack, change: 3 }],
  downbeats,
  beats,
  mix: { bedDb: -8, duckDb: -10, attack: 0.18, release: 0.6, lookahead: 0.15, mergeGap: 0.7, sections: [], fadeIn: 0.4, fadeOut: 0.8, voDb: 0, sfxDb: -8 },
};
writeFileSync(out('assets/music/cues.json'), JSON.stringify(cues, null, 1) + '\n');

// ---------------------------------------------------------------- art (vector -> raster)
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
// product box sticker: transparent background, white die-cut border baked in (as art-process would make it)
await sharp(svg(600, 640, `
  <g stroke="#FFFFFF" stroke-width="44" stroke-linejoin="round" fill="#FFFFFF"><path d="M90 200 L300 110 L510 200 L510 500 L300 590 L90 500 Z"/></g>
  <path d="M90 200 L300 110 L510 200 L300 290 Z" fill="#FFD84D" stroke="#1B1F2A" stroke-width="10" stroke-linejoin="round"/>
  <path d="M90 200 L300 290 L300 590 L90 500 Z" fill="#FF8A3D" stroke="#1B1F2A" stroke-width="10" stroke-linejoin="round"/>
  <path d="M510 200 L300 290 L300 590 L510 500 Z" fill="#E8413C" stroke="#1B1F2A" stroke-width="10" stroke-linejoin="round"/>
  <path d="M150 300 L240 340 M150 350 L230 385" stroke="#1B1F2A" stroke-width="9" stroke-linecap="round"/>
  <circle cx="405" cy="390" r="52" fill="#FFF8EA" stroke="#1B1F2A" stroke-width="9"/>
  <path d="M378 392 L398 412 L436 370" fill="none" stroke="#2FA487" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`)).png().toFile(out('assets/art/box.png'));
// backdrop: a sunny desk/wall scene
await sharp(svg(1600, 1000, `
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9ECF6"/><stop offset="1" stop-color="#9ED8EE"/></linearGradient></defs>
  <rect width="1600" height="1000" fill="url(#g)"/>
  <circle cx="1250" cy="230" r="120" fill="#FFF3B0" opacity="0.8"/>
  <rect y="690" width="1600" height="310" fill="#D9C3A0"/><rect y="690" width="1600" height="26" fill="#B98553"/>
  <g fill="#FFFFFF" opacity="0.7"><ellipse cx="300" cy="200" rx="160" ry="44"/><ellipse cx="380" cy="170" rx="110" ry="50"/><ellipse cx="900" cy="300" rx="140" ry="38"/></g>`)).jpeg({ quality: 86 }).toFile(out('assets/art/bg_room.jpg'));
// app screenshot placeholder (portrait phone screen)
await sharp(svg(590, 1280, `
  <rect width="590" height="1280" fill="#111827"/>
  <rect x="40" y="120" width="510" height="90" rx="20" fill="#1F2937"/><rect x="70" y="150" width="240" height="30" rx="8" fill="#01D7FC"/>
  <rect x="40" y="250" width="510" height="420" rx="28" fill="#1F2937"/>
  <path d="M80 600 L170 500 L250 540 L340 400 L420 450 L510 300" fill="none" stroke="#C8F56A" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#1F2937"><rect x="40" y="710" width="245" height="200" rx="24"/><rect x="305" y="710" width="245" height="200" rx="24"/></g>
  <rect x="70" y="760" width="120" height="60" rx="10" fill="#01D7FC"/><rect x="335" y="760" width="150" height="60" rx="10" fill="#FF6B6B"/>
  <rect x="140" y="1080" width="310" height="96" rx="48" fill="#01D7FC"/>`)).png().toFile(out('assets/img/screen.png'));
writeFileSync(out('assets/img/qr.svg'), await QRCode.toString('https://example.com', { type: 'svg', margin: 2, color: { dark: '#111827', light: '#FFFFFF' } }));

console.log(`fixture written: vo ${vo.duration}s (${vo.words.length} words), music offset ${offset}s, final hit at film ${cues.film.final}s`);
