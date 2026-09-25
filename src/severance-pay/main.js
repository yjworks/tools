import { $, h, setStatus, track } from '../_shared/ui.js';
import { severance } from '../_shared/severance-pay.js';

const num = (el) => { const v = el.value.replace(/[^\d]/g, ''); return v ? Number(v) : 0; };
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const out = $('#out'), status = $('#status');
let used = false;

function fmtInput(e) {
  const el = e.target; const v = el.value.replace(/[^\d]/g, '');
  el.value = v ? Number(v).toLocaleString('ko-KR') : '';
}
for (const id of ['wage', 'bonus', 'leave', 'ordinary']) $('#' + id).addEventListener('input', (e) => { fmtInput(e); run(); });
for (const id of ['start', 'last']) $('#' + id).addEventListener('change', run);
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => {
  $('#lblWage').firstChild.textContent = r.value === 'month' && r.checked ? '월 임금 (세전, 원)' : '3개월 임금총액 (세전, 원)';
  run();
});

function row(label, value) { return h('tr', {}, h('td', {}, label), h('td', {}, value)); }

function run() {
  out.replaceChildren();
  const start = $('#start').value, last = $('#last').value;
  const wage = num($('#wage'));
  if (!start || !last || !wage) { setStatus(status, '입사일, 마지막 근무일, 임금을 넣으면 계산합니다.'); return; }
  const monthMode = document.querySelector('input[name=mode]:checked').value === 'month';
  const r = severance({ start, lastDay: last, wage3m: monthMode ? wage * 3 : wage, bonusYear: num($('#bonus')), leaveYear: num($('#leave')), ordinaryDaily: num($('#ordinary')) });
  if (r.error) { setStatus(status, r.error, 'bad'); return; }
  setStatus(status, '');
  const years = Math.floor(r.serviceDays / 365), rest = r.serviceDays % 365;
  out.append(
    h('p', { class: 'big' }, r.eligible ? `예상 퇴직금 ${won(r.pay)}` : '법정 퇴직금 지급 대상이 아닙니다'),
    r.eligible ? h('p', { class: 'note' }, '세전 금액입니다. 퇴직소득세·지방소득세는 따로 원천징수됩니다.')
      : h('p', { class: 'status warn' }, `계속근로기간이 1년 미만입니다(${r.serviceDays}일). 이 경우 법정 퇴직금 지급 의무가 없습니다. 참고로 1년 이상이었다면 ${won(r.pay)} 수준입니다.`),
    h('table', { class: 'res' },
      row('퇴직일 (마지막 근무일 다음 날)', r.retireDate),
      row('재직일수', `${r.serviceDays.toLocaleString('ko-KR')}일 (약 ${years}년 ${rest}일)`),
      row('평균임금 산정 기간', `${r.periodStart} ~ ${r.periodEnd} (${r.periodDays}일)`),
      row('3개월 임금', won(monthMode ? wage * 3 : wage)),
      row('상여금 가산 (×3/12)', won(r.bonusPart)),
      row('연차수당 가산 (×3/12)', won(r.leavePart)),
      row('3개월 임금총액', won(r.total3m)),
      row('1일 평균임금', `${r.avgDaily.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`),
      r.usedOrdinary ? row('적용: 1일 통상임금 (평균임금보다 높음)', `${r.daily.toLocaleString('ko-KR')}원`) : null,
      row('계산식', `${r.daily.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} × 30 × ${r.serviceDays} ÷ 365`),
    ),
  );
  if (!used) { used = true; track('tool_use', { tool: 'severance-pay' }); }
}
run();
