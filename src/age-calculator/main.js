import { $, h, setStatus, track } from '../_shared/ui.js';
import { parseDate, calcAge } from '../_shared/age-calculator.js';

const birth = $('#birth'), ref = $('#ref'), cards = $('#cards'), status = $('#status');
let used = false;

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dateKo = (o) => `${o.y}년 ${o.m}월 ${o.d}일 (${WEEK[new Date(Date.UTC(o.y, o.m - 1, o.d)).getUTCDay()]})`;
const n = (x) => x.toLocaleString('ko-KR');

function card(label, value, sub, main = false) {
  return h('div', { class: 'ag-card' + (main ? ' main' : '') }, h('small', {}, label), h('b', {}, value), sub ? h('small', {}, sub) : null);
}

function run() {
  cards.replaceChildren();
  if (!ref.value) ref.value = todayStr();
  const b = parseDate(birth.value), r = parseDate(ref.value);
  if (!birth.value) { setStatus(status, '생년월일을 골라 주세요.'); return; }
  if (!b || !r) { setStatus(status, '날짜를 다시 확인해 주세요.', 'warn'); return; }
  const a = calcAge(b, r);
  if (!a) { setStatus(status, '기준일이 생년월일보다 앞입니다.', 'warn'); return; }

  const isToday = ref.value === todayStr();
  setStatus(status, `${isToday ? '오늘' : '기준일'} ${dateKo(r)} 기준`, a.todayIsBirthday ? 'ok' : '');
  const manSub = a.man === 0 ? `생후 ${a.months}개월` : (a.todayIsBirthday ? '오늘이 생일입니다' : null);
  const nb = a.todayIsBirthday ? `다음 생일 ${dateKo(a.nextBirthday)}` : dateKo(a.nextBirthday);
  cards.append(
    card('만 나이', `${a.man}세`, manSub, true),
    card('연 나이', `${a.yeon}세`, `${r.y} − ${b.y}`),
    card('세는 나이', `${a.counting}세`, '연 나이 + 1'),
    card(`다음 생일 (만 ${a.nextAge}세)`, `D-${n(a.daysToNext)}`, nb),
    card('살아온 날수', `${n(a.daysLived)}일`, `태어난 날부터 ${n(a.dayCount)}일째`),
  );
  if (!used) { used = true; track('tool_use', { tool: 'age-calculator' }); }
}

$('#today').addEventListener('click', () => { ref.value = todayStr(); run(); });
birth.addEventListener('input', run);
ref.addEventListener('input', run);
birth.addEventListener('change', run);
ref.addEventListener('change', run);
ref.value = todayStr();
run();
