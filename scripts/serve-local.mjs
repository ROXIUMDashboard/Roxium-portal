#!/usr/bin/env node
/**
 * serve-local.mjs — serve the built site/ directory the way Cloudflare Pages does.
 *
 *   node scripts/serve-local.mjs [--dir site] [--port 8788]
 *
 * Implements the `_redirects` contract so local runs and CI exercise the SAME
 * routing production uses — in particular the ordering that keeps /privacy and
 * /terms from being swallowed by the SPA fallback, and the /portal -> /portal/
 * rule that once caused an infinite redirect loop in Safari.
 *
 * Zero dependencies. Used by the Playwright suite and by scripts/smoke-test.mjs
 * for local verification. Not a production server.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const ROOT = resolve(argv.dir || 'site');
const PORT = Number(argv.port || 8788);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

// Mirrors _redirects, in order. First match wins.
const REDIRECTS = [
  { from: '/portal.html', to: '/portal/', code: 301 },
  { from: '/portal', to: '/portal/', code: 301 },
];
const REWRITES = [
  { from: '/privacy', to: '/privacy/index.html' },
  { from: '/privacy/', to: '/privacy/index.html' },
  { from: '/terms', to: '/terms/index.html' },
  { from: '/terms/', to: '/terms/index.html' },
];

async function readIfFile(p) {
  try { const s = await stat(p); if (s.isFile()) return await readFile(p); } catch { /* miss */ }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  const r = REDIRECTS.find((x) => x.from === path);
  if (r) { res.writeHead(r.code, { Location: r.to }); return res.end(); }

  const rw = REWRITES.find((x) => x.from === path);
  const target = rw ? rw.to : path;

  // Resolve to a real file, tracking WHICH file so the content-type matches the
  // thing actually served (not the request path — a directory request resolves to
  // index.html and must still be sent as text/html, or the browser downloads it).
  let file = join(ROOT, target);
  let body = await readIfFile(file);
  if (!body && !extname(target)) {
    file = join(ROOT, target, 'index.html');
    body = await readIfFile(file);
  }
  // SPA fallback: anything unmatched serves the portal app, HTTP 200, no redirect.
  if (!body) {
    file = join(ROOT, 'portal', 'index.html');
    body = await readIfFile(file);
  }
  if (!body) { res.writeHead(404); return res.end('not found'); }
  const ext = extname(file);

  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}`));
