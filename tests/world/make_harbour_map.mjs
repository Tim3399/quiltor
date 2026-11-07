// Draws harbour-map.png, the picture behind the example world's city level.
//
// Drawn from nothing but arithmetic, so it carries no rights of anyone else and the same run
// always gives the same bytes. The map image's id in the world is the SHA-256 of that file.
//
//   node tests/world/make_harbour_map.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const WIDTH = 1200;
const HEIGHT = 800;

const SEA = [176, 202, 214];
const SEA_DEEP = [150, 182, 198];
const LAND = [231, 220, 190];
const LAND_EDGE = [196, 178, 140];
const QUAY = [203, 186, 146];
const ROOF = [214, 197, 160];
const INK = [96, 84, 66];

/** Coast of the harbour: land lies below this line on the left, above the basin on the right. */
function coastY(x) {
  return 250 + 38 * Math.sin(x / 95) + 22 * Math.sin(x / 41 + 1.3);
}

function inBasin(x, y) {
  // A rounded basin cut into the land, the harbour proper.
  const dx = (x - 640) / 250;
  const dy = (y - 560) / 150;
  return dx * dx + dy * dy < 1;
}

function onPier(x, y) {
  return (
    (x > 560 && x < 580 && y > 430 && y < 560) ||
    (x > 700 && x < 718 && y > 470 && y < 600) ||
    (x > 420 && x < 560 && y > 548 && y < 562)
  );
}

function inBlock(x, y) {
  // Rows of houses, left of the basin and along the market square.
  const column = Math.floor((x - 60) / 64);
  const row = Math.floor((y - 330) / 54);
  if (column < 0 || column > 7 || row < 0 || row > 4) return false;
  const localX = (x - 60) % 64;
  const localY = (y - 330) % 54;
  const skip = (column * 3 + row * 5) % 7 === 0;
  return !skip && localX > 8 && localX < 52 && localY > 8 && localY < 42 && x < 560;
}

function noise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
}

function pixel(x, y) {
  const coast = coastY(x);
  let color;
  if (y < coast || inBasin(x, y)) {
    // Water: deeper toward the edges, with faint ripples.
    const depth = Math.min(1, Math.abs(y - coast) / 220 + Math.abs(x - 600) / 1400);
    color = SEA.map((value, index) => value + (SEA_DEEP[index] - value) * depth);
    if (Math.sin(x / 7 + Math.sin(y / 23) * 3 + y / 5) > 0.93) color = color.map((v) => v + 9);
  } else {
    color = LAND;
    if (Math.abs(y - coast) < 3 || Math.abs(distanceToBasin(x, y)) < 0.012) color = LAND_EDGE;
  }
  if (onPier(x, y)) color = QUAY;
  const inMarket = x > 100 && x < 260 && y > 392 && y < 478;
  if (inBlock(x, y) && !inBasin(x, y) && !inMarket) color = (x + y) % 11 === 0 ? INK : ROOF;
  // Market square: an open rectangle with a darker edge.
  if (x > 110 && x < 250 && y > 400 && y < 470) {
    const edge = x < 114 || x > 246 || y < 404 || y > 466;
    color = edge ? LAND_EDGE : LAND;
  }
  // Streets: two long lines across the land.
  if (y >= coast && !inBasin(x, y) && (Math.abs(y - 395) < 2 || Math.abs(x - 340) < 2)) {
    color = LAND_EDGE;
  }
  // Frame.
  if (x < 6 || y < 6 || x >= WIDTH - 6 || y >= HEIGHT - 6) color = INK;
  const grain = Math.floor(noise(x >> 2, y >> 2) * 3) - 1;
  return color.map((value) => Math.max(0, Math.min(255, Math.round(value + grain))));
}

function distanceToBasin(x, y) {
  const dx = (x - 640) / 250;
  const dy = (y - 560) / 150;
  return Math.sqrt(dx * dx + dy * dy) - 1;
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const rowStart = y * (WIDTH * 3 + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw[rowStart + 1 + x * 3] = r;
    raw[rowStart + 2 + x * 3] = g;
    raw[rowStart + 3 + x * 3] = b;
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = join(dirname(fileURLToPath(import.meta.url)), "harbour-map.png");
writeFileSync(target, png);
console.log(`Wrote ${target} (${png.length} bytes)`);
