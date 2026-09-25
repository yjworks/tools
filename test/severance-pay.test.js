import { describe, it, expect } from 'vitest';
import { severance, minusMonths, parseDate, fmtDate } from '../src/_shared/severance-pay.js';

// 기준: 근로자퇴직급여 보장법 제8조, 근로기준법 제2조. 기대값은 법정 산식으로 손계산한 값.
describe('퇴직금', () => {
  it('5년 근무 · 상여금·연차수당 3/12 산입', () => {
    const r = severance({ start: '2021-01-01', lastDay: '2025-12-31', wage3m: 9_000_000, bonusYear: 4_000_000, leaveYear: 800_000 });
    expect(r.retireDate).toBe('2026-01-01');
    expect(r.serviceDays).toBe(1826); // 365×5 + 윤일(2024-02-29)
    expect(r.periodStart).toBe('2025-10-01');
    expect(r.periodDays).toBe(92);
    expect(r.total3m).toBe(10_200_000); // 900만 + 400만×3/12 + 80만×3/12
    expect(r.avgDaily).toBeCloseTo(10_200_000 / 92, 6);
    expect(r.pay).toBe(Math.floor(10_200_000 / 92 * 30 * 1826 / 365)); // 16,639,547원
    expect(r.pay).toBe(16_639_547);
    expect(r.eligible).toBe(true);
  });
  it('딱 1년: 마지막 근무일이 입사 1년 뒤 전날이면 대상', () => {
    const r = severance({ start: '2025-03-01', lastDay: '2026-02-28', wage3m: 7_500_000 });
    expect(r.eligible).toBe(true);
    expect(r.serviceDays).toBe(365);
    expect(r.periodDays).toBe(90); // 퇴직일 3/1 기준 2025-12-01 ~ 2026-02-28 (31+31+28)
  });
  it('1년 미만이면 지급 의무 없음', () => {
    const r = severance({ start: '2025-03-01', lastDay: '2026-02-27', wage3m: 7_500_000 });
    expect(r.eligible).toBe(false);
  });
  it('통상임금이 평균임금보다 높으면 통상임금 사용', () => {
    const r = severance({ start: '2020-01-01', lastDay: '2025-12-31', wage3m: 6_000_000, ordinaryDaily: 80_000 });
    expect(r.avgDaily).toBeCloseTo(6_000_000 / 92, 6);
    expect(r.usedOrdinary).toBe(true);
    expect(r.pay).toBe(Math.floor(80_000 * 30 * r.serviceDays / 365));
  });
  it('3개월 기간: 없는 날은 말일로', () => {
    expect(fmtDate(minusMonths(parseDate('2026-05-31'), 3))).toBe('2026-02-28');
    expect(fmtDate(minusMonths(parseDate('2026-01-15'), 3))).toBe('2025-10-15');
  });
  it('잘못된 입력', () => {
    expect(severance({ start: '2026-13-01', lastDay: '2026-01-01' }).error).toBeTruthy();
    expect(severance({ start: '2026-02-01', lastDay: '2026-01-01' }).error).toBeTruthy();
  });
});
