/* 연봉 실수령액 계산 (2026년 기준). 근로자 부담분만 계산한다.
 *
 * ── 해마다 바뀌는 값 (기준일 2026-09-25 확인) ─────────────────────────────
 * 국민연금 보험료율 9.5% (근로자 4.75%) — 2026-01-01부터. 연금개혁으로 2033년까지 매년 0.5%p 인상.
 *   출처: https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1488390&act=view (보건복지부 보도자료)
 * 국민연금 기준소득월액 하한 41만원 · 상한 659만원 — 2026-07-01 ~ 2027-06-30 적용
 *   (2025-07 ~ 2026-06 은 40만원 · 637만원)
 *   출처: https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&list_no=1484511&act=view (「국민연금 기준소득월액 하한액과 상한액」 고시)
 * 건강보험료율 7.19% (근로자 3.595%) — 2026-01-01부터
 * 장기요양보험료율 0.9448% (건강보험료 대비 13.14%) — 2026-01-01부터
 *   출처: https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1487817&mid=a10503000000 (보건복지부 보도자료)
 * 건강보험료 월 상한 9,183,480원(근로자 4,591,740원) · 하한 20,160원 — 2026년
 *   출처: https://www.law.go.kr/LSW//admRulInfoP.do?admRulSeq=2100000270472&chrClsCd=010201 (월별 건강보험료액의 상한과 하한에 관한 고시)
 * 고용보험(실업급여) 근로자 0.9% — 2026년 (2022-07부터 동일)
 *   출처: 고용보험법 시행령 제12조(실업급여 보험료율 1천분의 18, 근로자·사업주 절반씩)
 *   참고: 2027년 인상(각 0.1%p) 계획이 보도됐으나 2026년에는 0.9% 그대로다.
 * 비과세 식사대 월 20만원 — 소득세법 시행령 제17조의2 (2023-01-01 이후)
 *   출처: https://www.korea.kr/news/policyNewsView.do?newsId=148923639
 * 근로소득 간이세액표 자녀 공제(8세 이상 20세 이하 자녀) — 소득세법 시행령 별표2, 2026-02-27 개정, 2026-03-01 지급분부터
 *   1명 20,830원 · 2명 45,830원 · 3명 이상 45,830원 + 2명 초과 1명당 33,330원
 *   출처: https://www.law.go.kr/LSW/flDownload.do?flSeq=164357181&bylClsCd=110201
 */
export const RATES = {
  year: 2026,
  pension: { employee: 0.0475, min: 410_000, max: 6_590_000, period: '2026.7~2027.6' },
  health: { employee: 0.03595, total: 0.0719, maxEmployee: 4_591_740, minEmployee: 10_080 },
  care: { rate: 0.009448 }, // 건강보험료 × (0.9448 / 7.19)
  employment: { employee: 0.009 },
  mealTaxFree: 200_000,
  child: { one: 20_830, two: 45_830, perExtra: 33_330 },
};

/* 부동소수 오차(예: 3,000,000 × 0.009 = 26999.99…)를 없앤 뒤 10원 미만 절사 */
const f10 = (x) => Math.floor(Math.round(x * 1000) / 1000 / 10) * 10;

/* ── 소득세법 (연도별로 잘 바뀌지 않는 법정 산식) ───────────────────────────── */

/** 근로소득공제 (소득세법 제47조). 한도 2천만원 */
export function earnedIncomeDeduction(T) {
  let d;
  if (T <= 5e6) d = T * 0.7;
  else if (T <= 15e6) d = 3.5e6 + (T - 5e6) * 0.4;
  else if (T <= 45e6) d = 7.5e6 + (T - 15e6) * 0.15;
  else if (T <= 1e8) d = 12e6 + (T - 45e6) * 0.05;
  else d = 14.75e6 + (T - 1e8) * 0.02;
  return Math.min(d, 2e7);
}

/** 종합소득 기본세율 (소득세법 제55조, 2023년 이후) */
export function basicTax(x) {
  const B = [[14e6, 0.06, 0], [50e6, 0.15, 1.26e6], [88e6, 0.24, 5.76e6], [150e6, 0.35, 15.44e6],
    [300e6, 0.38, 19.94e6], [500e6, 0.40, 25.94e6], [1e9, 0.42, 35.94e6], [Infinity, 0.45, 65.94e6]];
  for (const [upto, r, d] of B) if (x <= upto) return Math.max(0, x * r - d);
  return 0;
}

/** 근로소득세액공제 (소득세법 제59조) — 한도 포함 */
export function earnedIncomeCredit(S, T) {
  const c = S <= 1.3e6 ? S * 0.55 : 715_000 + (S - 1.3e6) * 0.3;
  let lim;
  if (T <= 3.3e7) lim = 740_000;
  else if (T <= 7e7) lim = Math.max(660_000, 740_000 - (T - 3.3e7) * 0.008);
  else if (T <= 1.2e8) lim = Math.max(500_000, 660_000 - (T - 7e7) * 0.5);
  else lim = Math.max(200_000, 500_000 - (T - 1.2e8) * 0.5);
  return Math.min(c, lim);
}

/** 간이세액표의 '특별소득공제 및 특별세액공제 중 일부' 산식 (소득세법 시행령 별표2 비고). n = 공제대상가족 수 */
export function tableSpecialDeduction(T, n) {
  const over40 = Math.max(0, T - 4e7) * 0.04;
  if (n <= 1) {
    if (T <= 3e7) return 3.1e6 + T * 0.04;
    if (T <= 4.5e7) return 3.1e6 + T * 0.04 - (T - 3e7) * 0.05;
    if (T <= 7e7) return 3.1e6 + T * 0.015;
    return 3.1e6 + T * 0.005;
  }
  if (n === 2) {
    if (T <= 3e7) return 3.6e6 + T * 0.04;
    if (T <= 4.5e7) return 3.6e6 + T * 0.04 - (T - 3e7) * 0.05 + over40;
    if (T <= 7e7) return 3.6e6 + T * 0.02 + over40;
    return 3.6e6 + T * 0.01 + over40;
  }
  if (T <= 3e7) return 5e6 + T * 0.07;
  if (T <= 4.5e7) return 5e6 + T * 0.07 - (T - 3e7) * 0.05 + over40;
  if (T <= 7e7) return 5e6 + T * 0.05 + over40;
  return 5e6 + T * 0.03 + over40;
}

/** 월 국민연금 근로자 부담 (기준소득월액 천원 미만 절사 · 상하한 · 10원 미만 절사) */
export function pensionOf(M) {
  const base = Math.min(RATES.pension.max, Math.max(RATES.pension.min, Math.floor(M / 1000) * 1000));
  return f10(base * RATES.pension.employee);
}

/**
 * 간이세액표 방식의 월 소득세 '추정치' (자녀 공제 전). 월급여 1천만원까지 산식으로 계산하고,
 * 그 위는 별표2의 1천만원 초과 산식을 붙인다. 실제 간이세액표 금액과 다를 수 있다.
 */
export function estimateTableTax(M, n) {
  if (M <= 0) return 0;
  if (M > 10_000_000) {
    const base = estimateTableTax(10_000_000, n);
    const x = M;
    if (x <= 14e6) return f10(base + (x - 1e7) * 0.98 * 0.35 + 25_000);
    if (x <= 28e6) return f10(base + 1_397_000 + (x - 14e6) * 0.98 * 0.38);
    if (x <= 30e6) return f10(base + 6_610_600 + (x - 28e6) * 0.98 * 0.40);
    if (x <= 45e6) return f10(base + 7_394_600 + (x - 30e6) * 0.40);
    if (x <= 87e6) return f10(base + 13_394_600 + (x - 45e6) * 0.42);
    return f10(base + 31_034_600 + (x - 87e6) * 0.45);
  }
  const T = M * 12;
  const taxable = Math.max(0, T - earnedIncomeDeduction(T) - 1.5e6 * n - pensionOf(M) * 12 - tableSpecialDeduction(T, n));
  const S = basicTax(taxable);
  const decided = Math.max(0, S - earnedIncomeCredit(S, T));
  return f10(decided / 12);
}

/** 8세 이상 20세 이하 자녀 수별 공제액 (별표2, 2026-03-01 지급분부터) */
export function childDeduction(k) {
  const c = RATES.child;
  if (k <= 0) return 0;
  if (k === 1) return c.one;
  return c.two + (k - 2) * c.perExtra;
}

/**
 * @param {object} p
 * @param {number} p.annual       연봉(세전, 원)
 * @param {number} [p.meal]       월 식대(원). 20만원까지 비과세
 * @param {number} [p.family]     공제대상가족 수(본인 포함, 1~11)
 * @param {number} [p.children]   그중 8세 이상 20세 이하 자녀 수
 * @param {number} [p.ratio]      원천징수 비율 80·100·120 (%)
 * @param {number|null} [p.taxOverride] 간이세액표에서 직접 찾은 월 소득세(자녀 공제 반영 후, 100% 기준)
 */
export function salaryNet(p) {
  const monthlyGross = Math.max(0, +p.annual || 0) / 12;
  const taxFree = Math.min(Math.max(0, +p.meal || 0), RATES.mealTaxFree, monthlyGross);
  const M = monthlyGross - taxFree; // 과세 대상 월급여 = 4대보험 보수월액으로도 쓴다
  const n = Math.min(11, Math.max(1, Math.floor(+p.family || 1)));
  const kids = Math.min(n - 1, Math.max(0, Math.floor(+p.children || 0)));
  const ratio = [80, 100, 120].includes(+p.ratio) ? +p.ratio : 100;

  const pension = M > 0 ? pensionOf(M) : 0;
  const health = M > 0 ? Math.min(RATES.health.maxEmployee, Math.max(RATES.health.minEmployee, f10(M * RATES.health.employee))) : 0;
  const care = f10(health * RATES.care.rate / RATES.health.total);
  const employment = f10(M * RATES.employment.employee);

  const overridden = p.taxOverride != null && p.taxOverride !== '' && Number.isFinite(+p.taxOverride);
  const tableTax = estimateTableTax(M, n);
  const afterChild = Math.max(0, tableTax - childDeduction(kids));
  const base100 = overridden ? Math.max(0, +p.taxOverride) : afterChild;
  const incomeTax = f10(base100 * ratio / 100);
  const localTax = f10(incomeTax * 0.1);

  const deductions = pension + health + care + employment + incomeTax + localTax;
  const net = Math.floor(monthlyGross - deductions);
  return {
    monthlyGross: Math.floor(monthlyGross), taxFree, taxable: Math.floor(M), family: n, children: kids, ratio,
    pension, health, care, employment, tableTax, childDed: childDeduction(kids), incomeTax, localTax,
    estimated: !overridden, deductions, net, annualNet: net * 12,
  };
}
