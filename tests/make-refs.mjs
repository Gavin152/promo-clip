#!/usr/bin/env node
// Renders the fixture's reference stills for THIS OS into fixtures/sample-15s/ref/stills/<platform>/<format>/
// (lossless PNG, 720p, one per scene). Run after an intended visual change, inspect, commit.
// Linux refs must come from the CI container (node:22-bookworm + Debian chromium) on x86-64 — arm64
// Chromium rasterises slightly differently — e.g. on an Apple Silicon Mac:
//   podman run --rm --platform linux/amd64 -v "$PWD":/repo -w /repo node:22-bookworm bash -c \
//     'apt-get update && apt-get install -y chromium && cd engine/tools && npm ci && cd /repo && CHROME_PATH=/usr/bin/chromium node tests/make-refs.mjs'
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixtures/sample-15s');
const CLI = join(ROOT, 'engine/tools/cli.mjs');
const run = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--project', FIXTURE], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(['build']);
for (const f of ['landscape', 'vertical', 'square']) {
  run(['stills', join(FIXTURE, 'ref/stills', process.platform, f), '--scenes', '--format', f, '--size', '720p', '--no-build', '--png=true']);
}
console.log(`refs written to ${join(FIXTURE, 'ref/stills', process.platform)}`);
