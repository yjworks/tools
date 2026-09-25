import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import {
  safeFileName, uniqueName, cellText, toCsv, groupRowsByCount, groupRowsByColumn, colLetter,
  openWorkbook, describeSheets, splitWorkbook, zipFiles,
} from '../src/_shared/excel-split.js';
import { plainValue } from '../src/_shared/excel-merge.js';

async function sample() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('판매');
  ws.addRow(['지역', '품목', '금액']);
  [['서울', '사과', 100], ['부산', '배', 200], ['서울', '감', 300], ['대구', '귤', 400], ['부산', '밤', 500]].forEach((r) => ws.addRow(r));
  ws.getCell('A1').font = { bold: true }; ws.getColumn(2).width = 30;
  const s2 = wb.addWorksheet('요약 2024');
  s2.addRow(['합계', { formula: 'SUM(판매!C2:C6)', result: 1500 }]);
  s2.addRow(['날짜', new Date(Date.UTC(2024, 4, 6))]);
  s2.addRow(['쉼표,있음', '따옴표"있음']);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const vals = (ws) => { const out = []; ws.eachRow((row, r) => { out[r - 1] = row.values.slice(1).map((v) => plainValue(v)); }); return out; };
const load = async (bytes) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); return wb; };

describe('이름·글자 도우미', () => {
  it('파일 이름 정리·중복', () => {
    expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______');
    expect(safeFileName('   ')).toBe('이름없음');
    const used = new Set();
    expect(uniqueName('서울', 'csv', used)).toBe('서울.csv');
    expect(uniqueName('서울', 'csv', used)).toBe('서울 (2).csv');
  });
  it('CSV 칸 글자·열 문자', () => {
    expect(cellText(new Date(Date.UTC(2024, 4, 6)))).toBe('2024-05-06');
    expect(cellText(new Date(Date.UTC(2024, 4, 6, 13, 5, 9)))).toBe('2024-05-06 13:05:09');
    expect(cellText({ formula: 'A1', result: 3 })).toBe('3');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(null)).toBe('');
    expect([1, 26, 27, 52, 703].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
  });
  it('CSV: BOM, CRLF, 따옴표 처리', () => {
    const b = toCsv([['a,b', 'c"d', '줄\n바꿈'], [1, null]]);
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(b.subarray(3))).toBe('"a,b","c""d","줄\n바꿈"\r\n1,\r\n');
  });
});

describe('나누는 기준', () => {
  it('줄 수: 제목 줄 반복, 나머지 묶음', () => {
    expect(groupRowsByCount(8, 3, true)).toEqual({ header: [1], groups: [[2, 3, 4], [5, 6, 7], [8]] });
    expect(groupRowsByCount(4, 2, false)).toEqual({ header: [], groups: [[1, 2], [3, 4]] });
    expect(groupRowsByCount(1, 10, true).groups).toEqual([]);
  });
  it('열 값: 처음 나온 순서, 빈 칸은 (빈 칸), 빈 줄은 뺌', () => {
    const rows = [['지역', '값'], ['서울', 1], ['부산', 2], [null, 3], ['서울', 4], [], [' 부산 ', 5]];
    expect(groupRowsByColumn(rows, 0, true)).toEqual({ header: [1], groups: [{ key: '서울', rows: [2, 5] }, { key: '부산', rows: [3, 7] }, { key: '(빈 칸)', rows: [4] }] });
  });
});

describe('통합 문서 나누기', () => {
  it('시트 요약', async () => {
    const wb = await openWorkbook(await sample());
    const d = describeSheets(wb);
    expect(d.map((s) => [s.name, s.rows, s.cols])).toEqual([['판매', 6, 3], ['요약 2024', 3, 2]]);
    expect(d[0].header).toEqual(['지역', '품목', '금액']);
  });
  it('시트마다 xlsx: 서식 유지, 다른 시트를 가리키던 수식은 값으로', async () => {
    const wb = await openWorkbook(await sample());
    const files = await splitWorkbook(wb, { mode: 'sheets', format: 'xlsx', baseName: '보고서' });
    expect(files.map((f) => f.name)).toEqual(['보고서_판매.xlsx', '보고서_요약 2024.xlsx']);
    const a = await load(files[0].bytes);
    expect(a.worksheets[0].name).toBe('판매');
    expect(a.worksheets[0].getCell('A1').font?.bold).toBe(true);
    expect(a.worksheets[0].getColumn(2).width).toBe(30);
    const b = await load(files[1].bytes);
    expect(b.worksheets[0].name).toBe('요약 2024');
    expect(b.worksheets[0].getCell('B1').value).toBe(1500);
  });
  it('시트마다 csv', async () => {
    const wb = await openWorkbook(await sample());
    const files = await splitWorkbook(wb, { mode: 'sheets', format: 'csv', baseName: 'x' });
    expect(new TextDecoder().decode(files[1].bytes.subarray(3))).toBe('합계,1500\r\n날짜,2024-05-06\r\n"쉼표,있음","따옴표""있음"\r\n');
  });
  it('줄 수로 나누기(제목 줄 반복)', async () => {
    const wb = await openWorkbook(await sample());
    const files = await splitWorkbook(wb, { mode: 'rows', sheet: '판매', rowsPer: 2, hasHeader: true, format: 'xlsx', baseName: 'x' });
    expect(files.map((f) => f.name)).toEqual(['x_판매_1.xlsx', 'x_판매_2.xlsx', 'x_판매_3.xlsx']);
    const last = await load(files[2].bytes);
    expect(vals(last.worksheets[0])).toEqual([['지역', '품목', '금액'], ['부산', '밤', 500]]);
    expect(last.worksheets[0].getCell('A1').font?.bold).toBe(true);
  });
  it('열 값으로 나누기 + zip', async () => {
    const wb = await openWorkbook(await sample());
    const files = await splitWorkbook(wb, { mode: 'column', sheet: '판매', column: 0, hasHeader: true, format: 'csv', baseName: 'x' });
    expect(files.map((f) => f.name)).toEqual(['x_판매_서울.csv', 'x_판매_부산.csv', 'x_판매_대구.csv']);
    const zip = unzipSync(zipFiles(files));
    expect(Object.keys(zip)).toEqual(files.map((f) => f.name));
    expect(strFromU8(zip['x_판매_부산.csv'].subarray(3))).toBe('지역,품목,금액\r\n부산,배,200\r\n부산,밤,500\r\n');
  });
});
