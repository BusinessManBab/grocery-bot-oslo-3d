// Where the forest grows, shared by the 2D map (green under the trees) and the 3D view.
// Trees go on OSM woodland and on empty land away from town. Dense Oslo has thousands
// of open/wood polygons, so all exclusion tests are rasterized once instead of testing
// every candidate against every polygon.
export const FOREST_STEP = 11;
export const FOREST_MAX = 22000;

function areaPath(list, wx, wy) {
  const path = new Path2D();
  for (const p of list) {
    path.moveTo(wx(p[0]), wy(p[1]));
    for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1]));
    path.closePath();
  }
  return path;
}

function rasterGrid({ X0, Z0, W, D, cell, draw }) {
  const cols = Math.ceil(W / cell), rows = Math.ceil(D / cell);
  const canvas = document.createElement('canvas');
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -X0 / cell, -Z0 / cell);
  draw(g);
  const pixels = g.getImageData(0, 0, cols, rows).data;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 24 ? 1 : 0;
  return { cols, rows, mask, cell };
}

/** Returns [[x, z, scale, spin, isSpruce]] in the same map-unit space as both views. */
export function plantForest({ town, buildings, cover, shops = [], wx, wy, plaza = 110 }) {
  const [b0, b1, b2, b3] = town.bounds;
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1), W = X1 - X0, D = Z1 - Z0;
  const base = { X0, Z0, W, D };
  const test = (grid, x, z) => {
    const c = Math.floor((x - X0) / grid.cell), r = Math.floor((z - Z0) / grid.cell);
    return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.mask[r * grid.cols + c] === 1;
  };
  const water = rasterGrid({ ...base, cell: 6, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(town.water || [], wx, wy)); } });
  const parks = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(town.green || [], wx, wy)); } });
  const wood = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(cover.wood || [], wx, wy)); } });
  const open = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(cover.open || [], wx, wy)); } });
  const blocked = rasterGrid({ ...base, cell: 4, draw: g => {
    g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = 28; g.lineCap = g.lineJoin = 'round';
    for (const kind of ['lane', 'street', 'major']) {
      const path = new Path2D();
      for (const line of town.roads[kind] || []) {
        path.moveTo(wx(line[0]), wy(line[1]));
        for (let i = 2; i < line.length; i += 2) path.lineTo(wx(line[i]), wy(line[i + 1]));
      }
      g.stroke(path);
    }
    const footprints = new Path2D();
    for (const b of buildings) {
      footprints.moveTo(wx(b[1]), wy(b[2]));
      for (let i = 3; i < b.length; i += 2) footprints.lineTo(wx(b[i]), wy(b[i + 1]));
      footprints.closePath();
    }
    g.fill(footprints); g.lineWidth = 20; g.stroke(footprints);
    for (const [x, z] of shops) { g.beginPath(); g.arc(x, z, plaza, 0, Math.PI * 2); g.fill(); }
  } });
  // "Town" is ~35 m around buildings; one thicker stroke of all footprints is much
  // cheaper than marking every footprint corner into an array.
  const near = rasterGrid({ ...base, cell: 8, draw: g => {
    g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = 70; g.lineJoin = 'round';
    const footprints = new Path2D();
    for (const b of buildings) {
      footprints.moveTo(wx(b[1]), wy(b[2]));
      for (let i = 3; i < b.length; i += 2) footprints.lineTo(wx(b[i]), wy(b[i + 1]));
      footprints.closePath();
    }
    g.fill(footprints); g.stroke(footprints);
  } });

  let seed = 23;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wet = (x, z) => test(water, x, z) || test(water, x + 8, z) || test(water, x - 8, z) || test(water, x, z + 8) || test(water, x, z - 8);
  const spots = [];
  for (let z = Z0 + FOREST_STEP / 2; z < Z1 && spots.length < FOREST_MAX; z += FOREST_STEP) {
    for (let x = X0 + FOREST_STEP / 2; x < X1; x += FOREST_STEP) {
      const px = x + (rand() - .5) * FOREST_STEP * .9, pz = z + (rand() - .5) * FOREST_STEP * .9;
      if (px < X0 + 3 || px > X1 - 3 || pz < Z0 + 3 || pz > Z1 - 3) continue;
      if (test(blocked, px, pz) || wet(px, pz)) continue;
      const mapped = test(wood, px, pz);
      if (!mapped && (test(near, px, pz) || test(open, px, pz) || test(parks, px, pz))) continue;
      if (rand() > (mapped ? .85 : .7)) continue;
      spots.push([px, pz, .8 + rand() * .7, rand(), rand() < .78]);
    }
  }
  return spots;
}

/** The green the 2D map paints under the trees: one round blob per tree. */
export function forestPath(spots, radius = 9) {
  const path = new Path2D();
  for (const [x, z] of spots) { path.moveTo(x + radius, z); path.arc(x, z, radius, 0, Math.PI * 2); }
  return path;
}
