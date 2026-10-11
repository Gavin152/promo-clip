// Renders a video to MP4: rebuilds the bundle (so new VO / music / scenes are picked up), renders the
// Web Audio mix offline -> WAV, canvas frames -> H.264, normalises loudness (-14 LUFS integrated,
// <= -1 dBTP, linear gain) and muxes a master (CRF 16) and a web version.
// Output: <project>/out/<name>_<format>_<size>.mp4 and ..._web.mp4
import { ffmpeg } from './lib/audio.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from './build-assets.mjs';
import { openPlayer, frameJpeg } from './lib/page.mjs';
import { projectName } from './lib/paths.mjs';
import { sizeLabel } from '../js/formats.js';

/**
 * loudness to -14 LUFS integrated, true peak <= -1 dBTP, as pure gain: measure, then apply the gain;
 * when that gain would push peaks over -1 dBTP, a fast peak limiter catches only those peaks.
 * (ffmpeg's loudnorm "linear" pass silently switches to dynamic compression whenever the target LRA
 * or true peak can't be met with gain alone — and then fails on the channel layout with ffmpeg 6.)
 */
export async function normalise(wavIn, wavOut) {
  const measure = await ffmpeg(['-hide_banner', '-i', wavIn, '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-'], { capture: true });
  const m = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1));
  const inI = Number(m.input_i), inTP = Number(m.input_tp);
  const gain = -14 - inI;
  const filters = [`volume=${gain.toFixed(2)}dB`];
  const limited = inTP + gain > -1.2;
  // limiter at 4x oversampling so it also catches inter-sample (true) peaks; 0.84 ≈ -1.5 dBFS
  if (limited) filters.push('aresample=192000', 'alimiter=limit=0.84:attack=1:release=50:level=false');
  filters.push('aresample=48000');
  await ffmpeg(['-y', '-loglevel', 'error', '-i', wavIn, '-af', filters.join(','), '-ar', '48000', '-c:a', 'pcm_s16le', wavOut]);
  const check = await ffmpeg(['-hide_banner', '-i', wavOut, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { capture: true });
  const sum = check.slice(check.lastIndexOf('Summary'));
  return {
    measured: { lufs: inI, truePeak: inTP, lra: Number(m.input_lra) },
    gainDb: +gain.toFixed(2),
    limited,
    lufs: Number(sum.match(/I:\s+([-\d.]+) LUFS/)?.[1]),
    truePeak: Number(sum.match(/Peak:\s+([-\d.]+) dBFS/)?.[1]),
  };
}

/**
 * o: { format, size, fps, webOnly, audioOnly, stems, out (web file path), noBuild, quiet }
 * returns { master, web, format, size:[w,h], fps, duration, frames, audio }
 */
export async function exportVideo(project, o = {}) {
  project = resolve(project);
  const fps = parseInt(o.fps ?? 30, 10);
  if (![24, 25, 30, 60].includes(fps)) throw new Error(`fps ${fps} not supported (24, 25, 30, 60)`);
  const size = o.size ?? '1080p';
  const log = o.quiet ? () => {} : console.log;
  if (!o.noBuild) await build(project, { quiet: o.quiet, audioOnly: !!o.audioOnly });

  const { page, info, close } = await openPlayer(project, { format: o.format ?? 'landscape', size });
  const format = info.format; // a custom size may map to another layout
  const tag = `${format}_${sizeLabel(size)}`;
  const tmp = join(project, '.work/render', tag);
  await mkdir(tmp, { recursive: true });
  const base = join(project, 'out', `${projectName(project)}_${tag}`);
  await mkdir(join(project, 'out'), { recursive: true });
  const outMaster = `${base}.mp4`;
  const outWeb = o.out ? resolve(o.out) : `${base}_web.mp4`;
  log(`export ${format} ${info.size.join('x')} @${fps}fps, ${info.duration.toFixed(2)} s`);

  let audio, frames = 0;
  try {
    log('rendering audio…');
    const wav = join(tmp, 'mix.wav');
    await writeFile(wav, Buffer.from(await page.evaluate(() => window.__renderAudio()), 'base64'));
    if (o.stems) {
      for (const s of ['vo', 'music', 'sfx', 'musicRaw']) {
        await writeFile(join(tmp, `stem_${s}.wav`), Buffer.from(await page.evaluate((x) => window.__renderAudio(x), s), 'base64'));
        log('stem', s);
      }
    }
    const wavN = join(tmp, 'mix_norm.wav');
    audio = await normalise(wav, wavN);
    log(`mix ${audio.measured.lufs} LUFS -> ${audio.lufs} LUFS, true peak ${audio.truePeak} dBFS`);
    const stems = o.stems ? Object.fromEntries(['vo', 'music', 'sfx', 'musicRaw'].map((k) => [k, join(tmp, `stem_${k}.wav`)])) : null;
    if (o.audioOnly) return { format, size: info.size, fps, duration: info.duration, audio, wav: wavN, stems, dir: tmp };

    frames = Math.round(info.duration * fps);
    const video = join(tmp, 'video.mp4');
    log(`rendering ${frames} frames…`);
    await ffmpeg(['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], {
      stdin: async (stdin) => {
        const t0 = Date.now();
        for (let f = 0; f < frames; f++) {
          const buf = await frameJpeg(page, f / fps, 0.95);
          if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
          if (f % (fps * 3) === 0) log(`  frame ${f}/${frames}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        }
        stdin.end();
      },
    });
    await close();
    // web bitrate scales with the pixel count (5 Mbit/s at 1080p)
    const px = info.size[0] * info.size[1];
    const maxrate = Math.max(2, Math.round((5 * px) / (1920 * 1080)));
    if (!o.webOnly) await ffmpeg(['-y', '-loglevel', 'error', '-i', video, '-i', wavN, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', outMaster]);
    await ffmpeg(['-y', '-loglevel', 'error', '-i', video, '-i', wavN, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', `${maxrate}M`, '-bufsize', `${maxrate * 2}M`, '-tune', 'animation', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outWeb]);
    log('done ->', o.webOnly ? outWeb : `${outMaster}\n     -> ${outWeb}`);
    return { master: o.webOnly ? null : outMaster, web: outWeb, format, size: info.size, fps, duration: info.duration, frames, audio };
  } finally {
    await close().catch(() => {});
  }
}
