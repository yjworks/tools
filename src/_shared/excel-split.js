/* 엑셀 시트 나누기 로직. exceljs 는 loadExcel() 로 필요할 때만 불러오고, 묶음 파일은 fflate 로 만든다. */
import { zipSync } from 'fflate';
import { loadExcel, safeSheetName, plainValue, copyValue, copySheet, sheetToRows } from './excel-merge.js';
import { encodeUtf8 } from './csv.js';

export const MAX_FILES = 1000; // 한 번에 만들 파일 수 상한(브라우저 메모리 보호)

/** 파일 이름에 못 쓰는 글자(\ / : * ? " < > |)를 _ 로. 너무 길면 줄인다 */
export function safeFileName(name, fallback = '이름없음') {
  let s = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
  s = [...s].slice(0, 80).join('').trim();
  return s || fallback;
}

/** 같은 이름이 있으면 " (2)" 를 붙인다. used 는 소문자 Set */
export function uniqueName(name, ext, used) {
  let out = `${name}.${ext}`;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${name} (${n}).${ext}`;
  used.add(out.toLowerCase());
  return out;
}

/** CSV 한 칸 글자. 날짜는 YYYY-MM-DD(시간이 있으면 HH:MM:SS 까지) */
export function cellText(v) {
  v = plainValue(v);
  if (v == null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/** 2차원 배열 → CSV 바이트(UTF-8, 기본 BOM 포함, 줄바꿈 CRLF). 쉼표·따옴표·줄바꿈이 있는 칸은 따옴표로 감싼다 */
export function toCsv(rows, bom = true) {
  const text = rows.map((r) => r.map((v) => {
    const s = cellText(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
  return encodeUtf8(text, bom);
}

/** 줄 수로 나누기: 데이터 줄 번호(1부터)를 n 개씩 묶는다. 제목 줄은 따로 돌려준다 */
export function groupRowsByCount(lastRow, n, hasHeader = true) {
  const size = Math.max(1, Math.floor(n) || 1);
  const start = hasHeader ? 2 : 1;
  const groups = [];
  for (let r = start; r <= lastRow; r += size) {
    const g = [];
    for (let i = r; i < r + size && i <= lastRow; i++) g.push(i);
    groups.push(g);
  }
  return { header: hasHeader && lastRow >= 1 ? [1] : [], groups };
}

/** 열 값으로 나누기: rows(값 배열)의 col 번째(0부터) 값이 같은 줄끼리. 처음 나온 순서를 지킨다 */
export function groupRowsByColumn(rows, col, hasHeader = true) {
  const map = new Map();
  rows.forEach((r, i) => {
    if (hasHeader && i === 0) return;
    if (!r || r.every((v) => v == null || v === '')) return;
    const key = cellText(r[col]).trim() || '(빈 칸)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i + 1);
  });
  return { header: hasHeader && rows.length ? [1] : [], groups: [...map].map(([key, rowNums]) => ({ key, rows: rowNums })) };
}

/** 열 번호(1부터) → A, B, …, Z, AA */
export function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function openWorkbook(bytes) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return wb;
}

/** 화면에 보여 줄 시트 요약: 이름·줄 수·열 수·첫 줄 */
export function describeSheets(wb) {
  return wb.worksheets.filter((ws) => ws.state !== 'veryHidden').map((ws) => {
    const rows = sheetToRows(ws);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    return { name: ws.name, rows: rows.length, cols, header: rows[0] || [], hidden: ws.state === 'hidden', ws, data: rows };
  });
}

/** 원본 시트의 일부 줄만 새 시트로(서식·열 너비 포함, 수식은 계산된 값으로) */
function copyRows(src, dst, rowNums) {
  rowNums.forEach((r, i) => {
    const s = src.getRow(r); const d = dst.getRow(i + 1);
    if (s.height) d.height = s.height;
    s.eachCell({ includeEmpty: true }, (cell, c) => {
      const t = d.getCell(c);
      t.value = plainOrRich(cell);
      if (cell.style && Object.keys(cell.style).length) t.style = cell.style;
    });
  });
  for (let c = 1; c <= src.columnCount; c++) {
    const w = src.getColumn(c).width;
    if (w) dst.getColumn(c).width = w;
  }
}
const plainOrRich = (cell) => copyValue(cell, false);

async function xlsxBytes(build) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dibrain.dev/tools';
  build(wb, ExcelJS);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/**
 * 나누기. 돌려주는 값: [{ name, bytes }]
 * opts.mode: 'sheets'(시트마다 파일) | 'rows'(한 시트를 n 줄씩) | 'column'(한 시트를 열 값별로)
 * opts.format: 'xlsx' | 'csv'
 * opts.sheet: 'rows'·'column' 에서 나눌 시트 이름, opts.rowsPer, opts.column(0부터), opts.hasHeader
 */
export async function splitWorkbook(wb, { mode = 'sheets', format = 'xlsx', sheet, rowsPer = 1000, column = 0, hasHeader = true, baseName = '엑셀' } = {}) {
  const used = new Set();
  const files = [];
  const base = safeFileName(baseName, '엑셀');

  if (mode === 'sheets') {
    const sheets = wb.worksheets.filter((ws) => ws.state !== 'veryHidden');
    for (const ws of sheets) {
      const name = uniqueName(`${base}_${safeFileName(ws.name, '시트')}`, format, used);
      if (format === 'csv') files.push({ name, bytes: toCsv(sheetToRows(ws)) });
      else files.push({ name, bytes: await xlsxBytes((out, ExcelJS) => copySheet(ws, out.addWorksheet(safeSheetName(ws.name)), ExcelJS)) });
    }
    return files;
  }

  const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
  const data = sheetToRows(ws);
  let header; let groups;
  if (mode === 'rows') {
    const g = groupRowsByCount(data.length, rowsPer, hasHeader);
    header = g.header;
    groups = g.groups.map((rows, i) => ({ label: `${i + 1}`.padStart(String(g.groups.length).length, '0'), rows }));
  } else {
    const g = groupRowsByColumn(data, column, hasHeader);
    header = g.header;
    groups = g.groups.map(({ key, rows }) => ({ label: safeFileName(key, '빈 칸'), rows }));
  }
  if (groups.length > MAX_FILES) throw new Error('TOO_MANY');
  const sheetBase = safeFileName(ws.name, '시트');
  for (const g of groups) {
    const name = uniqueName(`${base}_${sheetBase}_${g.label}`, format, used);
    const rowNums = [...header, ...g.rows];
    if (format === 'csv') files.push({ name, bytes: toCsv(rowNums.map((r) => data[r - 1] || [])) });
    else {
      files.push({
        name,
        bytes: await xlsxBytes((out) => {
          const dst = out.addWorksheet(safeSheetName(ws.name));
          copyRows(ws, dst, rowNums);
          if (header.length) dst.views = [{ state: 'frozen', ySplit: 1 }];
        }),
      });
    }
  }
  return files;
}

/** 여러 파일 → zip 바이트. xlsx 는 이미 압축된 형식이라 다시 압축하지 않는다(level 0). 한글 이름은 UTF-8 표시로 저장 */
export function zipFiles(files) {
  const entries = {};
  for (const f of files) entries[f.name] = [f.bytes, { level: f.name.endsWith('.xlsx') ? 0 : 6 }];
  return zipSync(entries);
}
