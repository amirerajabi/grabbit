// A small FTP server for trying and testing Grabbit's FTP downloads: login (or anonymous), binary mode, SIZE, EPSV/PASV,
// REST (resume) and RETR, with a speed cap per connection. Files are generated like the HTTP test server's:
// a name with "-<N>mb" in it serves N MB of deterministic bytes ("RETR /big-50mb.iso"; FTP paths have no query string).
import net from 'node:net';

function byteAt(i) {
  return (i * 2654435761) >>> 24;
}

/** Size in bytes for a path like "/name-3mb.bin" (default 20 MB), or null for a path that "doesn't exist". */
function sizeOf(p) {
  if (/missing/.test(p)) return null;
  const mb = Number(/-([\d.]+)mb\b/i.exec(p)?.[1] ?? 20);
  return Math.round(mb * 1024 * 1024);
}

/**
 * startFtpServer({ port = 0, user, pass, kbps }) → { server, port, stats }.
 * Without `user`, any login (including anonymous) is accepted. `kbps` caps each data connection.
 */
export function startFtpServer({ port = 0, user, pass, kbps = 0 } = {}) {
  const stats = { logins: 0, retrieves: 0, rests: 0 };
  const server = net.createServer((ctl) => {
    ctl.setEncoding('utf8');
    let name = null;
    let authed = false;
    let rest = 0;
    let pasv = null; // { server, socket promise }
    const reply = (s) => ctl.write(`${s}\r\n`);
    ctl.on('error', () => undefined);
    reply('220 Grabbit test FTP server');

    const openPassive = () => {
      pasv?.server.close();
      let resolveSock;
      const sockP = new Promise((r) => (resolveSock = r));
      const ds = net.createServer((s) => {
        s.on('error', () => undefined);
        resolveSock(s);
        ds.close();
      });
      ds.listen(0, '127.0.0.1');
      pasv = { server: ds, sock: sockP };
      return new Promise((r) => ds.once('listening', () => r(ds.address().port)));
    };

    let buf = '';
    ctl.on('data', async (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const sp = line.indexOf(' ');
        const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
        const arg = sp < 0 ? '' : line.slice(sp + 1);
        if (cmd === 'USER') {
          name = arg;
          reply('331 Password please');
        } else if (cmd === 'PASS') {
          if (!user || (name === user && arg === pass)) {
            authed = true;
            stats.logins++;
            reply('230 Logged in');
          } else {
            reply('530 Login incorrect');
          }
        } else if (cmd === 'QUIT') {
          reply('221 Bye');
          ctl.end();
        } else if (!authed) {
          reply('530 Please log in');
        } else if (cmd === 'TYPE' || cmd === 'OPTS') {
          reply('200 OK');
        } else if (cmd === 'PWD') {
          reply('257 "/"');
        } else if (cmd === 'FEAT') {
          ctl.write('211-Features\r\n SIZE\r\n REST STREAM\r\n EPSV\r\n211 End\r\n');
        } else if (cmd === 'SIZE') {
          const n = sizeOf(arg);
          reply(n === null ? '550 No such file' : `213 ${n}`);
        } else if (cmd === 'REST') {
          rest = Number(arg) || 0;
          stats.rests++;
          reply(`350 Restarting at ${rest}`);
        } else if (cmd === 'EPSV') {
          reply(`229 Entering Extended Passive Mode (|||${await openPassive()}|)`);
        } else if (cmd === 'PASV') {
          const p = await openPassive();
          reply(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})`);
        } else if (cmd === 'RETR') {
          const n = sizeOf(arg);
          if (n === null || !pasv) {
            reply('550 No such file');
            continue;
          }
          stats.retrieves++;
          const start = rest;
          rest = 0;
          reply('150 Opening BINARY data connection');
          const s = await pasv.sock;
          pasv = null;
          let pos = start;
          const piece = 16 * 1024;
          const delay = kbps ? (piece / (kbps * 1024)) * 1000 : 0;
          const pump = () => {
            if (s.destroyed) return;
            if (pos >= n) {
              s.end(() => reply('226 Transfer complete'));
              return;
            }
            const len = Math.min(piece, n - pos);
            const chunk = Buffer.allocUnsafe(len);
            for (let k = 0; k < len; k++) chunk[k] = byteAt(pos + k);
            pos += len;
            const next = () => (delay ? setTimeout(pump, delay) : setImmediate(pump));
            if (s.write(chunk)) next();
            else s.once('drain', next);
          };
          s.on('close', () => {
            if (pos < n) reply('426 Transfer aborted');
          });
          pump();
        } else if (cmd === 'ABOR') {
          reply('226 Aborted');
        } else {
          reply('502 Not implemented');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, stats })));
}

export { byteAt };
