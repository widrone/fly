import * as THREE from 'three';
import { drawCloudIcon } from './ui.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Cabin frame: the child's eyes are at the origin, the plane points toward -Z,
// the left window is at -X. Everything outside is built relative to this.
export const CX = 1.4; // fuselage centerline x
export const FUSE_Y = -0.55; // fuselage center height
export const GROUND_Y = -3.85; // ground below the eyes when the plane is on its wheels
export const CLOUD_ALT = 370; // middle of the cloud layer (meters above runway)
export const WALL_X = -0.34;
export const RIGHT_X = 3.14;
export const FLOOR = -1.1;
// Seat rows: the child sits in an extra-legroom row at z = 0, so the row ahead is further away.
export const ROWS = [2.4, 1.6, 0.8, 0];
for (let m = 0; m <= 10; m++) ROWS.push(-1.4 - 0.8 * m);
// Windows have their own even spacing, with one right beside the child.
export const WINDOWS = [];
for (let j = -4; j <= 16; j++) WINDOWS.push(-0.15 - 0.6 * j);

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw, { repeat = null, aniso = 8, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function rrPath(P, cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  P.moveTo(x + r, y);
  P.lineTo(x + w - r, y);
  P.quadraticCurveTo(x + w, y, x + w, y + r);
  P.lineTo(x + w, y + h - r);
  P.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  P.lineTo(x + r, y + h);
  P.quadraticCurveTo(x, y + h, x, y + h - r);
  P.lineTo(x, y + r);
  P.quadraticCurveTo(x, y, x + r, y);
  return P;
}

function rrCtx(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const lambert = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
// Interior material: lit, but with enough self-glow that the cabin always looks bright and friendly.
const inside = (color, glow = 0.45, o = {}) =>
  new THREE.MeshLambertMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(glow),
    emissiveMap: o.map || null,
    fog: false,
    ...o,
  });

function beam(p1, p2, w, h, mat) {
  const len = p1.distanceTo(p2);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  m.position.copy(p1).add(p2).multiplyScalar(0.5);
  m.lookAt(p2);
  return m;
}

// ---------------------------------------------------------------- Sky
export function makeSky() {
  const uniforms = {
    top: { value: new THREE.Color('#3d7fd9') },
    hor: { value: new THREE.Color('#cfe6ff') },
    bot: { value: new THREE.Color('#dfe9f2') },
    sunDir: { value: new THREE.Vector3(-0.5, 0.7, -0.5).normalize() },
    sunCol: { value: new THREE.Color('#fff2d6') },
    white: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 sunCol; uniform vec3 sunDir; uniform float white;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(hor, bot, pow(clamp(-h,0.0,1.0), 0.45));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.22);
        c = mix(c, vec3(0.92,0.94,0.97), white);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- Clouds
const puffGeo = new THREE.IcosahedronGeometry(1, 1);
const puffGeoFine = new THREE.IcosahedronGeometry(1, 2);
export const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aebbd0', emissiveIntensity: 0.55 });

export function cloudField({ count, W, L, y0, y1, rMin, rMax, seed, mat = cloudMat, fine = false }) {
  const R = rng(seed);
  const parts = [];
  for (let c = 0; c < count; c++) {
    const cx = (R() - 0.5) * W;
    const cz = (R() - 0.5) * L;
    const cy = y0 + R() * (y1 - y0);
    const r = rMin + R() * (rMax - rMin);
    const n = 5 + Math.floor(R() * 5);
    for (let k = 0; k < n; k++) {
      const rr = r * (0.45 + R() * 0.55);
      parts.push([cx + (R() - 0.5) * 3.2 * r, cy + R() * 0.45 * r, cz + (R() - 0.5) * 2 * r, rr]);
    }
  }
  const mesh = new THREE.InstancedMesh(fine ? puffGeoFine : puffGeo, mat, parts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  parts.forEach(([x, y, z, r], i) => {
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * 1.25, r * 0.72, r));
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------- Nimbus, the friendly cloud guide
export function makeNimbus() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#cbd9ff', emissiveIntensity: 0.6, fog: false });
  const sg = new THREE.SphereGeometry(1, 28, 18);
  const puffs = [
    [0, 0, 0, 0.16],
    [-0.15, -0.035, -0.01, 0.12],
    [0.15, -0.035, -0.01, 0.12],
    [-0.075, 0.1, -0.02, 0.115],
    [0.085, 0.105, -0.02, 0.125],
    [-0.255, -0.07, -0.02, 0.075],
    [0.255, -0.07, -0.02, 0.075],
    [0, 0.03, -0.08, 0.15],
  ];
  for (const [x, y, z, r] of puffs) {
    const m = new THREE.Mesh(sg, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(r);
    body.add(m);
  }
  const face = new THREE.Group();
  body.add(face);
  const black = new THREE.MeshBasicMaterial({ color: '#1d2336', fog: false });
  const whiteM = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(s * 0.058, 0.035, 0.142);
    const ball = new THREE.Mesh(sg, black);
    ball.scale.set(0.022, 0.032, 0.012);
    const hl = new THREE.Mesh(sg, whiteM);
    hl.scale.setScalar(0.0075);
    hl.position.set(0.007, 0.012, 0.011);
    e.add(ball, hl);
    face.add(e);
    eyes.push(e);
    const cheek = new THREE.Mesh(
      new THREE.CircleGeometry(0.022, 20),
      new THREE.MeshBasicMaterial({ color: '#ffa3b8', transparent: true, opacity: 0.75, fog: false })
    );
    cheek.position.set(s * 0.104, -0.014, 0.121);
    cheek.rotation.y = s * 0.72;
    face.add(cheek);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0055, 8, 24, Math.PI), black);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.01, 0.157);
  face.add(mouth);

  // a soft halo used for breathing
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.42, 64),
    new THREE.MeshBasicMaterial({ color: '#9cc2ff', transparent: true, opacity: 0, depthWrite: false, fog: false })
  );
  halo.position.z = -0.1;
  g.add(halo);

  let blinkT = 2 + Math.random() * 2;
  let talkT = 0;
  const api = {
    group: g,
    body,
    halo,
    breath: 1,
    talk() {
      talkT = 0.7;
    },
    update(t, dt) {
      blinkT -= dt;
      let ey = 1;
      if (blinkT < 0.13) ey = 0.12;
      if (blinkT < 0) blinkT = 2.5 + Math.random() * 3;
      eyes.forEach((e) => (e.scale.y = ey));
      talkT = Math.max(0, talkT - dt);
      const bounce = talkT > 0 ? Math.sin((0.7 - talkT) * 18) * 0.05 * (talkT / 0.7) : 0;
      body.scale.set(api.breath * (1 - bounce * 0.5), api.breath * (1 + bounce), api.breath);
      body.position.y = Math.sin(t * 1.4) * 0.012;
      body.rotation.z = Math.sin(t * 0.9) * 0.04;
    },
  };
  return api;
}

// ---------------------------------------------------------------- Airplane exterior
function fuselageTexture() {
  return canvasTex(1024, 2048, (ctx, W, H) => {
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(0, 0, W, H);
    // belly
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(0, 0, W * 0.12, H);
    ctx.fillRect(W * 0.88, 0, W * 0.12, H);
    const vOf = (za) => (za + 15) / 30; // airliner-frame z -> v
    const yOf = (za) => (1 - vOf(za)) * H;
    // cheatlines
    for (const u of [0.222, 0.778]) {
      ctx.fillStyle = '#25a69a';
      ctx.fillRect(u * W - 0.012 * W, 0, 0.024 * W, H);
      ctx.fillStyle = '#8fd6ff';
      ctx.fillRect(u * W + (u < 0.5 ? -0.024 : 0.016) * W, 0, 0.008 * W, H);
    }
    // windows
    ctx.fillStyle = '#26354f';
    for (let k = -26; k <= 26; k++) {
      const za = -0.6 * k - 0.15 + 2;
      if (za < -12.8 || za > 13) continue;
      if (Math.abs(za + 11.3) < 0.9 || Math.abs(za - 12.2) < 0.7) continue; // doors
      for (const u of [0.2902, 0.7098]) {
        const ww = 0.36 / (Math.PI * 4) * W;
        const wh = (0.26 / 30) * H;
        rrCtx(ctx, u * W - ww / 2, yOf(za) - wh / 2, ww, wh, wh * 0.45);
        ctx.fill();
      }
    }
    // doors
    ctx.strokeStyle = '#aab3bf';
    ctx.lineWidth = 3;
    for (const za of [-11.3, 12.2]) {
      for (const u of [0.28, 0.72]) {
        const dw = 1.9 / (Math.PI * 4) * W;
        const dh = (0.85 / 30) * H;
        rrCtx(ctx, u * W - dw / 2, yOf(za) - dh / 2, dw, dh, 8);
        ctx.stroke();
      }
    }
    // name, both sides
    ctx.fillStyle = '#1f6f8b';
    ctx.font = '800 64px Nunito, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(0.665 * W, yOf(-6.5));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('NIMBUS AIR', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(0.335 * W, yOf(-6.5));
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('NIMBUS AIR', 0, 0);
    ctx.restore();
  });
}

let _fuseTex = null;
const fuseTex = () => (_fuseTex = _fuseTex || fuselageTexture());

// One wing, built in its own frame: root leading edge at the origin, span toward -X, chord toward +Z.
export function makeWing(color = '#d5dbe2', accent = '#25a69a') {
  const g = new THREE.Group();
  const mat = lambert(color, { side: THREE.DoubleSide });
  const dark = lambert('#b7c0ca', { side: THREE.DoubleSide });
  const sh = new THREE.Shape();
  sh.moveTo(0, -1.8);
  sh.lineTo(-16.6, 5.0);
  sh.lineTo(-16.6, 6.3);
  sh.lineTo(0, 3.2);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2);
  const wing = new THREE.Mesh(geo, mat);
  g.add(wing);
  const TE = (x) => 3.2 + (x / -16.6) * 3.1;
  const LE = (x) => -1.8 + (x / -16.6) * 6.8;

  const makeHingeSet = (x0, x1, back, len, y, mat2, thick) => {
    const p0 = new THREE.Vector3(x0, y, TE(x0) - back);
    const p1 = new THREE.Vector3(x1, y, TE(x1) - back);
    const d = p1.clone().sub(p0);
    const L = d.length();
    d.normalize();
    const pivot = new THREE.Object3D();
    pivot.position.copy(p0);
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
    const hinge = new THREE.Object3D();
    pivot.add(hinge);
    const bg = new THREE.BoxGeometry(L, thick, len);
    bg.translate(L / 2, 0, len / 2);
    hinge.add(new THREE.Mesh(bg, mat2));
    g.add(pivot);
    return hinge;
  };
  // flaps (inboard + outboard) and spoilers
  const flaps = [makeHingeSet(-0.4, -7.6, 1.0, 1.05, -0.13, dark, 0.09), makeHingeSet(-8.0, -12.6, 0.8, 0.85, -0.13, dark, 0.08)];
  const spoilers = [];
  for (let i = 0; i < 4; i++) {
    const x0 = -2.4 - i * 2.4;
    spoilers.push(makeHingeSet(x0, x0 - 2.2, 1.75, 0.7, 0.115, mat, 0.04));
  }

  // winglet
  const wl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 1.05), lambert(accent));
  wl.position.set(-16.75, 0.85, 5.95);
  wl.rotation.z = 0.14;
  wl.rotation.x = -0.35;
  g.add(wl);

  // engine on a pylon
  const nac = new THREE.Group();
  const ng = new THREE.CylinderGeometry(0.95, 0.8, 3.7, 28, 1, true);
  ng.rotateX(Math.PI / 2);
  nac.add(new THREE.Mesh(ng, lambert('#eef1f5', { side: THREE.DoubleSide })));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.08, 10, 32), lambert('#c7ced8'));
  lip.position.z = -1.85;
  nac.add(lip);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.9, 28), lambert('#3a414d'));
  fan.position.z = -1.6;
  fan.rotation.y = Math.PI;
  nac.add(fan);
  const spin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 18), lambert('#dfe3e8'));
  spin.rotation.x = -Math.PI / 2;
  spin.position.z = -1.75;
  nac.add(spin);
  const ex = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 18), lambert('#9aa3ad'));
  ex.rotation.x = Math.PI / 2;
  ex.position.z = 2.3;
  nac.add(ex);
  nac.position.set(-5.0, -1.25, LE(-5.0) - 1.0);
  g.add(nac);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 3.0), lambert('#e6eaef'));
  pylon.position.set(-5.0, -0.55, LE(-5.0) + 0.1);
  g.add(pylon);

  // lights
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
  nav.position.set(-16.75, 0.05, 5.0);
  g.add(nav);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  strobe.position.set(-16.75, 0.05, 6.2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(2.2);
  strobe.add(glow);
  g.add(strobe);

  g.rotation.z = -0.075; // dihedral
  return {
    group: g,
    setFlaps(a) {
      flaps.forEach((h) => {
        h.rotation.x = 0.5 * a;
        h.position.z = 0.65 * a;
      });
    },
    setSpoilers(a) {
      spoilers.forEach((h) => (h.rotation.x = -0.8 * a));
    },
    strobe(t) {
      const ph = t % 1.6;
      glow.visible = ph < 0.06 || (ph > 0.18 && ph < 0.24);
    },
  };
}

let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  _glow = canvasTex(64, 64, (ctx, W) => {
    const g = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
  });
  return _glow;
}

// Airliner in its own frame: fuselage center at origin, nose toward -Z, wheels touch y = -3.3.
export function makeAirliner({ tail = '#25a69a', withGear = true } = {}) {
  const g = new THREE.Group();
  const white = lambert('#f7f9fb');
  const fg = new THREE.CylinderGeometry(2, 2, 30, 40, 1, true);
  fg.rotateX(Math.PI / 2);
  const fuse = new THREE.Mesh(fg, lambert('#ffffff', { map: fuseTex() }));
  g.add(fuse);
  // nose: lower half-sphere rotated so it points to -Z, stretched forward
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -15;
  nose.scale.set(1, 2.0, 1);
  g.add(nose);
  const cock = new THREE.Mesh(
    new THREE.SphereGeometry(2.03, 24, 4, Math.PI * 1.5 - 0.75, 1.5, Math.PI / 2 + 0.42, 0.3),
    lambert('#24324a', { side: THREE.DoubleSide })
  );
  cock.rotation.x = Math.PI / 2;
  cock.position.z = -15;
  cock.scale.set(1, 2.0, 1);
  g.add(cock);
  const tg = new THREE.CylinderGeometry(0.35, 2, 8.5, 40, 1, true);
  tg.rotateX(Math.PI / 2);
  tg.translate(0, 0, 0);
  const tc = new THREE.Mesh(tg, white);
  tc.position.set(0, 0.55, 19.2);
  tc.rotation.x = -0.13;
  g.add(tc);
  // fin
  const fs = new THREE.Shape();
  fs.moveTo(14.5, 1.4);
  fs.lineTo(20.5, 1.4);
  fs.lineTo(23.2, 8.6);
  fs.lineTo(20.6, 8.6);
  fs.closePath();
  const fgeo = new THREE.ExtrudeGeometry(fs, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
  fgeo.translate(0, 0, -0.18);
  fgeo.rotateY(-Math.PI / 2);
  const fin = new THREE.Mesh(fgeo, lambert(tail));
  g.add(fin);
  // a white cloud on the tail, both sides
  const logoTex = canvasTex(256, 256, (ctx) => drawCloudIcon(ctx, 128, 128, 110, '#ffffff'));
  for (const s of [-1, 1]) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshLambertMaterial({ map: logoTex, transparent: true, emissive: '#555555' }));
    logo.position.set(s * 0.25, 5.2, 20.2);
    logo.rotation.y = s * Math.PI / 2;
    g.add(logo);
  }
  // stabilizers
  for (const s of [-1, 1]) {
    const hs = new THREE.Shape();
    hs.moveTo(0, 15.3);
    hs.lineTo(-6, 19.4);
    hs.lineTo(-6, 20.5);
    hs.lineTo(0, 18.9);
    hs.closePath();
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.18, bevelEnabled: false });
    hg.rotateX(Math.PI / 2);
    const h = new THREE.Mesh(hg, lambert('#d5dbe2', { side: THREE.DoubleSide }));
    h.position.set(s * -0.6, 0.6, 0);
    h.scale.x = s;
    g.add(h);
  }
  // wings
  const wings = [];
  for (const s of [1, -1]) {
    const w = makeWing('#d5dbe2', tail);
    w.group.position.set(s * -1.7, -0.7, 2);
    if (s < 0) {
      w.group.scale.x = -1;
      w.group.rotation.z = 0.075;
    }
    g.add(w.group);
    wings.push(w);
  }
  if (withGear) {
    const tire = lambert('#2a2d33');
    const strut = lambert('#9aa1aa');
    const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 18);
    wg.rotateZ(Math.PI / 2);
    for (const [x, z] of [[-2.9, 3.8], [2.9, 3.8], [0, -12.2]]) {
      const n = x === 0 ? 0.36 : 0.55;
      for (const dx of [-0.25, 0.25]) {
        const wh = new THREE.Mesh(wg, tire);
        wh.scale.set(1, n / 0.55, n / 0.55);
        wh.position.set(x + dx, -3.3 + n, z);
        g.add(wh);
      }
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), strut);
      st.position.set(x, -2.0, z);
      g.add(st);
    }
  }
  return { group: g, wings };
}

// ---------------------------------------------------------------- Outside world for the flight
function fieldsTexture() {
  return canvasTex(1024, 1024, (ctx, W) => {
    const R = rng(7);
    ctx.fillStyle = '#4c7444';
    ctx.fillRect(0, 0, W, W);
    const cols = ['#8db662', '#a5c36b', '#c3bf78', '#7aa658', '#b0b874', '#9fc07a'];
    for (let i = 0; i < 90; i++) {
      ctx.save();
      ctx.translate(R() * W, R() * W);
      ctx.rotate((R() - 0.5) * 0.6);
      ctx.fillStyle = cols[Math.floor(R() * cols.length)];
      const w = 40 + R() * 140;
      const h = 30 + R() * 110;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.fillStyle = '#3f6a3d';
    for (let i = 0; i < 400; i++) {
      ctx.beginPath();
      ctx.arc(R() * W, R() * W, 4 + R() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#5d90b8';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(R() * W, R() * W, 30 + R() * 60, 15 + R() * 40, R() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#cfc8b6';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(R() * W, 0);
      ctx.bezierCurveTo(R() * W, W * 0.3, R() * W, W * 0.7, R() * W, W);
      ctx.stroke();
    }
    ctx.fillStyle = '#b5473a';
    for (let i = 0; i < 40; i++) ctx.fillRect(R() * W, R() * W, 4, 4);
  }, { repeat: [1, 1], aniso: 16 });
}

function concreteTexture(rep) {
  return canvasTex(256, 256, (ctx, W) => {
    ctx.fillStyle = '#b7bbc0';
    ctx.fillRect(0, 0, W, W);
    const R = rng(3);
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(R() * W, R() * W, 2, 2);
    }
    ctx.strokeStyle = 'rgba(80,85,95,0.35)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, W);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, x);
      ctx.lineTo(W, x);
      ctx.stroke();
    }
  }, { repeat: [rep, rep], aniso: 16 });
}

const offsetMat = (mat, f) => {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = f;
  mat.polygonOffsetUnits = f;
  return mat;
};

function trees(count, area, avoid, seed, y) {
  const R = rng(seed);
  const geo = new THREE.ConeGeometry(1, 1, 6);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, lambert('#2f5b36', { flatShading: true }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let i = 0;
  while (i < count) {
    const x = area.x0 + R() * (area.x1 - area.x0);
    const z = area.z0 + R() * (area.z1 - area.z0);
    if (avoid(x, z)) continue;
    const h = 8 + R() * 10;
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(h * 0.3, h, h * 0.3));
    mesh.setMatrixAt(i++, m);
  }
  mesh.computeBoundingSphere();
  return mesh;
}

export function mountains(seed, y, ring) {
  const R = rng(seed);
  const g = new THREE.Group();
  const rock = lambert('#71838f', { flatShading: true });
  const snow = lambert('#f2f5f8', { flatShading: true });
  const rocks = [];
  const caps = [];
  for (let i = 0; i < ring.count; i++) {
    const a = ring.a0 + R() * (ring.a1 - ring.a0);
    const d = ring.d0 + R() * (ring.d1 - ring.d0);
    const h = ring.h0 + R() * (ring.h1 - ring.h0);
    const r = h * (1.3 + R() * 0.8);
    const x = Math.cos(a) * d + (ring.cx || 0);
    const z = Math.sin(a) * d + (ring.cz || 0);
    const rot = R() * 3;
    const geo = new THREE.ConeGeometry(r, h, 7, 1).rotateY(rot).translate(x, y + h / 2, z);
    rocks.push(geo.toNonIndexed());
    const cg = new THREE.ConeGeometry(r * 0.28, h * 0.28, 7, 1).rotateY(rot).translate(x, y + h - h * 0.14 + 1, z);
    caps.push(cg.toNonIndexed());
  }
  g.add(new THREE.Mesh(mergeGeometries(rocks), rock));
  g.add(new THREE.Mesh(mergeGeometries(caps), snow));
  return g;
}

export function buildOutside() {
  const g = new THREE.Group();
  const groundTex = fieldsTexture();
  const TILE = 1400;
  const GS = 18000;
  groundTex.repeat.set(GS / TILE, GS / TILE);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS), lambert('#ffffff', { map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y - 0.05;
  g.add(ground);

  // --- runway airport (moves with distance travelled)
  const airport = new THREE.Group();
  g.add(airport);
  const gy = GROUND_Y;
  const flat = (w, l, color, x, z, f) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), offsetMat(lambert(color), f));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, gy, z);
    airport.add(m);
    return m;
  };
  flat(900, 6200, '#7fae57', CX - 150, -1500, -1);
  flat(46, 3000, '#454a52', CX, -1440, -2);
  flat(24, 3000, '#555a61', CX - 170, -1440, -2);
  for (const z of [-150, -1400, -2700]) flat(150, 24, '#555a61', CX - 95, z, -3);
  flat(0.9, 3000, '#f2f2f2', CX - 21.8, -1440, -4);
  flat(0.9, 3000, '#f2f2f2', CX + 21.8, -1440, -4);
  const dashMat = offsetMat(lambert('#f5f5f5'), -4);
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 30).rotateX(-Math.PI / 2), dashMat, 50);
  const m4 = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 50; i++) dashes.setMatrixAt(i, m4.compose(new THREE.Vector3(CX, gy, -i * 60), q0, one));
  airport.add(dashes);
  const keys = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.8, 32).rotateX(-Math.PI / 2), dashMat, 24);
  for (let i = 0; i < 12; i++) {
    keys.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(CX - 4 - i * 1.5, gy, 36), q0, one));
    keys.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(CX + 4 + i * 1.5, gy, 36), q0, one));
  }
  airport.add(keys);
  const tdz = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.8, 22).rotateX(-Math.PI / 2), dashMat, 24);
  let k = 0;
  for (const z of [-300, -450, -600]) for (const dx of [-9, -6.5, -4, 4, 6.5, 9]) if (k < 24) tdz.setMatrixAt(k++, m4.compose(new THREE.Vector3(CX + dx, gy, z), q0, one));
  tdz.count = k;
  airport.add(tdz);
  const lightGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
  const lights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: '#fff3c4' }), 102);
  for (let i = 0; i < 51; i++) {
    lights.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(CX - 23.5, gy + 0.25, 60 - i * 60), q0, one));
    lights.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(CX + 23.5, gy + 0.25, 60 - i * 60), q0, one));
  }
  airport.add(lights);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.1, 0.25), lambert('#15181d'), 10);
  for (let i = 0; i < 10; i++) boards.setMatrixAt(i, m4.compose(new THREE.Vector3(CX - 38, gy + 0.8, -i * 300), q0, one));
  airport.add(boards);
  // buildings far away
  const bld = lambert('#d9dde2');
  const term = new THREE.Mesh(new THREE.BoxGeometry(60, 16, 320), bld);
  term.position.set(CX - 430, gy + 8, -1500);
  airport.add(term);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(61, 6, 300), lambert('#6c93b3'));
  glass.position.set(CX - 430, gy + 9, -1500);
  airport.add(glass);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 34, 12), bld);
  tower.position.set(CX - 330, gy + 17, -900);
  airport.add(tower);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 6, 12), lambert('#3f6b80'));
  cab.position.set(CX - 330, gy + 37, -900);
  airport.add(cab);
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(70, 22, 60), lambert('#c3c9d1'));
    h.position.set(CX - 300, gy + 11, -2100 - i * 90);
    airport.add(h);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 70, 16, 1, false, 0, Math.PI), lambert('#9fa8b3'));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.set(CX - 300, gy + 22, -2100 - i * 90);
    roof.scale.set(1, 1, 0.35);
    airport.add(roof);
  }
  airport.add(
    trees(2600, { x0: -2600, x1: 2600, z0: -6500, z1: 2500 }, (x, z) => (x > CX - 480 && x < CX + 140 && z > -3600 && z < 900) || (x > CX - 520 && x < CX - 250 && z > -2400 && z < -700), 11, gy)
  );
  airport.add(mountains(5, gy - 30, { count: 16, a0: 0, a1: Math.PI * 2, d0: 4500, d1: 7000, h0: 500, h1: 1100, cz: -1500 }));

  // --- gate area (parked at the terminal)
  const gate = new THREE.Group();
  g.add(gate);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), offsetMat(lambert('#ffffff', { map: concreteTexture(300) }), -1));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = gy;
  gate.add(apron);
  const lead = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 160), offsetMat(lambert('#f2c230'), -3));
  lead.rotation.x = -Math.PI / 2;
  lead.position.set(CX, gy, -40);
  gate.add(lead);
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.3), offsetMat(lambert('#d9443a'), -3));
  stop.rotation.x = -Math.PI / 2;
  stop.position.set(CX - 6, gy, -36);
  gate.add(stop);
  const facadeTex = canvasTex(512, 256, (ctx, W, H) => {
    ctx.fillStyle = '#e4e8ed';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6f97b8';
    ctx.fillRect(0, H * 0.25, W, H * 0.5);
    ctx.strokeStyle = '#dfe5ea';
    ctx.lineWidth = 4;
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, H * 0.25);
      ctx.lineTo(x, H * 0.75);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,60,80,0.35)';
    const R = rng(9);
    for (let i = 0; i < 40; i++) ctx.fillRect(R() * W, H * 0.55 + R() * 20, 4, 18);
  }, { repeat: [6, 1] });
  const termMats = [lambert('#ffffff', { map: facadeTex }), bld, bld, bld, bld, bld];
  const tb = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 260), [termMats[0], ...termMats.slice(1)]);
  tb.position.set(-70, gy + 9, -20);
  gate.add(tb);
  // jet bridge: fixed tunnel from terminal + telescoping end that rolls away
  const bridgeMat = lambert('#d0d5db');
  const bridgeY = FLOOR + 1.25;
  const tunnelZ = -9.4;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 2.6), bridgeMat);
  gate.add(bridge);
  const bridgeCab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 3.4), lambert('#bfc6ce'));
  gate.add(bridgeCab);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 0.4), lambert('#6d7480'));
  gate.add(leg);
  const wheels = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.8), lambert('#2b2f36'));
  gate.add(wheels);
  const setBridge = (xEnd) => {
    const x0 = -40;
    const len = xEnd - x0 - 1.2;
    bridge.scale.x = len;
    bridge.position.set(x0 + len / 2, bridgeY, tunnelZ);
    bridgeCab.position.set(xEnd - 1.2, bridgeY, tunnelZ);
    const lx = xEnd - 7;
    leg.scale.y = bridgeY - 1.25 - gy;
    leg.position.set(lx, (bridgeY - 1.25 + gy) / 2, tunnelZ);
    wheels.position.set(lx, gy + 0.3, tunnelZ);
  };
  setBridge(-0.75);
  // ground vehicles
  const tug = new THREE.Group();
  const tugBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.6), lambert('#f2b632'));
  tugBody.position.y = 0.8;
  tug.add(tugBody);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff9d00' }));
  beacon.position.set(0, 1.4, 0.4);
  tug.add(beacon);
  for (let c = 1; c <= 3; c++) {
    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.4), lambert('#7d8a99'));
    cart.position.set(0, 0.9, c * 3.0);
    tug.add(cart);
    const bags = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 2.0), lambert(['#c0392b', '#2e86de', '#27ae60'][c - 1]));
    bags.position.set(0, 1.6, c * 3.0);
    tug.add(bags);
  }
  tug.position.set(-14, gy, 0);
  gate.add(tug);
  const truck = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 16), lambert('#f3f5f7'));
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 1.7, 0.6);
  truck.add(tank);
  const tcab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 1.8), lambert('#2e6fb5'));
  tcab.position.set(0, 1.4, -3.2);
  truck.add(tcab);
  truck.position.set(-22, gy, 14);
  truck.rotation.y = 0.5;
  gate.add(truck);
  const loader = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 7), lambert('#505862'));
  loader.position.set(-2.6, gy + 1.6, 9);
  loader.rotation.x = 0.28;
  gate.add(loader);
  gate.add(mountains(8, gy - 30, { count: 14, a0: 0, a1: Math.PI * 2, d0: 4200, d1: 6500, h0: 500, h1: 1000 }));
  gate.add(trees(900, { x0: -1100, x1: 1100, z0: -1100, z1: 1100 }, (x, z) => Math.abs(x) < 420 && Math.abs(z) < 520, 21, gy));

  // --- cloud layer (3 tiles that wrap around as we fly)
  const tiles = [];
  const TL = 1700;
  for (let t = 0; t < 3; t++) {
    const tile = cloudField({ count: 55, W: 5000, L: TL, y0: CLOUD_ALT - 25, y1: CLOUD_ALT + 15, rMin: 35, rMax: 85, seed: 100 + t });
    tile.userData.base = -TL * 1.5 + TL * (t + 0.5);
    g.add(tile);
    tiles.push(tile);
  }
  const high = cloudField({ count: 30, W: 9000, L: 9000, y0: 1500, y1: 1800, rMin: 60, rMax: 160, seed: 300 });
  g.add(high);

  return {
    group: g,
    ground,
    groundTex,
    TILE,
    airport,
    gate,
    setBridge,
    tug,
    beacon,
    tiles,
    TL,
  };
}

// ---------------------------------------------------------------- Terminal (looking out at our plane)
export function buildTerminal() {
  const g = new THREE.Group();
  const floorTex = canvasTex(256, 256, (ctx, W) => {
    ctx.fillStyle = '#dfe3e8';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = '#c9ced5';
    ctx.lineWidth = 3;
    for (let x = 0; x <= W; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, W);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, x);
      ctx.lineTo(W, x);
      ctx.stroke();
    }
  }, { repeat: [9, 5] });
  const ZW = -2.6;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), inside('#ffffff', 0.45, { map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR, ZW + 4.5);
  g.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), inside('#5b77b8', 0.4));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, FLOOR + 0.003, 0.6);
  g.add(rug);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), inside('#f2f4f7', 0.55));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 2.8, ZW + 4.5);
  g.add(ceil);
  const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
  for (let x = -6; x <= 6; x += 3) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.25), lightMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, 2.79, 1.5);
    g.add(l);
  }
  const wallM = inside('#e6eaef', 0.5);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.9), wallM);
  back.rotation.y = Math.PI;
  back.position.set(0, 0.85, ZW + 9);
  g.add(back);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.9), wallM);
    w.rotation.y = -s * Math.PI / 2;
    w.position.set(s * 9, 0.85, ZW + 4.5);
    g.add(w);
  }
  // window wall: mullions + faint glass
  const mull = inside('#9aa5b3', 0.4);
  for (let x = -9; x <= 9.01; x += 2.25) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3.9, 0.14), mull);
    m.position.set(x, 0.85, ZW);
    g.add(m);
  }
  for (const y of [FLOOR + 0.08, 2.75]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(18, 0.12, 0.16), mull);
    m.position.set(0, y, ZW);
    g.add(m);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.05, 0.05), inside('#c5ccd5', 0.5));
  rail.position.set(0, -0.15, ZW + 0.12);
  g.add(rail);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 3.9),
    new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.07, depthWrite: false, fog: false })
  );
  glass.position.set(0, 0.85, ZW);
  g.add(glass);

  // gate chairs
  const chairMat = inside('#2b8a8a', 0.35);
  const frame = inside('#8d96a3', 0.4);
  const chairs = [];
  for (const z of [0, 1.7, 3.4]) for (const x of [-3.6, -3.0, -2.4, -1.8, -0.6, 0, 0.6, 1.8, 2.4, 3.0, 3.6]) chairs.push([x, z]);
  const seatI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.07, 0.5), chairMat, chairs.length);
  const backI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.55, 0.06), chairMat, chairs.length);
  const legI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), frame, chairs.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12);
  const q0 = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  chairs.forEach(([x, z], i) => {
    seatI.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -0.62, z), q0, one));
    backI.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -0.32, z + 0.27), q, one));
    legI.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -0.86, z + 0.1), q0, one));
  });
  g.add(seatI, backI, legI);
  // plants
  for (const x of [-7.2, 7.2]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.6, 16), inside('#e8e2d6', 0.4));
    pot.position.set(x, FLOOR + 0.3, ZW + 0.7);
    g.add(pot);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), inside('#4f9a58', 0.3, { flatShading: true }));
      leaf.position.set(x + Math.cos(i * 1.3) * 0.2, FLOOR + 0.9 + i * 0.18, ZW + 0.7 + Math.sin(i * 1.3) * 0.2);
      g.add(leaf);
    }
  }
  // departure board (redrawn when the language changes)
  const boardTex = canvasTex(1024, 512, () => {});
  const drawBoard = ({ title, rows }) => {
    const ctx = boardTex.image.getContext('2d');
    const W = 1024, H = 512;
    ctx.fillStyle = '#10151f';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd34d';
    ctx.font = '800 64px Nunito, Arial';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 50, 40);
    rows.forEach((r, i) => {
      const y = 150 + i * 105;
      ctx.font = '700 46px Nunito, Arial';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(r[0], 50, y);
      let fs = 46;
      while (ctx.measureText(r[1]).width > 420 && fs > 30) ctx.font = `700 ${(fs -= 2)}px Nunito, Arial`;
      ctx.fillText(r[1], 200, y);
      ctx.font = '700 46px Nunito, Arial';
      ctx.fillText(r[2], 650, y);
      ctx.fillStyle = i === 0 ? '#5cf08a' : '#9fd0ff';
      ctx.fillText(r[3], 820, y);
    });
    boardTex.needsUpdate = true;
  };
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: boardTex, fog: false, toneMapped: false }));
  board.rotation.y = -Math.PI / 2;
  board.position.set(8.95, 1.2, 0.8);
  g.add(board);

  // outside
  const ay = FLOOR - 4.5;
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), offsetMat(lambert('#ffffff', { map: concreteTexture(150) }), -1));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, ay, -500);
  g.add(apron);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), lambert('#6f9d50'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = ay - 0.3;
  g.add(grass);
  const rwy = new THREE.Mesh(new THREE.PlaneGeometry(3000, 46), offsetMat(lambert('#4a4f57'), -2));
  rwy.rotation.x = -Math.PI / 2;
  rwy.position.set(0, ay, -760);
  g.add(rwy);
  const lead = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 60), offsetMat(lambert('#f2c230'), -3));
  lead.rotation.x = -Math.PI / 2;
  const plane = makeAirliner();
  plane.group.position.set(-4, ay + 3.3, -34);
  plane.group.rotation.y = Math.PI - 0.55;
  g.add(plane.group);
  plane.wings.forEach((w) => w.setFlaps(0));
  lead.position.set(-4, ay, -34);
  lead.rotation.z = -0.55;
  g.add(lead);
  // jet bridge to the plane's front left door
  plane.group.updateMatrixWorld(true);
  const door = plane.group.localToWorld(new THREE.Vector3(-2.1, -0.55, -11.3));
  const start = new THREE.Vector3(-13, door.y + 0.1, ZW - 5);
  const jb = beam(start, door, 2.6, 2.6, lambert('#d0d5db'));
  g.add(jb);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, door.y - ay, 0.4), lambert('#6d7480'));
  post.position.set((start.x + door.x) / 2, (door.y + ay) / 2 - 1.3, (start.z + door.z) / 2);
  g.add(post);
  const tug = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.6), lambert('#f2b632'));
  tb.position.y = 0.8;
  tug.add(tb);
  for (let c = 1; c <= 3; c++) {
    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.4), lambert('#7d8a99'));
    cart.position.set(0, 0.9, c * 3.0);
    tug.add(cart);
    const bags = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 2.0), lambert(['#c0392b', '#2e86de', '#27ae60'][c - 1]));
    bags.position.set(0, 1.6, c * 3.0);
    tug.add(bags);
  }
  tug.position.y = ay;
  g.add(tug);
  const truck = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 16), lambert('#f3f5f7'));
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 1.7, 0.6);
  truck.add(tank);
  const tcab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 1.8), lambert('#2e6fb5'));
  tcab.position.set(0, 1.4, -3.2);
  truck.add(tcab);
  truck.position.set(10, ay, -30);
  truck.rotation.y = 0.4;
  g.add(truck);
  // another plane taking off far away, over and over
  const other = makeAirliner({ tail: '#e07a5f', withGear: true });
  other.wings.forEach((w) => w.setFlaps(0.4));
  g.add(other.group);
  g.add(trees(1200, { x0: -3000, x1: 3000, z0: -2600, z1: -840 }, (x, z) => z > -900 && z < -620, 31, ay));
  g.add(mountains(12, ay - 30, { count: 14, a0: -Math.PI * 0.95, a1: -Math.PI * 0.05, d0: 4000, d1: 6500, h0: 500, h1: 1200 }));
  g.add(cloudField({ count: 26, W: 9000, L: 5000, y0: 700, y1: 1100, rMin: 60, rMax: 160, seed: 41 }));
  const cl = cloudField({ count: 26, W: 9000, L: 5000, y0: 700, y1: 1100, rMin: 60, rMax: 160, seed: 41 });
  cl.position.z = -4000;
  g.add(cl);

  let tt = 0;
  const jet = { on: false, pos: other.group.position };
  return {
    group: g,
    plane,
    jet,
    setBoard: drawBoard,
    update(dt) {
      tt += dt;
      // baggage train loop
      const a = tt * 0.08;
      tug.position.set(8 + Math.cos(a) * 16, ay, -28 + Math.sin(a) * 9);
      tug.rotation.y = -a;
      // distant takeoff, 40 s cycle, along -X... +X on the far runway
      const c = tt % 40;
      const s = Math.max(0, c - 4);
      const x = -1300 + 0.5 * 3.2 * s * s;
      const lift = Math.max(0, x - (-300));
      other.group.position.set(Math.min(x, 3000), ay + 3.3 + lift * 0.18, -760);
      other.group.rotation.set(0, -Math.PI / 2, 0);
      other.group.rotateX(lift > 0 ? 0.14 : 0);
      other.group.visible = x < 3000;
      jet.on = s > 0 && x < 2600;
    },
  };
}

// ---------------------------------------------------------------- Cloud Lounge (the calm place)
export function buildLounge() {
  const g = new THREE.Group();
  const pinkMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#e8c6d8', emissiveIntensity: 0.55 });
  // the cloud the child sits on
  const seat = cloudField({ count: 1, W: 0, L: 0, y0: -1.55, y1: -1.55, rMin: 0.75, rMax: 0.75, seed: 4, mat: pinkMat, fine: true });
  g.add(seat);
  const seat2 = cloudField({ count: 3, W: 3.0, L: 2.6, y0: -1.9, y1: -1.6, rMin: 0.5, rMax: 0.8, seed: 5, mat: pinkMat, fine: true });
  g.add(seat2);
  // sea of clouds
  g.add(cloudField({ count: 260, W: 5000, L: 5000, y0: -70, y1: -45, rMin: 30, rMax: 80, seed: 8, mat: pinkMat }));
  // floating cloud islands
  const islands = [];
  const R = rng(17);
  for (let i = 0; i < 12; i++) {
    const a = R() * Math.PI * 2;
    const d = 18 + R() * 90;
    const isl = cloudField({ count: 1, W: 0, L: 0, y0: 0, y1: 0, rMin: 2 + R() * 5, rMax: 3 + R() * 6, seed: 50 + i, mat: pinkMat, fine: true });
    isl.position.set(Math.cos(a) * d, -6 + R() * 22, Math.sin(a) * d);
    isl.userData = { y: isl.position.y, ph: R() * 6 };
    g.add(isl);
    islands.push(isl);
  }
  // stars
  const sp = [];
  for (let i = 0; i < 500; i++) {
    const a = R() * Math.PI * 2;
    const e = 0.25 + R() * 1.2;
    sp.push(Math.cos(a) * Math.cos(e) * 3000, Math.sin(e) * 3000, Math.sin(a) * Math.cos(e) * 3000);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 9, sizeAttenuation: true, map: glowTex(), transparent: true, depthWrite: false, fog: false, opacity: 0.8 }));
  g.add(stars);
  // sparkles floating up around the child
  const N = 90;
  const pp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = R() * Math.PI * 2;
    const d = 1.5 + R() * 7;
    pp[i * 3] = Math.cos(a) * d;
    pp[i * 3 + 1] = -2 + R() * 5;
    pp[i * 3 + 2] = Math.sin(a) * d;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const sparkles = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#fff1c9', size: 0.09, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  g.add(sparkles);
  // a friendly plane gliding by in the distance
  const plane = makeAirliner({ withGear: false });
  plane.group.scale.setScalar(1);
  g.add(plane.group);

  let tt = 0;
  return {
    group: g,
    update(dt) {
      tt += dt;
      islands.forEach((isl) => (isl.position.y = isl.userData.y + Math.sin(tt * 0.3 + isl.userData.ph) * 0.6));
      const p = pg.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = p.getY(i) + dt * 0.12;
        if (y > 3.5) y = -2;
        p.setY(i, y);
      }
      p.needsUpdate = true;
      const a = -1.2 + tt * 0.012;
      plane.group.position.set(Math.cos(a) * 420, 40, Math.sin(a) * 420);
      plane.group.rotation.set(0, -a + Math.PI, 0);
      plane.group.rotateZ(-0.12);
    },
  };
}

// ---------------------------------------------------------------- Confetti for the finish
export function makeConfetti() {
  const N = 260;
  const geo = new THREE.PlaneGeometry(0.018, 0.026);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const cols = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f43'];
  const P = [];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    mesh.setColorAt(i, c.set(cols[i % cols.length]));
    P.push({ p: new THREE.Vector3(), v: 0, r: new THREE.Euler(), s: Math.random() * 6 });
  }
  mesh.visible = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  return {
    mesh,
    start(center, spread) {
      t = 0;
      mesh.visible = true;
      P.forEach((o) => {
        o.p.set(center.x + (Math.random() - 0.5) * spread.x, center.y + Math.random() * spread.y, center.z + (Math.random() - 0.5) * spread.z);
        o.v = 0.12 + Math.random() * 0.2;
      });
    },
    update(dt) {
      if (!mesh.visible) return;
      t += dt;
      P.forEach((o, i) => {
        o.p.y -= o.v * dt;
        o.p.x += Math.sin(t * 2 + o.s) * 0.002;
        o.r.set(t * 3 + o.s, t * 2 + o.s, 0);
        q.setFromEuler(o.r);
        mesh.setMatrixAt(i, m4.compose(o.p, q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (t > 10) mesh.visible = false;
    },
  };
}
