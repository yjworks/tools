import { describe, it, expect } from 'vitest';
import { weeklyHolidayPay, MIN_WAGE, WEEKS_PER_MONTH } from '../src/_shared/weekly-holiday-pay.js';

// 2026 최저임금 10,320원: 고용노동부 고시 (https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144)
// 주휴 산식: (1주 소정근로시간 ÷ 40) × 8 × 시급, 15시간 미만 제외 (근로기준법 제18조제3항·제55조)
describe('주휴수당', () => {
  it('최저임금 상수', () => expect(MIN_WAGE).toMatchObject({ year: 2026, hourly: 10320 }));
  it('주 40시간 → 8시간분', () => {
    const r = weeklyHolidayPay(10320, 40);
    expect(r.holidayHours).toBe(8);
    expect(r.weekly).toBe(82_560);
  });
  it('주 20시간 → 4시간분', () => expect(weeklyHolidayPay(10320, 20).weekly).toBe(41_280));
  it('주 15시간 → 3시간분', () => expect(weeklyHolidayPay(12000, 15).weekly).toBe(36_000));
  it('주 14시간이면 없음', () => { const r = weeklyHolidayPay(10320, 14); expect(r.eligible).toBe(false); expect(r.weekly).toBe(0); });
  it('40시간 넘어도 8시간 상한', () => expect(weeklyHolidayPay(10320, 52).holidayHours).toBe(8));
  it('월 환산 209시간 (= 48 × 365/7/12 반올림)', () => {
    expect(WEEKS_PER_MONTH).toBeCloseTo(4.345, 3);
    expect(Math.round(weeklyHolidayPay(10320, 40).monthlyHours)).toBe(209);
    expect(10320 * 209).toBe(2_156_880); // 고용노동부 발표 월 환산액
  });
  it('최저임금 미달 경고', () => { expect(weeklyHolidayPay(10000, 20).belowMin).toBe(true); expect(weeklyHolidayPay(10320, 20).belowMin).toBe(false); });
});
