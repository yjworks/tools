/* 엑셀 파일 합치기 로직. 화면과 떨어져 있어 Node(vitest)에서도 돈다.
   exceljs 는 크기가 커서(약 1MB) 필요할 때 loadExcel() 로 불러온다.
   CSV 는 csv.js 의 decode() 로 읽으므로 CP949(한국어 윈도우 엑셀 CSV)도 된다. */
import { decode, parseCsv, guessSeparator } from './csv.js';

let excelPromise;
/** exceljs 를 한 번만 불러온다(동적 import → 따로 떨어진 파일로 빌드됨). */
export function loadExcel() {
  excelPromise ||= import('exceljs').then((m) => m.default || m);
  return excelPromise;
}

export const SHEET_NAME_MAX = 31;
const BAD_SHEET_CHARS = /[\\/?*[\]:]/g;

/**
 * 엑셀이 받아 주는 시트 이름으로 고친다.
 * - \ / ? * [ ] : 는 쓸 수 없어 _ 로 바꾼다
 * - 31자까지. 앞뒤 작은따옴표 불가, 빈 이름 불가, 'History' 는 엑셀 예약어
 * - used(소문자 Set)와 겹치면 " (2)", " (3)"… 을 붙이되 31자를 넘지 않게 앞부분을 줄인다
 */
export function safeSheetName(name, used = new Set()) {
  let base = String(name ?? '').replace(BAD_SHEET_CHARS, '_').replace(/[\u0000-\u001f]/g, '').trim();
  base = base.replace(/^'+|'+$/g, '').trim();
  if (!base) base = 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History_';
  base = [...base].slice(0, SHEET_NAME_MAX).join('');
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    out = [...base].slice(0, SHEET_NAME_MAX - suffix.length).join('').replace(/'+$/, '') + suffix;
  }
  used.add(out.toLowerCase());
  return out;
}

/** CSV 칸 글자 → 엑셀 값. 앞자리 0(010…, 00123)이나 16자리 이상 숫자는 글자로 남겨 값이 바뀌지 않게 한다. */
export function csvCell(s) {
  if (s === '') return null;
  const t = s.trim();
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t) && t.replace(/[-.]/g, '').length <= 15) return Number(t);
  return s;
}

/** CSV 바이트 → 2차원 배열(값은 csvCell 로 바꿈). 인코딩·구분자는 자동 판별 */
export function csvBytesToRows(bytes) {
  const { text, encoding } = decode(bytes);
  const rows = parseCsv(text, Infinity, guessSeparator(text)).map((r) => r.map(csvCell));
  while (rows.length && rows[rows.length - 1].every((v) => v == null)) rows.pop();
  return { rows, encoding };
}

/** exceljs 칸 값 → 수식·서식 없는 값(숫자·글자·날짜·참거짓·null) */
export function plainValue(v) {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  if ('formula' in v || 'sharedFormula' in v) return plainValue(v.result ?? null);
  if ('error' in v) return v.error;
  if ('text' in v) return plainValue(v.text);
  return null;
}

/**
 * 다른 통합 문서로 옮길 칸 값. 서식 있는 글자·하이퍼링크는 그대로,
 * 수식은 같은 시트 안만 가리키면 수식으로, 다른 시트(!)를 가리키면 계산된 값으로 남긴다
 * (시트 이름이 바뀌거나 시트가 없어져 #REF! 가 나는 것을 막기 위해).
 */
export function copyValue(cell, keepFormula = true) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date) && ('formula' in v || 'sharedFormula' in v)) {
    const f = cell.formula;
    if (keepFormula && f && !f.includes('!') && !/\[\d+\]/.test(f)) return { formula: f, result: plainValue(cell.result ?? null) ?? undefined };
    return plainValue(cell.result ?? null);
  }
  return v;
}

/** 워크시트 → 2차원 배열(값만). 끝의 빈 줄은 뺀다 */
export function sheetToRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const out = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => { out[c - 1] = plainValue(cell.value); });
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = null;
    rows[r - 1] = out;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  while (rows.length && rows[rows.length - 1].every((v) => v == null)) rows.pop();
  return rows;
}

/** 워크시트 전체를 서식째 옮긴다: 값·서식·열 너비·행 높이·병합·틀 고정 */
export function copySheet(src, dst, ExcelJS) {
  const MERGE = ExcelJS?.ValueType?.Merge ?? 1;
  src.eachRow({ includeEmpty: false }, (row, r) => {
    const d = dst.getRow(r);
    if (row.height) d.height = row.height;
    if (row.hidden) d.hidden = true;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const t = d.getCell(c);
      if (cell.type !== MERGE) t.value = copyValue(cell);
      if (cell.style && Object.keys(cell.style).length) t.style = cell.style;
    });
  });
  for (let c = 1; c <= src.columnCount; c++) {
    const col = src.getColumn(c);
    if (col.width) dst.getColumn(c).width = col.width;
    if (col.hidden) dst.getColumn(c).hidden = true;
  }
  for (const range of src.model?.merges || []) { try { dst.mergeCells(range); } catch { /* 겹친 병합은 건너뛴다 */ } }
  if (src.views?.length) dst.views = src.views.map((v) => ({ ...v }));
}

/** 파일 종류: 'xlsx' | 'csv' | 'xls'(지원 안 함) | null */
export function inputKind(name, bytes) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const zip = bytes && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (zip && ['xlsx', 'xlsm', 'xltx', 'xltm'].includes(ext)) return 'xlsx';
  if (zip && !ext) return 'xlsx';
  if (ole || ext === 'xls') return 'xls';
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  if (zip) return 'xlsx';
  return null;
}

/**
 * 파일 하나를 읽어 시트 목록으로. [{ sheetName, rows, ws }]
 * ws 는 xlsx 에서만 있다(서식째 옮길 때 씀). allSheets=false 면 첫 시트만.
 */
export async function readInput(file, { allSheets = true } = {}) {
  const kind = inputKind(file.name, file.bytes);
  if (kind === 'csv') {
    const { rows } = csvBytesToRows(file.bytes);
    return [{ sheetName: file.name.replace(/\.[^.]+$/, ''), rows, ws: null }];
  }
  if (kind === 'xls') throw new Error('XLS');
  if (kind !== 'xlsx') throw new Error('KIND');
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const u8 = file.bytes;
  await wb.xlsx.load(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const sheets = wb.worksheets.filter((ws) => ws.state !== 'veryHidden');
  const picked = allSheets ? sheets : sheets.slice(0, 1);
  return picked.map((ws) => ({ sheetName: ws.name, rows: sheetToRows(ws), ws }));
}

/**
 * 여러 표를 한 표로 이어 붙인다.
 * tables: [{ source, rows }]
 * hasHeader: 각 표의 첫 줄을 제목 줄로 보고, 같은 제목끼리 같은 열에 맞춘다(제목 줄은 한 번만)
 * addSource: 맨 앞에 '원본 파일' 열을 붙인다
 */
export function stackTables(tables, { hasHeader = true, addSource = false, sourceLabel = '원본 파일' } = {}) {
  const out = [];
  if (!hasHeader) {
    for (const t of tables) for (const r of t.rows) out.push(addSource ? [t.source, ...r] : [...r]);
    return out;
  }
  const keys = []; const labels = []; const index = new Map();
  const mapped = tables.map((t) => {
    const header = t.rows[0] || [];
    const seen = new Map();
    const colMap = header.map((h, i) => {
      const label = h == null || String(h).trim() === '' ? `열${i + 1}` : String(plainValue(h)).trim();
      const n = (seen.get(label) || 0) + 1; seen.set(label, n);
      const key = n > 1 ? `${label}\u0000${n}` : label;
      if (!index.has(key)) { index.set(key, keys.length); keys.push(key); labels.push(label); }
      return index.get(key);
    });
    return { t, colMap, width: header.length };
  });
  out.push(addSource ? [sourceLabel, ...labels] : [...labels]);
  for (const { t, colMap, width } of mapped) {
    for (const r of t.rows.slice(1)) {
      if (r.every((v) => v == null || v === '')) continue;
      const row = new Array(keys.length).fill(null);
      r.forEach((v, i) => {
        if (i < width) row[colMap[i]] = v;
        else { // 제목 없는 열이 더 있으면 뒤에 붙인다
          const key = `열${i + 1}`;
          if (!index.has(key)) { index.set(key, keys.length); keys.push(key); labels.push(key); out[0].push(key); row.push(null); }
          row[index.get(key)] = v;
        }
      });
      out.push(addSource ? [t.source, ...row] : row);
    }
  }
  return out;
}

/**
 * 파일들 → 합친 .xlsx 바이트.
 * files: [{ name, bytes: Uint8Array }]
 * mode: 'sheets'(파일마다 시트) | 'stack'(한 시트에 이어 붙이기)
 * 돌려주는 값: { bytes, sheets: [{ name, rows }], skipped: [{ name, reason }] }
 */
export async function mergeFiles(files, { mode = 'sheets', allSheets = true, hasHeader = true, addSource = true, stackSheetName = '합친 데이터' } = {}) {
  const ExcelJS = await loadExcel();
  const out = new ExcelJS.Workbook();
  out.creator = 'dibrain.dev/tools';
  const used = new Set();
  const made = []; const skipped = []; const tables = [];

  for (const file of files) {
    let sheets;
    try { sheets = await readInput(file, { allSheets }); }
    catch (e) { skipped.push({ name: file.name, reason: e.message === 'XLS' ? 'xls' : e.message === 'KIND' ? 'kind' : 'broken' }); continue; }
    const base = file.name.replace(/\.[^.]+$/, '');
    const nonEmpty = sheets.filter((s) => s.rows.length);
    if (!nonEmpty.length) { skipped.push({ name: file.name, reason: 'empty' }); continue; }
    for (const s of nonEmpty) {
      const label = nonEmpty.length > 1 ? `${base}_${s.sheetName}` : base;
      if (mode === 'stack') { tables.push({ source: nonEmpty.length > 1 ? `${file.name} / ${s.sheetName}` : file.name, rows: s.rows }); continue; }
      const name = safeSheetName(label, used);
      const ws = out.addWorksheet(name);
      if (s.ws) copySheet(s.ws, ws, ExcelJS);
      else s.rows.forEach((r) => ws.addRow(r));
      made.push({ name, rows: s.rows.length });
    }
  }

  if (mode === 'stack' && tables.length) {
    const rows = stackTables(tables, { hasHeader, addSource });
    const ws = out.addWorksheet(safeSheetName(stackSheetName, used));
    for (const r of rows) ws.addRow(r);
    if (hasHeader && rows.length) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      rows[0].forEach((h, i) => { ws.getColumn(i + 1).width = Math.min(40, Math.max(8, String(h ?? '').length * 2 + 2)); });
    }
    made.push({ name: ws.name, rows: rows.length });
  }
  if (!made.length) return { bytes: null, sheets: made, skipped };
  const buf = await out.xlsx.writeBuffer();
  return { bytes: new Uint8Array(buf), sheets: made, skipped };
}
