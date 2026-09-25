/* 평 ↔ ㎡ 변환.
 * 1자(곡척) = 10/33 m, 1평 = 6자 × 6자 = (20/11 m)² = 400/121 ㎡ ≈ 3.305785 ㎡.
 * 소수 오차를 줄이려고 곱셈·나눗셈을 400/121 그대로 쓴다. */

export const M2_PER_PYEONG = 400 / 121;
export const METER_PER_JA = 10 / 33;

export const m2ToPyeong = (m2) => (m2 * 121) / 400;
export const pyeongToM2 = (p) => (p * 400) / 121;

/** 숫자 문자열 해석('84.5', '1,234', '84㎡' 등). 못 읽으면 null */
export function parseNum(s) {
  const t = String(s ?? '').replace(/[,\s]/g, '').replace(/(㎡|m2|m²|평)$/i, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 소수 digits 자리로 반올림해 끝의 0을 뗀 문자열 */
export function round(n, digits = 2) {
  const f = 10 ** digits;
  const r = Math.round((n + Number.EPSILON) * f) / f;
  return r.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** 전용면적 ㎡ 목록 → [{m2, pyeong, supplyM2, supplyPyeong}] (전용률 ratio 는 0~1, 없으면 공급면적 생략) */
export function sizeTable(list, ratio) {
  return list.map((m2) => {
    const row = { m2, pyeong: m2ToPyeong(m2) };
    if (ratio > 0 && ratio <= 1) {
      row.supplyM2 = m2 / ratio;
      row.supplyPyeong = m2ToPyeong(m2 / ratio);
    }
    return row;
  });
}

export const COMMON_SIZES = [39, 49, 59, 74, 84, 99, 114, 135];
