import { describe, it, expect } from 'vitest';
import { kWeighting, integratedLoudness, measure, gainDbFor, applyGain, limit, normalize, countClipped } from '../src/_shared/volume-normalize.js';
import { peakOf, dbToGain } from '../src/_shared/media.js';

const sine = (amp, f, fs, sec) => Float32Array.from({ length: Math.round(fs * sec) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / fs));

describe('K-가중 필터', () => {
  it('48 kHz 에서 ITU-R BS.1770 표 계수와 같다', () => {
    const { shelf, hp } = kWeighting(48000);
    const itu = { sb: [1.53512485958697, -2.69169618940638, 1.19839281085285], sa: [-1.69065929318241, 0.73248077421585], ha: [-1.99004745483398, 0.99007225036621] };
    shelf.b.forEach((v, i) => expect(v).toBeCloseTo(itu.sb[i], 6));
    expect(shelf.a[1]).toBeCloseTo(itu.sa[0], 6); expect(shelf.a[2]).toBeCloseTo(itu.sa[1], 6);
    expect(hp.b).toEqual([1, -2, 1]);
    expect(hp.a[1]).toBeCloseTo(itu.ha[0], 6); expect(hp.a[2]).toBeCloseTo(itu.ha[1], 6);
  });
});

describe('라우드니스', () => {
  it('0 dBFS 1 kHz 사인(한 채널) = -3.01 LUFS', () => {
    expect(integratedLoudness([sine(1, 1000, 48000, 5)], 48000)).toBeCloseTo(-3.01, 1);
    expect(integratedLoudness([sine(1, 1000, 44100, 5)], 44100)).toBeCloseTo(-3.01, 1);
  });
  it('-20 dBFS 사인 두 채널 = -20 LUFS 근처', () => {
    const s = sine(0.1, 1000, 48000, 4);
    expect(integratedLoudness([s, s], 48000)).toBeCloseTo(-20.0, 1);
  });
  it('조용한 구간은 게이트로 빠진다', () => {
    const loud = sine(0.1, 1000, 48000, 3), quiet = new Float32Array(48000 * 6);
    const joined = new Float32Array(loud.length + quiet.length); joined.set(loud); joined.set(quiet, loud.length);
    expect(integratedLoudness([joined], 48000)).toBeCloseTo(integratedLoudness([loud], 48000), 0);
  });
  it('무음 = -Infinity', () => expect(integratedLoudness([new Float32Array(48000)], 48000)).toBe(-Infinity));
  it('0.4초보다 짧아도 값이 나온다', () => expect(integratedLoudness([sine(1, 1000, 48000, 0.2)], 48000)).toBeCloseTo(-3.0, 0));
});

describe('이득 계산', () => {
  const s = sine(0.25, 440, 48000, 2);
  const st = measure([s], 48000);
  it('측정', () => { expect(st.peakDb).toBeCloseTo(-12.04, 1); expect(st.rmsDb).toBeCloseTo(-15.05, 1); });
  it('피크 -1 dBFS 로', () => {
    const g = gainDbFor('peak', -1, st);
    expect(g).toBeCloseTo(11.04, 1);
    const out = applyGain([s], dbToGain(g));
    expect(20 * Math.log10(peakOf(out))).toBeCloseTo(-1, 2);
  });
  it('RMS·LUFS 목표', () => {
    expect(gainDbFor('rms', -20, st)).toBeCloseTo(-4.95, 1);
    expect(gainDbFor('lufs', -16, st)).toBeCloseTo(-16 - st.lufs, 6);
    expect(gainDbFor('lufs', -16, { lufs: -Infinity })).toBe(0);
  });
});

describe('리미터', () => {
  it('어떤 샘플도 천장을 넘지 않는다', () => {
    const fs = 48000;
    const x = sine(0.3, 220, fs, 1);
    for (let i = 20000; i < 20050; i++) x[i] = 1.8 * Math.sign(x[i] || 1); // 튀는 소리
    const y = new Float32Array(x); y[30000] = -2.5;
    const ceiling = dbToGain(-1);
    const r = limit([x, y], fs, ceiling);
    expect(peakOf(r.channels)).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(r.maxReductionDb).toBeGreaterThan(8);
    // 튀는 곳에서 멀리 떨어진 부분은 거의 그대로
    expect(r.channels[0][2000]).toBeCloseTo(x[2000], 5);
    expect(r.limitedSamples).toBeGreaterThan(0);
    expect(r.limitedSamples).toBeLessThan(fs * 0.8);
  });
  it('갑자기 꺾이지 않는다(이득 변화가 부드럽다)', () => {
    const fs = 48000, x = new Float32Array(fs).fill(0.5); x[24000] = 2;
    const r = limit([x], fs, 1, { lookaheadMs: 5 });
    // 샘플마다 걸린 이득(출력/입력)이 한 번에 크게 변하지 않는다
    const g = (i) => r.channels[0][i] / x[i];
    let maxStep = 0; for (let i = 1; i < fs; i++) maxStep = Math.max(maxStep, Math.abs(g(i) - g(i - 1)));
    expect(maxStep).toBeLessThan(0.01);
    expect(r.channels[0][24000]).toBeCloseTo(1, 5);
  });
  it('normalize: RMS 로 올리고 리미터로 막는다', () => {
    const s = sine(0.25, 440, 48000, 1); s[1000] = 0.95;
    const st = measure([s], 48000);
    const r = normalize([s], 48000, st, { mode: 'rms', target: -10, limiter: true, ceilingDb: -1 });
    expect(r.gainDb).toBeCloseTo(-10 - st.rmsDb, 6);
    expect(peakOf(r.channels)).toBeLessThanOrEqual(dbToGain(-1) + 1e-6);
    expect(r.clipped).toBe(0);
    const off = normalize([s], 48000, st, { mode: 'rms', target: -3, limiter: false });
    expect(off.clipped).toBeGreaterThan(0);
    expect(countClipped([new Float32Array([1.2, -1.1, 0.4])])).toBe(2);
  });
});
