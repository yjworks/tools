import { $, h, setStatus, copyText, track } from '../_shared/ui.js';
import { parseAmount, toKorean, contractLine, withCommas } from '../_shared/amount.js';

const num = $('#num'), il = $('#il'), spacing = $('#spacing'), results = $('#results'), status = $('#status');
let used = false;

function line(label, text) {
  const btn = h('button', { class: 'small ghost', onclick: (e) => copyText(text, e.currentTarget) }, '복사');
  return h('div', { class: 'row', style: 'margin:14px 0 0;align-items:flex-start;flex-wrap:nowrap' },
    h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'muted' }, label), h('div', { class: 'out' }, text)), btn);
}

function run() {
  results.replaceChildren();
  const raw = num.value.trim();
  if (!raw) { setStatus(status, ''); return; }
  const n = parseAmount(raw);
  if (n === null) { setStatus(status, '숫자만 입력해 주세요. 경(10¹⁶) 단위 아래 네 자리까지 됩니다.', 'warn'); return; }
  setStatus(status, '');
  const opt = { il: il.checked, spacing: spacing.checked };
  results.append(
    line('계약서용', contractLine(n, opt)),
    line('한글', `${toKorean(n, opt)}원`),
    line('숫자', `${withCommas(n)}원`),
    line('한자 갖은자', contractLine(n, { hanja: true })),
  );
  if (!used) { used = true; track('tool_use', { tool: 'korean-amount' }); }
}

num.addEventListener('input', run);
il.addEventListener('change', run);
spacing.addEventListener('change', run);
