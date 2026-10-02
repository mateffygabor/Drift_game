// Sound effects with the Web Audio API, fully synthesised (no sound files).
// - engine: rpm from the car's gearbox (vehicle-specific character)
// - tyre squeal while drifting, gravel noise off track, wind
// - impacts, start beeps, lap chime, record and victory jingles
// In split screen player 1's sounds come from the left, player 2's from the right.
//
// Sound quality measures:
// - larger audio buffer ('balanced') so the 3D rendering load doesn't cause
//   crackling / dropouts
// - fewer audio nodes per car; bots get a "light" voice (engine only) and
//   distant ones are muted completely
// - lower, balanced volumes + a gentle compressor (no distortion)
// - parameters are only updated on a real change, smoothed
// - the impact sound can't repeat every frame (scraping along a wall used to
//   trigger dozens of overlapping sounds per second)

const VOLUME_KEY = 'driftgame2_volume';

function makeDistortion(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// Smoothly set a parameter, only if it really changes.
function smoothSet(param, value, t, tc, cache, key, eps) {
  if (cache[key] !== undefined && Math.abs(cache[key] - value) < eps) return;
  cache[key] = value;
  param.setTargetAtTime(value, t, tc);
}

class CarVoice {
  constructor(engine, vehicle, pan, light = false) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.light = light;
    this.profile = vehicle.engine;
    this.cache = {};
    this.nodes = [];

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = pan;
    this.out.connect(this.panner).connect(engine.sfxBus);

    // --- engine: fundamental + a "growl" one octave lower ---
    this.osc1 = ctx.createOscillator();
    this.osc1.type = this.profile.wave;
    this.osc1.frequency.value = this.profile.base;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.9;
    this.engineFilter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;
    this.osc1.connect(this.engineFilter);
    this.nodes.push(this.osc1);
    if (!light) {
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'sawtooth';
      this.osc2.frequency.value = this.profile.base * 0.5;
      const g2 = ctx.createGain(); g2.gain.value = 0.55;
      this.osc2.connect(g2).connect(this.engineFilter);
      this.nodes.push(this.osc2);
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortion(2.5);
      shaper.oversample = '2x';
      this.engineFilter.connect(shaper).connect(this.engineGain).connect(this.out);
    } else {
      this.engineFilter.connect(this.engineGain).connect(this.out);
    }
    for (const o of this.nodes) o.start();

    if (!light) {
      // --- tyre squeal: filtered noise ---
      this.skidSrc = engine.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2.2;
      this.skidFilter = bp;
      this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
      this.skidSrc.connect(bp).connect(this.skidGain).connect(this.out);
      // --- gravel / grass + wind from one shared noise source, two filters ---
      this.roadSrc = engine.noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 380;
      this.gravelGain = ctx.createGain(); this.gravelGain.gain.value = 0;
      this.roadSrc.connect(lp).connect(this.gravelGain).connect(this.out);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 900;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      this.roadSrc.connect(hp).connect(this.windGain).connect(this.out);
      this.nodes.push(this.skidSrc, this.roadSrc);
    }

    this.level = 1;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
  }

  // rpm: 0..1 (from the car's gearbox), speedRatio: 0..1, throttle 0..1, drift 0..1
  update({ rpm, speedRatio, throttle, drift, offTrack, speed }) {
    const t = this.ctx.currentTime;
    const c = this.cache;
    const sr = Math.max(0, Math.min(1.1, speedRatio));
    rpm = Math.max(0.08, Math.min(1.05, rpm));
    const f = this.profile.base + rpm * this.profile.range;
    smoothSet(this.osc1.frequency, f, t, 0.05, c, 'f', 0.5);
    if (this.osc2) smoothSet(this.osc2.frequency, f * 0.5, t, 0.05, c, 'f2', 0.25);
    const square = this.profile.wave === 'square';
    const cutoff = (square ? 260 : 380) + throttle * (square ? 900 : 1300) + rpm * 700;
    smoothSet(this.engineFilter.frequency, cutoff, t, 0.08, c, 'cut', 15);
    smoothSet(this.engineGain.gain, 0.045 + throttle * 0.06 + rpm * 0.025, t, 0.08, c, 'eg', 0.002);
    if (this.light) return;

    const speedF = Math.min(1, speed / 220);
    const skid = offTrack ? 0 : Math.max(0, (drift - 0.3) * 1.4) * speedF;
    smoothSet(this.skidGain.gain, Math.min(0.2, skid * 0.2), t, 0.07, c, 'sk', 0.004);
    smoothSet(this.skidFilter.frequency, 1100 + drift * 700, t, 0.1, c, 'skf', 20);
    smoothSet(this.gravelGain.gain, offTrack ? 0.2 * Math.min(1, speed / 120) : 0, t, 0.08, c, 'gr', 0.004);
    smoothSet(this.windGain.gain, sr * sr * 0.035, t, 0.15, c, 'wi', 0.002);
  }

  // volume (0..1) and pan - bots fade with distance
  setLevel(level, pan = 0) {
    const t = this.ctx.currentTime;
    const c = this.cache;
    smoothSet(this.out.gain, level, t, 0.2, c, 'lvl', 0.01);
    smoothSet(this.panner.pan, pan, t, 0.2, c, 'pan', 0.05);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.06);
    setTimeout(() => {
      for (const n of this.nodes) {
        try { n.stop(); } catch { /* already stopped */ }
      }
      try { this.out.disconnect(); } catch { /* ignore */ }
    }, 400);
  }
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = this._loadVolume();
    this.holdSuspended = false; // paused by the game -> a key / click must not restart it
    this._recentHits = [];
  }

  _loadVolume() {
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY));
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
    } catch { return 0.7; }
  }

  // Browsers only allow sound after a user interaction - this is called on
  // a click / key press.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx({ latencyHint: 'balanced' });
      } catch {
        this.ctx = new Ctx();
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.006;
      comp.release.value = 0.25;
      const outGain = this.ctx.createGain();
      outGain.gain.value = 0.9;
      this.master.connect(comp).connect(outGain).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);
      this._noise = this._makeNoiseBuffer();
    }
    if (this.ctx.state === 'suspended' && !this.holdSuspended) this.ctx.resume();
  }

  get ready() { return !!this.ctx; }

  setVolume(v) {
    this.volume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() {
    this.holdSuspended = true;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    this.holdSuspended = false;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  // light: engine sound only (bots)
  createCarVoice(vehicle, pan = 0, light = false) {
    if (!this.ctx) return null;
    return new CarVoice(this, vehicle, pan, light);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.3, when = 0, pan = 0, attack = 0.008, slideTo = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noiseBurst(dur, { gain = 0.5, freq = 800, type = 'lowpass', pan = 0, when = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  countdownBeep() { this._tone(520, 0.22, { type: 'triangle', gain: 0.22 }); }
  goBeep() { this._tone(1040, 0.55, { type: 'triangle', gain: 0.25 }); }

  // Impact. Only a few may sound at once (in a 0.3 s window) so a series
  // of knocks doesn't add up to crackling noise.
  crash(intensity, pan = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._recentHits = this._recentHits.filter((t) => now - t < 0.3);
    if (this._recentHits.length >= 2) return;
    this._recentHits.push(now);
    const k = Math.max(0.15, Math.min(1, intensity));
    this._noiseBurst(0.18 + k * 0.25, { gain: 0.32 * k, freq: 500 + k * 1100, pan });
    this._tone(75, 0.25, { type: 'sine', gain: 0.35 * k, pan, slideTo: 45 });
  }

  lap(pan = 0) {
    this._tone(660, 0.18, { type: 'triangle', gain: 0.2, pan });
    this._tone(990, 0.35, { type: 'triangle', gain: 0.2, pan, when: 0.12 });
  }

  finalLap(pan = 0) {
    [660, 880, 660, 880].forEach((f, i) => this._tone(f, 0.16, { type: 'triangle', gain: 0.16, pan, when: i * 0.14 }));
  }

  record() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', gain: 0.18, when: i * 0.1 }));
  }

  driftBank(pan = 0) {
    this._tone(880, 0.12, { type: 'sine', gain: 0.12, pan });
    this._tone(1320, 0.2, { type: 'sine', gain: 0.1, pan, when: 0.07 });
  }

  win() {
    const seq = [523, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) => this._tone(f, 0.28, { type: 'triangle', gain: 0.16, when: i * 0.13 }));
    [523, 659, 784].forEach((f) => this._tone(f, 1.2, { type: 'triangle', gain: 0.1, when: seq.length * 0.13 }));
  }

  click() { this._tone(1200, 0.05, { type: 'triangle', gain: 0.05 }); }
  select() { this._tone(700, 0.08, { type: 'triangle', gain: 0.1 }); this._tone(1050, 0.1, { type: 'triangle', gain: 0.08, when: 0.05 }); }
}

export const audio = new AudioEngine();
