import { $, h, track } from '../_shared/ui.js';
import {
  PRESETS, sanitizeConfig, phaseAt, initialState, start, pause, elapsedMs, remainingMs, settle, skip, toSessions,
  dailyMinutes, todaySummary, prune, fmtClock, fmtMinutes, PHASE_NAME,
} from '../_shared/focus-timer.js';
import { Ambient, SOUNDS } from './audio.js';

const SLUG = 'focus-timer';
const K = { prefs: `${SLUG}:prefs`, state: `${SLUG}:state`, sessions: `${SLUG}:sessions` };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장이 막혀도 타이머는 돈다 */ } };

const prefs = {
  preset: 'p25', custom: { ...PRESETS.p25 }, autoBreak: true, autoFocus: false,
  chime: true, chimeVol: 0.6, notify: false, wake: false, master: 0.8, duckBreak: false, vols: {}, task: '',
  ...load(K.prefs, {}),
};
prefs.custom = sanitizeConfig(prefs.custom);
const savePrefs = () => save(K.prefs, prefs);
const cfg = () => (prefs.preset === 'custom' ? prefs.custom : PRESETS[prefs.preset] || PRESETS.p25);
const opts = () => ({ autoBreak: prefs.autoBreak, autoFocus: prefs.autoFocus });

let st = { ...initialState(), ...load(K.state, {}) };
let sessions = load(K.sessions, []);
if (!Array.isArray(sessions)) sessions = [];
const now = () => Date.now();

const amb = new Ambient();
const baseTitle = document.title;
const el = {
  stage: $('#stage'), phase: $('#phaseName'), digits: $('#digits'), prog: $('#prog'), dots: $('#dots'), sub: $('#sub'),
  task: $('#task'), start: $('#startBtn'), skip: $('#skipBtn'), reset: $('#resetBtn'), next: $('#nextInfo'),
};
const RING = 2 * Math.PI * 92;

/* ---------- 타이머 ---------- */
let endTimer = null;
function schedule() {
  clearTimeout(endTimer);
  if (st.running) endTimer = setTimeout(sync, Math.min(remainingMs(st, cfg(), now()) + 50, 2 ** 31 - 1));
}

function sync() {
  const r = settle(st, cfg(), now(), opts());
  st = r.state;
  if (r.finished.length) onFinished(r.finished);
  save(K.state, st);
  schedule();
  render();
  applyDuck();
  keepAwake(st.running && prefs.wake);
}

function logFinished(finished) {
  const add = toSessions(finished, el.task.value.trim());
  if (add.length) {
    sessions = prune([...sessions, ...add], now());
    save(K.sessions, sessions);
    renderStats();
  }
}

function onFinished(finished) {
  logFinished(finished);
  for (const f of finished) track('tool_use', { tool: SLUG, action: 'phase_end', phase: f.type, minutes: Math.round(f.ms / 60000) });
  const last = finished[finished.length - 1];
  if (now() - last.end > 5 * 60000) return; // 한참 전에 끝난 단계는 소리·알림 없이 기록만
  const next = phaseAt(st.index, cfg());
  if (prefs.chime) amb.chime(next.type === 'focus', prefs.chimeVol);
  navigator.vibrate?.([200, 100, 200]);
  if (document.hidden) notify(last.type === 'focus' ? '집중 시간이 끝났습니다' : '휴식이 끝났습니다',
    `다음: ${PHASE_NAME[next.type]} ${fmtMinutes(next.ms / 60000)}${st.running ? ' (시작됨)' : ''}`);
}

function toggle() {
  amb.ensure(); // 누른 순간에 소리 권한을 얻어 둔다(끝날 때 종소리)
  const t = now();
  if (st.running) st = pause(st, t);
  else { st = start(st, t); track('tool_use', { tool: SLUG, action: 'start', phase: phaseAt(st.index, cfg()).type }); }
  save(K.state, st);
  sync();
}

function doSkip() {
  const r = skip(st, cfg(), now());
  st = r.state;
  logFinished(r.finished);
  save(K.state, st);
  sync();
}

function doReset() {
  if (st.running || st.acc > 0) {
    const el0 = elapsedMs(st, now());
    if (phaseAt(st.index, cfg()).type === 'focus' && el0 > 0) logFinished(skip(st, cfg(), now()).finished);
  }
  st = initialState();
  save(K.state, st);
  sync();
}

el.start.addEventListener('click', toggle);
el.skip.addEventListener('click', doSkip);
el.reset.addEventListener('click', doReset);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName || '')) return;
  e.preventDefault();
  toggle();
});
el.task.value = prefs.task || '';
el.task.addEventListener('change', () => { prefs.task = el.task.value.trim(); savePrefs(); });

/* ---------- 화면 ---------- */
let lastText = '';
function render() {
  const c = cfg(), t = now();
  const p = phaseAt(st.index, c);
  const rem = remainingMs(st, c, t);
  const text = fmtClock(rem);
  if (text !== lastText) { el.digits.textContent = text; lastText = text; }
  el.stage.dataset.phase = p.type;
  el.phase.textContent = p.type === 'focus' ? `${PHASE_NAME.focus} ${p.round}번째` : PHASE_NAME[p.type];
  el.prog.style.strokeDashoffset = String(RING * (1 - rem / p.ms));
  const every = sanitizeConfig(c).every;
  const filled = p.type === 'focus' ? p.slot - 1 : p.slot;
  if (el.dots.childElementCount !== every) el.dots.replaceChildren(...Array.from({ length: every }, () => h('span')));
  [...el.dots.children].forEach((d, i) => d.classList.toggle('on', i < filled));
  el.sub.textContent = st.running ? '' : st.acc > 0 ? '멈춤' : p.type === 'focus' ? '시작을 누르세요' : '휴식을 시작하세요';
  el.start.textContent = st.running ? '멈춤' : st.acc > 0 ? '계속' : '시작';
  const n = phaseAt(st.index + 1, c);
  const auto = n.type === 'focus' ? prefs.autoFocus : prefs.autoBreak;
  el.next.textContent = `다음: ${PHASE_NAME[n.type]} ${fmtMinutes(n.ms / 60000)}${auto ? ' · 바로 시작' : ' · 누르면 시작'}`;
  const title = st.running ? `${text} ${PHASE_NAME[p.type]} · ${baseTitle}` : baseTitle;
  if (document.title !== title) document.title = title;
}

function frame() {
  if (st.running && remainingMs(st, cfg(), now()) <= 0) sync();
  else render();
  if (!document.hidden) requestAnimationFrame(frame);
}
setInterval(() => { if (document.hidden) { if (st.running && remainingMs(st, cfg(), now()) <= 0) sync(); else render(); } }, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { sync(); requestAnimationFrame(frame); }
});
window.addEventListener('pageshow', () => sync());

/* ---------- 설정 ---------- */
const cIn = { focus: $('#cFocus'), short: $('#cShort'), long: $('#cLong'), every: $('#cEvery') };
function renderCfg() {
  document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === prefs.preset)));
  const c = sanitizeConfig(cfg());
  for (const k of Object.keys(cIn)) { cIn[k].value = String(c[k]); cIn[k].disabled = prefs.preset !== 'custom'; }
  $('#cfgNote').textContent = `${c.every}번째 집중마다 짧은 휴식 대신 ${fmtMinutes(c.long)} 긴 휴식`;
}
document.querySelectorAll('#presets button').forEach((b) => b.addEventListener('click', () => {
  prefs.preset = b.dataset.p; savePrefs(); renderCfg(); sync();
}));
for (const inp of Object.values(cIn)) inp.addEventListener('change', () => {
  prefs.custom = sanitizeConfig({ focus: cIn.focus.value, short: cIn.short.value, long: cIn.long.value, every: cIn.every.value });
  savePrefs(); renderCfg(); sync();
});
for (const id of ['autoBreak', 'autoFocus', 'chimeOn', 'duckBreak']) {
  const key = id === 'chimeOn' ? 'chime' : id;
  const box = $(`#${id}`);
  box.checked = !!prefs[key];
  box.addEventListener('change', () => { prefs[key] = box.checked; savePrefs(); render(); applyDuck(); });
}
const chimeVol = $('#chimeVol');
chimeVol.value = String(prefs.chimeVol);
chimeVol.addEventListener('input', () => { prefs.chimeVol = Number(chimeVol.value); savePrefs(); });
$('#chimeTest').addEventListener('click', () => amb.chime(false, prefs.chimeVol));

/* ---------- 알림 ---------- */
const notifyInfo = $('#notifyInfo'), notifyBtn = $('#notifyBtn');
function renderNotify() {
  if (!('Notification' in window)) { notifyBtn.disabled = true; notifyInfo.textContent = '이 브라우저는 웹 알림을 지원하지 않습니다.'; return; }
  const p = Notification.permission;
  notifyBtn.textContent = prefs.notify && p === 'granted' ? '알림 끄기' : '다른 창을 볼 때 알림 받기';
  notifyInfo.textContent = p === 'denied' ? '알림이 차단되어 있습니다. 사이트 설정에서 허용해 주세요.'
    : prefs.notify && p === 'granted' ? '켜짐: 이 페이지가 숨어 있을 때 단계가 끝나면 알립니다.' : '';
}
notifyBtn.addEventListener('click', async () => {
  if (prefs.notify && Notification.permission === 'granted') prefs.notify = false;
  else {
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
    prefs.notify = p === 'granted';
  }
  savePrefs(); renderNotify();
});
async function notify(title, body) {
  if (!prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const o = { body, icon: './icon-192.png', tag: SLUG };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, o); return; }
  } catch { /* 아래 방식으로 */ }
  try { new Notification(title, o); } catch { /* 안드로이드 등은 서비스 워커로만 된다 */ }
}

/* ---------- 화면 꺼짐 방지 ---------- */
let lock = null;
const wakeInfo = $('#wakeInfo'), wakeBox = $('#wakeOn');
const wakeSupported = 'wakeLock' in navigator;
wakeBox.checked = prefs.wake;
function showWake() {
  wakeInfo.textContent = !wakeSupported ? '이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다.'
    : lock ? '화면 꺼짐 방지 켜짐' : prefs.wake ? '타이머가 돌 때 화면이 꺼지지 않게 요청합니다.' : '';
}
async function keepAwake(on) {
  if (!wakeSupported) { showWake(); return; }
  try {
    if (on && !lock && !document.hidden) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; showWake(); });
    } else if (!on && lock) { const l = lock; lock = null; await l.release(); }
  } catch { lock = null; }
  showWake();
}
wakeBox.addEventListener('change', () => { prefs.wake = wakeBox.checked; savePrefs(); keepAwake(st.running && prefs.wake); });

/* ---------- 배경 소리 ---------- */
const mixer = $('#mixer'), audioInfo = $('#audioInfo');
const sndBtns = {};
for (const s of SOUNDS) {
  const vol = prefs.vols[s.id] ?? 0.5;
  amb.vol[s.id] = vol;
  const out = h('output', {}, `${Math.round(vol * 100)}`);
  const btn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    if (amb.isOn(s.id)) amb.stop(s.id); else amb.start(s.id);
    btn.setAttribute('aria-pressed', String(amb.isOn(s.id)));
    applyDuck(); renderAudio();
    if (amb.isOn(s.id)) track('tool_use', { tool: SLUG, action: 'sound', sound: s.id });
  } }, s.name);
  const range = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(vol), 'aria-label': `${s.name} 크기` });
  range.addEventListener('input', () => { const v = Number(range.value); amb.setVol(s.id, v); out.textContent = `${Math.round(v * 100)}`; prefs.vols[s.id] = v; savePrefs(); });
  sndBtns[s.id] = btn;
  mixer.append(h('div', { class: 'ft-snd' }, btn, range, out));
}
const masterVol = $('#masterVol');
masterVol.value = String(prefs.master);
amb.masterVol = prefs.master;
masterVol.addEventListener('input', () => { prefs.master = Number(masterVol.value); amb.setMaster(prefs.master); savePrefs(); });
$('#stopAll').addEventListener('click', () => { amb.stopAll(); for (const b of Object.values(sndBtns)) b.setAttribute('aria-pressed', 'false'); renderAudio(); });
function applyDuck() {
  const p = phaseAt(st.index, cfg());
  amb.setDuck(prefs.duckBreak && st.running && p.type !== 'focus');
}
function renderAudio() {
  if (!amb.supported) { audioInfo.textContent = '이 브라우저는 Web Audio를 지원하지 않아 소리를 낼 수 없습니다.'; mixer.querySelectorAll('button').forEach((b) => (b.disabled = true)); return; }
  const on = SOUNDS.filter((s) => amb.isOn(s.id)).map((s) => s.name);
  audioInfo.textContent = on.length ? `재생 중: ${on.join(', ')}` : '';
}

/* ---------- 기록 ---------- */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
function renderStats() {
  const t = now();
  const days = dailyMinutes(sessions, t, 7);
  const today = todaySummary(sessions, t);
  const week = days.reduce((a, d) => a + d.minutes, 0);
  $('#tToday').textContent = fmtMinutes(today.minutes);
  $('#tDone').textContent = `${today.done}번`;
  $('#tWeek').textContent = fmtMinutes(week);
  $('#tAvg').textContent = fmtMinutes(week / 7);

  // 막대그래프: 한 가지 값(분)이라 한 색, 오늘과 가장 많은 날만 숫자를 붙이고 나머지는 눌러서 본다
  const svg = $('#chartSvg'), W = Math.max(280, svg.clientWidth || 600), H = 190, top = 22, bottom = 30;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const max = Math.max(30, ...days.map((d) => d.minutes));
  const colW = W / 7, barW = Math.min(44, colW * 0.56), ph = H - top - bottom;
  const maxIdx = days.reduce((m, d, i) => (d.minutes > days[m].minutes ? i : m), 0);
  const tip = $('#tip');
  days.forEach((d, i) => {
    const x = i * colW + (colW - barW) / 2;
    const bh = d.minutes > 0 ? Math.max(3, (d.minutes / max) * ph) : 0;
    const y = top + ph - bh;
    const g = svgEl('g', { class: 'col' });
    const hit = svgEl('rect', { class: 'hit', x: i * colW, y: 0, width: colW, height: H });
    g.append(hit);
    if (bh) {
      const r = Math.min(4, barW / 2, bh);
      g.append(svgEl('path', { class: 'bar', d: `M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + bh}Z` }));
    }
    const isToday = i === 6;
    if (d.minutes > 0 && (isToday || i === maxIdx)) {
      const v = svgEl('text', { class: 'val', x: x + barW / 2, y: y - 6, 'text-anchor': 'middle' }); v.textContent = fmtMinutes(d.minutes); g.append(v);
    }
    const lab = svgEl('text', { class: isToday ? 'today' : '', x: i * colW + colW / 2, y: H - 8, 'text-anchor': 'middle' });
    lab.textContent = isToday ? '오늘' : WD[d.weekday];
    g.append(lab);
    const date = new Date(d.date);
    const show = () => {
      svg.querySelectorAll('.col.sel').forEach((c) => c.classList.remove('sel'));
      g.classList.add('sel');
      tip.textContent = `${date.getMonth() + 1}월 ${date.getDate()}일 (${WD[d.weekday]}) · ${fmtMinutes(d.minutes)}`;
      tip.hidden = false;
      const box = svg.getBoundingClientRect(), sx = box.width / W;
      tip.style.left = `${Math.min(box.width - 70, Math.max(70, (i * colW + colW / 2) * sx))}px`;
      tip.style.top = `${Math.max(16, (y - 4) * sx)}px`;
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('click', show);
    hit.addEventListener('mouseleave', () => { tip.hidden = true; g.classList.remove('sel'); });
    svg.append(g);
  });
  svg.append(svgEl('line', { class: 'base', x1: 0, x2: W, y1: top + ph + 0.5, y2: top + ph + 0.5 }));
  $('#chartTable').replaceChildren(h('caption', {}, '최근 7일 집중 시간'),
    ...days.map((d) => { const dt = new Date(d.date); return h('tr', {}, h('th', {}, `${dt.getMonth() + 1}월 ${dt.getDate()}일`), h('td', {}, fmtMinutes(d.minutes))); }));

  const ul = $('#labels');
  ul.replaceChildren(...(today.labels.length
    ? today.labels.map((l) => h('li', {}, h('span', {}, l.label || '(할 일 이름 없음)'), h('span', {}, fmtMinutes(l.minutes))))
    : [h('li', { class: 'muted' }, h('span', {}, '오늘은 아직 기록이 없습니다.'))]));
}
$('#clearRec').addEventListener('click', () => {
  if (!confirm('이 기기에 저장된 집중 기록을 모두 지울까요?')) return;
  sessions = []; save(K.sessions, sessions); renderStats();
});
new ResizeObserver(() => renderStats()).observe($('#chart'));

/* ---------- 시작 ---------- */
renderCfg();
renderNotify();
renderAudio();
showWake();
sync();
renderStats();
requestAnimationFrame(frame);

/* 확인용: 숫자·상태만 (할 일 이름은 담지 않음) */
window.__focusTimer = {
  state: () => ({ ...st, phase: phaseAt(st.index, cfg()).type, remaining: remainingMs(st, cfg(), now()) }),
  sessions: () => sessions.map(({ s, e, done }) => ({ s, e, done })),
  audio: () => ({ ctx: amb.ctx ? amb.ctx.state : null, on: SOUNDS.filter((s) => amb.isOn(s.id)).map((s) => s.id) }),
};
