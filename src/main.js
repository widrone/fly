import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { Sound, Voice } from './audio.js';
import { Panel } from './ui.js';
import * as W from './world.js';

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
  bump: 0,
  bumpLevel: 0,
  sign: false,
  manual: false,
  target: { alt: 0, v: 0 },
  sinceThump: 0,
};

const SETUPS = {
  lounge: { scene: 'lounge' },
  terminal: { scene: 'terminal' },
  gate: { scene: 'cabin', outside: 'gate', alt: 0, v: 0, engine: 0, flaps: 0, belt: false, sign: false },
  gateBelt: { scene: 'cabin', outside: 'gate', alt: 0, v: 0, engine: 0, flaps: 0, belt: true, sign: true },
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

function updateFlight(dt) {
  if (!F.manual) {
    F.alt += clamp(F.target.alt - F.alt, -12 * dt, 12 * dt);
    F.v += clamp(F.target.v - F.v, -2.5 * dt, 2.5 * dt);
  }
  F.engine += (F.engineT - F.engine) * Math.min(1, dt * 0.9);
  F.flaps += clamp(F.flapsT - F.flaps, -0.12 * dt, 0.12 * dt);
  F.spoil += clamp(F.spoilT - F.spoil, -1.5 * dt, 1.5 * dt);
  F.dist += F.v * dt;
  const onGround = F.alt < 0.3;

  const amp = [0, 0.7, 1.8][F.bumpLevel];
  F.bump += (amp - F.bump) * Math.min(1, dt * 1.2);
  const n = noise(T * 1.3);
  outside.group.position.y = -F.alt + n * F.bump;
  const slosh = (n * 0.22 + Math.sin(T * 7) * 0.05) * (F.bump / 1.8);
  cabin.waterPivot.rotation.x = slosh;
  cabin.waterPivot.rotation.z = noise(T * 1.7 + 4) * 0.18 * (F.bump / 1.8);
  cabin.cup.position.y = 0.058 + Math.abs(noise(T * 2.2)) * 0.003 * (F.bump / 1.8);

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
    if (F.sinceThump > 24) {
      F.sinceThump = 0;
      sound.softThump(clamp(F.v / 50, 0.15, 0.8));
    }
  }
  if (F.bumpLevel > 0 && Math.random() < dt * F.bumpLevel * 1.4) sound.rattle();

  mixTimer -= dt;
  if (mixTimer <= 0) {
    mixTimer = 0.12;
    sound.setMix({
      hum: 0.22 + 0.25 * F.engine,
      engine: F.engine,
      rumble: (onGround ? clamp(F.v / 45, 0, 1) * 0.5 : 0) + 0.3 * (F.bump / 1.8) + (F.gear && !onGround ? 0.12 : 0),
      vent: 1,
      pad: 0,
    });
  }
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
      voice.say(inhale ? 'Breathe in' : 'And slowly out');
    }
    panel.set({
      ...breath.base,
      big: inhale ? 'Breathe in…' : 'Breathe out…',
      count: inhale ? `${sec} of ${breath.IN}` : `${sec} of ${breath.OUT}`,
      dots: [k, breath.total],
    });
  }
}

// ------------------------------------------------------------ the story
const N = (s) => s.replace('{N}', NAME ? `, ${NAME}` : '');
const STEPS = [
  { id: 'welcome', setup: 'lounge', calm: false, title: "Hi{N}! I'm Nimbus.", text: "I'm a little cloud, and I've been flying next to airplanes my whole life. Today we're going on a practice flight — together!", buttons: [['Hi Nimbus!', 'next']] },
  { id: 'boss', setup: 'lounge', highlightCalm: true, title: "You're the boss", text: "Nothing happens until you press a button. If you ever want a break, press the Break button in the corner, and we'll float right back here. Try it whenever you like!", buttons: [['Got it', 'next']] },
  { id: 'breathe', setup: 'lounge', calm: false, title: 'Cloud breathing', text: "Here's my favourite trick for wobbly feelings. Breathe in through your nose while I puff up big… then blow out slowly while I shrink. Let's do it three times.", buttons: [["Let's breathe", 'breathe3']] },
  { id: 'breathed', setup: 'lounge', calm: false, title: 'Great breathing!', text: 'You can do cloud breathing anytime: at the airport, on the plane, even right now. Ready to visit the airport?', buttons: [['Again', 'breathe3', 'secondary'], ['Go to the airport', 'next']] },

  { id: 'gate1', setup: 'terminal', progress: 0.04, title: "That's our plane!", text: "It's as long as about nine cars parked in a row. See the wings? They are built to bend a little, like a bird's. That makes them strong." },
  { id: 'gate2', setup: 'terminal', progress: 0.06, title: 'Checked every time', text: 'Before every flight, the pilots walk all the way around the plane to check it. Engineers look after it too, a bit like a check-up at the doctor, every single day.' },
  { id: 'gate3', setup: 'terminal', progress: 0.08, title: 'Two super-trained pilots', text: 'Pilots study for years and practise in special simulators. There are always two of them in the cockpit, so they can help each other.' },
  { id: 'gate4', setup: 'terminal', progress: 0.1, title: 'One of the safest ways to travel', text: 'Flying is much safer than riding in a car. Planes have backup systems too: if one part needs help, another one takes over.', buttons: [["Let's board!", 'next']] },

  { id: 'seat1', setup: 'gate', progress: 0.13, title: 'Your window seat!', text: "Look to your left, out of the window. That big wing is what holds us up in the air, like a giant kite. Nimbus Air gave you a seat with extra room for your legs!" },
  { id: 'seat2', setup: 'gate', progress: 0.15, title: 'Buckle up', text: "Let's click your seatbelt, just like in a car. Press the button, then look down at your lap.", buttons: [['Click seatbelt', 'buckle']] },
  { id: 'seat3', setup: 'gateBelt', progress: 0.17, title: 'Click! Nice and snug.', text: "Did you hear the ding? That's the seatbelt sign lighting up above you. Dings are how the crew talk to each other. They're a normal part of every flight.", onEnter: () => sound.ding() },
  { id: 'seat4', setup: 'gateBelt', progress: 0.19, title: 'Plane sounds', text: 'Planes make lots of sounds: air whooshing from the vents, beeps, thumps from bags being loaded, the door closing. They are just the sounds of a plane getting ready.' },
  { id: 'taxi0', setup: 'gateBelt', progress: 0.21, title: 'Off to the runway', text: "Soon the door closes and the plane drives slowly to the runway. That's called taxiing. You'll feel little bumps, like a bus on a road.", buttons: [['Start taxiing', 'next']] },
  { id: 'taxi', setup: 'gateBelt', progress: 0.24, seq: 'taxi', resumeTo: 'taxi0' },

  { id: 'takeoff0', setup: 'runway', progress: 0.28, title: 'Ready for takeoff', text: "Here's what will happen: the engines get LOUD (that means they're strong!), you get pushed back in your seat, and we go faster and faster… then whoosh, up we go!", buttons: [['Breathe first', 'calm', 'secondary'], ['Take off!', 'next']], calm: false },
  { id: 'takeoff', setup: 'runway', progress: 0.36, seq: 'takeoff', resumeTo: 'takeoff0' },

  { id: 'cruise1', setup: 'cruise', progress: 0.5, title: 'Cruising', text: 'Up here the plane flies smooth and steady. People read, play games, eat snacks and even sleep. Your tray table is out, and there is a drink for you!' },
  { id: 'cruise2', setup: 'cruise', progress: 0.55, title: 'Pop your ears', text: 'When the plane goes up or down, your ears might feel full. Swallow, yawn or chew something, and pop! They feel better.' },
  { id: 'bumps1', setup: 'cruise', progress: 0.6, title: 'Bumpy air', text: "Sometimes the air is bumpy, like waves on the sea or a gravel road. It's called turbulence. It can feel funny, but planes are built for much, much bigger bumps than you will ever feel." },
  { id: 'bumps2', setup: 'cruise', progress: 0.64, bumps: true, title: 'Try some bumps?', text: 'You choose how bumpy! Watch the water in your cup wiggle. Bumps feel funny, but they are not dangerous.' },
  { id: 'bumps3', setup: 'cruise', progress: 0.68, title: 'When it gets bumpy', text: 'Keep your seatbelt on, sit back and do cloud breathing. Squeeze something soft, or hold a grown-up’s hand. The bumps always stop again.' },

  { id: 'land0', setup: 'approach', progress: 0.74, title: 'Time to land', text: 'Tray table away, seatbelt on. The engines get quieter, we glide down through the clouds, the wheels come out with a rumble, and then bump! We are on the ground.', buttons: [['Breathe first', 'calm', 'secondary'], ["Let's land!", 'next']], calm: false },
  { id: 'land', setup: 'approach', progress: 0.85, seq: 'landing', resumeTo: 'land0' },
  {
    id: 'done', setup: 'landed', progress: 1, calm: false, badge: true, title: 'You did it{N}!',
    text: 'You flew a whole flight: takeoff, clouds, bumps and landing! Every time you practise, it gets a little easier. I am so proud of you.',
    buttons: [['Fly again', 'restart', 'secondary'], ['Cloud Lounge', 'free', 'secondary'], ['Finish', 'exit']],
    onEnter: () => {
      sound.celebrate();
      confetti.start(new THREE.Vector3(0.5, 0.5, -1.1), new THREE.Vector3(1.8, 0.4, 1.0));
    },
  },
  { id: 'break', setup: 'lounge', calm: false, breathe: true, title: 'Break time', say: 'Take as long as you like. Breathe with me.', buttons: [['Back to my flight', 'resume']] },
  { id: 'free', setup: 'lounge', calm: false, breathe: true, title: 'Cloud Lounge', say: 'Stay as long as you like.', buttons: [['Finish', 'exit', 'secondary'], ['Fly again', 'restart']] },
];
const byId = (id) => STEPS.findIndex((s) => s.id === id);
let cur = -1;
let busy = false;
let breakReturn = 'welcome';
let seq = null;

function stepContent(st, extra = {}) {
  let buttons = st.buttons || [['Next', 'next']];
  if (st.bumps) {
    const st2 = (lvl) => (F.bumpLevel === lvl ? 'active' : 'secondary');
    buttons = [['Tiny bumps', 'bump1', st2(1)], ['Little bumps', 'bump2', st2(2)], ['Smooth', 'bump0', st2(0)], ['Next', 'next']];
  }
  return {
    title: st.title ? N(st.title) : '',
    text: st.text ? N(st.text) : '',
    buttons,
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
    voice.say(st.say);
  } else {
    panel.set(stepContent(st));
    say(N(st.title), N(st.text));
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
    startBreathing(3, { title: 'Cloud breathing', calm: false, buttons: [] }, () => go('breathed'));
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
    if (lvl === 1) voice.say('Tiny bumps. Look at the water wiggle!');
    if (lvl === 2) voice.say('Little bumps. Bumpy, but safe.');
    if (lvl === 0) voice.say('Smooth again.');
  }
}

// ------------------------------------------------------------ timed sequences
function cap(title, text) {
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
      cap('Door closed', 'The tunnel to the airport rolls away from the plane.');
    });
    at(5, () => {
      F.engineT = 0.22;
      cap('Rolling slowly', 'We drive to the runway like a big, gentle bus.');
    });
    at(14, () => go('takeoff0'));
    s.tick = (t) => {
      outside.setBridge(lerp(-0.75, -24, smooth((t - 0.8) / 4)));
      F.v = t > 6.5 ? Math.min(5, (t - 6.5) * 1.1) : 0;
    };
  }
  if (name === 'takeoff') {
    F.manual = true;
    F.rwZ0 = -F.dist;
    let climb = 0;
    let doneAt = Infinity;
    at(0, () => {
      F.engineT = 1;
      cap('Here we go!', 'Hear the engines getting louder? That means they are strong.');
    });
    at(7, () => cap('Faster and faster', 'Feel pushed back into your seat? That is exactly what should happen.'));
    at(16, () => cap('Lift off!', 'The wings are lifting us up into the sky. Smooth!'));
    at(22, () => {
      sound.clunk();
      F.gear = 0;
      cap('Clunk!', 'That was the wheels folding away, like a bird tucking in its feet.');
    });
    at(28, () => {
      F.engineT = 0.7;
      cap('A little quieter', 'The pilots turn the engines down a bit now. That is planned and normal.');
    });
    at(31, () => (F.flapsT = 0));
    when(() => F.alt >= W.CLOUD_ALT - 48, () => cap('Into the cloud!', 'It is just foggy air, like flying through mist.'));
    when(() => F.alt >= W.CLOUD_ALT + 52, () => {
      cap('Above the clouds!', 'Look at all that sunshine. You did the takeoff!');
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
      cap('Gliding down', 'The engines get quieter as we start going down. That is normal.');
    });
    at(8, () => {
      F.flapsT = 0.5;
      cap('Look at the wing!', 'Flaps slide out to make the wing bigger, so we can fly slowly and gently.');
    });
    when(() => F.alt < W.CLOUD_ALT + 48, () => cap('Back through the clouds', 'Foggy for a moment…'));
    when(() => F.alt < W.CLOUD_ALT - 80, () => cap('Hello, ground!', 'Look at the fields, trees and lakes. The runway is just ahead.'));
    at(30, () => {
      sound.clunk();
      F.gear = 1;
      F.flapsT = 1;
      cap('Rumble, rumble', 'That is the wheels coming down. Ready for landing!');
    });
    at(44, () => {
      sound.thump(1.1);
      controllers.forEach((c) => haptic(c, 0.45, 120));
      F.spoilT = 1;
      F.engineT = 0.85;
      cap('Bump! We are down!', 'The engines roar for a moment to help us slow down. Totally normal.');
    });
    at(50, () => (F.engineT = 0.15));
    at(60, () => {
      sound.ding();
      cabin.setSign(false);
      F.spoilT = 0;
      F.flapsT = 0;
      cap('Welcome!', 'We landed safely.');
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
    $('xrmsg').textContent = 'Could not start VR here: ' + (e && e.message ? e.message : e);
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
  sound.setMix({}, 0.3);
  $('hud').classList.add('hidden');
  $('start').classList.remove('hidden');
  showScene('lounge');
  panel.mesh.visible = true;
  panel.set({ title: 'Practice Flight', text: 'See you soon!', buttons: [], calm: false });
}

function exitExperience() {
  if (xrSession) xrSession.end();
  else stopExperience();
}

$('vr').addEventListener('click', enterVR);
$('preview').addEventListener('click', preview);
$('exit').addEventListener('click', exitExperience);

async function checkXR() {
  const btn = $('vr');
  let ok = false;
  try {
    ok = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
  } catch (e) {}
  btn.disabled = !ok;
  const embedded = window.self !== window.top;
  const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
  $('xrmsg').textContent = ok
    ? 'Headset ready. Sit on a chair, then press Enter VR.'
    : quest && embedded
      ? 'VR is blocked inside this embedded preview. Open the stand-alone copy of this page (its own web address) in the Quest Browser to fly.'
      : 'Open this page in the Meta Quest Browser to fly in VR. You can preview it here on this screen.';
}
checkXR();

// ------------------------------------------------------------ main loop
showScene('lounge');
panel.set({ title: 'Practice Flight', text: '', buttons: [], calm: false });
const clock = new THREE.Clock();
const headPos = new THREE.Vector3();
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
  if (sceneName === 'cabin') updateFlight(dt);
  else {
    mixTimer -= dt;
    if (mixTimer <= 0 && running) {
      mixTimer = 0.2;
      sound.setMix(sceneName === 'lounge' ? { pad: 0.8 } : { hum: 0.05, pad: 0.3 }, 1.0);
    }
  }
  if (lounge.group.visible) lounge.update(dt);
  if (terminal.group.visible) terminal.update(dt);
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
