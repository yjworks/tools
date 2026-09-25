/* 만 나이·연 나이·세는 나이 계산.
 * 만 나이: 민법 제158조·행정기본법 제7조의2 (2023-06-28 시행) — 출생일을 산입하여 만 나이로 계산하고 연수로 표시.
 * 날짜는 모두 UTC 자정 기준 '일 번호'로 다뤄 시간대·서머타임 영향을 받지 않게 한다. */

const DAY = 86400000;

/** 'YYYY-MM-DD' → {y, m, d} (잘못된 날짜면 null) */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export const dayNum = ({ y, m, d }) => Math.round(Date.UTC(y, m - 1, d) / DAY);
export function fromDayNum(n) {
  const dt = new Date(n * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const fmt = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** 해당 연도의 생일(나이가 바뀌는 날). 2월 29일생은 평년에 3월 1일로 본다. */
export function birthdayIn(birth, year) {
  if (birth.m === 2 && birth.d === 29 && !isLeap(year)) return { y: year, m: 3, d: 1 };
  return { y: year, m: birth.m, d: birth.d };
}

/**
 * @param {{y,m,d}} birth
 * @param {{y,m,d}} ref 기준일
 */
export function calcAge(birth, ref) {
  const b = dayNum(birth), r = dayNum(ref);
  if (r < b) return null;
  let man = ref.y - birth.y;
  if (dayNum(birthdayIn(birth, ref.y)) > r) man -= 1;
  const yeon = ref.y - birth.y;
  // 다음 생일: 올해 생일이 기준일보다 뒤면 올해, 아니면 내년. (생일 당일이면 D-day 0 이 아니라 '오늘 생일')
  let nb = birthdayIn(birth, ref.y);
  const todayIsBirthday = dayNum(nb) === r && r !== b;
  if (dayNum(nb) <= r) nb = birthdayIn(birth, ref.y + 1);
  // 만 나이의 개월 수(1세 미만 표시용): 기준일까지 채운 달 수
  let months = (ref.y - birth.y) * 12 + (ref.m - birth.m);
  if (ref.d < birth.d) {
    // 기준 달에 해당 일이 없으면(예: 1/31생, 2/28 기준) 그 달 말일에 한 달을 채운 것으로 본다
    const lastDay = new Date(Date.UTC(ref.y, ref.m, 0)).getUTCDate();
    if (!(ref.d === lastDay && birth.d > lastDay)) months -= 1;
  }
  return {
    man,
    yeon,
    counting: yeon + 1,
    months,
    daysLived: r - b,
    dayCount: r - b + 1,
    nextBirthday: nb,
    daysToNext: dayNum(nb) - r,
    nextAge: man + 1,
    todayIsBirthday,
  };
}
