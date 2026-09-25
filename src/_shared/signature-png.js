/* 서명 → 투명 PNG 의 계산 부분.
   - 종이 사진: 밝기(선택: 그림자 보정)를 기준으로 종이는 투명, 잉크는 불투명하게 알파를 만든다.
   - 여백 자르기: 알파가 남은 영역의 경계 상자.
   - 손글씨 선: 입력 점들의 중점을 잇는 2차 곡선으로 부드럽게 그린다. */

/** RGBA 의 밝기(0~255) */
export function luminance(rgba, n = rgba.length / 4) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29 + 128) >> 8;
  return g;
}

/** 그림자 보정: 화소 밝기를 주변(반지름 r) 평균으로 나눠 종이가 어디서나 흰색(255) 가까이 되게 한다. */
export function flattenLight(gray, w, h, r = 0) {
  r = r || Math.max(8, Math.round(Math.max(w, h) / 25));
  // 가로·세로 누적합으로 상자 평균(적분 영상)
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      // 평균에는 잉크도 조금 섞이므로 1.1 배 여유를 준다(종이 = 평균보다 약간 밝다)
      const v = mean > 0 ? (gray[y * w + x] / (mean * 1.1)) * 255 : 255;
      out[y * w + x] = v > 255 ? 255 : v;
    }
  }
  return out;
}

/** 밝기 → 알파. threshold 보다 밝으면 투명, threshold-soft 보다 어두우면 불투명, 사이는 직선으로. */
export function alphaFor(v, threshold, soft = 24) {
  if (v >= threshold) return 0;
  if (v <= threshold - soft) return 255;
  return Math.round(((threshold - v) / soft) * 255);
}

/** 배경 지우기. gray: 판정용 밝기, rgba: 원본 색. ink: null 이면 원래 색, [r,g,b] 면 그 색으로 칠한다. */
export function removeBackground(rgba, gray, { threshold = 170, soft = 24, ink = null } = {}) {
  const n = gray.length, out = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = alphaFor(gray[i], threshold, soft);
    if (!a) continue;
    if (ink) { out[j] = ink[0]; out[j + 1] = ink[1]; out[j + 2] = ink[2]; }
    else { out[j] = rgba[j]; out[j + 1] = rgba[j + 1]; out[j + 2] = rgba[j + 2]; }
    out[j + 3] = a;
  }
  return out;
}

/** 알파가 minAlpha 이상인 화소의 경계 상자 {x, y, w, h}. 아무것도 없으면 null. pad 만큼 넓히되 영상 밖으로 나가지 않는다. */
export function trimBounds(rgba, w, h, { minAlpha = 16, pad = 0 } = {}) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] >= minAlpha) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 알파 영역을 잘라 새 RGBA 로 */
export function crop(rgba, w, box) {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const s = ((box.y + y) * w + box.x) * 4;
    out.set(rgba.subarray(s, s + box.w * 4), y * box.w * 4);
  }
  return out;
}

/** 오츠 임계값(자동 값 제안용) */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = gray.length - wB; if (!wF) break;
    sumB += t * hist[t];
    const d = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (d > best) { best = d; th = t; }
  }
  return th;
}

/** 손글씨 선을 곡선 조각으로 바꾼다. 점이 [p0..pn] 이면 중점을 잇는 2차 베지어 목록.
    반환: {start:[x,y], segs:[[cx,cy,x,y], ...]} — 캔버스 moveTo/quadraticCurveTo 에 그대로 쓴다. */
export function smoothPath(points) {
  if (!points.length) return { start: null, segs: [] };
  if (points.length < 3) return { start: points[0], segs: points.slice(1).map((p) => [p[0], p[1], p[0], p[1]]) };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const segs = [];
  for (let i = 1; i < points.length - 1; i++) {
    const m = mid(points[i], points[i + 1]);
    segs.push([points[i][0], points[i][1], m[0], m[1]]);
  }
  const last = points[points.length - 1];
  segs.push([last[0], last[1], last[0], last[1]]);
  return { start: points[0], segs };
}

/** 너무 촘촘한 입력 점(minDist 미만)을 건너뛴다. 곡선이 떨리지 않게 한다. */
export function addPoint(points, p, minDist = 1.5) {
  const last = points[points.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minDist) return false;
  points.push(p);
  return true;
}

/** '#1a2b3c' → [26, 43, 60] */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
