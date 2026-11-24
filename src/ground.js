// The world outside during taxi, takeoff and landing: a Norwegian landscape with fields,
// crop rows, forest, lakes, roads and small villages; close-up detail that sharpens near
// the ground; and an airport with a textured runway, shoulders, markings, lights (edge,
// taxiway, PAPI, approach lights with a running "rabbit"), signs, a windsock, a terminal
// with parked planes, a tower, hangars, trees where the map shows forest, grass tufts,
// and the plane's own shadow racing over the ground.
//
// Frame: the cabin frame (eyes at the origin, nose toward -Z). Everything in `airport`
// moves with the distance flown; the big ground plane scrolls its texture in step.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CX, GROUND_Y, CLOUD_ALT, FLOOR, FUSE_Y as W_FUSE_Y, rng, canvasTex, concreteTexture, offsetMat, lambert, cloudField, makeAirliner, glowTex } from './world.js';
import { bakeStatic } from './aircraft.js';
import { periodicNoise, mountainRange } from './terrain.js';

const TILE = 2400; // metres per repeat of the landscape texture
const GS = 20000; // size of the ground plane
const DT = 7; // metres per repeat of the close-up detail texture
const gy = GROUND_Y;

// ------------------------------------------------------------------ helpers
function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function texOf(c, { srgb = true, repeat = null, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
function normalFromCanvas(c, strength) {
  const w = c.width, h = c.height;
  const src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cnv(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127.5 + 127.5;
      img.data[i + 1] = (dy / l) * 127.5 + 127.5;
      img.data[i + 2] = (1 / l) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return texOf(out, { srgb: false });
}
// Close-up detail: multiplies the material's colour by a fine tiled texture that fades with distance.
function withDetail(mat, detailTex, { repeat, offset = null, strength = 0.9, near = 70, far = 1400, key = 'd' }) {
  const off = offset || { value: new THREE.Vector2() };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detailTex };
    sh.uniforms.uDRep = { value: new THREE.Vector2(...repeat) };
    sh.uniforms.uDOff = off;
    sh.uniforms.uDStr = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDUv;\nuniform vec2 uDRep;\nuniform vec2 uDOff;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDUv = uv * uDRep + uDOff;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDUv;\nuniform sampler2D tDetail;\nuniform float uDStr;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float fd = 1.0 - smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, length(vViewPosition));
          vec3 d1 = texture2D(tDetail, vDUv).rgb * 2.0;
          vec3 d2 = texture2D(tDetail, vDUv * 0.071 + vec2(0.37, 0.11)).rgb * 2.0;
          diffuseColor.rgb *= mix(vec3(1.0), d1, fd * uDStr) * mix(vec3(1.0), d2, 0.55);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'detail-' + key;
  return off;
}
// Merge many simple shapes, each with its own colour, into one mesh (one draw call).
class Batch {
  constructor() {
    this.geos = [];
  }
  add(geo, color, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return this;
  }
  mesh(mat) {
    return new THREE.Mesh(mergeGeometries(this.geos), mat || lambert('#ffffff', { vertexColors: true }));
  }
}
const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
function lightPoints(pos, color, size, opacity = 0.9) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({ color, size, map: glowTex(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
}

// ------------------------------------------------------------------ the landscape texture
function makeLand() {
  const N = 2048, K = 512;
  const R = rng(42);
  const c = cnv(N, N);
  const ctx = c.getContext('2d');
  const k = cnv(K, K);
  const kx = k.getContext('2d');
  kx.scale(K / N, K / N);
  // forest base: soft noise, scaled up, then crowns as speckles
  {
    const B = 512;
    const b = cnv(B, B);
    const bx = b.getContext('2d');
    const img = bx.createImageData(B, B);
    const n1 = periodicNoise(16, 1), n2 = periodicNoise(64, 2);
    for (let y = 0; y < B; y++)
      for (let x = 0; x < B; x++) {
        const t = 0.6 * n1(x / 32, y / 32) + 0.4 * n2(x / 8, y / 8);
        const i = (y * B + x) * 4;
        img.data[i] = 34 + 34 * t;
        img.data[i + 1] = 58 + 42 * t;
        img.data[i + 2] = 33 + 22 * t;
        img.data[i + 3] = 255;
      }
    bx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b, 0, 0, N, N);
    for (let i = 0; i < 70000; i++) {
      const v = R();
      ctx.fillStyle = v < 0.5 ? `rgba(20,38,22,${0.35 + 0.3 * R()})` : `rgba(90,128,72,${0.2 + 0.25 * R()})`;
      const s = 2 + Math.floor(R() * 3);
      ctx.fillRect(R() * N, R() * N, s, s);
    }
    kx.fillStyle = 'rgb(0,0,0)';
    kx.fillRect(0, 0, N, N);
  }
  // draw something at (x, y) and again across the tile edges so the texture repeats seamlessly
  const wrapDraw = (x, y, r, fn) => {
    for (const dx of [-N, 0, N])
      for (const dy of [-N, 0, N]) {
        if (x + dx < -r || x + dx > N + r || y + dy < -r || y + dy > N + r) continue;
        fn(x + dx, y + dy);
      }
  };
  // farmland in a few valleys
  const fieldCols = ['#8fb45f', '#9fbe66', '#b9b86a', '#c9b779', '#a7b55e', '#7ea456', '#9b8a5e', '#bfc27c'];
  const valleys = Array.from({ length: 7 }, () => ({ x: R() * N, y: R() * N, a: R() * Math.PI, n: 14 + Math.floor(R() * 18) }));
  for (const v of valleys) {
    for (let i = 0; i < v.n; i++) {
      const t = (R() - 0.5) * 900;
      const x = v.x + Math.cos(v.a) * t + (R() - 0.5) * 220;
      const y = v.y + Math.sin(v.a) * t + (R() - 0.5) * 220;
      const w = 50 + R() * 140, h = 40 + R() * 110, rot = v.a + (R() - 0.5) * 0.5;
      const col = fieldCols[Math.floor(R() * fieldCols.length)];
      const rowAng = R() < 0.5 ? 0 : Math.PI / 2;
      wrapDraw(x, y, 200, (px, py) => {
        for (const [cx, isK] of [[ctx, false], [kx, true]]) {
          cx.save();
          cx.translate(px, py);
          cx.rotate(rot);
          cx.fillStyle = isK ? 'rgb(80,0,0)' : col;
          cx.fillRect(-w / 2, -h / 2, w, h);
          if (!isK) {
            // crop rows
            cx.save();
            cx.beginPath();
            cx.rect(-w / 2, -h / 2, w, h);
            cx.clip();
            cx.rotate(rowAng);
            cx.strokeStyle = 'rgba(60,70,30,0.16)';
            cx.lineWidth = 1;
            for (let r = -200; r < 200; r += 3) {
              cx.beginPath();
              cx.moveTo(-200, r);
              cx.lineTo(200, r);
              cx.stroke();
            }
            cx.restore();
            cx.strokeStyle = 'rgba(40,62,32,0.55)';
            cx.lineWidth = 2.5;
            cx.strokeRect(-w / 2, -h / 2, w, h);
          }
          cx.restore();
        }
      });
    }
  }
  // lakes with a lighter shore
  for (let l = 0; l < 4; l++) {
    const x = R() * N, y = R() * N;
    const blobs = Array.from({ length: 6 + Math.floor(R() * 5) }, () => [(R() - 0.5) * 220, (R() - 0.5) * 160, 40 + R() * 90, 25 + R() * 60, R() * 3]);
    wrapDraw(x, y, 320, (px, py) => {
      for (const [fill, grow, cx] of [['#8aa79a', 6, ctx], ['#3a668e', 0, ctx], ['rgb(160,0,0)', 0, kx]]) {
        cx.fillStyle = fill;
        for (const [bx, by, rx, ry, a] of blobs) {
          cx.beginPath();
          cx.ellipse(px + bx, py + by, rx + grow, ry + grow, a, 0, Math.PI * 2);
          cx.fill();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (const [bx, by, rx, ry, a] of blobs) {
        ctx.beginPath();
        ctx.ellipse(px + bx - rx * 0.2, py + by - ry * 0.2, rx * 0.5, ry * 0.4, a, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // roads, with villages along them
  const villages = [];
  for (let r = 0; r < 7; r++) {
    const p0 = [R() * N, R() * N], p3 = [p0[0] + (R() - 0.5) * 1600, p0[1] + (R() - 0.5) * 1600];
    const p1 = [p0[0] + (R() - 0.5) * 900, p0[1] + (R() - 0.5) * 900], p2 = [p3[0] + (R() - 0.5) * 900, p3[1] + (R() - 0.5) * 900];
    const draw = (cx, w, col) => {
      cx.strokeStyle = col;
      cx.lineWidth = w;
      cx.beginPath();
      cx.moveTo(...p0);
      cx.bezierCurveTo(...p1, ...p2, ...p3);
      cx.stroke();
    };
    draw(ctx, 6, 'rgba(70,72,66,0.75)');
    draw(ctx, 3.5, '#b0ab9f');
    draw(kx, 8, 'rgb(240,0,0)');
    for (let v = 0; v < 2; v++) {
      const t = R();
      const bez = (a, b, c2, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c2 + t ** 3 * d;
      villages.push([bez(p0[0], p1[0], p2[0], p3[0]), bez(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  for (const [vx, vy] of villages) {
    const n = 8 + Math.floor(R() * 14);
    const houses = Array.from({ length: n }, () => [(R() - 0.5) * 70, (R() - 0.5) * 70, ['#a33a2e', '#e9e6dd', '#d8b44e', '#a33a2e', '#f0efe9'][Math.floor(R() * 5)]]);
    wrapDraw(vx, vy, 120, (px, py) => {
      ctx.fillStyle = 'rgba(126,155,92,0.9)';
      ctx.beginPath();
      ctx.arc(px, py, 46, 0, Math.PI * 2);
      ctx.fill();
      kx.fillStyle = 'rgb(240,0,0)';
      kx.beginPath();
      kx.arc(px, py, 46, 0, Math.PI * 2);
      kx.fill();
      for (const [hx, hy, col] of houses) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + hx + 1, py + hy + 1, 5, 4);
        ctx.fillStyle = col;
        ctx.fillRect(px + hx, py + hy, 5, 4);
      }
    });
  }
  const kd = kx.getImageData(0, 0, K, K).data;
  const classify = (u, v) => {
    const px = Math.floor((((u % 1) + 1) % 1) * K);
    const py = Math.floor((1 - (((v % 1) + 1) % 1)) * K) % K;
    return kd[(py * K + px) * 4];
  };
  return { tex: texOf(c), classify };
}

function makeDetail() {
  const N = 512;
  const c = cnv(N, N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const n1 = periodicNoise(32, 5), n2 = periodicNoise(128, 6);
  const R = rng(7);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = 0.5 + 0.2 * (n1(x / 16, y / 16) - 0.5) + 0.16 * (n2(x / 4, y / 4) - 0.5) + 0.08 * (R() - 0.5);
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, v * 262);
      img.data[i + 1] = Math.min(255, v * 255);
      img.data[i + 2] = Math.min(255, v * 240);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 5000; i++) {
    const x = R() * N, y = R() * N, a = R() * Math.PI, l = 3 + R() * 7;
    ctx.strokeStyle = R() < 0.5 ? 'rgba(255,255,230,0.12)' : 'rgba(0,20,0,0.14)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return texOf(c, { srgb: false });
}

function makeMowedGrass() {
  const c = cnv(128, 512);
  const ctx = c.getContext('2d');
  for (let b = 0; b < 8; b++) {
    ctx.fillStyle = b % 2 ? '#86b25a' : '#79a651';
    ctx.fillRect(0, b * 64, 128, 64);
  }
  const R = rng(8);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = R() < 0.5 ? 'rgba(255,255,200,0.07)' : 'rgba(0,30,0,0.08)';
    ctx.fillRect(R() * 128, R() * 512, 2, 2);
  }
  return c;
}

function makeAsphalt() {
  const N = 512;
  const c = cnv(N, N);
  const h = cnv(N, N);
  const ctx = c.getContext('2d');
  const hx = h.getContext('2d');
  ctx.fillStyle = '#55585d';
  ctx.fillRect(0, 0, N, N);
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, N, N);
  const R = rng(9);
  const n = periodicNoise(16, 10);
  const img = ctx.getImageData(0, 0, N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const t = (n(x / 32, y / 32) - 0.5) * 14;
      img.data[i] += t;
      img.data[i + 1] += t;
      img.data[i + 2] += t;
    }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 26000; i++) {
    const x = R() * N, y = R() * N;
    const light = R() < 0.5;
    ctx.fillStyle = light ? 'rgba(160,160,160,0.12)' : 'rgba(20,20,24,0.14)';
    ctx.fillRect(x, y, 1.5, 1.5);
    hx.fillStyle = light ? '#a0a0a0' : '#606060';
    hx.fillRect(x, y, 1.5, 1.5);
  }
  // a longitudinal paving joint
  ctx.fillStyle = 'rgba(20,20,22,0.35)';
  ctx.fillRect(N * 0.5, 0, 1.5, N);
  return { map: texOf(c), normal: normalFromCanvas(h, 2.5) };
}

// ------------------------------------------------------------------ trees and houses
function treeGeometries() {
  const col = (g, c) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const cc = new THREE.Color(c);
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([cc.r, cc.g, cc.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const pine = mergeGeometries([
    col(new THREE.CylinderGeometry(0.03, 0.05, 0.25, 4, 1, true).translate(0, 0.125, 0), '#4a3a2c'),
    col(new THREE.ConeGeometry(0.3, 0.42, 6, 1, true).translate(0, 0.36, 0), '#ffffff'),
    col(new THREE.ConeGeometry(0.24, 0.36, 6, 1, true).translate(0, 0.58, 0), '#ffffff'),
    col(new THREE.ConeGeometry(0.16, 0.3, 6, 1, true).translate(0, 0.82, 0), '#ffffff'),
  ]);
  const birch = mergeGeometries([
    col(new THREE.CylinderGeometry(0.03, 0.045, 0.55, 4, 1, true).translate(0, 0.275, 0), '#e6e4dc'),
    col(new THREE.IcosahedronGeometry(0.26, 0).scale(1, 1.25, 1).translate(0, 0.66, 0), '#ffffff'),
    col(new THREE.IcosahedronGeometry(0.18, 0).translate(0.1, 0.86, 0.05), '#ffffff'),
  ]);
  return { pine, birch };
}

// instanced trees split into chunks so the half you are not looking at is skipped
function forest(points, geo, mat, chunkSize = 2800) {
  const chunks = new Map();
  for (const p of points) {
    const key = Math.floor(p.x / chunkSize) + ',' + Math.floor(p.z / chunkSize);
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(p);
  }
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s * p.w, p.s, p.s * p.w)));
      im.setColorAt(i, p.c);
    });
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

// ------------------------------------------------------------------ the plane's shadow
function shadowTexture() {
  const S = 512;
  const c = cnv(S, S);
  const ctx = c.getContext('2d');
  const m = S / 42; // px per metre, 42 m across
  const P = (x, z) => [S / 2 + x * m, S / 2 + z * m];
  ctx.fillStyle = '#fff';
  const poly = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(...p)) : ctx.moveTo(...P(...p))));
    ctx.closePath();
    ctx.fill();
  };
  // fuselage (nose toward -Z, at the top of the canvas)
  ctx.beginPath();
  ctx.ellipse(...P(0, 0), 2 * m, 19 * m, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    poly([[s * 1.9, 0.2], [s * 18.5, 7.0], [s * 18.5, 8.3], [s * 1.9, 5.2]]);
    poly([[s * 0.5, 15.3], [s * 6.5, 19.4], [s * 6.5, 20.5], [s * 0.5, 18.9]]);
    ctx.beginPath();
    ctx.ellipse(...P(s * 6.9, -1.0), 1.0 * m, 2.6 * m, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const b = cnv(S, S);
  const bx = b.getContext('2d');
  bx.fillStyle = '#000';
  bx.fillRect(0, 0, S, S);
  bx.filter = 'blur(5px)';
  bx.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(b);
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ build it all
export function buildOutside() {
  const g = new THREE.Group();
  const land = makeLand();
  const detail = makeDetail();

  // the landscape: scrolls with the airport so trees and houses stay on their forest and villages
  const groundTex = land.tex;
  groundTex.repeat.set(GS / TILE, GS / TILE);
  const groundMat = lambert('#ffffff', { map: groundTex });
  const groundDetail = withDetail(groundMat, detail, { repeat: [GS / DT, GS / DT], strength: 0.85, near: 120, far: 2200, key: 'ground' });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = gy - 0.05;
  g.add(ground);

  // ---------------- airport (airport-local coordinates; moves with distance)
  const airport = new THREE.Group();
  g.add(airport);
  const flat = (w, l, mat, x, z, y = gy) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    airport.add(m);
    return m;
  };
  // mowed grass over the whole airfield
  const AX0 = CX - 720, AX1 = CX + 320, AZ0 = -3720, AZ1 = 1120;
  {
    const t = texOf(makeMowedGrass(), { repeat: [(AX1 - AX0) / 48, (AZ1 - AZ0) / 48] });
    const m = offsetMat(lambert('#ffffff', { map: t }), -1);
    withDetail(m, detail, { repeat: [(AX1 - AX0) / DT, (AZ1 - AZ0) / DT], strength: 1.0, near: 40, far: 900, key: 'grass' });
    flat(AX1 - AX0, AZ1 - AZ0, m, (AX0 + AX1) / 2, (AZ0 + AZ1) / 2);
  }
  // runway: asphalt, lighter shoulders, markings
  const asphalt = makeAsphalt();
  {
    // shoulders and taxiways are older, sun-bleached asphalt: lighter than the runway
    const mk = (w, k, rep) => {
      const map = asphalt.map.clone();
      map.needsUpdate = true;
      map.repeat.set(1, 3000 / rep);
      return offsetMat(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(k, k * 0.98, k * 0.94), map, normalMap: asphalt.normal, roughness: 0.92, metalness: 0 }), -2);
    };
    flat(46, 3000, mk(46, 1, 46), CX, -1440);
    for (const s of [-1, 1]) flat(8, 3000, mk(8, 1.7, 30), CX + s * 27, -1440);
    flat(24, 3000, mk(24, 1.45, 24), CX - 170, -1440);
    var taxiMat = mk(24, 1.45, 24);
  }
  const paintW = offsetMat(lambert('#f2f2f0'), -4);
  const paintY = offsetMat(lambert('#f0c22e'), -4);
  {
    const geos = [];
    const P = (w, l, x, z) => geos.push(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, gy, z));
    for (const s of [-1, 1]) P(0.9, 3000, CX + s * 21.8, -1440); // edge lines
    for (let i = 0; i < 50; i++) P(0.9, 30, CX, -i * 60); // centreline
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) P(1.5, 30, CX + s * (3 + i * 2.5), 36); // threshold "piano keys"
    for (const z of [-300, -450, -600, -750]) for (const dx of [-9, -6.5, -4, 4, 6.5, 9]) P(1.8, 22, CX + dx, z); // touchdown zone
    for (const s of [-1, 1]) P(9, 45, CX + s * 9.5, -400); // aiming points
    airport.add(new THREE.Mesh(mergeGeometries(geos), paintW));
    // rubber left by thousands of landings, in the touchdown zone
    const sk = cnv(256, 1024);
    const sx = sk.getContext('2d');
    const R = rng(31);
    for (let i = 0; i < 260; i++) {
      const side = R() < 0.5 ? -1 : 1;
      const x = 128 + side * (40 + (R() - 0.5) * 50);
      const y0 = Math.pow(R(), 1.8) * 900, len = 20 + R() * 160;
      const g2 = sx.createLinearGradient(0, y0, 0, y0 + len);
      g2.addColorStop(0, 'rgba(15,15,17,0)');
      g2.addColorStop(0.15, `rgba(15,15,17,${0.25 + R() * 0.35})`);
      g2.addColorStop(1, 'rgba(15,15,17,0)');
      sx.fillStyle = g2;
      sx.fillRect(x, y0, 2 + R() * 5, len);
    }
    const skid = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 700).rotateX(-Math.PI / 2),
      offsetMat(new THREE.MeshLambertMaterial({ map: texOf(sk), transparent: true, depthWrite: false }), -3)
    );
    skid.position.set(CX, gy, -330 - 350);
    airport.add(skid);
    const yg = [];
    yg.push(new THREE.PlaneGeometry(0.4, 3000).rotateX(-Math.PI / 2).translate(CX - 170, gy, -1440));
    for (const z0 of [-180, -1400, -2700]) {
      // rapid exit taxiways, angled toward the parallel taxiway
      const len = 280;
      const ang = Math.atan2(148, 237);
      const mid = new THREE.Vector3(CX - 23 - 74, gy, z0 - 118);
      const base = new THREE.PlaneGeometry(24, len).rotateX(-Math.PI / 2);
      base.applyMatrix4(M4(mid.x, gy, mid.z, ang));
      airport.add(new THREE.Mesh(base, taxiMat));
      yg.push(new THREE.PlaneGeometry(0.4, len).rotateX(-Math.PI / 2).applyMatrix4(M4(mid.x, gy, mid.z, ang)));
    }
    airport.add(new THREE.Mesh(mergeGeometries(yg), paintY));
  }

  // lights: runway edge (with small fixtures), taxiway (blue), PAPI, approach lights + rabbit
  const fixtures = new Batch();
  const post = new THREE.CylinderGeometry(0.06, 0.08, 0.36, 6);
  {
    const edge = [];
    for (let i = 0; i <= 50; i++)
      for (const s of [-1, 1]) {
        const x = CX + s * 23.5, z = 60 - i * 60;
        edge.push(x, gy + 0.42, z);
        fixtures.add(post, '#d9c27a', M4(x, gy + 0.18, z));
      }
    airport.add(lightPoints(edge, '#fff1c8', 1.4, 0.85));
    const blue = [];
    for (let z = 60; z > -3000; z -= 60) for (const s of [-1, 1]) blue.push(CX - 170 + s * 13, gy + 0.4, z);
    airport.add(lightPoints(blue, '#5a8bff', 1.1, 0.8));
    // PAPI on the left, at the touchdown point: two red, two white = "on the glide path"
    const papi = [];
    const papiCol = [];
    for (let i = 0; i < 4; i++) {
      const x = CX - 23.5 - 15 - i * 9;
      fixtures.add(new THREE.BoxGeometry(1.4, 0.7, 1.0), '#2b2f36', M4(x, gy + 0.35, -380));
      papi.push(x, gy + 0.6, -379.4);
      const cc = new THREE.Color(i < 2 ? '#ff3b30' : '#ffffff');
      papiCol.push(cc.r, cc.g, cc.b);
    }
    const pp = lightPoints(papi, '#ffffff', 2.4, 1);
    pp.geometry.setAttribute('color', new THREE.Float32BufferAttribute(papiCol, 3));
    pp.material.vertexColors = true;
    airport.add(pp);
    // approach lights before the threshold
    const appr = [];
    for (let z = 90; z <= 900; z += 30) {
      for (let k = -2; k <= 2; k++) appr.push(CX + k * 1.0, gy + 1.2 + (z - 90) * 0.004, z);
      fixtures.add(new THREE.BoxGeometry(5, 0.12, 0.12), '#c8cdd3', M4(CX, gy + 1.1 + (z - 90) * 0.004, z));
      fixtures.add(new THREE.CylinderGeometry(0.08, 0.08, 1.2 + (z - 90) * 0.004, 5), '#c8cdd3', M4(CX, gy + 0.55 + (z - 90) * 0.002, z));
    }
    for (let x = -15; x <= 15; x += 1.5) appr.push(CX + x, gy + 2.1, 330);
    airport.add(lightPoints(appr, '#fffbe8', 1.5, 0.9));
  }
  const rabbitPos = new THREE.BufferAttribute(new Float32Array([CX, gy + 1.6, 900]), 3);
  const rabbitGeo = new THREE.BufferGeometry();
  rabbitGeo.setAttribute('position', rabbitPos);
  const rabbit = new THREE.Points(rabbitGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 5, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  airport.add(rabbit);

  // signs: taxiway exits and distance-remaining boards
  {
    const A = cnv(2048, 384);
    const ax = A.getContext('2d');
    const cell = (i, j, bg, fg, txt, border = null) => {
      const x = i * 256, y = j * 128;
      ax.fillStyle = bg;
      ax.fillRect(x, y, 256, 128);
      if (border) {
        ax.strokeStyle = border;
        ax.lineWidth = 8;
        ax.strokeRect(x + 10, y + 10, 236, 108);
      }
      ax.fillStyle = fg;
      ax.font = '800 72px Arial, sans-serif';
      ax.textAlign = 'center';
      ax.textBaseline = 'middle';
      ax.fillText(txt, x + 128, y + 68);
    };
    cell(0, 0, '#f2c230', '#111', 'A1 ↗');
    cell(1, 0, '#f2c230', '#111', 'A2 ↗');
    cell(2, 0, '#f2c230', '#111', 'A3 ↗');
    cell(3, 0, '#111', '#f2c230', 'A', '#f2c230');
    cell(4, 0, '#c62828', '#fff', '01-19');
    cell(5, 0, '#111', '#f2c230', 'B', '#f2c230');
    for (let n = 9; n >= 1; n--) {
      const k = 9 - n;
      cell(k % 8, 1 + Math.floor(k / 8), '#111', '#fff', String(n));
    }
    const atlas = texOf(A);
    const faces = [];
    const face = (cellI, cellJ, w, h, m) => {
      const p = new THREE.PlaneGeometry(w, h);
      const uv = p.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setX(i, (cellI + uv.getX(i)) / 8);
        uv.setY(i, 1 - (cellJ + 1 - uv.getY(i)) / 3);
      }
      p.applyMatrix4(m);
      faces.push(p);
    };
    const board = (x, z, ry, cells, w = 1.8, h = 0.9) => {
      cells.forEach(([ci, cj], k) => {
        const off = (k - (cells.length - 1) / 2) * w;
        const dx = Math.cos(ry) * off, dz = -Math.sin(ry) * off;
        face(ci, cj, w, h, M4(x + dx, gy + 0.95, z + dz, ry));
        face(ci, cj, w, h, M4(x + dx, gy + 0.95, z + dz, ry + Math.PI));
      });
      fixtures.add(new THREE.BoxGeometry(w * cells.length + 0.1, h + 0.1, 0.12), '#1b1e23', M4(x, gy + 0.95, z, ry));
      for (const s of [-1, 1]) fixtures.add(new THREE.BoxGeometry(0.08, 0.5, 0.08), '#9aa1aa', M4(x + Math.cos(ry) * s * w * 0.4 * cells.length, gy + 0.25, z - Math.sin(ry) * s * w * 0.4 * cells.length, ry));
    };
    [-180, -1400, -2700].forEach((z0, i) => board(CX - 34, z0 + 60, 0, [[3, 0], [i, 0]]));
    board(CX - 34, 140, 0, [[4, 0]]);
    for (let n = 9; n >= 1; n--) {
      const k = 9 - n;
      board(CX - 36, -(10 - n) * 300 + 100, Math.PI / 2, [[k % 8, 1 + Math.floor(k / 8)]], 1.4, 1.4);
    }
    airport.add(new THREE.Mesh(mergeGeometries(faces), new THREE.MeshLambertMaterial({ map: atlas, emissive: '#ffffff', emissiveMap: atlas, emissiveIntensity: 0.25 })));
  }

  // windsock (animated)
  const sock = new THREE.Group();
  {
    const st = cnv(256, 64);
    const sx = st.getContext('2d');
    for (let b = 0; b < 5; b++) {
      sx.fillStyle = b % 2 ? '#f5f5f5' : '#ff6a1a';
      sx.fillRect(b * 51.2, 0, 51.2, 64);
    }
    const cone = new THREE.CylinderGeometry(0.45, 0.16, 3.4, 14, 1, true);
    cone.rotateZ(Math.PI / 2);
    cone.translate(-1.7, 0, 0);
    const uv = cone.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    const m = new THREE.Mesh(cone, new THREE.MeshLambertMaterial({ map: texOf(st), side: THREE.DoubleSide }));
    sock.add(m);
    sock.position.set(CX - 80, gy + 6, -260);
    sock.rotation.y = Math.PI * 0.62;
    airport.add(sock);
    fixtures.add(new THREE.CylinderGeometry(0.07, 0.09, 6.2, 8), '#d8dde2', M4(CX - 80, gy + 3.1, -260));
    fixtures.add(new THREE.TorusGeometry(0.46, 0.04, 6, 16).rotateY(Math.PI / 2), '#d8dde2', M4(CX - 80, gy + 6, -260));
  }

  // terminal, apron, parked planes, tower, hangars, fuel farm, car park
  const bld = new Batch();
  const tx = CX - 455;
  {
    // apron
    flat(140, 820, offsetMat(lambert('#ffffff', { map: concreteTexture(40) }), -2), CX - 368, -1500, gy);
    bld.add(new THREE.BoxGeometry(46, 15, 360), '#dde1e6', M4(tx, gy + 7.5, -1500));
    bld.add(new THREE.BoxGeometry(50, 1.2, 364), '#9ea6b0', M4(tx, gy + 15.4, -1500));
    for (let z = -1650; z <= -1350; z += 60) bld.add(new THREE.BoxGeometry(8, 2.5, 10), '#b6bcc4', M4(tx - 6, gy + 17, z));
    const fac = cnv(512, 128);
    const fx = fac.getContext('2d');
    fx.fillStyle = '#dfe3e8';
    fx.fillRect(0, 0, 512, 128);
    for (const [y0, h] of [[14, 40], [70, 40]]) {
      const gr = fx.createLinearGradient(0, y0, 0, y0 + h);
      gr.addColorStop(0, '#5f86a6');
      gr.addColorStop(1, '#2f4f6d');
      fx.fillStyle = gr;
      fx.fillRect(0, y0, 512, h);
      fx.fillStyle = '#e8ecf0';
      for (let x = 0; x < 512; x += 24) fx.fillRect(x, y0, 3, h);
    }
    const facade = new THREE.Mesh(new THREE.PlaneGeometry(360, 15), lambert('#ffffff', { map: texOf(fac, { repeat: [14, 1] }) }));
    facade.rotation.y = Math.PI / 2;
    facade.position.set(tx + 23.05, gy + 7.5, -1500);
    airport.add(facade);
    // parked planes at the gates, nose toward the terminal, with jet bridges
    const tails = ['#c0392b', '#2e6fb5', '#e0a526', '#25a69a'];
    const parked = new THREE.Group();
    [-1335, -1445, -1555, -1665].forEach((z, i) => {
      const a = makeAirliner({ tail: tails[i], withGear: true });
      a.group.rotation.y = Math.PI / 2; // nose (-Z) toward the terminal (-X)
      a.group.position.set(tx + 23 + 21, gy + 3.3, z);
      parked.add(a.group);
      parked.updateMatrixWorld(true);
      const door = a.group.localToWorld(new THREE.Vector3(-2.1, -0.55, -11.3));
      const start = new THREE.Vector3(tx + 23, door.y + 0.2, door.z + 9);
      const len = start.distanceTo(door);
      const bm = new THREE.Matrix4().lookAt(door, start, new THREE.Vector3(0, 1, 0));
      bm.setPosition(start.clone().add(door).multiplyScalar(0.5));
      bld.add(new THREE.BoxGeometry(2.6, 2.6, len), '#c9ced5', bm);
      bld.add(new THREE.BoxGeometry(0.5, door.y - gy, 0.5), '#6d7480', M4((start.x + door.x) / 2, (door.y + gy) / 2 - 0.4, (start.z + door.z) / 2));
      // stand lead-in line
      const lead = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 60).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), paintY);
      lead.position.set(tx + 60, gy + 0.01, z);
      airport.add(lead);
    });
    airport.add(bakeStatic(parked));
    // control tower
    bld.add(new THREE.CylinderGeometry(2.4, 3.6, 34, 14), '#e3e6ea', M4(CX - 335, gy + 17, -900));
    bld.add(new THREE.CylinderGeometry(6.4, 5.0, 2.2, 16), '#cfd4da', M4(CX - 335, gy + 35, -900));
    bld.add(new THREE.CylinderGeometry(6.0, 6.0, 3.4, 16), '#2f5068', M4(CX - 335, gy + 37.8, -900));
    bld.add(new THREE.CylinderGeometry(7.0, 6.4, 0.8, 16), '#e3e6ea', M4(CX - 335, gy + 39.9, -900));
    bld.add(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), '#c33', M4(CX - 335, gy + 43.8, -900));
    // hangars with barrel roofs
    for (let i = 0; i < 3; i++) {
      const z = -2150 - i * 95;
      bld.add(new THREE.BoxGeometry(70, 18, 64), '#c6ccd3', M4(CX - 320, gy + 9, z));
      bld.add(new THREE.CylinderGeometry(32, 32, 70, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.32, 1), '#8f99a5', M4(CX - 320, gy + 18, z));
      bld.add(new THREE.BoxGeometry(0.4, 14, 54), '#7d8792', M4(CX - 284.8, gy + 7, z));
    }
    // fuel farm
    for (let i = 0; i < 3; i++) {
      bld.add(new THREE.CylinderGeometry(8, 8, 10, 20), '#f0f2f4', M4(CX - 540, gy + 5, -2480 - i * 22));
      bld.add(new THREE.SphereGeometry(8, 20, 6, 0, Math.PI * 2, 0, 0.35), '#e4e7ea', M4(CX - 540, gy + 7.8, -2480 - i * 22));
    }
    // car park
    flat(90, 260, offsetMat(lambert('#6c7076'), -2), CX - 540, -1500, gy);
    const R = rng(77);
    const carCols = ['#c0392b', '#2e6fb5', '#f2f2f2', '#1d1f24', '#9aa1aa', '#e0a526', '#2f8f5b'];
    for (let r = 0; r < 8; r++)
      for (let i = 0; i < 34; i++) {
        if (R() < 0.25) continue;
        bld.add(new THREE.BoxGeometry(1.8, 1.4, 4.4), carCols[Math.floor(R() * carCols.length)], M4(CX - 575 + r * 10, gy + 0.7, -1620 + i * 7.2));
      }
  }
  airport.add(fixtures.mesh());
  airport.add(bld.mesh());

  // trees where the map shows forest, a few by fields and houses; and villages of houses
  const { pine, birch } = treeGeometries();
  const treeMat = lambert('#ffffff', { vertexColors: true, flatShading: true });
  const landAt = (x, z) => land.classify((x + GS / 2) / TILE, (GS / 2 - z) / TILE);
  const inAirport = (x, z) => x > AX0 - 15 && x < AX1 + 15 && z > AZ0 - 15 && z < AZ1 + 15;
  {
    const R = rng(55);
    const pines = [];
    const birches = [];
    let tries = 0;
    while (pines.length + birches.length < 3400 && tries++ < 60000) {
      const x = -2800 + R() * 5600, z = -7000 + R() * 10500;
      if (inAirport(x, z)) continue;
      const c = landAt(x, z);
      const p = c < 40 ? 0.95 : c > 200 ? 0.12 : c < 120 ? 0.025 : 0;
      if (R() > p) continue;
      const isBirch = c > 40 ? R() < 0.7 : R() < 0.14;
      const h = isBirch ? 9 + R() * 7 : 11 + R() * 13;
      const tint = isBirch ? new THREE.Color().setHSL(0.24 + R() * 0.05, 0.45, 0.42 + R() * 0.1) : new THREE.Color().setHSL(0.3 + R() * 0.05, 0.4, 0.2 + R() * 0.08);
      (isBirch ? birches : pines).push({ x, y: gy, z, s: h, w: 0.9 + R() * 0.3, rot: R() * 6.28, c: tint });
    }
    airport.add(forest(pines, pine, treeMat));
    airport.add(forest(birches, birch, treeMat));
  }
  {
    const R = rng(66);
    const houses = new Batch();
    const wallCols = ['#a33a2e', '#ecebe5', '#d8b44e', '#a33a2e', '#f2f1ec', '#7b8f6a'];
    const roof = new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1, false).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).rotateY(Math.PI / 2);
    let n = 0, tries = 0;
    while (n < 320 && tries++ < 40000) {
      const x = -2600 + R() * 5200, z = -6500 + R() * 9500;
      if (inAirport(x, z) || landAt(x, z) < 200) continue;
      const big = R() < 0.15;
      const w = big ? 12 : 7 + R() * 3, d = big ? 22 : 9 + R() * 4, h = big ? 7 : 4.5;
      const ry = Math.round(R() * 2) * (Math.PI / 2) + (R() - 0.5) * 0.3;
      houses.add(new THREE.BoxGeometry(w, h, d), big ? '#a33a2e' : wallCols[Math.floor(R() * wallCols.length)], M4(x, gy + h / 2, z, ry));
      houses.add(roof, R() < 0.6 ? '#3b3f46' : '#7a3a30', M4(x, gy + h + w * 0.18, z, ry, w * 0.7, w * 0.5, d * 1.04));
      n++;
    }
    airport.add(houses.mesh(lambert('#ffffff', { vertexColors: true, flatShading: true })));
  }
  // grass tufts beside the runway: they stream past the window during takeoff and landing
  {
    const tc = cnv(128, 128);
    const tx2 = tc.getContext('2d');
    const R = rng(88);
    for (let i = 0; i < 90; i++) {
      const x = 64 + (R() - 0.5) * 90, h = 40 + R() * 80;
      const v = 170 + R() * 85;
      tx2.strokeStyle = `rgb(${v},${v},${v * 0.9})`;
      tx2.lineWidth = 2 + R() * 2;
      tx2.beginPath();
      tx2.moveTo(x, 128);
      tx2.quadraticCurveTo(x + (R() - 0.5) * 20, 128 - h * 0.6, x + (R() - 0.5) * 40, 128 - h);
      tx2.stroke();
    }
    const tex = texOf(tc);
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const tuft = mergeGeometries([quad, quad.clone().rotateY(Math.PI / 2)]);
    const mat = lambert('#ffffff', { map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    const pts = [];
    for (let i = 0; i < 9000; i++) {
      const left = R() < 0.85;
      const x = left ? CX - 31 - Math.pow(R(), 1.6) * 70 : CX + 31 + R() * 40;
      pts.push({ x, y: gy, z: 200 - R() * 3200, s: 0.35 + R() * 0.55, w: 1.7, rot: R() * 3, c: new THREE.Color().setHSL(0.25 + R() * 0.04, 0.45, 0.33 + R() * 0.1) });
    }
    airport.add(forest(pts, tuft, mat, 1700));
  }
  const mountA = mountainRange(5, gy - 10, { cx: CX, cz: -1500 });
  airport.add(mountA);

  // ---------------- gate area (parked at the terminal)
  const gate = new THREE.Group();
  g.add(gate);
  const gateParts = buildGate(gate, treeMat, pine);

  // ---------------- the plane's own shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 42).rotateX(-Math.PI / 2),
    offsetMat(new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: shadowTexture(), transparent: true, opacity: 0.5, depthWrite: false, fog: true }), -8)
  );
  shadow.renderOrder = 4;
  g.add(shadow);

  // ---------------- cloud layer (3 tiles that wrap around as we fly)
  const tiles = [];
  const TL = 1700;
  for (let t = 0; t < 3; t++) {
    const tile = cloudField({ count: 55, W: 5000, L: TL, y0: CLOUD_ALT - 25, y1: CLOUD_ALT + 15, rMin: 35, rMax: 85, seed: 100 + t });
    tile.userData.base = -TL * 1.5 + TL * (t + 0.5);
    g.add(tile);
    tiles.push(tile);
  }
  g.add(cloudField({ count: 30, W: 9000, L: 9000, y0: 1500, y1: 1800, rMin: 60, rMax: 160, seed: 300 }));

  // ---------------- the cloud sea, seen from above: a soft, broken white deck just over the
  // puffy clouds, with gaps where you can see the ground. It faces up only, so from below it
  // is invisible and you see the single clouds instead.
  const DECK = 2600; // metres per repeat
  const deckTex = (() => {
    const N = 512;
    const c = cnv(N, N);
    const x = c.getContext('2d');
    const img = x.createImageData(N, N);
    const n1 = periodicNoise(8, 61), n2 = periodicNoise(24, 62), n3 = periodicNoise(72, 63);
    for (let yy = 0; yy < N; yy++)
      for (let xx = 0; xx < N; xx++) {
        const u = xx / N, v = yy / N;
        const f = 0.55 * n1(u * 8, v * 8) + 0.3 * n2(u * 24, v * 24) + 0.15 * n3(u * 72, v * 72);
        const a = THREE.MathUtils.smoothstep(f, 0.4, 0.58);
        const shade = 0.84 + 0.16 * THREE.MathUtils.smoothstep(f, 0.45, 0.8);
        const i = (yy * N + xx) * 4;
        img.data[i] = 255 * shade;
        img.data[i + 1] = 255 * (shade * 0.99 + 0.01);
        img.data[i + 2] = 255 * Math.min(1, shade * 1.03 + 0.02);
        img.data[i + 3] = 255 * a;
      }
    x.putImageData(img, 0, 0);
    return texOf(c, { srgb: true });
  })();
  deckTex.repeat.set(20000 / DECK, 20000 / DECK);
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: deckTex, transparent: true, depthWrite: false, opacity: 0, fog: true })
  );
  deck.position.y = CLOUD_ALT + 8;
  deck.renderOrder = 2;
  deck.visible = false;
  g.add(deck);

  let rabbitT = 0;
  return {
    group: g,
    ground,
    groundTex,
    TILE,
    airport,
    gate,
    tiles,
    TL,
    ...gateParts,
    // az: where the airport is (airport.position.z); keeps the landscape locked to it
    setScroll(az) {
      groundTex.offset.y = (((az / TILE) % 1) + 1) % 1;
      groundDetail.value.set(0, (((az / DT) % 1) + 1) % 1);
    },
    // h: height of the plane above the ground; sun: direction toward the sun
    setShadow(h, sun) {
      const k = h / Math.max(0.2, sun.y);
      shadow.position.set(CX - sun.x * k, gy + 0.06, -2 - sun.z * k);
      const fade = 1 - THREE.MathUtils.smoothstep(h, 60, 420);
      shadow.material.opacity = 0.5 * fade;
      shadow.visible = fade > 0.01;
      shadow.scale.setScalar(1 + h / 500);
    },
    // alt: height above the runway; dist: distance flown (scrolls the cloud sea)
    setSkyAlt(alt, dist) {
      // mountains only below the clouds: from above they would poke out as dark islands
      const low = alt < CLOUD_ALT - 35;
      mountA.visible = low;
      gateParts.mountG.visible = low;
      const k = THREE.MathUtils.smoothstep(alt, CLOUD_ALT + 25, CLOUD_ALT + 110);
      deck.visible = k > 0.01;
      deck.material.opacity = 0.92 * k;
      deckTex.offset.y = ((dist / DECK) % 1 + 1) % 1;
    },
    update(dt, T) {
      rabbitT = (rabbitT + dt * 2.2) % 1;
      rabbitPos.setZ(0, 900 - rabbitT * 810);
      rabbitPos.needsUpdate = true;
      sock.rotation.z = Math.sin(T * 1.7) * 0.05 - 0.06;
      sock.rotation.x = Math.sin(T * 2.3) * 0.04;
    },
  };
}

// The gate: apron with markings, terminal with glass front and gate sign, jet bridge, the
// planes at the neighbouring gates, ground crew who wave goodbye, vehicles, and the taxiway
// ahead with blue edge lights and grass.
function crewMember(vest = '#ff8a1f') {
  const g = new THREE.Group();
  const mat = (c) => lambert(c);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.85, 8).translate(0, 0.43, 0), mat('#2b3442'));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.66, 10).translate(0, 1.18, 0), mat(vest));
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 10).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ color: '#e8eef2' }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8).translate(0, 1.66, 0), mat('#d9a98a'));
  const muffs = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(0, 1.68, 0), mat('#2a2d33'));
  g.add(legs, body, stripe, head, muffs);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.25, 1.45, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6).translate(0, -0.3, 0), mat(vest));
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6).translate(0, -0.75, 0), new THREE.MeshBasicMaterial({ color: '#ff5a1f' }));
    sh.add(arm, wand);
    sh.rotation.z = s * 0.15;
    g.add(sh);
    arms.push(sh);
  }
  g.userData.arms = arms;
  return g;
}

function buildGate(gate, treeMat, pine) {
  const R = rng(21);
  // ---- apron: concrete, then grass where the apron ends
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(700, 600), offsetMat(lambert('#ffffff', { map: concreteTexture(88, 75) }), -1));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-80, gy, -60);
  gate.add(apron);
  {
    const t = texOf(makeMowedGrass(), { repeat: [2400 / 48, 2400 / 48] });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), lambert('#ffffff', { map: t }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, gy - 0.02, -600);
    gate.add(grass);
    // the taxiway we roll out on
    const tw = new THREE.Mesh(new THREE.PlaneGeometry(26, 1800), offsetMat(lambert('#ffffff', { map: concreteTexture(2.6, 180) }), -1));
    tw.rotation.x = -Math.PI / 2;
    tw.position.set(CX, gy + 0.005, -1250);
    gate.add(tw);
  }
  // ---- markings
  const yel = [], red = [], wht = [];
  const P = (arr, w, l, x, z, ry = 0) => arr.push(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).rotateY(ry).translate(x, gy + 0.01, z));
  P(yel, 0.3, 2200, CX, -1000); // lead-in / taxi centreline
  for (const s of [-1, 1]) P(yel, 0.25, 1800, CX + s * 12.5, -1250); // taxiway edges
  P(yel, 0.3, 120, CX, 60); // the neighbouring stand's lead-in line
  for (const z0 of [-2, 62]) {
    P(red, 0.25, 54, CX - 22, z0); // equipment restraint lines
    P(red, 0.25, 54, CX + 22, z0);
    P(red, 44, 0.25, CX, z0 + 27);
    P(yel, 3.5, 0.35, CX - 2.2, z0 - 17.5); // stop bar
  }
  for (let z = -170; z < 140; z += 6) P(wht, 0.25, 3, CX - 32, z); // service road (dashed)
  P(wht, 0.25, 310, CX - 37, -15);
  const mk = (arr, c) => arr.length && gate.add(new THREE.Mesh(mergeGeometries(arr), offsetMat(lambert(c), -3)));
  mk(yel, '#f2c230');
  mk(red, '#d23b30');
  mk(wht, '#eef0f0');
  // painted stand number
  {
    const c = cnv(256, 128);
    const x = c.getContext('2d');
    x.fillStyle = '#f2c230';
    x.font = '900 110px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('7', 128, 68);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), offsetMat(new THREE.MeshLambertMaterial({ map: texOf(c), transparent: true }), -3));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI / 2;
    m.position.set(CX - 9, gy + 0.01, -26);
    gate.add(m);
  }
  // ---- taxiway edge lights (blue) and a sign
  {
    const blue = [];
    const posts = new Batch();
    const post = new THREE.CylinderGeometry(0.06, 0.08, 0.36, 6);
    for (let z = -60; z > -2100; z -= 30)
      for (const s of [-1, 1]) {
        blue.push(CX + s * 13.5, gy + 0.42, z);
        posts.add(post, '#cfd6dd', M4(CX + s * 13.5, gy + 0.18, z));
      }
    gate.add(lightPoints(blue, '#4f7dff', 0.9, 0.85));
    const c = cnv(512, 128);
    const x = c.getContext('2d');
    x.fillStyle = '#111';
    x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#f2c230';
    x.fillRect(256, 0, 256, 128);
    x.font = '800 80px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('B', 128, 68);
    x.fillStyle = '#111';
    x.fillText('A ↑', 384, 68);
    x.strokeStyle = '#f2c230';
    x.lineWidth = 8;
    x.strokeRect(12, 12, 232, 104);
    const sm = new THREE.MeshLambertMaterial({ map: texOf(c), emissive: '#ffffff', emissiveMap: texOf(c), emissiveIntensity: 0.25, side: THREE.DoubleSide });
    for (const z of [-260, -700]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), sm);
      m.position.set(CX - 19, gy + 0.95, z);
      m.rotation.y = Math.PI / 2 - 0.35;
      gate.add(m);
      posts.add(new THREE.BoxGeometry(3.5, 0.95, 0.12), '#1b1e23', M4(CX - 19.05, gy + 0.95, z, Math.PI / 2 - 0.35));
      for (const s of [-1, 1]) posts.add(new THREE.BoxGeometry(0.08, 0.5, 0.08), '#9aa1aa', M4(CX - 19, gy + 0.25, z + s * 1.3));
    }
    gate.add(posts.mesh());
  }

  // ---- terminal: glass front with lit interior, people, roof edge, rooftop units, gate sign
  const bld = new Batch();
  {
    // 1024 px ≈ 33 m wide, 256 px = 18 m tall (≈14 px per metre)
    const fac = cnv(1024, 256);
    const x = fac.getContext('2d');
    const m = 256 / 18;
    const Y = (h) => 256 - h * m; // canvas y for a height above the ground
    x.fillStyle = '#d6dbe1';
    x.fillRect(0, 0, 1024, 256);
    // upper floor: a band of windows (offices / lounge)
    x.fillStyle = '#5f7d96';
    x.fillRect(0, Y(13.2), 1024, 3.4 * m);
    x.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 1024; i += 48) x.fillRect(i + 4, Y(13.2) + 3, 18, 3.4 * m - 6);
    x.fillStyle = '#c9cfd6';
    for (let i = 0; i <= 1024; i += 48) x.fillRect(i - 2, Y(13.2), 4, 3.4 * m);
    // departure hall: tall glass from 0.6 m to 7 m
    const g0 = Y(7), g1 = Y(0.6);
    const gr = x.createLinearGradient(0, g0, 0, g1);
    gr.addColorStop(0, '#7f9db6');
    gr.addColorStop(0.6, '#a9bac7');
    gr.addColorStop(1, '#dcd0b6');
    x.fillStyle = gr;
    x.fillRect(0, g0, 1024, g1 - g0);
    x.fillStyle = 'rgba(255,244,214,0.8)';
    for (let i = 0; i < 1024; i += 40) x.fillRect(i + 10, g0 + 4, 20, 3); // ceiling lights
    // rows of seats and people waiting at the window (1.1–1.85 m tall)
    x.fillStyle = 'rgba(40,60,90,0.55)';
    for (let i = 0; i < 1024; i += 9) x.fillRect(i, g1 - 0.8 * m, 6, 0.8 * m);
    const RR = rng(5);
    for (let i = 0; i < 70; i++) {
      const px = RR() * 1020, h = (RR() < 0.25 ? 1.1 + RR() * 0.3 : 1.55 + RR() * 0.3) * m, w = h * 0.28;
      x.fillStyle = ['#3d4a5c', '#6b3b3b', '#2f5d50', '#5a4b7a', '#7a6a3b', '#b0574a'][Math.floor(RR() * 6)];
      x.fillRect(px - w / 2, g1 - h * 0.86, w, h * 0.86);
      x.fillStyle = '#c79a7c';
      x.beginPath();
      x.arc(px, g1 - h * 0.92, w * 0.33, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = 'rgba(255,255,255,0.13)';
    x.beginPath();
    x.moveTo(60, g0);
    x.lineTo(300, g0);
    x.lineTo(180, g1);
    x.lineTo(0, g1);
    x.fill();
    x.fillStyle = '#e9edf1';
    for (let i = 0; i <= 1024; i += 32) x.fillRect(i - 1.5, g0, 3, g1 - g0);
    x.fillRect(0, Y(3.6), 1024, 3);
    x.fillStyle = '#9aa3ad';
    x.fillRect(0, g1, 1024, 256 - g1);
    x.fillRect(0, Y(7.6), 1024, 0.6 * m);
    const tex = texOf(fac, { repeat: [9, 1] });
    const tb = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 300), [lambert('#ffffff', { map: tex }), lambert('#d3d8de'), lambert('#9aa3ad'), lambert('#d3d8de'), lambert('#d3d8de'), lambert('#d3d8de')]);
    tb.position.set(-70, gy + 9, -10);
    gate.add(tb);
    bld.add(new THREE.BoxGeometry(62, 1.0, 302), '#aeb6bf', M4(-70, gy + 18.5, -10)); // roof edge
    for (let z = -130; z < 120; z += 45) bld.add(new THREE.BoxGeometry(7, 2.6, 9), '#c3c9cf', M4(-76, gy + 20, z));
    // the round jet-bridge rotunda at each gate
    for (const z of [-9.4, 54.6, -120]) {
      bld.add(new THREE.CylinderGeometry(2.4, 2.4, 3.4, 16), '#c9ced5', M4(-38.2, FLOOR + 1.25, z));
      bld.add(new THREE.CylinderGeometry(0.5, 0.6, FLOOR + 1.25 - gy - 1.7, 8), '#7d8692', M4(-38.2, (FLOOR + 1.25 - 1.7 + gy) / 2, z));
    }
    // gate number sign on the bridge rotunda
    const c = cnv(256, 128);
    const sx = c.getContext('2d');
    sx.fillStyle = '#163a5f';
    sx.fillRect(0, 0, 256, 128);
    sx.fillStyle = '#ffffff';
    sx.font = '800 88px Arial, sans-serif';
    sx.textAlign = 'center';
    sx.textBaseline = 'middle';
    sx.fillText('7', 128, 70);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshLambertMaterial({ map: texOf(c), emissive: '#ffffff', emissiveMap: texOf(c), emissiveIntensity: 0.3 }));
    sign.position.set(-35.7, FLOOR + 3.6, -9.4);
    sign.rotation.y = Math.PI / 2;
    gate.add(sign);
    // control tower further along
    bld.add(new THREE.CylinderGeometry(2.4, 3.6, 34, 14), '#e3e6ea', M4(-190, gy + 17, -420));
    bld.add(new THREE.CylinderGeometry(6.4, 5.0, 2.2, 16), '#cfd4da', M4(-190, gy + 35, -420));
    bld.add(new THREE.CylinderGeometry(6.0, 6.0, 3.4, 16), '#2f5068', M4(-190, gy + 37.8, -420));
    bld.add(new THREE.CylinderGeometry(7.0, 6.4, 0.8, 16), '#e3e6ea', M4(-190, gy + 39.9, -420));
    // hangar
    bld.add(new THREE.BoxGeometry(70, 18, 64), '#c6ccd3', M4(-170, gy + 9, -620));
    bld.add(new THREE.CylinderGeometry(32, 32, 70, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.32, 1), '#8f99a5', M4(-170, gy + 18, -620));
    // cones around the neighbouring planes
    const cone = new THREE.ConeGeometry(0.18, 0.7, 8).translate(0, 0.35, 0);
    for (const z0 of [62]) for (const [dx, dz] of [[0, -20], [-18.5, 7], [18.5, 7], [0, 17]]) bld.add(cone, '#ff6a1a', M4(CX + dx, gy, z0 + dz));
  }
  // ---- the plane at the gate behind ours (the way ahead stays clear for taxiing)
  {
    const parked = new THREE.Group();
    [['#c0392b', 62]].forEach(([tail, z]) => {
      const a = makeAirliner({ tail, withGear: true });
      a.group.position.set(CX, W_FUSE_Y, z);
      parked.add(a.group);
      // their jet bridges, docked
      const len = 38.2 - 2.6;
      bld.add(new THREE.BoxGeometry(len, 2.5, 2.6), '#d0d5db', M4(-38.2 + 2.4 + len / 2 - 2.4, FLOOR + 1.25, z - 7.4));
      bld.add(new THREE.BoxGeometry(2.4, 2.9, 3.4), '#bfc6ce', M4(-1.95, FLOOR + 1.25, z - 7.4));
      bld.add(new THREE.BoxGeometry(0.4, FLOOR + 1.25 - 1.25 - gy, 0.4), '#6d7480', M4(-8, (FLOOR + gy) / 2, z - 7.4));
      bld.add(new THREE.BoxGeometry(1.8, 0.6, 0.8), '#2b2f36', M4(-8, gy + 0.3, z - 7.4));
    });
    gate.add(bakeStatic(parked));
  }
  // ---- our own jet bridge (moves)
  const bridgeY = FLOOR + 1.25;
  const tunnelZ = -9.4;
  const bridgeMat = lambert('#d0d5db');
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 2.6), bridgeMat);
  const bridgeCab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 3.4), lambert('#bfc6ce'));
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.7, 3.0), lambert('#2a2e34'));
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 0.4), lambert('#6d7480'));
  const wheels = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.8), lambert('#2b2f36'));
  const bridgeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb02e' }));
  gate.add(bridge, bridgeCab, canopy, leg, wheels, bridgeLamp);
  const setBridge = (xEnd) => {
    const x0 = -36;
    const len = xEnd - x0 - 1.2;
    bridge.scale.x = len;
    bridge.position.set(x0 + len / 2, bridgeY, tunnelZ);
    bridgeCab.position.set(xEnd - 1.2, bridgeY, tunnelZ);
    canopy.position.set(xEnd + 0.1, bridgeY, tunnelZ);
    canopy.visible = xEnd < -1.5;
    const lx = xEnd - 7;
    leg.scale.y = bridgeY - 1.25 - gy;
    leg.position.set(lx, (bridgeY - 1.25 + gy) / 2, tunnelZ);
    wheels.position.set(lx, gy + 0.3, tunnelZ);
    bridgeLamp.position.set(xEnd - 1.2, bridgeY + 1.55, tunnelZ);
  };
  setBridge(-0.75);
  // ---- vehicles
  const tug = new THREE.Group();
  const tugBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.6), lambert('#f2b632'));
  tugBody.position.y = 0.8;
  tug.add(tugBody);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), lambert('#3a3f47'));
  seat.position.set(0, 1.6, 0.6);
  tug.add(seat);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff9d00' }));
  beacon.position.set(0, 2.15, 0.6);
  tug.add(beacon);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 12).rotateZ(Math.PI / 2);
  const wheelMat = lambert('#1f2226');
  for (let c = 0; c <= 3; c++) {
    if (c) {
      const cart = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 2.4), lambert('#7d8a99'));
      cart.position.set(0, 0.7, c * 3.0);
      tug.add(cart);
      const bags = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.0), lambert(['#c0392b', '#2e86de', '#27ae60'][c - 1]));
      bags.position.set(0, 1.15, c * 3.0);
      tug.add(bags);
    }
    for (const sx of [-0.8, 0.8])
      for (const dz of [-0.8, 0.8]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(sx, 0.32, c * 3.0 + dz);
        tug.add(w);
      }
  }
  tug.position.set(-14, gy, 0);
  gate.add(tug);
  const truck = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 16), lambert('#f3f5f7'));
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 1.7, 0.6);
  const tcab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 1.8), lambert('#2e6fb5'));
  tcab.position.set(0, 1.4, -3.2);
  truck.add(tank, tcab);
  for (const sx of [-1, 1]) for (const z of [-3, 1.5, 3]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.scale.set(1.3, 1.5, 1.5);
    w.position.set(sx * 1.05, 0.48, z);
    truck.add(w);
  }
  truck.position.set(-22, gy, 14);
  truck.rotation.y = 0.5;
  gate.add(truck);
  const loader = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 7), lambert('#505862'));
  loader.position.set(-2.6, gy + 1.6, 9);
  loader.rotation.x = 0.28;
  gate.add(loader);
  gate.add(bld.mesh());
  // ---- ground crew: one by the nose with wands, two by the wing
  const crew = [crewMember('#ff8a1f'), crewMember('#d6f23a'), crewMember('#ff8a1f')];
  crew[0].position.set(CX - 9, gy, -24);
  crew[0].rotation.y = -Math.PI / 2 + 0.5;
  crew[1].position.set(-13, gy, -6);
  crew[1].rotation.y = -Math.PI / 2 + 0.2;
  crew[2].position.set(-16, gy, -3.5);
  crew[2].rotation.y = -Math.PI / 2 - 0.1;
  crew.forEach((c) => gate.add(c));

  const mountG = mountainRange(8, gy - 10, { r0: 4800, r1: 7600, hMax: 900 });
  gate.add(mountG);
  const pts = [];
  while (pts.length < 900) {
    const x = -1100 + R() * 2200, z = -1300 + R() * 2400;
    if (x > -460 && x < 330 && z > -420 && z < 300) continue;
    if (Math.abs(x - CX) < 60 && z < -300) continue; // keep the taxiway clear
    pts.push({ x, y: gy, z, s: 11 + R() * 12, w: 1, rot: R() * 6, c: new THREE.Color().setHSL(0.3 + R() * 0.05, 0.4, 0.22 + R() * 0.08) });
  }
  gate.add(forest(pts, pine, treeMat));

  // wave: seconds since the crew started waving (<0 = not waving); away: seconds since the tug left
  const tugHome = tug.position.clone();
  const updateGate = (T, { wave = -1, away = -1, boarding = false } = {}) => {
    beacon.visible = T % 1 < 0.5;
    bridgeLamp.visible = T % 0.8 < 0.4 && bridge.scale.x < 33;
    if (boarding) {
      tug.position.copy(tugHome);
      tug.position.z = 30 - ((T * 2.2) % 70);
      tug.rotation.y = 0;
    } else if (away >= 0) {
      // drive off toward the end of the terminal
      const d = away * 3.5;
      tug.position.set(tugHome.x - Math.min(10, d * 0.4), gy, tugHome.z + 6 - d);
      tug.rotation.y = -Math.min(0.4, d * 0.02);
    }
    crew.forEach((c, i) => {
      const [l, r] = c.userData.arms;
      if (wave >= 0 && wave < 30) {
        const k = Math.min(1, wave / 0.8);
        const w = Math.sin((wave + i * 0.4) * 5.5);
        r.rotation.z = -(2.5 + 0.35 * w) * k - 0.15 * (1 - k);
        r.rotation.x = 0;
        l.rotation.z = i === 0 ? (2.5 - 0.35 * w) * k : 0.15;
      } else if (i === 0) {
        // marshaller: wands held up, waiting
        r.rotation.z = -0.8;
        l.rotation.z = 0.8;
      } else {
        r.rotation.z = -0.15;
        l.rotation.z = 0.15;
      }
    });
  };
  return { setBridge, tug, beacon, updateGate, mountG };
}
