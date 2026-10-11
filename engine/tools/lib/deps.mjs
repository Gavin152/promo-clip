// Setup check: Node version, Chrome, ffmpeg, tool packages, API key. Each problem carries an
// install hint for the user's OS.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { findChrome } from './chrome.mjs';
import { ENGINE } from './paths.mjs';

export const MIN_NODE = 20;
const OS = process.platform;
const hint = (h) => h[OS] ?? h.linux;

const NODE_HINT = {
  darwin: 'Install Node 20+ from https://nodejs.org or `brew install node`.',
  linux: 'Install Node 20+ from https://nodejs.org or your package manager (e.g. via nvm).',
  win32: 'Install Node 20+ from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`).',
};

/** returns [{ name, ok, detail, hint? }] */
export async function checkDeps({ project, needKey = false, keyLoader } = {}) {
  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ name: 'node', ok: major >= MIN_NODE, detail: `v${process.versions.node}`, ...(major >= MIN_NODE ? {} : { hint: hint(NODE_HINT) }) });

  const toolsDir = join(ENGINE, 'tools');
  const req = createRequire(join(toolsDir, 'package.json'));
  const pkgs = ['esbuild', 'puppeteer-core', 'ffmpeg-static', 'sharp', 'qrcode', 'jsqr'];
  const missing = pkgs.filter((p) => { try { req.resolve(p); return false; } catch { return true; } });
  out.push({ name: 'tool packages', ok: !missing.length, detail: missing.length ? `missing ${missing.join(', ')}` : 'installed', ...(missing.length ? { hint: `Run \`npm install\` in ${toolsDir}` } : {}) });

  try {
    const ff = req('ffmpeg-static');
    out.push({ name: 'ffmpeg', ok: !!ff && existsSync(ff), detail: ff ?? 'not found', ...(ff && existsSync(ff) ? {} : { hint: `Reinstall ffmpeg-static (\`npm install\` in ${toolsDir}); it downloads a static ffmpeg for this OS` }) });
  } catch {
    out.push({ name: 'ffmpeg', ok: false, detail: 'ffmpeg-static not installed', hint: `Run \`npm install\` in ${toolsDir}` });
  }

  try {
    out.push({ name: 'chrome', ok: true, detail: findChrome() });
  } catch (e) {
    out.push({ name: 'chrome', ok: false, detail: 'not found', hint: e.message });
  }

  if (keyLoader) {
    let ok = true;
    try { keyLoader(project); } catch { ok = false; }
    out.push({ name: 'OPENROUTER_API_KEY', ok: ok || !needKey, optional: !ok && !needKey, detail: ok ? 'found' : 'not set (only needed for AI voice, music, art)', ...(ok ? {} : { hint: 'Create an OpenRouter key at https://openrouter.ai/keys and put OPENROUTER_API_KEY=… in the video folder\'s .env' }) });
  }
  return out;
}
