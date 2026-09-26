/* 배경 소리와 알림음. 소리 파일을 쓰지 않고 Web Audio 로 그 자리에서 만든다(라이선스 걱정 없음).
 * 잡음은 몇 초짜리 버퍼를 한 번 만들어 이어 붙여(loop) 틀고, 파도처럼 천천히 변하는 소리는
 * 오디오 그래프 안의 저주파 발진기(LFO)로 움직여 탭이 숨어 있어도 끊기지 않게 한다. */

export const SOUNDS = [
  { id: 'white', name: '백색 소음' },
  { id: 'pink', name: '분홍 소음' },
  { id: 'brown', name: '갈색 소음' },
  { id: 'rain', name: '빗소리' },
  { id: 'waves', name: '파도' },
  { id: 'fire', name: '벽난로' },
];

const FADE_IN = 1.2, FADE_OUT = 0.8; // 초

/** 끝과 처음이 이어지도록 느린 흐름(드리프트)을 빼고 크기를 맞춘다 */
function seamless(d, peak = 0.9) {
  const n = d.length, drift = (d[n - 1] - d[0]) / (n - 1);
  let max = 0;
  for (let i = 0; i < n; i++) { d[i] -= d[0] + drift * i; max = Math.max(max, Math.abs(d[i])); }
  if (max > 0) for (let i = 0; i < n; i++) d[i] *= peak / max;
}

function noiseData(kind, n) {
  const d = new Float32Array(n);
  if (kind === 'white') { for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.5; return d; }
  if (kind === 'pink') { // Paul Kellet 방식 근사
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    seamless(d, 0.6);
    return d;
  }
  // brown: 흰 잡음을 조금씩 쌓아 올린다(적분)
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last; }
  seamless(d, 0.8);
  return d;
}

export class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.voices = {}; // id → { gain, stop }
    this.vol = {}; // id → 0..1
    this.masterVol = 0.8;
    this.duck = 1; // 휴식 중 끄기 등
  }

  get supported() { return !!(window.AudioContext || window.webkitAudioContext); }

  /** 사용자 동작(클릭) 안에서 불러야 소리가 난다 */
  ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVol * this.duck;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  buffer(kind, sec = 8) {
    if (this.buffers[kind]) return this.buffers[kind];
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    if (kind === 'rainDrops') this.fillDrops(b);
    else if (kind === 'crackle') this.fillCrackle(b);
    else for (let ch = 0; ch < 2; ch++) b.copyToChannel(noiseData(kind, n), ch);
    this.buffers[kind] = b;
    return b;
  }

  /** 빗방울: 짧게 울리고 사라지는 높은 소리를 무작위 시각·위치에 뿌린다 */
  fillDrops(b) {
    const sr = b.sampleRate, n = b.length, L = b.getChannelData(0), R = b.getChannelData(1);
    const count = Math.floor((n / sr) * 26);
    for (let k = 0; k < count; k++) {
      const t0 = Math.floor(Math.random() * n);
      const f = 1800 + Math.random() * 4200, tau = 0.002 + Math.random() * 0.008;
      const amp = Math.random() < 0.12 ? 0.35 + Math.random() * 0.3 : 0.05 + Math.random() * 0.15;
      const pan = Math.random(), len = Math.floor(tau * 6 * sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr, v = amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t * (1 - t * 8));
        const j = (t0 + i) % n; // 끝을 넘으면 처음으로 이어 붙여 고리처럼 잇는다
        L[j] += v * (1 - pan); R[j] += v * pan;
      }
    }
  }

  /** 장작 타는 소리: 아주 짧은 '탁' 소리가 가끔 몰려서 난다 */
  fillCrackle(b) {
    const sr = b.sampleRate, n = b.length, L = b.getChannelData(0), R = b.getChannelData(1);
    let t = 0;
    while (t < n) {
      const burst = Math.random() < 0.25 ? 3 + Math.floor(Math.random() * 6) : 1;
      for (let k = 0; k < burst; k++) {
        const t0 = (t + Math.floor(Math.random() * 0.12 * sr)) % n;
        const tau = 0.0004 + Math.random() * (Math.random() < 0.15 ? 0.006 : 0.0015);
        const amp = (Math.random() < 0.1 ? 0.8 : 0.15 + Math.random() * 0.35) * (Math.random() < 0.5 ? 1 : -1);
        const pan = 0.25 + Math.random() * 0.5, len = Math.floor(tau * 8 * sr);
        let prev = 0;
        for (let i = 0; i < len; i++) {
          const w = (Math.random() * 2 - 1) * amp * Math.exp(-i / sr / tau);
          const v = w - prev * 0.6; prev = w; // 낮은 소리를 덜어 '탁' 하게
          const j = (t0 + i) % n;
          L[j] += v * (1 - pan); R[j] += v * pan;
        }
      }
      t += Math.floor(sr * (0.05 + Math.random() * 0.45));
    }
  }

  loop(kind, sec) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer(kind, sec);
    s.loop = true;
    // 버퍼를 여러 개 틀 때 같은 곳에서 시작하지 않게 한다
    s.start(0, Math.random() * s.buffer.duration);
    return s;
  }

  /** 소리 하나의 오디오 그래프를 만든다. 반환: 출력 노드와 멈출 노드들 */
  build(id) {
    const ctx = this.ctx, out = ctx.createGain(), srcs = [];
    const filt = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const lfo = (hz, depth, target) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = hz; g.gain.value = depth; o.connect(g).connect(target); o.start(); srcs.push(o); };
    if (id === 'white' || id === 'pink' || id === 'brown') {
      const s = this.loop(id, 8); srcs.push(s);
      const g = ctx.createGain(); g.gain.value = id === 'white' ? 0.28 : id === 'pink' ? 0.55 : 0.75;
      s.connect(g).connect(out);
    } else if (id === 'rain') {
      const s = this.loop('pink', 8); srcs.push(s);
      const hiss = ctx.createGain(); hiss.gain.value = 0.45;
      s.connect(filt('highpass', 450)).connect(filt('lowpass', 7000)).connect(hiss).connect(out);
      const d = this.loop('rainDrops', 11); srcs.push(d);
      const dg = ctx.createGain(); dg.gain.value = 0.6;
      d.connect(filt('highpass', 900)).connect(dg).connect(out);
      lfo(0.07, 0.08, hiss.gain); // 빗줄기가 조금씩 세졌다 약해진다
    } else if (id === 'waves') {
      const s = this.loop('brown', 9); srcs.push(s);
      const lp = filt('lowpass', 500), g = ctx.createGain(); g.gain.value = 0.5;
      s.connect(lp).connect(g).connect(out);
      lfo(0.085, 0.36, g.gain); lfo(0.047, 0.12, g.gain); // 밀려왔다 빠지는 큰 흐름 두 개
      lfo(0.085, 320, lp.frequency);
      const w = this.loop('pink', 8); srcs.push(w);
      const wg = ctx.createGain(); wg.gain.value = 0.12;
      w.connect(filt('bandpass', 1800, 0.5)).connect(wg).connect(out);
      lfo(0.085, 0.1, wg.gain); // 부서지는 물거품
    } else if (id === 'fire') {
      const s = this.loop('brown', 9); srcs.push(s);
      const g = ctx.createGain(); g.gain.value = 0.55;
      s.connect(filt('lowpass', 260)).connect(g).connect(out);
      lfo(0.3, 0.12, g.gain);
      const c = this.loop('crackle', 13); srcs.push(c);
      const cg = ctx.createGain(); cg.gain.value = 0.5;
      c.connect(filt('highpass', 700)).connect(cg).connect(out);
    }
    return { out, srcs };
  }

  isOn(id) { return !!this.voices[id]; }

  start(id) {
    if (!this.ensure() || this.voices[id]) return;
    const ctx = this.ctx, { out, srcs } = this.build(id);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    out.connect(gain).connect(this.master);
    gain.gain.setTargetAtTime(this.vol[id] ?? 0.5, ctx.currentTime, FADE_IN / 3);
    this.voices[id] = { gain, srcs };
  }

  stop(id) {
    const v = this.voices[id];
    if (!v) return;
    delete this.voices[id];
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.setTargetAtTime(0, t, FADE_OUT / 3);
    setTimeout(() => { for (const s of v.srcs) { try { s.stop(); } catch { /* 이미 멈춤 */ } } v.gain.disconnect(); }, FADE_OUT * 1000 + 400);
  }

  stopAll() { for (const id of Object.keys(this.voices)) this.stop(id); }

  setVol(id, v) {
    this.vol[id] = v;
    const voice = this.voices[id];
    if (voice) voice.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  setMaster(v) { this.masterVol = v; this.applyMaster(0.08); }
  setDuck(on) { const d = on ? 0 : 1; if (d === this.duck) return; this.duck = d; this.applyMaster(0.6); }
  applyMaster(tc) { if (this.master) this.master.gain.setTargetAtTime(this.masterVol * this.duck, this.ctx.currentTime, tc); }

  /** 끝 알림음: 종소리 두 번. up=true 면 올라가는 음(다시 집중), false 면 내려가는 음(휴식) */
  chime(up, volume = 0.6) {
    const ctx = this.ensure();
    if (!ctx) return;
    const notes = up ? [523.25, 783.99] : [783.99, 523.25];
    const t0 = ctx.currentTime + 0.05;
    notes.forEach((f, k) => {
      const t = t0 + k * 0.45;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * volume, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      g.connect(ctx.destination);
      [[1, 1], [2.01, 0.35], [3.02, 0.12], [4.2, 0.05]].forEach(([r, a]) => {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.value = f * r; og.gain.value = a;
        o.connect(og).connect(g);
        o.start(t); o.stop(t + 2.3);
      });
    });
  }
}
