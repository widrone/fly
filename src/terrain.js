// Shared terrain helpers: tileable value noise and a ring of mountains.
// (Kept apart from world.js and ground.js so neither has to import the other.)

import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth noise in [0,1] that repeats every `cells` units in x and y
export function periodicNoise(cells, seed) {
  const R = rng(seed);
  const g = Float32Array.from({ length: cells * cells }, () => R());
  const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const s = (v) => v * v * (3 - 2 * v);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = s(x - xi), v = s(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// ------------------------------------------------------------------ mountains
// A ring of mountains as one height field: forested slopes, grey rock, snow on the tops.
export function mountainRange(seed, y, { r0 = 4800, r1 = 8200, cx = 0, cz = 0, hMax = 900, segs = 640, rings = 22 } = {}) {
  const nA = periodicNoise(24, seed), nB = periodicNoise(64, seed + 1), nC = periodicNoise(160, seed + 2);
  const ridged = (v) => 1 - Math.abs(2 * v - 1);
  const pos = [], col = [], idx = [];
  const H = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = r0 + (r1 - r0) * t;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const a = u * Math.PI * 2;
      const big = nA(u * 24, t * 3.2);
      const ridge = ridged(nB(u * 64, t * 5));
      const fine = nC(u * 160, t * 9);
      const env = THREE.MathUtils.smoothstep(t, 0, 0.45) * (0.55 + 0.45 * Math.min(1, t * 1.6));
      let h = (0.5 * big + 0.42 * ridge * ridge + 0.06 * fine) * env;
      h = Math.max(0, h - 0.08) * hMax * 1.35;
      if (j === 0) h = -20;
      H.push(h);
      pos.push(cx + Math.cos(a) * r, y + h, cz + Math.sin(a) * r);
    }
  }
  const row = segs + 1;
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const forest = new THREE.Color('#2a4a2f'), rock = new THREE.Color('#6a7377'), rockD = new THREE.Color('#4a5257'), snow = new THREE.Color('#f4f7fa');
  const R = rng(seed + 9);
  const c = new THREE.Color();
  for (let k = 0; k < H.length; k++) {
    const h = H[k];
    const up = nrm.getY(k);
    const jitter = (R() - 0.5) * 90;
    const treeLine = 380 + jitter, snowLine = 720 + jitter * 1.5;
    c.copy(forest);
    if (h > treeLine - 120) c.lerp(up > 0.8 ? rock : rockD, THREE.MathUtils.smoothstep(h, treeLine - 120, treeLine + 60));
    if (h > snowLine - 60 && up > 0.55) c.lerp(snow, THREE.MathUtils.smoothstep(h, snowLine - 60, snowLine + 80) * THREE.MathUtils.smoothstep(up, 0.55, 0.75));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // the fog sees the mountains as nearer than they are, so they keep some colour in the haze
  // (inside a cloud the fog is so thick that they still disappear)
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    // full haze at the foot (like the ground in front), clearer toward the tops
    sh.vertexShader = sh.vertexShader.replace(
      '#include <fog_vertex>',
      `#ifdef USE_FOG
        vFogDepth = - mvPosition.z * mix(1.0, 0.55, clamp((position.y - (${y.toFixed(2)})) / ${(hMax * 0.7).toFixed(1)}, 0.0, 1.0));
      #endif`
    );
  };
  mat.customProgramCacheKey = () => 'mountains';
  return new THREE.Mesh(geo, mat);
}
