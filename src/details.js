// Small real-world details that make the flight feel true:
//  - the window itself: fine scratches in the acrylic, frost crystals that grow from the
//    edges up at cruising height (and melt on the way down), and raindrops that streak
//    backwards while you fly through cloud and slowly dry afterwards
//  - wing vapour: thin white mist that flows over the top of the wing just after lift-off
//    and on a damp approach
//  - wisps of cloud rushing past the window as you go in and out of the cloud layer

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wingPoint } from './aircraft.js';

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function rngOf(seed) {
  let a = seed >>> 0;
  return () => ((a = (a * 16807) % 2147483647) / 2147483647);
}
function dataTex(c, srgb = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// R: scratches/haze, G: frost crystals, B: frost growth order (0 = edge, grows inward), A: unused
function windowTexture() {
  const N = 512;
  const R = rngOf(7);
  // scratches: fine arcs (from cleaning) and a few straight ones
  const sc = cnv(N, N);
  const s = sc.getContext('2d');
  s.fillStyle = '#000';
  s.fillRect(0, 0, N, N);
  s.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    s.strokeStyle = `rgba(255,255,255,${0.15 + R() * 0.35})`;
    s.lineWidth = 0.6 + R() * 0.8;
    s.beginPath();
    const cx = R() * N, cy = R() * N, r = 60 + R() * 260, a = R() * 6.28;
    s.arc(cx, cy, r, a, a + 0.15 + R() * 0.5);
    s.stroke();
  }
  for (let i = 0; i < 12; i++) {
    s.strokeStyle = `rgba(255,255,255,${0.2 + R() * 0.3})`;
    s.lineWidth = 0.7;
    s.beginPath();
    const x = R() * N, y = R() * N, a = R() * 6.28, l = 20 + R() * 90;
    s.moveTo(x, y);
    s.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    s.stroke();
  }
  // a soft haze toward the edges of the pane
  const hz = s.createRadialGradient(N / 2, N / 2, N * 0.25, N / 2, N / 2, N * 0.62);
  hz.addColorStop(0, 'rgba(255,255,255,0)');
  hz.addColorStop(1, 'rgba(255,255,255,0.35)');
  s.fillStyle = hz;
  s.fillRect(0, 0, N, N);

  // frost: feathery crystals that grow from the edges and the bottom
  const fc = cnv(N, N);
  const f = fc.getContext('2d');
  f.fillStyle = '#000';
  f.fillRect(0, 0, N, N);
  const branch = (x, y, a, len, depth) => {
    if (depth <= 0 || len < 2) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    f.strokeStyle = `rgba(255,255,255,${0.18 + 0.12 * depth})`;
    f.lineWidth = 0.35 + depth * 0.2;
    f.beginPath();
    f.moveTo(x, y);
    f.lineTo(x2, y2);
    f.stroke();
    const n = 3;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const bx = x + (x2 - x) * t, by = y + (y2 - y) * t;
      branch(bx, by, a + 1.0, len * 0.38, depth - 1);
      branch(bx, by, a - 1.0, len * 0.38, depth - 1);
    }
  };
  // fine ferns, a few millimetres each, mostly along the bottom edge and in the corners
  for (let i = 0; i < 900; i++) {
    const ang = R() * Math.PI * 2;
    const bottomBias = Math.sin(ang) > 0.2 ? 1 : 0.35;
    if (R() > bottomBias) continue;
    const rr = 0.46 - Math.pow(R(), 2) * 0.12;
    const x = N / 2 + Math.cos(ang) * N * rr, y = N / 2 + Math.sin(ang) * N * rr;
    branch(x, y, ang + Math.PI + (R() - 0.5) * 1.4, 5 + R() * 12, 2 + (R() < 0.3 ? 1 : 0));
  }
  // growth order: distance in from the edge (lower part grows first)
  const gc = cnv(N, N);
  const gx = gc.getContext('2d');
  const img = gx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x - N / 2) / (N / 2), dy = (y - N / 2) / (N / 2);
      const edge = 1 - Math.min(1, Math.hypot(dx * 0.95, dy));
      const g = Math.min(1, 0.03 + edge * 1.6 - Math.max(0, dy) * 0.35 + (R() - 0.5) * 0.08);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, g) * 255;
      img.data[i + 3] = 255;
    }
  gx.putImageData(img, 0, 0);

  // pack into one RGB image
  const out = cnv(N, N);
  const o = out.getContext('2d');
  const od = o.createImageData(N, N);
  const a = s.getImageData(0, 0, N, N).data, b = f.getImageData(0, 0, N, N).data, c = gx.getImageData(0, 0, N, N).data;
  for (let i = 0; i < od.data.length; i += 4) {
    od.data[i] = a[i];
    od.data[i + 1] = b[i];
    od.data[i + 2] = c[i];
    od.data[i + 3] = 255;
  }
  o.putImageData(od, 0, 0);
  return dataTex(out);
}

// R: droplet coverage, G: droplet "lens" highlight; tiles, scrolled aft while you fly
function dropTexture() {
  const N = 256;
  const c = cnv(N, N);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, N, N);
  const R = rngOf(11);
  for (let i = 0; i < 70; i++) {
    const px = R() * N, py = R() * N, r = 0.8 + Math.pow(R(), 3) * 4;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const g = x.createRadialGradient(px + ox - r * 0.3, py + oy - r * 0.3, 0, px + ox, py + oy, r);
      g.addColorStop(0, 'rgb(255,255,0)');
      g.addColorStop(0.6, 'rgb(255,90,0)');
      g.addColorStop(1, 'rgb(0,0,0)');
      x.fillStyle = g;
      x.beginPath();
      x.arc(px + ox, py + oy, r, 0, Math.PI * 2);
      x.fill();
    }
  }
  return dataTex(c);
}

// A layer over every window pane. `panes` is the pane geometry (shape UVs in metres).
export function windowDetails(paneGeos, size, aftSigns) {
  const tex = windowTexture();
  const drops = dropTexture();
  const uniforms = {
    tWin: { value: tex },
    tDrop: { value: drops },
    uSize: { value: new THREE.Vector2(size.w, size.h) },
    uFrost: { value: 0 },
    uWet: { value: 0 },
    uFlow: { value: 0 },
    uLight: { value: 1 },
  };
  const make = (geo, aft) =>
    new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uAft: { value: aft } },
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec2 vUv;
          uniform vec2 uSize;
          void main() {
            vUv = (uv + uSize * 0.5) / uSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D tWin, tDrop;
          uniform float uFrost, uWet, uFlow, uAft, uLight;
          void main() {
            vec3 w = texture2D(tWin, vUv).rgb;
            // scratches and haze: barely there, like real acrylic
            float a = w.r * 0.09;
            vec3 col = vec3(1.0) * w.r;
            // frost grows in from the edges as uFrost rises
            float grow = smoothstep(w.b, w.b + 0.06, uFrost * 0.7);
            float fr = w.g * grow + grow * 0.1 * (1.0 - w.b);
            a += fr * 0.75;
            col = mix(col, vec3(0.93, 0.97, 1.0), clamp(fr * 2.0, 0.0, 1.0));
            // raindrops streaking backwards: smear the drop texture along the flow
            vec2 duv = vUv * vec2(1.2, 1.7);
            float d = 0.0, hl = 0.0;
            // the wind pushes the drops back and a little down: thin streaks
            for (int k = 0; k < 7; k++) {
              float fk = float(k);
              vec2 q = duv + vec2(uAft * (uFlow + fk * 0.018), fk * 0.004);
              vec3 s = texture2D(tDrop, q).rgb;
              d = max(d, s.r * (1.0 - fk * 0.13));
              if (k == 0) hl = s.g;
            }
            a += uWet * (d * 0.16 + hl * 0.22);
            col = mix(col, vec3(0.85, 0.9, 0.95) + hl * 0.4, clamp(uWet * d * 2.0, 0.0, 1.0));
            gl_FragColor = vec4(col * uLight, clamp(a, 0.0, 0.95));
          }`,
      })
    );
  const meshes = paneGeos.map((g, i) => make(g, aftSigns[i]));
  meshes.forEach((m) => (m.renderOrder = 6));
  return {
    meshes,
    // frost 0..1, wet 0..1, flow: how far the drops have been blown (grows with speed)
    set(frost, wet, flowStep, light) {
      uniforms.uFrost.value = frost;
      uniforms.uWet.value = wet;
      uniforms.uFlow.value += flowStep;
      uniforms.uLight.value = light;
    },
  };
}

// Mist over the top of the wing (in the wing's own frame).
export function wingVapour() {
  const S0 = 0.07, S1 = 0.72, I = 18, J = 10;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= I; i++)
    for (let j = 0; j <= J; j++) {
      const s = S0 + (S1 - S0) * (i / I), xi = 0.08 + 0.8 * (j / J);
      const p = wingPoint(s, xi, 1, 0.05 + 0.16 * Math.sin((j / J) * Math.PI * 0.8));
      pos.push(p.x, p.y, p.z);
      uv.push(i / I, j / J);
    }
  for (let i = 0; i < I; i++)
    for (let j = 0; j < J; j++) {
      const a = i * (J + 1) + j, b = a + J + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const N = 128;
  const c = cnv(N, N);
  const x = c.getContext('2d');
  const R = rngOf(3);
  x.fillStyle = '#000';
  x.fillRect(0, 0, N, N);
  for (let k = 0; k < 90; k++) {
    const px = R() * N, py = R() * N, rx = 6 + R() * 18, ry = 2 + R() * 5;
    for (const ox of [-N, 0, N])
      for (const oy of [-N, 0, N]) {
        const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rx);
        g.addColorStop(0, `rgba(255,255,255,${0.25 + R() * 0.25})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.save();
        x.translate(px + ox, py + oy);
        x.scale(1, ry / rx);
        x.translate(-(px + ox), -(py + oy));
        x.beginPath();
        x.arc(px + ox, py + oy, rx, 0, Math.PI * 2);
        x.fill();
        x.restore();
      }
  }
  const tex = dataTex(c);
  const mat = new THREE.ShaderMaterial({
    uniforms: { t: { value: tex }, uAmt: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D t; uniform float uAmt, uTime;
      void main(){
        // flows from the leading edge (v=0) to the back of the wing
        float n = texture2D(t, vec2(vUv.x * 2.0, vUv.y * 1.2 - uTime * 1.6)).r;
        n += 0.6 * texture2D(t, vec2(vUv.x * 3.1 + 0.3, vUv.y * 2.0 - uTime * 2.3)).r;
        float edge = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
        float a = clamp(n * 1.3, 0.0, 1.0) * edge * uAmt * 0.85;
        gl_FragColor = vec4(vec3(1.0), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  mesh.visible = false;
  return {
    mesh,
    set(amount, dt) {
      mat.uniforms.uAmt.value = amount;
      mat.uniforms.uTime.value += dt;
      mesh.visible = amount > 0.01;
    },
  };
}

// Wisps of cloud streaming past the left side while you go through the cloud layer.
export function cloudWisps(count = 70) {
  const N = 128;
  const c = cnv(N, N);
  const x = c.getContext('2d');
  const R = rngOf(9);
  for (let k = 0; k < 14; k++) {
    const px = N / 2 + (R() - 0.5) * 50, py = N / 2 + (R() - 0.5) * 30, r = 18 + R() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, r, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pos = new Float32Array(count * 3);
  const P = [];
  for (let i = 0; i < count; i++) {
    P.push({ x: -6 - R() * 45, y: -12 + R() * 22, z: -70 + R() * 140, s: 0.6 + R() * 0.8 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: tex, size: 16, transparent: true, depthWrite: false, opacity: 0, color: '#f3f6fa', fog: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return {
    points: pts,
    update(amount, v, dt) {
      mat.opacity = amount;
      pts.visible = amount > 0.01;
      if (!pts.visible) return;
      P.forEach((p, i) => {
        p.z += v * dt * p.s;
        if (p.z > 70) {
          p.z -= 140;
          p.x = -6 - R() * 45;
          p.y = -12 + R() * 22;
        }
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
      });
      geo.attributes.position.needsUpdate = true;
    },
  };
}
