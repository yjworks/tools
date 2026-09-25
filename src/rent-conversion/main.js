import { $, h, setStatus, track } from '../_shared/ui.js';
import { BASE_RATE, legalCap, depositToRent, rentToDeposit, impliedRate } from '../_shared/rent-conversion.js';

const cap = legalCap();
const rateEl = $('#rate'), fields = $('#fields'), out = $('#out'), status = $('#status');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
let mode = 'd2r', used = false;

$('#basis').textContent = `법정 상한 연 ${cap.toFixed(2)}% = min(연 10%, 기준금리 ${BASE_RATE.rate.toFixed(2)}% + 2%) · 한국은행 ${BASE_RATE.decided} 결정 기준금리, ${BASE_RATE.checked} 확인`;
rateEl.value = cap;
rateEl.addEventListener('input', run);
$('#resetRate').addEventListener('click', () => { rateEl.value = cap; run(); });

function money(id, label, ph) {
  const input = h('input', { type: 'text', id, inputmode: 'numeric', placeholder: ph });
  input.addEventListener('input', () => {
    const v = input.value.replace(/[^\d]/g, '');
    input.value = v ? Number(v).toLocaleString('ko-KR') : '';
    run();
  });
  return h('label', { class: 'field' }, label, input);
}
const val = (id) => Number(($('#' + id)?.value || '').replace(/[^\d]/g, '')) || 0;

function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('#rateRow').style.display = m === 'rate' ? 'none' : '';
  fields.replaceChildren(...(m === 'd2r' ? [money('dep', '월세로 바꿀 보증금 (원)', '예: 100,000,000')]
    : m === 'r2d' ? [money('rent', '줄일 월세 (원)', '예: 500,000')]
    : [money('dd', '내려가는 보증금 (원)', '예: 50,000,000'), money('rd', '올라가는 월세 (원)', '예: 250,000')]));
  run();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => setMode(b.dataset.mode));

function run() {
  out.replaceChildren();
  const rate = Number(rateEl.value);
  setStatus(status, '');
  if (mode !== 'rate' && !(rate > 0)) { setStatus(status, '전환율을 0보다 크게 넣어 주세요.', 'warn'); return; }
  if (mode !== 'rate' && rate > cap) setStatus(status, `입력한 전환율(연 ${rate}%)이 보증금→월세 전환 법정 상한(연 ${cap}%)보다 높습니다.`, 'warn');
  if (mode === 'd2r') {
    const d = val('dep'); if (!d) return;
    out.append(h('p', { class: 'big' }, `월세 ${won(depositToRent(d, rate))} 증가`),
      h('p', { class: 'note' }, `${won(d)} × ${rate}% ÷ 12 · 1년이면 ${won(depositToRent(d, rate) * 12)}`));
  } else if (mode === 'r2d') {
    const r = val('rent'); if (!r) return;
    out.append(h('p', { class: 'big' }, `보증금 ${won(rentToDeposit(r, rate))} 증가`),
      h('p', { class: 'note' }, `${won(r)} × 12 ÷ ${rate}% · 월세→보증금 전환에는 법정 비율이 없어 참고용입니다.`));
  } else {
    const dd = val('dd'), rd = val('rd'); if (!dd || !rd) return;
    const ir = impliedRate(dd, rd);
    out.append(h('p', { class: 'big' }, `연 ${ir.toFixed(2)}%`),
      h('p', { class: 'note' }, `${won(rd)} × 12 ÷ ${won(dd)}`));
    if (ir > cap + 1e-9) setStatus(status, `법정 상한(연 ${cap}%)을 넘습니다. 상한으로 계산한 월세는 ${won(depositToRent(dd, cap))}입니다.`, 'bad');
    else setStatus(status, `법정 상한(연 ${cap}%) 이내입니다.`, 'ok');
  }
  if (!used) { used = true; track('tool_use', { tool: 'rent-conversion', mode }); }
}
setMode('d2r');
