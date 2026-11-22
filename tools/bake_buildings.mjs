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
//  - leaves out the footprints that data/landmarks.json's famous buildings replace
//    (tools/bake_landmarks.py) and anything standing mostly on the water the map draws
//    (houseboats, kiosks on piers, boathouses: their decks and hulls are not drawn)
//  - against flicker (two surfaces in the same place): leaves out footprints that duplicate a
//    delivery home, gives touching or overlapping buildings different small height levels (so no
//    two neighbouring roofs share a plane) and flags walls shared with a neighbour (no parapet or
//    door there: they would coincide with the neighbour's)
// The delivery homes go to data/homes.json (never simplified), with their level and shared walls.
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

// Water as the 3D ground paints it: one canvas path of all water rings filled with the nonzero
// rule, so islands and filled-in harbours (rings wound the other way) are land. A point is on
// water when the rings' winding number around it is not zero.
const waterEdges = new Map(), BAND = 40;               // horizontal bands of edges, 40 units tall
for (const w of town.water) {
  for (let i = 0; i < w.length; i += 2) {
    const j = (i + 2) % w.length, ax = w[i], ay = w[i + 1], bx = w[j], by = w[j + 1];
    if (ay === by) continue;
    for (let band = Math.floor(Math.min(ay, by) / BAND); band <= Math.floor(Math.max(ay, by) / BAND); band++) {
      if (!waterEdges.has(band)) waterEdges.set(band, []);
      waterEdges.get(band).push([ax, ay, bx, by]);
    }
  }
}
function onWater(x, y) {
  let winding = 0;
  for (const [ax, ay, bx, by] of waterEdges.get(Math.floor(y / BAND)) || []) {
    if ((ay <= y) === (by <= y)) continue;
    const cross = ax + (y - ay) / (by - ay) * (bx - ax);
    if (cross > x) winding += by > ay ? 1 : -1;
  }
  return winding !== 0;
}
// share of a footprint on water: its centre and points between the centre and each corner
function wetShare(ring) {
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  const samples = [[cx, cy], ...ring.map(([x, y]) => [cx + (x - cx) * .7, cy + (y - cy) * .7]), ...ring.map(([x, y]) => [cx + (x - cx) * .3, cy + (y - cy) * .3])];
  return samples.filter(([x, y]) => onWater(x + .5, y + .5)).length / samples.length;
}
const landmarks = fs.existsSync(path.join(ROOT, 'data', 'landmarks.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'landmarks.json'), 'utf8')) : { sites: [] };
const replaced = new Set(landmarks.sites.flatMap(site => site.replaces || []));

// ---- footprint geometry helpers (1e5-degree ints; distances in those units, ~1 m each) -------
const sq = Math.cos((b1 + b3) / 2 / 1e5 * Math.PI / 180);
const toM = ([x, y]) => [x * sq, y];                    // metric-ish plane for distances
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) c = !c;
  }
  return c;
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const ringDist = (p, ring) => { let d = Infinity; for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(p, ring[i], ring[(i + 1) % ring.length])); return d; };
function samples(ring) {                                 // centre plus points 30% and 70% out to each corner
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  return [[cx, cy], ...ring.flatMap(([x, y]) => [[cx + (x - cx) * .3, cy + (y - cy) * .3], [cx + (x - cx) * .7, cy + (y - cy) * .7]])];
}
const share = (a, b) => { const s = samples(a); return s.filter(p => inside(p, b)).length / s.length; };
const areaOf = ring => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return Math.abs(a / 2); };
const homeRings = extra.homes.map(h => { const r = []; for (let i = 0; i < h.ring.length; i += 2) r.push(toM([h.ring[i], h.ring[i + 1]])); return r; });
const homeBoxes = homeRings.map(r => [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))]);

const stores = new Set(game.meta.players.filter(p => p.store?.footprint).map(p => p.store.footprint.ring.join(',')));
const table = list => { const index = new Map(list.map((v, i) => [v, i])); return v => { if (!index.has(v)) { index.set(v, list.length); list.push(v); } return index.get(v); }; };
const types = [], roofs = [''], colours = [''];
const typeOf = table(types), roofOf = table(roofs), colourOf = table(colours);

const items = [];
let dropped = 0, wet = 0, landmarked = 0, duplicates = 0;
extra.buildings.forEach((b, id) => {
  if (stores.has(b.slice(1).join(','))) { dropped++; return; }
  if (replaced.has(id)) { landmarked++; return; }
  const raw = [];
  for (let i = 1; i < b.length; i += 2) raw.push([b[i], b[i + 1]]);
  if (wetShare(raw) >= .5) { wet++; return; }
  // a background footprint in the same place as a delivery home: the home is drawn, not both
  const m = raw.map(toM), box = [Math.min(...m.map(p => p[0])), Math.min(...m.map(p => p[1])), Math.max(...m.map(p => p[0])), Math.max(...m.map(p => p[1]))];
  for (let h = 0; h < homeRings.length; h++) {
    const hb = homeBoxes[h];
    if (hb[0] > box[2] || hb[2] < box[0] || hb[1] > box[3] || hb[3] < box[1]) continue;
    if (share(m, homeRings[h]) >= .5 || (share(homeRings[h], m) >= .8 && areaOf(m) < 3 * areaOf(homeRings[h]))) { duplicates++; return; }
  }
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

// ---- neighbours: touching (walls within 0.6 units) or overlapping footprints, homes included ----
const nodes = [...items.map(it => it.ring.map(toM)), ...homeRings];
const CELL = 60, grid = new Map(), boxes = nodes.map(r => [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))]);
boxes.forEach((b, i) => {
  for (let gx = Math.floor(b[0] / CELL); gx <= Math.floor(b[2] / CELL); gx++)
    for (let gy = Math.floor(b[1] / CELL); gy <= Math.floor(b[3] / CELL); gy++) {
      const k = gx * 1e6 + gy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
});
const TOUCH = .6, neighbours = nodes.map(() => []), sharedEdge = nodes.map(r => new Uint8Array(r.length));
for (let i = 0; i < nodes.length; i++) {
  const b = boxes[i], seen = new Set();
  for (let gx = Math.floor((b[0] - TOUCH) / CELL); gx <= Math.floor((b[2] + TOUCH) / CELL); gx++)
    for (let gy = Math.floor((b[1] - TOUCH) / CELL); gy <= Math.floor((b[3] + TOUCH) / CELL); gy++)
      for (const j of grid.get(gx * 1e6 + gy) || []) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        const c = boxes[j];
        if (c[0] > b[2] + TOUCH || c[2] < b[0] - TOUCH || c[1] > b[3] + TOUCH || c[3] < b[1] - TOUCH) continue;
        const A = nodes[i], B = nodes[j];
        const near = A.some(p => inside(p, B) || ringDist(p, B) < TOUCH) || B.some(p => inside(p, A) || ringDist(p, A) < TOUCH);
        if (!near) continue;
        neighbours[i].push(j); neighbours[j].push(i);
        // walls lying along the other's wall (three points on each edge within the touch distance)
        const mark = (R, S, flags) => R.forEach((p, e) => {
          const q = R[(e + 1) % R.length], on = t => ringDist([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], S) < TOUCH;
          if (on(.2) && on(.5) && on(.8)) flags[e] = 1;
        });
        mark(A, B, sharedEdge[i]); mark(B, A, sharedEdge[j]);
      }
}
// greedy colouring: neighbours get different levels (0..7), each level 6 cm higher
const level = new Uint8Array(nodes.length);
for (let i = 0; i < nodes.length; i++) {
  const used = new Set(neighbours[i].filter(j => j < i).map(j => level[j]));
  let l = 0;
  while (used.has(l) && l < 7) l++;
  level[i] = l;
}
const homeLevel = Array.from(level.subarray(items.length)), homeShared = sharedEdge.slice(items.length);

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
add('level', 'Uint8', count);
add('edge', 'Uint8', points);
const body = new ArrayBuffer(Math.ceil(offset / 4) * 4);
const view = Object.fromEntries(layout.map(l => [l.name, new globalThis[l.type + 'Array'](body, l.offset, l.length)]));
let d = 0, e = 0;
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
  view.level[i] = level[i];
  for (let k = 0; k < it.ring.length; k++) view.edge[e++] = sharedEdge[i][k];
});

// fingerprint of the inputs, so tools/check_preview.py can tell when the bake is stale
const source = crypto.createHash('sha256');
for (const file of ['buildings.json', 'game-map.json', 'game.json', 'landmarks.json']) if (fs.existsSync(path.join(ROOT, 'data', file))) source.update(fs.readFileSync(path.join(ROOT, 'data', file)));
const header = { format: 'grocery-bot-buildings/1', source: source.digest('hex').slice(0, 16), attribution: extra.attribution, bounds: town.bounds, grid: GRID,
  count, points, chunks, types, roofs, colours, layout };
let json = Buffer.from(JSON.stringify(header));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const lead = Buffer.alloc(4);
lead.writeUInt32LE(json.length);
fs.writeFileSync(path.join(ROOT, 'data', 'buildings.bin'), Buffer.concat([lead, json, Buffer.from(body)]));
fs.writeFileSync(path.join(ROOT, 'data', 'homes.json'), JSON.stringify({ attribution: extra.attribution,
  homes: extra.homes.map((h, i) => ({ ...h, level: homeLevel[i], shared: Array.from(homeShared[i]) })) }));

const rawPoints = extra.buildings.reduce((n, b) => n + (b.length - 1) / 2, 0);
console.log(`neighbours: ${neighbours.reduce((n, l) => n + l.length, 0) / 2} touching/overlapping pairs, ${sharedEdge.reduce((n, f) => n + f.reduce((a, b) => a + b, 0), 0)} shared walls, ` +
  `levels used ${Math.max(...level) + 1}`);
console.log(`buildings.bin: ${count} buildings (${dropped} store/degenerate, ${landmarked} replaced by landmarks, ${wet} on water, ${duplicates} duplicating a home left out), ` +
  `${points} corners (${rawPoints} before simplifying), ${(4 + json.length + body.byteLength) / 1e6} MB; ` +
  `chunk sizes ${Math.min(...chunks.map(c => c[1]))}-${Math.max(...chunks.map(c => c[1]))}; homes.json: ${extra.homes.length} homes`);
