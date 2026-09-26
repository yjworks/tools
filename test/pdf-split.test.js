import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseRanges, planEvery, groupConsecutive, planOutputs, describeRanges, pageMembership, uniqueNames, splitPdf, MAX_OUTPUTS } from '../src/_shared/pdf-split.js';
import { loadPdf } from '../src/_shared/pdf-merge.js';

describe('parseRanges', () => {
  it('기본 문법 "1-3, 5, 8-"', () => {
    expect(parseRanges('1-3, 5, 8-', 12)).toEqual({ ranges: [{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: 12 }], errors: [] });
  });
  it('앞이 빈 범위, 공백 구분, 물결, 전각 숫자, "끝"', () => {
    expect(parseRanges('-2 4 6~7 ９ 10-끝', 11).ranges).toEqual([
      { from: 1, to: 2 }, { from: 4, to: 4 }, { from: 6, to: 7 }, { from: 9, to: 9 }, { from: 10, to: 11 },
    ]);
  });
  it('"1 - 3" 처럼 대시 양옆 공백은 범위 하나', () => {
    expect(parseRanges('1 - 3', 5).ranges).toEqual([{ from: 1, to: 3 }]);
  });
  it('"3쪽, p5" 같은 표기도 받는다', () => {
    expect(parseRanges('3쪽, p5', 5).ranges).toEqual([{ from: 3, to: 3 }, { from: 5, to: 5 }]);
  });
  it('잘못된 부분은 오류로 모으고 나머지는 살린다', () => {
    const r = parseRanges('2-1, 0, 15, abc, 3', 10);
    expect(r.ranges).toEqual([{ from: 3, to: 3 }]);
    expect(r.errors.map((e) => e.part)).toEqual(['2-1', '0', '15', 'abc']);
    expect(r.errors[2].message).toBe('문서는 10쪽까지 있습니다');
  });
  it('빈 글은 빈 결과', () => {
    expect(parseRanges('  ', 5)).toEqual({ ranges: [], errors: [] });
  });
});

describe('planEvery / groupConsecutive', () => {
  it('10쪽을 3쪽씩 → 4개, 마지막은 1쪽', () => {
    expect(planEvery(10, 3)).toEqual([{ from: 1, to: 3 }, { from: 4, to: 6 }, { from: 7, to: 9 }, { from: 10, to: 10 }]);
  });
  it('0이나 숫자가 아니면 빈 계획', () => {
    expect(planEvery(10, 0)).toEqual([]);
    expect(planEvery(10, 'x')).toEqual([]);
  });
  it('고른 쪽을 이어진 구간으로', () => {
    expect(groupConsecutive([9, 1, 2, 3, 7, 10, 2])).toEqual([{ from: 1, to: 3 }, { from: 7, to: 7 }, { from: 9, to: 10 }]);
    expect(describeRanges(groupConsecutive([9, 1, 2, 3, 7, 10]))).toBe('1-3, 7, 9-10');
  });
  it('상한 값', () => { expect(MAX_OUTPUTS).toBe(500); });
});

describe('planOutputs', () => {
  it('범위마다 파일 하나, 쪽 번호 자릿수 맞춤', () => {
    const o = planOutputs('보고서', 120, 'ranges', [{ from: 1, to: 3 }, { from: 100, to: 120 }]);
    expect(o.map((x) => x.name)).toEqual(['보고서_p001-003.pdf', '보고서_p100-120.pdf']);
    expect(o[0].pages).toEqual([0, 1, 2]);
  });
  it('고른 쪽을 한 파일로', () => {
    const [o] = planOutputs('a', 10, 'pick-one', [2, 3, 8]);
    expect(o.pages).toEqual([1, 2, 7]);
    expect(o.label).toBe('2-3, 8');
    expect(o.name).toBe('a_선택3쪽.pdf');
  });
  it('고른 쪽마다 파일 하나', () => {
    expect(planOutputs('a', 10, 'pick-each', [10, 2]).map((x) => x.name)).toEqual(['a_p02.pdf', 'a_p10.pdf']);
  });
  it('같은 범위를 두 번 쓰면 이름 뒤에 (2)', () => {
    const o = planOutputs('a', 5, 'ranges', [{ from: 1, to: 2 }, { from: 1, to: 2 }]);
    expect(o.map((x) => x.name)).toEqual(['a_p1-2.pdf', 'a_p1-2 (2).pdf']);
    expect(uniqueNames([{ name: 'x.pdf' }, { name: 'x.pdf' }, { name: 'x.pdf' }]).map((g) => g.name)).toEqual(['x.pdf', 'x (2).pdf', 'x (3).pdf']);
  });
  it('쪽마다 몇 번째 파일에 들어가는지', () => {
    const o = planOutputs('a', 5, 'ranges', [{ from: 1, to: 2 }, { from: 2, to: 3 }]);
    expect(pageMembership(o, 5)).toEqual([[0], [0, 1], [1], [], []]);
  });
});

describe('splitPdf (실제 PDF)', () => {
  it('7쪽 문서를 "1-3, 5, 6-" 로 나누면 3쪽·1쪽·2쪽, 쪽 크기로 순서 확인', async () => {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 7; i++) {
      const p = src.addPage([200 + i, 300]);   // 폭으로 원래 쪽 번호를 알아본다
      p.drawText(`Page ${i}`, { x: 20, y: 250, size: 20, font });
    }
    const bytes = await src.save();
    const doc = await loadPdf(bytes);
    const { ranges } = parseRanges('1-3, 5, 6-', doc.getPageCount());
    const outs = planOutputs('t', 7, 'ranges', ranges);
    const files = await splitPdf(doc, outs);
    expect(files.map((f) => f.name)).toEqual(['t_p1-3.pdf', 't_p5.pdf', 't_p6-7.pdf']);
    const widths = [];
    for (const f of files) {
      const d = await PDFDocument.load(f.bytes);
      widths.push(d.getPages().map((p) => p.getWidth()));
    }
    expect(widths).toEqual([[201, 202, 203], [205], [206, 207]]);
  });
});
