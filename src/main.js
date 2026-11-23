import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { Sound, Voice } from './audio.js';
import { Panel } from './ui.js';
import * as W from './world.js';
import { LANGS, pickLanguage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

const sound = new Sound();
const voice = new Voice();
let NAME = '';
let LANG = pickLanguage();
let L = LANGS[LANG];

// ------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 9500);
camera.rotation.order = 'YXZ';
scene.add(camera);

const sky = W.makeSky();
scene.add(sky.mesh);
const hemi = new THREE.HemisphereLight('#dfefff', '#7f8f70', 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
scene.add(sun);
scene.add(sun.target);
scene.fog = new THREE.Fog('#cfe6ff', 400, 7000);

const lounge = W.buildLounge();
scene.add(lounge.group);
const terminal = W.buildTerminal();
scene.add(terminal.group);
const cabin = W.buildCabin();
const plane = W.makeAirliner({ withGear: false });
plane.group.position.set(W.CX, W.FUSE_Y, -2);
const cabinRoot = new THREE.Group();
cabinRoot.add(cabin.group, plane.group);
scene.add(cabinRoot);
const outside = W.buildOutside();
scene.add(outside.group);
const nimbus = W.makeNimbus();
scene.add(nimbus.group);
const confetti = W.makeConfetti();
scene.add(confetti.mesh);

const panel = new Panel(1.0, 0.64, { renderer });
scene.add(panel.mesh);
const caption = new Panel(1.0, 0.36, { px: 720, interactive: false, renderer });
caption.mesh.visible = false;
scene.add(caption.mesh);

const fade = new THREE.Mesh(
  new THREE.SphereGeometry(1.5, 24, 12),
  new THREE.MeshBasicMaterial({ color: '#0b1020', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })
);
fade.renderOrder = 1000;
scene.add(fade);

// ------------------------------------------------------------ scene presets
const DAY = { top: '#3b7ad6', hor: '#cde4fb', bot: '#d9e6f1', sunDir: [-0.5, 0.7, -0.5], sunCol: '#fff2d6' };
const PRESETS = {
  lounge: {
    sky: { top: '#2e3878', hor: '#ffc4a6', bot: '#f3bccb', sunDir: [0.55, 0.06, -0.83], sunCol: '#ffd2a3' },
    fog: ['#f6c6bd', 150, 3200],
    hemi: ['#ffe4f2', '#a892d3', 1.6],
    sun: ['#ffd2a3', 1.3],
    panel: [[0, -0.3, -1.2], 0.9],
    nimbus: [[0, 0.3, -1.55], 1],
  },
  terminal: {
    sky: DAY,
    fog: ['#cde4fb', 500, 8000],
    hemi: ['#e3f0ff', '#aab3bc', 1.35],
    sun: ['#fff3e0', 2.1],
    panel: [[0.42, -0.14, -1.15], 0.78],
    nimbus: [[0.86, 0.22, -1.12], 0.85],
  },
  cabin: {
    sky: DAY,
    fog: ['#cde4fb', 450, 7500],
    hemi: ['#e3f0ff', '#aab3bc', 1.35],
    sun: ['#fff3e0', 2.2],
    panel: [[0.12, 0.08, -0.85], 0.62],
    nimbus: [[0.6, 0.24, -0.95], 0.7],
  },
};
let sceneName = null;
const baseFog = { color: new THREE.Color(), near: 400, far: 7000 };

function showScene(name) {
  sceneName = name;
  sound.setScene(name);
  lounge.group.visible = name === 'lounge';
  terminal.group.visible = name === 'terminal';
  cabinRoot.visible = outside.group.visible = name === 'cabin';
  const P = PRESETS[name];
  const u = sky.uniforms;
  u.top.value.set(P.sky.top);
  u.hor.value.set(P.sky.hor);
  u.bot.value.set(P.sky.bot);
  u.sunDir.value.set(...P.sky.sunDir).normalize();
  u.sunCol.value.set(P.sky.sunCol);
  u.white.value = 0;
  baseFog.color.set(P.fog[0]);
  baseFog.near = P.fog[1];
  baseFog.far = P.fog[2];
  scene.fog.color.copy(baseFog.color);
  scene.fog.near = baseFog.near;
  scene.fog.far = baseFog.far;
  hemi.color.set(P.hemi[0]);
  hemi.groundColor.set(P.hemi[1]);
  hemi.intensity = P.hemi[2];
  sun.color.set(P.sun[0]);
  sun.intensity = P.sun[1];
  sun.position.copy(u.sunDir.value).multiplyScalar(1000);
  const [pp, ps] = P.panel;
  panel.mesh.position.set(...pp);
  panel.mesh.scale.setScalar(ps);
  panel.mesh.lookAt(0, 0, 0);
  const [np, ns] = P.nimbus;
  nimbus.group.position.set(...np);
  nimbus.group.scale.setScalar(ns);
  caption.mesh.position.set(-0.26, 0.24, -0.2);
  caption.mesh.scale.setScalar(0.36);
  caption.mesh.lookAt(0, 0, 0);
}

// ------------------------------------------------------------ flight state
const F = {
  mode: 'gate',
  alt: 0,
  v: 0,
  dist: 0,
  rwZ0: 0,
  gateZ0: 0,
  engine: 0,
  engineT: 0,
  flaps: 0,
  flapsT: 0,
  spoil: 0,
  spoilT: 0,
  gear: 1,
  bumpLevel: 0,
  bumpY: 0,
  rough: 0,
  sign: false,
  manual: false,
  target: { alt: 0, v: 0 },
  sinceThump: 0,
  nL: 0, // engine spool (0 = off, 1 = running)
  nR: 0,
  nLT: 0,
  nRT: 0,
  apu: 0,
  apuT: 0,
  life: 0, // how busy the cabin sounds
};

const SETUPS = {
  lounge: { scene: 'lounge' },
  terminal: { scene: 'terminal' },
  gate: { scene: 'cabin', outside: 'gate', alt: 0, v: 0, engine: 0, flaps: 0, belt: false, sign: false, eng: 0, apu: 1 },
  gateBelt: { scene: 'cabin', outside: 'gate', alt: 0, v: 0, engine: 0, flaps: 0, belt: true, sign: true, eng: 0, apu: 1 },
  runway: { scene: 'cabin', outside: 'runway', alt: 0, v: 0, rwZ0: 0, engine: 0.14, flaps: 0.45, belt: true, sign: true },
  cruise: { scene: 'cabin', outside: 'air', alt: 640, v: 65, rwZ0: 1e6, engine: 0.45, flaps: 0, gear: 0, belt: true, sign: false, tray: true },
  approach: { scene: 'cabin', outside: 'air', alt: 640, v: 65, rwZ0: 1e6, engine: 0.45, flaps: 0, gear: 0, belt: true, sign: true },
  landed: { scene: 'cabin', outside: 'runway', alt: 0, v: 0, rwZ0: 1060, engine: 0.1, flaps: 0, belt: true, sign: false },
};
let setupKey = null;

function applySetup(key, hard) {
  const S = SETUPS[key];
  if (S.scene !== sceneName) showScene(S.scene);
  setupKey = key;
  if (S.scene !== 'cabin') return;
  if (hard || S.outside === 'gate' || F.mode === 'gate') {
    F.alt = S.alt;
    F.v = S.v;
    F.dist = 0;
    F.rwZ0 = S.rwZ0 ?? 0;
    F.gateZ0 = 0;
    F.engine = S.engine;
    F.flaps = S.flaps;
    F.spoil = 0;
    F.nL = F.nR = F.nLT = F.nRT = S.eng ?? 1;
    F.apu = F.apuT = S.apu ?? 0;
    if (S.outside === 'gate') outside.setBridge(-0.75);
  }
  F.mode = S.outside;
  F.target = { alt: S.alt, v: S.v };
  F.manual = false;
  F.engineT = S.engine;
  F.flapsT = S.flaps;
  F.spoilT = 0;
  F.gear = S.gear ?? 1;
  F.bumpLevel = 0;
  F.life = S.outside === 'gate' ? 1 : S.outside === 'air' ? 0.6 : 0.3;
  F.sign = S.sign;
  cabin.setBelt(S.belt);
  cabin.setSign(S.sign);
  cabin.tray.visible = !!S.tray;
}

let T = 0;
let mixTimer = 0;
function noise(t) {
  return Math.sin(t * 2.3) * 0.5 + Math.sin(t * 3.9 + 1.3) * 0.3 + Math.sin(t * 6.1 + 2.1) * 0.2;
}

// Turbulence: discrete bumps that move the view, the wing, the water, the sound and the rumble together.
const bumps = { list: [], next: 0.4 };
function updateBumps(dt) {
  const lvl = F.bumpLevel;
  F.rough += ([0, 0.35, 0.8][lvl] - F.rough) * Math.min(1, dt * 1.5);
  if (lvl > 0) {
    bumps.next -= dt;
    if (bumps.next <= 0) {
      const amp = (lvl === 1 ? 0.32 : 0.72) * (0.6 + Math.random() * 0.6);
      bumps.list.push({ t: 0, amp, f: 0.8 + Math.random() * 0.6, s: Math.random() < 0.5 ? -1 : 1 });
      sound.bump(amp);
      buzz(amp * 0.7, 90 + amp * 120);
      bumps.next = (lvl === 1 ? 1.9 : 1.05) * (0.55 + Math.random() * 0.9);
    }
  }
  let y = 0;
  for (let i = bumps.list.length - 1; i >= 0; i--) {
    const b = bumps.list[i];
    b.t += dt;
    y += b.s * b.amp * Math.exp(-b.t * 2.3) * Math.sin(b.t * Math.PI * 2 * b.f + 0.25);
    if (b.t > 3.5) bumps.list.splice(i, 1);
  }
  y += noise(T * 1.1) * 0.12 * F.rough;
  const dy = (y - F.bumpY) / Math.max(dt, 1e-3);
  F.bumpY = y;
  return dy;
}

function setFlaps(v) {
  const d = Math.abs(v - F.flapsT);
  if (d > 0.01) sound.flaps(clamp(d / 0.12, 2.5, 8));
  F.flapsT = v;
}

// Timers that belong to the current step (cleared when the step changes)
const timers = [];
function later(sec, fn) {
  timers.push({ t: sec, fn });
}
function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) {
      const fn = timers[i].fn;
      timers.splice(i, 1);
      fn();
    }
  }
}

function gearUp() {
  sound.gearUp();
  buzz(0.35, 80, 0.35);
  later(3.6, () => {
    F.gear = 0;
    buzz(0.8, 160);
  });
  later(4.4, () => buzz(0.35, 80));
}
function gearDown() {
  sound.gearDown();
  buzz(0.4, 90, 0.6);
  later(0.8, () => (F.gear = 1));
  later(2.6, () => buzz(0.7, 140));
  later(2.95, () => buzz(0.6, 120));
}

function updateFlight(dt) {
  if (!F.manual) {
    F.alt += clamp(F.target.alt - F.alt, -12 * dt, 12 * dt);
    F.v += clamp(F.target.v - F.v, -2.5 * dt, 2.5 * dt);
  }
  F.engine += (F.engineT - F.engine) * Math.min(1, dt * 0.9);
  F.flaps += clamp(F.flapsT - F.flaps, -0.12 * dt, 0.12 * dt);
  F.spoil += clamp(F.spoilT - F.spoil, -1.5 * dt, 1.5 * dt);
  F.nL += clamp(F.nLT - F.nL, -dt / 9, dt / 9);
  F.nR += clamp(F.nRT - F.nR, -dt / 9, dt / 9);
  F.apu += clamp(F.apuT - F.apu, -dt / 4, dt / 4);
  F.dist += F.v * dt;
  const onGround = F.alt < 0.3;

  const dy = updateBumps(dt);
  outside.group.position.y = -F.alt + F.bumpY * 1.7;
  cabinRoot.position.y = F.bumpY * 0.004; // a tiny jolt, in step with the rumble
  cabin.waterPivot.rotation.x = clamp(dy * 0.05, -0.35, 0.35) + Math.sin(T * 7) * 0.03 * F.rough;
  cabin.waterPivot.rotation.z = noise(T * 1.7 + 4) * 0.15 * F.rough;
  cabin.cup.position.y = 0.058 + Math.max(0, F.bumpY) * 0.004;
  const flex = F.bumpY * 0.022 + Math.sin(T * 0.9) * 0.0015 * (onGround ? 0 : 1);
  plane.wings[0].group.rotation.z = -0.075 - flex;
  plane.wings[1].group.rotation.z = 0.075 + flex;

  outside.groundTex.offset.y = (F.dist / outside.TILE) % 1;
  outside.ground.visible = F.mode !== 'gate';
  outside.gate.visible = F.mode === 'gate';
  outside.gate.position.z = F.dist - F.gateZ0;
  const az = F.rwZ0 + F.dist;
  outside.airport.visible = F.mode !== 'gate' && az > -12000 && az < 12000;
  outside.airport.position.z = az;
  const TL = outside.TL;
  for (const tile of outside.tiles) {
    let z = tile.userData.base + F.dist;
    z = ((((z + 1.5 * TL) % (3 * TL)) + 3 * TL) % (3 * TL)) - 1.5 * TL;
    tile.position.z = z;
  }
  outside.beacon.visible = (T % 1) < 0.5;
  if (F.mode === 'gate') {
    const a = T * 0.06;
    outside.tug.position.z = 30 - ((T * 2.2) % 70);
  }

  // inside the cloud layer everything turns soft white
  const c = clamp(Math.min((F.alt - (W.CLOUD_ALT - 50)) / 28, (W.CLOUD_ALT + 50 - F.alt) / 28), 0, 1);
  scene.fog.near = lerp(baseFog.near, 0.5, c);
  scene.fog.far = lerp(baseFog.far, 26, Math.pow(c, 0.5));
  scene.fog.color.copy(baseFog.color).lerp(new THREE.Color('#eef2f6'), c);
  sky.uniforms.white.value = c;
  hemi.intensity = lerp(1.35, 1.0, c);

  plane.wings.forEach((w) => {
    w.setFlaps(F.flaps);
    w.setSpoilers(F.spoil);
    w.strobe(T);
  });

  if (onGround && F.v > 0.5) {
    F.sinceThump += F.v * dt;
    if (F.sinceThump > 30) {
      F.sinceThump = 0;
      sound.joint(F.v);
    }
  }
}

function soundState() {
  const inCabin = sceneName === 'cabin';
  return {
    scene: sceneName,
    running,
    n: [F.nL, F.nR],
    thrust: F.engine,
    v: F.v,
    ground: F.alt < 0.3,
    gearDown: !!F.gear,
    rough: inCabin ? F.rough : 0,
    apu: F.apu,
    life: F.life * (1 - Math.min(1, F.engine * 1.2)),
    phase: F.mode === 'gate' && !seq ? 'boarding' : F.mode === 'air' && F.alt > 500 && !seq ? 'cruise' : 'none',
  };
}

// ------------------------------------------------------------ fades & tweens
const tweens = [];
function tween(dur, fn) {
  return new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
}
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) {
      tweens.splice(i, 1);
      tw.res();
    }
  }
}
function fadeTo(v, dur) {
  const a = fade.material.opacity;
  return tween(dur, (k) => (fade.material.opacity = lerp(a, v, smooth(k))));
}

// ------------------------------------------------------------ breathing
const breath = { active: false, t: 0, total: 3, IN: 4, OUT: 5, onDone: null, key: '', base: null };
function startBreathing(total, base, onDone) {
  Object.assign(breath, { active: true, t: 0, total, onDone, key: '', base });
}
function updateBreath(dt) {
  if (!breath.active) {
    nimbus.breath += (1 - nimbus.breath) * Math.min(1, dt * 3);
    nimbus.halo.material.opacity *= 0.95;
    return;
  }
  breath.t += dt;
  const cyc = breath.IN + breath.OUT;
  const k = Math.floor(breath.t / cyc);
  if (k >= breath.total) {
    breath.active = false;
    if (breath.onDone) breath.onDone();
    return;
  }
  const ph = breath.t - k * cyc;
  const inhale = ph < breath.IN;
  const e = inhale ? smooth(ph / breath.IN) : 1 - smooth((ph - breath.IN) / breath.OUT);
  nimbus.breath = 1 + 0.4 * e;
  nimbus.halo.material.opacity = 0.25 + 0.35 * e;
  nimbus.halo.scale.setScalar(1 + 0.45 * e);
  const sec = inhale ? Math.floor(ph) + 1 : Math.floor(ph - breath.IN) + 1;
  const key = `${k}-${inhale}-${sec}`;
  if (key !== breath.key) {
    const phaseStart = !breath.key.startsWith(`${k}-${inhale}-`);
    breath.key = key;
    if (phaseStart) {
      sound.breath(inhale, inhale ? breath.IN : breath.OUT);
      voice.say(inhale ? L.breath.sayIn : L.breath.sayOut);
    }
    panel.set({
      ...breath.base,
      big: inhale ? L.breath.in : L.breath.out,
      count: `${sec} ${L.breath.of} ${inhale ? breath.IN : breath.OUT}`,
      dots: [k, breath.total],
    });
  }
}

// ------------------------------------------------------------ the story
const N = (s) => s.replace('{N}', NAME ? `, ${NAME}` : '');
// The story. The words for each step live in i18n.js under steps.<id>; buttons are [label key, action, style].
const STEPS = [
  { id: 'welcome', setup: 'lounge', calm: false, buttons: [['hiNimbus', 'next']] },
  { id: 'boss', setup: 'lounge', highlightCalm: true, buttons: [['gotIt', 'next']] },
  { id: 'breathe', setup: 'lounge', calm: false, buttons: [['breathe', 'breathe3']] },
  { id: 'breathed', setup: 'lounge', calm: false, buttons: [['again', 'breathe3', 'secondary'], ['toAirport', 'next']] },

  { id: 'gate1', setup: 'terminal', progress: 0.04 },
  { id: 'gate2', setup: 'terminal', progress: 0.06 },
  { id: 'gate3', setup: 'terminal', progress: 0.08 },
  { id: 'gate4', setup: 'terminal', progress: 0.1, buttons: [['board', 'next']] },

  { id: 'seat1', setup: 'gate', progress: 0.13 },
  { id: 'seat2', setup: 'gate', progress: 0.15, buttons: [['buckle', 'buckle']] },
  { id: 'seat3', setup: 'gateBelt', progress: 0.17, onEnter: () => sound.ding() },
  { id: 'seat4', setup: 'gateBelt', progress: 0.19 },
  { id: 'taxi0', setup: 'gateBelt', progress: 0.21, buttons: [['taxi', 'next']] },
  { id: 'taxi', setup: 'gateBelt', progress: 0.24, seq: 'taxi', resumeTo: 'taxi0' },

  { id: 'takeoff0', setup: 'runway', progress: 0.28, calm: false, buttons: [['breatheFirst', 'calm', 'secondary'], ['takeOff', 'next']] },
  { id: 'takeoff', setup: 'runway', progress: 0.36, seq: 'takeoff', resumeTo: 'takeoff0' },

  { id: 'cruise1', setup: 'cruise', progress: 0.5 },
  { id: 'cruise2', setup: 'cruise', progress: 0.55 },
  { id: 'bumps1', setup: 'cruise', progress: 0.6 },
  { id: 'bumps2', setup: 'cruise', progress: 0.64, bumps: true },
  { id: 'bumps3', setup: 'cruise', progress: 0.68 },

  { id: 'land0', setup: 'approach', progress: 0.74, calm: false, buttons: [['breatheFirst', 'calm', 'secondary'], ['land', 'next']] },
  { id: 'land', setup: 'approach', progress: 0.85, seq: 'landing', resumeTo: 'land0' },
  {
    id: 'done', setup: 'landed', progress: 1, calm: false, badge: true,
    buttons: [['flyAgain', 'restart', 'secondary'], ['lounge', 'free', 'secondary'], ['finish', 'exit']],
    onEnter: () => {
      sound.celebrate();
      confetti.start(new THREE.Vector3(0.5, 0.5, -1.1), new THREE.Vector3(1.8, 0.4, 1.0));
    },
  },
  { id: 'break', setup: 'lounge', calm: false, breathe: true, buttons: [['back', 'resume']] },
  { id: 'free', setup: 'lounge', calm: false, breathe: true, buttons: [['finish', 'exit', 'secondary'], ['flyAgain', 'restart']] },
];
const byId = (id) => STEPS.findIndex((s) => s.id === id);
let cur = -1;
let busy = false;
let breakReturn = 'welcome';
let seq = null;

const words = (id) => L.steps[id] || {};
function stepContent(st, extra = {}) {
  let buttons = st.buttons || [['next', 'next']];
  if (st.bumps) {
    const st2 = (lvl) => (F.bumpLevel === lvl ? 'active' : 'secondary');
    buttons = [['tiny', 'bump1', st2(1)], ['little', 'bump2', st2(2)], ['smooth', 'bump0', st2(0)], ['next', 'next']];
  }
  const w = words(st.id);
  return {
    title: w.title ? N(w.title) : '',
    text: w.text ? N(w.text) : '',
    buttons: buttons.map(([k, a, style]) => [L.btn[k] || k, a, style]),
    calm: st.calm,
    progress: st.progress,
    badge: st.badge,
    highlightCalm: st.highlightCalm,
    ...extra,
  };
}

function say(title, text) {
  voice.say([title, text].filter(Boolean).join('. '));
}

async function go(id, { instant = false } = {}) {
  const i = byId(id);
  if (i < 0) return;
  const st = STEPS[i];
  busy = true;
  seq = null;
  breath.active = false;
  caption.mesh.visible = false;
  confetti.mesh.visible = false;
  timers.length = 0;
  bumps.list.length = 0;
  voice.stop();
  const S = SETUPS[st.setup];
  const needFade = !instant && S.scene !== sceneName;
  if (needFade) {
    await fadeTo(1, 0.5);
  }
  applySetup(st.setup, needFade || instant || setupKey === null);
  cur = i;
  if (st.onEnter) st.onEnter();
  if (st.seq) {
    startSeq(st.seq);
  } else if (st.breathe) {
    const base = stepContent(st);
    startBreathing(Infinity, base, null);
    voice.say(words(st.id).say);
  } else {
    const c = stepContent(st);
    panel.set(c);
    say(c.title, c.text);
  }
  nimbus.talk();
  if (needFade) await fadeTo(0, 0.6);
  busy = false;
}

function next() {
  const st = STEPS[cur];
  const n = STEPS[cur + 1];
  if (n) go(n.id);
}

function action(a) {
  if (busy) return;
  sound.pop();
  const st = STEPS[cur];
  if (a === 'next') return next();
  if (a === 'calm') {
    breakReturn = st.resumeTo || st.id;
    return go('break');
  }
  if (a === 'resume') return go(breakReturn);
  if (a === 'restart') return go('gate1');
  if (a === 'free') return go('free');
  if (a === 'exit') return exitExperience();
  if (a === 'breathe3') {
    startBreathing(3, { title: L.breath.title, calm: false, buttons: [] }, () => go('breathed'));
    return;
  }
  if (a === 'buckle') {
    sound.click();
    cabin.setBelt(true);
    setTimeout(() => go('seat3'), 700);
    busy = true;
    return;
  }
  if (a.startsWith('bump')) {
    const lvl = +a.slice(4);
    F.bumpLevel = lvl;
    if (lvl > 0 && !F.sign) {
      sound.ding();
      cabin.setSign(true);
      F.sign = true;
    }
    if (lvl === 0 && F.sign) {
      cabin.setSign(false);
      F.sign = false;
    }
    panel.set(stepContent(st));
    voice.say(L.bumpSay[lvl]);
  }
}

// ------------------------------------------------------------ timed sequences
function cap(key) {
  const [title, text] = L.cap[key];
  const st = STEPS[cur];
  panel.set({ title, text, buttons: [], calm: true, progress: st.progress });
  caption.set({ title, text, textSize: 44, titleSize: 64 });
  caption.mesh.visible = true;
  say(title, text);
  nimbus.talk();
}

function startSeq(name) {
  const s = { t: 0, events: [], tick: () => {}, done: false };
  const at = (t, fn) => s.events.push({ t, fn });
  const when = (cond, fn) => s.events.push({ cond, fn });
  if (name === 'taxi') {
    F.manual = true;
    at(0, () => {
      sound.door();
      buzz(0.4, 120, 0.85);
      cap('doorClosed');
    });
    at(5, () => {
      sound.engineStart('R');
      F.nRT = 1;
      cap('engineOne');
    });
    at(10.5, () => {
      sound.engineStart('L');
      F.nLT = 1;
      cap('engineTwo');
    });
    at(16, () => {
      F.apuT = 0;
      F.engineT = 0.2;
      cap('rolling');
    });
    at(22, () => {
      setFlaps(0.45);
      cap('flapsOut');
    });
    at(29, () => go('takeoff0'));
    s.tick = (t) => {
      outside.setBridge(lerp(-0.75, -24, smooth((t - 0.8) / 4)));
      F.v = t > 16.5 ? Math.min(5, (t - 16.5) * 1.1) : 0;
    };
  }
  if (name === 'takeoff') {
    F.manual = true;
    F.rwZ0 = -F.dist;
    let climb = 0;
    let doneAt = Infinity;
    at(0, () => {
      F.engineT = 1;
      cap('hereWeGo');
    });
    at(7, () => cap('faster'));
    at(16, () => cap('liftOff'));
    at(21, () => {
      gearUp();
      cap('gearUp');
    });
    at(28, () => {
      F.engineT = 0.7;
      cap('quieter');
    });
    at(31, () => setFlaps(0));
    when(() => F.alt >= W.CLOUD_ALT - 48, () => cap('intoCloud'));
    when(() => F.alt >= W.CLOUD_ALT + 52, () => {
      cap('aboveClouds');
      doneAt = s.t + 6;
    });
    when(() => s.t > doneAt, () => go('cruise1'));
    s.tick = (t, dt) => {
      if (t > 2.5) F.v = Math.min(78, F.v + 5.2 * dt);
      if (t > 16) {
        climb = Math.min(18, climb + 4.5 * dt);
        F.alt += climb * dt;
      }
    };
  }
  if (name === 'landing') {
    F.manual = true;
    const a0 = F.alt;
    F.v = 65;
    F.rwZ0 = 400 - F.dist - 65 * 44;
    F.engineT = 0.25;
    at(0, () => {
      sound.ding();
      cabin.setSign(true);
      cap('glide');
    });
    at(8, () => {
      setFlaps(0.5);
      cap('flapsLand');
    });
    when(() => F.alt < W.CLOUD_ALT + 48, () => cap('backThrough'));
    when(() => F.alt < W.CLOUD_ALT - 80, () => cap('ground'));
    at(29, () => {
      gearDown();
      cap('gearDown');
    });
    at(35, () => setFlaps(1));
    at(44, () => {
      sound.touchdown();
      buzz(1, 220);
      later(0.35, () => sound.spoilers());
      later(1.3, () => {
        sound.noseDown();
        buzz(0.6, 140);
      });
      F.spoilT = 1;
      F.engineT = 0.85;
      cap('touchdown');
    });
    at(50, () => (F.engineT = 0.15));
    at(60, () => {
      sound.ding();
      cabin.setSign(false);
      F.spoilT = 0;
      setFlaps(0);
      cap('welcome');
    });
    at(64, () => go('done'));
    s.tick = (t, dt) => {
      if (t < 44) {
        F.alt = a0 * (1 - smooth((t - 3) / 41));
        F.v = 65;
      } else {
        F.alt = 0;
        F.v = Math.max(t > 60 ? 0 : 8, F.v - 3.4 * dt);
      }
    };
  }
  seq = s;
}

function updateSeq(dt) {
  if (!seq) return;
  const s = seq;
  s.t += dt;
  s.tick(s.t, dt);
  for (const e of s.events) {
    if (e.fired) continue;
    if ((e.t !== undefined && s.t >= e.t) || (e.cond && e.cond())) {
      e.fired = true;
      e.fn();
      if (seq !== s) return;
    }
  }
}

// ------------------------------------------------------------ input: controllers & hands
const raycaster = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();
const controllers = [];
const handFactory = new XRHandModelFactory();
const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, fog: false });
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, fog: false })
  );
  line.scale.z = 1.5;
  c.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), dotMat);
  dot.renderOrder = 950;
  dot.visible = false;
  scene.add(dot);
  c.userData = { line, dot, src: null };
  c.addEventListener('connected', (e) => (c.userData.src = e.data));
  c.addEventListener('disconnected', () => (c.userData.src = null));
  c.addEventListener('select', () => onSelect(c));
  scene.add(c);
  controllers.push(c);
  const grip = renderer.xr.getControllerGrip(i);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 10), new THREE.MeshLambertMaterial({ color: '#e9edf3', emissive: '#556070', fog: false }));
  body.rotation.x = Math.PI / 2 - 0.5;
  grip.add(body);
  grip.addEventListener('connected', (e) => (body.visible = !e.data.hand));
  scene.add(grip);
  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, 'spheres'));
  scene.add(hand);
}
function aim(c) {
  tmpM.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
}
function pickPanel() {
  if (!panel.mesh.visible) return null;
  const h = raycaster.intersectObject(panel.mesh, false);
  return h[0] || null;
}
function haptic(c, v = 0.3, ms = 30) {
  try {
    const a = c.userData.src && c.userData.src.gamepad && c.userData.src.gamepad.hapticActuators;
    if (a && a[0] && a[0].pulse) a[0].pulse(v, ms);
  } catch (e) {}
}
// controller rumble, scaled by the rumble setting; delay in seconds
function buzz(amp, ms, delay = 0) {
  const k = sound.haptic;
  if (k <= 0) return;
  const fire = () => controllers.forEach((c) => haptic(c, Math.min(1, amp * (0.4 + 0.6 * k)), ms));
  if (delay) later(delay, fire);
  else fire();
}
function onSelect(c) {
  aim(c);
  const h = pickPanel();
  if (!h) return;
  const i = panel.hit(h.uv);
  if (i >= 0) {
    haptic(c);
    action(panel.rects[i].action);
  }
}
function updateXRHover() {
  let hov = -1;
  for (const c of controllers) {
    const { line, dot, src } = c.userData;
    if (!src) {
      dot.visible = false;
      continue;
    }
    aim(c);
    const h = pickPanel();
    if (h) {
      line.scale.z = h.distance;
      dot.position.copy(h.point);
      dot.visible = true;
      const i = panel.hit(h.uv);
      if (i >= 0) hov = i;
    } else {
      line.scale.z = 1.5;
      dot.visible = false;
    }
  }
  panel.setHover(hov);
}

// ------------------------------------------------------------ preview (phone / desktop) controls
let yaw = 0;
let pitch = 0;
let drag = null;
const ndc = new THREE.Vector2();
const cvs = renderer.domElement;
function pickAt(e) {
  const r = cvs.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const h = pickPanel();
  return h ? panel.hit(h.uv) : -1;
}
cvs.addEventListener('pointerdown', (e) => {
  if (!running || renderer.xr.isPresenting) return;
  drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
  try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
});
cvs.addEventListener('pointermove', (e) => {
  if (!running || renderer.xr.isPresenting) return;
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
    yaw = drag.yaw + dx * 0.005;
    pitch = clamp(drag.pitch + dy * 0.005, -1.3, 1.3);
  } else if (e.pointerType === 'mouse') {
    const i = pickAt(e);
    panel.setHover(i);
    cvs.style.cursor = i >= 0 ? 'pointer' : 'grab';
  }
});
cvs.addEventListener('pointerup', (e) => {
  if (!running || renderer.xr.isPresenting) return;
  if (drag && !drag.moved) {
    const i = pickAt(e);
    if (i >= 0) action(panel.rects[i].action);
  }
  drag = null;
});
window.addEventListener('keydown', (e) => {
  if (!running) return;
  if (e.key === 'ArrowLeft') yaw += 0.15;
  if (e.key === 'ArrowRight') yaw -= 0.15;
  if (e.key === 'ArrowUp') pitch = clamp(pitch + 0.1, -1.3, 1.3);
  if (e.key === 'ArrowDown') pitch = clamp(pitch - 0.1, -1.3, 1.3);
});
function fitCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const hf = THREE.MathUtils.degToRad(w < h ? 64 : 84);
  const vf = 2 * Math.atan(Math.tan(hf / 2) / camera.aspect);
  camera.fov = clamp(THREE.MathUtils.radToDeg(vf), 62, 110);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', fitCamera);
fitCamera();

// ------------------------------------------------------------ start / stop
let running = false;
let xrSession = null;

function readOptions() {
  NAME = ($('name').value || '').trim().slice(0, 20);
  voice.on = $('voice').checked;
  sound.setHaptics(parseFloat($('rumble').value));
  return $('chapter').value;
}

async function begin(chapter) {
  running = true;
  $('start').classList.add('hidden');
  try { await document.fonts.load('800 40px Nunito'); } catch (e) {}
  setupKey = null;
  sceneName = null;
  yaw = 0;
  fade.material.opacity = 1;
  await go(chapter, { instant: true });
  fadeTo(0, 0.8);
}

async function enterVR() {
  const chapter = readOptions();
  sound.init();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['hand-tracking'] });
    xrSession = session;
    session.addEventListener('end', () => {
      xrSession = null;
      stopExperience();
    });
    await renderer.xr.setSession(session);
    begin(chapter);
  } catch (e) {
    xrState = 'fail';
    xrDetail = e && e.message ? e.message : String(e);
    renderXrMsg();
  }
}

function preview() {
  const chapter = readOptions();
  sound.init();
  $('hud').classList.remove('hidden');
  begin(chapter);
}

function stopExperience() {
  running = false;
  seq = null;
  breath.active = false;
  voice.stop();
  $('hud').classList.add('hidden');
  $('start').classList.remove('hidden');
  showScene('lounge');
  panel.mesh.visible = true;
  panel.set({ title: L.ui.idle, text: L.ui.bye, buttons: [], calm: false });
}

function exitExperience() {
  if (xrSession) xrSession.end();
  else stopExperience();
}

$('vr').addEventListener('click', enterVR);
$('preview').addEventListener('click', preview);
$('exit').addEventListener('click', exitExperience);
$('rumble').addEventListener('change', () => sound.setHaptics(parseFloat($('rumble').value)));
$('testRumble').addEventListener('click', () => {
  sound.init();
  sound.setHaptics(parseFloat($('rumble').value));
  sound.testRumble();
});
voice.onSpeaking = (on) => sound.duck(on);

let xrState = 'checking';
let xrDetail = '';
function renderXrMsg() {
  $('xrmsg').textContent = L.page.xr[xrState] + (xrState === 'fail' ? xrDetail : '');
}

// ------------------------------------------------------------ language
function setLanguage(code) {
  if (!LANGS[code]) code = 'en';
  LANG = code;
  L = LANGS[code];
  try {
    localStorage.setItem('fly-lang', code);
  } catch (e) {}
  const P = L.page;
  document.documentElement.lang = code === 'nb' ? 'nb' : 'en';
  document.title = P.docTitle;
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = P[el.dataset.t]));
  document.querySelectorAll('[data-th]').forEach((el) => (el.innerHTML = P[el.dataset.th]));
  $('name').placeholder = P.namePh;
  [...$('chapter').options].forEach((o, i) => (o.textContent = P.chapters[i]));
  [...$('rumble').options].forEach((o, i) => (o.textContent = P.rumbleOpts[i]));
  $('tips').innerHTML = P.tips.map((t) => `<li>${t}</li>`).join('');
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === code)));
  panel.labels = caption.labels = L.ui;
  terminal.setBoard(L.board);
  voice.setLang(L.speech);
  renderVoiceNote();
  renderXrMsg();
  if (!running) panel.set({ title: L.ui.idle, text: '', buttons: [], calm: false });
}
function renderVoiceNote() {
  $('voicenote').textContent = voice.available ? '' : L.page.noVoice;
}
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.lang)));
voice.onVoices = renderVoiceNote;

async function checkXR() {
  const btn = $('vr');
  let ok = false;
  try {
    ok = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
  } catch (e) {}
  btn.disabled = !ok;
  const embedded = window.self !== window.top;
  const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
  xrState = ok ? 'ok' : quest && embedded ? 'embedded' : 'open';
  renderXrMsg();
}
checkXR();
setLanguage(LANG);

// ------------------------------------------------------------ main loop
showScene('lounge');
panel.set({ title: L.ui.idle, text: '', buttons: [], calm: false });
const clock = new THREE.Clock();
const headPos = new THREE.Vector3();
const headQ = new THREE.Quaternion();
const fwdV = new THREE.Vector3();
const upV = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  T += dt;
  tick(dt);
  renderer.render(scene, camera);
});

function tick(dt) {
  updateTweens(dt);
  if (running) {
    updateSeq(dt);
    updateBreath(dt);
  }
  if (running) updateTimers(dt);
  if (sceneName === 'cabin') updateFlight(dt);
  mixTimer -= dt;
  if (mixTimer <= 0) {
    mixTimer = 0.1;
    sound.update(soundState(), 0.1);
  }
  if (lounge.group.visible) lounge.update(dt);
  if (terminal.group.visible) {
    terminal.update(dt);
    const p = terminal.jet.pos;
    sound.setFarJet(p.x, p.y, p.z, running && terminal.jet.on);
  }
  nimbus.update(T, dt);
  confetti.update(dt);
  if (renderer.xr.isPresenting) {
    renderer.xr.getCamera().getWorldPosition(headPos);
    updateXRHover();
  } else {
    if (!running) {
      yaw = Math.sin(T * 0.05) * 0.5;
      pitch = 0.05;
    }
    camera.position.set(0, 0, 0);
    camera.rotation.set(pitch, yaw, 0);
    headPos.set(0, 0, 0);
  }
  nimbus.group.lookAt(headPos);
  // the listener follows the head, so sounds stay where they come from
  const src = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  src.getWorldQuaternion(headQ);
  sound.setListener(headPos, fwdV.set(0, 0, -1).applyQuaternion(headQ), upV.set(0, 1, 0).applyQuaternion(headQ));
  fade.position.copy(headPos);
  fade.visible = fade.material.opacity > 0.002;
}

// test hooks, only with ?debug in the address
if (/[?&]debug\b/.test(location.search)) window.__fly = {
  btn(i) {
    const r = panel.rects[i];
    if (!r) return null;
    const p = new THREE.Vector3(((r.x + r.w / 2) / panel.cw - 0.5) * panel.w, (0.5 - (r.y + r.h / 2) / panel.ch) * panel.h, 0);
    panel.mesh.localToWorld(p);
    p.project(camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, action: r.action };
  },
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  go, F, tick, action, get step() { return STEPS[cur] && STEPS[cur].id; }, setView: (y, p) => ((yaw = y), (pitch = p)), begin, sound };
