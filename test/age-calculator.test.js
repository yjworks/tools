import { describe, it, expect } from 'vitest';
import { calcAge, parseDate, fmt } from '../src/_shared/age-calculator.js';

const a = (b, r) => calcAge(parseDate(b), parseDate(r));

describe('만 나이', () => {
  it('생일 하루 전', () => { const x = a('2000-09-26', '2026-09-25'); expect(x.man).toBe(25); expect(x.yeon).toBe(26); expect(x.counting).toBe(27); expect(x.daysToNext).toBe(1); expect(fmt(x.nextBirthday)).toBe('2026-09-26'); });
  it('생일 당일', () => { const x = a('2000-09-25', '2026-09-25'); expect(x.man).toBe(26); expect(x.todayIsBirthday).toBe(true); expect(fmt(x.nextBirthday)).toBe('2027-09-25'); expect(x.daysToNext).toBe(365); });
  it('생일 지난 뒤', () => { const x = a('1990-01-15', '2026-09-25'); expect(x.man).toBe(36); expect(x.yeon).toBe(36); expect(x.counting).toBe(37); });
  it('12월 31일생 다음 날', () => { const x = a('2025-12-31', '2026-01-01'); expect(x.man).toBe(0); expect(x.yeon).toBe(1); expect(x.counting).toBe(2); expect(x.daysLived).toBe(1); });
  it('태어난 날', () => { const x = a('2026-09-25', '2026-09-25'); expect(x.man).toBe(0); expect(x.daysLived).toBe(0); expect(x.dayCount).toBe(1); expect(x.todayIsBirthday).toBe(false); expect(x.daysToNext).toBe(365); });
  it('2월 29일생', () => {
    expect(a('2004-02-29', '2025-02-28').man).toBe(20);
    expect(a('2004-02-29', '2025-03-01').man).toBe(21);
    expect(a('2004-02-29', '2028-02-28').man).toBe(23);
    expect(a('2004-02-29', '2028-02-29').man).toBe(24);
    expect(fmt(a('2004-02-29', '2025-01-10').nextBirthday)).toBe('2025-03-01');
    expect(fmt(a('2004-02-29', '2027-06-01').nextBirthday)).toBe('2028-02-29');
  });
  it('100일', () => { const x = a('2026-01-01', '2026-04-10'); expect(x.daysLived).toBe(99); expect(x.dayCount).toBe(100); });
  it('개월 수', () => {
    expect(a('2026-01-31', '2026-02-28').months).toBe(1);
    expect(a('2026-01-31', '2026-02-27').months).toBe(0);
    expect(a('2026-03-15', '2026-09-14').months).toBe(5);
    expect(a('2026-03-15', '2026-09-15').months).toBe(6);
  });
  it('기준일이 생일보다 앞', () => expect(a('2026-09-26', '2026-09-25')).toBe(null));
  it('날짜 해석', () => { expect(parseDate('2025-02-30')).toBe(null); expect(parseDate('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 }); expect(parseDate('abc')).toBe(null); });
});
