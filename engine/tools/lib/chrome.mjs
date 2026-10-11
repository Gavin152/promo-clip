// Cross-platform Chrome / Chromium discovery for headless rendering.
// Order: CHROME_PATH env var, then well-known install paths per OS, then binaries on PATH.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const HINTS = {
  darwin: 'Install Google Chrome (https://www.google.com/chrome/) or set CHROME_PATH to a Chrome/Chromium binary.',
  linux: 'Install Chrome or Chromium (e.g. `sudo apt install chromium` or google-chrome-stable) or set CHROME_PATH.',
  win32: 'Install Google Chrome (https://www.google.com/chrome/) or set CHROME_PATH to chrome.exe.',
};

function candidates() {
  const p = process.platform;
  if (p === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ];
  }
  if (p === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.map((r) => join(r, 'Google/Chrome/Application/chrome.exe'));
  }
  return [];
}

function onPath(names) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const n of names) {
    try {
      const out = execFileSync(which, [n], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim();
      if (out) return out;
    } catch { /* not found */ }
  }
  return null;
}

/** absolute path of a usable Chrome; throws with an install hint for this OS */
export function findChrome() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error(`CHROME_PATH=${process.env.CHROME_PATH} does not exist`);
  }
  for (const c of candidates()) if (existsSync(c)) return c;
  const found = onPath(['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome']);
  if (found) return found;
  throw new Error(`Chrome not found. ${HINTS[process.platform] ?? HINTS.linux}`);
}
