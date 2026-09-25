import { $, h, setStatus, track } from '../_shared/ui.js';
import { m2ToPyeong, pyeongToM2, parseNum, round, sizeTable, COMMON_SIZES } from '../_shared/pyeong-converter.js';

const m2 = $('#m2'), py = $('#py'), ratio = $('#ratio'), status = $('#status'), sum = $('#sum'), table = $('#table');
let used = false, current = null;

function showSum(areaM2) {
  sum.replaceChildren();
  if (areaM2 == null) { sum.hidden = true; return; }
  sum.hidden = false;
  sum.append(
    h('div', { class: 'out' }, `${round(areaM2, 2)}㎡ = ${round(m2ToPyeong(areaM2), 2)}평`),
    h('div', { class: 'muted' }, `정확한 값: ${round(areaM2, 4)}㎡ × 121 ÷ 400 = ${round(m2ToPyeong(areaM2), 4)}평`),
  );
}

function fromM2() {
  const v = parseNum(m2.value);
  if (!m2.value.trim()) { py.value = ''; setStatus(status, ''); current = null; showSum(null); renderTable(); return; }
  if (v === null) { setStatus(status, '숫자만 넣어 주세요. (예: 84.97)', 'warn'); return; }
  setStatus(status, '');
  py.value = round(m2ToPyeong(v), 4).replace(/,/g, '');
  current = v; showSum(v); renderTable(); mark();
}
function fromPy() {
  const v = parseNum(py.value);
  if (!py.value.trim()) { m2.value = ''; setStatus(status, ''); current = null; showSum(null); renderTable(); return; }
  if (v === null) { setStatus(status, '숫자만 넣어 주세요. (예: 25.7)', 'warn'); return; }
  setStatus(status, '');
  const a = pyeongToM2(v);
  m2.value = round(a, 4).replace(/,/g, '');
  current = a; showSum(a); renderTable(); mark();
}
function mark() { if (!used) { used = true; track('tool_use', { tool: 'pyeong-converter' }); } }

function renderTable() {
  const r = Number(ratio.value);
  const ok = r >= 40 && r <= 100;
  const rows = sizeTable(COMMON_SIZES, ok ? r / 100 : 0);
  let hit = -1;
  if (current != null) {
    let best = Infinity;
    rows.forEach((row, i) => { const d = Math.abs(row.m2 - current); if (d < best && d <= 5) { best = d; hit = i; } });
  }
  table.replaceChildren(
    h('tr', {}, h('th', {}, '전용 ㎡'), h('th', {}, '전용 평'), h('th', {}, ok ? `공급 ㎡ (추정)` : '공급 ㎡'), h('th', {}, ok ? '공급 평 (추정)' : '공급 평')),
    ...rows.map((row, i) => h('tr', { class: i === hit ? 'hit' : null },
      h('td', {}, `${row.m2}㎡`), h('td', {}, `${round(row.pyeong, 2)}평`),
      h('td', {}, ok ? `${round(row.supplyM2, 1)}㎡` : '—'), h('td', {}, ok ? `${round(row.supplyPyeong, 1)}평` : '—'))),
  );
  if (!ok) setStatus(status, '전용률은 40~100% 사이로 넣어 주세요.', 'warn');
}

m2.addEventListener('input', fromM2);
py.addEventListener('input', fromPy);
ratio.addEventListener('input', () => { setStatus(status, ''); renderTable(); });
renderTable();
