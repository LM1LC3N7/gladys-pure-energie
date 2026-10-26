// Generates cover.png (800x534) for gladys-pure-energie: plain Node, no
// dependency. An electricity meter with its display, a small meter reader
// plugged on its P1 port by a cable, Wi-Fi arcs, a sun, and a power curve
// crossing zero (consumption above, injection below), on a gradient (no
// brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.7 + (y / H) * 0.3;
  return [60 + 40 * t, 150 - 90 * t, 220 - 110 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [28, 38, 64];
const sun = [255, 200, 50];
const green = [90, 210, 130];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 270, 260, white, 0.05);

// The electricity meter, its display and its P1 port.
box(70, 90, 300, 450, 24, white);
box(100, 130, 270, 205, 8, dark);
for (let k = 0; k < 5; k += 1) {
  box(112 + k * 31, 147, 134 + k * 31, 188, 4, green, 0.9);
}
disc(185, 260, 10, [255, 90, 90]);
for (let k = 0; k < 4; k += 1) {
  disc(110 + k * 50, 410, 12, [120, 128, 145]);
}
box(240, 320, 285, 350, 4, dark);

// The cable to the meter reader, a small box with a status light.
line(262, 335, 360, 335, 7, dark);
line(360, 335, 360, 390, 7, dark);
box(320, 380, 440, 450, 14, white);
disc(420, 400, 7, green);

// Wi-Fi arcs above the meter reader.
for (const r of [30, 52, 74]) {
  for (let a = -0.75; a <= 0.75; a += 0.01) {
    const x = 380 + r * Math.sin(a);
    const y = 365 - r * Math.cos(a);
    disc(x, y, 3.2, white);
  }
}

// The sun (injection).
disc(660, 95, 34, sun);
for (let k = 0; k < 8; k += 1) {
  const a = (k * Math.PI) / 4;
  line(
    660 + 46 * Math.cos(a),
    95 + 46 * Math.sin(a),
    660 + 62 * Math.cos(a),
    95 + 62 * Math.sin(a),
    6,
    sun,
  );
}

// A screen with the signed power: above the line, consumption; below, injection.
box(480, 170, 740, 440, 16, white);
box(500, 190, 720, 420, 8, dark);
line(510, 305, 710, 305, 2, [120, 128, 145]);
let previous;
for (let x = 512; x <= 708; x += 2) {
  const t = (x - 512) / 196;
  const y = 305 - 85 * Math.cos(2 * Math.PI * t) + 20 * Math.sin(9 * Math.PI * t);
  const color = y > 305 ? sun : green;
  if (previous) line(previous[0], previous[1], x, y, 5, color);
  previous = [x, y];
}
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
