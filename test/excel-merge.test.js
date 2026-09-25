import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { safeSheetName, csvCell, csvBytesToRows, plainValue, stackTables, inputKind, mergeFiles } from '../src/_shared/excel-merge.js';

const cp949 = (hex) => new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));

async function xlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows, setup] of sheets) { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); setup?.(ws); }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
async function read(bytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return wb;
}
const values = (ws) => { const out = []; ws.eachRow((row, r) => { out[r - 1] = row.values.slice(1).map((v) => plainValue(v) ?? null); }); return out; };

describe('시트 이름', () => {
  it('금지 글자·31자·중복', () => {
    const used = new Set();
    expect(safeSheetName('매출/2024:[1]?', used)).toBe('매출_2024__1__');
    const long = '가'.repeat(40);
    const a = safeSheetName(long, used), b = safeSheetName(long, used), c = safeSheetName(long, used);
    expect([...a].length).toBe(31);
    expect(b).toBe('가'.repeat(27) + ' (2)');
    expect([...b].length).toBe(31);
    expect(c.endsWith(' (3)')).toBe(true);
  });
  it('대소문자 구분 없이 중복, 빈 이름, History 예약어, 앞뒤 작은따옴표', () => {
    const used = new Set();
    expect(safeSheetName('Data', used)).toBe('Data');
    expect(safeSheetName('data', used)).toBe('data (2)');
    expect(safeSheetName('', used)).toBe('Sheet');
    expect(safeSheetName('history', used)).toBe('History_');
    expect(safeSheetName("'인용'", used)).toBe('인용');
  });
});

describe('CSV 읽기', () => {
  it('숫자 변환은 값이 바뀌지 않을 때만', () => {
    expect(csvCell('123')).toBe(123);
    expect(csvCell('-4.5')).toBe(-4.5);
    expect(csvCell('0.25')).toBe(0.25);
    expect(csvCell('010-1234-5678')).toBe('010-1234-5678');
    expect(csvCell('00123')).toBe('00123');
    expect(csvCell('1234567890123456')).toBe('1234567890123456');
    expect(csvCell('1,000')).toBe('1,000');
    expect(csvCell('')).toBe(null);
  });
  it('CP949 CSV(한국어 윈도우 엑셀 저장본)', () => {
    // "이름,나이\r\n홍길동,30\r\n" 을 CP949 로
    const bytes = cp949('c0ccb8a72cb3aac0cc0d0ac8abb1e6b5bf2c33300d0a');
    const { rows, encoding } = csvBytesToRows(bytes);
    expect(encoding).toBe('euc-kr');
    expect(rows).toEqual([['이름', '나이'], ['홍길동', 30]]);
  });
  it('UTF-8 BOM · 세미콜론 구분', () => {
    const text = '﻿a;b\n1;"x;y"\n';
    expect(csvBytesToRows(new TextEncoder().encode(text)).rows).toEqual([['a', 'b'], [1, 'x;y']]);
  });
});

describe('값 정리', () => {
  it('수식·서식 글자·링크·오류', () => {
    expect(plainValue({ formula: 'A1*2', result: 4 })).toBe(4);
    expect(plainValue({ richText: [{ text: '굵' }, { text: '게' }] })).toBe('굵게');
    expect(plainValue({ text: '누리집', hyperlink: 'https://example.com' })).toBe('누리집');
    expect(plainValue({ error: '#N/A' })).toBe('#N/A');
    const d = new Date(Date.UTC(2024, 0, 2)); expect(plainValue(d)).toBe(d);
  });
  it('파일 종류', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]); const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(inputKind('a.xlsx', zip)).toBe('xlsx');
    expect(inputKind('a.XLSX', zip)).toBe('xlsx');
    expect(inputKind('a.xls', ole)).toBe('xls');
    expect(inputKind('a.csv', new Uint8Array([0x61]))).toBe('csv');
    expect(inputKind('a.pdf', new Uint8Array([0x25]))).toBe(null);
  });
});

describe('한 시트로 이어 붙이기', () => {
  const t1 = { source: '1월.xlsx', rows: [['날짜', '금액', '메모'], ['1/1', 100, 'a'], ['1/2', 200, null]] };
  const t2 = { source: '2월.csv', rows: [['금액', '날짜', '담당'], [300, '2/1', '김'], [null, null, null]] };
  it('제목 줄 한 번, 같은 제목끼리 같은 열, 원본 파일 열', () => {
    expect(stackTables([t1, t2], { hasHeader: true, addSource: true })).toEqual([
      ['원본 파일', '날짜', '금액', '메모', '담당'],
      ['1월.xlsx', '1/1', 100, 'a', null],
      ['1월.xlsx', '1/2', 200, null, null],
      ['2월.csv', '2/1', 300, null, '김'],
    ]);
  });
  it('제목 줄 없음: 그대로 쌓기', () => {
    expect(stackTables([{ source: 'a', rows: [[1, 2]] }, { source: 'b', rows: [[3]] }], { hasHeader: false })).toEqual([[1, 2], [3]]);
  });
  it('같은 이름의 제목이 한 파일에 두 번, 빈 제목, 제목보다 긴 줄', () => {
    const out = stackTables([{ source: 'a', rows: [['값', '값', ''], [1, 2, 3, 4]] }], { hasHeader: true });
    expect(out).toEqual([['값', '값', '열3', '열4'], [1, 2, 3, 4]]);
  });
});

describe('파일 합치기(exceljs)', () => {
  it('파일마다 시트: 이름 겹침 처리, 서식·병합·수식 유지', async () => {
    const a = await xlsx([['Sheet1', [['품목', '수량'], ['사과', 3], ['배', 4]], (ws) => {
      ws.getCell('C2').value = { formula: 'B2*2', result: 6 };
      ws.getCell('A1').font = { bold: true };
      ws.getColumn(1).width = 22;
      ws.mergeCells('A5:B5'); ws.getCell('A5').value = '합계 표';
    }]]);
    const b = await xlsx([['요약', [['x'], [1]]], ['원본', [['y'], [2]], (ws) => { ws.getCell('B2').value = { formula: '요약!A2+1', result: 2 }; }]]);
    const csv = new TextEncoder().encode('이름,점수\n홍길동,90\n');
    const r = await mergeFiles([
      { name: '보고서.xlsx', bytes: a },
      { name: '보고서.csv', bytes: csv },
      { name: '둘.xlsx', bytes: b },
    ], { mode: 'sheets' });
    expect(r.sheets.map((s) => s.name)).toEqual(['보고서', '보고서 (2)', '둘_요약', '둘_원본']);
    const wb = await read(r.bytes);
    const s1 = wb.getWorksheet('보고서');
    expect(s1.getCell('A1').font?.bold).toBe(true);
    expect(s1.getColumn(1).width).toBe(22);
    expect(s1.getCell('C2').formula).toBe('B2*2');
    expect(s1.model.merges).toContain('A5:B5');
    expect(values(wb.getWorksheet('보고서 (2)'))).toEqual([['이름', '점수'], ['홍길동', 90]]);
    // 다른 시트를 가리키는 수식은 계산된 값으로
    const s4 = wb.getWorksheet('둘_원본');
    expect(s4.getCell('B2').formula).toBeUndefined();
    expect(s4.getCell('B2').value).toBe(2);
  });

  it('한 시트로: 원본 파일 열, 제목 줄 한 번, 첫 시트만', async () => {
    const a = await xlsx([['A', [['이름', '나이'], ['갑', 20]]], ['B', [['무시'], ['됨']]]]);
    const b = await xlsx([['X', [['나이', '이름'], [30, '을'], [40, '병']]]]);
    const r = await mergeFiles([{ name: 'a.xlsx', bytes: a }, { name: 'b.xlsx', bytes: b }], { mode: 'stack', allSheets: false, addSource: true });
    const wb = await read(r.bytes);
    expect(wb.worksheets.length).toBe(1);
    expect(values(wb.worksheets[0])).toEqual([['원본 파일', '이름', '나이'], ['a.xlsx', '갑', 20], ['b.xlsx', '을', 30], ['b.xlsx', '병', 40]]);
  });

  it('xls·빈 파일은 건너뛰고 알려 줌', async () => {
    const empty = await xlsx([['S', []]]);
    const r = await mergeFiles([{ name: 'old.xls', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }, { name: 'e.xlsx', bytes: empty }]);
    expect(r.bytes).toBe(null);
    expect(r.skipped).toEqual([{ name: 'old.xls', reason: 'xls' }, { name: 'e.xlsx', reason: 'empty' }]);
  });
});
