import { $, h, copyText, track } from '../_shared/ui.js';
import { Stopwatch, Countdown, formatCountdown, formatStopwatch, toDuration, lapsText } from '../_shared/timer.js';

const stage = $('#stage'), display = $('#display'), sub = $('#sub'), bar = $('#bar'), barFill = $('#bar i');
const startBtn = $('#startBtn'), resetBtn = $('#resetBtn'), lapBtn = $('#lapBtn'), fsBtn = $('#fsBtn');
const lapsEl = $('#laps'), copyLapsBtn = $('#copyLaps'), wakeInfo = $('#wakeInfo');
const KEY = 'dibrain-timer';
const baseTitle = document.title;

let mode = 'cd';
let savedMs = 5 * 60 * 1000;
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.ms > 0) savedMs = s.ms; } catch { /* 기본 5분 */ }
const cd = new Countdown(savedMs);
const sw = new Stopwatch();
let ended = false;

/* ---------- 소리: 파일 없이 Web Audio 로 삐 소리 ---------- */
let actx = null;
function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!actx && AC) actx = new AC();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
function beep(rounds = 3) {
  if (!actx) return;
  const t0 = actx.currentTime + 0.05;
  for (let r = 0; r < rounds; r++) for (let i = 0; i < 3; i++) {
    const t = t0 + r * 0.9 + i * 0.17;
    const osc = actx.createOscillator(), g = actx.createGain();
    osc.type = 'square'; osc.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g).connect(actx.destination);
    osc.start(t); osc.stop(t + 0.15);
  }
}

/* ---------- 화면 꺼짐 방지 ---------- */
let lock = null;
const wakeSupported = 'wakeLock' in navigator;
function showWake() {
  wakeInfo.textContent = !wakeSupported
    ? '이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다. 오래 켜 둘 때는 기기의 화면 자동 꺼짐 시간을 늘려 주세요.'
    : lock ? '화면 꺼짐 방지 켜짐 (돌아가는 동안 화면이 꺼지지 않습니다)' : '돌아가는 동안에는 화면이 꺼지지 않게 요청합니다.';
}
async function keepAwake(on) {
  if (!wakeSupported) return;
  try {
    if (on && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; showWake(); });
    } else if (!on && lock) { const l = lock; lock = null; await l.release(); }
  } catch { lock = null; /* 배터리 절약 모드 등에서 거절될 수 있다 */ }
  showWake();
}
const anyRunning = () => cd.running || sw.running;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && anyRunning()) keepAwake(true); });

/* ---------- 전체화면 (지원 안 하면 화면에 꽉 차게) ---------- */
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const isFs = () => !!fsElement() || stage.classList.contains('pseudo-fs');
function toggleFs() {
  if (fsSupported) {
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
  } else {
    const on = stage.classList.toggle('pseudo-fs');
    document.body.style.overflow = on ? 'hidden' : '';
    fsChanged();
  }
}
function fsChanged() { fsBtn.textContent = isFs() ? '전체화면 끝' : '전체화면'; lastLen = -1; fit(); }
document.addEventListener('fullscreenchange', fsChanged);
document.addEventListener('webkitfullscreenchange', fsChanged);

/* ---------- 표시 ---------- */
let lastLen = -1;
function fit() {
  const len = display.textContent.length;
  if (len === lastLen) return;
  lastLen = len;
  const w = stage.clientWidth - 24;
  const maxH = isFs() ? stage.clientHeight * 0.5 : 190;
  display.style.fontSize = `${Math.max(34, Math.min(maxH, w / (len * 0.6)))}px`;
}
new ResizeObserver(() => { lastLen = -1; fit(); }).observe(stage);

function render() {
  let text;
  if (mode === 'cd') {
    const rem = cd.remaining();
    text = formatCountdown(rem);
    barFill.style.transform = `scaleX(${cd.duration ? rem / cd.duration : 0})`;
    sub.textContent = ended ? '시간이 다 됐습니다' : cd.running ? '' : cd.remaining() < cd.duration ? '멈춤' : `${formatCountdown(cd.duration)} 타이머`;
    startBtn.textContent = ended ? '다시 시작' : cd.running ? '멈춤' : cd.remaining() < cd.duration ? '계속' : '시작';
  } else {
    text = formatStopwatch(sw.elapsed());
    sub.textContent = sw.running ? '' : sw.elapsed() ? '멈춤' : '스톱워치';
    startBtn.textContent = sw.running ? '멈춤' : sw.elapsed() ? '계속' : '시작';
  }
  if (display.textContent !== text) { display.textContent = text; fit(); }
  stage.classList.toggle('ended', mode === 'cd' && ended);
  lapBtn.disabled = !sw.running;
  const title = anyRunning() || ended
    ? `${ended ? '⏰ 끝' : cd.running ? formatCountdown(cd.remaining()) : formatStopwatch(sw.elapsed()).slice(0, -3)} · ${baseTitle}`
    : baseTitle;
  if (document.title !== title) document.title = title;
}

/* 끝났는지 확인: 화면 그리기(rAF)와 별도로 타이머에서도 확인해서 숨은 탭에서도 알린다 */
function check() {
  if (cd.running && cd.done) {
    cd.pause(); ended = true;
    if ($('#sound').checked) beep(3);
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    if (!sw.running) keepAwake(false);
    track('tool_use', { tool: 'timer', mode: 'countdown', seconds: Math.round(cd.duration / 1000) });
  }
}
let raf = 0;
function loop() { check(); render(); raf = anyRunning() ? requestAnimationFrame(loop) : 0; }
function kick() { if (!raf) raf = requestAnimationFrame(loop); render(); }
setInterval(() => { if (anyRunning()) { check(); if (document.hidden) render(); } }, 250);

/* ---------- 조작 ---------- */
function startStop() {
  ensureAudio();
  if (mode === 'cd') {
    if (ended) { ended = false; cd.reset(); }
    if (!cd.duration) return;
    cd.toggle();
  } else sw.toggle();
  keepAwake(anyRunning());
  kick();
}
function reset() {
  if (mode === 'cd') { cd.reset(); ended = false; }
  else { sw.reset(); renderLaps(); }
  keepAwake(anyRunning());
  kick();
}
function lap() {
  if (mode !== 'sw' || !sw.running) return;
  sw.lap(); renderLaps();
}
function renderLaps() {
  const laps = sw.laps;
  lapsEl.hidden = copyLapsBtn.hidden = !laps.length;
  if (!laps.length) { lapsEl.replaceChildren(); return; }
  const min = Math.min(...laps.map((l) => l.lap)), max = Math.max(...laps.map((l) => l.lap));
  lapsEl.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, '랩'), h('th', {}, '구간'), h('th', {}, '누적'))),
    h('tbody', {}, [...laps].reverse().map((l) => h('tr', {},
      h('td', {}, `${l.n}`),
      h('td', { style: laps.length > 2 && l.lap === min ? 'color:var(--ok)' : laps.length > 2 && l.lap === max ? 'color:var(--bad)' : null }, formatStopwatch(l.lap)),
      h('td', {}, formatStopwatch(l.total))))));
}
function setDuration(ms) {
  if (!ms) return;
  savedMs = ms; ended = false; cd.reset(ms);
  try { localStorage.setItem(KEY, JSON.stringify({ ms })); } catch { /* 무시 */ }
  $('#min').value = Math.floor(ms / 60000); $('#sec').value = Math.floor((ms % 60000) / 1000);
  for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('on', Number(b.dataset.min) * 60000 === ms);
  keepAwake(anyRunning());
  kick();
}
function setMode(m) {
  mode = m;
  $('#tabCd').setAttribute('aria-selected', m === 'cd'); $('#tabSw').setAttribute('aria-selected', m === 'sw');
  $('#cdOpts').hidden = m !== 'cd'; $('#swOpts').hidden = m !== 'sw';
  lapBtn.hidden = m !== 'sw'; bar.style.visibility = m === 'cd' ? 'visible' : 'hidden';
  lastLen = -1; kick();
}

startBtn.addEventListener('click', startStop);
resetBtn.addEventListener('click', reset);
lapBtn.addEventListener('click', lap);
fsBtn.addEventListener('click', toggleFs);
$('#tabCd').addEventListener('click', () => setMode('cd'));
$('#tabSw').addEventListener('click', () => setMode('sw'));
for (const b of document.querySelectorAll('#presets button')) b.addEventListener('click', () => setDuration(Number(b.dataset.min) * 60000));
$('#setBtn').addEventListener('click', () => setDuration(toDuration($('#min').value, $('#sec').value)));
$('#testSound').addEventListener('click', () => { ensureAudio(); beep(1); });
copyLapsBtn.addEventListener('click', () => copyText(lapsText(sw.laps), copyLapsBtn));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
    if (e.key === 'Enter' && (e.target.id === 'min' || e.target.id === 'sec')) $('#setBtn').click();
    return;
  }
  const k = e.key.toLowerCase();
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur(); // 버튼이 한 번 더 눌리지 않게
    startStop();
  } else if (k === 'r' || k === 'ㄱ') reset();
  else if (k === 'f' || k === 'ㄹ') toggleFs();
  else if (k === 'l' || k === 'ㅣ') lap();
  else if (e.key === 'Escape' && stage.classList.contains('pseudo-fs')) toggleFs();
});

$('#min').value = Math.floor(savedMs / 60000); $('#sec').value = Math.floor((savedMs % 60000) / 1000);
for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('on', Number(b.dataset.min) * 60000 === savedMs);
showWake();
setMode('cd');
