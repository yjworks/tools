/* 벨소리 만들기: 구간 고르기, 페이드, 파형, AAC(M4A/M4R) 만들기.
 * AAC 인코딩은 브라우저의 WebCodecs AudioEncoder 가 하고, 이 파일은 조각 나누기·MP4 포장만 한다. */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * 아이폰 벨소리 최대 길이(초).
 * 출처: Apple 지원 "Create a custom ringtone on your iPhone"(support.apple.com/120692),
 *       GarageBand for iPhone 사용 설명서 "Share songs" — "Ringtones can be up to 30 seconds long." (2026-09-25 확인)
 */
export const RINGTONE_MAX_SEC = 30;
export const MIN_SEL_SEC = 1;

/** AAC(MP4)에 쓸 표본 주파수. 이 둘이 아니면 48000 으로 바꿔서 인코딩한다. */
export const AAC_RATES = [48000, 44100];
export function aacRateFor(rate) { return AAC_RATES.includes(rate) ? rate : 48000; }

/**
 * 구간 맞추기. moved: 사용자가 방금 움직인 쪽('start' | 'end').
 * 길이가 max 를 넘으면 반대쪽을 끌고 오고, min 보다 짧으면 반대쪽을 밀어낸다.
 */
export function clampSelection(start, end, duration, { max = RINGTONE_MAX_SEC, min = MIN_SEL_SEC, moved = 'end' } = {}) {
  const lim = (v) => Math.min(Math.max(v, 0), duration);
  let s = lim(start), e = lim(end);
  const minLen = Math.min(min, duration);
  if (moved === 'start') {
    if (e - s > max) e = lim(s + max);
    if (e - s < minLen) { e = lim(s + minLen); if (e - s < minLen) s = lim(e - minLen); }
  } else {
    if (e - s > max) s = lim(e - max);
    if (e - s < minLen) { s = lim(e - minLen); if (e - s < minLen) e = lim(s + minLen); }
  }
  return { start: s, end: e };
}

/** 파형 그리기용: 폭 width 칸마다 최솟값·최댓값(모든 채널 중) */
export function waveformPeaks(channels, width) {
  const n = channels[0]?.length || 0;
  const min = new Float32Array(width), max = new Float32Array(width);
  if (!n) return { min, max };
  for (let x = 0; x < width; x++) {
    const a = Math.floor((x * n) / width), b = Math.max(a + 1, Math.floor(((x + 1) * n) / width));
    let lo = Infinity, hi = -Infinity;
    for (const ch of channels) for (let i = a; i < b && i < n; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[x] = lo === Infinity ? 0 : lo; max[x] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}

/** i번째 샘플(총 n개)의 페이드 이득. 페이드인 첫 샘플은 0, 페이드아웃 마지막 샘플은 0. */
export function fadeGain(i, n, fadeInN, fadeOutN) {
  let g = 1;
  if (fadeInN > 0 && i < fadeInN) g = Math.min(g, i / fadeInN);
  if (fadeOutN > 0) { const r = n - 1 - i; if (r < fadeOutN) g = Math.min(g, r / fadeOutN); }
  return Math.max(0, g);
}

/**
 * 고른 구간을 잘라 페이드를 입힌 새 채널 배열. 채널은 최대 2개(스테레오)까지.
 * @returns {Float32Array[]}
 */
export function renderSelection(channels, sampleRate, start, end, { fadeIn = 0, fadeOut = 0 } = {}) {
  const src = channels.slice(0, 2);
  const total = src[0].length;
  const s0 = Math.max(0, Math.min(total, Math.round(start * sampleRate)));
  const s1 = Math.max(s0, Math.min(total, Math.round(end * sampleRate)));
  const n = s1 - s0;
  const fi = Math.min(n, Math.round(fadeIn * sampleRate)), fo = Math.min(n, Math.round(fadeOut * sampleRate));
  return src.map((ch) => {
    const out = ch.slice(s0, s1);
    if (fi || fo) for (let i = 0; i < n; i++) out[i] *= fadeGain(i, n, fi, fo);
    return out;
  });
}

/** 인코더에 넣을 조각 [시작, 길이] 목록 */
export function chunkRanges(total, size) {
  const out = [];
  for (let off = 0; off < total; off += size) out.push([off, Math.min(size, total - off)]);
  return out;
}

/** 채널들을 f32-planar 한 덩어리로(채널 0 전체, 그다음 채널 1 …) */
export function planarChunk(channels, offset, length) {
  const out = new Float32Array(length * channels.length);
  channels.forEach((ch, c) => out.set(ch.subarray(offset, offset + length), c * length));
  return out;
}

/**
 * MP4 의 ftyp 상자에서 'isom' 브랜드를 'M4A ' 로 바꾼다(애플 오디오 파일과 같은 표시).
 * 길이가 같은 4글자라 파일 구조는 그대로다. 새 배열을 돌려준다.
 */
export function patchM4aBrand(bytes) {
  const out = Uint8Array.from(bytes);
  const tag = (o) => String.fromCharCode(out[o], out[o + 1], out[o + 2], out[o + 3]);
  if (out.length < 16 || tag(4) !== 'ftyp') return out;
  const size = ((out[0] << 24) | (out[1] << 16) | (out[2] << 8) | out[3]) >>> 0;
  for (let o = 8; o + 4 <= size && o + 4 <= out.length; o += 4) {
    if (o === 12) continue; // minor version
    if (tag(o) === 'isom') { out[o] = 0x4d; out[o + 1] = 0x34; out[o + 2] = 0x41; out[o + 3] = 0x20; }
  }
  return out;
}

export const AAC_CODEC = 'mp4a.40.2';

/** AudioEncoder 설정 후보(비트레이트를 못 받는 경우를 대비해 없는 것도) */
export function aacConfigs(sampleRate, numberOfChannels, bitrate = 192000) {
  return [
    { codec: AAC_CODEC, sampleRate, numberOfChannels, bitrate },
    { codec: AAC_CODEC, sampleRate, numberOfChannels },
  ];
}

/**
 * AAC 로 인코딩해 M4A(=M4R) 바이트를 만든다.
 * @param {Float32Array[]} channels 1~2채널
 * @param {object} api { AudioEncoder, AudioData } — 브라우저 것을 넘긴다(시험에서는 가짜를 넘길 수 있다)
 * @param {object} config AudioEncoder.configure 에 넘길 설정(isConfigSupported 로 확인한 것)
 */
export async function encodeM4a(channels, sampleRate, api, config, onProgress) {
  const { AudioEncoder, AudioData } = api;
  const nch = channels.length, total = channels[0].length;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, audio: { codec: 'aac', numberOfChannels: nch, sampleRate }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure = null, firstTs = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        // 인코더에 따라 첫 조각 시각이 0이 아니거나(음수 포함) duration 이 비어 있을 수 있어 직접 맞춘다
        if (firstTs == null) firstTs = chunk.timestamp;
        const dur = Number.isFinite(chunk.duration) && chunk.duration > 0 ? chunk.duration : Math.round((1024 / sampleRate) * 1e6);
        muxer.addAudioChunkRaw(data, chunk.type || 'key', Math.max(0, chunk.timestamp - firstTs), dur, meta);
      } catch (e) { failure = e; }
    },
    error: (e) => { failure = e; },
  });
  enc.configure(config);
  const ranges = chunkRanges(total, 4096);
  for (let k = 0; k < ranges.length; k++) {
    const [off, len] = ranges[k];
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: len, numberOfChannels: nch, timestamp: Math.round((off / sampleRate) * 1e6), data: planarChunk(channels, off, len) });
    enc.encode(data);
    data.close?.();
    if (failure) throw failure;
    if (k % 32 === 31) { onProgress?.(k / ranges.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  await enc.flush();
  enc.close?.();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return patchM4aBrand(new Uint8Array(target.buffer));
}
