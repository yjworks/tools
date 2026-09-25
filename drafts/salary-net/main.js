import { $, h, setStatus, track } from '../_shared/ui.js';
import { salaryNet, RATES } from '../_shared/salary-net.js';

const out = $('#out'), status = $('#status');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const num = (id) => { const v = $('#' + id).value.replace(/[^\d]/g, ''); return v ? Number(v) : 0; };
let used = false;

for (let i = 1; i <= 11; i++) $('#family').append(h('option', { value: i }, `${i}명`));
function fillChildren() {
  const max = Number($('#family').value) - 1, cur = Math.min(Number($('#children').value) || 0, max);
  $('#children').replaceChildren(...Array.from({ length: max + 1 }, (_, i) => h('option', { value: i }, `${i}명`)));
  $('#children').value = cur;
}
fillChildren();

for (const id of ['annual', 'meal', 'override']) $('#' + id).addEventListener('input', (e) => {
  const v = e.target.value.replace(/[^\d]/g, '');
  e.target.value = v ? Number(v).toLocaleString('ko-KR') : '';
  run();
});
$('#family').addEventListener('change', () => { fillChildren(); run(); });
$('#children').addEventListener('change', run);
$('#ratio').addEventListener('change', run);

function row(label, value, sub, cls) {
  return h('tr', { class: cls }, h('td', {}, label, sub ? h('small', {}, sub) : null), h('td', {}, value));
}

function run() {
  out.replaceChildren();
  const annual = num('annual');
  if (!annual) { setStatus(status, '연봉을 넣으면 계산합니다.'); return; }
  setStatus(status, '');
  const ov = $('#override').value.trim();
  const r = salaryNet({ annual, meal: num('meal'), family: $('#family').value, children: $('#children').value, ratio: $('#ratio').value, taxOverride: ov ? num('override') : null });
  const taxTag = r.estimated ? h('span', { class: 'tag' }, '추정치') : h('span', { class: 'tag' }, '직접 입력');
  out.append(
    h('p', { class: 'big' }, `월 실수령액 ${won(r.net)}`),
    h('p', { class: 'note' }, `연 환산 약 ${won(r.annualNet)} · 세전 월 ${won(r.monthlyGross)} 중 공제 ${won(r.deductions)}`),
    h('table', { class: 'res' },
      row('세전 월급', won(r.monthlyGross), `과세 급여 ${won(r.taxable)} + 비과세 ${won(r.taxFree)}`),
      row('국민연금', won(r.pension), `4.75% · 기준소득월액 ${RATES.pension.min / 1e4}만~${RATES.pension.max / 1e4}만 원`),
      row('건강보험', won(r.health), '3.595%'),
      row('장기요양보험', won(r.care), '건강보험료 × 0.9448/7.19'),
      row('고용보험', won(r.employment), '0.9%'),
      h('tr', {}, h('td', {}, '소득세 ', taxTag,
        h('small', {}, r.estimated ? `간이세액표 방식 추정 ${won(r.tableTax)}${r.childDed ? ` − 자녀 공제 ${won(r.childDed)}` : ''}${r.ratio !== 100 ? ` × ${r.ratio}%` : ''}` : `입력한 세액${r.ratio !== 100 ? ` × ${r.ratio}%` : ''}`)),
        h('td', {}, won(r.incomeTax))),
      row('지방소득세', won(r.localTax), '소득세 × 10%'),
      row('공제 합계', won(r.deductions), null, 'sum'),
      row('실수령액', won(r.net), null, 'sum'),
    ),
    h('p', { class: 'note' }, r.estimated
      ? '소득세는 공식 간이세액표와 한 줄씩 대조하지 못한 추정치입니다. 정확한 값은 홈택스 간이세액표에서 찾아 "소득세 직접 입력"에 넣으세요.'
      : '소득세는 직접 입력한 간이세액표 금액을 썼습니다.'),
  );
  if (num('meal') > RATES.mealTaxFree) setStatus(status, `식대는 월 ${won(RATES.mealTaxFree)}까지만 비과세라 넘는 금액은 과세 급여로 계산했습니다.`, 'warn');
  if (!used) { used = true; track('tool_use', { tool: 'salary-net' }); }
}
run();
