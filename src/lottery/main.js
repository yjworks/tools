import { $, h, setStatus, copyText, track } from '../_shared/ui.js';
import { randInt } from '../_shared/random.js';
import { parseNames, parsePrizes, buildSlots, createDraw, drawAll, resultsText, distinctCount } from '../_shared/lottery.js';

const namesEl = $('#names'), prizesEl = $('#prizes'), countEl = $('#count'), dupEl = $('#dup');
const drawBtn = $('#draw'), restartBtn = $('#restart'), copyBtn = $('#copy');
const stPrize = $('#stPrize'), stName = $('#stName'), stSub = $('#stSub'), resultsEl = $('#results'), status = $('#status'), info = $('#info');
const KEY = 'dibrain-lottery';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let session = null;   // { draw, slots, results, names, allowDuplicate, when }
let busy = false;
let shown = { results: [], when: null };   // 화면에 나온 결과 (복사용)

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) { namesEl.value = saved.names ?? namesEl.value; prizesEl.value = saved.prizes ?? ''; countEl.value = saved.count || 1; dupEl.checked = !!saved.dup; }
} catch { /* 저장소를 못 쓰면 기본값 */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ names: namesEl.value, prizes: prizesEl.value, count: countEl.value, dup: dupEl.checked })); } catch { /* 무시 */ } };

const mode = () => document.querySelector('input[name=mode]:checked').value;

function setup() {
  const names = parseNames(namesEl.value);
  const prizes = parsePrizes(prizesEl.value);
  const slots = buildSlots(prizes, Math.min(1000, Number(countEl.value) || 0));
  return { names, prizes, slots, allowDuplicate: dupEl.checked };
}

function refreshInfo() {
  const { names, prizes, slots, allowDuplicate } = setup();
  countEl.disabled = prizes.length > 0;
  if (prizes.length) countEl.value = slots.length;
  const people = distinctCount(names);
  let text = `참가자 ${names.length}명${people !== names.length ? ` (서로 다른 이름 ${people}명)` : ''} · 당첨 ${slots.length}자리`;
  if (!allowDuplicate && slots.length > people && people) text += ' · 자리가 사람보다 많습니다';
  info.textContent = text;
}

function reset(msg = '뽑기를 누르세요') {
  session = null;
  resultsEl.replaceChildren(); copyBtn.disabled = true; $('#when').textContent = '';
  shown = { results: [], when: null };
  stPrize.textContent = ''; stName.textContent = '?'; stName.className = 'name'; stSub.textContent = msg;
  drawBtn.disabled = false; drawBtn.textContent = mode() === 'one' ? '한 명 뽑기' : '뽑기';
  setStatus(status, '');
}

function start() {
  const s = setup();
  if (!s.names.length) throw new Error('참가자를 한 명 이상 적어 주세요.');
  if (!s.slots.length) throw new Error('당첨 개수를 1 이상으로 정해 주세요.');
  if (!s.allowDuplicate && s.slots.length > distinctCount(s.names)) {
    throw new Error(`당첨 자리(${s.slots.length})가 참가자(${distinctCount(s.names)}명)보다 많습니다. 중복 당첨을 허용하거나 자리를 줄여 주세요.`);
  }
  resultsEl.replaceChildren();
  session = { ...s, draw: createDraw(s.names, { allowDuplicate: s.allowDuplicate }), results: [], when: new Date() };
  shown = { results: session.results, when: session.when };
}

/* 슬롯머신처럼 이름이 돌다가 멈춘다. 당첨자는 이미 정해져 있고 이것은 보여 주기만 한다. */
function roll(pool, winner, prize, sub) {
  stPrize.textContent = prize || '';
  stSub.textContent = '';
  if (reduced || pool.length < 2) { land(winner, sub); return Promise.resolve(); }
  return new Promise((resolve) => {
    const t0 = performance.now(), dur = 1500;
    stName.className = 'name rolling';
    const tick = () => {
      const t = (performance.now() - t0) / dur;
      if (t >= 1) { land(winner, sub); resolve(); return; }
      stName.textContent = pool[randInt(pool.length)];
      setTimeout(tick, 40 + 220 * t * t);
    };
    tick();
  });
}
function land(winner, sub) {
  stName.textContent = winner;
  stName.className = 'name';
  void stName.offsetWidth; // 애니메이션 다시 시작
  stName.className = 'name pop';
  stSub.textContent = sub;
}

function addCard(r, i, delay = 0) {
  const li = h('li', { class: reduced ? '' : 'flip', style: delay ? `animation-delay:${delay}ms` : null },
    h('div', { class: 'no' }, `${i + 1}번째`),
    r.prize ? h('div', { class: 'pz', title: r.prize }, r.prize) : null,
    h('b', {}, r.name));
  resultsEl.append(li);
}

function finish() {
  copyBtn.disabled = !shown.results.length;
  const pad = (n) => String(n).padStart(2, '0'), w = shown.when;
  $('#when').textContent = `추첨 시각 ${pad(w.getHours())}:${pad(w.getMinutes())}:${pad(w.getSeconds())}`;
}

async function onDraw() {
  if (busy) return;
  setStatus(status, '');
  try {
    if (!session) start();
  } catch (e) { setStatus(status, e.message, 'bad'); return; }
  busy = true; drawBtn.disabled = true;
  const pool = [...new Set(session.names)];
  try {
    if (mode() === 'all' && session.results.length === 0) {
      const res = drawAll(session.names, session.slots, { allowDuplicate: session.allowDuplicate });
      session.results = res; shown.results = res;
      await roll(pool, res.length === 1 ? res[0].name : `${res.length}명 당첨`, res.length === 1 ? res[0].prize : '', res.length === 1 ? '축하합니다' : '아래 결과를 확인하세요');
      res.forEach((r, i) => addCard(r, i, Math.min(i, 30) * 120));
      finish();
      drawBtn.textContent = '다시 뽑기';
      session = null; // 다음 뽑기는 새 추첨
      track('tool_use', { tool: 'lottery', mode: 'all', people: pool.length, slots: res.length });
    } else {
      const i = session.results.length;
      const prize = session.slots[i];
      const name = session.draw.next();
      const r = { prize, name };
      session.results.push(r);
      const left = session.slots.length - session.results.length;
      await roll(pool, name, prize, left ? `남은 자리 ${left}개` : '추첨이 끝났습니다');
      addCard(r, i);
      finish();
      if (!left) { drawBtn.textContent = '다시 뽑기'; session = null; track('tool_use', { tool: 'lottery', mode: 'one', people: pool.length, slots: i + 1 }); }
      else drawBtn.textContent = '다음 한 명 뽑기';
    }
  } finally {
    busy = false; drawBtn.disabled = false;
  }
}

copyBtn.addEventListener('click', () => copyText(resultsText(shown.results, shown.when || new Date()), copyBtn));

drawBtn.addEventListener('click', onDraw);
restartBtn.addEventListener('click', () => reset());
for (const el of [namesEl, prizesEl, countEl, dupEl]) el.addEventListener('input', () => { save(); refreshInfo(); if (!busy) reset('명단이 바뀌어 처음부터 뽑습니다'); });
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => { if (!busy) reset(); });
refreshInfo();
reset();
