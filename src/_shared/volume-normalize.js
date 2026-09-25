/* 볼륨 평준화: 피크·RMS·라우드니스(ITU-R BS.1770 방식 근사) 측정, 이득 계산, 리미터. */
import { peakOf, rmsOf, gainToDb, dbToGain } from './media.js';

/**
 * K-가중 필터 계수(2단 바이쿼드). 48 kHz 에서 ITU-R BS.1770 표의 계수와 같아지도록
 * 아날로그 원형 값(libebur128 이 쓰는 값)으로 다른 표본 주파수의 계수를 만든다.
 * @returns {{ shelf: {b:number[], a:number[]}, hp: {b:number[], a:number[]} }}
 */
export function kWeighting(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return { shelf, hp };
}

/** 채널 가중치: 5.1 이상이면 L·R·C 1.0, LFE(4번째) 0, 서라운드 1.41. 그 밖에는 모두 1.0 */
function chWeight(c, n) {
  if (n >= 6) return c === 3 ? 0 : c >= 4 ? 1.41 : 1;
  return 1;
}

/**
 * 통합 라우드니스(LUFS). 400ms 블록, 75% 겹침, 절대 게이트 -70 LUFS, 상대 게이트 -10 LU.
 * 5.1 채널이면 LFE(4번째)는 뺀다. 소리가 거의 없으면 -Infinity.
 */
export function integratedLoudness(channels, fs) {
  const n = channels[0]?.length || 0;
  const hop = Math.round(fs * 0.1);
  const segs = Math.floor(n / hop);
  if (!n) return -Infinity;
  const { shelf, hp } = kWeighting(fs);
  // 채널별 100ms 조각의 제곱합
  const segPow = new Float64Array(Math.max(segs, 1));
  const partial = segs < 4; // 0.4초보다 짧으면 전체를 한 블록으로
  let wholeSum = 0;
  channels.forEach((ch, c) => {
    const w = chWeight(c, channels.length);
    if (!w) return;
    const [b0, b1, b2] = shelf.b, [, a1, a2] = shelf.a;
    const [c0, c1, c2] = hp.b, [, d1, d2] = hp.a;
    // 1단(shelf): x→y, 2단(high-pass): y→z. Direct Form I.
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      const z = c0 * y + c1 * y1 + c2 * y2 - d1 * z1 - d2 * z2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; z2 = z1; z1 = z;
      const p = z * z * w;
      if (partial) wholeSum += p;
      else { const s = Math.floor(i / hop); if (s < segs) segPow[s] += p; }
    }
  });
  const blocks = [];
  if (partial) blocks.push(wholeSum / n);
  else for (let j = 0; j + 4 <= segs; j++) blocks.push((segPow[j] + segPow[j + 1] + segPow[j + 2] + segPow[j + 3]) / (4 * hop));
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
  const absGated = blocks.filter((ms) => ms > 0 && lufs(ms) > -70);
  if (!absGated.length) return -Infinity;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = lufs(mean(absGated)) - 10;
  const relGated = absGated.filter((ms) => lufs(ms) > rel);
  return relGated.length ? lufs(mean(relGated)) : -Infinity;
}

/** 피크·RMS·라우드니스 한꺼번에 */
export function measure(channels, fs) {
  const peak = peakOf(channels), rms = rmsOf(channels);
  return { peak, peakDb: gainToDb(peak), rms, rmsDb: gainToDb(rms), lufs: integratedLoudness(channels, fs) };
}

/**
 * 목표에 맞추려면 몇 dB 올리거나 내려야 하는지.
 * mode: 'peak'(dBFS) | 'rms'(dBFS) | 'lufs'
 */
export function gainDbFor(mode, target, stats) {
  const cur = mode === 'peak' ? stats.peakDb : mode === 'rms' ? stats.rmsDb : stats.lufs;
  if (!Number.isFinite(cur)) return 0; // 무음이면 건드리지 않는다
  return target - cur;
}

/** 이득 곱하기(새 배열) */
export function applyGain(channels, gain) {
  return channels.map((ch) => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * gain; return o; });
}

/** 1을 넘는(=16비트로 저장하면 잘리는) 샘플 수 */
export function countClipped(channels, limit = 1) {
  let n = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > limit) n++;
  return n;
}

/**
 * 미리 보기(lookahead) 피크 리미터. 모든 채널에 같은 이득을 걸어(스테레오 위치 유지) 어떤 샘플도 ceiling 을 넘지 않게 한다.
 * 1) 샘플마다 필요한 이득 → 2) 앞으로 L개 중 최솟값 → 3) L개 이동 평균(부드럽게 내려감) → 4) release 로 천천히 회복.
 * 2~3단계 덕분에 피크 지점의 이득은 늘 필요한 값 이하라서 넘치지 않는다.
 * @returns {{ channels: Float32Array[], limitedSamples: number, maxReductionDb: number }}
 */
export function limit(channels, fs, ceiling, { lookaheadMs = 5, releaseMs = 80 } = {}) {
  const n = channels[0]?.length || 0;
  const L = Math.max(1, Math.round((fs * lookaheadMs) / 1000));
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) { const a = Math.abs(ch[i]); if (a > m) m = a; }
    req[i] = m > ceiling ? ceiling / m : 1;
  }
  // 앞으로 L개(i..i+L-1) 최솟값: 단조 덱
  const fwdMin = new Float32Array(n);
  const dq = new Int32Array(n + 1); let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && req[dq[tail - 1]] >= req[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L - 1) head++;
    fwdMin[i] = req[dq[head]];
  }
  // 뒤로 L개(i-L+1..i) 평균. 모자란 앞부분은 1로 채운 셈
  const smooth = new Float32Array(n);
  let sum = L; // 처음엔 1이 L개 있다고 본다
  const ring = new Float64Array(L).fill(1); let ri = 0;
  for (let i = 0; i < n; i++) {
    sum += fwdMin[i] - ring[ri]; ring[ri] = fwdMin[i]; ri = (ri + 1) % L;
    smooth[i] = sum / L;
  }
  const rel = 1 - Math.exp(-1 / Math.max(1, (fs * releaseMs) / 1000));
  let g = 1, limitedSamples = 0, minG = 1;
  const out = channels.map((ch) => new Float32Array(ch.length));
  for (let i = 0; i < n; i++) {
    const t = smooth[i];
    g = t < g ? t : g + (t - g) * rel; // 내려갈 땐 즉시(이미 부드럽게 만든 값), 올라갈 땐 천천히
    if (g < 0.989) limitedSamples++; // 0.1 dB 넘게 줄인 샘플
    if (g < minG) minG = g;
    for (let c = 0; c < channels.length; c++) {
      let v = channels[c][i] * g;
      if (v > ceiling) v = ceiling; else if (v < -ceiling) v = -ceiling; // 부동소수 오차 대비
      out[c][i] = v;
    }
  }
  return { channels: out, limitedSamples, maxReductionDb: -gainToDb(minG) };
}

/**
 * 전체 처리: 목표에 맞춰 이득 → (선택) 리미터.
 * @param opts { mode, target, limiter: boolean, ceilingDb }
 */
export function normalize(channels, fs, stats, { mode = 'peak', target = -1, limiter = true, ceilingDb = -1 } = {}) {
  const gainDb = gainDbFor(mode, target, stats);
  let out = applyGain(channels, dbToGain(gainDb));
  let limited = { limitedSamples: 0, maxReductionDb: 0 };
  if (limiter && mode !== 'peak') {
    const ceiling = dbToGain(ceilingDb);
    if (peakOf(out) > ceiling) { const r = limit(out, fs, ceiling); out = r.channels; limited = r; }
  }
  return { channels: out, gainDb, ...limited, clipped: countClipped(out) };
}
