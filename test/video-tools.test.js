import { describe, it, expect } from 'vitest';
import { clampSpeed, hasChanges, normRotation, outputDuration, outputSize, rotationMatrix, applyMatrix, frameTimes, frameName, uniqueNames } from '../src/_shared/video-tools.js';

describe('회전', () => {
  it('각도 정리', () => { expect(normRotation(-90)).toBe(270); expect(normRotation(450)).toBe(90); expect(normRotation('180')).toBe(180); });
  it('출력 크기: 90°면 가로세로가 바뀐다', () => {
    expect(outputSize(1920, 1080, 90)).toEqual({ sw: 1920, sh: 1080, W: 1080, H: 1920 });
    expect(outputSize(3840, 2160, 0)).toEqual({ sw: 1920, sh: 1080, W: 1920, H: 1080 });
    expect(outputSize(641, 361, 0)).toEqual({ sw: 642, sh: 362, W: 642, H: 362 });
  });
  it('행렬: 네 모서리가 캔버스 모서리로 간다', () => {
    const sw = 400, sh = 300;
    const corners = (rot) => [[0, 0], [sw, 0], [sw, sh], [0, sh]].map(([x, y]) => applyMatrix(rotationMatrix(rot, sw, sh), x, y));
    // 시계 방향 90°: 왼쪽 위 → 오른쪽 위
    expect(corners(90)).toEqual([[300, 0], [300, 400], [0, 400], [0, 0]]);
    expect(corners(180)).toEqual([[400, 300], [0, 300], [0, 0], [400, 0]]);
    expect(corners(270)).toEqual([[0, 400], [0, 0], [300, 0], [300, 400]]);
    expect(corners(0)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
  });
});

describe('속도', () => {
  it('범위와 길이', () => {
    expect(clampSpeed(3)).toBe(2); expect(clampSpeed(0.1)).toBe(0.5); expect(clampSpeed('x')).toBe(1);
    expect(outputDuration(60, 2)).toBe(30); expect(outputDuration(60, 0.5)).toBe(120);
  });
  it('바꿀 것이 있는지', () => {
    expect(hasChanges({})).toBe(false); expect(hasChanges({ speed: 1, rotation: 360 })).toBe(false);
    expect(hasChanges({ mute: true })).toBe(true); expect(hasChanges({ rotation: 90 })).toBe(true); expect(hasChanges({ speed: 1.5 })).toBe(true);
  });
});

describe('프레임 시각', () => {
  it('N초마다', () => {
    expect(frameTimes(10, 2).times).toEqual([0, 2, 4, 6, 8, 9.95]);
    expect(frameTimes(10, 3, { start: 1, end: 7 }).times).toEqual([1, 4, 7]);
    expect(frameTimes(5, 0.5).times.length).toBe(11);
  });
  it('최대 개수에서 멈춘다', () => {
    const r = frameTimes(1000, 1, { max: 300 });
    expect(r.times.length).toBe(300); expect(r.truncated).toBe(true);
  });
  it('잘못된 값', () => { expect(frameTimes(0, 1).times).toEqual([]); expect(frameTimes(10, 0).times).toEqual([]); });
  it('이름', () => {
    expect(frameName('clip', 0, 12.5, 'png')).toBe('clip-001-12.50s.png');
    expect(uniqueNames(['a.png', 'a.png', 'b.jpg', 'a.png'])).toEqual(['a.png', 'a-2.png', 'b.jpg', 'a-3.png']);
  });
});
