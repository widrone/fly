// Sound engine: everything is synthesized with Web Audio, no audio files.
//
//  - Sources are placed in 3D (HRTF) in the cabin frame: engines outside the left/right
//    windows, the wheels under the floor, chimes overhead, people around you.
//  - A separate low-frequency "haptic" bus (25–60 Hz) carries rumble meant to be felt
//    through a Woojer strap/vest. It is mixed into the normal output (the Woojer turns
//    the low end of the audio into vibration), and its level is set from the start page.
//  - Ambience is driven by update(state) ~10x per second; events are one-shot methods.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Engine positions in the cabin frame (eyes at origin, nose toward -Z).
export const POS = {
  engL: [-5.3, -2.5, 0.2],
  engR: [8.1, -2.5, 0.2],
  vent: [0.15, 0.55, -0.25],
  ding: [0.45, 0.45, -0.5],
  lap: [0, -0.5, -0.12],
  floor: [0.6, -1.9, 1.0],
  gearMain: [0.2, -2.6, 2.6],
  wing: [-3.5, -1.4, 3.0],
  door: [-0.3, 0.0, -9.6],
  galley: [1.4, 0.1, -9.9],
  tail: [1.4, 0.4, 16],
  hold: [0.8, -2.3, 3.5],
  tray: [0.07, -0.3, -0.33],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.haptic = 0.65; // 0..1, set from the start page
    this.state = {};
    this.timers = { life: 2, chime: 3, pa: 12, roll: 9, thump: 0 };
    this.R = rng(99);
  }

  init(ctx) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!ctx && !AC) return;
    this.ctx = ctx || new AC({ latencyHint: 'interactive' });
    this._build();
  }

  get now() {
    return this.ctx.currentTime;
  }

  // ------------------------------------------------------------------ building blocks
  _noiseBuf(kind, seed, secs = 6) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * secs);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    const R = rng(seed);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = R() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      } else {
        // pink (Paul Kellet)
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // crossfade the loop seam
    const f = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < f; i++) {
      const k = i / f;
      d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  _src(buf, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * (buf.duration - 0.1));
    return s;
  }
  _g(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  _f(type, freq, Q = 0.707, gain = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  }
  _o(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }
  _chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
  _setPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }
  // A 3D point source. Returns its input node.
  _spatial(pos, { ref = 1, roll = 0.7, lp = 0, verb = 0.15, dest = null } = {}) {
    const c = this.ctx;
    const input = this._g(1);
    let node = input;
    if (lp) node = this._chain(input, this._f('lowpass', lp, 0.5));
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 20000;
    this._setPos(p, ...pos);
    node.connect(p);
    p.connect(dest || this.amb);
    if (verb) p.connect(this._chain(this._g(verb), this.verbIn));
    input.panner = p;
    return input;
  }
  _ramp(param, v, tc = 0.15) {
    param.setTargetAtTime(v, this.now, tc);
  }

  _impulse(secs, damp = 3000) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * secs);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const R = rng(7 + ch);
      let lp = 0;
      const a = Math.exp((-2 * Math.PI * damp) / c.sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp = a * lp + (1 - a) * (R() * 2 - 1);
        d[i] = lp * Math.pow(1 - t, 2.2) * (i < c.sampleRate * 0.004 ? i / (c.sampleRate * 0.004) : 1);
      }
    }
    return buf;
  }

  _build() {
    const c = this.ctx;
    this.buf = {
      white: [1, 2, 3].map((s) => this._noiseBuf('white', s)),
      pink: [4, 5, 6].map((s) => this._noiseBuf('pink', s)),
      brown: [7, 8, 9].map((s) => this._noiseBuf('brown', s)),
    };

    // output: audible sound and the felt rumble get their own dynamics, then a safety limiter.
    // That way a big rumble never squashes what you hear, and vice versa.
    const comp = (th, ratio, knee, att, rel) => {
      const k = c.createDynamicsCompressor();
      k.threshold.value = th;
      k.ratio.value = ratio;
      k.knee.value = knee;
      k.attack.value = att;
      k.release.value = rel;
      return k;
    };
    this.limiter = comp(-1.5, 20, 0, 0.002, 0.1);
    this.limiter.connect(c.destination);
    this.out = this._g(1);
    this._chain(this.out, this._f('highpass', 32, 0.7), comp(-12, 5, 8, 0.006, 0.25), this._g(1.25), this.limiter);

    this.amb = this._g(1); // ambience (ducked while Nimbus speaks)
    this.focus = this._g(1); // dips briefly so big moments (wheels, touchdown) stand out
    this._chain(this.amb, this.focus, this.out);
    this.fx = this._g(1); // events
    this.fx.connect(this.out);
    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(0.7, 2500);
    this.verbIn = this._g(1);
    this.verbOut = this._g(0.5);
    this._chain(this.verbIn, this.verb, this.verbOut, this.out);

    // haptic bus: very low frequencies, felt more than heard
    this.hap = this._g(1);
    this.hapLevel = this._g(this.haptic * 0.7);
    this.hapTap = this._chain(this.hap, this._f('lowpass', 90, 0.6), this._f('highpass', 18, 0.6), comp(-9, 6, 4, 0.002, 0.12), this._g(1.2), this.hapLevel);
    this.hapTap.connect(this.limiter);

    const L = (this.L = {});
    const W = this.buf.white, P = this.buf.pink, B = this.buf.brown;

    // ---- cabin air (vents, packs)
    L.air = this._g(0);
    this._chain(this._src(P[0]), this._f('highpass', 300), this._f('lowpass', 7500), this._f('peaking', 2200, 0.8, 3), L.air, this._spatial(POS.vent, { roll: 0.3 }));

    // ---- airflow over the fuselage (stereo, wide)
    L.flowF = [];
    L.flow = this._g(0);
    L.flow.connect(this.amb);
    [-0.85, 0.85].forEach((pan, i) => {
      const f = this._f('lowpass', 400, 0.6);
      const sp = c.createStereoPanner();
      sp.pan.value = pan;
      this._chain(this._src(P[i + 1], 0.97 + i * 0.05), f, this._f('peaking', 650, 0.7, 4), sp, L.flow);
      L.flowF.push(f);
    });

    // ---- engines (left & right), heard through the cabin wall
    L.eng = ['L', 'R'].map((side, i) => {
      const dest = this._spatial(side === 'L' ? POS.engL : POS.engR, { ref: 5, roll: 0.55, lp: 3400, verb: 0.08 });
      const e = {};
      e.roarF = this._f('lowpass', 300, 0.6);
      e.roar = this._g(0);
      this._chain(this._src(B[i], 1 + i * 0.03), e.roarF, e.roar, dest);
      e.jetF = this._f('bandpass', 900, 0.5);
      e.jet = this._g(0);
      this._chain(this._src(W[i], 1), e.jetF, e.jet, dest);
      e.buzzO = this._o('sawtooth', 40);
      e.buzz = this._g(0);
      this._chain(e.buzzO, this._f('lowpass', 260, 0.8), e.buzz, dest);
      e.fanO = this._o('sine', 300);
      e.fan = this._g(0);
      this._chain(e.fanO, e.fan, dest);
      e.fan2O = this._o('triangle', 600);
      e.fan2 = this._g(0);
      this._chain(e.fan2O, this._f('lowpass', 1500), e.fan2, dest);
      e.whineO = this._o('sine', 1200);
      e.whine = this._g(0);
      this._chain(e.whineO, e.whine, dest);
      e.start = 0; // extra starter whine while the engine spins up
      e.detune = i ? 1.012 : 1;
      return e;
    });

    // ---- APU (small engine in the tail, runs at the gate)
    L.apu = this._g(0);
    const apuIn = this._spatial(POS.tail, { ref: 6, roll: 0.5, lp: 2000 });
    L.apu.connect(apuIn);
    this._chain(this._o('sine', 405), this._g(0.5), L.apu);
    this._chain(this._o('sine', 812), this._g(0.25), L.apu);
    this._chain(this._src(W[2]), this._f('bandpass', 1300, 1.2), this._g(0.8), L.apu);

    // ---- wheels rolling on the ground (under the floor)
    L.roll = this._g(0);
    this.rollIn = this._spatial(POS.gearMain, { ref: 2, roll: 0.3, verb: 0.05 });
    this._chain(this._src(B[2], 1.3), this._f('lowpass', 220, 0.7), this._f('peaking', 90, 1, 6), L.roll, this.rollIn);

    // ---- gear hanging in the wind (approach), with buffeting
    L.gearWind = this._g(0);
    const gwAM = this._g(0.6);
    const gwLfo = this._o('sine', 6.3);
    this._chain(gwLfo, this._g(0.4), gwAM.gain);
    this._chain(this._src(B[1], 1.6), this._f('bandpass', 240, 0.9), gwAM, L.gearWind, this._spatial(POS.gearMain, { ref: 2, roll: 0.3 }));

    // ---- rough air rumble
    L.rough = this._g(0);
    this._chain(this._src(B[0], 0.8), this._f('lowpass', 130, 0.8), L.rough, this.amb);

    // ---- murmur of people (cabin & terminal)
    L.murmur = this._g(0);
    L.murmur.connect(this.amb);
    this.voices = [0, 1, 2, 3, 4].map((k) => {
      const env = this._envBuf(31 + k);
      const form = this._formBuf(51 + k);
      const f = this._f('bandpass', 700, 3.5);
      const am = this._g(0);
      const s = this._src(env);
      s.connect(am.gain);
      const fs = this._src(form);
      this._chain(fs, this._g(500), f.frequency);
      const f2 = this._f('bandpass', 1700, 5);
      const v = this._spatial([0, 0, -2], { roll: 0.6, verb: 0.25, dest: L.murmur });
      this._chain(this._src(W[k % 3], 0.9 + k * 0.04), f, am, v);
      this._chain(f, f2, this._g(0.5), am);
      return v;
    });

    // ---- terminal room tone
    L.room = this._g(0);
    this._chain(this._src(P[2], 0.9), this._f('lowpass', 900), this._f('highpass', 80), L.room, this.amb);
    // distant jet taking off outside, heard through the glass
    L.farJet = this._g(0);
    this.farJetIn = this._spatial([0, -4, -700], { ref: 80, roll: 1, lp: 900, verb: 0.2 });
    this._chain(this._src(B[1], 0.9), this._f('lowpass', 500), L.farJet, this.farJetIn);
    this._chain(this._src(W[0], 0.8), this._f('bandpass', 700, 0.6), this._g(0.3), L.farJet);
    // our parked plane's APU, through the glass
    L.termApu = this._g(0);
    const taIn = this._spatial([-4, -2.3, -34], { ref: 10, roll: 0.8, lp: 1200 });
    this._chain(this._o('sine', 405), this._g(0.4), L.termApu, taIn);
    this._chain(this._src(W[1]), this._f('bandpass', 1300, 1.2), this._g(0.6), L.termApu);

    // ---- lounge: pad, breeze
    L.pad = this._g(0);
    const padF = this._f('lowpass', 1200, 0.5);
    this._chain(this._o('sine', 0.03), this._g(500), padF.frequency);
    this._chain(padF, L.pad, this.amb);
    L.pad.connect(this._chain(this._g(0.6), this.verbIn));
    [130.81, 196.0, 261.63, 329.63, 392.0, 493.88, 587.33].forEach((f, i) => {
      const o = this._o(i % 2 ? 'sine' : 'triangle', f);
      o.detune.value = (i - 3) * 2.5;
      const g = this._g(0.022);
      this._chain(this._o('sine', 0.04 + i * 0.013), this._g(0.016), g.gain);
      this._chain(o, g, padF);
    });
    L.breeze = this._g(0);
    const bf = this._f('bandpass', 600, 0.8);
    this._chain(this._o('sine', 0.07), this._g(250), bf.frequency);
    const bam = this._g(0.6);
    this._chain(this._o('sine', 0.11), this._g(0.35), bam.gain);
    this._chain(this._src(P[1], 0.8), bf, bam, L.breeze, this.amb);

    // ---- haptic layers (go only to the haptic bus)
    const H = (this.H = {});
    H.eng = this._g(0);
    this._chain(this._o('sine', 37), H.eng, this.hap);
    this._chain(this._o('sine', 53), this._g(0.6), H.eng);
    H.roll = this._g(0);
    this._chain(this._src(B[2], 1.3), this._f('lowpass', 60, 0.8), this._g(3), H.roll, this.hap);
    H.gear = this._g(0);
    const hgAM = this._g(0.5);
    this._chain(this._o('sine', 7), this._g(0.5), hgAM.gain);
    this._chain(this._o('sine', 42), hgAM, H.gear, this.hap);
    H.rough = this._g(0);
    this._chain(this._src(B[0], 0.8), this._f('lowpass', 45, 0.8), this._g(3), H.rough, this.hap);

    this._sceneVerb = null;
    this.setScene('cabin');
  }

  // Random speech-like loudness envelope (syllables and pauses), looped.
  _envBuf(seed) {
    const c = this.ctx;
    const rate = 200; // control-rate samples per second, played back at audio rate via playbackRate
    const secs = 9;
    const n = Math.floor(c.sampleRate * secs);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    const R = rng(seed);
    let i = 0;
    while (i < n) {
      const talk = R() < 0.75;
      const len = Math.floor(c.sampleRate * (talk ? 0.08 + R() * 0.22 : 0.05 + R() * (R() < 0.2 ? 0.9 : 0.15)));
      const amp = talk ? 0.4 + R() * 0.6 : 0;
      for (let k = 0; k < len && i < n; k++, i++) d[i] = amp * Math.sin((Math.PI * k) / len);
    }
    void rate;
    return buf;
  }
  _formBuf(seed) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * 7);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    const R = rng(seed);
    let v = 0, target = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (k-- <= 0) {
        target = R() * 2 - 1;
        k = Math.floor(c.sampleRate * (0.06 + R() * 0.15));
      }
      v += (target - v) * 0.0008;
      d[i] = v;
    }
    return buf;
  }

  // ------------------------------------------------------------------ settings
  setHaptics(level) {
    this.haptic = level;
    if (this.ctx) this._ramp(this.hapLevel.gain, level * 0.7, 0.05);
  }
  duck(on) {
    if (this.ctx) this._ramp(this.amb.gain, on ? 0.6 : 1, on ? 0.15 : 0.6);
  }
  // pull the background down for a moment so an event is clearly heard
  _spotlight(delay, dur, depth = 0.5) {
    const g = this.focus.gain;
    const t = this.now + delay;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.12);
    g.setTargetAtTime(1, t + dur, 0.6);
  }
  setScene(name) {
    if (!this.ctx || this._sceneVerb === name) return;
    this._sceneVerb = name;
    const [secs, damp, wet] = { cabin: [0.7, 2500, 0.5], terminal: [2.2, 3500, 0.7], lounge: [3.2, 4000, 0.9] }[name] || [0.7, 2500, 0.5];
    this.verb.buffer = this._impulse(secs, damp);
    this._ramp(this.verbOut.gain, wet, 0.3);
    const posCabin = [[0.9, -0.05, -2.3], [2.4, 0, -3.1], [1.9, 0, 1.7], [0.45, 0, 2.5], [2.8, 0, -5.2]];
    const posTerm = [[-3, 0, 2.6], [2.6, 0, 3.6], [-6, 0, 5], [5.5, 0, 1.2], [0.5, 0, 6]];
    const ps = name === 'terminal' ? posTerm : posCabin;
    this.voices.forEach((v, i) => this._setPos(v.panner, ...ps[i]));
  }
  setListener(p, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }
  setFarJet(x, y, z, on) {
    if (!this.ctx) return;
    this._setPos(this.farJetIn.panner, x, y, z);
    this._ramp(this.L.farJet.gain, on ? 1.4 : 0, 0.4);
  }

  // ------------------------------------------------------------------ ambience, called ~10x/s
  // s: { scene, running, n:[l,r], thrust, v, ground, gearDown, rough, apu, life }
  update(s, dt) {
    if (!this.ctx) return;
    this.state = s;
    const L = this.L, H = this.H, r = (p, v, tc) => this._ramp(p, v, tc);
    const cabin = s.scene === 'cabin' && s.running;
    const term = s.scene === 'terminal' && s.running;
    const lounge = s.scene === 'lounge' && s.running;

    // cabin
    const v = cabin ? s.v : 0;
    const vv = clamp(v / 80, 0, 1.2);
    r(L.air.gain, cabin ? (s.ground && v < 1 ? 0.8 : 0.45) : 0, 0.5);
    r(L.flow.gain, cabin ? 0.07 + 0.55 * vv * vv : 0, 0.3);
    L.flowF.forEach((f) => r(f.frequency, 260 + 900 * vv, 0.3));
    L.eng.forEach((e, i) => {
      const n = cabin ? s.n[i] : 0;
      const P = cabin ? s.thrust : 0;
      const d = e.detune;
      r(e.roar.gain, n * (0.12 + 0.7 * Math.pow(P, 1.5)), 0.4);
      r(e.roarF.frequency, 140 + 1100 * P * n, 0.5);
      r(e.jet.gain, n * (0.03 + 0.24 * P * P), 0.4);
      r(e.jetF.frequency, 500 + 1000 * P, 0.5);
      r(e.buzzO.frequency, (16 + 16 * n + 62 * P) * d, 0.8);
      r(e.buzz.gain, n * (0.07 + 0.12 * P), 0.4);
      r(e.fanO.frequency, (90 + 210 * n + 560 * P) * d, 0.8);
      r(e.fan.gain, n * (0.045 + 0.07 * P), 0.4);
      r(e.fan2O.frequency, (180 + 420 * n + 1120 * P) * d, 0.8);
      r(e.fan2.gain, n * (0.008 + 0.03 * P), 0.4);
      r(e.whineO.frequency, (380 + 1500 * n + 2400 * P) * d, 0.8);
      r(e.whine.gain, n * (0.016 + 0.022 * P) + e.start, 0.4);
    });
    r(L.apu.gain, cabin ? s.apu * 0.25 : 0, 0.8);
    r(L.roll.gain, cabin && s.ground ? clamp(v / 12, 0, 1) * (0.25 + 0.5 * vv) : 0, 0.12);
    r(L.gearWind.gain, cabin && s.gearDown && !s.ground ? 1.1 * clamp(v / 60, 0, 1) : 0, 0.5);
    r(L.rough.gain, cabin ? s.rough * 0.9 : 0, 0.3);
    r(L.murmur.gain, (cabin ? s.life * 1.2 : 0) + (term ? 1.8 : 0), 0.8);
    r(L.room.gain, term ? 0.4 : 0, 0.8);
    r(L.termApu.gain, term ? 0.1 : 0, 0.8);
    if (!term) r(L.farJet.gain, 0, 0.3);
    r(L.pad.gain, lounge ? 0.7 : 0, 1.2);
    r(L.breeze.gain, lounge ? 0.22 : 0, 1.2);

    // felt rumble
    const hp = clamp((s.thrust - 0.55) / 0.45, 0, 1);
    const thrustFeel = cabin ? Math.max(s.n[0], s.n[1]) * 0.06 * hp * hp : 0;
    r(H.eng.gain, thrustFeel, 0.4);
    r(H.roll.gain, cabin && s.ground ? clamp(v / 10, 0, 1) * (0.025 + 0.09 * vv) : 0, 0.1);
    r(H.gear.gain, cabin && s.gearDown && !s.ground ? 0.06 * clamp(v / 60, 0, 1) : 0, 0.5);
    r(H.rough.gain, cabin ? s.rough * 0.07 : 0, 0.3);

    // little things happening around you
    const T = this.timers;
    const R = this.R;
    if (cabin) {
      T.life -= dt;
      if (T.life <= 0) {
        if (s.phase === 'boarding') {
          const pick = R();
          if (pick < 0.35) this.seatClick([R() < 0.5 ? 0.48 + R() * 0.5 : 1.8 + R(), -0.5, -1.4 - R() * 6]);
          else if (pick < 0.6) this.binClose([R() < 0.5 ? 0 : 2.8, 0.65, -1.5 - R() * 7]);
          else if (pick < 0.85) this.cargoThump();
          else this.callBell();
          T.life = 1.2 + R() * 2.2;
        } else if (s.phase === 'cruise') {
          const pick = R();
          if (pick < 0.55) this.clink(POS.galley, 0.5);
          else if (pick < 0.75) this.callBell();
          else this.seatCreak();
          T.life = 4 + R() * 6;
        } else T.life = 2;
      }
    }
    if (term) {
      T.pa -= dt;
      if (T.pa <= 0) {
        this.paChime();
        T.pa = 22 + R() * 15;
      }
      T.roll -= dt;
      if (T.roll <= 0) {
        this.suitcase();
        T.roll = 7 + R() * 9;
      }
    }
    if (lounge) {
      T.chime -= dt;
      if (T.chime <= 0) {
        this.windChime();
        T.chime = 2 + R() * 4;
      }
    }
  }

  // ------------------------------------------------------------------ one-shot helpers
  _at(dest, delay = 0) {
    return this.now + delay;
  }
  // sine "hit" with pitch drop (thumps, felt bumps)
  _hit(dest, { f0 = 60, f1 = 35, dur = 0.35, amp = 0.5, delay = 0, attack = 0.004 }) {
    const c = this.ctx;
    const t = this.now + delay;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._chain(o, g, dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  _burst(dest, { type = 'lowpass', f = 500, Q = 0.7, dur = 0.2, amp = 0.3, delay = 0, attack = 0.003, buf = 'white', f1 = null, rate = 1 }) {
    const c = this.ctx;
    const t = this.now + delay;
    const s = c.createBufferSource();
    s.buffer = this.buf[buf][Math.floor(Math.random() * 3)];
    s.playbackRate.value = rate;
    const fl = this._f(type, f, Q);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._chain(s, fl, g, dest);
    s.start(t, Math.random() * 3);
    s.stop(t + dur + 0.05);
  }
  _tone(dest, { f = 440, dur = 1, amp = 0.2, delay = 0, type = 'sine', attack = 0.005, f1 = null }) {
    const c = this.ctx;
    const t = this.now + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._chain(o, g, dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  // a temporary 3D source that disappears after `life` seconds
  _at3d(pos, opts = {}, life = 4) {
    const n = this._spatial(pos, { dest: this.fx, ...opts });
    if (this.offline) return n;
    setTimeout(() => {
      try {
        n.panner.disconnect();
      } catch (e) {}
    }, (life + 1) * 1000);
    return n;
  }
  // felt hit on the haptic bus
  feel(amp = 0.5, { f0 = 44, f1 = 30, dur = 0.35, delay = 0 } = {}) {
    if (!this.ctx) return;
    this._hit(this.hap, { f0, f1, dur, amp, delay, attack: 0.01 });
  }

  // ------------------------------------------------------------------ events
  ding() {
    if (!this.ctx) return;
    const d = this._at3d(POS.ding, { verb: 0.5, roll: 0.3 });
    const chime = (f, s) => {
      this._tone(d, { f, dur: 2.4, amp: 0.3, delay: s });
      this._tone(d, { f: f * 2, dur: 1.3, amp: 0.05, delay: s });
      this._tone(d, { f: f * 3.01, dur: 0.6, amp: 0.025, delay: s });
    };
    chime(1046.5, 0);
    chime(830.6, 0.6);
  }
  callBell() {
    if (!this.ctx) return;
    const d = this._at3d([0.8 + Math.random() * 1.6, 0.45, -2 - Math.random() * 6], { verb: 0.4 });
    this._tone(d, { f: 1318.5, dur: 1.4, amp: 0.07 });
    this._tone(d, { f: 2637, dur: 0.6, amp: 0.015 });
  }
  paChime() {
    const d = this._at3d([0, 2.5, 1.5], { verb: 0.8, roll: 0.2 });
    [784, 988, 1175].forEach((f, i) => {
      this._tone(d, { f, dur: 2.2, amp: 0.09, delay: i * 0.45 });
      this._tone(d, { f: f * 2, dur: 1, amp: 0.015, delay: i * 0.45 });
    });
  }
  click() {
    if (!this.ctx) return;
    const d = this._at3d(POS.lap, { verb: 0.05, roll: 0.2 });
    this._burst(d, { type: 'highpass', f: 2500, dur: 0.05, amp: 0.7 });
    this._tone(d, { f: 1900, dur: 0.04, amp: 0.25, type: 'square' });
    this._burst(d, { type: 'bandpass', f: 1600, Q: 4, dur: 0.07, amp: 0.8, delay: 0.1 });
    this._tone(d, { f: 1250, dur: 0.06, amp: 0.3, type: 'square', delay: 0.1 });
    this.feel(0.12, { f0: 60, f1: 50, dur: 0.08, delay: 0.1 });
  }
  seatClick(pos) {
    const d = this._at3d(pos, { verb: 0.2 });
    this._burst(d, { type: 'bandpass', f: 1700, Q: 4, dur: 0.06, amp: 0.25 });
    this._burst(d, { type: 'bandpass', f: 1300, Q: 4, dur: 0.06, amp: 0.3, delay: 0.09 });
  }
  binClose(pos) {
    const d = this._at3d(pos, { verb: 0.3 });
    this._hit(d, { f0: 110, f1: 60, dur: 0.25, amp: 0.35 });
    this._burst(d, { type: 'lowpass', f: 1400, dur: 0.15, amp: 0.3 });
    this._burst(d, { type: 'bandpass', f: 2600, Q: 6, dur: 0.05, amp: 0.2, delay: 0.03 });
  }
  cargoThump() {
    const d = this._at3d([0.8, -2.3, 2 + Math.random() * 4], { verb: 0.1, lp: 600 });
    this._hit(d, { f0: 80, f1: 45, dur: 0.3, amp: 0.45 });
    this._burst(d, { f: 400, dur: 0.2, amp: 0.25 });
    this.feel(0.12, { dur: 0.2 });
  }
  clink(pos, amp = 1) {
    const d = this._at3d(pos, { verb: 0.3 });
    const f = 2400 + Math.random() * 1600;
    this._tone(d, { f, dur: 0.35, amp: 0.05 * amp });
    this._tone(d, { f: f * 1.47, dur: 0.2, amp: 0.025 * amp });
    if (Math.random() < 0.5) this._tone(d, { f: f * 0.93, dur: 0.3, amp: 0.035 * amp, delay: 0.09 });
  }
  seatCreak() {
    const d = this._at3d([0.3 + Math.random(), -0.3, -1.2 + Math.random() * 2], { verb: 0.1 });
    this._burst(d, { type: 'bandpass', f: 900, f1: 650, Q: 14, dur: 0.35, amp: 0.25, attack: 0.05 });
  }
  creak() {
    const pos = [Math.random() < 0.5 ? -0.3 : 0.2, 0.6, -0.5 - Math.random() * 3];
    const d = this._at3d(pos, { verb: 0.15 });
    this._burst(d, { type: 'bandpass', f: 700 + Math.random() * 500, f1: 450, Q: 18, dur: 0.4, amp: 0.3, attack: 0.04 });
  }
  rattle(pos) {
    const d = this._at3d(pos || [Math.random() * 3 - 0.3, 0.65, -0.5 - Math.random() * 4], { verb: 0.15 });
    for (let i = 0; i < 4; i++) this._burst(d, { type: 'bandpass', f: 2200 + Math.random() * 1500, Q: 5, dur: 0.04, amp: 0.15, delay: i * (0.04 + Math.random() * 0.05) });
  }
  pop() {
    if (!this.ctx) return;
    this._tone(this.fx, { f: 620, f1: 920, dur: 0.12, amp: 0.12 });
  }
  door() {
    if (!this.ctx) return;
    const d = this._at3d(POS.door, { verb: 0.4, ref: 2 });
    this._burst(d, { type: 'lowpass', f: 600, dur: 0.9, amp: 0.25, attack: 0.3 }); // swing
    this._hit(d, { f0: 70, f1: 35, dur: 0.6, amp: 0.9, delay: 0.85 });
    this._burst(d, { type: 'lowpass', f: 900, dur: 0.35, amp: 0.6, delay: 0.85 });
    this._burst(d, { type: 'bandpass', f: 420, Q: 8, dur: 0.8, amp: 0.25, delay: 0.85 });
    this._burst(d, { type: 'bandpass', f: 1800, Q: 2, dur: 0.15, amp: 0.4, delay: 1.25 }); // latch
    this._burst(d, { type: 'highpass', f: 300, dur: 1.4, amp: 0.12, delay: 1.3, attack: 0.2 }); // pressure
    this.feel(0.4, { delay: 0.85, dur: 0.4 });
  }
  // starter whine + light-up "whoomp" for one engine; the engine level itself is ramped by main
  engineStart(side) {
    if (!this.ctx) return;
    const e = this.L.eng[side === 'L' ? 0 : 1];
    const d = this._at3d(side === 'L' ? POS.engL : POS.engR, { ref: 5, roll: 0.55, lp: 3400, verb: 0.1 }, 12);
    this._tone(d, { f: 180, f1: 1500, dur: 7, amp: 0.16, attack: 1.5 });
    this._tone(d, { f: 360, f1: 3000, dur: 7, amp: 0.05, attack: 1.5 });
    this._burst(d, { type: 'bandpass', f: 500, f1: 1600, Q: 0.7, dur: 6, amp: 0.25, attack: 2, buf: 'pink' });
    this._burst(d, { type: 'lowpass', f: 300, f1: 900, dur: 2.6, amp: 1.0, delay: 2.6, attack: 0.25, buf: 'brown' });
    this._hit(d, { f0: 60, f1: 40, dur: 1.0, amp: 0.5, delay: 2.6, attack: 0.08 });
    this._spotlight(2.5, 1.6, 0.65);
    this.feel(0.25, { delay: 2.6, dur: 1.0, f0: 40, f1: 32 });
    void e;
  }
  flaps(dur = 4) {
    if (!this.ctx) return;
    const d = this._at3d([-0.4, -1.6, 2.6], { verb: 0.05, ref: 1.5, lp: 2500 }, dur + 1);
    const c = this.ctx;
    const t = this.now;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.linearRampToValueAtTime(150, t + 0.6);
    o.frequency.setValueAtTime(150, t + dur - 0.6);
    o.frequency.linearRampToValueAtTime(95, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.4);
    g.gain.setValueAtTime(0.28, t + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const am = this._g(0.7);
    const lfo = c.createOscillator();
    lfo.frequency.value = 23;
    this._chain(lfo, this._g(0.3), am.gain);
    this._chain(o, this._f('bandpass', 650, 1.5), am, g, d);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
    this.feel(0.06, { f0: 46, f1: 46, dur });
  }
  _hydraulics(d, dur, amp = 0.22) {
    const c = this.ctx;
    const t = this.now;
    const env = (peak) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.5);
      g.gain.setValueAtTime(peak, t + dur - 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      return g;
    };
    const sweep = (o, a0, a1, a2) => {
      o.frequency.setValueAtTime(a0, t);
      o.frequency.exponentialRampToValueAtTime(a1, t + 0.8);
      o.frequency.setValueAtTime(a1, t + dur - 1.2);
      o.frequency.exponentialRampToValueAtTime(a2, t + dur);
    };
    // pump: buzzy saw through a resonant band, plus a whistling overtone
    const o = c.createOscillator();
    o.type = 'sawtooth';
    sweep(o, 190, 260, 140);
    this._chain(o, this._f('bandpass', 520, 2.5), env(amp), d);
    const o2 = c.createOscillator();
    sweep(o2, 780, 1040, 560);
    this._chain(o2, env(amp * 0.22), d);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
    this._burst(d, { type: 'highpass', f: 3000, dur: dur * 0.8, amp: amp * 0.2, attack: 0.4 });
  }
  _clunk(d, delay, amp = 1) {
    this._hit(d, { f0: 120, f1: 45, dur: 0.5, amp: 0.9 * amp, delay });
    this._burst(d, { type: 'lowpass', f: 1600, dur: 0.2, amp: 0.8 * amp, delay });
    this._burst(d, { type: 'bandpass', f: 1500, Q: 9, dur: 0.3, amp: 0.6 * amp, delay: delay + 0.01 });
    this._burst(d, { type: 'bandpass', f: 640, Q: 6, dur: 0.45, amp: 0.45 * amp, delay: delay + 0.02 });
    this._tone(d, { f: 2350, dur: 0.25, amp: 0.05 * amp, delay: delay + 0.01 }); // metal ring
    this.feel(0.75 * amp, { delay, dur: 0.5, f0: 48, f1: 30 });
  }
  // Wheels folding up after takeoff: ~6 s, hydraulics, doors, wind, a big CLUNK.
  gearUp() {
    if (!this.ctx) return;
    const d = this._at3d(POS.gearMain, { verb: 0.12, ref: 1.6, roll: 0.3 }, 8);
    this._spotlight(0.2, 4.6, 0.35);
    this._hydraulics(d, 6.2, 0.45);
    this._hit(d, { f0: 90, f1: 45, dur: 0.35, amp: 0.8, delay: 0.35 }); // doors open
    this._burst(d, { type: 'lowpass', f: 900, dur: 0.2, amp: 0.5, delay: 0.35 });
    this.feel(0.4, { delay: 0.35, dur: 0.3 });
    this._burst(d, { type: 'bandpass', f: 260, f1: 520, Q: 0.7, dur: 3.2, amp: 1.0, delay: 0.4, attack: 0.5, buf: 'brown' }); // gear in the wind
    for (let i = 0; i < 12; i++) this._burst(d, { type: 'bandpass', f: 1500 + Math.random() * 1500, Q: 4, dur: 0.05, amp: 0.3, delay: 0.6 + i * 0.24 + Math.random() * 0.1 });
    this.feel(0.22, { delay: 0.5, dur: 3, f0: 40, f1: 36 });
    this._clunk(d, 3.6, 1.8); // up-lock
    this._hit(d, { f0: 95, f1: 50, dur: 0.35, amp: 0.8, delay: 4.4 }); // doors close
    this._burst(d, { type: 'lowpass', f: 900, dur: 0.2, amp: 0.45, delay: 4.4 });
    this.feel(0.45, { delay: 4.4, dur: 0.3 });
  }
  // Wheels coming down before landing: hydraulics, doors, a roar of wind that stays, two clunks.
  gearDown() {
    if (!this.ctx) return;
    const d = this._at3d(POS.gearMain, { verb: 0.12, ref: 1.6, roll: 0.3 }, 8);
    this._spotlight(0.3, 3.4, 0.4);
    this._hydraulics(d, 5.6, 0.45);
    this._hit(d, { f0: 95, f1: 42, dur: 0.45, amp: 1.0, delay: 0.6 }); // doors open
    this._burst(d, { type: 'lowpass', f: 1000, dur: 0.25, amp: 0.6, delay: 0.6 });
    this.feel(0.5, { delay: 0.6, dur: 0.4 });
    this._burst(d, { type: 'lowpass', f: 250, f1: 900, Q: 0.7, dur: 2.4, amp: 1.4, delay: 0.8, attack: 0.5, buf: 'brown' }); // roar as they drop into the wind
    this._burst(d, { type: 'bandpass', f: 600, f1: 1200, Q: 0.6, dur: 2.0, amp: 0.4, delay: 0.85, attack: 0.4, buf: 'pink' });
    this.feel(0.35, { delay: 0.8, dur: 2.0, f0: 38, f1: 34 });
    this._clunk(d, 2.6, 1.7);
    this._clunk(d, 2.95, 1.4);
    this._hit(d, { f0: 95, f1: 50, dur: 0.35, amp: 0.7, delay: 3.6 }); // doors close
  }
  touchdown() {
    if (!this.ctx) return;
    const d = this._at3d(POS.gearMain, { verb: 0.1, ref: 1.6, roll: 0.3 }, 6);
    this._spotlight(0, 0.9, 0.55);
    this._hit(d, { f0: 70, f1: 28, dur: 0.8, amp: 1.0 });
    this._burst(d, { type: 'lowpass', f: 700, dur: 0.4, amp: 0.8 });
    this._burst(d, { type: 'bandpass', f: 2600, Q: 3, dur: 0.14, amp: 0.35, delay: 0.01 }); // tyre chirp
    this._burst(d, { type: 'bandpass', f: 2300, Q: 3, dur: 0.12, amp: 0.3, delay: 0.09 });
    this.feel(1.0, { dur: 0.7, f0: 50, f1: 28 });
  }
  noseDown() {
    if (!this.ctx) return;
    const d = this._at3d([1.4, -2.5, -10], { verb: 0.1, ref: 2 }, 3);
    this._hit(d, { f0: 65, f1: 35, dur: 0.5, amp: 0.6 });
    this._burst(d, { type: 'lowpass', f: 500, dur: 0.3, amp: 0.4 });
    this.feel(0.55, { dur: 0.45 });
  }
  spoilers() {
    if (!this.ctx) return;
    const d = this._at3d(POS.wing, { verb: 0.1, ref: 3 }, 4);
    this._burst(d, { type: 'lowpass', f: 350, f1: 200, dur: 2.5, amp: 0.6, attack: 0.15, buf: 'brown' });
    this.feel(0.3, { dur: 1.2, f0: 36, f1: 33 });
  }
  // runway joints / centreline lights: "ba-dum" from under the floor
  joint(v) {
    if (!this.ctx) return;
    const k = Math.min(1, v / 50);
    const d = this._at3d(POS.floor, { verb: 0.05, ref: 1.5, roll: 0.3 }, 2);
    this._hit(d, { f0: 75, f1: 45, dur: 0.18, amp: 0.25 + 0.35 * k });
    this._hit(d, { f0: 70, f1: 42, dur: 0.18, amp: 0.2 + 0.3 * k, delay: 0.09 });
    this.feel(0.12 + 0.3 * k, { dur: 0.15, f0: 46, f1: 36 });
    this.feel(0.1 + 0.25 * k, { dur: 0.15, f0: 46, f1: 36, delay: 0.09 });
  }
  // a turbulence bump (amp 0..1), synced with the visual bump in main
  bump(amp) {
    if (!this.ctx) return;
    this._burst(this.amb, { type: 'lowpass', f: 160, dur: 0.6, amp: 0.5 * amp, attack: 0.05, buf: 'brown' });
    this._hit(this.fx, { f0: 55, f1: 38, dur: 0.45, amp: 0.35 * amp, attack: 0.03 });
    this.feel(0.9 * amp, { dur: 0.55, f0: 40, f1: 30 });
    if (Math.random() < 0.6) this.creak();
    if (Math.random() < 0.7) this.rattle();
    if (amp > 0.4 && Math.random() < 0.6) this.clink(POS.tray, 1.5);
  }
  windChime() {
    const R = Math.random;
    const notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
    const a = R() * Math.PI * 2;
    const d = this._at3d([Math.cos(a) * 3, 0.5 + R() * 1.5, Math.sin(a) * 3], { verb: 0.9, roll: 0.3 }, 6);
    const n = 1 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const f = notes[Math.floor(R() * notes.length)];
      this._tone(d, { f, dur: 3.5, amp: 0.035, delay: i * (0.12 + R() * 0.3) });
      this._tone(d, { f: f * 2.76, dur: 1.2, amp: 0.008, delay: i * 0.2 });
    }
  }
  suitcase() {
    // wheels rolling past behind you
    const c = this.ctx;
    const d = this._at3d([-8, -0.9, 2.5], { verb: 0.4, roll: 0.6 }, 7);
    const p = d.panner;
    const t = this.now;
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (p.positionX) {
      p.positionX.setValueAtTime(-8 * dir, t);
      p.positionX.linearRampToValueAtTime(8 * dir, t + 6);
    }
    const s = c.createBufferSource();
    s.buffer = this.buf.brown[0];
    const am = this._g(0.5);
    const lfo = c.createOscillator();
    lfo.frequency.value = 11;
    this._chain(lfo, this._g(0.5), am.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 1);
    g.gain.setValueAtTime(0.35, t + 5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    this._chain(s, this._f('bandpass', 350, 1.5), am, g, d);
    s.start(t);
    lfo.start(t);
    s.stop(t + 6.1);
    lfo.stop(t + 6.1);
  }
  breath(inhale, dur) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = this.now;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(inhale ? 220 : 330, t);
    o.frequency.exponentialRampToValueAtTime(inhale ? 330 : 196, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._chain(o, g, this.fx);
    g.connect(this._chain(this._g(0.5), this.verbIn));
    o.start(t);
    o.stop(t + dur + 0.1);
    // soft airy "breath" swell
    this._burst(this.fx, { type: 'bandpass', f: inhale ? 700 : 1100, f1: inhale ? 1100 : 600, Q: 0.9, dur, amp: 0.05, attack: dur * 0.4, buf: 'pink' });
    this.feel(0.08, { f0: 32, f1: inhale ? 40 : 28, dur, delay: 0 });
  }
  celebrate() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this._tone(this.fx, { f, dur: 0.9, amp: 0.13, delay: i * 0.13, type: 'triangle' });
    });
    this._tone(this.fx, { f: 1567.98, dur: 1.6, amp: 0.08, delay: 0.75 });
    this.feel(0.3, { delay: 0.65, dur: 0.6, f0: 50, f1: 40 });
  }
  // for the start page: lets a grown-up check the vest before the headset goes on
  testRumble() {
    if (!this.ctx) return;
    this.feel(0.6, { dur: 0.5 });
    this.feel(0.9, { delay: 0.8, dur: 0.6 });
    this._hit(this.fx, { f0: 90, f1: 40, dur: 0.4, amp: 0.4, delay: 0.8 });
    this.feel(0.4, { delay: 1.7, dur: 1.4, f0: 38, f1: 34 });
  }
}

// Text-to-speech narration, if the browser offers a voice for the chosen language.
export class Voice {
  constructor() {
    this.on = true;
    this.lang = 'en';
    this.voice = null;
    this.available = false;
    this.onSpeaking = null;
    this.onVoices = null;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.ok) {
      try {
        speechSynthesis.onvoiceschanged = () => {
          this._pick();
          if (this.onVoices) this.onVoices();
        };
      } catch (e) {}
    }
    this._pick();
  }
  setLang(code) {
    this.lang = code;
    this._pick();
  }
  _pick() {
    if (!this.ok) {
      this.voice = null;
      this.available = false;
      return;
    }
    const vs = speechSynthesis.getVoices();
    const nb = this.lang === 'nb';
    const re = nb ? /^(nb|no|nn)([-_]|$)/i : /^en([-_]|$)/i;
    const all = vs.filter((v) => re.test(v.lang));
    // Prefer voices that run on the device, so the text never leaves it.
    const local = all.filter((v) => v.localService);
    const pool = local.length ? local : all;
    const prefer = nb ? /nora|pernille|iselin|finn|female/i : /samantha|google us english|zira|aria|jenny|female/i;
    this.voice = pool.find((v) => prefer.test(v.name)) || (!nb && pool.find((v) => /en[-_]gb/i.test(v.lang))) || pool[0] || null;
    // Some browsers list no voices but still speak English with a default voice.
    // Norwegian is only spoken with a real Norwegian voice, never read out by an English one.
    this.available = !!this.voice || (!nb && vs.length === 0);
  }
  say(text) {
    if (!this.ok || !this.on || !text || !this.available) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*—–]/g, ', ').replace(/…/g, '.'));
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = this.lang === 'nb' ? 0.95 : 0.92;
      u.pitch = 1.12;
      u.onstart = () => this.onSpeaking && this.onSpeaking(true);
      u.onend = u.onerror = () => this.onSpeaking && this.onSpeaking(false);
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  stop() {
    if (!this.ok) return;
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    if (this.onSpeaking) this.onSpeaking(false);
  }
}
