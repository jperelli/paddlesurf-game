// Static file server for the built game plus the high-score API, backed by SQLite (node:sqlite).
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ?? join(ROOT, 'dist');
const DB_PATH = process.env.DB_PATH ?? join(ROOT, 'data', 'scores.db');
const PORT = Number(process.env.PORT ?? 8080);
const MAX_LIMIT = 50;

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    waves INTEGER NOT NULL,
    points INTEGER NOT NULL,
    spot TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scores_at ON scores(at);
  CREATE INDEX IF NOT EXISTS scores_rank ON scores(points DESC, waves DESC, at ASC);
`);
const insert = db.prepare('INSERT INTO scores (name, waves, points, spot, seed, at) VALUES (?, ?, ?, ?, ?, ?)');
const top = db.prepare(
  'SELECT id, name, waves, points, spot, at FROM scores WHERE at >= ? ORDER BY points DESC, waves DESC, at ASC LIMIT ?',
);
const rankOf = db.prepare(
  'SELECT COUNT(*) AS n FROM scores WHERE at >= ? AND (points > ? OR (points = ? AND waves > ?) OR (points = ? AND waves = ? AND at < ?))',
);

const PERIODS = ['day', 'week', 'month', 'all'];

/** Start of the period (ms since epoch) in the player's local time; tz is the JS getTimezoneOffset() in minutes. */
function periodStart(period, now, tz) {
  if (period === 'all') return 0;
  const shift = tz * 60_000;
  const local = new Date(now - shift);
  let y = local.getUTCFullYear();
  let m = local.getUTCMonth();
  let d = local.getUTCDate();
  if (period === 'month') d = 1;
  if (period === 'week') d -= (local.getUTCDay() + 6) % 7;
  return Date.UTC(y, m, d) + shift;
}

function clampInt(v, lo, hi) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = 4096) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function ranks(now, tz, points, waves, at) {
  const out = {};
  for (const p of PERIODS) out[p] = rankOf.get(periodStart(p, now, tz), points, points, waves, points, waves, at).n + 1;
  return out;
}

async function api(req, res, url) {
  const tz = clampInt(url.searchParams.get('tz') ?? 0, -900, 900) ?? 0;
  const now = Date.now();
  if (req.method === 'GET' && url.pathname === '/api/scores') {
    const period = url.searchParams.get('period') ?? 'all';
    if (!PERIODS.includes(period)) return json(res, 400, { error: 'bad period' });
    const limit = clampInt(url.searchParams.get('limit') ?? 20, 1, MAX_LIMIT) ?? 20;
    return json(res, 200, { period, since: periodStart(period, now, tz), scores: top.all(periodStart(period, now, tz), limit) });
  }
  if (req.method === 'POST' && url.pathname === '/api/scores') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }
    const name = String(body?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
    const waves = clampInt(body?.waves, 0, 10_000);
    const points = clampInt(body?.points, 0, 10_000_000);
    if (!name || waves === null || points === null) return json(res, 400, { error: 'name, waves and points required' });
    const spot = String(body?.spot ?? '').slice(0, 60);
    const seed = String(body?.seed ?? '').slice(0, 16);
    const id = Number(insert.run(name, waves, points, spot, seed, now).lastInsertRowid);
    return json(res, 201, { id, at: now, rank: ranks(now, tz, points, waves, now) });
  }
  return json(res, 404, { error: 'not found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, url) {
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('not built');
    return;
  }
  const ext = extname(file);
  const immutable = path.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`paddlesurf server on :${PORT}, db ${DB_PATH}, static ${DIST}`));
