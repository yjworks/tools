import { describe, it, expect } from 'vitest';
import { salaryNet, earnedIncomeDeduction, basicTax, earnedIncomeCredit, tableSpecialDeduction, childDeduction, estimateTableTax, pensionOf, RATES } from '../src/_shared/salary-net.js';

// 공식 간이세액표 행(국세청·법제처 파일)은 작업 환경에서 내려받을 수 없어 대조하지 못했다.
// 그래서 소득세는 '추정치'로만 쓰고, 여기서는 법정 산식 부분을 국세청 예시·손계산 값으로 검증한다.
describe('법정 산식', () => {
  // 국세청 '근로소득금액' 안내 예시: 총급여 3,380만원 → 근로소득공제 1,032만원 = 750만 + (3,380만 − 1,500만) × 15%
  // https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=6592&cntntsId=7871
  it('근로소득공제 (국세청 예시)', () => expect(earnedIncomeDeduction(33_800_000)).toBeCloseTo(10_320_000, 3));
  it('근로소득공제 구간·한도', () => {
    expect(earnedIncomeDeduction(5_000_000)).toBeCloseTo(3_500_000, 3);
    expect(earnedIncomeDeduction(15_000_000)).toBeCloseTo(7_500_000, 3);
    expect(earnedIncomeDeduction(45_000_000)).toBeCloseTo(12_000_000, 3);
    expect(earnedIncomeDeduction(100_000_000)).toBeCloseTo(14_750_000, 3);
    expect(earnedIncomeDeduction(500_000_000)).toBe(20_000_000);
  });
  it('기본세율', () => {
    expect(basicTax(14_000_000)).toBeCloseTo(840_000, 3);
    expect(basicTax(50_000_000)).toBeCloseTo(6_240_000, 3);
    expect(basicTax(88_000_000)).toBeCloseTo(15_360_000, 3);
    expect(basicTax(150_000_000)).toBeCloseTo(37_060_000, 3);
  });
  it('근로소득세액공제·한도', () => {
    expect(earnedIncomeCredit(1_000_000, 30_000_000)).toBeCloseTo(550_000, 3);
    expect(earnedIncomeCredit(3_000_000, 30_000_000)).toBe(740_000);
    expect(earnedIncomeCredit(3_000_000, 50_000_000)).toBeCloseTo(660_000, 3);
    expect(earnedIncomeCredit(10_000_000, 150_000_000)).toBe(200_000); // 1.2억 초과: max(20만, 50만 − 초과분 × 1/2)
  });
  it('간이세액표 특별공제 산식', () => {
    expect(tableSpecialDeduction(24_000_000, 1)).toBeCloseTo(3_100_000 + 960_000, 3);
    expect(tableSpecialDeduction(24_000_000, 3)).toBeCloseTo(5_000_000 + 1_680_000, 3);
    expect(tableSpecialDeduction(60_000_000, 2)).toBeCloseTo(3_600_000 + 1_200_000 + 800_000, 3);
  });
  it('자녀 공제 (별표2 2026.3.1 지급분부터)', () => {
    expect(childDeduction(0)).toBe(0);
    expect(childDeduction(1)).toBe(20_830);
    expect(childDeduction(2)).toBe(45_830);
    expect(childDeduction(3)).toBe(79_160);
  });
});

describe('4대보험 (2026 요율)', () => {
  it('월 300만원 과세급여', () => {
    const r = salaryNet({ annual: 38_400_000, meal: 200_000, family: 1 }); // 월 320만 − 식대 20만
    expect(r.taxable).toBe(3_000_000);
    expect(r.pension).toBe(142_500);   // 300만 × 4.75%
    expect(r.health).toBe(107_850);    // 300만 × 3.595%
    expect(r.care).toBe(14_170);       // 107,850 × 0.9448/7.19 = 14,172 → 10원 미만 절사
    expect(r.employment).toBe(27_000); // 300만 × 0.9%
  });
  it('국민연금 상·하한 (2026.7~2027.6: 41만·659만)', () => {
    expect(RATES.pension).toMatchObject({ min: 410_000, max: 6_590_000 });
    expect(pensionOf(10_000_000)).toBe(313_020); // 659만 × 4.75%
    expect(pensionOf(300_000)).toBe(19_470);     // 41만 × 4.75%
  });
  it('식대는 20만원까지만 비과세', () => expect(salaryNet({ annual: 36_000_000, meal: 300_000 }).taxable).toBe(2_800_000));
});

describe('소득세 추정', () => {
  it('가족·자녀가 많을수록 세금이 줄거나 같다', () => {
    const a = salaryNet({ annual: 60_000_000, family: 1 }).incomeTax;
    const b = salaryNet({ annual: 60_000_000, family: 3 }).incomeTax;
    const c = salaryNet({ annual: 60_000_000, family: 3, children: 1 }).incomeTax;
    expect(b).toBeLessThan(a);
    expect(c).toBe(Math.max(0, estimateTableTax(salaryNet({ annual: 60_000_000, family: 3 }).taxable, 3) - 20_830));
  });
  it('80·120% 선택과 지방소득세 10%', () => {
    const r100 = salaryNet({ annual: 60_000_000, taxOverride: 100_000 });
    const r80 = salaryNet({ annual: 60_000_000, taxOverride: 100_000, ratio: 80 });
    const r120 = salaryNet({ annual: 60_000_000, taxOverride: 100_000, ratio: 120 });
    expect([r80.incomeTax, r100.incomeTax, r120.incomeTax]).toEqual([80_000, 100_000, 120_000]);
    expect(r120.localTax).toBe(12_000);
    expect(r100.estimated).toBe(false);
  });
  it('월급여가 늘면 세금도 늘어난다 (1천만원 경계 포함)', () => {
    let prev = -1;
    for (let m = 1_000_000; m <= 20_000_000; m += 250_000) { const t = estimateTableTax(m, 1); expect(t).toBeGreaterThanOrEqual(prev); prev = t; }
  });
  it('실수령액 = 세전 − 공제 합계', () => {
    const r = salaryNet({ annual: 50_000_000, meal: 200_000, family: 2 });
    expect(r.net).toBe(Math.floor(50_000_000 / 12 - r.deductions));
  });
});
