import { describe, it, expect } from 'vitest';
import {
  solveLinear, homography, applyH, outputSize, warpPerspective, toGray, integralImage, boxSum,
  adaptiveThreshold, otsu, detectQuad, isConvexQuad, quadArea, insetQuad, rotateQuad,
} from '../src/_shared/doc-scanner.js';

const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('연립방정식', () => {
  it('3×3 해', () => {
    const x = solveLinear([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
    [2, 3, -1].forEach((v, i) => close(x[i], v));
  });
  it('특이 행렬은 null', () => expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBe(null));
});

describe('호모그래피', () => {
  it('단위 정사각형 → 같은 정사각형은 항등 행렬', () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const H = homography(sq, sq);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => close(H[i], v));
  });
  it('단위 정사각형 → 2배 확대 + 이동', () => {
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[10, 20], [12, 20], [12, 22], [10, 22]]);
    const [u, v] = applyH(H, 0.5, 0.5);
    close(u, 11); close(v, 21);
  });
  it('사다리꼴: 네 꼭짓점이 정확히 대응하고, 중심은 대각선 교점으로 간다', () => {
    const quad = [[100, 50], [300, 80], [320, 400], [60, 380]];
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => {
      const [u, v] = applyH(H, x, y);
      close(u, quad[i][0], 1e-6); close(v, quad[i][1], 1e-6);
    });
    // 원근 변환은 직선을 직선으로 보내므로 사각형 중심(대각선 교점)은 사다리꼴의 대각선 교점으로 간다
    const [p, q, r, s] = quad;
    const d1 = [r[0] - p[0], r[1] - p[1]], d2 = [s[0] - q[0], s[1] - q[1]];
    const t = ((q[0] - p[0]) * d2[1] - (q[1] - p[1]) * d2[0]) / (d1[0] * d2[1] - d1[1] * d2[0]);
    const [u, v] = applyH(H, 0.5, 0.5);
    close(u, p[0] + t * d1[0], 1e-6); close(v, p[1] + t * d1[1], 1e-6);
  });
  it('역방향 H 를 합성하면 원래 점으로 돌아온다', () => {
    const a = [[0, 0], [400, 0], [400, 300], [0, 300]], b = [[12, 30], [390, 5], [410, 310], [-5, 280]];
    const H = homography(a, b), Hi = homography(b, a);
    const [u, v] = applyH(H, 123, 77);
    const [x, y] = applyH(Hi, u, v);
    close(x, 123, 1e-6); close(y, 77, 1e-6);
  });
});

describe('원근 펴기', () => {
  it('크기 계산: 긴 변 제한·A4 비율', () => {
    expect(outputSize([[0, 0], [200, 0], [200, 100], [0, 100]])).toEqual({ width: 200, height: 100 });
    expect(outputSize([[0, 0], [6000, 0], [6000, 3000], [0, 3000]], { maxSide: 3000 })).toEqual({ width: 3000, height: 1500 });
    const a4 = outputSize([[0, 0], [210, 0], [210, 297], [0, 297]], { aspect: 210 / 297 });
    close(a4.width / a4.height, 210 / 297, 0.01);
  });
  it('축 정렬 사각형을 그대로 펴면 원본 일부를 그대로 복사한다', () => {
    const w = 8, h = 6, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = i; data[i * 4 + 1] = 255 - i; data[i * 4 + 2] = (i * 7) % 256; data[i * 4 + 3] = 255; }
    const out = warpPerspective({ data, width: w, height: h }, [[2, 1], [6, 1], [6, 5], [2, 5]], 4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const s = ((y + 1) * w + (x + 2)) * 4, d = (y * 4 + x) * 4;
      expect([out[d], out[d + 1], out[d + 2], out[d + 3]]).toEqual([data[s], data[s + 1], data[s + 2], 255]);
    }
  });
  it('쌍선형 보간: 두 화소 사이 절반 위치는 평균값', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
    // 원본 2×1 을 가로 1칸으로 줄이면 가운데(x=1.0 → 화소 중심 기준 0.5)를 읽는다
    const out = warpPerspective({ data, width: 2, height: 1 }, [[0, 0], [2, 0], [2, 1], [0, 1]], 1, 1);
    expect(out[0]).toBe(100);
  });
});

describe('흑백 변환', () => {
  it('밝기', () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]))]).toEqual([255, 0, 77]);
  });
  it('적분 영상 합', () => {
    const g = Uint8Array.from([1, 2, 3, 4, 5, 6]); // 3×2
    const I = integralImage(g, 3, 2);
    expect(boxSum(I, 3, 0, 0, 3, 2)).toBe(21);
    expect(boxSum(I, 3, 1, 0, 3, 2)).toBe(2 + 3 + 5 + 6);
    expect(boxSum(I, 3, 1, 1, 2, 2)).toBe(5);
  });
  it('그림자가 진 종이에서도 글자만 검게', () => {
    // 왼쪽은 밝고(220) 오른쪽은 그늘진(120) 종이. 양쪽에 글자(각각 배경의 절반 밝기) 한 점씩.
    const w = 40, h = 20, g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 20 ? 220 : 120;
    g[10 * w + 8] = 110; g[10 * w + 30] = 60;
    const bw = adaptiveThreshold(g, w, h, { radius: 4, t: 15 });
    expect(bw[10 * w + 8]).toBe(0);
    expect(bw[10 * w + 30]).toBe(0);
    expect(bw[3 * w + 5]).toBe(255);   // 밝은 종이
    expect(bw[3 * w + 35]).toBe(255);  // 그늘진 종이도 흰색
    // 전역 임계값(오츠)은 그늘진 종이 전체를 검게 만든다 — 적응형을 쓰는 이유
    expect(120 <= otsu(g)).toBe(true);
  });
  it('오츠 임계값은 두 무리 사이', () => {
    const g = new Uint8Array(100);
    g.fill(40, 0, 50); g.fill(200, 50);
    const t = otsu(g);
    expect(t >= 40 && t < 200).toBe(true);
  });
});

describe('모서리 찾기', () => {
  it('어두운 배경 위 기울어진 흰 종이', () => {
    const w = 120, h = 160, g = new Uint8Array(w * h).fill(50);
    const quad = [[20, 15], [100, 25], [95, 145], [15, 135]];
    // 볼록 사각형 안쪽 판정으로 종이를 그린다
    const inside = (x, y) => {
      for (let i = 0; i < 4; i++) {
        const a = quad[i], b = quad[(i + 1) % 4];
        if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
      }
      return true;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) g[y * w + x] = 230;
    const q = detectQuad(g, w, h);
    expect(q).not.toBe(null);
    q.forEach((p, i) => { expect(Math.abs(p[0] - quad[i][0])).toBeLessThan(3); expect(Math.abs(p[1] - quad[i][1])).toBeLessThan(3); });
  });
  it('밋밋한 사진이면 null (기본 사각형을 쓴다)', () => {
    expect(detectQuad(new Uint8Array(100 * 100).fill(128), 100, 100)).toBe(null);
  });
  it('기본 사각형·볼록·넓이·회전', () => {
    const q = insetQuad(100, 200, 0.1);
    expect(q).toEqual([[10, 20], [90, 20], [90, 180], [10, 180]]);
    expect(isConvexQuad(q)).toBe(true);
    expect(isConvexQuad([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(false); // 꼬인 사각형
    expect(quadArea(q)).toBe(80 * 160);
    expect(rotateQuad(q)).toEqual([[10, 180], [10, 20], [90, 20], [90, 180]]);
  });
});
