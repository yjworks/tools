import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { openWorkbook, describeSheets, splitWorkbook, zipFiles, groupRowsByCount, groupRowsByColumn, colLetter, cellText, MAX_FILES } from '../_shared/excel-split.js';

const status = $('#status'), panel = $('#panel'), sheetsTbl = $('#sheets');
const sheetSel = $('#sheet'), colSel = $('#column'), rowsPer = $('#rowsPer'), hasHeader = $('#hasHeader'), formatSel = $('#format');
const runBtn = $('#run'), estimate = $('#estimate');
let wb = null, info = [], fileName = '';

const mode = () => document.querySelector('input[name=mode]:checked').value;
const current = () => info.find((s) => s.name === sheetSel.value) || info[0];

function fillColumns() {
  const s = current();
  colSel.replaceChildren();
  for (let c = 0; c < Math.max(1, s.cols); c++) {
    const head = hasHeader.checked ? cellText(s.header[c]).trim() : '';
    colSel.append(h('option', { value: c }, head ? `${colLetter(c + 1)}열 · ${head.slice(0, 30)}` : `${colLetter(c + 1)}열`));
  }
}

function update() {
  const m = mode();
  $('#subSheet').hidden = m === 'sheets';
  $('#headerCheck').hidden = m === 'sheets';
  $('#rowsField').hidden = m !== 'rows';
  $('#colField').hidden = m !== 'column';
  if (!info.length) return;
  let n;
  if (m === 'sheets') n = info.length;
  else if (m === 'rows') n = groupRowsByCount(current().rows, Number(rowsPer.value) || 1, hasHeader.checked).groups.length;
  else n = groupRowsByColumn(current().data, Number(colSel.value) || 0, hasHeader.checked).groups.length;
  estimate.textContent = n ? `${n.toLocaleString()}개 파일이 만들어집니다${n > 1 ? ' (zip으로 묶어 저장)' : ''}.` : '나눌 줄이 없습니다.';
  runBtn.disabled = !n || n > MAX_FILES;
  if (n > MAX_FILES) estimate.textContent = `${n.toLocaleString()}개는 너무 많습니다. 한 번에 ${MAX_FILES.toLocaleString()}개까지 만들 수 있습니다.`;
}

function showSheets() {
  sheetsTbl.replaceChildren(h('tr', {}, h('th', {}, '시트'), h('th', { class: 'num' }, '줄'), h('th', { class: 'num' }, '열')));
  sheetSel.replaceChildren();
  for (const s of info) {
    sheetsTbl.append(h('tr', {}, h('td', {}, s.name, s.hidden ? h('span', { class: 'muted' }, ' (숨김)') : null), h('td', { class: 'num' }, s.rows.toLocaleString()), h('td', { class: 'num' }, s.cols)));
    sheetSel.append(h('option', { value: s.name }, s.name));
  }
  const biggest = info.reduce((a, b) => (b.rows > a.rows ? b : a), info[0]);
  sheetSel.value = biggest.name;
  fillColumns();
}

fileDrop($('.drop'), async ([file]) => {
  panel.hidden = true; wb = null; info = [];
  const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  if (ext === 'xls') return setStatus(status, '.xls(엑셀 97-2003) 형식은 읽지 못합니다. 엑셀에서 .xlsx로 저장한 뒤 넣어 주세요.', 'bad');
  if (ext === 'csv') return setStatus(status, 'CSV는 시트가 하나뿐입니다. 엑셀에서 .xlsx로 저장하면 줄 수·열 값으로 나눌 수 있습니다.', 'warn');
  setStatus(status, `${file.name} (${fmtBytes(file.size)}) 읽는 중…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('not xlsx');
    wb = await openWorkbook(bytes);
    info = describeSheets(wb);
    if (!info.length) throw new Error('no sheets');
  } catch (e) {
    console.error(e);
    return setStatus(status, '엑셀 파일을 읽지 못했습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다.', 'bad');
  }
  fileName = baseName(file.name);
  setStatus(status, `시트 ${info.length}개를 찾았습니다.`, 'ok');
  showSheets();
  if (info.length === 1 && mode() === 'sheets') document.querySelector('input[name=mode][value=rows]').checked = true;
  panel.hidden = false;
  update();
});

for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', update);
sheetSel.addEventListener('change', () => { fillColumns(); update(); });
hasHeader.addEventListener('change', () => { const c = colSel.value; fillColumns(); colSel.value = c; update(); });
colSel.addEventListener('change', update);
rowsPer.addEventListener('input', update);

runBtn.addEventListener('click', async () => {
  if (!wb) return;
  runBtn.disabled = true;
  setStatus(status, '나누는 중입니다…');
  const m = mode(), format = formatSel.value;
  try {
    const files = await splitWorkbook(wb, {
      mode: m, format, sheet: sheetSel.value, rowsPer: Number(rowsPer.value) || 1000,
      column: Number(colSel.value) || 0, hasHeader: hasHeader.checked, baseName: fileName,
    });
    if (!files.length) { setStatus(status, '나눌 줄이 없습니다.', 'warn'); return; }
    if (files.length === 1) {
      const f = files[0];
      download(new Blob([f.bytes], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), f.name);
    } else {
      download(new Blob([zipFiles(files)], { type: 'application/zip' }), `${fileName}_나눔.zip`);
    }
    setStatus(status, `${files.length}개 파일로 나눴습니다.`, 'ok');
    track('tool_use', { tool: 'excel-split', mode: m, format, files: files.length });
  } catch (e) {
    console.error(e);
    setStatus(status, e.message === 'TOO_MANY' ? `파일이 ${MAX_FILES.toLocaleString()}개를 넘습니다. 다른 기준 열을 골라 주세요.` : '나누는 중 문제가 생겼습니다.', 'bad');
  } finally {
    runBtn.disabled = false;
  }
});
