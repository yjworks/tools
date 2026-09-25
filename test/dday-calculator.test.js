import { describe, it, expect } from 'vitest';
import {
  HOLIDAYS, COVERED_YEARS, toDay, fromDay, weekday, daysBetween, addDays, businessDaysBetween,
  addBusinessDays, isBusinessDay, holidayName, outsideCoverage,
} from '../src/_shared/dday-calculator.js';

const d = toDay;

describe('날짜 사이', () => {
  it('일수', () => { expect(daysBetween(d('2026-01-01'), d('2026-12-25'))).toBe(358); expect(daysBetween(d('2026-09-25'), d('2026-09-20'))).toBe(-5); });
  it('시작일 포함', () => { expect(daysBetween(d('2026-01-01'), d('2026-04-10'), true)).toBe(100); expect(daysBetween(d('2026-01-01'), d('2026-01-01'), true)).toBe(1); });
  it('윤년 넘기기', () => expect(daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2));
  it('N일 뒤', () => { expect(fromDay(addDays(d('2026-09-25'), 100))).toBe('2027-01-03'); expect(fromDay(addDays(d('2026-09-25'), -25))).toBe('2026-08-31'); });
  it('100일(시작일 1일째)', () => { expect(fromDay(addDays(d('2026-01-01'), 100, true))).toBe('2026-04-10'); expect(fromDay(addDays(d('2026-01-01'), 1, true))).toBe('2026-01-01'); });
  it('잘못된 날짜', () => { expect(toDay('2026-02-29')).toBe(null); expect(toDay('')).toBe(null); });
});

describe('영업일', () => {
  it('2026 추석 주간', () => {
    const r = businessDaysBetween(d('2026-09-21'), d('2026-09-30'));
    expect(r.count).toBe(6); expect(r.weekends).toBe(2); expect(r.total).toBe(10);
    expect(r.holidays.map((h) => h[0])).toEqual(['2026-09-24', '2026-09-25']);
  });
  it('순서 바뀌어도 같음', () => expect(businessDaysBetween(d('2026-09-30'), d('2026-09-21')).count).toBe(6));
  it('N영업일 뒤·앞', () => {
    expect(fromDay(addBusinessDays(d('2026-09-23'), 1))).toBe('2026-09-28');
    expect(fromDay(addBusinessDays(d('2026-09-28'), -1))).toBe('2026-09-23');
    expect(fromDay(addBusinessDays(d('2027-02-05'), 1))).toBe('2027-02-10');
    expect(fromDay(addBusinessDays(d('2025-01-24'), 1))).toBe('2025-01-31');
    expect(fromDay(addBusinessDays(d('2026-09-25'), 0))).toBe('2026-09-25');
  });
  it('연간 영업일', () => {
    expect(businessDaysBetween(d('2025-01-01'), d('2025-12-31')).count).toBe(244);
    expect(businessDaysBetween(d('2026-01-01'), d('2026-12-31')).count).toBe(245);
    expect(businessDaysBetween(d('2027-01-01'), d('2027-12-31')).count).toBe(246);
  });
  it('새 공휴일(노동절·제헌절)', () => {
    expect(isBusinessDay(d('2026-05-01'))).toBe(false); expect(isBusinessDay(d('2026-07-17'))).toBe(false);
    expect(isBusinessDay(d('2025-05-01'))).toBe(true); expect(isBusinessDay(d('2026-09-28'))).toBe(true);
    expect(holidayName(d('2026-06-03'))).toBe('제9회 전국동시지방선거');
  });
  it('범위 밖 연도', () => { expect(outsideCoverage(d('2024-12-31'), d('2025-01-02'))).toEqual([2024]); expect(outsideCoverage(d('2026-01-01'), d('2027-12-31'))).toEqual([]); });
});

describe('공휴일 목록 점검', () => {
  it('날짜가 올바르고 정렬·중복 없음', () => {
    const days = HOLIDAYS.map(([s]) => d(s));
    expect(days.every((n) => n !== null)).toBe(true);
    for (let i = 1; i < days.length; i++) expect(days[i]).toBeGreaterThan(days[i - 1]);
  });
  it('대체공휴일은 평일', () => {
    for (const [s, n] of HOLIDAYS) if (n.startsWith('대체')) expect([1, 2, 3, 4, 5]).toContain(weekday(d(s)));
  });
  it('요일 확인', () => {
    expect(weekday(d('2026-02-17'))).toBe(2); expect(weekday(d('2026-09-25'))).toBe(5);
    expect(weekday(d('2027-02-07'))).toBe(0); expect(weekday(d('2027-09-15'))).toBe(3); expect(weekday(d('2025-10-06'))).toBe(1);
  });
  it('연도 범위', () => { expect(COVERED_YEARS).toEqual([2025, 2026, 2027]); for (const [s] of HOLIDAYS) expect(COVERED_YEARS).toContain(+s.slice(0, 4)); });
  it('2027 실질 공휴일 72일(일요일 포함)', () => {
    let sundays = 0; for (let n = d('2027-01-01'); n <= d('2027-12-31'); n++) if (weekday(n) === 0) sundays++;
    const nonSunday = HOLIDAYS.filter(([s]) => s.startsWith('2027') && weekday(d(s)) !== 0).length;
    expect(sundays + nonSunday).toBe(72);
  });
});
