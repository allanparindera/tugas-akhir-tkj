// Local dev server: in-memory Postgres (PGlite) + static files + /api handler
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pg = new PGlite(process.env.PGDATA || undefined);
globalThis.__q = async (text, params = []) => (await pg.query(text, params)).rows;
process.env.SESSION_SECRET ||= 'dev-secret-ta-tkj';
process.env.ADMIN_PASSWORD ||= 'guru123';
const { default: handler } = await import('./api/index.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (!urlPath.startsWith('/api')) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(__dirname, rel);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'content-type': MIME[ext] || 'text/plain; charset=utf-8' });
      return res.end(fs.readFileSync(filePath));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  let body = '';
  for await (const c of req) body += c;
  req.body = body;
  res.status = c => ((res.statusCode = c), res);
  res.json = o => (res.setHeader('content-type', 'application/json; charset=utf-8'), res.end(JSON.stringify(o)));
  await handler(req, res);
});

const port = Number(process.env.PORT || 3005);
server.listen(port, () => console.log(`http://localhost:${port}  (password guru: ${process.env.ADMIN_PASSWORD})`));
