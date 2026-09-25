import { describe, it, expect } from 'vitest';
import { M2_PER_PYEONG, METER_PER_JA, m2ToPyeong, pyeongToM2, parseNum, round, sizeTable } from '../src/_shared/pyeong-converter.js';

describe('평 ↔ ㎡', () => {
  it('정의: 6자 × 6자', () => expect((6 * METER_PER_JA) ** 2).toBeCloseTo(M2_PER_PYEONG, 12));
  it('1평', () => { expect(pyeongToM2(1)).toBeCloseTo(3.305785, 6); expect(round(pyeongToM2(1), 4)).toBe('3.3058'); });
  it('121평 = 400㎡', () => { expect(pyeongToM2(121)).toBe(400); expect(m2ToPyeong(400)).toBe(121); });
  it('많이 쓰는 면적', () => {
    expect(round(m2ToPyeong(84), 2)).toBe('25.41');
    expect(round(m2ToPyeong(59), 2)).toBe('17.85');
    expect(round(m2ToPyeong(33), 2)).toBe('9.98');
    expect(round(pyeongToM2(32), 2)).toBe('105.79');
  });
  it('왕복', () => expect(m2ToPyeong(pyeongToM2(24.5))).toBeCloseTo(24.5, 10));
  it('입력 해석', () => {
    expect(parseNum('84')).toBe(84); expect(parseNum('84.5㎡')).toBe(84.5); expect(parseNum('1,234')).toBe(1234);
    expect(parseNum('25평')).toBe(25); expect(parseNum('.5')).toBe(0.5); expect(parseNum('abc')).toBe(null); expect(parseNum('')).toBe(null);
  });
  it('공급면적 추정표', () => {
    const [row] = sizeTable([84], 0.75);
    expect(row.supplyM2).toBeCloseTo(112, 10); expect(round(row.supplyPyeong, 1)).toBe('33.9');
    expect(sizeTable([84], 0)[0].supplyM2).toBeUndefined();
  });
});
