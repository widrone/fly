// Detailed airliner parts: a wing with a real airfoil, moving slats/flaps/spoilers,
// flap-track fairings and a curved winglet; and a turbofan with a polished lip,
// spinning fan, swirl spinner, core and plug, and a thrust reverser that slides open.
// Exterior paint is physically based and reflects a sky environment.
//
// Wing frame: root leading edge at the origin, span toward -X, chord toward +Z (aft),
// chord line at y = 0. The right wing is the same wing mirrored by its parent.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drawCloudIcon } from './ui.js';

// ------------------------------------------------------------------ paint with sky reflections
const envMats = [];
let extEnv = null;
export function paint(color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.6, ...o });
  m.envMap = extEnv;
  envMats.push(m);
  return m;
}
export function setExteriorEnv(tex) {
  extEnv = tex;
  for (const m of envMats) {
    m.envMap = tex;
    m.needsUpdate = true;
  }
}
// A small sky (blue above, dark ground below, a bright sun) baked into a reflection map.
export function makeSkyEnv(renderer, { top = '#6f97cf', hor = '#dde6ee', bot = '#56604f', sun = [0.55, 0.62, -0.55] } = {}) {
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(hor) }, bot: { value: new THREE.Color(bot) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; varying vec3 vD;
      void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor * 0.8, bot, pow(-h, 0.35)); gl_FragColor = vec4(c, 1.0); }`,
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
  const s = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.2) }));
  s.position.set(...sun).normalize().multiplyScalar(80);
  sc.add(s);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  return tex;
}

// ------------------------------------------------------------------ small helpers
function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function normalFromCanvas(c, strength = 2) {
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
  return tex(out, false);
}
let _glow = null;
function glow() {
  if (_glow) return _glow;
  const c = cnv(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glow = tex(c);
  return _glow;
}

// Build a skin from rings of points (each ring the same length). UVs: u per ring, v per point.
function loft(rings, us, vs, { closeStart = false, closeEnd = false } = {}) {
  const P = rings[0].length;
  const pos = [];
  const uv = [];
  const idx = [];
  rings.forEach((ring, k) => {
    ring.forEach((p, j) => {
      pos.push(p.x, p.y, p.z);
      uv.push(us[k], vs[j]);
    });
  });
  for (let k = 0; k < rings.length - 1; k++)
    for (let j = 0; j < P - 1; j++) {
      const a = k * P + j, b = a + 1, c = a + P, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const cap = (k, flip) => {
    const ring = rings[k];
    const ctr = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / P);
    const ci = pos.length / 3;
    pos.push(ctr.x, ctr.y, ctr.z);
    uv.push(us[k], 0.5);
    for (let j = 0; j < P - 1; j++) {
      const a = k * P + j;
      if (flip) idx.push(ci, a + 1, a);
      else idx.push(ci, a, a + 1);
    }
  };
  if (closeStart) cap(0, true);
  if (closeEnd) cap(rings.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the wing's shape
export const SPAN = 16.6;
const LE0 = -1.8, LE1 = 5.0, C0 = 5.0, C1 = 1.3;
const leZ = (s) => LE0 + (LE1 - LE0) * s;
const chordAt = (s) => C0 + (C1 - C0) * s;
const tRatio = (s) => 0.15 - 0.05 * s;
const yt = (xi) => 5 * (0.2969 * Math.sqrt(xi) - 0.126 * xi - 0.3516 * xi * xi + 0.2843 * xi ** 3 - 0.1036 * xi ** 4);
const camber = (xi) => 0.08 * xi * (1 - xi);
// a point on the wing: side +1 upper surface, -1 lower surface, 0 camber line
export function wingPoint(s, xi, side = 0, off = 0) {
  const c = chordAt(s), t = tRatio(s);
  const half = side > 0 ? t * yt(xi) : side < 0 ? -0.72 * t * yt(xi) : 0;
  return new THREE.Vector3(-SPAN * s, c * (camber(xi) + half) + off * Math.sign(side || 1), leZ(s) + xi * c);
}
const XI = (() => {
  const J = 16;
  return Array.from({ length: J + 1 }, (_, j) => (1 - Math.cos((Math.PI * j) / J)) / 2);
})();
// ring around the airfoil at span s: upper TE -> LE -> lower TE, with v linear in chord
function airfoilRing(s, xiFrom = 0, xiTo = 1, off = 0) {
  const xs = XI.map((x) => xiFrom + (xiTo - xiFrom) * x);
  const ring = [];
  const v = [];
  for (let j = xs.length - 1; j >= 0; j--) {
    ring.push(wingPoint(s, xs[j], 1, off));
    v.push(0.5 * (1 - xs[j]));
  }
  for (let j = 1; j < xs.length; j++) {
    ring.push(wingPoint(s, xs[j], -1, off));
    v.push(0.5 + 0.5 * xs[j]);
  }
  return { ring, v };
}

// ------------------------------------------------------------------ cached geometry & materials
let C = null;
function build() {
  if (C) return C;
  C = {};
  // panel lines, walkway, NO STEP, access panels
  const W = 2048, H = 512;
  const col = cnv(W, H);
  const hgt = cnv(W, H);
  const c1 = col.getContext('2d');
  const c2 = hgt.getContext('2d');
  c1.fillStyle = '#d6d8db';
  c1.fillRect(0, 0, W, H);
  c2.fillStyle = '#808080';
  c2.fillRect(0, 0, W, H);
  const vy = (xi, upper) => (1 - (upper ? 0.5 * (1 - xi) : 0.5 + 0.5 * xi)) * H;
  const line = (x0, y0, x1, y1, w = 2, a = 0.35) => {
    for (const [ctx, st] of [[c1, `rgba(70,80,95,${a})`], [c2, '#303030']]) {
      ctx.strokeStyle = st;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  };
  // shiny leading edge band
  c1.fillStyle = '#e6e8ea';
  c1.fillRect(0, vy(0.06, true), W, vy(0.06, false) - vy(0.06, true));
  // walkway near the root: slightly darker anti-slip, framed by a dashed black line
  {
    const x0 = 0.02 * W, y0 = vy(0.58, true), w = 0.11 * W, h = vy(0.22, true) - vy(0.58, true);
    c1.fillStyle = '#c3c6ca';
    c1.fillRect(x0, y0, w, h);
    c1.strokeStyle = 'rgba(30,32,36,0.8)';
    c1.lineWidth = 3;
    c1.setLineDash([14, 8]);
    c1.strokeRect(x0, y0, w, h);
    c1.setLineDash([]);
  }
  for (const upper of [true, false]) {
    for (const xi of [0.12, 0.62, 0.76]) line(0, vy(xi, upper), W, vy(xi, upper), 2.5);
    for (let s = 0; s < 1; s += 1.15 / SPAN) line(s * W, vy(0.12, upper), s * W, vy(0.62, upper), 1.5, 0.22);
  }
  // rivet rows
  c1.fillStyle = 'rgba(80,90,105,0.35)';
  for (const xi of [0.14, 0.6]) for (let x = 4; x < W; x += 9) c1.fillRect(x, vy(xi, true) - 1, 2, 2);
  // NO STEP markings along the flap line
  c1.fillStyle = 'rgba(40,45,55,0.75)';
  c1.font = '700 15px Arial, sans-serif';
  c1.textAlign = 'center';
  for (let s = 0.2; s < 0.75; s += 0.12) {
    c1.save();
    c1.translate(s * W, vy(0.7, true));
    c1.scale(1, -1);
    c1.fillText('NO STEP', 0, 5);
    c1.restore();
  }
  // access panels underneath
  for (let s = 0.08; s < 0.9; s += 0.07) {
    for (const [ctx, st] of [[c1, 'rgba(70,80,95,0.3)'], [c2, '#3a3a3a']]) {
      ctx.strokeStyle = st;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s * W, vy(0.38, false), 10, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const wingMap = tex(col);
  const wingN = normalFromCanvas(hgt, 1.5);
  C.wing = paint('#ffffff', { map: wingMap, normalMap: wingN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.5, metalness: 0.12, envMapIntensity: 0.5 });
  C.flap = paint('#c6c9cd', { roughness: 0.5, metalness: 0.15, envMapIntensity: 0.5 });
  C.metal = paint('#d9dee4', { roughness: 0.22, metalness: 0.9, side: THREE.DoubleSide });
  C.dark = paint('#2c3038', { roughness: 0.6, metalness: 0.2 });

  // main wing skin
  const S = [0, 0.04, 0.1, 0.18, 0.26, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1.0];
  const rings = S.map((s) => airfoilRing(s));
  C.wingGeo = loft(rings.map((r) => r.ring), S, rings[0].v);

  // flap-track fairings ("canoes") under the trailing edge
  const canoe = new THREE.LatheGeometry(
    Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      return new THREE.Vector2(0.001 + 0.27 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55) * (1 - 0.35 * t), t * 2.5);
    }),
    10
  );
  canoe.rotateX(Math.PI / 2);
  canoe.scale(0.6, 1, 1);
  // each canoe rides on its flap, so its tail tips down as the flap comes out
  C.canoes = [0.12, 0.24, 0.4, 0.55, 0.68].map((s) => {
    const p = wingPoint(s, 0.62, -1);
    return { s, geo: canoe.clone().translate(p.x, p.y - 0.06, p.z) };
  });
  // static wicks at the tip
  const wick = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5).rotateX(Math.PI / 2);
  C.wickGeo = mergeGeometries(
    [0.86, 0.92, 0.97].map((s) => {
      const p = wingPoint(s, 1, 0);
      return wick.clone().translate(p.x, p.y, p.z + 0.12);
    })
  );
  // curved winglet
  {
    const Rw = 0.8;
    const rr = [];
    const us = [];
    const M = 11;
    let vv = null;
    for (let m = 0; m <= M; m++) {
      let th, bx, by;
      if (m <= 6) {
        th = (Math.PI / 2) * (m / 6);
        bx = -SPAN - Rw * Math.sin(th);
        by = Rw * (1 - Math.cos(th));
      } else {
        th = Math.PI / 2;
        bx = -SPAN - Rw - (m - 6) * 0.03;
        by = Rw + (m - 6) * 0.3;
      }
      const k = m / M;
      const c = C1 + (0.5 - C1) * k;
      const le = LE1 + 0.95 * k;
      const t = 0.1 - 0.02 * k;
      const td = new THREE.Vector3(Math.sin(th), Math.cos(th), 0);
      const ring = [];
      const v = [];
      for (let j = XI.length - 1; j >= 0; j--) {
        const xi = XI[j];
        const h = c * (camber(xi) + t * yt(xi));
        ring.push(new THREE.Vector3(bx + td.x * h, by + td.y * h, le + xi * c));
        v.push(0.5 * (1 - xi));
      }
      for (let j = 1; j < XI.length; j++) {
        const xi = XI[j];
        const h = c * (camber(xi) - 0.72 * t * yt(xi));
        ring.push(new THREE.Vector3(bx + td.x * h, by + td.y * h, le + xi * c));
        v.push(0.5 + 0.5 * xi);
      }
      rr.push(ring);
      us.push(k);
      vv = v;
    }
    C.wingletGeo = loft(rr, us, vv, { closeEnd: true });
    C.winglet = new Map();
  }

  // --- engine
  const lathe = (pts, seg = 40) => {
    const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
    g.rotateX(Math.PI / 2);
    return g;
  };
  C.ductGeo = lathe([[0.79, 0.62], [0.81, 0.35], [0.84, 0.12]]);
  C.lipGeo = lathe([[0.84, 0.12], [0.87, 0.03], [0.91, 0.0], [0.95, 0.04], [0.975, 0.16]]);
  C.cowlGeo = lathe([[0.975, 0.16], [0.995, 0.45], [1.0, 0.9], [0.99, 1.6], [0.965, 2.05]]);
  C.sleeveGeo = lathe([[0.964, 2.05], [0.935, 2.6], [0.89, 3.05], [0.84, 3.42], [0.8, 3.56], [0.76, 3.45], [0.78, 2.06]]);
  C.cascadeGeo = lathe([[0.935, 2.05], [0.935, 2.62]], 40);
  C.coreGeo = lathe([[0.66, 3.2], [0.64, 3.7], [0.58, 4.2], [0.52, 4.55]]);
  C.plugGeo = lathe([[0.45, 4.45], [0.4, 4.8], [0.24, 5.1], [0.02, 5.32]], 24);
  C.spinnerGeo = lathe([[0.0, 0.14], [0.08, 0.22], [0.16, 0.34], [0.22, 0.5], [0.24, 0.64]], 24);
  C.fanDiscGeo = new THREE.CircleGeometry(0.79, 40).rotateY(Math.PI).translate(0, 0, 0.66);
  {
    const pos = [];
    const N = 22;
    for (let b = 0; b < N; b++) {
      const a = (b / N) * Math.PI * 2;
      const P = (r, ang, z) => [r * Math.cos(ang), r * Math.sin(ang), z];
      const rl = P(0.23, a - 0.08, 0.5), rt = P(0.23, a + 0.08, 0.68), tl = P(0.78, a + 0.07, 0.57), tt = P(0.78, a + 0.17, 0.63);
      pos.push(...rl, ...rt, ...tl, ...rt, ...tt, ...tl);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    C.bladeGeo = g;
  }
  {
    const s = new THREE.Shape();
    const pts = [[1.2, 0.95], [3.6, 0.92], [4.9, 1.05], [5.5, 1.26], [4.0, 1.4], [2.85, 1.38], [1.8, 1.12]];
    s.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    g.translate(0, 0, -0.13);
    g.rotateY(-Math.PI / 2);
    C.pylonGeo = g;
  }
  // nacelle livery: teal band and a cloud on the outboard side
  {
    const c = cnv(1024, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f3f5f8';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#25a69a';
    ctx.fillRect(0, 256 - 0.2 * 256, 1024, 0.1 * 256);
    ctx.fillStyle = '#9fe3dc';
    ctx.fillRect(0, 256 - 0.1 * 256, 1024, 0.02 * 256);
    drawCloudIcon(ctx, 0.75 * 1024, 256 * 0.45, 46, '#25a69a');
    C.nacelle = paint('#ffffff', { map: tex(c), roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide });
  }
  {
    const c = cnv(128, 64);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#30353d';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-10, 70);
    ctx.lineTo(70, -6);
    ctx.stroke();
    C.spinner = paint('#ffffff', { map: tex(c), roughness: 0.3, metalness: 0.6 });
  }
  {
    const c = cnv(256, 32);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#23262c';
    ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = '#4a4f58';
    for (let x = 0; x < 256; x += 6) ctx.fillRect(x, 0, 2, 32);
    C.cascade = paint('#ffffff', { map: tex(c), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  }
  C.duct = paint('#5d636d', { roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
  C.core = paint('#8b929b', { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide });
  C.plug = paint('#5f646b', { roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
  C.blades = paint('#aeb5be', { roughness: 0.25, metalness: 0.85, side: THREE.DoubleSide });
  C.blur = new THREE.MeshBasicMaterial({ color: '#5b616a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  return C;
}

// A part that swings about a hinge line p0->p1 (local axes: X inboard along the hinge, Y up, Z aft).
function hinged(geoInWingFrame, p0, p1, mat) {
  const pivot = new THREE.Object3D();
  const X = p0.clone().sub(p1).normalize();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X).normalize();
  pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  pivot.position.copy(p0);
  pivot.updateMatrix();
  const inv = pivot.matrix.clone().invert();
  const hinge = new THREE.Object3D();
  pivot.add(hinge);
  hinge.add(new THREE.Mesh(geoInWingFrame.clone().applyMatrix4(inv), mat));
  return { pivot, hinge, inv };
}
// a thin surface panel following the wing between two span stations and chord positions
function panelGeo(s0, s1, xi0, xi1, side, thick, off) {
  const rings = [s0, s1].map((s) => {
    const n = 6;
    const top = [];
    const bot = [];
    for (let i = 0; i <= n; i++) {
      const xi = xi0 + ((xi1 - xi0) * i) / n;
      const fade = side === 0 ? 1 - i / n : 1;
      const p = wingPoint(s, xi, side, off);
      top.push(p.clone().add(new THREE.Vector3(0, thick * fade * 0.5, 0)));
      bot.push(p.clone().add(new THREE.Vector3(0, -thick * fade * 0.5, 0)));
    }
    return [...top, ...bot.reverse(), top[0].clone()];
  });
  return loft(rings, [0, 1], rings[0].map((_, i, a) => i / (a.length - 1)));
}

export function makeWing({ accent = '#25a69a', nav = '#ff2a2a' } = {}) {
  const C = build();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(C.wingGeo, C.wing));
  g.add(new THREE.Mesh(C.wickGeo, C.dark));
  if (!C.winglet.has(accent)) C.winglet.set(accent, paint(accent, { roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide }));
  g.add(new THREE.Mesh(C.wingletGeo, C.winglet.get(accent)));

  // flaps (inboard, outboard)
  const flaps = [
    [0.03, 0.29],
    [0.33, 0.74],
  ].map(([s0, s1]) => {
    const geo = panelGeo(s0, s1, 0.76, 0.995, 0, 0.05, 0);
    const h = hinged(geo, wingPoint(s0, 0.76), wingPoint(s1, 0.76), C.flap);
    const mine = C.canoes.filter((c) => c.s > s0 && c.s < s1).map((c) => c.geo.clone().applyMatrix4(h.inv));
    if (mine.length) h.hinge.add(new THREE.Mesh(mergeGeometries(mine), C.flap));
    g.add(h.pivot);
    return h.hinge;
  });
  // spoilers on the upper surface in front of the flaps
  const spoilers = [
    [0.06, 0.16],
    [0.17, 0.27],
    [0.34, 0.45],
    [0.46, 0.57],
    [0.58, 0.69],
  ].map(([s0, s1]) => {
    const geo = panelGeo(s0, s1, 0.6, 0.755, 1, 0.012, 0.009);
    const h = hinged(geo, wingPoint(s0, 0.6, 1, 0.009), wingPoint(s1, 0.6, 1, 0.009), C.flap);
    g.add(h.pivot);
    return h.hinge;
  });
  // leading-edge slats: hidden while stowed, slide forward and down when extended
  const slats = [
    [0.04, 0.26],
    [0.34, 0.52],
    [0.52, 0.7],
    [0.7, 0.86],
    [0.86, 0.97],
  ].map(([s0, s1]) => {
    const rings = [s0, s1].map((s) => airfoilRing(s, 0, 0.12, 0.012));
    const geo = loft(
      rings.map((r) => r.ring),
      [s0, s1],
      rings[0].v.map((v) => v),
      { closeStart: true, closeEnd: true }
    );
    const h = hinged(geo, wingPoint(s0, 0.1, 0), wingPoint(s1, 0.1, 0), C.wing);
    h.hinge.visible = false;
    g.add(h.pivot);
    return h.hinge;
  });

  // engine on its pylon
  const eng = new THREE.Group();
  eng.position.set(-5.0, -1.43, -2.6);
  eng.add(new THREE.Mesh(C.ductGeo, C.duct), new THREE.Mesh(C.lipGeo, C.metal), new THREE.Mesh(C.cowlGeo, C.nacelle));
  const sleeve = new THREE.Mesh(C.sleeveGeo, C.nacelle);
  eng.add(sleeve, new THREE.Mesh(C.cascadeGeo, C.cascade), new THREE.Mesh(C.coreGeo, C.core), new THREE.Mesh(C.plugGeo, C.plug));
  eng.add(new THREE.Mesh(C.pylonGeo, C.wing));
  const fan = new THREE.Group();
  fan.add(new THREE.Mesh(C.bladeGeo, C.blades), new THREE.Mesh(C.spinnerGeo, C.spinner));
  eng.add(fan, new THREE.Mesh(C.fanDiscGeo, C.duct));
  const blurMat = C.blur.clone();
  const blur = new THREE.Mesh(new THREE.CircleGeometry(0.78, 32).translate(0, 0, 0.56), blurMat);
  eng.add(blur);
  g.add(eng);

  // lights: navigation (red left / green right) and a white strobe
  const navM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: nav, toneMapped: false }));
  navM.position.set(-SPAN - 0.12, 0.08, LE1 + 0.12);
  const navG = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: nav, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  navG.scale.setScalar(0.9);
  navM.add(navG);
  g.add(navM);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  strobe.position.set(-SPAN - 0.15, 0.05, LE1 + C1 - 0.05);
  const sg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sg.scale.setScalar(2.4);
  strobe.add(sg);
  g.add(strobe);

  g.rotation.z = -0.075; // dihedral
  let spin = 0;
  return {
    group: g,
    engine: eng,
    setFlaps(a) {
      flaps.forEach((h) => {
        h.rotation.x = 0.48 * a;
        h.position.z = 0.6 * a;
      });
    },
    setSpoilers(a) {
      spoilers.forEach((h) => (h.rotation.x = -0.85 * a));
    },
    setSlats(a) {
      slats.forEach((h) => {
        h.visible = a > 0.02;
        h.position.set(0, -0.15 * a, -0.48 * a);
        h.rotation.x = -0.3 * a;
      });
    },
    setReverse(a) {
      sleeve.position.z = 0.55 * a;
    },
    // n: engine spool 0..1 (off..running), dt in seconds
    spinFan(n, thrust, dt) {
      const w = n * (4 + 26 * thrust);
      spin += Math.min(w, 5) * dt;
      fan.rotation.z = spin;
      blurMat.opacity = 0.75 * THREE.MathUtils.smoothstep(w, 4, 12);
    },
    strobe(t) {
      const ph = t % 1.6;
      sg.visible = ph < 0.06 || (ph > 0.18 && ph < 0.24);
    },
  };
}

// Merge every visible mesh under `root` into one mesh per look-alike material, in root's
// own frame. Used for parked planes: ~25 draw calls per plane become a handful for all.
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const m = new THREE.Matrix4();
  const keyOf = (mat) =>
    [mat.type, mat.color && mat.color.getHexString(), mat.map ? mat.map.uuid : '-', mat.normalMap ? mat.normalMap.uuid : '-', mat.roughness, mat.metalness, mat.side, mat.transparent, mat.opacity, mat.alphaTest].join('|');
  const visibleChain = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
    return true;
  };
  root.traverse((o) => {
    if (!o.isMesh || !visibleChain(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    m.multiplyMatrices(inv, o.matrixWorld);
    const flip = m.determinant() < 0;
    const parts = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups.map((gr) => [gr, mats[gr.materialIndex]]) : [[null, mats[0]]];
    for (const [gr, mat] of parts) {
      if (!mat || (mat.transparent && mat.opacity < 0.01)) continue;
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (gr) {
        // keep only this group's triangles
        const sub = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) {
          const a = geo.attributes[k];
          if (a) sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
        }
        geo = sub;
      }
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(m);
      if (flip) {
        for (const k of ['position', 'normal', 'uv']) {
          const a = geo.attributes[k];
          const s = a.itemSize;
          for (let i = 0; i < a.count; i += 3)
            for (let c = 0; c < s; c++) {
              const t = a.array[(i + 1) * s + c];
              a.array[(i + 1) * s + c] = a.array[(i + 2) * s + c];
              a.array[(i + 2) * s + c] = t;
            }
        }
      }
      geo.groups = [];
      const key = keyOf(mat);
      if (!buckets.has(key)) buckets.set(key, { mat, geos: [] });
      buckets.get(key).geos.push(geo);
    }
  });
  const out = new THREE.Group();
  for (const { mat, geos } of buckets.values()) out.add(new THREE.Mesh(mergeGeometries(geos), mat));
  return out;
}
