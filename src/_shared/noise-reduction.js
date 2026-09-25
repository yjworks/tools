/* 음성 잡음 제거: RNNoise 에 넣을 프레임 나누기, 크기 맞추기, 지연 보정, 원음 섞기. */

/** RNNoise 는 48 kHz 모노, 한 번에 480샘플(10ms)을 받는다. */
export const RNNOISE_RATE = 48000;
export const RNNOISE_FRAME = 480;
/**
 * RNNoise 출력이 입력보다 늦게 나오는 샘플 수.
 * @shiguredo/rnnoise-wasm 2025.1.5 로 음성 비슷한 신호를 넣고 교차상관을 재어 보니 960샘플(20ms)이었다(2026-09-25).
 * 원음과 섞을 때 어긋나지 않도록 이만큼 앞으로 당긴다.
 */
export const RNNOISE_DELAY = 960;
/** RNNoise 는 16비트 정수 크기(-32768~32767)의 값을 가정한다(라이브러리 d.ts 설명). */
export const PCM16_SCALE = 32768;

/**
 * 모노 샘플 전체에 잡음 제거를 적용한다.
 * @param {Float32Array} input -1~1 모노, 48 kHz
 * @param {(frame: Float32Array) => number} processFrame 480샘플을 제자리에서 바꾸고 음성 확률(0~1)을 돌려주는 함수
 * @param {object} opt { frameSize, delay, onProgress(0~1), yieldEvery }
 * @returns {Promise<{ output: Float32Array, voice: number }>} voice: 음성 확률 평균
 */
export async function denoise(input, processFrame, { frameSize = RNNOISE_FRAME, delay = RNNOISE_DELAY, onProgress, yieldEvery = 400 } = {}) {
  const n = input.length;
  const frames = Math.ceil((n + delay) / frameSize);
  const padded = new Float32Array(frames * frameSize);
  padded.set(input);
  const frame = new Float32Array(frameSize);
  let vad = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * frameSize;
    for (let i = 0; i < frameSize; i++) frame[i] = padded[off + i] * PCM16_SCALE;
    vad += processFrame(frame) || 0;
    for (let i = 0; i < frameSize; i++) padded[off + i] = frame[i] / PCM16_SCALE;
    if (yieldEvery && f % yieldEvery === yieldEvery - 1) { onProgress?.(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  onProgress?.(1);
  return { output: padded.slice(delay, delay + n), voice: frames ? vad / frames : 0 };
}

/** 원음(dry)과 처리음(wet) 섞기. amount 0 = 원음, 1 = 처리음 */
export function mixDryWet(dry, wet, amount) {
  const a = Math.min(1, Math.max(0, amount));
  const n = Math.min(dry.length, wet.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dry[i] * (1 - a) + wet[i] * a;
  return out;
}

/** 처리 전후 에너지 비교(dB). 얼마나 줄었는지 보여 줄 때 쓴다. */
export function reductionDb(before, after) {
  let a = 0, b = 0;
  for (let i = 0; i < before.length; i++) a += before[i] * before[i];
  for (let i = 0; i < after.length; i++) b += after[i] * after[i];
  if (!a) return 0;
  return b ? 10 * Math.log10(a / b) : Infinity;
}
