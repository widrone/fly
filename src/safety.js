// The safety demo in the cabin: green EXIT signs, floor path lights, glowing outlines for the
// things the crew talk about (your seatbelt, the panel above you where the oxygen masks are
// kept, the life vest under your seat, the safety card in the seat pocket of the row in
// front, across the extra-legroom gap), and the little
// "try it yourself" props: a big safety card to look at and a life vest that slides out.
//
// Frame: the cabin frame (eyes at the origin, nose toward -Z, your seat at x = 0, z = 0).

import * as THREE from 'three';
import { CX, FLOOR, glowTex } from './world.js';

const ZF = -10.6; // front bulkhead
const ZB = 3.0; // rear wall
const EXIT_Z = -0.7; // over-wing exits: the extra-legroom gap right in front of your row

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function rrect(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

function exitTexture(arrow) {
  const c = cnv(256, 96);
  const x = c.getContext('2d');
  x.fillStyle = '#0f9a46';
  x.fillRect(0, 0, 256, 96);
  x.fillStyle = '#ffffff';
  x.font = '900 54px Nunito, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('EXIT', arrow ? 150 : 128, 52);
  if (arrow) {
    x.beginPath();
    x.moveTo(30, 48);
    x.lineTo(62, 22);
    x.lineTo(62, 38);
    x.lineTo(84, 38);
    x.lineTo(84, 58);
    x.lineTo(62, 58);
    x.lineTo(62, 74);
    x.closePath();
    x.fill();
  }
  return tex(c);
}

// The safety card: four simple pictures, like the real card in the seat pocket.
function cardTexture(lang) {
  const c = cnv(1024, 640);
  const x = c.getContext('2d');
  x.fillStyle = '#f7f3e8';
  x.fillRect(0, 0, 1024, 640);
  x.fillStyle = '#1f6f8b';
  x.fillRect(0, 0, 1024, 70);
  x.fillStyle = '#fff';
  x.font = '800 40px Nunito, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(lang === 'nb' ? 'SIKKERHET  ·  SAFETY' : 'SAFETY  ·  SIKKERHET', 512, 37);
  const labels = lang === 'nb' ? ['Setebelte', 'Nødutganger', 'Oksygenmaske', 'Redningsvest'] : ['Seatbelt', 'Exits', 'Oxygen mask', 'Life vest'];
  const box = (i) => [24 + (i % 2) * 500, 90 + Math.floor(i / 2) * 275, 476, 255];
  const ink = '#2b3a4a';
  for (let i = 0; i < 4; i++) {
    const [X, Y, W, H] = box(i);
    x.fillStyle = '#ffffff';
    rrect(x, X, Y, W, H, 18);
    x.fill();
    x.strokeStyle = '#c9c2b0';
    x.lineWidth = 3;
    x.stroke();
    x.fillStyle = ink;
    x.font = '700 30px Nunito, Arial, sans-serif';
    x.fillText(labels[i], X + W / 2, Y + H - 26);
  }
  const person = (cx, cy, s = 1) => {
    x.fillStyle = '#f0c9a8';
    x.beginPath();
    x.arc(cx, cy - 58 * s, 24 * s, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#5b8fd1';
    rrect(x, cx - 34 * s, cy - 30 * s, 68 * s, 90 * s, 18 * s);
    x.fill();
  };
  // 1: seatbelt
  {
    const [X, Y] = box(0);
    person(X + 238, Y + 120);
    x.strokeStyle = '#3d4450';
    x.lineWidth = 12;
    x.beginPath();
    x.moveTo(X + 196, Y + 150);
    x.lineTo(X + 280, Y + 150);
    x.stroke();
    x.fillStyle = '#c9ced6';
    x.fillRect(X + 226, Y + 138, 26, 24);
  }
  // 2: exits with floor lights
  {
    const [X, Y] = box(1);
    x.fillStyle = '#0f9a46';
    x.fillRect(X + 160, Y + 30, 160, 52);
    x.fillStyle = '#fff';
    x.font = '900 34px Nunito, Arial';
    x.fillText('EXIT', X + 240, Y + 58);
    x.fillStyle = '#e0b84a';
    for (let k = 0; k < 7; k++) {
      x.beginPath();
      x.arc(X + 90 + k * 50, Y + 175 - k * 4, 7, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = ink;
    x.lineWidth = 8;
    x.beginPath();
    x.moveTo(X + 330, Y + 140);
    x.lineTo(X + 400, Y + 140);
    x.lineTo(X + 380, Y + 122);
    x.moveTo(X + 400, Y + 140);
    x.lineTo(X + 380, Y + 158);
    x.stroke();
  }
  // 3: oxygen mask
  {
    const [X, Y] = box(2);
    x.fillStyle = '#d7dce3';
    x.fillRect(X + 140, Y + 22, 200, 28);
    x.strokeStyle = '#8a9099';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(X + 240, Y + 50);
    x.lineTo(X + 240, Y + 100);
    x.stroke();
    person(X + 240, Y + 150, 0.85);
    x.fillStyle = '#ffd23a';
    x.beginPath();
    x.ellipse(X + 240, Y + 105, 17, 12, 0, 0, Math.PI * 2);
    x.fill();
  }
  // 4: life vest (under the seat)
  {
    const [X, Y] = box(3);
    x.fillStyle = '#ffcc1a';
    rrect(x, X + 170, Y + 40, 140, 140, 30);
    x.fill();
    x.fillStyle = '#e6a800';
    x.fillRect(X + 232, Y + 40, 16, 140);
    x.fillStyle = '#b84a3a';
    x.beginPath();
    x.arc(X + 292, Y + 72, 9, 0, Math.PI * 2);
    x.fill();
  }
  return tex(c);
}

export function buildSafety(lang = 'en') {
  const g = new THREE.Group();
  const glow = glowTex();
  const exitMats = [];
  const exitMat = (arrow) => {
    const m = new THREE.MeshBasicMaterial({ map: exitTexture(arrow), color: '#9bb5a3', fog: false });
    exitMats.push(m);
    return m;
  };
  const targets = {};

  // --- EXIT signs: hanging over the aisle at the over-wing exits, and on the back wall
  {
    const sign = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.03), new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.5 }));
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.14), exitMat(false));
    f1.position.z = 0.016;
    const f2 = f1.clone();
    f2.rotation.y = Math.PI;
    f2.position.z = -0.016;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), new THREE.MeshStandardMaterial({ color: '#b8bfc8', metalness: 0.6, roughness: 0.4 }));
    rod.position.y = 0.13;
    sign.add(box, f1, f2, rod);
    sign.position.set(CX, 0.66, EXIT_Z);
    g.add(sign);
    targets.exit = sign;
    // small exit plates over the windows of the exit row
    for (const s of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), exitMat(false));
      plate.position.set(CX + s * 1.57, 0.3, EXIT_Z);
      plate.rotation.y = -s * Math.PI / 2;
      plate.rotation.x = 0.0;
      g.add(plate);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), exitMat(true));
    back.position.set(CX, 0.62, ZB - 0.01);
    back.rotation.y = Math.PI;
    g.add(back);
  }

  // --- floor path lights along both sides of the aisle
  const floorMat = new THREE.MeshBasicMaterial({ color: '#4a4740', fog: false });
  {
    const zs = [];
    for (let z = ZF + 0.3; z < ZB - 0.2; z += 0.3) zs.push(z);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), floorMat, zs.length * 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const z of zs) for (const x of [1.21, 1.59]) im.setMatrixAt(k++, m.makeTranslation(x, FLOOR + 0.004, z));
    g.add(im);
  }

  // --- the life vest pouch under your seat, and the vest itself
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), new THREE.MeshStandardMaterial({ color: '#3a414c', roughness: 0.8 }));
  pouch.position.set(0, -0.74, -0.235);
  const tab = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), new THREE.MeshBasicMaterial({ color: '#ffcc1a', fog: false }));
  tab.position.set(0, 0, 0.026);
  pouch.add(tab);
  g.add(pouch);
  targets.vest = pouch;
  const vest = new THREE.Group();
  {
    const m = new THREE.MeshLambertMaterial({ color: '#ffc61a', emissive: '#8a6200', emissiveIntensity: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.05), m);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.035, 8, 16, Math.PI), m);
    collar.position.y = 0.15;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.055), new THREE.MeshStandardMaterial({ color: '#2b2f36' }));
    strap.position.y = -0.08;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a3a' }));
    light.position.set(0.08, 0.06, 0.03);
    vest.add(body, collar, strap, light);
  }
  vest.visible = false;
  g.add(vest);

  // --- big safety card to look at
  const bigCard = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2625), new THREE.MeshBasicMaterial({ map: cardTexture(lang), fog: false, side: THREE.DoubleSide }));
  bigCard.visible = false;
  g.add(bigCard);

  // --- click targets for the card (in the seat pocket in front) and the PSU above you
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const cardHit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.08), hitMat);
  cardHit.position.set(-0.05, -0.37, -1.06);
  g.add(cardHit);
  targets.card = cardHit;
  const psuHit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.46), hitMat);
  psuHit.position.set(0.04, 0.39, -0.3);
  g.add(psuHit);
  targets.psu = psuHit;
  const beltPos = new THREE.Vector3(0, -0.461, -0.13);

  // --- soft glowing halos (and a bright frame) that pulse on whatever is being talked about
  const halos = {};
  const frames = {};
  const frameTex = (() => {
    const c = cnv(256, 256);
    const x = c.getContext('2d');
    x.shadowColor = 'rgba(255,200,40,0.9)';
    x.shadowBlur = 16;
    x.strokeStyle = '#ffffff';
    x.lineWidth = 10;
    rrect(x, 26, 26, 204, 204, 30);
    x.stroke();
    x.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const frame = (key, pos, w, h, flat = false) => {
    // normal blending (not additive), so the frame also shows against white seat backs
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: frameTex, color: '#ffb300', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(pos);
    if (flat) m.rotation.x = Math.PI / 2;
    m.userData.face = !flat;
    m.visible = false;
    m.renderOrder = 21;
    g.add(m);
    frames[key] = m;
  };
  frame('belt', new THREE.Vector3(0, -0.455, -0.13), 0.3, 0.16);
  frame('exit', new THREE.Vector3(CX, 0.66, EXIT_Z - 0.03), 0.56, 0.24);
  frame('vest', new THREE.Vector3(0, -0.74, -0.205), 0.34, 0.16);
  frame('card', new THREE.Vector3(-0.07, -0.37, -1.0), 0.22, 0.26);
  frame('psu', new THREE.Vector3(0.04, 0.384, -0.3), 0.42, 0.5, true);
  const halo = (key, pos, size, flat = false) => {
    const m = flat
      ? new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map: glow, color: '#ffe08a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
      : new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffe08a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    if (flat) {
      m.rotation.x = Math.PI / 2;
    } else m.scale.set(size[0], size[1], 1);
    m.position.copy(pos);
    m.visible = false;
    m.renderOrder = 20;
    g.add(m);
    halos[key] = m;
  };
  halo('belt', beltPos, [0.22, 0.22]);
  halo('exit', new THREE.Vector3(CX, 0.66, EXIT_Z), [0.8, 0.45]);
  halo('psu', new THREE.Vector3(0.04, 0.385, -0.3), [0.5, 0.56], true);
  halo('vest', new THREE.Vector3(0, -0.74, -0.2), [0.36, 0.2]);
  halo('card', new THREE.Vector3(-0.08, -0.37, -1.01), [0.26, 0.3]);

  let lit = new Set();
  let lightsOn = 0, lightsT = 0;
  let cardT = -1, vestT = -1;
  const ease = (t) => t * t * (3 - 2 * t);
  const cardFrom = new THREE.Vector3(-0.09, -0.37, -1.07), cardTo = new THREE.Vector3(0.02, -0.12, -0.52);
  const vestFrom = new THREE.Vector3(0, -0.74, -0.24), vestTo = new THREE.Vector3(0.05, -0.32, -0.48);

  return {
    group: g,
    targets,
    // which things glow, e.g. ['psu'] or [] for none
    highlight(keys) {
      lit = new Set(keys);
    },
    // floor lights and EXIT signs fully on (true) or back to normal (false); `secs` turns off by itself
    lights(on, secs = 0) {
      lightsOn = on ? 1 : 0;
      lightsT = secs;
    },
    showCard(secs = 7) {
      cardT = secs;
    },
    showVest(secs = 6) {
      vestT = secs;
    },
    setLang(l) {
      bigCard.material.map.dispose();
      bigCard.material.map = cardTexture(l);
      bigCard.material.needsUpdate = true;
    },
    reset() {
      lit = new Set();
      lightsOn = 0;
      cardT = vestT = -1;
      bigCard.visible = vest.visible = false;
    },
    update(dt, T) {
      const pulse = 0.55 + 0.45 * Math.sin(T * 4);
      for (const [k, h] of Object.entries(halos)) {
        h.visible = lit.has(k);
        if (h.visible) h.material.opacity = 0.5 + 0.5 * pulse;
      }
      for (const [k, f] of Object.entries(frames)) {
        f.visible = lit.has(k);
        if (!f.visible) continue;
        f.material.opacity = 0.6 + 0.4 * pulse;
        if (f.userData.face) f.lookAt(0, 0, 0);
        f.scale.setScalar(1 + 0.04 * pulse);
      }
      if (lightsT > 0) {
        lightsT -= dt;
        if (lightsT <= 0) lightsOn = 0;
      }
      const L = lightsOn || lit.has('exit') ? 1 : 0;
      floorMat.color.set(L ? '#ffd27a' : '#4a4740');
      exitMats.forEach((m) => m.color.set(L ? '#ffffff' : '#9bb5a3'));
      // the card floats up to you, waits, and goes back
      if (cardT > -1) {
        cardT -= dt;
        const k = cardT > 1 ? Math.min(1, (7 - cardT) / 0.8) : Math.max(0, cardT);
        bigCard.visible = cardT > 0;
        bigCard.position.lerpVectors(cardFrom, cardTo, ease(k));
        bigCard.scale.setScalar(0.3 + 0.7 * ease(k));
        bigCard.lookAt(0, 0, 0);
        if (cardT <= 0) cardT = -1;
      }
      if (vestT > -1) {
        vestT -= dt;
        const k = vestT > 1 ? Math.min(1, (6 - vestT) / 0.8) : Math.max(0, vestT);
        vest.visible = vestT > 0;
        vest.position.lerpVectors(vestFrom, vestTo, ease(k));
        vest.scale.setScalar(0.3 + 0.7 * ease(k));
        vest.lookAt(0, 0, 0);
        if (vestT <= 0) vestT = -1;
      }
    },
  };
}
