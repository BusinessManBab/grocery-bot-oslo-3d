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
import { Bucket, linear, quad, tri } from './building-geometry.js?v=21';
import { Earcut } from './vendor/earcut.js';

// facade tile: [bay width m, storey height m]
const TILE = { glass: [3, 3.6], tower: [1.8, 3.6], brick: [3.6, 4.2], classic: [4.6, 5.2], castle: [7, 6], slate: [9, 8],
  marble: [3, 3], foyer: [3, 7], alabaster: [3, 3], munch: [1.4, 4], aluminium: [2.4, 3], timber: [.6, 4], dark: [3, 3.6], stripes: [2, 3.6], church: [5.5, 11] };
const NAMED = { white: '#f4f2ec', grey: '#9a9894', gray: '#9a9894', lightgrey: '#c9c7c2', darkgrey: '#5d5d5d', black: '#3a3a3c', yellow: '#e8cf72',
  red: '#a24a3c', brown: '#7a5a44', green: '#6f9a85', beige: '#e6dbc2', blue: '#7f9ab3' };
// OSM building:material -> facade and colour; roof:material -> roof colour
const MATERIAL = { glass: ['glass', '#9cc0c8'], brick: ['brick', '#9a5546'], stone: ['castle', '#d3ccbc'], limestone: ['classic', '#e4dccb'],
  concrete: ['aluminium', '#e4e2dc'], plaster: ['classic', '#efe6cf'], metal: ['aluminium', '#c6cacd'], mirror: ['dark', '#5d7380'],
  wood: ['timber', '#b98f62'], copper: ['alabaster', '#6f9a85'] };
MATERIAL.mirror = ['glass', '#aebfc8'];                    // mapped "mirror" facades read as light glass in photos
const ROOF_MATERIAL = { concrete: '#e2e0da', tar_paper: '#6c6966', metal: '#9aa1a6', copper: '#6f9a85', roof_tiles: '#9b5a45', tile: '#9b5a45',
  slate: '#55595c', glass: '#a9c7d1', grass: '#8fae6a', plaster: '#e9e2d0', limestone: '#e4dccb', cobblestone: '#8d8a84', stone: '#a8a294' };

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
  if (kind === 'marble') {
    g.fillStyle = '#faf9f5'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e9e7e0'; g.fillRect(0, 0, 128, 1); g.fillRect(0, 0, 1, 128);
  } else if (kind === 'foyer') {
    // Tall clear glazing, not the dark, diagonally patterned office curtain wall.
    g.fillStyle = '#c1ddd9'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e6efea'; g.fillRect(0, 0, 3, 128); g.fillRect(0, 0, 128, 2);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(8, 0, 20, 128);
  } else if (kind === 'glass' || kind === 'dark') {
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
  // Walls follow the roof; roofs: flat, skillion (roof:direction is the downhill compass bearing),
  // gabled, hipped, pyramidal, dome, onion, cone. Against flicker, each part's roof is lifted a few
  // millimetres more than the one before (overlapping parts never share a plane) and a raised part's
  // floor sits just above the roof below it.
  const centre = pts => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
  const radius = (pts, [cx, cz]) => pts.reduce((m, [x, z]) => Math.max(m, Math.hypot(x - cx, z - cz)), 0);
  function roofed(p, base, index, kind, wallHex, roofHex) {
    const rings = p.rings.map(ringPts).map((r, i) => (i === 0 ? ccw(r) : ccw(r).reverse())), outer = rings[0];
    if (outer.length < 3) return;
    const top = p.max + index * .004, shape = p.roof?.shape || 'flat';
    const { s0, s1, t0, t1 } = axes(outer), width = (t1 - t0) / M, c = centre(outer), r = radius(outer, c);
    const defaults = { gabled: width * .4, hipped: width * .35, pyramidal: width * .6, dome: r / M, onion: r / M * 1.5, cone: r / M * 2, skillion: 2, round: r / M };
    let rise = shape === 'flat' ? 0 : Math.max(0, Math.min(p.roof?.height ?? defaults[shape] ?? 0, top - p.min - .3));
    const y0 = p.min > 0 ? base + (p.min + .15) * K : base - 1.5, eave = base + (top - rise) * K;
    // skillion: a plane falling towards roof:direction
    let roofAt = () => eave;
    if (shape === 'skillion' && rise > 0) {
      const d = (p.roof?.direction ?? 0) * Math.PI / 180, dx = Math.sin(d), dz = -Math.cos(d);
      const ss = outer.map(([x, z]) => x * dx + z * dz), lo = Math.min(...ss), hi = Math.max(...ss);
      roofAt = (x, z) => base + (top - rise * ((x * dx + z * dz - lo) / (hi - lo || 1))) * K;
    } else if (shape === 'flat') roofAt = () => base + top * K;
    // walls
    const [bay, storey] = TILE[kind] || [3, 3.5], wb = bucket(kind), wc = linear(wallHex);
    for (const ring of rings) {
      let run = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b2 = ring[(i + 1) % ring.length], len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        const ya = roofAt(a[0], a[1]), yb = roofAt(b2[0], b2[1]);
        quad(wb, [[a[0], y0, a[1]], [b2[0], y0, b2[1]], [b2[0], yb, b2[1]], [a[0], ya, a[1]]], wc,
          [[run / (bay * M), 0], [(run + len) / (bay * M), 0], [(run + len) / (bay * M), (yb - y0) / (storey * K)], [run / (bay * M), (ya - y0) / (storey * K)]]);
        run += len;
      }
    }
    if (p.min > 0) cap(rings, y0, shade(wallHex, .6), true);
    // roof
    const rc = linear(roofHex);
    if (shape === 'flat' || shape === 'skillion' || rise <= 0) {
      const flat = [], holes = [], all = [];
      for (const ring of rings) { if (all.length) holes.push(all.length); for (const q of ring) { flat.push(q[0], q[1]); all.push(q); } }
      const t = Earcut.triangulate(flat, holes);
      for (let i = 0; i < t.length; i += 3) tri(plain, [t[i], t[i + 2], t[i + 1]].map(k => [all[k][0], roofAt(all[k][0], all[k][1]), all[k][1]]), rc);
      return;
    }
    cap(rings, eave, rc);                                   // closes any gap between walls and roof
    if (shape === 'gabled' || shape === 'hipped') {
      roof(shape, outer, eave, rise * K, roofHex);
    } else if (shape === 'pyramidal') {
      const apex = [c[0], eave + rise * K, c[1]];
      for (let i = 0; i < outer.length; i++) { const a = outer[i], b2 = outer[(i + 1) % outer.length]; tri(plain, [[a[0], eave, a[1]], [b2[0], eave, b2[1]], apex], rc); }
    } else {                                                // dome, onion, cone, round: a turned profile
      const prof = shape === 'onion' ? [[1, 0], [1.22, .25], [1.1, .5], [.6, .78], [.15, .95], [0, 1]]
        : shape === 'cone' ? [[1, 0], [0, 1]] : [[1, 0], [.95, .3], [.8, .58], [.55, .82], [.25, .96], [0, 1]];
      for (let k = 0; k < prof.length - 1; k++) cone(c[0], c[1], eave + prof[k][1] * rise * K, eave + prof[k + 1][1] * rise * K, r * prof[k][0], r * prof[k + 1][0], roofHex, 12);
    }
  }
  const FAMOUS = new Set(['opera', 'radhus', 'slottet', 'akershus']);
  for (const site of data.sites) {
    stats.sites++;
    stats.names.push(site.name);
    if (site.build === 'model') { MODELS[site.id]?.(site); continue; }
    const parts = site.parts || [];
    const base = baseOf(parts.flatMap(p => ringPts(p.rings[0])));
    const tallest = parts.reduce((m, p) => (p.max > (m?.max ?? -1) ? p : m), null);
    parts.forEach((p, i) => {
      const mat = MATERIAL[p.material];
      let kind = mat?.[0] || site.facade || 'glass';
      let wallHex = colourOf(p.colour, mat?.[1] || site.colour || '#d8d4cc');
      let roofHex = colourOf(p.roofColour, ROOF_MATERIAL[p.roofMaterial] || null) || '#' + new THREE.Color(wallHex).multiplyScalar(.8).getHexString();
      if (site.facade === 'barcode') {           // Barcode: each tower in its own skin
        kind = ['glass', 'stripes', 'dark', 'tower', 'glass', 'aluminium'][i % 6];
        wallHex = ['#8fa6b4', '#e8e6e1', '#53606b', '#dcdad5', '#a8b8c2', '#d6d8d6'][i % 6];
      }
      // the most famous buildings, coloured as in photographs
      if (site.id === 'opera') {                  // white marble and aluminium, glass foyer, walkable white roofs
        // The broad 20 m ramp has a glass tag in the source, but its exposed
        // wedges are marble. Only the separate, shallow-pitched foyer is glazed.
        const ramp = p.roof?.shape === 'skillion' && (p.roof.height ?? 0) > p.max * .8;
        const glassy = p.material === 'glass' && !ramp;
        kind = glassy ? 'foyer' : ramp || p.max <= 2 ? 'marble' : p.max >= 25 ? 'alabaster' : 'aluminium';
        wallHex = glassy ? '#edf8f2' : '#faf8f2';
        roofHex = p.roof?.shape === 'skillion' || p.max <= 2 || p.max >= 23 ? '#faf8f2' : '#e9e7df';
      }
      if (site.id === 'radhus') { kind = 'brick'; wallHex = p.max < 27.5 && p.min > 26 ? wallHex : '#8a4b3d'; roofHex = '#57504c'; }
      if (site.id === 'slottet') { kind = 'classic'; wallHex = p.min === 0 ? '#ecdfb6' : '#f3e6bb'; roofHex = '#7d8790'; }
      if (site.id === 'akershus') {
        if (p.material === 'copper') { kind = 'alabaster'; wallHex = '#6f9a85'; }
        else if (p.colour === '#ffcb7e' && p.max <= 8) wallHex = '#e6c27c';
        else if (p.min === 0 && p.max <= 10) wallHex = '#a39b8d';           // the rock and ramparts
        else { kind = 'castle'; wallHex = '#ece5d4'; }                      // pale plaster walls
        if (p.roofMaterial === 'roof_tiles') roofHex = '#8a5443';
      }
      if (site.extras === 'light-hall' && p === tallest) {
        roofed({ ...p, max: 19, roof: { shape: 'flat' } }, base, i, kind, wallHex, roofHex);
        roofed({ ...p, min: 19 }, base, i, 'alabaster', '#efe8d6', '#e9e3d2');
      } else roofed(p, base, i, kind, wallHex, roofHex);
      stats.parts++;
    });
    // details only on the most famous buildings
    if (site.id === 'slottet') {
      // low hipped zinc roofs on the upper floors, and the columned portico facing Karl Johans gate
      for (const p of parts.filter(q => q.min > 0)) { const pts = ringPts(p.rings[0]); roof('hipped', pts, base + (p.max + .05) * K, (axes(pts).t1 - axes(pts).t0) * .16, '#7d8790'); }
      // the portico stands at the middle of the palace's east front (all its parts together)
      const upper = parts.filter(q => q.min > 0), all = upper.flatMap(q => ringPts(q.rings[0]));
      if (upper.length) {
        const { s0, s1, t0, t1, at } = axes(all.length > 2 ? all : ringPts(upper[0].rings[0]));
        const floor = Math.min(...upper.map(q => q.min)), roofTop = Math.max(...upper.map(q => q.max));
        const ends = [{ a: at(s0, t0), b: at(s1, t0) }, { a: at(s1, t1), b: at(s0, t1) }, { a: at(s1, t0), b: at(s1, t1) }, { a: at(s0, t1), b: at(s0, t0) }];
        const front = ends.reduce((m, e) => ((e.a[0] + e.b[0]) / 2 > (m.a[0] + m.b[0]) / 2 ? e : m));      // the easternmost side
        const len = Math.hypot(front.b[0] - front.a[0], front.b[1] - front.a[1]), ax = (front.b[0] - front.a[0]) / len, az = (front.b[1] - front.a[1]) / len;
        const ox = az, oz = -ax;                                            // outward, to the right of a -> b
        const mid = [(front.a[0] + front.b[0]) / 2, (front.a[1] + front.b[1]) / 2], depth = 6 * M;
        // the facade may sit inside the bounding side: step out to the nearest wall along the outward normal
        const P = (s, out) => [mid[0] + ax * s + ox * out, mid[1] + az * s + oz * out];
        const y0 = base + floor * K, y1 = base + (roofTop - 2) * K;
        for (let c = -2.5; c <= 2.5; c++) { const [cx, cz] = P(c * 3.2 * M, depth - .8 * M); cone(cx, cz, y0, y1, .75 * M, .65 * M, '#f7f1de', 10); }
        const A = P(-9.5 * M, 0), B = P(9.5 * M, 0), C = P(9.5 * M, depth), D = P(-9.5 * M, depth);
        prism('classic', [[A, B, C, D]], base, roofTop - 2, roofTop - .6, '#f7f1de');
        const peak = base + (roofTop + 2.2) * K, ridgeA = P(0, 0), ridgeB = P(0, depth), lo = base + (roofTop - .6) * K;
        tri(plain, [[C[0], lo, C[1]], [D[0], lo, D[1]], [ridgeB[0], peak, ridgeB[1]]], linear('#f3ecd6'));
        quad(plain, [[D[0], lo, D[1]], [A[0], lo, A[1]], [ridgeA[0], peak, ridgeA[1]], [ridgeB[0], peak, ridgeB[1]]], linear('#7d8790'));
        quad(plain, [[B[0], lo, B[1]], [C[0], lo, C[1]], [ridgeB[0], peak, ridgeB[1]], [ridgeA[0], peak, ridgeA[1]]], linear('#7d8790'));
      }
    }
    if (site.id === 'radhus') {
      // the clock on the east tower (harbour and courtyard faces), the mast on the west tower
      const towers = parts.filter(q => q.min === 0 && q.max >= 55).sort((a, b) => centre(ringPts(a.rings[0]))[0] - centre(ringPts(b.rings[0]))[0]);
      const east = towers[towers.length - 1], west = towers.length > 1 ? towers[0] : null;
      if (east) {
        const pts = ccw(ringPts(east.rings[0])), y = base + (east.max - 7) * K;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b2 = pts[(i + 1) % pts.length], len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
          const nx = (b2[1] - a[1]) / len, nz = -(b2[0] - a[0]) / len;
          if (len < 8 * M || Math.abs(nz) < .7) continue;
          const mx = (a[0] + b2[0]) / 2, mz = (a[1] + b2[1]) / 2;
          disc(mx + nx * .2, y, mz + nz * .2, nx, nz, 3.6 * K, '#2c2a28');
          disc(mx + nx * .35, y, mz + nz * .35, nx, nz, 3.1 * K, '#e9d9a6');
        }
      }
      if (west) {
        const pts = ringPts(west.rings[0]), c = centre(pts), topW = Math.max(...parts.filter(q => Math.hypot(...centre(ringPts(q.rings[0])).map((v, k) => v - c[k])) < 6 * M).map(q => q.max));
        cone(c[0], c[1], base + topW * K, base + (topW + 11) * K, .45 * M, .12 * M, '#3d3b39', 6);
      }
    }
    void FAMOUS;
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
