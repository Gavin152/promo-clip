// ffmpeg-based MP4 probing helpers for qa.mjs.
// Uses ffmpeg binary (from ffmpeg-static); no ffprobe required.
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/** run ffmpeg and return its stderr as a string */
function stderr(argv) {
  const r = spawnSync(ffmpegPath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.error) throw r.error;
  return r.stderr?.toString() ?? '';
}

/**
 * Parse a HH:MM:SS.ms time string to seconds.
 * Returns NaN if the string is invalid.
 */
export function parseHMSS(s) {
  const m = /(\d+):(\d+):([\d.]+)/.exec(s ?? '');
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

/**
 * Probe an MP4 (or any media file) and return:
 *   { containerDuration, videoW, videoH, fps, hasAudio }
 * All values are null when the stream is absent or unparseable.
 */
export function probeFile(file) {
  const info = stderr(['-hide_banner', '-i', file]);

  // container duration
  const dm = /Duration:\s*(\d+:\d+:[\d.]+)/.exec(info);
  const containerDuration = dm ? parseHMSS(dm[1]) : null;

  // video stream: resolution + fps
  // example: "Stream #0:0(und): Video: h264 ..., 1920x1080 ..., 30 fps"
  const vm = /Stream #\d+:\d+[^:]*: Video:[^\n]*?(\d{3,5})x(\d{3,5})[^\n]*?(\d+(?:\.\d+)?)\s+fps/.exec(info);
  const videoW = vm ? parseInt(vm[1], 10) : null;
  const videoH = vm ? parseInt(vm[2], 10) : null;
  const fps = vm ? parseFloat(vm[3]) : null;

  // audio stream presence
  const hasAudio = /Stream #\d+:\d+[^:]*: Audio:/.test(info);

  return { containerDuration, videoW, videoH, fps, hasAudio };
}

/**
 * Decode a single stream and return its duration by reading the last "time=…" line.
 * map: ffmpeg -map argument, e.g. '0:v:0' or '0:a:0'.
 * Returns null if unavailable.
 */
export function streamDuration(file, map) {
  const out = stderr(['-hide_banner', '-i', file, '-map', map, '-f', 'null', '-']);
  // the last "time=HH:MM:SS.ms" in progress output gives the decoded duration
  const matches = [...out.matchAll(/time=(\d+:\d+:[\d.]+)/g)];
  if (!matches.length) return null;
  return parseHMSS(matches[matches.length - 1][1]);
}
