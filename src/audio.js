// Synthesized sound: cabin hum, engines, chimes, clicks, thumps, a calm pad.
// Everything is generated with Web Audio so the page has no audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const sr = ctx.sampleRate;
    const len = sr * 4;
    this.brownBuf = ctx.createBuffer(1, len, sr);
    this.whiteBuf = ctx.createBuffer(1, len, sr);
    const b = this.brownBuf.getChannelData(0);
    const w = this.whiteBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }

    this.hum = this._loop(this.brownBuf, 'lowpass', 380, 0);
    this.roar = this._loop(this.whiteBuf, 'bandpass', 600, 0);
    this.roar.f.Q.value = 0.6;
    this.rumble = this._loop(this.brownBuf, 'lowpass', 90, 0);
    this.vent = this._loop(this.whiteBuf, 'highpass', 2500, 0);

    // Engine tone
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engF = ctx.createBiquadFilter();
    this.engF.type = 'lowpass';
    this.engF.frequency.value = 200;
    this.engF.connect(this.engGain);
    this.engGain.connect(this.master);
    this.eo1 = ctx.createOscillator();
    this.eo1.type = 'sawtooth';
    this.eo1.frequency.value = 45;
    this.eo2 = ctx.createOscillator();
    this.eo2.type = 'sawtooth';
    this.eo2.frequency.value = 90.7;
    this.eo1.connect(this.engF);
    this.eo2.connect(this.engF);
    this.eo1.start();
    this.eo2.start();
    this.whineG = ctx.createGain();
    this.whineG.gain.value = 0;
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whine.frequency.value = 800;
    this.whine.connect(this.whineG);
    this.whineG.connect(this.master);
    this.whine.start();

    // Calm pad (lounge music)
    this.padG = ctx.createGain();
    this.padG.gain.value = 0;
    const padF = ctx.createBiquadFilter();
    padF.type = 'lowpass';
    padF.frequency.value = 1400;
    padF.connect(this.padG);
    this.padG.connect(this.master);
    const notes = [130.81, 196.0, 329.63, 392.0, 493.88, 587.33];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = 0.025;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = 0.02;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(padF);
      o.start();
      lfo.start();
    });
  }

  _loop(buf, type, freq, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(0, Math.random() * 2);
    return { src, f, g };
  }

  _ramp(param, v, tc = 0.6) {
    if (!this.ctx) return;
    param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // Cabin ambience. engine 0..1, rumble 0..1, pad 0..1
  setMix({ hum = 0, engine = 0, rumble = 0, pad = 0, vent = 0 }, tc = 0.8) {
    if (!this.ctx) return;
    const e = engine;
    this._ramp(this.hum.g.gain, hum * 0.5, tc);
    this._ramp(this.vent.g.gain, vent * 0.012, tc);
    this._ramp(this.engGain.gain, e > 0 ? 0.04 + 0.22 * e : 0, tc);
    this._ramp(this.eo1.frequency, 38 + 55 * e, tc * 1.5);
    this._ramp(this.eo2.frequency, 76.7 + 110 * e, tc * 1.5);
    this._ramp(this.engF.frequency, 160 + 650 * e, tc * 1.5);
    this._ramp(this.whineG.gain, e > 0 ? 0.003 + 0.012 * e : 0, tc);
    this._ramp(this.whine.frequency, 650 + 2300 * e, tc * 2);
    this._ramp(this.roar.g.gain, e > 0 ? 0.015 + 0.3 * e * e : 0, tc);
    this._ramp(this.roar.f.frequency, 450 + 900 * e, tc);
    this._ramp(this.rumble.g.gain, rumble * 0.9, 0.25);
    this._ramp(this.padG.gain, pad, 1.5);
  }

  _tone(freq, start, dur, vol = 0.2, type = 'sine', glideTo = null) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  _noise(start, dur, vol, type = 'lowpass', freq = 400) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0, Math.random() * 3);
    src.stop(t0 + dur + 0.05);
  }

  // The classic cabin "bing-bong"
  ding() {
    if (!this.ctx) return;
    const chime = (f, s) => {
      this._tone(f, s, 2.2, 0.16);
      this._tone(f * 2, s, 1.2, 0.03);
      this._tone(f * 3.01, s, 0.6, 0.015);
    };
    chime(1046.5, 0);
    chime(830.6, 0.55);
  }

  click() {
    if (!this.ctx) return;
    this._noise(0, 0.05, 0.5, 'highpass', 2500);
    this._tone(1800, 0, 0.04, 0.12, 'square');
    this._noise(0.09, 0.06, 0.6, 'highpass', 1800);
    this._tone(1300, 0.09, 0.05, 0.15, 'square');
  }

  pop() {
    if (!this.ctx) return;
    this._tone(620, 0, 0.12, 0.12, 'sine', 900);
  }

  thump(v = 1) {
    if (!this.ctx) return;
    this._tone(70, 0, 0.35, 0.5 * v, 'sine', 32);
    this._noise(0, 0.25, 0.35 * v, 'lowpass', 300);
  }

  softThump(v = 0.3) {
    if (!this.ctx) return;
    this._tone(55, 0, 0.18, 0.25 * v, 'sine', 35);
  }

  clunk() {
    if (!this.ctx) return;
    this.thump(0.8);
    this._tone(170, 0.02, 0.18, 0.08, 'square');
    this._noise(0.02, 0.3, 0.12, 'bandpass', 900);
  }

  rattle() {
    if (!this.ctx) return;
    this._noise(0, 0.08, 0.05 + Math.random() * 0.05, 'bandpass', 2000 + Math.random() * 2000);
  }

  door() {
    if (!this.ctx) return;
    this._noise(0, 0.6, 0.15, 'lowpass', 500);
    this.thump(0.5);
  }

  breath(inhale, dur) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = inhale ? 220 : 330;
    const f1 = inhale ? 330 : 196;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  celebrate() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this._tone(f, i * 0.13, 0.9, 0.12, 'triangle');
    });
    this._tone(1567.98, 0.75, 1.6, 0.08, 'sine');
  }
}

// Text-to-speech narration, if the browser offers it.
export class Voice {
  constructor() {
    this.on = true;
    this.voice = null;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.ok) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        // Prefer voices that run on the device, so the text never leaves it.
        const all = vs.filter((v) => /^en/i.test(v.lang));
        const local = all.filter((v) => v.localService);
        const en = local.length ? local : all;
        this.voice =
          en.find((v) => /samantha|google us english|zira|aria|jenny|female/i.test(v.name)) ||
          en.find((v) => /en[-_]gb/i.test(v.lang)) ||
          en[0] ||
          null;
      };
      pick();
      try { speechSynthesis.onvoiceschanged = pick; } catch (e) {}
    }
  }
  say(text) {
    if (!this.ok || !this.on || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*—]/g, ', '));
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = 0.92;
      u.pitch = 1.15;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  stop() {
    if (!this.ok) return;
    try { speechSynthesis.cancel(); } catch (e) {}
  }
}
