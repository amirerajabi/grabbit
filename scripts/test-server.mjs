// Local file server for trying Grabbit without the internet: Range support, a per-connection speed cap and a few
// misbehaving endpoints. `node scripts/test-server.mjs` then add e.g. http://127.0.0.1:7400/files/ubuntu.iso?mb=200
//
//   /files/<name>?mb=N&kbps=K   N MB of deterministic bytes, K KB/s per connection (default 100 MB, 800 KB/s)
//   /norange/<name>?mb=N        same, but ignores Range (single connection, cannot resume)
//   /redirect/<name>            302 to /files/<name>
//   /expired/<name>             403 (a link that expired)
//   /auth/<name>?mb=N           same as /files, behind a Basic login (demo / demo)
//   /page                       an HTML page with file and navigation links (for the extension's "all links")
import http from 'node:http';
import { startFtpServer } from './ftp-test-server.mjs';

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
    if (kind === 'page') {
      // A page to try the extension's "Download all links": file links mixed with ordinary navigation links.
      const files = ['setup.exe', 'album.zip', 'manual.pdf', 'trailer.mp4', 'song.mp3'];
      const links = files.map((f) => `<li><a href="/files/${f}?mb=4">${f}</a></li>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return void res.end(`<!doctype html><title>Grabbit test page</title><h1>Test downloads</h1><ul>${links}</ul><p><a href="/page?about">About</a> · <a href="https://example.com/">Elsewhere</a></p>`);
    }
    if (kind === 'auth') {
      // A file behind a login (HTTP Basic, user "demo", password "demo"), for Options → Site logins.
      if (req.headers.authorization !== `Basic ${Buffer.from('demo:demo').toString('base64')}`) {
        return void res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Grabbit test files"' }).end('Login required');
      }
    } else if (kind === 'redirect') {
      return void res.writeHead(302, { Location: `/files/${encodeURIComponent(name)}${url.search}` }).end();
    }
    if (kind === 'expired') return void res.writeHead(403).end('Link expired');
    if (kind !== 'files' && kind !== 'norange' && kind !== 'auth') return void res.writeHead(404).end('Not found');

    const size = Math.round(Number(url.searchParams.get('mb') ?? 100) * 1024 * 1024);
    const rate = Number(url.searchParams.get('kbps') ?? 800) * 1024;
    const ranged = kind === 'files' || kind === 'auth';
    const m = ranged ? /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '') : null;
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) return void res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': `attachment; filename="${name}"`,
      ...(ranged ? { 'Accept-Ranges': 'bytes' } : {}),
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

// FTP next to it, anonymous, capped at 2 MB/s per connection: ftp://127.0.0.1:7421/pub/sample-100mb.zip
const FTP_PORT = Number(process.env.FTP_PORT ?? 7421);
startFtpServer({ port: FTP_PORT, kbps: 2048 }).then(({ port }) => console.log(`ftp server on ftp://127.0.0.1:${port}/pub/sample-100mb.zip`));
