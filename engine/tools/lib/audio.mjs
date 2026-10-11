// ffmpeg + WAV helpers shared by the tools (ffmpeg comes from ffmpeg-static; no shell strings,
// so paths with spaces and Windows paths are safe).
import ffmpegPath from 'ffmpeg-static';
import { spawn, spawnSync, execFileSync } from 'node:child_process';

export { ffmpegPath };

/** runs ffmpeg; opts.capture returns stderr, opts.stdin(stream) feeds input */
export function ffmpeg(argv, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath, argv, { stdio: [opts.stdin ? 'pipe' : 'ignore', 'inherit', opts.capture ? 'pipe' : 'inherit'] });
    let err = '';
    if (opts.capture) p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('exit', (c) => (c === 0 ? res(err) : rej(new Error('ffmpeg exit ' + c + err.slice(-500)))));
    if (opts.stdin) opts.stdin(p.stdin);
  });
}

/** stderr of an ffmpeg run that only analyses (writes to null) */
export function analyse(input, filter) {
  return spawnSyncStderr(['-hide_banner', '-nostats', '-i', input, '-af', filter, '-f', 'null', '-']);
}
function spawnSyncStderr(argv) {
  const r = spawnSync(ffmpegPath, argv, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  return r.stderr?.toString() ?? '';
}

export const SRW = 16000;
/** decode any audio file -> mono Float32Array at sr */
export function decode(file, sr = SRW) {
  const buf = execFileSync(ffmpegPath, ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}
/** RMS envelope in dBFS, one value per hop seconds */
export function envelope(x, sr = SRW, hop = 0.01) {
  const n = Math.round(sr * hop), out = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0;
    for (let k = i; k < i + n; k++) s += x[k] * x[k];
    out.push(10 * Math.log10(s / n + 1e-12));
  }
  return out;
}
/** duration in seconds (ffmpeg probe) */
export function duration(file) {
  const err = spawnSyncStderr(['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err);
  if (!m) throw new Error(`cannot read duration of ${file}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}
/** 16-bit PCM WAV from float samples */
export function wav16(samples, sr, channels = 1) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}
/** integrated loudness + true peak via ebur128 */
export function loudness(file) {
  const err = analyse(file, 'ebur128=peak=true');
  const sum = err.slice(err.lastIndexOf('Summary'));
  return { lufs: Number(sum.match(/I:\s+([-\d.]+) LUFS/)?.[1]), truePeak: Number(sum.match(/Peak:\s+([-\d.]+) dBFS/)?.[1]), lra: Number(sum.match(/LRA:\s+([-\d.]+) LU/)?.[1]) };
}
