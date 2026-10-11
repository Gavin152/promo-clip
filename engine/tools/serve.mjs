// Minimal static server for a video folder (used by stills/export). index.html falls back to the
// engine's copy, so a project without its own index.html (e.g. the CI fixture) still plays.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { ENGINE } from './lib/paths.mjs';

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

export function serve(project, port = 0) {
  const root = resolve(project);
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      try {
        const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/favicon.ico') { rsp.writeHead(204); rsp.end(); return; }
        let file = resolve(join(root, p === '/' ? 'index.html' : p));
        if (file !== root && !file.startsWith(root + sep)) throw new Error('bad path');
        if (p.replace(/^\//, '') in { '': 1, 'index.html': 1 } && !existsSync(file)) file = join(ENGINE, 'index.html');
        const data = await readFile(file);
        rsp.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
        rsp.end(data);
      } catch {
        rsp.writeHead(404);
        rsp.end();
      }
    });
    srv.listen(port, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
