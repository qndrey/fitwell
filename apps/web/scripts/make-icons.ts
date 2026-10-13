// Generates placeholder PNG icons (no image dependencies). Run: npx tsx scripts/make-icons.ts
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG: [number, number, number] = [0x3d, 0x6b, 0x5c];
const FG: [number, number, number] = [0xfa, 0xf8, 0xf5];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Soft leaf-like disc: a cream circle on sage; `scale` shrinks it for maskable safe zone.
function png(size: number, scale: number): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const r = size * 0.5 * scale;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const a = Math.min(1, Math.max(0, r - d + 0.5));
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i]! * (1 - a) + FG[i]! * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', png(192, 0.62));
writeFileSync('public/icon-512.png', png(512, 0.62));
writeFileSync('public/icon-maskable-512.png', png(512, 0.4));
writeFileSync('public/apple-touch-icon.png', png(180, 0.5));
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d6b5c"/><circle cx="32" cy="32" r="18" fill="#faf8f5"/></svg>\n`,
);
