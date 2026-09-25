/* 전월세 전환 계산 (주택임대차보호법 제7조의2, 같은 법 시행령 제9조).
 *
 * 법 제7조의2: 보증금의 전부 또는 일부를 월 단위 차임으로 전환하는 경우, 전환되는 금액에
 *   다음 중 낮은 비율을 곱한 월차임을 넘을 수 없다.
 *   1. 은행법에 따른 은행에서 적용하는 대출금리와 해당 지역의 경제 여건 등을 고려하여 대통령령으로 정하는 비율 → 시행령 제9조제1항: 연 1할(10%)
 *   2. 한국은행에서 공시한 기준금리에 대통령령으로 정하는 이율을 더한 비율 → 시행령 제9조제2항: 연 2%
 *   시행령 출처: https://www.law.go.kr/법령/주택임대차보호법시행령 (대통령령 제35161호, 2025-03-01 시행판에서 확인)
 *
 * ── 해마다(수시로) 바뀌는 값 ────────────────────────────────────────
 * 한국은행 기준금리: 연 3.00% — 2026-08-27 금융통화위원회 결정(2.75% → 3.00%). 기준일 2026-09-25.
 *   출처: https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643
 */
export const BASE_RATE = { rate: 3.0, decided: '2026-08-27', checked: '2026-09-25', source: 'https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643' };
export const LEGAL_CAP_FIXED = 10; // 시행령 제9조제1항: 연 1할
export const LEGAL_ADD = 2;        // 시행령 제9조제2항: 기준금리 + 연 2%

/** 법정 상한 전환율(연 %) = min(10, 기준금리 + 2) */
export function legalCap(baseRate = BASE_RATE.rate) {
  return Math.min(LEGAL_CAP_FIXED, +baseRate + LEGAL_ADD);
}

/** 보증금 → 월세: 전환하는 보증금(원)과 연 전환율(%)로 늘어나는 월세(원, 원 단위 반올림) */
export function depositToRent(amount, ratePct) {
  return Math.round((+amount || 0) * (+ratePct || 0) / 100 / 12);
}

/** 월세 → 보증금: 줄이는 월세(원)만큼 올려야 하는 보증금(원) */
export function rentToDeposit(monthly, ratePct) {
  const r = +ratePct || 0;
  if (r <= 0) return null;
  return Math.round((+monthly || 0) * 12 / (r / 100));
}

/** 제안받은 조건의 전환율 역산: 보증금 차액과 월세 차액 → 연 % */
export function impliedRate(depositDiff, rentDiff) {
  const d = +depositDiff || 0;
  if (d <= 0) return null;
  return (+rentDiff || 0) * 12 / d * 100;
}
