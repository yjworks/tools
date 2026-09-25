/* 주휴수당 계산 (근로기준법 제55조·제18조제3항, 시행령 제30조).
 *
 * ── 해마다 바뀌는 값 ──────────────────────────────────────────────
 * 2026년 적용 최저임금: 시간급 10,320원 (2026-01-01 ~ 2026-12-31)
 *   고용노동부 2025-08-05 확정 고시. 기준일 2026-09-25 확인.
 *   출처: https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144
 */
export const MIN_WAGE = { year: 2026, hourly: 10320, source: 'https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144' };

/* 한 달 평균 주 수: 365일 ÷ 7일 ÷ 12개월 = 4.345… (월 209시간 = (40+8)×4.345 를 반올림한 값) */
export const WEEKS_PER_MONTH = 365 / 7 / 12;

export const MIN_WEEKLY_HOURS = 15; // 4주 평균 1주 소정근로시간 15시간 미만이면 주휴 없음 (근로기준법 제18조제3항)
export const FULL_WEEK = 40;        // 법정 1주 근로시간 (근로기준법 제50조)

/**
 * @param {number} hourly 시급(원)
 * @param {number} weeklyHours 1주 소정근로시간
 */
export function weeklyHolidayPay(hourly, weeklyHours) {
  const w = Math.max(0, +weeklyHours || 0), hr = Math.max(0, +hourly || 0);
  const eligible = w >= MIN_WEEKLY_HOURS;
  const holidayHours = eligible ? Math.min(w, FULL_WEEK) / FULL_WEEK * 8 : 0;
  const weekly = Math.round(holidayHours * hr);
  const weeklyWork = Math.round(w * hr);
  return {
    eligible, holidayHours, weekly, weeklyWork,
    monthly: Math.round(holidayHours * hr * WEEKS_PER_MONTH),
    monthlyTotal: Math.round((w + holidayHours) * hr * WEEKS_PER_MONTH),
    monthlyHours: (w + holidayHours) * WEEKS_PER_MONTH,
    belowMin: hr > 0 && hr < MIN_WAGE.hourly,
  };
}
