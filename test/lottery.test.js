import { describe, it, expect } from 'vitest';
import { parseNames, parsePrizes, buildSlots, createDraw, drawAll, resultsText, distinctCount } from '../src/_shared/lottery.js';

describe('제비뽑기', () => {
  it('참가자·경품 읽기', () => {
    expect(parseNames('철수\n영희,민수\n\n')).toEqual(['철수', '영희', '민수']);
    expect(parsePrizes('1등 상품권\n커피 쿠폰 x3\n치킨 2개\n간식*2\n아이폰15\nx3')).toEqual([
      { name: '1등 상품권', count: 1 }, { name: '커피 쿠폰', count: 3 }, { name: '치킨', count: 2 },
      { name: '간식', count: 2 }, { name: '아이폰15', count: 1 }, { name: 'x3', count: 1 },
    ]);
  });
  it('뽑을 자리', () => {
    expect(buildSlots([{ name: 'A', count: 2 }, { name: 'B', count: 1 }], 9)).toEqual(['A', 'A', 'B']);
    expect(buildSlots([], 3)).toEqual([null, null, null]);
  });
  it('중복 없이 뽑기: 같은 사람이 두 번 나오지 않는다', () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    for (let k = 0; k < 100; k++) {
      const r = drawAll(names, buildSlots([], 5));
      expect(r.map((x) => x.name).sort()).toEqual(names);
    }
  });
  it('같은 이름을 두 번 적어도 중복 금지면 한 번만 당첨', () => {
    for (let k = 0; k < 50; k++) {
      const r = drawAll(['a', 'a', 'b'], [null, null]);
      expect(r.map((x) => x.name).sort()).toEqual(['a', 'b']);
    }
    expect(distinctCount(['a', 'a', 'b'])).toBe(2);
    expect(() => drawAll(['a', 'a', 'b'], [null, null, null])).toThrow(/많습니다/);
  });
  it('중복 허용이면 자리가 사람보다 많아도 된다', () => {
    const r = drawAll(['a', 'b'], [null, null, null, null, null], { allowDuplicate: true });
    expect(r).toHaveLength(5);
    for (const x of r) expect(['a', 'b']).toContain(x.name);
  });
  it('경품 순서대로 자리 배정', () => {
    const seq = [2, 0, 0];
    const rnd = () => seq.shift();
    const r = drawAll(['a', 'b', 'c'], ['1등', '2등', '3등'], {}, rnd);
    expect(r).toEqual([{ prize: '1등', name: 'c' }, { prize: '2등', name: 'a' }, { prize: '3등', name: 'b' }]);
  });
  it('한 명씩 뽑기: 남은 인원이 줄고 다 뽑으면 null', () => {
    const d = createDraw(['a', 'b', 'c']);
    expect(d.remaining).toBe(3);
    const got = [d.next(), d.next(), d.next()];
    expect(got.sort()).toEqual(['a', 'b', 'c']);
    expect(d.remaining).toBe(0);
    expect(d.next()).toBe(null);
  });
  it('대략 고른 확률 (카이제곱 대신 느슨한 범위)', () => {
    const cnt = { a: 0, b: 0, c: 0, d: 0 };
    for (let k = 0; k < 8000; k++) cnt[createDraw(['a', 'b', 'c', 'd']).next()]++;
    for (const v of Object.values(cnt)) { expect(v).toBeGreaterThan(1700); expect(v).toBeLessThan(2300); }
  });
  it('빈 입력 오류', () => {
    expect(() => drawAll([], [null])).toThrow();
    expect(() => drawAll(['a'], [])).toThrow();
  });
  it('복사용 글', () => {
    const t = resultsText([{ prize: '1등', name: '철수' }, { prize: null, name: '영희' }], new Date(2026, 8, 25, 9, 5));
    expect(t).toBe('추첨 결과 (2026-09-25 09:05)\n1. 1등 — 철수\n2. 영희');
  });
});
