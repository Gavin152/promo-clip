// Where things live. ENGINE = the engine folder these tools belong to (the plugin's engine/ or the
// copy inside a video folder). PROJECT = the video folder: --project <dir>, else the nearest folder
// at or above the cwd that holds promo.json, else the cwd.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENGINE_VERSION = readFileSync(join(ENGINE, 'VERSION'), 'utf8').trim();

export function findProject(explicit) {
  if (explicit) return resolve(explicit);
  let d = process.cwd();
  for (;;) {
    if (existsSync(join(d, 'promo.json'))) return d;
    const up = dirname(d);
    if (up === d) return process.cwd();
    d = up;
  }
}

export function readJson(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** output base name: promo.json name, else theme name, else the folder name (file-system safe) */
export function projectName(project) {
  const promo = readJson(join(project, 'promo.json'), {});
  const theme = readJson(join(project, 'theme.json'), {});
  const raw = promo.name ?? theme.name ?? basename(project);
  return String(raw).trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'promo';
}
