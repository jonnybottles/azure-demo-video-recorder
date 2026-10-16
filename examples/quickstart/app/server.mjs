import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.DEMO_APP_PORT ?? 5199);
let project = null;
let eventId = null;
let revision = 0;
let duplicateCount = 0;
let actualPort = port;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const server = http.createServer((req, res) => {
  const origin = `http://${host}:${actualPort}`;
  if (!['127.0.0.1', 'localhost'].includes(String(req.headers.host ?? '').split(':')[0])) return send(res, 403, { error: 'Local requests only.' });
  if (req.method === 'GET' && req.url === '/') {
    return send(res, 200, fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    return send(res, 200, { project, revision, eventId, duplicateCount, status: project ? 'Verified' : 'Waiting for an update' });
  }
  if (req.method === 'POST' && ['/api/projects', '/api/resend'].includes(req.url)) {
    if (req.headers.origin !== origin || req.headers['x-demo-action'] !== '1') return send(res, 403, { error: 'Request rejected.' });
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 4096) {
        tooLarge = true;
        send(res, 413, { error: 'Request is too large.' });
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      let update;
      try { update = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid request.' }); }
      if (req.url === '/api/resend') {
        duplicateCount++;
        return send(res, 202, { accepted: true, duplicate: true });
      }
      if (typeof update.name !== 'string' || update.name.trim().length < 2 || update.name.length > 100) {
        return send(res, 400, { error: 'Project name is required.' });
      }
      project = { id: 'PRJ-1042', name: update.name.trim(), status: 'Active' };
      eventId = typeof update.eventId === 'string' ? update.eventId : 'evt-local-1042';
      revision = 1;
      return send(res, 202, { accepted: true });
    });
    return;
  }
  return send(res, 404, { error: 'Not found.' });
});

server.listen(port, host, () => {
  actualPort = server.address().port;
  console.log(`Synthetic demo app listening on http://${host}:${actualPort}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
