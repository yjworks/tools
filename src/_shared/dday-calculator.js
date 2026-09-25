/* D-day·날짜 계산·영업일 계산.
 *
 * 공휴일 목록 기준일: 2026-09-25
 * - 관공서의 공휴일에 관한 규정에 따른 공휴일(일요일 제외 날짜만 의미 있음), 대체공휴일, 선거일, 임시공휴일.
 * - 2025년: 우주항공청 「2025년 월력요항」(2024-06 발표) + 1월 27일 임시공휴일(2025-01-14 국무회의 의결)
 *           + 6월 3일 제21대 대통령선거 임시공휴일(2025-04-08 국무회의).
 * - 2026년: 우주항공청 「2026년 월력요항」(2025-06 발표, 6월 3일 제9회 전국동시지방선거 포함)
 *           + 노동절(5월 1일, 2026-05-01 시행) + 제헌절(7월 17일, 관공서 공휴일 규정 2026-05-11 시행).
 *           9월 28일은 임시공휴일로 지정되지 않았다.
 * - 2027년: 우주항공청 「2027년 월력요항」(2026-06-29 발표. 노동절·제헌절 포함).
 * 이후에 새로 지정되는 임시공휴일·선거일은 빠져 있을 수 있다. 해가 바뀌면 이 목록에 다음 해를 더한다.
 */
export const HOLIDAYS = [
  // 2025
  ['2025-01-01', '신정'],
  ['2025-01-27', '임시공휴일'],
  ['2025-01-28', '설날 연휴'], ['2025-01-29', '설날'], ['2025-01-30', '설날 연휴'],
  ['2025-03-01', '3·1절'], ['2025-03-03', '대체공휴일(3·1절)'],
  ['2025-05-05', '어린이날·부처님오신날'], ['2025-05-06', '대체공휴일'],
  ['2025-06-03', '제21대 대통령선거'],
  ['2025-06-06', '현충일'],
  ['2025-08-15', '광복절'],
  ['2025-10-03', '개천절'],
  ['2025-10-05', '추석 연휴'], ['2025-10-06', '추석'], ['2025-10-07', '추석 연휴'], ['2025-10-08', '대체공휴일(추석)'],
  ['2025-10-09', '한글날'],
  ['2025-12-25', '성탄절'],
  // 2026
  ['2026-01-01', '신정'],
  ['2026-02-16', '설날 연휴'], ['2026-02-17', '설날'], ['2026-02-18', '설날 연휴'],
  ['2026-03-01', '3·1절'], ['2026-03-02', '대체공휴일(3·1절)'],
  ['2026-05-01', '노동절'],
  ['2026-05-05', '어린이날'],
  ['2026-05-24', '부처님오신날'], ['2026-05-25', '대체공휴일(부처님오신날)'],
  ['2026-06-03', '제9회 전국동시지방선거'],
  ['2026-06-06', '현충일'],
  ['2026-07-17', '제헌절'],
  ['2026-08-15', '광복절'], ['2026-08-17', '대체공휴일(광복절)'],
  ['2026-09-24', '추석 연휴'], ['2026-09-25', '추석'], ['2026-09-26', '추석 연휴'],
  ['2026-10-03', '개천절'], ['2026-10-05', '대체공휴일(개천절)'],
  ['2026-10-09', '한글날'],
  ['2026-12-25', '성탄절'],
  // 2027
  ['2027-01-01', '신정'],
  ['2027-02-06', '설날 연휴'], ['2027-02-07', '설날'], ['2027-02-08', '설날 연휴'], ['2027-02-09', '대체공휴일(설날)'],
  ['2027-03-01', '3·1절'],
  ['2027-05-01', '노동절'], ['2027-05-03', '대체공휴일(노동절)'],
  ['2027-05-05', '어린이날'],
  ['2027-05-13', '부처님오신날'],
  ['2027-06-06', '현충일'],
  ['2027-07-17', '제헌절'], ['2027-07-19', '대체공휴일(제헌절)'],
  ['2027-08-15', '광복절'], ['2027-08-16', '대체공휴일(광복절)'],
  ['2027-09-14', '추석 연휴'], ['2027-09-15', '추석'], ['2027-09-16', '추석 연휴'],
  ['2027-10-03', '개천절'], ['2027-10-04', '대체공휴일(개천절)'],
  ['2027-10-09', '한글날'], ['2027-10-11', '대체공휴일(한글날)'],
  ['2027-12-25', '성탄절'], ['2027-12-27', '대체공휴일(성탄절)'],
];

/** 공휴일 목록이 들어 있는 해 */
export const COVERED_YEARS = [2025, 2026, 2027];

const DAY = 86400000;
const holidayMap = new Map(HOLIDAYS.map(([d, n]) => [d, n]));

/** 'YYYY-MM-DD' → 일 번호(1970-01-01 = 0). 잘못된 날짜면 null */
export function toDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / DAY);
}

export function fromDay(n) {
  const dt = new Date(n * DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (n) => new Date(n * DAY).getUTCDay();
export const weekdayName = (n) => WEEK[weekday(n)];
export const yearOf = (n) => new Date(n * DAY).getUTCFullYear();

export const holidayName = (n) => holidayMap.get(fromDay(n)) || null;
export const isWeekend = (n) => { const w = weekday(n); return w === 0 || w === 6; };
export const isBusinessDay = (n) => !isWeekend(n) && !holidayMap.has(fromDay(n));

/** A→B 일수. inclusive 면 시작일을 1일로 센다(기념일 방식). */
export function daysBetween(a, b, inclusive = false) {
  const diff = b - a;
  if (!inclusive) return diff;
  return diff >= 0 ? diff + 1 : diff - 1;
}

/** 날짜 + N일. inclusive 면 시작일을 1일째로 본다(100일 = 시작일 + 99). */
export function addDays(a, n, inclusive = false) {
  if (!inclusive || n === 0) return a + n;
  return n > 0 ? a + n - 1 : a + n + 1;
}

/** a~b(양 끝 포함) 사이 영업일 수와 빠진 공휴일 목록. a > b 면 서로 바꾼다. */
export function businessDaysBetween(a, b) {
  if (a > b) [a, b] = [b, a];
  let count = 0, weekends = 0;
  const holidays = [];
  for (let n = a; n <= b; n++) {
    if (isWeekend(n)) { weekends++; continue; }
    const h = holidayName(n);
    if (h) holidays.push([fromDay(n), h]);
    else count++;
  }
  return { count, total: b - a + 1, weekends, holidays };
}

/** 시작일에서 N영업일 뒤(음수면 앞). 시작일 자체는 세지 않는다. */
export function addBusinessDays(a, n) {
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n), d = a;
  while (left > 0) {
    d += step;
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** 범위(양 끝 포함)가 공휴일 목록이 없는 해에 걸치는지 */
export function outsideCoverage(a, b) {
  if (a > b) [a, b] = [b, a];
  const ys = [];
  for (let y = yearOf(a); y <= yearOf(b); y++) if (!COVERED_YEARS.includes(y)) ys.push(y);
  return ys;
}
