/* 퇴직금 계산 (근로자퇴직급여 보장법 제8조, 근로기준법 제2조 평균임금).
 * 해마다 바뀌는 값은 없다. 법 조항 기준일: 2026-09-25 확인.
 *  - 퇴직금 = 1일 평균임금 × 30 × (재직일수 ÷ 365)
 *  - 1일 평균임금 = 퇴직일 이전 3개월 임금총액 ÷ 그 기간의 총 일수 (근로기준법 제2조제1항제6호)
 *  - 평균임금이 통상임금보다 적으면 통상임금을 평균임금으로 한다 (근로기준법 제2조제2항)
 *  - 계속근로기간 1년 미만이면 퇴직금 지급 의무가 없다 (근로자퇴직급여 보장법 제4조제1항 단서)
 * 출처: https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=999&ccfNo=3&cciNo=2&cnpClsNo=1 (찾기쉬운 생활법령정보 · 퇴직금 지급)
 */

const DAY = 86400000;

/** 'YYYY-MM-DD' → UTC 자정 Date. 잘못된 값이면 null */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return null;
  return d;
}

const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY);

/** 달 단위로 빼기. 없는 날(예: 5/31 → 2/31)은 그 달 말일로 맞춘다. */
export function minusMonths(d, n) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() - n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

export const fmtDate = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} p
 * @param {string} p.start       입사일 (YYYY-MM-DD)
 * @param {string} p.lastDay     마지막 근무일 (YYYY-MM-DD). 퇴직일은 그다음 날이다.
 * @param {number} p.wage3m      퇴직 전 3개월 임금총액(세전, 원)
 * @param {number} [p.bonusYear] 퇴직 전 1년간 받은 상여금 총액 → 3/12 을 더한다
 * @param {number} [p.leaveYear] 퇴직 전 1년간 받은 연차수당 → 3/12 을 더한다
 * @param {number} [p.ordinaryDaily] 1일 통상임금(선택)
 */
export function severance(p) {
  const start = parseDate(p.start), last = parseDate(p.lastDay);
  if (!start || !last) return { error: '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.' };
  const retire = addDays(last, 1); // 퇴직일 = 마지막 근무일의 다음 날
  if (retire <= start) return { error: '마지막 근무일이 입사일보다 앞설 수 없습니다.' };

  const serviceDays = diffDays(start, retire); // 입사일부터 마지막 근무일까지 (양 끝 포함)
  const oneYear = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  const eligible = retire >= oneYear;

  const periodStart = minusMonths(retire, 3);
  const periodDays = diffDays(periodStart, retire); // 89~92일

  const wage3m = Math.max(0, +p.wage3m || 0);
  const bonusPart = Math.max(0, +p.bonusYear || 0) * 3 / 12;
  const leavePart = Math.max(0, +p.leaveYear || 0) * 3 / 12;
  const total3m = wage3m + bonusPart + leavePart;
  const avgDaily = total3m / periodDays;
  const ordinaryDaily = Math.max(0, +p.ordinaryDaily || 0);
  const usedOrdinary = ordinaryDaily > avgDaily;
  const daily = usedOrdinary ? ordinaryDaily : avgDaily;
  const pay = Math.floor(daily * 30 * serviceDays / 365);

  return {
    retireDate: fmtDate(retire), serviceDays, eligible,
    periodStart: fmtDate(periodStart), periodEnd: fmtDate(last), periodDays,
    bonusPart, leavePart, total3m, avgDaily, usedOrdinary, daily, pay,
  };
}
