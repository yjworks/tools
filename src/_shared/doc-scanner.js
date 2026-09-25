/* 문서 스캐너의 계산 부분. 화면(DOM)과 떨어진 순수 함수만 둔다.
   - 호모그래피(원근 변환): 네 점 대응으로 8×8 연립방정식을 풀어 3×3 행렬을 구한다.
   - 원근 펴기: 결과 화소마다 역변환으로 원본 위치를 찾아 쌍선형 보간으로 색을 읽는다.
   - 흑백: 적분 영상으로 주변 평균을 구하는 적응형 임계값(Bradley 방식).
   - 모서리 자동 찾기: 오츠 임계값 → 가장 큰 밝은 덩어리 → 네 꼭짓점. */

/** 가우스 소거(부분 피벗)로 A x = b 를 푼다. A 는 n×n 배열의 배열. 특이 행렬이면 null. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** src 네 점을 dst 네 점으로 보내는 호모그래피 H (길이 9, 행 우선, H[8]=1). 점은 [x, y]. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

/** 점 하나에 H 를 적용한다. */
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 네 점 [좌상, 우상, 우하, 좌하] 로 결과 크기를 정한다. 긴 변은 maxSide 를 넘지 않는다.
    aspect(가로/세로)를 주면 그 비율에 맞춘다(예: A4 세로 210/297). */
export function outputSize(quad, { maxSide = 3000, aspect = 0 } = {}) {
  const [tl, tr, br, bl] = quad;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  if (aspect > 0) {
    // 넓이는 비슷하게 유지하면서 비율만 맞춘다
    const area = w * h;
    h = Math.sqrt(area / aspect); w = h * aspect;
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** 원근 펴기. src = {data: RGBA, width, height}, quad = 원본 위 네 점 [좌상, 우상, 우하, 좌하].
    결과 크기 outW×outH 의 RGBA(Uint8ClampedArray)를 돌려준다. */
export function warpPerspective(src, quad, outW, outH) {
  // 결과 사각형 → 원본 사각형 방향의 H 를 구하면, 결과 화소마다 원본 위치를 바로 계산할 수 있다(역방향 매핑).
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  if (!H) throw new Error('네 점이 한 줄에 있어 펼 수 없습니다');
  const { data, width: sw, height: sh } = src;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const maxX = sw - 1, maxY = sh - 1;
  let o = 0;
  for (let y = 0; y < outH; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const cx = x + 0.5;
      const w = H[6] * cx + H[7] * cy + H[8];
      let sx = (H[0] * cx + H[1] * cy + H[2]) / w - 0.5;
      let sy = (H[3] * cx + H[4] * cy + H[5]) / w - 0.5;
      if (sx < 0) sx = 0; else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0; else if (sy > maxY) sy = maxY;
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
      out[o + 1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
      out[o + 2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return out;
}

/** RGBA → 밝기(0~255) 한 채널. BT.601 가중치. */
export function toGray(rgba, n = rgba.length / 4) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29 + 128) >> 8;
  return g;
}

/** 적분 영상: I[(y)*(w+1)+x] = (0,0)~(x-1,y-1) 합. */
export function integralImage(gray, w, h) {
  const big = w * h * 255 > 4e9;
  const I = big ? new Float64Array((w + 1) * (h + 1)) : new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const base = (y + 1) * (w + 1), prev = y * (w + 1), gi = y * w;
    for (let x = 0; x < w; x++) {
      row += gray[gi + x];
      I[base + x + 1] = I[prev + x + 1] + row;
    }
  }
  return I;
}

/** 적분 영상에서 사각형 [x0,x1)×[y0,y1) 합 */
export function boxSum(I, w, x0, y0, x1, y1) {
  const W = w + 1;
  return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
}

/** 적응형 임계값. 화소가 주변 (2r+1)² 평균보다 t% 이상 어두우면 검정(0), 아니면 흰색(255). */
export function adaptiveThreshold(gray, w, h, { radius = 0, t = 15 } = {}) {
  const r = radius || Math.max(4, Math.round(Math.min(w, h) / 40));
  const I = integralImage(gray, w, h);
  const out = new Uint8Array(w * h);
  const k = (100 - t) / 100;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum = boxSum(I, w, x0, y0, x1, y1);
      out[y * w + x] = gray[y * w + x] * count < sum * k ? 0 : 255;
    }
  }
  return out;
}

/** 오츠 임계값: 두 무리(배경·문서) 사이 분산이 가장 큰 밝기 */
export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

/** 볼록 사각형인지(네 꼭짓점이 같은 방향으로 돈다) */
export function isConvexQuad(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** 사각형 넓이(신발끈 공식) */
export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/** 안쪽으로 들어간 기본 사각형 */
export function insetQuad(w, h, f = 0.08) {
  const dx = w * f, dy = h * f;
  return [[dx, dy], [w - dx, dy], [w - dx, h - dy], [dx, h - dy]];
}

/** 작은 밝기 영상(gray, w×h)에서 문서로 보이는 네 꼭짓점을 찾는다. 못 찾으면 null.
    배경보다 밝은 종이를 가정한다: 오츠로 나눈 밝은 영역 중 가장 큰 덩어리의 극점을 꼭짓점으로 쓴다. */
export function detectQuad(gray, w, h) {
  const th = otsu(gray);
  const n = w * h;
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  let bestLabel = 0, bestSize = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] || gray[s] <= th) continue;
    cur++;
    let top = 0, size = 0;
    stack[top++] = s; label[s] = cur;
    while (top) {
      const p = stack[--top]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && !label[p - 1] && gray[p - 1] > th) { label[p - 1] = cur; stack[top++] = p - 1; }
      if (x < w - 1 && !label[p + 1] && gray[p + 1] > th) { label[p + 1] = cur; stack[top++] = p + 1; }
      if (y > 0 && !label[p - w] && gray[p - w] > th) { label[p - w] = cur; stack[top++] = p - w; }
      if (y < h - 1 && !label[p + w] && gray[p + w] > th) { label[p + w] = cur; stack[top++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = cur; }
  }
  if (!bestLabel || bestSize < n * 0.12 || bestSize > n * 0.97) return null;
  // 극점: x+y 가 가장 작은 곳 = 좌상, x-y 가 가장 큰 곳 = 우상, x+y 최대 = 우하, y-x 최대 = 좌하
  let tl, tr, br, bl, mTl = Infinity, mTr = -Infinity, mBr = -Infinity, mBl = -Infinity;
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % w, y = (p - x) / w;
    if (x + y < mTl) { mTl = x + y; tl = [x, y]; }
    if (x - y > mTr) { mTr = x - y; tr = [x + 1, y]; }
    if (x + y > mBr) { mBr = x + y; br = [x + 1, y + 1]; }
    if (y - x > mBl) { mBl = y - x; bl = [x, y + 1]; }
  }
  const q = [tl, tr, br, bl];
  if (!isConvexQuad(q) || quadArea(q) < n * 0.1) return null;
  return q;
}

/** 꼭짓점 순서를 한 칸 돌린다(결과를 시계 방향 90° 회전) */
export function rotateQuad(q) { return [q[3], q[0], q[1], q[2]]; }
