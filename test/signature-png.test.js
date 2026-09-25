import { describe, it, expect } from 'vitest';
import {
  luminance, flattenLight, alphaFor, removeBackground, trimBounds, crop, otsuThreshold, smoothPath, addPoint, hexToRgb,
} from '../src/_shared/signature-png.js';

describe('배경 지우기', () => {
  it('밝기 → 알파', () => {
    expect(alphaFor(200, 170)).toBe(0);
    expect(alphaFor(170, 170)).toBe(0);
    expect(alphaFor(100, 170)).toBe(255);
    expect(alphaFor(146, 170, 24)).toBe(255);
    expect(alphaFor(158, 170, 24)).toBe(128);
  });
  it('종이는 투명, 잉크는 남기고 색을 바꿀 수 있다', () => {
    const rgba = new Uint8ClampedArray([250, 250, 245, 255, 20, 30, 120, 255]);
    const g = luminance(rgba);
    const keep = removeBackground(rgba, g, { threshold: 170 });
    expect([...keep]).toEqual([0, 0, 0, 0, 20, 30, 120, 255]);
    const black = removeBackground(rgba, g, { threshold: 170, ink: [0, 0, 0] });
    expect([...black.slice(4)]).toEqual([0, 0, 0, 255]);
  });
  it('그림자 보정: 어두운 쪽 종이도 흰색에 가깝게, 잉크는 어둡게', () => {
    const w = 60, h = 10, g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 30 ? 230 : 110;
    g[5 * w + 45] = 40; // 그늘진 쪽 잉크
    const f = flattenLight(g, w, h, 5);
    expect(f[2 * w + 50]).toBeGreaterThan(200);
    expect(f[2 * w + 10]).toBeGreaterThan(200);
    expect(f[5 * w + 45]).toBeLessThan(120);
    // 보정 없이 170 기준이면 그늘진 종이(110)가 전부 잉크로 남는다
    expect(alphaFor(g[2 * w + 50], 170)).toBe(255);
    expect(alphaFor(f[2 * w + 50], 170)).toBe(0);
  });
  it('오츠 자동 값', () => {
    const g = new Uint8Array(200); g.fill(30, 0, 20); g.fill(235, 20);
    const t = otsuThreshold(g);
    expect(t >= 30 && t < 235).toBe(true);
  });
});

describe('여백 자르기', () => {
  const w = 10, h = 8, rgba = new Uint8ClampedArray(w * h * 4);
  rgba[(2 * w + 3) * 4 + 3] = 255; rgba[(5 * w + 6) * 4 + 3] = 200; rgba[(7 * w + 9) * 4 + 3] = 5; // 마지막은 너무 옅어 무시
  it('경계 상자', () => expect(trimBounds(rgba, w, h)).toEqual({ x: 3, y: 2, w: 4, h: 4 }));
  it('여유 + 가장자리에서 멈춤', () => expect(trimBounds(rgba, w, h, { pad: 3 })).toEqual({ x: 0, y: 0, w: 10, h: 8 }));
  it('빈 그림은 null', () => expect(trimBounds(new Uint8ClampedArray(16), 2, 2)).toBe(null));
  it('잘라내기', () => {
    const c = crop(rgba, w, { x: 3, y: 2, w: 4, h: 4 });
    expect(c.length).toBe(4 * 4 * 4);
    expect(c[3]).toBe(255);                 // (3,2) → (0,0)
    expect(c[(3 * 4 + 3) * 4 + 3]).toBe(200); // (6,5) → (3,3)
  });
});

describe('손글씨 선', () => {
  it('중점을 잇는 곡선', () => {
    const p = smoothPath([[0, 0], [10, 0], [10, 10], [20, 10]]);
    expect(p.start).toEqual([0, 0]);
    expect(p.segs).toEqual([[10, 0, 10, 5], [10, 10, 15, 10], [20, 10, 20, 10]]);
  });
  it('점 하나·둘', () => {
    expect(smoothPath([[1, 1]]).segs).toEqual([]);
    expect(smoothPath([[1, 1], [4, 5]]).segs).toEqual([[4, 5, 4, 5]]);
  });
  it('촘촘한 점 건너뛰기', () => {
    const pts = [[0, 0]];
    expect(addPoint(pts, [0.5, 0.5])).toBe(false);
    expect(addPoint(pts, [3, 0])).toBe(true);
    expect(pts.length).toBe(2);
  });
  it('색 코드', () => { expect(hexToRgb('#1a2b3c')).toEqual([26, 43, 60]); expect(hexToRgb('red')).toBe(null); });
});
