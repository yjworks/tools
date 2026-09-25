import { describe, it, expect } from 'vitest';
import { legalCap, depositToRent, rentToDeposit, impliedRate, BASE_RATE } from '../src/_shared/rent-conversion.js';

// 주택임대차보호법 제7조의2·시행령 제9조: min(연 10%, 기준금리 + 연 2%)
// 기준금리 3.00% (한국은행 금융통화위원회 2026-08-27 결정)
describe('전월세 전환', () => {
  it('기준금리 상수', () => expect(BASE_RATE.rate).toBe(3.0));
  it('법정 상한 = min(10, 기준금리+2)', () => {
    expect(legalCap()).toBe(5);
    expect(legalCap(2.5)).toBe(4.5);
    expect(legalCap(9)).toBe(10);
  });
  it('보증금 1억 → 월세 (연 5%)', () => expect(depositToRent(100_000_000, 5)).toBe(416_667));
  it('보증금 5천만 → 월세 (연 4.5%)', () => expect(depositToRent(50_000_000, 4.5)).toBe(187_500));
  it('월세 50만 → 보증금 (연 5%)', () => expect(rentToDeposit(500_000, 5)).toBe(120_000_000));
  it('전환율 0이면 계산 안 함', () => expect(rentToDeposit(500_000, 0)).toBe(null));
  it('제안 조건 전환율 역산', () => {
    expect(impliedRate(50_000_000, 250_000)).toBeCloseTo(6, 10);
    expect(impliedRate(0, 250_000)).toBe(null);
  });
  it('왕복', () => expect(rentToDeposit(depositToRent(120_000_000, 5), 5)).toBe(120_000_000));
});
