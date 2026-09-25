import { describe, it, expect } from 'vitest';
import { LAYOUTS, layoutsFor, cellRects, coverCrop } from '../src/_shared/photo-collage.js';

describe('배치', () => {
  it('2~9장 모두 배치가 있고, 칸 수 = 사진 수', () => {
    for (let n = 2; n <= 9; n++) expect(layoutsFor(n).length).toBeGreaterThan(0);
    for (const l of LAYOUTS) {
      expect(l.make(1080, 1080).cells).toHaveLength(l.n);
      expect(l.make(1080, 1350).cells).toHaveLength(l.n);
    }
  });
  it('2장 가로, 간격 20: 바깥·가운데 간격이 같다', () => {
    const r = cellRects(LAYOUTS.find((l) => l.id === '2h').make(), 1080, 1080, 20);
    expect(r).toEqual([{ x: 20, y: 20, w: 510, h: 1040 }, { x: 550, y: 20, w: 510, h: 1040 }]);
  });
  it('큰 사진 1 + 2: 큰 칸은 세로 두 칸 + 간격', () => {
    const r = cellRects(LAYOUTS.find((l) => l.id === '3big').make(), 1000, 1000, 10);
    expect(r[0]).toEqual({ x: 10, y: 10, w: 485, h: 980 });
    expect(r[1]).toEqual({ x: 505, y: 10, w: 485, h: 485 });
    expect(r[2]).toEqual({ x: 505, y: 505, w: 485, h: 485 });
  });
  it('간격 0 이면 칸 넓이 합 = 전체 넓이 (겹침·빈틈 없음)', () => {
    for (const l of LAYOUTS) {
      for (const [W, H] of [[1080, 1080], [1080, 1350], [1920, 1080]]) {
        const rs = cellRects(l.make(W, H), W, H, 0);
        expect(rs.reduce((s, r) => s + r.w * r.h, 0)).toBe(W * H);
      }
    }
  });
  it('6장은 가로 출력이면 3×2, 세로 출력이면 2×3', () => {
    const six = LAYOUTS.find((l) => l.id === '6');
    expect(six.make(1920, 1080)).toMatchObject({ cols: 3, rows: 2 });
    expect(six.make(1080, 1350)).toMatchObject({ cols: 2, rows: 3 });
  });
  it('간격이 너무 넓으면 오류', () => expect(() => cellRects(LAYOUTS[0].make(), 100, 100, 60)).toThrow());
});

describe('꽉 채우기 자르기', () => {
  it('가로 사진을 정사각 칸에: 양옆을 자른다', () => expect(coverCrop(4000, 3000, 500, 500)).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 3000 }));
  it('세로 사진을 가로 칸에: 위아래를 자른다', () => {
    const c = coverCrop(3000, 4000, 1920, 1080);
    expect(c.sw).toBe(3000);
    expect(c.sh).toBeCloseTo(1687.5, 5);
    expect(c.sy).toBeCloseTo((4000 - 1687.5) / 2, 5);
  });
});
