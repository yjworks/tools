/* AI 누끼(배경 지우기) — 화면과 떨어진 순수 계산.
 * 마스크는 화소마다 0(배경)~1(남길 부분) 값을 가진 Float32Array(가로×세로, 한 줄씩).
 * 모델 추론은 main.js 가 하고, 여기서는 마스크 다듬기·합성·비율 자르기만 한다. */

/** 모델 파일(받기만 하는 정적 파일). 크기는 2026-09-26 storage.googleapis.com 응답의 content-length. */
export const MODELS = {
  portrait: {
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
    bytes: 16371837,
  },
  object: {
    url: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/latest/magic_touch.tflite',
    bytes: 6227884,
  },
};
/** MediaPipe 엔진(wasm). public/mediapipe/1.0.1/ 에 있는 파일 크기. */
export const ENGINE_BYTES = { simd: 11756954, nosimd: 10960242 };

export const MAX_OUT = 4096;   // 저장할 때 긴 변 상한
export const WORK_MAX = 1536;  // 추론·편집·미리보기용 긴 변

/** 비율 자르기 선택지. ratio = 가로/세로. */
export const RATIOS = {
  orig: null,
  '3:4': 3 / 4,
  '35:45': 35 / 45,
  '1:1': 1,
};

/** 배경 색 선택지(증명사진 배경에 흔히 쓰는 색). */
export const BACKGROUNDS = {
  none: null,
  white: '#ffffff',
  sky: '#cfe3f6',
  gray: '#d7d9dc',
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 긴 변이 max 를 넘지 않게 줄인 크기. 키우지는 않는다. */
export function fitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}

/** RGBA → 밝기(0~1). Rec.601 가중치. */
export function grayOf(rgba) {
  const n = rgba.length >> 2, out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  return out;
}

/** 상자 평균 흐림. 가장자리는 실제로 들어간 화소 수로 나눈다(바깥을 0으로 치지 않음). O(화소 수). */
export function boxBlur(src, w, h, r) {
  r = Math.max(0, Math.floor(r));
  if (r === 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[o + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[o + x] = sum / (hi - lo + 1);
      if (x + r + 1 < w) sum += src[o + x + r + 1];
      if (x - r >= 0) sum -= src[o + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = sum / (hi - lo + 1);
      if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) sum -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

/**
 * 가이드 필터(He·Sun·Tang 2010, 흑백 안내 영상). 모델이 낸 흐릿한 마스크 p 의 경계를
 * 원본 밝기 I 의 실제 경계에 맞춘다. 창 안에서 q = a·I + b 로 두고 a,b 를 최소제곱으로 구한다.
 * eps 가 크면 더 부드럽게, 작으면 원본 경계를 더 따른다.
 */
export function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur(I, w, h, r), mP = boxBlur(p, w, h, r), mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const a = Ip, b = II; // 자리 재사용
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIp[i] - mI[i] * mP[i];
    a[i] = cov / (varI + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxBlur(a, w, h, r), mB = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clamp01(mA[i] * I[i] + mB[i]);
  return q;
}

/** lo 아래는 0, hi 위는 1, 그 사이는 부드러운 S자(smoothstep). 모델의 흐릿한 경계를 조인다. */
export function levels(m, lo, hi) {
  const out = new Float32Array(m.length), d = Math.max(1e-6, hi - lo);
  for (let i = 0; i < m.length; i++) {
    const t = clamp01((m[i] - lo) / d);
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/** '가장자리 부드럽게' 값(0~10)을 조임 범위와 흐림 반경(작업 해상도 화소)으로. */
export function edgeParams(soft, longSide) {
  const s = Math.max(0, Math.min(10, soft));
  const half = 0.08 + 0.03 * s;                 // 0 → 0.42~0.58, 10 → 0.12~0.88
  const feather = s === 0 ? 0 : Math.max(1, Math.round((s * longSide) / 1500));
  return { lo: 0.5 - half, hi: 0.5 + half, feather };
}

/** 두 번 겹친 상자 흐림(가우스에 가까움)으로 가장자리를 풀어 준다. */
export function feather(m, w, h, r) {
  if (!r) return m;
  return boxBlur(boxBlur(m, w, h, r), w, h, r);
}

/** 여러 마스크 합치기(화소마다 큰 값). 사물 여러 개를 차례로 눌렀을 때. */
export function unionMax(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
  return out;
}

/** 사람 모델(selfie multiclass)의 배경 확률 → 남길 부분 확률. 0번 분류가 배경이다. */
export function foregroundFromBackground(bg) {
  const out = new Float32Array(bg.length);
  for (let i = 0; i < bg.length; i++) out[i] = clamp01(1 - bg[i]);
  return out;
}

/**
 * 붓질 한 점. edit 는 -1(지우기)~+1(복원) 값의 층. (cx,cy) 둘레 radius 안을 value 쪽으로 끌어당긴다.
 * hardness(0~1) 는 붓 가운데 꽉 찬 부분의 비율. 바뀐 화소 수를 돌려준다.
 */
export function paintDab(edit, w, h, cx, cy, radius, value, hardness = 0.6) {
  const r = Math.max(0.5, radius), inner = r * hardness;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  let changed = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const f = d <= inner ? 1 : 1 - (d - inner) / (r - inner);
      const i = y * w + x, e = edit[i];
      const next = e + (value - e) * f;
      if (next !== e) { edit[i] = next; changed++; }
    }
  }
  return changed;
}

/** 두 점 사이를 반경의 1/3 간격으로 붓질해 선이 끊기지 않게 한다. */
export function paintLine(edit, w, h, x0, y0, x1, y1, radius, value, hardness) {
  const dist = Math.hypot(x1 - x0, y1 - y0), step = Math.max(1, radius / 3);
  const n = Math.max(1, Math.ceil(dist / step));
  let changed = 0;
  for (let k = 1; k <= n; k++) changed += paintDab(edit, w, h, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, radius, value, hardness);
  return changed;
}

/** 붓질 층을 마스크에 반영. +e 는 1 쪽으로, -e 는 0 쪽으로 그만큼 끌어당긴다. */
export function applyEdit(m, edit) {
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) {
    const e = edit[i], v = m[i];
    out[i] = e > 0 ? v + (1 - v) * e : e < 0 ? v * (1 + e) : v;
  }
  return out;
}

/**
 * 원본의 (rx,ry,rw,rh) 영역(원본 화소 단위, 소수 가능)을 dw×dh 로 양선형 보간해 옮긴다.
 * 작은 마스크를 큰 저장 해상도로 늘릴 때 쓴다. Out 은 Float32Array 나 Uint8ClampedArray(0~255 로 곱해 넣음).
 */
export function resampleRegion(src, sw, sh, rx, ry, rw, rh, dw, dh, Out = Float32Array) {
  const out = new Out(dw * dh), k = Out === Float32Array ? 1 : 255;
  const sx = rw / dw, sy = rh / dh;
  for (let y = 0; y < dh; y++) {
    let fy = ry + (y + 0.5) * sy - 0.5;
    fy = fy < 0 ? 0 : fy > sh - 1 ? sh - 1 : fy;
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      let fx = rx + (x + 0.5) * sx - 0.5;
      fx = fx < 0 ? 0 : fx > sw - 1 ? sw - 1 : fx;
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * k;
    }
  }
  return out;
}

/** 값이 thr 이상인 화소를 모두 담는 가장 작은 사각형 {x0,y0,x1,y1}(x1·y1 은 포함하지 않음). 없으면 null. */
export function maskBounds(m, w, h, thr = 0.5) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      if (m[o + x] >= thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** 마스크에서 남는 부분의 비율(0~1). 모델이 아무것도 못 찾았는지 알 때. */
export function coverage(m, thr = 0.5) {
  let c = 0;
  for (let i = 0; i < m.length; i++) if (m[i] >= thr) c++;
  return m.length ? c / m.length : 0;
}

/**
 * 가로/세로 = ratio 인 자르기 사각형. 사진 안에 들어가는 가장 큰 사각형을 zoom 배 줄이고,
 * 인물(box)이 있으면 가로는 인물 가운데, 세로는 인물 머리 위로 topMargin(자르기 높이 비율)만큼 여백을 둔다.
 * box 가 없으면 사진 가운데. 결과는 사진 안으로 밀어 넣은 정수 좌표.
 */
export function cropForRatio(imgW, imgH, ratio, box = null, zoom = 1, topMargin = 0.08) {
  if (!ratio) return { x: 0, y: 0, w: imgW, h: imgH };
  let w, h;
  if (imgW / imgH > ratio) { h = imgH; w = h * ratio; } else { w = imgW; h = w / ratio; }
  const z = Math.max(1, zoom);
  w /= z; h /= z;
  let cx = imgW / 2, top = (imgH - h) / 2;
  if (box) {
    cx = (box.x0 + box.x1) / 2;
    top = box.y0 - topMargin * h;
  }
  let x = cx - w / 2, y = top;
  x = Math.max(0, Math.min(imgW - w, x));
  y = Math.max(0, Math.min(imgH - h, y));
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  return { x: Math.min(Math.round(x), imgW - W), y: Math.min(Math.round(y), imgH - H), w: W, h: H };
}

/** 저장 크기: 자른 영역을 긴 변 max 이하로. */
export function outputSize(crop, max = MAX_OUT) {
  return fitSize(crop.w, crop.h, max);
}

/**
 * 가장자리 색 번짐 줄이기용 '앞쪽 색' 추정. 반경 r 안에서 알파로 가중한 평균색 = 흐림(색×α)/흐림(α).
 * 반투명 가장자리 화소에 배경색이 섞여 보이는 것을 안쪽 색으로 바꿔 줄 때 쓴다. RGBA(A=255) 로 돌려준다.
 */
export function foregroundColor(rgba, alpha, w, h, r) {
  const n = w * h, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const a2 = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = alpha[i] * alpha[i]; // 안쪽(α≈1) 화소에 더 무게를 둔다
    a2[i] = a;
    ch[0][i] = rgba[j] * a; ch[1][i] = rgba[j + 1] * a; ch[2][i] = rgba[j + 2] * a;
  }
  const wa = boxBlur(a2, w, h, r), out = new Uint8ClampedArray(n * 4);
  const bl = ch.map((c) => boxBlur(c, w, h, r));
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (wa[i] > 1e-4) {
      out[j] = bl[0][i] / wa[i]; out[j + 1] = bl[1][i] / wa[i]; out[j + 2] = bl[2][i] / wa[i];
    } else { out[j] = rgba[j]; out[j + 1] = rgba[j + 1]; out[j + 2] = rgba[j + 2]; }
    out[j + 3] = 255;
  }
  return out;
}

/**
 * 합성(제자리에서 rgba 를 바꾼다). alpha 는 0~255 Uint8 또는 0~1 Float32(scale 로 구분).
 * bg 가 null 이면 투명 PNG 용: 알파 채널만 바꾼다. bg 가 [r,g,b] 면 그 색 위에 얹어 불투명하게.
 * fg(같은 크기 RGBA)가 있으면 반투명 가장자리의 색을 α 만큼 원래 색, 나머지는 fg 색으로 섞는다.
 */
export function composite(rgba, alpha, bg = null, fg = null, scale = alpha instanceof Float32Array ? 1 : 1 / 255) {
  const n = rgba.length >> 2;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = Math.min(1, Math.max(0, alpha[i] * scale)) * (rgba[j + 3] / 255);
    if (fg && a < 1 && a > 0) {
      rgba[j] = rgba[j] * a + fg[j] * (1 - a);
      rgba[j + 1] = rgba[j + 1] * a + fg[j + 1] * (1 - a);
      rgba[j + 2] = rgba[j + 2] * a + fg[j + 2] * (1 - a);
    }
    if (bg) {
      rgba[j] = rgba[j] * a + bg[0] * (1 - a);
      rgba[j + 1] = rgba[j + 1] * a + bg[1] * (1 - a);
      rgba[j + 2] = rgba[j + 2] * a + bg[2] * (1 - a);
      rgba[j + 3] = 255;
    } else {
      rgba[j + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 파일이 HEIC/HEIF 인지(형식 이름이나 확장자로). 브라우저가 못 여는 경우 안내용. */
export function isHeic(type = '', name = '') {
  return /hei[cf]/i.test(type) || /\.(heic|heif)$/i.test(name);
}

/** 아직 받지 않은 파일의 합계(바이트). parts: [{bytes, cached}] */
export function pendingBytes(parts) {
  return parts.reduce((s, p) => s + (p.cached ? 0 : p.bytes), 0);
}
