// Bruitages synthétisés en WebAudio (aucun fichier, aucune musique).
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.lastSqueak = 0;
  }

  // Doit être appelé suite à une interaction utilisateur
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.applauseBuf = this.makeApplause(3.2);
    this.startCrowd();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  out(pan = 0, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  noiseSrc(offset = Math.random()) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = 0;
    s._off = offset * 1.5;
    return s;
  }

  env(param, t, a, peak, decay, end = 0.0001) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(end, t + a + decay);
  }

  tone(type, f0, f1, dur, gain, dest, t0 = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.003, gain, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(filterType, freq, q, dur, gain, dest, t0 = 0, attack = 0.002) {
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g.gain, t, attack, gain, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, s._off);
    s.stop(t + attack + dur + 0.05);
    return f;
  }

  ok() {
    return this.ctx && this.enabled && this.ctx.state === 'running';
  }

  // Frappe de raquette : "pok" creux de padel
  hit(power = 0.5, kind = 'drive', pan = 0, dist = 1) {
    if (!this.ok()) return;
    const v = (0.5 + power * 0.6) * dist;
    const o = this.out(pan, v);
    const smash = kind === 'smash';
    const slice = kind === 'slice' || kind === 'bandeja' || kind.includes('Slice') || kind === 'vibora';
    this.tone('sine', smash ? 620 : slice ? 820 : 720, smash ? 380 : 520, 0.07, 0.8, o);
    this.tone('triangle', 1450, 900, 0.035, 0.35, o);
    this.burst('bandpass', slice ? 2600 : 1900, 1.4, 0.05, 0.9, o);
    this.tone('sine', 160, 70, 0.09, smash ? 0.9 : 0.45, o);
    if (smash) this.burst('highpass', 3000, 0.7, 0.09, 0.6, o);
    // souffle du geste
    const f = this.burst('bandpass', 500, 2, 0.16, 0.12 * (0.5 + power), o, -0.0, 0.05);
    f.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 0.18);
  }

  bounce(speed = 5, pan = 0, dist = 1) {
    if (!this.ok()) return;
    const v = Math.min(1, speed / 12) * dist;
    if (v < 0.03) return;
    const o = this.out(pan, v);
    this.tone('sine', 210, 80, 0.07, 0.7, o);
    this.burst('lowpass', 1100, 0.8, 0.04, 0.5, o);
  }

  glass(speed = 5, pan = 0, dist = 1) {
    if (!this.ok()) return;
    const v = Math.min(1, speed / 14) * dist;
    const o = this.out(pan, v * 0.9);
    this.tone('sine', 290, 250, 0.32, 0.6, o);
    this.tone('sine', 560, 520, 0.22, 0.25, o);
    this.tone('sine', 1130, 1090, 0.12, 0.12, o);
    this.burst('bandpass', 2200, 1.5, 0.03, 0.6, o);
    this.tone('sine', 95, 60, 0.15, 0.6, o);
  }

  mesh(speed = 5, pan = 0, dist = 1) {
    if (!this.ok()) return;
    const v = Math.min(1, speed / 12) * dist;
    const o = this.out(pan, v);
    const ctx = this.ctx;
    for (const [f, d] of [[2300, 0.35], [3700, 0.28], [5200, 0.22]]) {
      const filt = this.burst('bandpass', f, 8, d, 0.7, o);
      void filt;
    }
    // cliquetis
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    const tr = ctx.createGain();
    tr.gain.value = 0.5;
    lfo.connect(lg).connect(tr.gain);
    const s = this.burst('bandpass', 1600, 3, 0.3, 0.5, tr);
    void s;
    tr.connect(o);
    lfo.start(); lfo.stop(ctx.currentTime + 0.4);
  }

  net(pan = 0) {
    if (!this.ok()) return;
    const o = this.out(pan, 0.7);
    this.burst('lowpass', 500, 1, 0.14, 0.8, o, 0, 0.01);
    this.tone('sine', 120, 60, 0.1, 0.4, o);
  }

  squeak(pan = 0) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSqueak < 0.18) return;
    this.lastSqueak = now;
    const o = this.out(pan, 0.12 + Math.random() * 0.08);
    const f = 1700 + Math.random() * 900;
    this.tone('sine', f, f * 1.35, 0.07 + Math.random() * 0.05, 0.5, o);
  }

  ui(kind = 'click') {
    if (!this.ok()) return;
    const o = this.out(0, 0.35);
    if (kind === 'click') this.tone('sine', 880, 1320, 0.07, 0.5, o);
    else if (kind === 'back') this.tone('sine', 660, 440, 0.08, 0.5, o);
    else if (kind === 'start') {
      this.tone('triangle', 660, 660, 0.09, 0.5, o);
      this.tone('triangle', 990, 990, 0.14, 0.5, o, 0.09);
    }
  }

  // Annonce / gong de fin de point
  chime(good = true) {
    if (!this.ok()) return;
    const o = this.out(0, 0.25);
    const notes = good ? [784, 1046] : [523, 392];
    notes.forEach((n, i) => this.tone('sine', n, n, 0.25, 0.5, o, i * 0.11));
  }

  makeApplause(dur) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(2, Math.floor(sr * dur), sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const claps = Math.floor(dur * 220);
      for (let i = 0; i < claps; i++) {
        const t = Math.random() * dur;
        const env = Math.min(1, t / 0.15) * Math.max(0, 1 - Math.pow(t / dur, 2.2));
        const start = Math.floor(t * sr);
        const len = Math.floor(sr * (0.006 + Math.random() * 0.01));
        const amp = (0.2 + Math.random() * 0.5) * env;
        const tone = 0.3 + Math.random() * 0.6;
        let lp = 0;
        for (let j = 0; j < len && start + j < d.length; j++) {
          const n = Math.random() * 2 - 1;
          lp = lp + tone * (n - lp);
          d[start + j] += lp * amp * Math.exp(-j / (len * 0.3));
        }
      }
    }
    return buf;
  }

  applause(intensity = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.applauseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0.55 * intensity;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    if (intensity > 0.9) this.cheer(intensity);
  }

  // Clameur "ouaais" : formants de voyelle sur des voix désaccordées
  cheer(intensity = 1, vowel = 'ey') {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.6;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.15, 0.12 * intensity, dur);
    const formants = vowel === 'oo' ? [[330, 6], [800, 8]] : [[600, 6], [1700, 9]];
    const sum = ctx.createGain();
    for (const [f, q] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      sum.connect(bp).connect(g);
    }
    g.connect(this.master);
    for (let i = 0; i < 14; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = (vowel === 'oo' ? 150 : 190) + Math.random() * 140;
      o.frequency.setValueAtTime(base, t);
      if (vowel === 'oo') {
        o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.5);
        o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
      } else {
        o.frequency.linearRampToValueAtTime(base * 1.15, t + 0.3);
        o.frequency.linearRampToValueAtTime(base * 0.95, t + dur);
      }
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og).connect(sum);
      o.start(t + Math.random() * 0.08);
      o.stop(t + dur + 0.2);
    }
  }

  ooh() {
    this.cheer(0.9, 'oo');
  }

  startCrowd() {
    const ctx = this.ctx;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.025;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.012;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(this.master);
    s.start();
    lfo.start();
    this.crowdGain = g;
  }
}
