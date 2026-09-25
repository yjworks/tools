import { $, h, setStatus, track } from '../_shared/ui.js';
import {
  HOLIDAYS, toDay, fromDay, weekdayName, daysBetween, addDays, businessDaysBetween, addBusinessDays,
  isBusinessDay, holidayName, isWeekend, outsideCoverage,
} from '../_shared/dday-calculator.js';

const status = $('#status');
const used = new Set();
let ready = false;
const n = (x) => x.toLocaleString('ko-KR');

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const today = () => toDay(todayStr());
function dateKo(d) {
  const [y, m, day] = fromDay(d).split('-').map(Number);
  return `${y}년 ${m}월 ${day}일 (${weekdayName(d)})`;
}
function dayTag(d) {
  if (isWeekend(d)) return holidayName(d) ? `주말 · ${holidayName(d)}` : '주말';
  return holidayName(d) || '';
}
function ddayLabel(d) {
  const diff = d - today();
  return diff === 0 ? 'D-Day (오늘)' : diff > 0 ? `D-${n(diff)}` : `D+${n(-diff)}`;
}
function mark(tab) { if (ready && !used.has(tab)) { used.add(tab); track('tool_use', { tool: 'dday-calculator', mode: tab }); } }
function coverageNote(a, b) {
  const ys = outsideCoverage(a, b);
  return ys.length ? h('p', { class: 'status warn' }, `${ys.join('·')}년은 공휴일 목록이 없어 주말만 빼고 계산했습니다.`) : null;
}

/* 탭 */
const tabs = [...document.querySelectorAll('[data-tab]')];
for (const t of tabs) t.addEventListener('click', () => {
  for (const x of tabs) x.setAttribute('aria-selected', String(x === t));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== t.dataset.tab;
  setStatus(status, '');
});

/* 1. 날짜 사이 */
const bA = $('#b-a'), bB = $('#b-b'), bInc = $('#b-inc'), bOut = $('#b-out');
function runBetween() {
  bOut.replaceChildren();
  const a = toDay(bA.value), b = toDay(bB.value);
  if (a === null || b === null) { bOut.append(h('span', { class: 'muted' }, '두 날짜를 골라 주세요.')); return; }
  const days = daysBetween(a, b, bInc.checked);
  const abs = Math.abs(days);
  bOut.append(
    h('div', { class: 'muted' }, `${dateKo(a)} → ${dateKo(b)}`),
    h('div', { class: 'out' }, bInc.checked ? `${n(days)}일째` : `${n(days)}일`),
    h('div', { class: 'muted' }, `${n(Math.floor(abs / 7))}주 ${abs % 7}일 · 약 ${(abs / 30.436875).toFixed(1)}개월 · 약 ${(abs / 365.2425).toFixed(2)}년`),
    h('div', { class: 'muted' }, `끝날은 오늘 기준 ${ddayLabel(b)}`),
  );
  mark('between');
}
[bA, bB].forEach((el) => { el.addEventListener('input', runBetween); el.addEventListener('change', runBetween); });
bInc.addEventListener('change', runBetween);

/* 2. 날짜 + N일 */
const aA = $('#a-a'), aN = $('#a-n'), aInc = $('#a-inc'), aOut = $('#a-out'), aQuick = $('#a-quick');
for (const q of [100, 200, 300, 365, 500, 1000, -30]) {
  aQuick.append(h('button', { type: 'button', class: 'small ghost', onclick: () => { aN.value = q; runAdd(); } }, `${q}일`));
}
function runAdd() {
  aOut.replaceChildren();
  const a = toDay(aA.value), k = Number(aN.value);
  if (a === null) { aOut.append(h('span', { class: 'muted' }, '기준일을 골라 주세요.')); return; }
  if (!Number.isInteger(k) || Math.abs(k) > 36500) { aOut.append(h('span', { class: 'muted' }, '날수는 −36,500 ~ 36,500 사이 정수로 넣어 주세요.')); return; }
  const inc = aInc.checked;
  const d = addDays(a, k, inc);
  const tag = dayTag(d);
  aOut.append(
    h('div', { class: 'muted' }, inc ? `${dateKo(a)}을 1일째로 셀 때 ${n(k)}일째` : `${dateKo(a)}에서 ${k >= 0 ? `${n(k)}일 뒤` : `${n(-k)}일 앞`}`),
    h('div', { class: 'out' }, dateKo(d)),
    h('div', { class: 'muted' }, [ddayLabel(d), tag].filter(Boolean).join(' · ')),
  );
  // 기념일 표
  const list = h('ul', { class: 'dd-list' });
  for (const m of [100, 200, 300, 500, 1000, 2000, 3000]) {
    const x = addDays(a, m, inc);
    list.append(h('li', {}, h('span', {}, `${m}일${inc ? '째' : ' 뒤'}`), h('span', {}, `${dateKo(x)} · ${ddayLabel(x)}`)));
  }
  for (const y of [1, 2, 3, 5, 10]) {
    const [yy, mm, dd] = fromDay(a).split('-').map(Number);
    let x = toDay(`${yy + y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
    if (x === null) x = toDay(`${yy + y}-03-01`); // 2월 29일 → 평년에는 3월 1일
    list.append(h('li', {}, h('span', {}, `${y}주년`), h('span', {}, `${dateKo(x)} · ${ddayLabel(x)}`)));
  }
  aOut.append(h('div', { class: 'muted', style: 'margin-top:12px' }, `기념일 표 (${inc ? '기준일 = 1일째' : '기준일 + N일'})`), list);
  mark('add');
}
[aA, aN].forEach((el) => { el.addEventListener('input', runAdd); el.addEventListener('change', runAdd); });
aInc.addEventListener('change', runAdd);

/* 3. 영업일 */
const zA = $('#z-a'), zB = $('#z-b'), zOut = $('#z-out');
function runBizCount() {
  zOut.replaceChildren();
  const a = toDay(zA.value), b = toDay(zB.value);
  if (a === null || b === null) { zOut.append(h('span', { class: 'muted' }, '두 날짜를 골라 주세요.')); return; }
  if (Math.abs(b - a) > 36500) { zOut.append(h('span', { class: 'muted' }, '100년 이내로 골라 주세요.')); return; }
  const r = businessDaysBetween(a, b);
  zOut.append(
    h('div', { class: 'muted' }, `${dateKo(Math.min(a, b))} ~ ${dateKo(Math.max(a, b))} (양 끝 포함 ${n(r.total)}일)`),
    h('div', { class: 'out' }, `${n(r.count)}영업일`),
    h('div', { class: 'muted' }, `주말 ${n(r.weekends)}일 · 평일 공휴일 ${r.holidays.length}일 제외`),
  );
  if (r.holidays.length) {
    const list = h('ul', { class: 'dd-list' });
    for (const [d, name] of r.holidays.slice(0, 60)) list.append(h('li', {}, h('span', {}, dateKo(toDay(d))), h('span', {}, name)));
    if (r.holidays.length > 60) list.append(h('li', {}, h('span', { class: 'muted' }, `외 ${r.holidays.length - 60}일`)));
    zOut.append(list);
  }
  const note = coverageNote(a, b); if (note) zOut.append(note);
  mark('biz');
}
[zA, zB].forEach((el) => { el.addEventListener('input', runBizCount); el.addEventListener('change', runBizCount); });

const yA = $('#y-a'), yN = $('#y-n'), yOut = $('#y-out');
function runBizAdd() {
  yOut.replaceChildren();
  const a = toDay(yA.value), k = Number(yN.value);
  if (a === null) { yOut.append(h('span', { class: 'muted' }, '기준일을 골라 주세요.')); return; }
  if (!Number.isInteger(k) || Math.abs(k) > 3650) { yOut.append(h('span', { class: 'muted' }, '영업일 수는 −3,650 ~ 3,650 사이 정수로 넣어 주세요.')); return; }
  const d = addBusinessDays(a, k);
  const skipped = businessDaysBetween(a, d).holidays.filter(([s]) => s !== fromDay(a));
  yOut.append(
    h('div', { class: 'muted' }, `${dateKo(a)}${isBusinessDay(a) ? '' : ' (휴일)'}에서 ${k >= 0 ? `${n(k)}영업일 뒤` : `${n(-k)}영업일 앞`}`),
    h('div', { class: 'out' }, dateKo(d)),
    h('div', { class: 'muted' }, `${ddayLabel(d)}${skipped.length ? ` · 건너뛴 공휴일: ${skipped.map(([s, name]) => `${+s.slice(5, 7)}/${+s.slice(8)} ${name}`).join(', ')}` : ''}`),
  );
  const note = coverageNote(a, d); if (note) yOut.append(note);
  mark('biz');
}
[yA, yN].forEach((el) => { el.addEventListener('input', runBizAdd); el.addEventListener('change', runBizAdd); });

/* 공휴일 전체 목록 */
const holList = $('#holList');
for (const [d, name] of HOLIDAYS) {
  const dn = toDay(d);
  holList.append(h('div', {}, `${d} (${weekdayName(dn)}) ${name}`));
}

/* 처음 값 */
const t = todayStr();
bA.value = t; bB.value = fromDay(today() + 100);
aA.value = t;
zA.value = t; zB.value = fromDay(today() + 30);
yA.value = t;
runBetween(); runAdd(); runBizCount(); runBizAdd();
ready = true;
