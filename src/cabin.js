// The cabin interior, built for realism: physically based materials with procedural
// textures and normal maps, curved sidewalls that follow the fuselage, deep window
// reveals with glass and shades, shaped seats, bins with service units and row numbers,
// a lit ceiling, seat tracks, soft contact shadows and patches of sunlight.
//
// Frame: the child's eyes at the origin, nose toward -Z, left windows at -X.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CX, FLOOR, ROWS, WINDOWS, rng } from './world.js';
import { drawCloudIcon } from './ui.js';

const ZF = -10.6; // front bulkhead
const ZB = 3.0; // rear wall
const L = ZB - ZF;
const ZC = (ZB + ZF) / 2;
const BIN_Y = 0.4; // underside of the bins
const WIN_Y = -0.05;
const WIN = { w: 0.3, h: 0.42, r: 0.1 }; // opening in the wall
const PANE = { w: 0.25, h: 0.36, r: 0.085, x: -0.5 }; // outer pane
const SEAT_XS = [0, 0.48, 0.96, 1.84, 2.32, 2.8];
const BLOCKS = [0.48, 2.32];

// Inner sidewall follows the fuselage circle; below the dado line it is vertical.
const R2 = 1.81 * 1.81;
const CY = -0.55;
export function wallX(y) {
  const yy = Math.max(y, -0.78);
  return CX - Math.sqrt(R2 - (yy - CY) * (yy - CY));
}
const mir = (x, side) => (side > 0 ? x : 2 * CX - x);

// ------------------------------------------------------------------ textures
function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
// grayscale height canvas -> tangent-space normal map (tileable)
function normalMap(hc, strength = 2, repeat = null) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cnv(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / len) * 127.5 + 127.5;
      img.data[i + 1] = (dy / len) * 127.5 + 127.5;
      img.data[i + 2] = (1 / len) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(out, { srgb: false, repeat });
}
function heightCanvas(w, h, f) {
  const c = cnv(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, f(x, y) * 255));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeTextures() {
  const R = rng(11);
  const T = {};
  // seat fabric: woven blue with lighter heather threads
  {
    const N = 256;
    const noise = Array.from({ length: N * N }, () => R());
    const c = cnv(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.92 : 1.06;
        const n = noise[y * N + x];
        const fleck = n > 0.985 ? 1.5 : 1;
        const i = (y * N + x) * 4;
        img.data[i] = 44 * weave * fleck * (0.94 + n * 0.12);
        img.data[i + 1] = 79 * weave * fleck * (0.94 + n * 0.12);
        img.data[i + 2] = 140 * weave * (0.95 + n * 0.1);
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    T.fabric = tex(c, { repeat: [3, 3] });
    T.fabricN = normalMap(heightCanvas(N, N, (x, y) => (((x >> 1) + (y >> 1)) % 2 ? 0.35 : 0.65) + noise[y * N + x] * 0.25), 3, [3, 3]);
  }
  // linen (headrest covers) and the logo print on the back
  {
    const N = 128;
    const nz = Array.from({ length: N * N }, () => R());
    T.linenN = normalMap(heightCanvas(N, N, (x, y) => 0.5 + 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6) + nz[y * N + x] * 0.2), 1.6, [2, 2]);
    const c = cnv(512, 224);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f2efe8';
    ctx.fillRect(0, 0, 512, 224);
    drawCloudIcon(ctx, 150, 112, 70, '#3fb3a6');
    ctx.fillStyle = '#1f6f8b';
    ctx.font = '800 64px Nunito, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Nimbus Air', 210, 118);
    T.cover = tex(c);
  }
  // plastic: faint "orange peel"
  {
    const N = 128;
    const nz = Array.from({ length: N * N }, () => R());
    T.plasticN = normalMap(heightCanvas(N, N, (x, y) => nz[y * N + x] * 0.5 + 0.25), 0.6, [6, 6]);
  }
  // carpet: navy with a small pattern and fibres
  {
    const N = 512;
    const c = cnv(N, N);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2f3b60';
    ctx.fillRect(0, 0, N, N);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(R() * N, R() * N, 2, 2);
    }
    ctx.fillStyle = 'rgba(120,150,210,0.28)';
    for (let y = 32; y < N; y += 64)
      for (let x = (y / 64) % 2 ? 0 : 32; x < N; x += 64) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-6, -6, 12, 12);
        ctx.restore();
      }
    T.carpet = tex(c, { repeat: [3, 12] });
    const nz = Array.from({ length: 256 * 256 }, () => R());
    T.carpetN = normalMap(heightCanvas(256, 256, (x, y) => nz[y * 256 + x]), 2.5, [6, 24]);
  }
  // sidewall: two cells side by side (left: window hole, right: solid)
  {
    const W = 512, H = 512;
    const c = cnv(W, H);
    const a = cnv(W, H);
    const ctx = c.getContext('2d');
    const ax = a.getContext('2d');
    const yToRow = (y) => (1 - (y - FLOOR) / (BIN_Y - FLOOR)) * H;
    for (let cell = 0; cell < 2; cell++) {
      const x0 = cell * 256;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#d9dde3');
      g.addColorStop(0.04, '#eef0f3');
      g.addColorStop(0.72, '#eceff2');
      g.addColorStop(0.79, '#dfe3e8');
      g.addColorStop(1, '#c9ced6');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, 256, H);
      // dado line and return-air grille near the floor
      ctx.fillStyle = 'rgba(120,128,140,0.5)';
      ctx.fillRect(x0, yToRow(-0.78), 256, 3);
      ctx.fillStyle = '#7a828e';
      for (let k = 0; k < 4; k++) rrect(ctx, x0 + 26, yToRow(-0.93) + k * 14, 204, 7, 3), ctx.fill();
      ax.fillStyle = '#fff';
      ax.fillRect(x0, 0, 256, H);
    }
    // the window hole (in metres, mapped to the left cell)
    const sx = 256 / 0.6;
    const sy = H / (BIN_Y - FLOOR);
    const hx = 128 - (WIN.w / 2) * sx;
    const hy = yToRow(WIN_Y + WIN.h / 2);
    ax.save();
    ax.translate(hx, hy);
    ax.scale(sx, sy);
    ax.fillStyle = '#000';
    rrect(ax, 0, 0, WIN.w, WIN.h, WIN.r);
    ax.fill();
    ax.restore();
    // soft shading around the window opening
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(sx, sy);
    ctx.strokeStyle = 'rgba(90,100,115,0.18)';
    ctx.lineWidth = 0.05;
    rrect(ctx, -0.02, -0.02, WIN.w + 0.04, WIN.h + 0.04, WIN.r + 0.02);
    ctx.stroke();
    ctx.restore();
    T.wall = tex(c);
    T.wall.wrapS = T.wall.wrapT = THREE.ClampToEdgeWrapping;
    T.wallA = tex(a, { srgb: false });
    T.wallA.wrapS = T.wallA.wrapT = THREE.ClampToEdgeWrapping;
  }
  // ceiling: lit from the cove lights along both sides, with panel joints
  {
    const c = cnv(256, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.22, '#c8d0dc');
    g.addColorStop(0.5, '#a9b3c2');
    g.addColorStop(0.78, '#c8d0dc');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(60,70,85,0.35)';
    ctx.fillRect(0, 0, 256, 2);
    T.ceilE = tex(c, { repeat: [1, L / 1.2] });
  }
  // service unit under the bins (per row)
  {
    const c = cnv(256, 320);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e4e8ed';
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = '#b9c0ca';
    ctx.lineWidth = 3;
    rrect(ctx, 8, 8, 240, 304, 18);
    ctx.stroke();
    for (let k = 0; k < 3; k++) {
      const x = 52 + k * 76;
      ctx.fillStyle = '#c7ced8';
      ctx.beginPath();
      ctx.arc(x, 70, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7f4ea';
      ctx.beginPath();
      ctx.arc(x, 70, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa3af';
      rrect(ctx, x - 14, 110, 28, 16, 5);
      ctx.fill();
    }
    ctx.fillStyle = '#f39c3d';
    ctx.beginPath();
    ctx.arc(200, 250, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(200, 244, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(196, 249, 8, 10);
    T.psu = tex(c);
  }
  // safety card and magazine, side by side
  {
    const c = cnv(256, 160);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f5e6a6';
    ctx.fillRect(0, 0, 110, 160);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 110, 22);
    ctx.fillStyle = '#5b6575';
    for (let i = 0; i < 6; i++) rrect(ctx, 10 + (i % 2) * 48, 32 + Math.floor(i / 2) * 42, 42, 34, 4), ctx.fill();
    const g = ctx.createLinearGradient(120, 0, 256, 160);
    g.addColorStop(0, '#2ab3a6');
    g.addColorStop(1, '#3b6fd8');
    ctx.fillStyle = g;
    ctx.fillRect(120, 0, 136, 160);
    ctx.fillStyle = '#fff';
    ctx.font = '800 22px Nunito, Arial';
    ctx.fillText('SKY', 132, 32);
    drawCloudIcon(ctx, 190, 100, 34, 'rgba(255,255,255,0.9)');
    T.card = tex(c);
  }
  // seatbelt webbing
  {
    const c = cnv(64, 64);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4b5466';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < 64; y += 3) ctx.fillRect(0, y, 64, 1);
    T.belt = tex(c, { repeat: [4, 1] });
  }
  // soft rounded shadow blob and a sunlight patch
  {
    const c = cnv(128, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    T.blob = tex(c, { srgb: false });
    const s = cnv(128, 128);
    const sx = s.getContext('2d');
    sx.filter = 'blur(6px)';
    sx.fillStyle = '#fff';
    rrect(sx, 18, 14, 92, 100, 26);
    sx.fill();
    T.sun = tex(s, { srgb: false });
  }
  return T;
}

// ------------------------------------------------------------------ geometry helpers
function placeAll(geo, mats) {
  // merge one geometry placed by many matrices into a single geometry
  return mergeGeometries(mats.map((m) => geo.clone().applyMatrix4(m)));
}
const M4 = (x, y, z, q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1)) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, s);
const qX = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qY = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);

function wallGeometry(side) {
  const pos = [];
  const uv = [];
  const idx = [];
  const ny = 28;
  const addCell = (z0, z1, u0, u1) => {
    const base = pos.length / 3;
    for (let i = 0; i <= ny; i++) {
      const y = FLOOR + ((BIN_Y - FLOOR) * i) / ny;
      const x = mir(wallX(y), side);
      pos.push(x, y, z0, x, y, z1);
      const v = i / ny;
      uv.push(u0, v, u1, v);
    }
    for (let i = 0; i < ny; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side > 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  };
  for (const z of WINDOWS) addCell(z - 0.3, z + 0.3, 0, 0.5);
  const zmax = Math.max(...WINDOWS) + 0.3;
  const zmin = Math.min(...WINDOWS) - 0.3;
  addCell(zmax, ZB, 0.5, 1);
  addCell(ZF, zmin, 0.5, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rrOutline(w, h, r, n) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s.getSpacedPoints(n);
}

// Deep window reveal: a loft from the opening in the curved wall out to the outer pane, plus a lip.
function revealGeometry(side) {
  const n = 64;
  const rings = [
    { pts: rrOutline(WIN.w + 0.05, WIN.h + 0.05, WIN.r + 0.025, n), x: (y) => wallX(y) + 0.003, shade: 1.0 },
    { pts: rrOutline(WIN.w + 0.012, WIN.h + 0.012, WIN.r + 0.006, n), x: (y) => wallX(y) + 0.012, shade: 1.0 },
    { pts: rrOutline(WIN.w, WIN.h, WIN.r, n), x: (y) => wallX(y) - 0.002, shade: 0.97 },
    { pts: rrOutline(WIN.w - 0.018, WIN.h - 0.022, WIN.r - 0.004, n), x: () => -0.43, shade: 0.86 },
    { pts: rrOutline(PANE.w, PANE.h, PANE.r, n), x: () => PANE.x, shade: 0.72 },
  ];
  const geos = [];
  for (const z0 of WINDOWS) {
    const pos = [];
    const col = [];
    const idx = [];
    rings.forEach((rg) => {
      for (let k = 0; k <= n; k++) {
        const p = rg.pts[k % n];
        const y = WIN_Y + p.y;
        pos.push(mir(rg.x(y), side), y, z0 + p.x);
        col.push(rg.shade, rg.shade, rg.shade);
      }
    });
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < n; k++) {
        const a = r * (n + 1) + k, b = a + 1, c = a + n + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0.5), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  return mergeGeometries(geos);
}

function paneGeometry(side, w, h, r, x) {
  const pts = rrOutline(w, h, r, 48);
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
  const base = new THREE.ShapeGeometry(shape);
  base.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return placeAll(base, WINDOWS.map((z) => M4(mir(x, side), WIN_Y, z)));
}

// ------------------------------------------------------------------ the cabin
export function buildCabin(envMap = null) {
  const g = new THREE.Group();
  const T = makeTextures();

  const std = (o) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.75, ...o });
  const M = {
    wall: std({ color: '#ffffff', map: T.wall, alphaMap: T.wallA, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.55, normalMap: T.plasticN, normalScale: new THREE.Vector2(0.3, 0.3) }),
    plastic: std({ color: '#eef1f4', roughness: 0.45, normalMap: T.plasticN, normalScale: new THREE.Vector2(0.25, 0.25) }),
    reveal: std({ color: '#f4f6f8', roughness: 0.4, vertexColors: true, side: THREE.DoubleSide }),
    trim: std({ color: '#c3c9d1', roughness: 0.5 }),
    shell: std({ color: '#b7bec8', roughness: 0.42, normalMap: T.plasticN, normalScale: new THREE.Vector2(0.3, 0.3) }),
    tray: std({ color: '#cfd4db', roughness: 0.4 }),
    dark: std({ color: '#4a515d', roughness: 0.5 }),
    pocket: std({ color: '#3a4560', roughness: 0.9, map: T.fabric, normalMap: T.fabricN }),
    fabric: std({ color: '#ffffff', map: T.fabric, normalMap: T.fabricN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 }),
    linen: std({ color: '#efece5', roughness: 0.8, normalMap: T.linenN, normalScale: new THREE.Vector2(0.5, 0.5) }),
    cover: std({ map: T.cover, roughness: 0.85, normalMap: T.linenN, normalScale: new THREE.Vector2(0.4, 0.4) }),
    metal: std({ color: '#c9ced5', roughness: 0.3, metalness: 0.85 }),
    carpet: std({ color: '#ffffff', map: T.carpet, normalMap: T.carpetN, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1 }),
    aisle: std({ color: '#7d8fbf', map: T.carpet, normalMap: T.carpetN, roughness: 1 }),
    ceiling: std({ color: '#e8edf3', roughness: 0.7, emissive: '#ffffff', emissiveMap: T.ceilE, emissiveIntensity: 0.32 }),
    glass: new THREE.MeshStandardMaterial({ envMap, color: '#d8e8f5', transparent: true, opacity: 0.045, roughness: 0.08, metalness: 0, envMapIntensity: 0.35, depthWrite: false }),
    shade: std({ color: '#f1f3f6', roughness: 0.6, side: THREE.DoubleSide }),
    card: std({ map: T.card, roughness: 0.7, side: THREE.DoubleSide }),
    belt: std({ color: '#ffffff', map: T.belt, roughness: 0.85 }),
    psu: std({ map: T.psu, roughness: 0.5 }),
    gasper: std({ color: '#d5dae1', roughness: 0.35, metalness: 0.4 }),
    led: new THREE.MeshBasicMaterial({ color: '#eef4ff', fog: false, toneMapped: false }),
  };
  const add = (geo, mat, cast) => {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };

  // --- sidewalls with window openings
  add(wallGeometry(1), M.wall);
  add(wallGeometry(-1), M.wall);
  add(mergeGeometries([revealGeometry(1), revealGeometry(-1)]), M.reveal);
  add(mergeGeometries([paneGeometry(1, PANE.w, PANE.h, PANE.r, PANE.x + 0.004), paneGeometry(-1, PANE.w, PANE.h, PANE.r, PANE.x + 0.004)]), M.glass).renderOrder = 5;
  // tiny breather hole near the bottom of each pane
  {
    const dot = new THREE.CircleGeometry(0.003, 10);
    const mats = [];
    for (const side of [1, -1]) for (const z of WINDOWS) mats.push(M4(mir(PANE.x + 0.006, side), WIN_Y - 0.13, z + 0.01, qY(side > 0 ? Math.PI / 2 : -Math.PI / 2)));
    add(placeAll(dot, mats), M.dark);
  }
  // half-open shades with a little handle
  {
    const sh = new THREE.PlaneGeometry(0.26, 0.075);
    const handle = new RoundedBoxGeometry(0.004, 0.012, 0.05, 1, 0.003);
    const ms = [];
    const mh = [];
    for (const side of [1, -1])
      for (const z of WINDOWS) {
        ms.push(M4(mir(-0.455, side), WIN_Y + 0.15, z, qY(side > 0 ? Math.PI / 2 : -Math.PI / 2)));
        mh.push(M4(mir(-0.45, side), WIN_Y + 0.118, z));
      }
    add(placeAll(sh, ms), M.shade);
    add(placeAll(handle, mh), M.dark);
  }

  // --- floor: carpet, aisle runner, seat tracks
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3.6, L), M.carpet);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(CX, FLOOR, ZC);
  g.add(floor);
  const aisle = new THREE.Mesh(new THREE.PlaneGeometry(0.46, L), M.aisle);
  aisle.rotation.x = -Math.PI / 2;
  aisle.position.set(CX, FLOOR + 0.002, ZC);
  g.add(aisle);
  {
    const track = new RoundedBoxGeometry(0.028, 0.008, L, 1, 0.003);
    add(placeAll(track, BLOCKS.flatMap((bx) => [M4(bx - 0.5, FLOOR + 0.004, ZC), M4(bx + 0.5, FLOOR + 0.004, ZC)])), M.metal);
  }

  // --- ceiling arc between the bins, lit by cove lights
  {
    const nx = 18;
    const x0 = 0.17, x1 = 2 * CX - 0.17;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = x0 + (x1 - x0) * t;
      const y = 0.965 + 0.11 * Math.sin(Math.PI * t);
      pos.push(x, y, ZF, x, y, ZB);
      uv.push(t, 0, t, 1);
    }
    for (let i = 0; i < nx; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.setIndex(idx);
    cg.computeVertexNormals();
    add(cg, M.ceiling);
    const strip = new THREE.BoxGeometry(0.025, 0.015, L);
    add(mergeGeometries([strip.clone().translate(0.19, 0.958, ZC), strip.clone().translate(2 * CX - 0.19, 0.958, ZC)]), M.led);
  }

  // --- overhead bins with doors, latches, service units and row numbers
  {
    const s = new THREE.Shape();
    s.moveTo(wallX(BIN_Y) - 0.02, BIN_Y);
    s.lineTo(0.22, BIN_Y);
    s.quadraticCurveTo(0.335, BIN_Y, 0.345, 0.5);
    s.lineTo(0.36, 0.76);
    s.quadraticCurveTo(0.365, 0.93, 0.19, 0.965);
    s.lineTo(-0.05, 0.99);
    s.lineTo(-0.3, 0.8);
    s.closePath();
    const bin = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false, curveSegments: 10 });
    bin.translate(0, 0, ZF);
    const left = new THREE.Mesh(bin, M.plastic);
    const right = new THREE.Mesh(bin, M.plastic);
    right.scale.x = -1;
    right.position.x = 2 * CX;
    g.add(left, right);
    // door joints and latches every 1.6 m
    const seam = new THREE.BoxGeometry(0.03, 0.4, 0.006);
    const latch = new RoundedBoxGeometry(0.03, 0.02, 0.13, 2, 0.008);
    const seams = [];
    const latches = [];
    for (let z = ZB - 0.8; z > ZF; z -= 1.6) {
      for (const side of [1, -1]) {
        seams.push(M4(mir(0.345, side), 0.66, z));
        latches.push(M4(mir(0.315, side), 0.415, z + 0.8));
      }
    }
    add(placeAll(seam, seams), std({ color: '#aab2bd', roughness: 0.6 }));
    add(placeAll(latch, latches), M.dark);
    // passenger service units: panel, gaspers, reading lights
    const psu = new THREE.PlaneGeometry(0.34, 0.42);
    psu.rotateX(Math.PI / 2);
    const gasp = new THREE.CylinderGeometry(0.011, 0.016, 0.022, 14);
    const pm = [];
    const gm = [];
    for (const z of ROWS)
      for (const side of [1, -1]) {
        pm.push(M4(mir(0.04, side), BIN_Y - 0.002, z - 0.3, side > 0 ? new THREE.Quaternion() : qY(Math.PI)));
        for (let k = 0; k < 3; k++) gm.push(M4(mir(-0.065 + k * 0.1, side), BIN_Y - 0.013, z - 0.3 + 0.062));
      }
    add(placeAll(psu, pm), M.psu);
    add(placeAll(gasp, gm), M.gasper);
    // row numbers on the bin edge, facing the aisle
    const nRows = ROWS.length;
    const atlas = cnv(128 * nRows, 128);
    const ax = atlas.getContext('2d');
    ax.fillStyle = '#3a4250';
    ax.fillRect(0, 0, atlas.width, 128);
    ax.textAlign = 'center';
    ax.textBaseline = 'middle';
    const rowNo = ROWS.map((z) => (z <= 0 ? Math.round(12 - (z < 0 ? (-z - 0.6) / 0.8 : 0)) : 12 + Math.round(z / 0.8)));
    rowNo.forEach((n, i) => {
      ['A B C', 'D E F'].forEach((letters, half) => {
        ax.fillStyle = '#ffffff';
        ax.font = '800 40px Nunito, Arial';
        ax.fillText(String(n), i * 128 + 40, 33 + half * 64);
        ax.font = '700 22px Nunito, Arial';
        ax.fillStyle = '#c9d2e0';
        ax.fillText(letters, i * 128 + 92, 34 + half * 64);
      });
    });
    const labelTex = tex(atlas);
    const geos = [];
    ROWS.forEach((z, i) => {
      for (const side of [1, -1]) {
        const p = new THREE.PlaneGeometry(0.11, 0.055);
        const u0 = i / nRows, u1 = (i + 1) / nRows;
        const uvA = p.attributes.uv;
        for (let k = 0; k < uvA.count; k++) {
          uvA.setX(k, uvA.getX(k) < 0.5 ? u0 : u1);
          const top = uvA.getY(k) > 0.5;
          uvA.setY(k, side > 0 ? (top ? 1 : 0.5) : top ? 0.5 : 0);
        }
        p.applyMatrix4(M4(mir(0.348, side), 0.47, z - 0.1, qY(side > 0 ? Math.PI / 2 : -Math.PI / 2).multiply(qX(-0.25))));
        geos.push(p);
      }
    });
    add(mergeGeometries(geos), std({ map: labelTex, roughness: 0.5 }));
  }

  // --- seatbelt signs (lit in the service units)
  const signTex = (() => {
    const c = cnv(256, 128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e2330';
    rrect(ctx, 4, 4, 248, 120, 18);
    ctx.fill();
    ctx.strokeStyle = '#ffd27a';
    ctx.fillStyle = '#ffd27a';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(48, 64);
    ctx.lineTo(108, 64);
    ctx.moveTo(148, 64);
    ctx.lineTo(208, 64);
    ctx.stroke();
    rrect(ctx, 104, 44, 48, 40, 8);
    ctx.fill();
    ctx.fillStyle = '#1e2330';
    rrect(ctx, 116, 56, 24, 16, 4);
    ctx.fill();
    return tex(c);
  })();
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, color: '#555555', fog: false, toneMapped: false });
  {
    const sg = new THREE.PlaneGeometry(0.1, 0.05);
    const ms = [];
    for (const z of ROWS) for (const side of [1, -1]) ms.push(M4(mir(0.04, side), BIN_Y - 0.004, z - 0.44, qX(Math.PI / 2 - 0.35)));
    add(placeAll(sg, ms), signMat);
  }

  // --- front bulkhead and rear wall
  {
    const bt = cnv(1024, 640);
    const ctx = bt.getContext('2d');
    ctx.fillStyle = '#e9edf2';
    ctx.fillRect(0, 0, 1024, 640);
    const cx = ((CX + 0.45) / 3.7) * 1024;
    ctx.fillStyle = '#2c3d66';
    ctx.fillRect(cx - 70, 150, 140, 490);
    ctx.strokeStyle = '#22325a';
    ctx.lineWidth = 6;
    for (let x = cx - 60; x < cx + 70; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 160);
      ctx.lineTo(x, 640);
      ctx.stroke();
    }
    ctx.fillStyle = '#1aa14a';
    rrect(ctx, cx - 70, 70, 140, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '800 40px Nunito, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', cx, 99);
    for (const x of [1024 * 0.2, 1024 * 0.8]) {
      drawCloudIcon(ctx, x, 270, 60, '#7fb2ff');
      ctx.fillStyle = '#1f6f8b';
      ctx.font = '800 42px Nunito, Arial';
      ctx.fillText('Nimbus Air', x, 360);
    }
    const bulk = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.3), std({ map: tex(bt), roughness: 0.6 }));
    bulk.position.set(CX, 0.05, ZF);
    g.add(bulk);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.3), std({ color: '#e7ebf0', roughness: 0.6 }));
    back.position.set(CX, 0.05, ZB);
    back.rotation.y = Math.PI;
    g.add(back);
  }

  // --- seats
  const tilt = qX(0.12);
  const v = new THREE.Vector3();
  const at = (P, x, y, z) => v.set(x, y, z).applyQuaternion(tilt).add(P).clone();
  const parts = {
    cushion: { geo: new RoundedBoxGeometry(0.44, 0.11, 0.47, 2, 0.04), mat: M.fabric, m: [] },
    back: { geo: new RoundedBoxGeometry(0.44, 0.7, 0.085, 1, 0.035), mat: M.fabric, m: [] },
    shell: { geo: new RoundedBoxGeometry(0.45, 0.66, 0.036, 1, 0.016), mat: M.shell, m: [] },
    head: { geo: new RoundedBoxGeometry(0.4, 0.2, 0.11, 2, 0.045), mat: M.linen, m: [] },
    cover: { geo: new THREE.PlaneGeometry(0.33, 0.145), mat: M.cover, m: [] },
    tray: { geo: new RoundedBoxGeometry(0.34, 0.24, 0.012, 1, 0.005), mat: M.tray, m: [] },
    latch: { geo: new RoundedBoxGeometry(0.05, 0.016, 0.012, 1, 0.004), mat: M.dark, m: [] },
    pocket: { geo: new RoundedBoxGeometry(0.36, 0.14, 0.024, 1, 0.01), mat: M.pocket, m: [] },
    cards: { geo: null, mat: M.card, m: [] },
    belts: { geo: null, mat: M.belt, m: [] },
  };
  {
    const card = new THREE.PlaneGeometry(0.13, 0.18);
    card.attributes.uv.array.forEach((_, i, a) => i % 2 === 0 && (a[i] = a[i] * 0.43));
    card.translate(-0.09, 0, 0);
    const mag = new THREE.PlaneGeometry(0.17, 0.21);
    mag.attributes.uv.array.forEach((_, i, a) => i % 2 === 0 && (a[i] = 0.47 + a[i] * 0.53));
    mag.translate(0.07, 0.01, 0.006);
    parts.cards.geo = mergeGeometries([card, mag]);
    const strap = new RoundedBoxGeometry(0.045, 0.008, 0.26, 1, 0.003);
    parts.belts.geo = mergeGeometries([strap.clone().translate(-0.19, 0, 0), strap.clone().translate(0.19, 0, 0)]);
  }
  for (const z of ROWS) {
    for (const x of SEAT_XS) {
      const P = new THREE.Vector3(x, -0.58, z + 0.22);
      parts.cushion.m.push(M4(x, -0.615, z - 0.02));
      parts.back.m.push(M4(...at(P, 0, 0.37, 0).toArray(), tilt));
      parts.shell.m.push(M4(...at(P, 0, 0.34, 0.058).toArray(), tilt));
      parts.head.m.push(M4(...at(P, 0, 0.76, 0.005).toArray(), tilt));
      parts.cover.m.push(M4(...at(P, 0, 0.765, 0.0615).toArray(), tilt));
      parts.tray.m.push(M4(...at(P, 0, 0.45, 0.082).toArray(), tilt));
      parts.latch.m.push(M4(...at(P, 0, 0.585, 0.084).toArray(), tilt));
      parts.pocket.m.push(M4(...at(P, 0, 0.17, 0.088).toArray(), tilt));
      parts.cards.m.push(M4(...at(P, 0, 0.215, 0.081).toArray(), tilt));
      if (!(x === 0 && z === 0)) parts.belts.m.push(M4(x, -0.556, z - 0.06));
    }
  }
  for (const p of Object.values(parts)) {
    const im = new THREE.InstancedMesh(p.geo, p.mat, p.m.length);
    p.m.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    g.add(im);
  }
  // armrests, frames, legs
  {
    const arm = new RoundedBoxGeometry(0.05, 0.055, 0.4, 1, 0.022);
    const am = [];
    for (const z of ROWS) for (const ax of [-0.24, 0.24, 0.72, 1.2, 1.6, 2.08, 2.56, 3.04]) am.push(M4(ax, -0.43, z - 0.02));
    const ia = new THREE.InstancedMesh(arm, M.dark, am.length);
    am.forEach((m, i) => ia.setMatrixAt(i, m));
    g.add(ia);
    const beam = new THREE.CylinderGeometry(0.018, 0.018, 1.36, 10).rotateZ(Math.PI / 2);
    const leg = new RoundedBoxGeometry(0.03, 0.34, 0.05, 1, 0.01);
    const bm = [];
    const lm = [];
    for (const z of ROWS)
      for (const bx of BLOCKS) {
        bm.push(M4(bx, -0.74, z - 0.14), M4(bx, -0.74, z + 0.14));
        lm.push(M4(bx - 0.5, -0.93, z), M4(bx + 0.5, -0.93, z));
      }
    add(placeAll(beam, bm), M.metal);
    add(placeAll(leg, lm), M.metal);
    // soft shadows under every seat block
    const blob = new THREE.PlaneGeometry(1.5, 0.8).rotateX(-Math.PI / 2);
    const sm = [];
    for (const z of ROWS) for (const bx of BLOCKS) sm.push(M4(bx, FLOOR + 0.006, z + 0.05));
    const shadow = add(placeAll(blob, sm), new THREE.MeshBasicMaterial({ map: T.blob, color: '#000000', transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    shadow.material.blending = THREE.NormalBlending;
    shadow.renderOrder = 2;
  }

  // --- sunlight through the right-hand windows (the sun is to the right), landing on the window seats
  const sunMat = new THREE.MeshBasicMaterial({ map: T.sun, color: '#ffe3b8', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  {
    const pg = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
    const sm = [];
    for (const zw of WINDOWS) {
      const zp = zw + 0.45;
      const onSeat = ROWS.some((z) => Math.abs(zp - (z - 0.02)) < 0.17);
      if (onSeat) sm.push(M4(2.71, -0.557, zp, qY(-0.12)));
    }
    const sun = add(placeAll(pg, sm), sunMat);
    sun.renderOrder = 3;
  }

  // --- armrest tray, cup and water
  const tray = new THREE.Group();
  tray.add(new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.018, 0.29, 2, 0.008), M.tray));
  const cup = new THREE.Group();
  const cupMat = std({ color: '#fbfbfb', roughness: 0.6, side: THREE.DoubleSide });
  cup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.095, 28, 1, true), cupMat));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0025, 8, 32), cupMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.0475;
  cup.add(rim);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0335, 0.016, 28, 1, true), std({ color: '#25a69a', roughness: 0.6 }));
  band.position.y = 0.01;
  cup.add(band);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.032, 28), std({ color: '#8fd0ff', roughness: 0.08, metalness: 0.1, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2;
  const waterPivot = new THREE.Group();
  waterPivot.position.y = 0.028;
  waterPivot.add(water);
  cup.add(waterPivot);
  cup.position.set(0.07, 0.058, 0.03);
  tray.add(cup);
  tray.position.set(0, -0.36, -0.36);
  g.add(tray);

  // --- the child's own seatbelt
  const metal = M.metal;
  const beltOpen = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.008, 0.26, 1, 0.003), M.belt);
    b.position.set(s * 0.19, -0.556, -0.06);
    beltOpen.add(b);
    const tab = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.012, 0.055, 1, 0.004), metal);
    tab.position.set(s * 0.19, -0.553, -0.2);
    beltOpen.add(tab);
  }
  const beltClosed = new THREE.Group();
  const strap = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.01, 0.048, 1, 0.003), M.belt);
  strap.position.set(0, -0.47, -0.13);
  const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.016, 0.062, 2, 0.006), metal);
  buckle.position.set(0, -0.461, -0.13);
  const lever = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.008, 0.045, 1, 0.003), std({ color: '#dfe3e8', roughness: 0.2, metalness: 0.9 }));
  lever.position.set(0, -0.452, -0.128);
  beltClosed.add(strap, buckle, lever);
  g.add(beltOpen, beltClosed);

  return {
    group: g,
    tray,
    cup,
    waterPivot,
    signMat,
    setBelt(on) {
      beltOpen.visible = !on;
      beltClosed.visible = on;
    },
    setSign(on) {
      signMat.color.set(on ? '#ffffff' : '#4a4a4a');
    },
    // 0 = overcast / inside a cloud, 1 = full sun
    setSun(k) {
      sunMat.opacity = 0.32 * k;
    },
  };
}
