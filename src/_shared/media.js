/* 오디오·영상 도구 공통 순수 로직: 녹화 형식 고르기, WAV 만들기, 레벨 계산, 리샘플링.
 * 화면(DOM)에 기대지 않아서 Node(vitest)에서 그대로 시험할 수 있다. */

/* ---------- MediaRecorder 형식 ---------- */

/** 영상+소리. 앞쪽일수록 먼저 고른다(MP4 → WebM). */
export const VIDEO_AV_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** 영상만(소리 없음). */
export const VIDEO_ONLY_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** 소리만. */
export const AUDIO_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** 후보 가운데 브라우저가 지원하는 첫 형식. 하나도 없으면 '' (브라우저 기본값에 맡긴다). */
export function pickMime(candidates, isSupported) {
  for (const c of candidates) {
    try { if (isSupported(c)) return c; } catch { /* 형식 문자열을 못 읽는 브라우저 */ }
  }
  return '';
}

/** 지원하는 형식을 컨테이너(mp4/webm/ogg)별로 하나씩 */
export function supportedContainers(candidates, isSupported) {
  const out = [];
  for (const c of candidates) {
    let ok = false;
    try { ok = isSupported(c); } catch { ok = false; }
    const box = containerOf(c);
    if (ok && !out.some((o) => o.container === box)) out.push({ container: box, mime: c });
  }
  return out;
}

export function containerOf(mime) {
  const m = String(mime).toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return '';
}

/** 파일 확장자. 소리만 담은 MP4 는 m4a 로 저장한다. */
export function extForMime(mime) {
  const m = String(mime).toLowerCase();
  const box = containerOf(m);
  if (box === 'mp4') return m.startsWith('audio/') ? 'm4a' : 'mp4';
  return box || 'webm';
}

/** Blob 타입: codecs 는 떼고 컨테이너만 남긴다 */
export function baseMime(mime) { return String(mime).split(';')[0].trim(); }

/* ---------- 시간·이름 ---------- */

/** 초 → "m:ss" 또는 "h:mm:ss" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** 초 → "m:ss.d" (소수 첫째 자리) */
export function fmtSec(sec) {
  const t = Math.max(0, Math.round(sec * 10) / 10);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 날짜로 파일 이름 만들기: screen-20260925-143005 */
export function stampName(prefix, d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ---------- 데시벨 ---------- */

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** 샘플 피크(절댓값 최대). channels: Float32Array[] */
export function peakOf(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
  return p;
}

/** 모든 채널을 합친 RMS */
export function rmsOf(channels) {
  let sum = 0, n = 0;
  for (const ch of channels) { for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]; n += ch.length; }
  return n ? Math.sqrt(sum / n) : 0;
}

/** 레벨 막대용: dBFS 를 0~1 로 (floor dB 이하 0, 0 dB 이상 1) */
export function meterFraction(db, floor = -60) {
  if (!Number.isFinite(db) || db <= floor) return 0;
  return Math.min(1, (db - floor) / -floor);
}

/* ---------- 채널·리샘플링 ---------- */

/** 여러 채널을 평균해 모노로 */
export function mixToMono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/** 선형 보간 리샘플링 (OfflineAudioContext 를 못 쓸 때의 대비책) */
export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return Float32Array.from(input);
  const outLen = Math.max(1, Math.round(input.length * toRate / fromRate));
  const out = new Float32Array(outLen);
  const step = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    if (i0 >= last) { out[i] = input[last] ?? 0; continue; }
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i0 + 1] * f;
  }
  return out;
}

/* ---------- WAV (16비트 PCM) ---------- */

/** Float(-1~1) → 16비트 정수. 범위를 넘으면 자른다. */
export function floatToInt16(v) {
  const s = v > 1 ? 1 : v < -1 ? -1 : (Number.isNaN(v) ? 0 : v);
  return s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
}

/**
 * 16비트 PCM WAV 파일 바이트 만들기.
 * @param {Float32Array[]} channels 채널별 샘플(-1~1). 길이가 다르면 가장 짧은 길이에 맞춘다.
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(channels, sampleRate) {
  if (!channels.length) throw new Error('채널이 없습니다');
  const nch = channels.length;
  const frames = Math.min(...channels.map((c) => c.length));
  const blockAlign = nch * 2;
  const dataSize = frames * blockAlign;
  if (44 + dataSize > 0xffffffff) throw new Error('WAV 파일은 4GB를 넘을 수 없습니다');
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) { v.setInt16(off, floatToInt16(channels[c][i]), true); off += 2; }
  }
  return new Uint8Array(buf);
}

/** 16비트 PCM WAV 읽기(시험·확인용). { sampleRate, channels } */
export function decodeWav16(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV 아님');
  let o = 12, nch = 0, rate = 0, bits = 0, data = null;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { nch = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') data = { off: o + 8, size };
    o += 8 + size + (size & 1);
  }
  if (bits !== 16 || !data) throw new Error('16비트 PCM 아님');
  const frames = data.size / (2 * nch);
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) {
    const s = v.getInt16(data.off + (i * nch + c) * 2, true);
    channels[c][i] = s < 0 ? s / 32768 : s / 32767;
  }
  return { sampleRate: rate, channels };
}

/** AudioBuffer → Float32Array[] (복사하지 않음) */
export function channelsOf(audioBuffer) {
  return Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
}

/* ---------- 녹화 공통 ---------- */

/** 일시정지를 뺀 경과 시간(ms). now 를 바꿔 넣으면 시험할 수 있다. */
export function createClock(now = () => performance.now()) {
  let acc = 0, since = null;
  return {
    start() { acc = 0; since = now(); },
    pause() { if (since != null) { acc += now() - since; since = null; } },
    resume() { if (since == null) since = now(); },
    elapsed() { return acc + (since != null ? now() - since : 0); },
  };
}

/** 휴대폰·태블릿 추정(안내 문구용. 기능 판단은 늘 기능 확인으로 한다) */
export function isMobileUA(ua = '', maxTouchPoints = 0, uaDataMobile) {
  if (uaDataMobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1; // iPadOS 는 Mac 처럼 보인다
}

/**
 * MediaRecorder 시작. { rec, done } — done 은 멈춘 뒤 Blob 으로 풀린다.
 * mime 이 ''이면 브라우저 기본 형식.
 */
export function startRecording(stream, mime, { timeslice = 1000, fallbackType = 'video/webm', bitsPerSecond } = {}) {
  const opts = {};
  if (mime) opts.mimeType = mime;
  if (bitsPerSecond) opts.bitsPerSecond = bitsPerSecond;
  const rec = new MediaRecorder(stream, opts);
  const chunks = [];
  rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  const done = new Promise((resolve, reject) => {
    rec.addEventListener('stop', () => resolve(new Blob(chunks, { type: baseMime(rec.mimeType || mime) || fallbackType })));
    rec.addEventListener('error', (e) => reject(e.error || new Error('녹화 중 오류가 났습니다')));
  });
  rec.start(timeslice);
  return { rec, done };
}
