// Bakes data/buildings.json into data/buildings.bin, the compact file the 3D view streams.
//
//   node tools/bake_buildings.mjs
//
// What it does once, offline, instead of in every visitor's browser:
//  - drops the footprints that the twelve shop models replace (the real store buildings)
//  - removes background wall jogs (the same tolerance rule the 3D view used at load time)
//  - sorts the buildings into a 6 x 6 grid of chunks, so the view can build them in parallel,
//    nearest first, and the GPU can skip chunks that are off screen
//  - stores rings as an int32 first point plus int16 deltas (1e-5 degree units), ~7x smaller
//    than the JSON and readable without parsing
// The delivery homes go to data/homes.json unchanged (they are never simplified).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
const GRID = 6;

const extra = read('buildings.json');
const town = read('game-map.json');
const game = read('game.json');
const [b0, b1, b2, b3] = town.bounds;
const origin = [(b0 + b2) / 2, (b1 + b3) / 2];
const squash = Math.cos(origin[1] / 1e5 * Math.PI / 180);
const wx = lon => (lon - origin[0]) * squash;
const wy = lat => -(lat - origin[1]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Same rule as the former contextOutline() in src/view3d.js: drop a corner when it lies within
// 1.5 m (2.5 m beyond 2.6 km of the centre) of the line between its neighbours.
function outline(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const sq = Math.cos((b1 + b3) / 2 / 1e5 * Math.PI / 180);
  const tolerance = Math.hypot(wx(flat[0]) - wx(1075100), wy(flat[1]) - wy(5992100)) > 2600 ? 2.5 : 1.5;
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      const dx = (b[0] - a[0]) * sq, dy = b[1] - a[1], px = (p[0] - a[0]) * sq, py = p[1] - a[1];
      const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy || 1), 0, 1);
      if (Math.hypot(px - t * dx, py - t * dy) * 1.113 <= tolerance) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // a closing point equal to the first one, or repeated corners, add nothing but empty walls
  const out = [];
  for (const p of pts) if (!out.length || p[0] !== out[out.length - 1][0] || p[1] !== out[out.length - 1][1]) out.push(p);
  while (out.length > 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

const stores = new Set(game.meta.players.filter(p => p.store?.footprint).map(p => p.store.footprint.ring.join(',')));
const table = list => { const index = new Map(list.map((v, i) => [v, i])); return v => { if (!index.has(v)) { index.set(v, list.length); list.push(v); } return index.get(v); }; };
const types = [], roofs = [''], colours = [''];
const typeOf = table(types), roofOf = table(roofs), colourOf = table(colours);

const items = [];
let dropped = 0;
extra.buildings.forEach((b, id) => {
  if (stores.has(b.slice(1).join(','))) { dropped++; return; }
  const ring = outline(b.slice(1));
  if (ring.length < 3) { dropped++; return; }
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  const col = clamp(Math.floor((cx - b0) / (b2 - b0) * GRID), 0, GRID - 1);
  const row = clamp(Math.floor((b3 - cy) / (b3 - b1) * GRID), 0, GRID - 1);
  const [type = 'yes', roof = '', wall = '', roofColour = ''] = extra.info?.[id] || [];
  items.push({ id, chunk: row * GRID + col, ring, h: clamp(Math.round(b[0]), 1, 255),
    type: typeOf(type), roof: roofOf(roof), wall: colourOf(wall), roofColour: colourOf(roofColour) });
});
if (extra.buildings.length > 65535) throw new Error('ids no longer fit in uint16');
if (types.length > 255 || roofs.length > 255 || colours.length > 255) throw new Error('tag tables no longer fit in uint8');
items.sort((p, q) => p.chunk - q.chunk || p.id - q.id);

const count = items.length, points = items.reduce((n, it) => n + it.ring.length, 0);
const chunks = Array.from({ length: GRID * GRID }, () => [0, 0]);
items.forEach((it, i) => { const c = chunks[it.chunk]; if (!c[1]) c[0] = i; c[1]++; });

// layout: [u32 header bytes][header JSON, padded to 4][arrays at the offsets listed in the header]
const layout = [];
let offset = 0;
const add = (name, type, length) => {
  const size = { Int32: 4, Uint16: 2, Int16: 2, Uint8: 1 }[type];
  offset = Math.ceil(offset / 4) * 4;
  layout.push({ name, type, length, offset });
  offset += size * length;
};
add('first', 'Int32', count * 2);
add('delta', 'Int16', (points - count) * 2);
add('id', 'Uint16', count);
add('points', 'Uint16', count);
add('height', 'Uint8', count);
add('type', 'Uint8', count);
add('roof', 'Uint8', count);
add('wall', 'Uint8', count);
add('roofColour', 'Uint8', count);
const body = new ArrayBuffer(Math.ceil(offset / 4) * 4);
const view = Object.fromEntries(layout.map(l => [l.name, new globalThis[l.type + 'Array'](body, l.offset, l.length)]));
let d = 0;
items.forEach((it, i) => {
  view.first[i * 2] = it.ring[0][0];
  view.first[i * 2 + 1] = it.ring[0][1];
  for (let k = 1; k < it.ring.length; k++) {
    const dx = it.ring[k][0] - it.ring[k - 1][0], dy = it.ring[k][1] - it.ring[k - 1][1];
    if (Math.abs(dx) > 32767 || Math.abs(dy) > 32767) throw new Error(`building ${it.id}: edge too long for int16`);
    view.delta[d++] = dx; view.delta[d++] = dy;
  }
  view.id[i] = it.id;
  view.points[i] = it.ring.length;
  view.height[i] = it.h;
  view.type[i] = it.type;
  view.roof[i] = it.roof;
  view.wall[i] = it.wall;
  view.roofColour[i] = it.roofColour;
});

// fingerprint of the inputs, so tools/check_preview.py can tell when the bake is stale
const source = crypto.createHash('sha256');
for (const file of ['buildings.json', 'game-map.json', 'game.json']) source.update(fs.readFileSync(path.join(ROOT, 'data', file)));
const header = { format: 'grocery-bot-buildings/1', source: source.digest('hex').slice(0, 16), attribution: extra.attribution, bounds: town.bounds, grid: GRID,
  count, points, chunks, types, roofs, colours, layout };
let json = Buffer.from(JSON.stringify(header));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const lead = Buffer.alloc(4);
lead.writeUInt32LE(json.length);
fs.writeFileSync(path.join(ROOT, 'data', 'buildings.bin'), Buffer.concat([lead, json, Buffer.from(body)]));
fs.writeFileSync(path.join(ROOT, 'data', 'homes.json'), JSON.stringify({ attribution: extra.attribution, homes: extra.homes }));

const rawPoints = extra.buildings.reduce((n, b) => n + (b.length - 1) / 2, 0);
console.log(`buildings.bin: ${count} buildings (${dropped} store/degenerate footprints dropped), ` +
  `${points} corners (${rawPoints} before simplifying), ${(4 + json.length + body.byteLength) / 1e6} MB; ` +
  `chunk sizes ${Math.min(...chunks.map(c => c[1]))}-${Math.max(...chunks.map(c => c[1]))}; homes.json: ${extra.homes.length} homes`);
