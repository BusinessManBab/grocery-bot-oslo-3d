// Removes trees whose crown would stand inside or poke into a building: delivery homes (the forest
// planting never excluded them), landmarks (they were added after the trees were planted) and the
// background buildings. Pure geometry, no browser.
//
//   node tools/tree_clearance.mjs        re-clear data/trees.bin in place (tools/bake_trees.cjs also runs it)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
// files the trees depend on (planting inputs + what they are cleared against)
export const TREE_SOURCES = ['game-map.json', 'buildings.json', 'landcover.json', 'game.json', 'homes.json', 'landmarks.json'];
export function treeSource() {
  const hash = crypto.createHash('sha256');
  for (const file of TREE_SOURCES) hash.update(fs.readFileSync(path.join(ROOT, 'data', file)));
  return hash.digest('hex').slice(0, 16);
}

// crown radius per tree kind, in world units at scale 1 (src/view3d.js plants these shapes)
const CROWN = { spruce: 4.4, birch: 5, park: 6 };

export function clearTrees({ forest, parks }) {
  const town = read('game-map.json'), extra = read('buildings.json'), homes = read('homes.json').homes;
  const landmarks = fs.existsSync(path.join(ROOT, 'data', 'landmarks.json')) ? read('landmarks.json').sites : [];
  const [b0, b1, b2, b3] = town.bounds, origin = [(b0 + b2) / 2, (b1 + b3) / 2], sq = Math.cos(origin[1] / 1e5 * Math.PI / 180);
  const wx = lon => (lon - origin[0]) * sq, wy = lat => -(lat - origin[1]);
  const shapes = [], CELL = 50, grid = new Map();
  const add = flat => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push([wx(flat[i]), wy(flat[i + 1])]);
    if (pts.length < 3) return;
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const s = { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }, i = shapes.push(s) - 1;
    for (let gx = Math.floor(s.box[0] / CELL); gx <= Math.floor(s.box[2] / CELL); gx++)
      for (let gz = Math.floor(s.box[1] / CELL); gz <= Math.floor(s.box[3] / CELL); gz++) {
        const k = gx * 100000 + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  };
  for (const b of extra.buildings) add(b.slice(1));
  for (const h of homes) add(h.ring);
  for (const site of landmarks) {
    for (const p of site.parts || []) add(p.rings[0]);
    for (const o of site.outline || []) add(o);
    if (site.id === 'monolitten') {                       // the stepped plinth, 24 m in radius
      const [cx, cy] = site.frame.center, r = 26 / 1.113;
      add(Array.from({ length: 24 }, (_, i) => [cx + Math.cos(i / 24 * Math.PI * 2) * r / sq, cy + Math.sin(i / 24 * Math.PI * 2) * r]).flat());
    }
  }
  // true when a circle (x, z, r) is inside or touches any footprint
  function blocked(x, z, r) {
    const seen = new Set();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
        for (const i of grid.get(gx * 100000 + gz) || []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const s = shapes[i];
          if (x < s.box[0] - r || x > s.box[2] + r || z < s.box[1] - r || z > s.box[3] + r) continue;
          let inside = false;
          for (let a = 0, b = s.pts.length - 1; a < s.pts.length; b = a++) {
            const [ax, az] = s.pts[a], [bx, bz] = s.pts[b];
            if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
            const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
            if (Math.hypot(x - ax - t * dx, z - az - t * dz) < r) return true;
          }
          if (inside) return true;
        }
    return false;
  }
  const keep = (list, crown) => list.filter(t => !blocked(t[0], t[1], crown(t) * t[2] + 1));
  const outForest = keep(forest, t => (t[4] ? CROWN.spruce : CROWN.birch)), outParks = keep(parks, () => CROWN.park);
  return { forest: outForest, parks: outParks, removed: forest.length - outForest.length + parks.length - outParks.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { packTrees, unpackTrees } = await import(pathToFileURL(path.join(ROOT, 'src', 'forest.js')).href);
  const file = path.join(ROOT, 'data', 'trees.bin'), buf = fs.readFileSync(file);
  const trees = unpackTrees(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const cleared = clearTrees(trees);
  fs.writeFileSync(file, Buffer.from(packTrees({ forest: cleared.forest, parks: cleared.parks, source: treeSource() })));
  console.log(`trees.bin: removed ${cleared.removed} trees standing in or against buildings; ${cleared.forest.length} forest + ${cleared.parks.length} park trees`);
}
