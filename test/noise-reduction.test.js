import { describe, it, expect } from 'vitest';
import { denoise, mixDryWet, reductionDb, RNNOISE_FRAME, PCM16_SCALE } from '../src/_shared/noise-reduction.js';

describe('RNNoise 프레임 처리', () => {
  it('480샘플씩, 16비트 크기로 넘기고 되돌린다', async () => {
    const seen = [];
    const input = Float32Array.from({ length: 1000 }, (_, i) => (i % 100) / 100 - 0.5);
    const { output } = await denoise(input, (f) => { seen.push(f.length); expect(Math.max(...f)).toBeGreaterThanOrEqual(0); return 0.5; }, { delay: 0, yieldEvery: 0 });
    expect(seen.every((n) => n === RNNOISE_FRAME)).toBe(true);
    expect(seen.length).toBe(3);
    expect(output.length).toBe(1000);
    for (let i = 0; i < 1000; i += 97) expect(output[i]).toBeCloseTo(input[i], 6);
  });
  it('값 크기가 int16 범위로 들어간다', async () => {
    let max = 0;
    await denoise(new Float32Array(480).fill(0.5), (f) => { max = Math.max(max, ...f); return 0; }, { delay: 0, yieldEvery: 0 });
    expect(max).toBe(0.5 * PCM16_SCALE);
  });
  it('지연 보정: 늦게 나오는 만큼 앞으로 당긴다', async () => {
    const D = 960, hist = [];
    // 가짜 처리기: 입력을 D샘플 늦게 내보낸다(실제 RNNoise 처럼)
    const fake = (f) => { const inCopy = Array.from(f); for (let i = 0; i < f.length; i++) { hist.push(inCopy[i]); f[i] = hist.length > D ? hist[hist.length - 1 - D] : 0; } return 1; };
    const input = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * 0.3);
    const { output, voice } = await denoise(input, fake, { delay: D, yieldEvery: 0 });
    expect(output.length).toBe(5000);
    expect(voice).toBe(1);
    for (let i = 0; i < 5000; i += 123) expect(output[i]).toBeCloseTo(input[i], 5);
  });
  it('진행률을 알린다', async () => {
    const p = [];
    await denoise(new Float32Array(480 * 10), () => 0, { delay: 0, yieldEvery: 3, onProgress: (v) => p.push(v) });
    expect(p.at(-1)).toBe(1); expect(p.length).toBeGreaterThan(1);
  });
});

describe('원음 섞기', () => {
  it('비율', () => {
    const d = new Float32Array([1, 1]), w = new Float32Array([0, 0.5]);
    expect([...mixDryWet(d, w, 0)]).toEqual([1, 1]);
    expect([...mixDryWet(d, w, 1)]).toEqual([0, 0.5]);
    expect([...mixDryWet(d, w, 0.25)]).toEqual([0.75, 0.875]);
    expect([...mixDryWet(d, w, 7)]).toEqual([0, 0.5]);
  });
  it('줄어든 양(dB)', () => {
    expect(reductionDb(new Float32Array([1, 1]), new Float32Array([0.1, 0.1]))).toBeCloseTo(20, 6);
    expect(reductionDb(new Float32Array(2), new Float32Array(2))).toBe(0);
  });
});
