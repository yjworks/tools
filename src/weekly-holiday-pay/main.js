import { $, h, setStatus, track } from '../_shared/ui.js';
import { weeklyHolidayPay, MIN_WAGE, MIN_WEEKLY_HOURS } from '../_shared/weekly-holiday-pay.js';

const hourlyEl = $('#hourly'), hoursEl = $('#hours'), out = $('#out'), status = $('#status');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
let used = false;

hourlyEl.value = MIN_WAGE.hourly.toLocaleString('ko-KR');
hourlyEl.addEventListener('input', () => {
  const v = hourlyEl.value.replace(/[^\d]/g, '');
  hourlyEl.value = v ? Number(v).toLocaleString('ko-KR') : '';
  run();
});
hoursEl.addEventListener('input', run);

function row(label, value) { return h('tr', {}, h('td', {}, label), h('td', {}, value)); }

function run() {
  out.replaceChildren();
  const hourly = Number(hourlyEl.value.replace(/[^\d]/g, '')) || 0;
  const hours = Number(hoursEl.value) || 0;
  if (!hourly || !hours) { setStatus(status, '시급과 1주 소정근로시간을 넣어 주세요.'); return; }
  const r = weeklyHolidayPay(hourly, hours);
  if (r.belowMin) setStatus(status, `입력한 시급이 ${MIN_WAGE.year}년 최저임금(${won(MIN_WAGE.hourly)})보다 낮습니다. 최저임금법 위반일 수 있습니다.`, 'warn');
  else setStatus(status, '');
  if (!r.eligible) {
    out.append(h('p', { class: 'big' }, '주휴수당 대상이 아닙니다'),
      h('p', { class: 'note' }, `4주 평균 1주 소정근로시간이 ${MIN_WEEKLY_HOURS}시간 미만이면 주휴수당이 없습니다(근로기준법 제18조제3항).`));
  } else {
    out.append(h('p', { class: 'big' }, `1주 주휴수당 ${won(r.weekly)}`),
      h('p', { class: 'note' }, `(${hours}시간 ÷ 40) × 8 = 주휴 ${Number(r.holidayHours.toFixed(2))}시간 × ${won(hourly)} · 그 주 개근 조건`));
  }
  out.append(h('table', { class: 'res' },
    row('1주 근로 임금', won(r.weeklyWork)),
    row('1주 주휴수당', won(r.weekly)),
    row('1주 합계', won(r.weeklyWork + r.weekly)),
    row('월 주휴수당 (× 4.345주)', won(r.monthly)),
    row('월 예상 급여 (근로 + 주휴)', won(r.monthlyTotal)),
    row('월 유급 시간', `${r.monthlyHours.toFixed(1)}시간`),
  ));
  if (!used) { used = true; track('tool_use', { tool: 'weekly-holiday-pay' }); }
}
run();
