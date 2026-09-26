/* 사진 용량 줄이기의 순수 로직. 캔버스·파일과 떨어져 있어 테스트할 수 있다.
   - 목표 용량 해석(1KB = 1,000바이트로 잡아 두 기준 모두 넘지 않게)
   - 긴 변 기준 크기 줄이기
   - 출력 형식 고르기(브라우저가 WebP 로 저장할 수 있는지 반영)
   - 목표 용량 맞추기: 품질 이진 탐색 → 그래도 크면 해상도를 줄여 다시
   - 결과가 원본보다 크면 원본을 쓰는 판단
   인코딩 자체는 호출하는 쪽이 encode(scale, quality) 로 넘긴다. */

export const KB = 1000;
export const MB = 1000 * 1000;

/** "500", "KB" → 500000. 잘못된 값이면 null */
export function parseTarget(value, unit = 'KB') {
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const bytes = Math.floor(n * (unit === 'MB' ? MB : KB));
  return bytes >= 1000 ? bytes : null;                     // 1KB 미만 목표는 받지 않는다
}

/** 긴 변이 maxLong 을 넘으면 비율을 지켜 줄인다. maxLong 이 없거나 0 이면 그대로 */
export function fitLongSide(w, h, maxLong) {
  const long = Math.max(w, h);
  if (!maxLong || long <= maxLong) return { width: w, height: h, scale: 1 };
  const scale = maxLong / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** 원래 크기 × 배율 → 정수 크기(최소 1) */
export function scaledSize(w, h, scale) {
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };

/** 입력 MIME 정리(이름으로 보충) */
export function inputMime(type = '', name = '') {
  if (/^image\/(jpeg|png|webp)$/.test(type)) return type;
  const m = /\.(jpe?g|png|webp)$/i.exec(name);
  return m ? MIME[m[1].toLowerCase()] : null;
}

/**
 * 출력 형식. choice: 'keep' | 'jpg' | 'webp' | 'png'
 * WebP 를 저장하지 못하는 브라우저(일부 사파리)에서는 JPG 로 바꾸고 fallback=true
 */
export function resolveFormat(choice, input, canWebp) {
  let mime = choice === 'keep' ? input || 'image/jpeg' : MIME[choice] || 'image/jpeg';
  let fallback = false;
  if (mime === 'image/webp' && !canWebp) { mime = 'image/jpeg'; fallback = true; }
  return { mime, fallback };
}

export const extFor = (mime) => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' })[mime] || 'jpg';
export const lossless = (mime) => mime === 'image/png';

/** 저장 이름: 원래 이름-small.확장자, 같은 이름이면 -2, -3 (taken 은 소문자 Set) */
export function outName(name, mime, taken = new Set(), suffix = '-small') {
  let base = String(name || '').replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'photo';
  if (base.length > 120) base = base.slice(0, 120);
  const ext = extFor(mime);
  let out = `${base}${suffix}.${ext}`, i = 2;
  while (taken.has(out.toLowerCase())) out = `${base}${suffix}-${i++}.${ext}`;
  taken.add(out.toLowerCase());
  return out;
}

/** 줄어든 비율(%) — 커졌으면 음수 */
export function savedPercent(before, after) {
  if (!before) return 0;
  return Math.round((1 - after / before) * 1000) / 10;
}

const round2 = (q) => Math.round(q * 100) / 100;

/**
 * 한 해상도에서 목표 용량 이하가 되는 가장 높은 품질을 이진 탐색으로 찾는다.
 * encode(q) → Promise<{ size, ... }>. 품질이 높을수록 대체로 커진다는 가정만 쓴다
 * (항상 그렇지는 않으므로 '목표 이하였던 것 중 품질이 가장 높은 것'을 기억한다).
 * 결과: { best(목표 이하 중 최고 품질 | null), smallest(가장 작았던 것), tries }
 */
export async function searchQuality(encode, target, { qMin = 0.5, qMax = 0.92, steps = 6 } = {}) {
  const tried = new Map();
  const run = async (q) => {
    q = round2(q);
    if (!tried.has(q)) tried.set(q, { q, ...(await encode(q)) });
    return tried.get(q);
  };
  let best = null, smallest = null;
  const note = (r) => {
    if (!smallest || r.size < smallest.size) smallest = r;
    if (r.size <= target && (!best || r.q > best.q)) best = r;
  };
  const top = await run(qMax); note(top);
  if (top.size <= target) return { best: top, smallest, tries: tried.size };
  const bottom = await run(qMin); note(bottom);
  if (bottom.size > target) return { best: null, smallest, tries: tried.size };
  let lo = qMin, hi = qMax;
  for (let i = 0; i < steps && hi - lo > 0.015; i++) {
    const mid = round2((lo + hi) / 2);
    if (mid === round2(lo) || mid === round2(hi)) break;
    const r = await run(mid); note(r);
    if (r.size <= target) lo = mid; else hi = mid;
  }
  return { best, smallest, tries: tried.size };
}

/** 목표를 넘었을 때 다음 해상도 배율. 용량은 대략 화소 수에 비례하므로 √(목표/현재) 에 여유 0.93, 한 번에 0.5~0.9 배 */
export function nextScale(scale, size, target) {
  const f = Math.sqrt(target / size) * 0.93;
  return scale * Math.min(0.9, Math.max(0.5, f));
}

/**
 * 목표 용량 맞추기.
 * encode(scale, q) → Promise<{ size, ... }> (scale 은 시작 크기 대비 배율, 무손실 형식이면 q 무시)
 * allowResize: 품질 하한에서도 크면 해상도를 줄여 다시 시도
 * 결과: { result, scale, quality, fits, tries }
 */
export async function fitToTarget(encode, target, { isLossless = false, allowResize = true, qMax = 0.92, qMin, minScale = 0.05, maxRounds = 8 } = {}) {
  const floor = qMin ?? (allowResize ? 0.5 : 0.05);
  let scale = 1, tries = 0, smallest = null;
  for (let round = 0; round < maxRounds; round++) {
    let best, small;
    if (isLossless) {
      const r = { q: 1, ...(await encode(scale, 1)) }; tries++;
      best = r.size <= target ? r : null; small = r;
    } else {
      const s = await searchQuality((q) => encode(scale, q), target, { qMin: floor, qMax });
      tries += s.tries; best = s.best; small = s.smallest;
    }
    if (!smallest || small.size < smallest.r.size) smallest = { r: small, scale };
    if (best) return { result: best, scale, quality: best.q, fits: true, tries };
    if (!allowResize) break;
    const ns = nextScale(scale, small.size, target);
    if (ns < minScale) break;
    scale = ns;
  }
  return { result: smallest.r, scale: smallest.scale, quality: smallest.r.q, fits: false, tries };
}

/**
 * 결과 대신 원본을 그대로 쓸지.
 * 형식이 같고, 크기를 줄이지 않았고, 원본이 결과보다 작거나 같고,
 * (목표 용량이 있으면) 원본이 목표 이하이고, 메타데이터를 지워야 할 때는 손실 없이 지울 수 있는 경우(JPEG·PNG, 방향 정보 1)
 */
export function preferOriginal({ inMime, outMime, resized, origSize, outSize, target = null, stripMeta, orientation = 1, hasMeta = true }) {
  if (inMime !== outMime || resized) return false;
  if (origSize > outSize) return false;
  if (target && origSize > target) return false;
  if (stripMeta && hasMeta && (inMime === 'image/webp' || orientation !== 1)) return false;
  return true;
}

/** WebP(RIFF) 안에 EXIF·XMP 청크가 있는지. WebP 가 아니면 null */
export function webpHasMeta(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const tag = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  let p = 12;
  while (p + 8 <= u8.length) {
    const t = tag(p), len = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
    if (t === 'EXIF' || t === 'XMP ') return true;
    p += 8 + len + (len & 1);
  }
  return false;
}

/** 합계 */
export function totals(items) {
  let before = 0, after = 0, done = 0;
  for (const it of items) if (it.outSize != null) { before += it.size; after += it.outSize; done++; }
  return { done, before, after, saved: before - after, percent: savedPercent(before, after) };
}

/** JPEG 의 APP1 EXIF 에서 TIFF 부분만(사본). 없으면 null */
export function jpegExifTiff(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const m = u8[p + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (m === 0xe1 && len > 8 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66 && u8[p + 8] === 0 && u8[p + 9] === 0) {
      return u8.slice(p + 10, Math.min(p + 2 + len, u8.length));
    }
    p += 2 + len;
  }
  return null;
}

/** 크게 줄일 때 한 번에 줄이면 계단 현상이 생기므로 반씩 줄여 가는 단계 목록(마지막이 목표 크기) */
export function downscaleSteps(w, h, tw, th) {
  const steps = [];
  let cw = w, ch = h;
  while (cw / 2 > tw && ch / 2 > th) { cw = Math.round(cw / 2); ch = Math.round(ch / 2); steps.push([cw, ch]); }
  steps.push([tw, th]);
  return steps;
}
