import { describe, it, expect } from 'vitest';
import { cropToRatio, gridTiles, postOrder, tileName } from '../src/_shared/insta-grid.js';

describe('비율 맞춰 자르기', () => {
  it('가로로 긴 사진을 정사각형으로: 가운데', () => expect(cropToRatio(4000, 3000, 1)).toEqual({ x: 500, y: 0, w: 3000, h: 3000 }));
  it('세로로 긴 사진을 3:1 로', () => expect(cropToRatio(3000, 4000, 3)).toEqual({ x: 0, y: 1500, w: 3000, h: 1000 }));
  it('비율 없음 = 그대로', () => expect(cropToRatio(123, 456, 0)).toEqual({ x: 0, y: 0, w: 123, h: 456 }));
  it('위쪽 남기기', () => expect(cropToRatio(3000, 4000, 1, 0.5, 0).y).toBe(0));
});

describe('조각', () => {
  it('3×3 정사각 조각은 전체가 정사각형', () => {
    const { area, tiles } = gridTiles(4000, 3000, { cols: 3, rows: 3, tileRatio: 1 });
    expect(area).toEqual({ x: 500, y: 0, w: 3000, h: 3000 });
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toMatchObject({ row: 1, col: 1, x: 500, y: 0, w: 1000, h: 1000, outW: 1000, outH: 1000 });
    expect(tiles[8]).toMatchObject({ row: 3, col: 3, x: 2500, y: 2000, w: 1000, h: 1000 });
  });
  it('4:5 조각 3×2 → 전체 비율 12:10', () => {
    const { area, tiles } = gridTiles(3600, 3600, { cols: 3, rows: 2, tileRatio: 4 / 5 });
    expect(area.w / area.h).toBeCloseTo(1.2, 2);
    expect(tiles[0].outW / tiles[0].outH).toBeCloseTo(0.8, 2);
    expect(tiles[0].outW).toBe(1080);
  });
  it('조각은 빈틈·겹침 없이 영역을 덮는다', () => {
    const { area, tiles } = gridTiles(1001, 997, { cols: 3, rows: 3, tileRatio: 0 });
    expect(tiles.reduce((s, t) => s + t.w * t.h, 0)).toBe(area.w * area.h);
  });
  it('올리는 순서: 오른쪽 아래가 1번, 왼쪽 위가 마지막', () => {
    expect(postOrder(2, 2, 3, 3)).toBe(1);
    expect(postOrder(0, 0, 3, 3)).toBe(9);
    expect(postOrder(0, 2, 3, 1)).toBe(1);
    const { tiles } = gridTiles(900, 300, { cols: 3, rows: 1 });
    expect(tiles.map((t) => t.order)).toEqual([3, 2, 1]);
  });
  it('파일 이름', () => expect(tileName({ order: 1, row: 3, col: 3 })).toBe('01_3행3열.jpg'));
});
