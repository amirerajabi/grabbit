// Renders the Grabbit mark (same artwork as ui/public/favicon.svg) to icon.png, tray.png and icon.ico without any
// image library: signed-distance shapes, 4x4 supersampling, a hand-written PNG encoder and an ICO that embeds PNGs.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const TILE_TOP = hex('#24345e');
const TILE_BOTTOM = hex('#0b1430');
const ROW = hex('#5a6e9e');
const LIT_A = hex('#ffc54d');
const LIT_B = hex('#ff6a5c');

function roundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segment(x, y, ax, ay, bx, by, halfWidth) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const h = clamp01((px * dx + py * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - dx * h, py - dy * h) - halfWidth;
}

const lit = (x, y) => mix(LIT_A, LIT_B, clamp01((x + y - 14) / 22));

/** Layers in the 32x32 artwork space: [distance fn, colour fn]. */
const LAYERS = [
  [(x, y) => roundRect(x, y, 0, 0, 32, 32, 7), (_x, y) => mix(TILE_TOP, TILE_BOTTOM, y / 32)],
  [(x, y) => roundRect(x, y, 7, 8, 25, 11, 1.5), () => ROW],
  [(x, y) => roundRect(x, y, 7, 13, 19, 16, 1.5), lit],
  [(x, y) => Math.min(segment(x, y, 16, 15, 16, 23, 1.3), segment(x, y, 12, 19, 16, 23, 1.3), segment(x, y, 16, 23, 20, 19, 1.3)), lit],
];

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const x = ((i + (si + 0.5) / S) / size) * 32;
          const y = ((j + (sj + 0.5) / S) / size) * 32;
          let c = null;
          for (const [dist, colour] of LAYERS) if (dist(x, y) <= 0) c = colour(x, y);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const o = (j * size + i) * 4;
      if (a > 0) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
        px[o + 3] = Math.round((a / (S * S)) * 255);
      }
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const v of buf) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: png(s) }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ s, data }, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

writeFileSync(join(here, 'icon.png'), png(512));
writeFileSync(join(here, 'tray.png'), png(32));
writeFileSync(join(here, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('icons written to', here);
