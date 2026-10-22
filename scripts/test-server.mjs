// Local file server for trying Grabbit without the internet: Range support, a per-connection speed cap and a few
// misbehaving endpoints. `node scripts/test-server.mjs` then add e.g. http://127.0.0.1:7400/files/ubuntu.iso?mb=200
//
//   /files/<name>?mb=N&kbps=K   N MB of deterministic bytes, K KB/s per connection (default 100 MB, 800 KB/s)
//   /norange/<name>?mb=N        same, but ignores Range (single connection, cannot resume)
//   /redirect/<name>            302 to /files/<name>
//   /expired/<name>             403 (a link that expired)
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 7400);
const PIECE = 16 * 1024;

function byteAt(i) {
  return (i * 2654435761) >>> 24;
}

function fill(buf, offset) {
  for (let i = 0; i < buf.length; i++) buf[i] = byteAt(offset + i);
  return buf;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const [, kind, ...rest] = url.pathname.split('/');
    const name = decodeURIComponent(rest.join('/') || 'file.bin');
    if (kind === 'redirect') return void res.writeHead(302, { Location: `/files/${encodeURIComponent(name)}${url.search}` }).end();
    if (kind === 'expired') return void res.writeHead(403).end('Link expired');
    if (kind !== 'files' && kind !== 'norange') return void res.writeHead(404).end('Not found');

    const size = Math.round(Number(url.searchParams.get('mb') ?? 100) * 1024 * 1024);
    const rate = Number(url.searchParams.get('kbps') ?? 800) * 1024;
    const m = kind === 'files' ? /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '') : null;
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) return void res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': `attachment; filename="${name}"`,
      ...(kind === 'files' ? { 'Accept-Ranges': 'bytes' } : {}),
    };
    if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(m ? 206 : 200, headers);

    let pos = start;
    const delay = (PIECE / rate) * 1000;
    const pump = () => {
      if (res.destroyed) return;
      if (pos > end) return void res.end();
      const n = Math.min(PIECE, end - pos + 1);
      const chunk = fill(Buffer.allocUnsafe(n), pos);
      pos += n;
      const next = () => setTimeout(pump, delay);
      if (res.write(chunk)) next();
      else res.once('drain', next);
    };
    pump();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`test server on http://127.0.0.1:${PORT}/files/sample.zip?mb=100`));
