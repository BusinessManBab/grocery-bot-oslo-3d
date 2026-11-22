// Oslo's famous buildings for the 3D view, from data/landmarks.json (tools/bake_landmarks.py).
// Most are their real OpenStreetMap building parts, each extruded from its own floor to its own
// roof height in its mapped colour (the City Hall's towers, the Royal Palace, the cathedral, the
// 100 m+ towers by Oslo S, Barcode), with a facade that suits it and a few details OSM cannot hold
// (clock faces, the palace portico, castle roofs, the cathedral spire, the museum's light hall).
// Shapes OSM cannot describe are modelled by hand on each building's measured footprint frame:
// the Opera House's marble roof sloping into the fjord, MUNCH's bent top, the Astrup Fearnley
// Museum's sail roofs, the Fram Museum's A-frames and the Vigeland Monolith.
// Everything is merged into one mesh per material: about ten draw calls for all of it.
import * as THREE from 'three';
import { Bucket, linear, quad, tri } from './building-geometry.js?v=20';
import { Earcut } from './vendor/earcut.js';

// facade tile: [bay width m, storey height m]
const TILE = { glass: [3, 3.6], tower: [1.8, 3.6], brick: [3.6, 4.2], classic: [4.6, 5.2], castle: [7, 6], slate: [9, 8],
  alabaster: [3, 3], munch: [1.4, 4], aluminium: [2.4, 3], timber: [.6, 4], dark: [3, 3.6], stripes: [2, 3.6], church: [5.5, 11] };
const NAMED = { white: '#f4f2ec', grey: '#9a9894', gray: '#9a9894', lightgrey: '#c9c7c2', black: '#3a3a3c', yellow: '#e8cf72' };

function facadeTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#dedede';
  g.fillRect(0, 0, 128, 128);
  const pane = (x, y, w, h, glass = '#6f8a9c', frame = '#ffffff', f = 5) => {
    g.fillStyle = frame; g.fillRect(x, y, w, h);
    g.fillStyle = glass; g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.beginPath(); g.moveTo(x + f + 2, y + h - f - 4); g.lineTo(x + f + 10, y + f + 2); g.lineTo(x + f + 15, y + f + 2); g.lineTo(x + f + 7, y + h - f - 4); g.fill();
  };
  if (kind === 'glass' || kind === 'dark') {
    g.fillStyle = kind === 'dark' ? '#3b4650' : '#7f9aab'; g.fillRect(0, 0, 128, 128);      // curtain wall
    g.fillStyle = kind === 'dark' ? '#5b6670' : '#a9bcc8'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 0, 5, 128);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(14, 120); g.lineTo(60, 10); g.lineTo(84, 10); g.lineTo(38, 120); g.fill();
  } else if (kind === 'tower' || kind === 'stripes') {
    g.fillStyle = kind === 'stripes' ? '#2f3337' : '#c9cbcc';
    g.fillRect(64, 0, 64, 128);                                                           // vertical bands
    g.fillStyle = '#7d93a1'; g.fillRect(70, 8, 52, 100);
  } else if (kind === 'brick') {
    g.fillStyle = '#cfcfcf'; for (let y = 4; y < 128; y += 8) g.fillRect(0, y, 128, 1.5);   // brick courses
    pane(34, 22, 60, 76, '#5d6f7a', '#e9e9e9', 6);
  } else if (kind === 'classic') {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 114, 128, 14); g.fillRect(0, 0, 128, 7);         // cornice and plinth band
    pane(36, 24, 56, 78, '#5f7380', '#f2f2f2', 7);
    g.fillStyle = '#efefef'; g.fillRect(30, 18, 68, 6);                                    // window head
  } else if (kind === 'castle') {
    g.fillStyle = '#cdcdcd'; for (let y = 10; y < 128; y += 22) for (let x = (y / 22 % 2) * 20; x < 128; x += 40) g.fillRect(x, y, 34, 2);
    g.fillStyle = '#4b555b'; g.beginPath(); g.roundRect(52, 40, 24, 40, [12, 12, 0, 0]); g.fill();   // small arched window
  } else if (kind === 'church') {
    g.fillStyle = '#cfcfcf'; for (let y = 4; y < 128; y += 8) g.fillRect(0, y, 128, 1.5);   // brick courses
    g.fillStyle = '#ececec'; g.beginPath(); g.roundRect(46, 18, 36, 96, [18, 18, 0, 0]); g.fill();
    g.fillStyle = '#4c5a63'; g.beginPath(); g.roundRect(51, 23, 26, 86, [13, 13, 0, 0]); g.fill();   // tall arched window
    g.fillStyle = '#ececec'; g.fillRect(63, 23, 2, 86);
  } else if (kind === 'slate') {
    g.fillStyle = '#d2d2d2'; for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 2);
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 128);
  } else if (kind === 'alabaster') {
    g.fillStyle = '#e8e8e8'; for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 3, 128);
  } else if (kind === 'munch') {
    for (let x = 0; x < 128; x += 16) { g.fillStyle = '#e6e6e6'; g.fillRect(x, 0, 9, 128); g.fillStyle = '#cfcfcf'; g.fillRect(x + 9, 0, 7, 128); }
    g.fillStyle = 'rgba(80,90,100,.25)'; for (let y = 6; y < 128; y += 12) for (let x = 2; x < 128; x += 8) g.fillRect(x, y, 3, 3);   // perforation
  } else if (kind === 'aluminium') {
    g.fillStyle = '#cdcdcd'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 128); for (let y = 0; y < 128; y += 42) g.fillRect(0, y, 128, 2);
    g.fillStyle = '#7f909a'; g.fillRect(8, 60, 112, 14);                                   // window band
  } else if (kind === 'timber') {
    for (let x = 0; x < 128; x += 16) { g.fillStyle = '#d6d6d6'; g.fillRect(x, 0, 12, 128); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const colourOf = (value, fallback) => (value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : NAMED[value] || fallback);
const shade = (hex, k) => { const c = linear(hex); return [c[0] * k, c[1] * k, c[2] * k]; };

export function buildLandmarks({ data, heightAt, wx, wy, M, LIFT, scene, wallTint, cartoon }) {
  const K = M * LIFT;                                     // world units per metre of height
  const buckets = new Map();                              // facade kind -> walls; 'plain' -> roofs and details
  const bucket = kind => { if (!buckets.has(kind)) buckets.set(kind, new Bucket(true)); return buckets.get(kind); };
  const plain = bucket('plain');
  const stats = { sites: 0, parts: 0, names: [] };

  // ---- small geometry toolkit (world units; pts are [x, z]) -------------------------------------
  // walls of a ring from y0 to y1, facade uv in metres / tile
  function walls(kind, pts, y0, y1, rgb) {
    const [bay, storey] = TILE[kind] || [3, 3.5], b = bucket(kind);
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u0 = run / (bay * M), u1 = (run + len) / (bay * M), v0 = 0, v1 = (y1 - y0) / (storey * K);
      quad(b, [[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], rgb, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      run += len;
    }
  }
  // a flat cap over a ring with holes, facing up (or down)
  function cap(rings, y, rgb, down = false) {
    const flat = [], holes = [], all = [];
    for (const r of rings) { if (all.length) holes.push(all.length); for (const p of r) { flat.push(p[0], p[1]); all.push(p); } }
    const t = Earcut.triangulate(flat, holes);
    for (let i = 0; i < t.length; i += 3) {
      const A = all[t[i]], B = all[t[i + 1]], C = all[t[i + 2]];
      const order = down ? [A, B, C] : [A, C, B];
      tri(plain, order.map(p => [p[0], y, p[1]]), rgb);
    }
  }
  const area = pts => { let a = 0; for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) a += pts[p][0] * pts[q][1] - pts[q][0] * pts[p][1]; return a / 2; };
  const ccw = pts => (area(pts) < 0 ? pts.slice().reverse() : pts);
  const ringPts = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([wx(flat[i]), wy(flat[i + 1])]); return out; };
  // prism: walls + roof (+ floor when it floats), from metres above `base`
  function prism(kind, rings, base, h0, h1, wallHex, roofHex) {
    const y0 = h0 > 0 ? base + h0 * K : base - 1.5, y1 = base + h1 * K;
    rings = rings.map((r, i) => (i === 0 ? ccw(r) : ccw(r).reverse()));
    for (const r of rings) walls(kind, r, y0, y1, linear(wallHex));
    cap(rings, y1, roofHex ? linear(roofHex) : shade(wallHex, .82));
    if (h0 > 0) cap(rings, y0, shade(wallHex, .6), true);
  }
  // oriented box in a local frame: f(u, v) -> [x, z]
  function box(kind, f, u0, u1, v0, v1, base, h0, h1, wallHex, roofHex) {
    prism(kind, [[f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)]], base, h0, h1, wallHex, roofHex);
  }
  // longest-edge frame of a footprint: centre, axis, extents (world units)
  function axes(pts) {
    let best = 0, dx = 1, dz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez);
      if (l > best) { best = l; dx = ex / l; dz = ez / l; }
    }
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of pts) { const s = x * dx + z * dz, t = -x * dz + z * dx; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const at = (s, t) => [dx * s - dz * t, dz * s + dx * t];
    return { dx, dz, s0, s1, t0, t1, at };
  }
  // pitched roofs on a footprint's rectangle: 'gabled' (ridge along the long side), 'hipped', 'pyramid'
  function roof(shape, pts, y, rise, hex) {
    const { s0, s1, t0, t1, at } = axes(pts), tm = (t0 + t1) / 2, sm = (s0 + s1) / 2, half = (t1 - t0) / 2, c = linear(hex);
    const P = (s, t, h) => { const [x, z] = at(s, t); return [x, h, z]; };
    const E = [P(s0, t0, y), P(s1, t0, y), P(s1, t1, y), P(s0, t1, y)], top = y + rise;
    if (shape === 'pyramid') {
      const apex = P(sm, tm, top);
      for (let i = 0; i < 4; i++) tri(plain, [E[i], E[(i + 1) % 4], apex], c);
      return;
    }
    const inset = shape === 'hipped' ? Math.min(half, (s1 - s0) / 2) : 0;
    const R1 = P(s0 + inset, tm, top), R2 = P(s1 - inset, tm, top);
    quad(plain, [E[0], E[1], R2, R1], c);
    quad(plain, [E[2], E[3], R1, R2], c);
    tri(plain, [E[3], E[0], R1], c);
    tri(plain, [E[1], E[2], R2], c);
  }
  // a vertical disc on a wall (clock face): centre, outward normal, radius
  function disc(x, y, z, nx, nz, r, hex, n = 16) {
    const c = linear(hex), tx = -nz, tz = nx, ring = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ring.push([x + nx * .25 + tx * Math.cos(a) * r, y + Math.sin(a) * r, z + nz * .25 + tz * Math.cos(a) * r]); }
    const mid = [x + nx * .25, y, z + nz * .25];
    for (let i = 0; i < n; i++) tri(plain, [mid, ring[i], ring[(i + 1) % n]], c);
  }
  // cone / spire / column around (x, z): radius r0 at y0 to r1 at y1
  function cone(x, z, y0, y1, r0, r1, hex, n = 8) {
    const c = linear(hex);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
      const p = (ang, r, y) => [x + Math.cos(ang) * r, y, z + Math.sin(ang) * r];
      if (r1 > 0) quad(plain, [p(a, r0, y0), p(b, r0, y0), p(b, r1, y1), p(a, r1, y1)], c);
      else tri(plain, [p(a, r0, y0), p(b, r0, y0), [x, y1, z]], c);
    }
    if (r1 > 0) { const top = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; top.push([x + Math.cos(a) * r1, z + Math.sin(a) * r1]); } cap([top], y1, c.map(v => v * .9)); }
  }
  // a site's measured frame: (u along the long axis, v to its left), metres -> world [x, z]
  function frameOf(site) {
    const f = site.frame, a = f.angle * Math.PI / 180, cx = wx(f.center[0]), cz = wy(f.center[1]);
    return (u, v) => [cx + (u * Math.cos(a) - v * Math.sin(a)) * M, cz + (-u * Math.sin(a) - v * Math.cos(a)) * M];
  }
  function baseOf(points) { let lo = Infinity; for (const [x, z] of points) lo = Math.min(lo, heightAt(x, z)); return lo; }

  // ---- hand models -----------------------------------------------------------------------------
  const MODELS = {
    // Oslo Opera House (Snøhetta, 2008), from photos and the orthophoto, on its OSM outline
    // (local metres: u east along the building, v north; the fjord is west and south):
    //  - a low marble plaza on the west, at the water
    //  - the south ramp: one plane rising east from the west tip to the roof (23 m), one rising
    //    north from the plinth along the fjord; they meet in the diagonal crease seen from the air
    //  - the north wing, rising east over a long low glass facade to the same roof
    //  - the roof plateau with its knife-thin overhanging edge over the glazed foyer, the white
    //    stage towers (35 m and 28 m), and the aluminium-clad workshops to the east (20 m)
    opera(site) {
      const f = frameOf(site);
      const outline = [[-112, -15], [-115, 57], [55, 55], [55, 57], [109, 50], [109, 15], [108, 15], [106, 4], [110, 2], [112, -62], [38, -52], [37, -65], [-111, -45], [-112, -21], [-114, -16]];
      const base = baseOf(outline.map(([u, v]) => f(u, v)));
      const P = (u, v, h) => { const [x, z] = f(u, v); return [x, base + h * K, z]; };
      const marble = linear('#f4f2ec'), marbleSide = linear('#e3e0d8'), PLAZA = 1.2, ROOF = 23;
      // the slopes meet the glazed foyer well below its roof, as in the photos: the ramp reaches the
      // roof level only further east, south of the stage tower
      const carpet = u => ROOF * (u + 112) / 112;                      // 0 at the west tip, 23 at u = 0
      const front = (u, v) => 25.47 + .0551 * u + .4078 * v;          // 1 m along the fjord edge, 23 at the crest
      const wing = u => PLAZA + (13 - PLAZA) * (u + 75) / 45;          // 13 m where it meets the foyer
      // a flat-shaded convex polygon of (u, v) points at heights h(u, v)
      const facet = (pts, h, c = marble) => { for (let i = 1; i < pts.length - 1; i++) tri(plain, [P(...pts[0], h(...pts[0])), P(...pts[i], h(...pts[i])), P(...pts[i + 1], h(...pts[i + 1]))], c); };
      // split a convex polygon where g(u, v) changes sign: [part with g <= 0, part with g >= 0]
      const split = (pts, g) => {
        const lo = [], hi = [];
        for (let i = 0; i < pts.length; i++) {
          const A = pts[i], B = pts[(i + 1) % pts.length], ga = g(...A), gb = g(...B);
          if (ga <= 0) lo.push(A); if (ga >= 0) hi.push(A);
          if ((ga < 0 && gb > 0) || (ga > 0 && gb < 0)) { const t = ga / (ga - gb), X = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; lo.push(X); hi.push(X); }
        }
        return [lo, hi];
      };
      // a wall along (u, v) points between heights lo(u, v) and hi(u, v)
      const wall = (pts, lo, hi, kind, c) => {
        const b = kind ? bucket(kind) : plain, [bay, storey] = TILE[kind] || [3, 3.5];
        let run = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const A = pts[i], B = pts[i + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
          const corners = [P(...A, lo(...A)), P(...B, lo(...B)), P(...B, hi(...B)), P(...A, hi(...A))];
          const uv = [[run / bay, lo(...A) / storey], [(run + len) / bay, lo(...B) / storey], [(run + len) / bay, hi(...B) / storey], [run / bay, hi(...A) / storey]];
          quad(b, corners, c, kind ? uv : undefined);
          run += len;
        }
      };
      const ground = () => -1.5 / K;
      // the south ramp: carpet and front planes, split along their crease
      const crease = (u, v) => carpet(u) - front(u, v);
      const [west1, west2] = split([[-111.5, -30], [-111, -45], [-30, -55.9], [-30, -30]], crease);
      if (west1.length >= 3) facet(west1, u => carpet(u));
      if (west2.length >= 3) facet(west2, (u, v) => front(u, v));
      facet([[-30, -55.9], [37, -65], [38, -30], [-30, -30]], (u, v) => front(u, v));
      wall([[-111.5, -30], [-30, -30]], () => PLAZA, u => Math.max(PLAZA, Math.min(carpet(u), front(u, -30))), null, marbleSide);   // the ramp's side
      const rampEdge = [[-111.5, -30], [-111, -45], [-30, -55.9], [37, -65], [38, -52]];
      wall(rampEdge, ground, (u, v) => Math.max(.3, Math.min(carpet(u), front(u, v))), null, marbleSide);
      // the plaza and the north wing over its long low glass facade
      // the flat plaza runs right up to the foyer's glass, as in the photos
      cap([[[-115, 57], [-75, 57], [-75, 27], [-30, 27], [-30, -30], [-111.5, -30], [-112, -21], [-112, -15], [-114, -16]].map(([u, v]) => f(u, v))], base + PLAZA * K, marble);
      wall([[-111.5, -30], [-112, -21], [-112, -15], [-114, -16], [-115, 57], [-75, 57]], ground, () => PLAZA, null, marbleSide);
      facet([[-75, 27], [-3, 27], [-3, 56], [-75, 57]], u => wing(u));
      wall([[-75, 27], [-30, 27]], () => PLAZA, u => wing(u), 'glass', linear('#9cc0c8'));
      wall([[-75, 57], [-3, 56]], ground, u => wing(u), null, marbleSide);
      // the plateau: glazed foyer under a thin marble roof slab overhanging by 2.5 m
      const glass = linear('#9cc0c8');
      wall([[-3, 56], [-3, 27], [-30, 27], [-30, -30], [50, -30]], ground, () => ROOF - .9, 'glass', glass);
      wall([[50, 55], [-3, 56]], ground, () => ROOF - .9, 'aluminium', linear('#eeece6'));
      const slab = [[-32.5, -32.5], [50, -32.5], [50, 55], [-3, 56], [-3, 29.5], [-32.5, 29.5]];
      wall([...slab, slab[0]], () => ROOF - .9, () => ROOF, null, marbleSide);
      cap([slab.map(([u, v]) => f(u, v))], base + ROOF * K, marble);
      cap([slab.map(([u, v]) => f(u, v))], base + (ROOF - .9) * K, marbleSide, true);
      // stage towers in white aluminium, and the workshops with their skylit box
      box('alabaster', f, 0, 27, -30, 3, base, 0, 35, '#eeece6', '#dddbd5');
      box('alabaster', f, 27, 50, 14, 39, base, 0, 28, '#eeece6', '#dddbd5');
      prism('aluminium', [[[50, 55], [55, 55], [55, 57], [109, 50], [109, 15], [108, 15], [106, 4], [110, 2], [112, -62], [38, -52], [38, -30], [50, -30]].map(([u, v]) => f(u, v))], base, 0, 20, '#e9e8e3', '#cfd0cc');
      box('aluminium', f, 55, 85, -45, -20, base, 20, 22.5, '#e9e8e3', '#a9c4cf');
    },
    // MUNCH (Estudio Herreros, 2021): a 60 m tower in perforated aluminium on a wider base, its top
    // bending over towards the city (the sideways step the OSM parts record, made a smooth bend).
    munch(site) {
      const f = frameOf(site);
      const base = baseOf(site.parts.flatMap(p => ringPts(p.rings[0])));
      for (const p of site.parts.filter(q => q.max <= 15)) prism('glass', p.rings.map(ringPts), base, 0, p.max, '#9fb0b8', '#c8ccce');
      const v0 = -4.3, v1 = 19.3, u0 = -33.9, u1 = 32.8, colour = linear('#d5d8d9');
      // the OSM parts step 5 m sideways at 37 m and 7.5 m at 50 m: a bend at 37 m, leaning ~21°
      const levels = [0, 37, 60];
      const lean = h => (h <= 37 ? 0 : -9 * (h - 37) / 23);
      const ring = h => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => { const [x, z] = f(u, v + lean(h)); return [x, h ? base + h * K : base - 1.5, z]; });
      const b = bucket('munch'), [bay, storey] = TILE.munch;
      for (let k = 0; k < levels.length - 1; k++) {
        const lo = ring(levels[k]), hi = ring(levels[k + 1]);
        let run = 0;
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4, len = Math.hypot(lo[j][0] - lo[i][0], lo[j][2] - lo[i][2]);
          const ua = run / (bay * M), ub = (run + len) / (bay * M), va = levels[k] / storey, vb = levels[k + 1] / storey;
          quad(b, [lo[i], lo[j], hi[j], hi[i]], colour, [[ua, va], [ub, va], [ub, vb], [ua, vb]]);
          run += len;
        }
      }
      const top = ring(60);
      quad(plain, [top[0], top[3], top[2], top[1]], linear('#b9bdbf'));
    },
    // Astrup Fearnley Museet (Renzo Piano, 2012): two timber-clad halls under sweeping glass sail
    // roofs that fall towards the tip of Tjuvholmen.
    astrup(site) {
      const f = frameOf(site), a = site.frame.angle * Math.PI / 180;
      const base = baseOf(site.outline.flatMap(ringPts));
      const toLocal = ([x, z]) => { const cx = wx(site.frame.center[0]), cz = wy(site.frame.center[1]), dx = (x - cx) / M, dz = (z - cz) / M; return [dx * Math.cos(a) - dz * Math.sin(a), -dx * Math.sin(a) - dz * Math.cos(a)]; };
      for (const flat of site.outline) {
        const pts = ccw(ringPts(flat)), local = pts.map(toLocal);
        const us = local.map(p => p[0]), vs = local.map(p => p[1]);
        const ua = Math.min(...us), ub = Math.max(...us), va = Math.min(...vs), vb = Math.max(...vs);
        const big = ub - ua > 60 || (ua + ub) / 2 > 0;                // the hall to the north is the taller one
        const wallTop = big ? 12 : 6, hiRoof = big ? 22 : 12, loRoof = big ? 12 : 4;
        prism('timber', [pts], base, 0, wallTop, '#c9a678', '#b8956a');
        // the sail: a curved glass sheet over the hall, overhanging by 3 m, highest at the north end
        const n = 10, m = 4, glass = linear('#c3d6de'), rib = linear('#f2f2ee');
        const U = i => ua - 3 + (ub - ua + 6) * i / n, V = j => va - 3 + (vb - va + 6) * j / m;
        const hAt = (i, j) => { const t = i / n; return loRoof + (hiRoof - loRoof) * t * t * (3 - 2 * t) + Math.sin(Math.PI * j / m) * 1.2; };
        const Q = (i, j) => { const [x, z] = f(U(i), V(j)); return [x, base + hAt(i, j) * K, z]; };
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) quad(plain, [Q(i, j), Q(i + 1, j), Q(i + 1, j + 1), Q(i, j + 1)], (i + j) % 2 ? glass : glass.map(v => v * .96));
        for (let i = 0; i <= n; i += 2) for (let j = 0; j < m; j++) { const p = Q(i, j), q = Q(i, j + 1); quad(plain, [p, q, [q[0], q[1] + .5, q[2]], [p[0], p[1] + .5, p[2]]], rib); }
      }
    },
    // Frammuseet: the two tent-like A-frame halls on Bygdøynes (the polar ships Fram and Gjøa).
    fram(site) {
      const base = baseOf(site.parts.flatMap(p => ringPts(p.rings[0])));
      for (const p of site.parts.filter(q => q.max >= 15)) {
        const pts = ccw(ringPts(p.rings[0])), { s0, s1, t0, t1, at } = axes(pts), tm = (t0 + t1) / 2;
        const eave = base + 2 * K, top = base + p.max * K, roofC = linear('#4f565e'), wall = linear('#ebe6dc');
        const Pt = (s, t, y) => { const [x, z] = at(s, t); return [x, y, z]; };
        quad(plain, [Pt(s0, t0, eave), Pt(s1, t0, eave), Pt(s1, tm, top), Pt(s0, tm, top)], roofC);
        quad(plain, [Pt(s1, t1, eave), Pt(s0, t1, eave), Pt(s0, tm, top), Pt(s1, tm, top)], roofC);
        for (const s of [s0, s1]) {
          tri(bucket('glass'), [Pt(s, t0, eave), Pt(s, t1, eave), Pt(s, tm, top)], wall, [[0, 0], [(t1 - t0) / (3 * M), 0], [(t1 - t0) / (6 * M), (top - eave) / (3.6 * K)]]);
        }
        walls('timber', [[...at(s0, t0)], [...at(s1, t0)], [...at(s1, t1)], [...at(s0, t1)]], base - 1.5, eave, wall);
      }
    },
    // Monolitten in Vigelandsparken: a 14 m granite column on a stepped plinth ringed by 36 figure groups.
    monolitten(site) {
      const x = wx(site.frame.center[0]), z = wy(site.frame.center[1]), base = heightAt(x, z), granite = '#c2bdb3';
      let y = base - 1.5, top = base;
      for (const r of [24, 18, 12]) { top += 1.2 * K; cone(x, z, y, top, r * M, r * M, granite, 16); y = top; }
      cone(x, z, y, y + 14.1 * K, 1.7 * M, 1.3 * M, '#bab4a8', 12);
      cone(x, z, y + 14.1 * K, y + 14.9 * K, 1.3 * M, 0, '#bab4a8', 12);
      for (let i = 0; i < 36; i++) {
        const a = i / 36 * Math.PI * 2, gx = x + Math.cos(a) * 15 * M, gz = z + Math.sin(a) * 15 * M, gy = base + 1.2 * K;
        cone(gx, gz, gy, gy + 2.4 * K, 1.3 * M, .7 * M, '#b3ada2', 5);
      }
    },
  };

  // ---- sites built from their OSM parts ----------------------------------------------------------
  const centre = pts => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
  const radius = (pts, [cx, cz]) => Math.max(...pts.map(([x, z]) => Math.hypot(x - cx, z - cz)));
  for (const site of data.sites) {
    stats.sites++;
    stats.names.push(site.name);
    if (site.build === 'model') { MODELS[site.id]?.(site); continue; }
    let parts = site.parts || [];
    const base = baseOf(parts.flatMap(p => ringPts(p.rings[0])));
    // The City Hall's towers: east 66 m, west 63 m (OSM rounds both up to 74 m with their roof gear)
    let east = null, west = null;
    if (site.id === 'radhus') {
      const towers = parts.filter(q => q.max >= 60).sort((p, q) => centre(ringPts(p.rings[0]))[0] - centre(ringPts(q.rings[0]))[0]);
      west = towers[0] && { ...towers[0], max: 63 };
      east = towers[1] && { ...towers[1], max: 66 };
      parts = parts.map(q => (q === towers[0] ? west : q === towers[1] ? east : q));
    }
    const tallest = parts.reduce((m, p) => (p.max > (m?.max ?? -1) ? p : m), null);
    const small = p => { const { s0, s1, t0, t1 } = axes(ringPts(p.rings[0])); return (s1 - s0) / M <= 8 && (t1 - t0) / M <= 8; };
    parts.forEach((p, i) => {
      let kind = site.facade || 'glass', wallHex = colourOf(p.colour, site.colour || '#d8d4cc');
      if (site.facade === 'barcode') {           // Barcode: each tower in its own skin
        kind = ['glass', 'stripes', 'dark', 'tower', 'glass', 'aluminium'][i % 6];
        wallHex = ['#8fa6b4', '#e8e6e1', '#53606b', '#dcdad5', '#a8b8c2', '#d6d8d6'][i % 6];
      }
      if (site.id === 'radhus') wallHex = '#8a4b3d';                       // dark brown-red brick
      if (site.id === 'slottet' && p.min === 0) { kind = 'classic'; wallHex = '#e1d1a8'; }   // ground floor, same cream
      if (site.id === 'akershus') {
        if (p.min === 0 && p.colour === '#ffcb7e') wallHex = '#e6c27c';     // the ochre guardhouse
        else if (p.min === 0) wallHex = '#a39b8d';                          // the rock and ramparts
        else if (p.rings[0].length === 16 && p.min >= 19) { kind = 'alabaster'; wallHex = '#5d8b76'; }   // copper lantern stages
        else wallHex = '#ece5d4';                                           // pale plaster walls
      }
      if (site.id === 'domkirke') kind = wallHex === '#b2cb65' ? 'alabaster' : 'church';   // copper tower top, arched windows
      const roofHex = site.id === 'akershus' || site.id === 'slottet' ? null : undefined;
      if (site.extras === 'light-hall' && p === tallest) {
        // Nasjonalmuseet: slate below, the alabaster light hall along the top
        prism(kind, p.rings.map(ringPts), base, p.min, 19, wallHex, roofHex);
        prism('alabaster', p.rings.map(ringPts), base, 19, p.max, '#efe8d6');
      } else prism(kind, p.rings.map(ringPts), base, p.min, p.max, wallHex, roofHex);
      stats.parts++;
    });
    if (site.id === 'akershus') {
      // steep red-brown tile roofs on the castle wings; slender copper spires on its two towers
      for (const p of parts.filter(q => q.min >= 10 && q.rings[0].length !== 16 && !small(q))) {
        const pts = ringPts(p.rings[0]), { s0, s1, t0, t1 } = axes(pts);
        roof((s1 - s0) / Math.max(1e-6, t1 - t0) < 1.5 ? 'hipped' : 'gabled', pts, base + p.max * K, (t1 - t0) / 2 * 1.1, '#7a4d3f');
      }
      const tops = parts.filter(q => q.rings[0].length === 16 && q.max >= 34);
      for (const p of tops) {
        const pts = ringPts(p.rings[0]), c = centre(pts), y = base + p.max * K;
        cone(c[0], c[1], y, y + 15 * K, radius(pts, c) * 1.15, 0, '#5d8b76', 8);
      }
    }
    if (site.id === 'slottet') {
      // low hipped zinc roofs, and the columned portico with its pediment on the main front (east)
      for (const p of parts.filter(q => q.min > 0)) { const pts = ringPts(p.rings[0]); roof('hipped', pts, base + p.max * K, (axes(pts).t1 - axes(pts).t0) * .18, '#7d8790'); }
      const main = parts.filter(q => q.min > 0).sort((a, b) => b.max - a.max || b.rings[0].length - a.rings[0].length)[0];
      if (main) {
        const pts = ringPts(main.rings[0]), { s0, s1, t0, t1, at } = axes(pts);
        // the long side facing east (+x), towards Karl Johans gate
        const sm = (s0 + s1) / 2, front = at(sm, t1)[0] > at(sm, t0)[0] ? t1 : t0, out = front === t1 ? 1 : -1;
        const y0 = base + main.min * K, y1 = base + (main.max - 4) * K, depth = 6 * M;
        for (let c = -2.5; c <= 2.5; c++) {
          const [cx, cz] = at(sm + c * 3.2 * M, front + out * (depth - .8 * M));
          cone(cx, cz, y0, y1, .75 * M, .65 * M, '#f7f1de', 10);
        }
        const A = at(sm - 9.5 * M, front), B = at(sm + 9.5 * M, front), C = at(sm + 9.5 * M, front + out * depth), D = at(sm - 9.5 * M, front + out * depth);
        prism('classic', [[A, B, C, D]], base, main.max - 4, main.max - 2.6, '#f7f1de');
        const peak = base + (main.max + .8) * K, ridgeA = at(sm, front), ridgeB = at(sm, front + out * depth), lo = base + (main.max - 2.6) * K;
        tri(plain, [[C[0], lo, C[1]], [D[0], lo, D[1]], [ridgeB[0], peak, ridgeB[1]]], linear('#f3ecd6'));
        quad(plain, [[D[0], lo, D[1]], [A[0], lo, A[1]], [ridgeA[0], peak, ridgeA[1]], [ridgeB[0], peak, ridgeB[1]]], linear('#7d8790'));
        quad(plain, [[B[0], lo, B[1]], [C[0], lo, C[1]], [ridgeB[0], peak, ridgeB[1]], [ridgeA[0], peak, ridgeA[1]]], linear('#7d8790'));
      }
    }
    if (site.id === 'radhus') {
      // the clock on the east tower (harbour and courtyard sides), the mast on the west tower
      if (east) {
        const pts = ccw(ringPts(east.rings[0])), y = base + (east.max - 8) * K;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
          if (len < 8 * M || Math.abs(nz) < .7) continue;
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          disc(mx, y, mz, nx, nz, 3.6 * K, '#2c2a28');
          disc(mx + nx * .05, y, mz + nz * .05, nx, nz, 3.1 * K, '#e9d9a6');
        }
      }
      if (west) {
        const pts = ringPts(west.rings[0]), c = centre(pts), y = base + west.max * K;
        cone(c[0], c[1], y, y + 11 * K, .45 * M, .12 * M, '#3d3b39', 6);
      }
    }
    if (site.id === 'domkirke') {
      // steep roofs over the nave, choir and transepts, and the copper spire above the clock tower
      for (const p of parts.filter(q => q.min === 0 && q.max <= 25 && q.max >= 12)) {
        const pts = ringPts(p.rings[0]), { t0, t1 } = axes(pts);
        roof('gabled', pts, base + p.max * K, (t1 - t0) / 2 * 1.15, '#4e5559');
      }
      if (tallest) {
        const pts = ringPts(tallest.rings[0]), c = centre(pts), y = base + tallest.max * K;
        cone(c[0], c[1], y, y + 16 * K, radius(pts, c) * .9, 0, '#7fae8c', 8);
      }
    }
    if (site.id === 'stortinget') {
      // the round halls' shallow domes
      for (const p of parts) {
        const pts = ringPts(p.rings[0]);
        if (pts.length < 10) continue;
        const c = centre(pts), r = radius(pts, c);
        if (Math.abs(area(pts)) / (Math.PI * r * r) < .85) continue;
        const y = base + p.max * K;
        cone(c[0], c[1], y, y + r * .22, r, r * .55, '#a8916a', 16);
        cone(c[0], c[1], y + r * .22, y + r * .34, r * .55, 0, '#a8916a', 16);
      }
    }
  }

  // ---- one mesh per material ---------------------------------------------------------------------
  const meshes = [];
  for (const [kind, b] of buckets) {
    if (!b.vertices) continue;
    const material = kind === 'plain' ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ map: facadeTexture(kind), color: wallTint, vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(cartoon.geometry(b), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = 19;                 // with the buildings (20), counted apart from them
    mesh.userData.landmarks = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return { meshes, stats };
}

// roof heights (m) of the hand-modelled sites, for delivery addresses inside them
const MODEL_TOP = { opera: 23, munch: 60, astrup: 20, fram: 26, monolitten: 15 };

/**
 * (footprint [[x, z], ...]) => the roof height in metres of the landmark standing on at least half
 * of that footprint, or null: a delivery address inside a landmark (the Opera and the City Hall are
 * addresses in the match) is drawn by the landmark, with its pin above the landmark's roof.
 */
export function landmarkTop(data, wx, wy) {
  const shapes = [];
  const add = (flat, max) => { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([wx(flat[i]), wy(flat[i + 1])]); if (pts.length >= 3) shapes.push({ pts, max }); };
  for (const site of data?.sites || []) {
    if (site.build === 'parts') for (const p of site.parts || []) add(p.rings[0], p.max);
    else for (const o of site.outline || []) add(o, MODEL_TOP[site.id] ?? 20);
  }
  const inside = (x, z, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
    }
    return c;
  };
  return footprint => {
    let cx = 0, cz = 0;
    for (const [x, z] of footprint) { cx += x; cz += z; }
    cx /= footprint.length; cz /= footprint.length;
    const samples = [[cx, cz], ...footprint.flatMap(([x, z]) => [[cx + (x - cx) * .3, cz + (z - cz) * .3], [cx + (x - cx) * .7, cz + (z - cz) * .7]])];
    let covered = 0, top = null;
    for (const [x, z] of samples) {
      let here = null;
      for (const s of shapes) if (inside(x, z, s.pts)) here = Math.max(here ?? 0, s.max);
      if (here !== null) { covered++; top = Math.max(top ?? 0, here); }
    }
    return covered >= samples.length / 2 ? top : null;
  };
}
