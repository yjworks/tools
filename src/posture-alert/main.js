import { $, h, setStatus, track } from '../_shared/ui.js';
import {
  MODEL, WASM_BYTES, SENSITIVITY, REASON_TEXT, LM, frameMetrics, calibrate, deviation, smoothMetrics,
  createMonitor, createBreakTimer, STATS_KEY, SETTINGS_KEY, BASELINE_KEY, dayKey, parseStore, addTime, addEvent,
  prune, summarize, fmtDuration, fmtMB, backgroundSupport,
} from '../_shared/posture-alert.js';

const SLUG = 'posture-alert';

/* MediaPipe(tasks-vision 1.0.x)는 1분마다 사용 통계(작업 종류·처리 속도 등, 영상은 아님)를
   odml.pa.googleapis.com 으로 보내려 한다. 이 도구는 모델을 받기만 하고 아무것도 보내지 않기로 했으므로
   그 요청만 네트워크에 나가기 전에 끊는다(빈 응답을 받으면 라이브러리가 통계 보내기를 멈춘다). */
if (typeof window.fetch === 'function') {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (/^https:\/\/odml\.pa\.googleapis\.com\//.test(url)) return Promise.resolve(new Response(null, { status: 204 }));
    return realFetch(input, init);
  };
}
const tool =$('#tool'), status = $('#status');
const video = $('#video'), overlay = $('#overlay'), stage = $('#stage'), placeholder = $('#placeholder');
const countEl = $('#count'), chip = $('#chip'), chipText = $('#chipText');
const loadBox = $('#loadBox'), loadText = $('#loadText'), loadBar = $('#loadBar');
const live = $('#live'), liveTitle = $('#liveTitle'), liveSub = $('#liveSub'), meter = $('#meter');
const banner = $('#banner'), bannerText = $('#bannerText');
const btn = { start: $('#start'), calib: $('#calib'), useSaved: $('#useSaved'), pip: $('#pip'), pause: $('#pause'), recalib: $('#recalib'), stop: $('#stop') };
const form = { sens: $('#sens'), hold: $('#hold'), cool: $('#cool'), brk: $('#brk'), fps: $('#fps'), vol: $('#vol'), vib: $('#vib'), wake: $('#wake'), dots: $('#dots') };

/* ---------- 저장(이 기기에만) ---------- */
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 공간을 못 쓰면 이번 방문 동안만 */ } },
};
const DEFAULTS = { sens: 'mid', hold: 15, cool: 60, brk: 0, fps: 2, vol: 60, vib: true, wake: true, dots: true };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(ls.get(SETTINGS_KEY) || '{}') }; } catch { /* 기본값 */ }
if (!SENSITIVITY[settings.sens]) settings.sens = 'mid';

let stats = prune(parseStore(ls.get(STATS_KEY)), Date.now());
let statsDirty = false;
function saveStats() { if (!statsDirty) return; ls.set(STATS_KEY, JSON.stringify(stats)); statsDirty = false; }

function loadBaseline() {
  try { const b = JSON.parse(ls.get(BASELINE_KEY) || 'null'); return b && b.baseline && b.baseline.neck > 0 ? b : null; } catch { return null; }
}

/* ---------- 환경 확인 ---------- */
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const hasDocPip = 'documentPictureInPicture' in window;
const hasVideoPip = !!document.pictureInPictureEnabled && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
const bg = backgroundSupport({ documentPip: hasDocPip, videoPip: hasVideoPip, mobile });
$('#bgNote').textContent = bg.text;

const unsupported = !navigator.mediaDevices?.getUserMedia ? '이 브라우저는 카메라를 쓸 수 없습니다. 최신 크롬·엣지·사파리·파이어폭스에서 열어 주세요.'
  : typeof WebAssembly !== 'object' ? '이 브라우저는 자세 인식에 필요한 기능(WebAssembly)을 지원하지 않습니다.'
  : !window.isSecureContext ? '카메라는 보안 연결(https)에서만 쓸 수 있습니다.' : '';
if (unsupported) { const u = $('#unsupported'); u.textContent = unsupported; u.hidden = false; btn.start.disabled = true; }

const wasmName = { simd: 'vision_wasm_internal', nosimd: 'vision_wasm_nosimd_internal' };
const WASM_BASE = new URL('../mediapipe/1.0.1/', location.href).href;
(async () => {
  const total = MODEL.bytes + WASM_BYTES.simd;
  let cached = false;
  try { cached = !!(await (await caches.open('dbt-models-posture-alert')).match(MODEL.url)); } catch { /* 캐시를 못 읽으면 받는다고 안내 */ }
  $('#dlNote').textContent = cached
    ? '자세 인식 모델은 이 기기에 받아 둔 것을 씁니다.'
    : `처음 시작할 때 자세 인식 모델(${fmtMB(MODEL.bytes)})과 실행 파일(${fmtMB(WASM_BYTES.simd)})을 한 번 받습니다(합계 약 ${fmtMB(total)}). 다음부터는 기기에 저장된 파일을 씁니다.`;
})();

/* ---------- 설정 화면 ---------- */
function paintSettings() {
  form.sens.value = settings.sens; form.hold.value = String(settings.hold); form.cool.value = String(settings.cool);
  form.brk.value = String(settings.brk); form.fps.value = String(settings.fps); form.vol.value = String(settings.vol);
  form.vib.checked = !!settings.vib; form.wake.checked = !!settings.wake; form.dots.checked = !!settings.dots;
  $('#volText').textContent = settings.vol ? `${settings.vol}%` : '(소리 끔)';
  form.vib.disabled = !('vibrate' in navigator); form.wake.disabled = !('wakeLock' in navigator);
}
paintSettings();
for (const [k, el] of Object.entries(form)) {
  el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    settings[k] = el.type === 'checkbox' ? el.checked : ['sens'].includes(k) ? el.value : Number(el.value);
    ls.set(SETTINGS_KEY, JSON.stringify(settings));
    paintSettings();
    applySettings(k);
  });
}
function applySettings(k) {
  if (monitor) monitor.set({ holdMs: settings.hold * 1000, cooldownMs: settings.cool * 1000 });
  if (breakTimer && k === 'brk') breakTimer.setInterval(settings.brk * 60000);
  if (k === 'fps' && phase === 'monitoring') ticker.start(1000 / settings.fps);
  if (k === 'wake') settings.wake && phase === 'monitoring' ? lockWake() : releaseWake();
  if (k === 'dots' && !settings.dots) clearOverlay();
}

/* ---------- 소리·진동·알림 창 ---------- */
let audio = null;
function ensureAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
  return audio;
}
function beep(kind = 'posture') {
  const vol = settings.vol / 100;
  const ctx = vol > 0 ? ensureAudio() : null;
  if (!ctx) return;
  const notes = kind === 'rest' ? [[523.25, 0, 0.5], [659.25, 0.22, 0.6]] : [[880, 0, 0.18], [660, 0.22, 0.26]];
  const t0 = ctx.currentTime + 0.02;
  for (const [f, at, len] of notes) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.4 * vol, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + at); o.stop(t0 + at + len + 0.05);
  }
}
function vibrate() { if (settings.vib && 'vibrate' in navigator) try { navigator.vibrate([180, 90, 180]); } catch { /* 없음 */ } }

function paintNotif() {
  const b = $('#notif'), t = $('#notifText');
  if (!('Notification' in window)) { b.hidden = true; t.textContent = '이 브라우저는 알림 창을 지원하지 않습니다.'; return; }
  const p = Notification.permission;
  b.hidden = p !== 'default';
  t.textContent = p === 'granted' ? '알림 창 허용됨 · 다른 창을 보고 있을 때 알림 창으로도 알려 드립니다.'
    : p === 'denied' ? '알림 창이 차단되어 있습니다. 주소창의 사이트 설정에서 바꿀 수 있습니다.' : '';
}
paintNotif();
$('#notif').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* 옛 브라우저 */ }
  paintNotif();
  track('tool_use', { tool: SLUG, action: 'notify_permission', result: Notification.permission });
});
$('#testSound').addEventListener('click', () => { beep('posture'); vibrate(); });

async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return; // 보고 있으면 화면 안내로 충분
  const opts = { body, tag: SLUG, renotify: true, icon: './icon-192.png', silent: settings.vol > 0 };
  try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); n.close(); }; return; } catch { /* 안드로이드는 서비스 워커로 */ }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.showNotification(title, opts); } catch { /* 못 띄우면 소리·화면 안내만 */ }
}

/* ---------- 화면 꺼짐 막기 ---------- */
let wakeLock = null;
async function lockWake() {
  if (!settings.wake || !('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
}
function releaseWake() { wakeLock?.release().catch(() => {}); wakeLock = null; }

/* ---------- 카메라 ---------- */
let stream = null;
function cameraError(e) {
  switch (e?.name) {
    case 'NotAllowedError': return '카메라 권한이 거부되었습니다. 주소창의 자물쇠(사이트 정보) 아이콘에서 카메라를 허용한 뒤 새로고침해 주세요.';
    case 'NotFoundError': return '카메라를 찾지 못했습니다. 카메라가 연결되어 있는지 확인해 주세요.';
    case 'NotReadableError': return '카메라를 열 수 없습니다. 화상회의 프로그램 등 다른 프로그램이 카메라를 쓰고 있는지 확인해 주세요.';
    default: return `카메라를 켜지 못했습니다: ${e?.message || e}`;
  }
}
async function openCamera() {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } }, audio: false,
  });
  video.srcObject = stream;
  video.hidden = false; placeholder.hidden = true;
  await video.play().catch(() => {});
  if (video.readyState < 2) await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  video.srcObject = null;
}

/* ---------- 모델 ---------- */
let landmarker = null;
async function fetchBytes(url, expected, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const total = Number(res.headers.get('content-length')) || expected;
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length, total); return b; }
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onBytes(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
async function loadModel() {
  if (landmarker) return landmarker;
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const simd = await FilesetResolver.isSimdSupported();
  const name = simd ? wasmName.simd : wasmName.nosimd;
  const got = { m: 0, w: 0 }, tot = { m: MODEL.bytes, w: simd ? WASM_BYTES.simd : WASM_BYTES.nosimd };
  const paint = () => {
    const a = got.m + got.w, b = tot.m + tot.w;
    loadBar.style.width = `${Math.min(100, (a / b) * 100).toFixed(1)}%`;
    loadText.textContent = `자세 인식 모델 준비 중… ${fmtMB(a)} / ${fmtMB(b)}`;
  };
  const [model, wasm] = await Promise.all([
    fetchBytes(MODEL.url, MODEL.bytes, (n, t) => { got.m = n; tot.m = t; paint(); }),
    fetchBytes(`${WASM_BASE}${name}.wasm`, tot.w, (n, t) => { got.w = n; tot.w = t; paint(); }),
  ]);
  loadText.textContent = '자세 인식 모델을 여는 중…';
  const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  try {
    landmarker = await PoseLandmarker.createFromOptions(
      { wasmLoaderPath: `${WASM_BASE}${name}.js`, wasmBinaryPath: wasmUrl },
      { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 },
    );
  } finally { URL.revokeObjectURL(wasmUrl); }
  return landmarker;
}

/* ---------- 확인 주기: 워커 타이머(가려진 탭에서 덜 늦춰진다) ---------- */
function makeTicker(fn) {
  let worker = null, id = 0;
  try {
    const src = 'let i=0;onmessage=(e)=>{clearInterval(i);if(e.data>0)i=setInterval(()=>postMessage(0),e.data)}';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = fn;
  } catch { worker = null; }
  return {
    start(ms) { this.stop(); if (worker) worker.postMessage(Math.round(ms)); else id = setInterval(fn, ms); },
    stop() { worker?.postMessage(0); clearInterval(id); },
  };
}
const ticker = makeTicker(() => tick());

/* ---------- 상태 ---------- */
let phase = 'idle'; // idle | loading | ready | calibrating | monitoring | paused
let monitor = null, breakTimer = null, baseline = null, smooth = null;
let calibSamples = [], calibEnd = 0, lastTs = 0, busy = false, lastMetrics = null, lastPosture = 'unknown', lastBadFor = 0, lastDev = null;
let frames = 0, fpsWin = [], lastWall = 0, maxGap = 0, hiddenGap = false, saveCounter = 0;

function setPhase(p) {
  phase = p; tool.dataset.phase = p;
  const on = (el, v) => { el.hidden = !v; };
  on(btn.start, p === 'idle');
  on(btn.calib, p === 'ready');
  on(btn.useSaved, p === 'ready' && !!loadBaseline());
  on(btn.pip, (p === 'monitoring' || p === 'paused') && (hasDocPip || hasVideoPip) && !mobile);
  on(btn.pause, p === 'monitoring' || p === 'paused');
  on(btn.recalib, p === 'monitoring' || p === 'paused');
  on(btn.stop, p !== 'idle' && p !== 'loading');
  btn.pause.textContent = p === 'paused' ? '다시 시작' : '잠시 멈춤';
  on(loadBox, p === 'loading');
  on(live, p === 'monitoring' || p === 'paused');
  on(chip, p !== 'idle' && p !== 'loading');
  on($('#intro'), p === 'idle' || p === 'loading');
  on(stage, p !== 'idle');
  if (p === 'idle') { video.hidden = true; overlay.hidden = true; placeholder.hidden = false; countEl.hidden = true; }
}
setPhase('idle');

function paintChip(kind, text) { chip.className = `pa-chip ${kind}`; chipText.textContent = text; }

async function start() {
  if (unsupported) return;
  ensureAudio();
  setPhase('loading');
  setStatus(status, '카메라를 켜는 중…');
  loadText.textContent = '준비 중…'; loadBar.style.width = '0%';
  track('tool_use', { tool: SLUG, action: 'start' });
  const modelP = loadModel();
  modelP.catch(() => {});
  try { await openCamera(); } catch (e) { setStatus(status, cameraError(e), 'bad'); stopCamera(); setPhase('idle'); return; }
  setStatus(status, '카메라가 켜졌습니다. 자세 인식 모델을 준비하고 있습니다.');
  try { await modelP; } catch (e) {
    setStatus(status, `자세 인식 모델을 받지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. (${e?.message || e})`, 'bad');
    stopCamera(); setPhase('idle'); return;
  }
  overlay.hidden = false;
  setPhase('ready');
  paintChip('', '바른 자세로 앉아 기준을 잡아 주세요');
  setStatus(status, '머리와 두 어깨가 화면에 보이게 앉은 뒤 "기준 잡기"를 누르세요.', 'ok');
  ticker.start(250);
}

function beginCalibration() {
  calibSamples = []; smooth = null;
  calibEnd = performance.now() + 3000;
  hideBanner();
  setPhase('calibrating');
  countEl.hidden = false; countEl.textContent = '3';
  paintChip('', '가만히 있어 주세요');
  setStatus(status, '3초 동안 바른 자세로 가만히 있어 주세요.');
  ticker.start(125);
}

const CALIB_FAIL = {
  few: '사람을 잘 찾지 못했습니다. 밝은 곳에서 얼굴과 어깨가 화면에 보이게 해 주세요.',
  shoulders: '어깨가 화면에 보이지 않습니다. 카메라를 조금 멀리 두거나 아래쪽이 보이게 기울여 주세요.',
  moving: '기준을 잡는 동안 많이 움직였습니다. 3초 동안 가만히 있어 주세요.',
  pose: '자세를 읽지 못했습니다. 다시 시도해 주세요.',
};

function finishCalibration() {
  countEl.hidden = true;
  const r = calibrate(calibSamples);
  track('tool_use', { tool: SLUG, action: 'calibrate', ok: r.ok, frames: calibSamples.length });
  if (!r.ok) {
    setPhase('ready'); ticker.start(250);
    paintChip('bad', '기준을 잡지 못했습니다');
    setStatus(status, CALIB_FAIL[r.reason] || CALIB_FAIL.pose, 'warn');
    return;
  }
  ls.set(BASELINE_KEY, JSON.stringify({ baseline: r.baseline, at: Date.now() }));
  startMonitoring(r.baseline, `기준을 잡았습니다(${r.frames}장면). 이제 평소처럼 일하시면 됩니다.`);
}

function startMonitoring(base, msg) {
  baseline = base; smooth = null;
  monitor = createMonitor({ holdMs: settings.hold * 1000, cooldownMs: settings.cool * 1000 });
  breakTimer = createBreakTimer({ intervalMs: settings.brk * 60000 });
  lastWall = 0; maxGap = 0;
  setPhase('monitoring');
  setStatus(status, msg, 'ok');
  ticker.start(1000 / settings.fps);
  lockWake();
}

async function pauseResume() {
  if (phase === 'monitoring') {
    ticker.stop(); stopCamera(); releaseWake(); saveStats();
    setPhase('paused');
    paintChip('', '잠시 멈춤 · 카메라 꺼짐');
    liveTitle.textContent = '잠시 멈춤'; liveSub.textContent = '';
    setStatus(status, '확인을 멈추고 카메라를 껐습니다. "다시 시작"을 누르면 같은 기준으로 이어서 확인합니다.');
    hideBanner(); paintPip();
  } else if (phase === 'paused') {
    try { await openCamera(); } catch (e) { setStatus(status, cameraError(e), 'bad'); return; }
    if (pipWin) movePipVideo();
    startMonitoring(baseline, '다시 확인을 시작했습니다.');
  }
}

function stopAll() {
  ticker.stop(); stopCamera(); releaseWake(); closePip(); saveStats();
  monitor = null; breakTimer = null;
  hideBanner(); clearOverlay(); restoreTitle();
  setPhase('idle');
  setStatus(status, '카메라를 껐습니다. 오늘 기록은 이 기기에 남아 있습니다.');
}

/* ---------- 한 장면 확인 ---------- */
function tick() {
  if (busy || !landmarker || !stream || video.readyState < 2 || !video.videoWidth) return;
  busy = true;
  try {
    const wall = Date.now();
    if (lastWall && phase === 'monitoring') {
      const gap = wall - lastWall;
      if (gap > 5000 && document.visibilityState === 'hidden' && !pipWin) { hiddenGap = true; maxGap = Math.max(maxGap, gap); }
    }
    lastWall = wall;
    const ts = Math.max(performance.now(), lastTs + 1); lastTs = ts;
    const res = landmarker.detectForVideo(video, ts);
    frames++; fpsWin.push(ts); while (fpsWin.length && ts - fpsWin[0] > 5000) fpsWin.shift();
    tool.dataset.frames = String(frames);
    tool.dataset.fps = fpsWin.length > 1 ? ((fpsWin.length - 1) / ((ts - fpsWin[0]) / 1000)).toFixed(2) : '0';
    const lms = res?.landmarks?.[0] || null;
    const m = frameMetrics(lms, video.videoWidth / video.videoHeight);
    lastMetrics = m;
    if (phase === 'calibrating') {
      calibSamples.push(m);
      const left = calibEnd - performance.now();
      countEl.textContent = String(Math.max(1, Math.ceil(left / 1000)));
      if (left <= 0) finishCalibration();
    } else if (phase === 'ready') {
      paintChip(m.ok && !m.partial ? 'good' : 'bad', m.ok && !m.partial ? '잘 보입니다 · 기준을 잡아 주세요' : !m.ok ? '얼굴이 잘 보이지 않습니다' : '어깨가 화면에 보이지 않습니다');
    } else if (phase === 'monitoring') {
      monitorStep(m);
    }
    if (settings.dots && document.visibilityState === 'visible') drawOverlay(lms);
  } catch (e) {
    setStatus(status, `자세 확인 중 문제가 생겼습니다: ${e?.message || e}`, 'bad');
  } finally { busy = false; }
}

function monitorStep(m) {
  smooth = smoothMetrics(smooth, m, 0.5);
  const dev = deviation(smooth, baseline, SENSITIVITY[settings.sens]);
  lastDev = dev;
  const now = Date.now();
  const r = monitor.update(now, dev);
  lastPosture = r.posture; lastBadFor = r.badFor;
  tool.dataset.posture = r.posture;
  if (r.counted.kind === 'good' || r.counted.kind === 'bad') { addTime(stats, now, r.counted.ms, r.counted.kind); statsDirty = true; }
  for (const e of r.events) {
    if (e.type === 'alert') onAlert(e.reason, now);
    if (e.type === 'recovered' || e.type === 'away') onRecovered();
  }
  const b = breakTimer.update(now, r.posture !== 'away');
  if (b.due) onBreak(now);
  if (++saveCounter % 20 === 0) saveStats();
  if (saveCounter % 4 === 0 && document.visibilityState === 'visible') renderStats();
  paintLive(dev, r);
  paintPip();
}

function paintLive(dev, r) {
  const hold = settings.hold * 1000;
  const score = dev ? dev.score : 0;
  meter.style.left = `${(Math.min(score, 1.6) / 1.6) * 100}%`;
  if (r.posture === 'away') {
    liveTitle.textContent = '자리 비움';
    liveSub.textContent = '사람이 보이지 않거나 어깨가 화면 밖에 있습니다';
    paintChip('', '자리 비움');
  } else if (r.posture === 'bad') {
    const why = REASON_TEXT[monitor.state.reason] || '기준에서 벗어났어요';
    liveTitle.textContent = why;
    const left = Math.max(0, Math.ceil((hold - r.badFor) / 1000));
    liveSub.textContent = monitor.state.alerted ? '고쳐 앉으면 안내가 사라집니다' : `${left}초 뒤 알림`;
    paintChip(monitor.state.alerted ? 'alert' : 'bad', monitor.state.alerted ? '자세를 확인해 주세요' : `기준에서 벗어남 ${Math.floor(r.badFor / 1000)}초`);
  } else {
    liveTitle.textContent = '바른 자세';
    liveSub.textContent = `확인 중 · 초당 ${settings.fps}번`;
    paintChip('good', '바른 자세');
  }
}

/* ---------- 알림 ---------- */
const baseTitle = document.title;
let bannerKind = '';
function showBanner(kind, text) {
  bannerKind = kind; bannerText.textContent = text;
  banner.className = `pa-banner${kind === 'rest' ? ' rest' : ''}`; banner.hidden = false;
}
function hideBanner(kind) { if (kind && bannerKind !== kind) return; banner.hidden = true; bannerKind = ''; }
$('#bannerClose').addEventListener('click', () => hideBanner());
function restoreTitle() { document.title = baseTitle; }

function onAlert(reason, now) {
  addEvent(stats, now, 'alerts'); statsDirty = true;
  const text = `${REASON_TEXT[reason] || '기준 자세에서 벗어났어요'}. 편하게 고쳐 앉아 보세요.`;
  showBanner('posture', text);
  document.title = `⚠ 자세 확인 · ${baseTitle}`;
  beep('posture'); vibrate();
  notify('자세를 확인해 주세요', text);
  track('tool_use', { tool: SLUG, action: 'alert', reason });
  renderStats();
}
function onRecovered() {
  hideBanner('posture'); restoreTitle();
}
function onBreak(now) {
  addEvent(stats, now, 'breaks'); statsDirty = true;
  const text = `자리에 앉은 지 ${settings.brk}분이 지났습니다. 잠깐 일어나 몸을 풀거나 먼 곳을 바라보며 쉬어 가세요.`;
  showBanner('rest', text);
  beep('rest'); vibrate();
  notify('쉬어 갈 시간입니다', text);
  track('tool_use', { tool: SLUG, action: 'break' });
  renderStats();
}

/* ---------- 인식한 점 그리기(화면에만, 저장 안 함) ---------- */
function clearOverlay() { const c = overlay.getContext('2d'); c?.clearRect(0, 0, overlay.width, overlay.height); }
function drawOverlay(lms, canvas = overlay) {
  const w = video.videoWidth, hgt = video.videoHeight;
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, w, hgt);
  if (!lms) return;
  const color = lastPosture === 'bad' ? '#fbbf24' : phase === 'monitoring' && lastPosture === 'good' ? '#34d399' : '#7aa2ff';
  const pt = (i) => [lms[i].x * w, lms[i].y * hgt];
  c.lineWidth = Math.max(2, w / 220); c.strokeStyle = color; c.fillStyle = color;
  const line = (a, b) => { c.beginPath(); c.moveTo(...pt(a)); c.lineTo(...pt(b)); c.stroke(); };
  line(LM.L_SH, LM.R_SH); line(LM.L_EAR, LM.R_EAR);
  const eye = [(lms[LM.L_EYE].x + lms[LM.R_EYE].x) / 2 * w, (lms[LM.L_EYE].y + lms[LM.R_EYE].y) / 2 * hgt];
  const sh = [(lms[LM.L_SH].x + lms[LM.R_SH].x) / 2 * w, (lms[LM.L_SH].y + lms[LM.R_SH].y) / 2 * hgt];
  c.setLineDash([6, 6]); c.beginPath(); c.moveTo(...eye); c.lineTo(...sh); c.stroke(); c.setLineDash([]);
  for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR, LM.L_SH, LM.R_SH]) {
    c.beginPath(); c.arc(...pt(i), Math.max(3, w / 130), 0, Math.PI * 2); c.fill();
  }
}

/* ---------- 작은 창(PiP) ---------- */
let pipWin = null, pipEls = null, pipVideo = null, pipCanvas = null;
const PIP_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#111318;color:#eceef2;font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
body{display:flex;flex-direction:column}
.v{position:relative;flex:1;min-height:0;background:#000}
.v video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.p{padding:8px 10px;border-top:4px solid #555}
.p.good{border-color:#34d399}.p.bad{border-color:#fbbf24}.p.alert{border-color:#f87171;background:#3a1d1d}
.t{font-weight:800;font-size:16px}.s{font-size:12.5px;color:#a0a6b2;margin-top:2px}
.b{display:flex;gap:6px;margin-top:8px}.b button{flex:1;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:7px;background:#1f2a44;color:#7aa2ff;cursor:pointer}`;

function movePipVideo() {
  if (!pipWin || !pipEls) return;
  pipEls.v.append(video);
  video.play().catch(() => {});
}
async function openPip() {
  if (pipWin || document.pictureInPictureElement) { closePip(); return; }
  try {
    if (hasDocPip) {
      pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 300 });
      const d = pipWin.document;
      d.title = '거북목 알리미';
      d.head.append(Object.assign(d.createElement('style'), { textContent: PIP_CSS }));
      const mk = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
      const v = mk('div', 'v'), p = mk('div', 'p'), t = mk('div', 't', '확인 중'), s = mk('div', 's'), b = mk('div', 'b');
      const bp = mk('button', '', '잠시 멈춤'), bb = mk('button', '', '원래 창으로');
      bp.onclick = () => pauseResume();
      bb.onclick = () => { window.focus(); closePip(); };
      b.append(bp, bb); p.append(t, s, b); d.body.append(v, p);
      pipEls = { v, p, t, s, bp };
      movePipVideo();
      pipWin.addEventListener('pagehide', () => {
        stage.insertBefore(video, overlay); video.play().catch(() => {});
        pipWin = null; pipEls = null; btn.pip.textContent = '작은 창으로 띄우기';
      });
      btn.pip.textContent = '작은 창 닫기';
      paintPip();
      track('tool_use', { tool: SLUG, action: 'pip', mode: 'document' });
    } else if (hasVideoPip) {
      pipCanvas ||= document.createElement('canvas');
      pipCanvas.width = 320; pipCanvas.height = 240;
      paintPip();
      if (!pipVideo) {
        pipVideo = h('video', { muted: true, playsinline: true, style: 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none' });
        pipVideo.muted = true;
        pipVideo.addEventListener('leavepictureinpicture', () => { btn.pip.textContent = '작은 창으로 띄우기'; });
        stage.append(pipVideo);
      }
      pipVideo.srcObject = pipCanvas.captureStream(4);
      await pipVideo.play();
      await pipVideo.requestPictureInPicture();
      btn.pip.textContent = '작은 창 닫기';
      track('tool_use', { tool: SLUG, action: 'pip', mode: 'video' });
    }
  } catch (e) {
    setStatus(status, `작은 창을 열지 못했습니다: ${e?.message || e}`, 'warn');
  }
}
function closePip() {
  if (pipWin) pipWin.close();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}
function pipState() {
  if (phase === 'paused') return ['', '잠시 멈춤', '카메라 꺼짐'];
  if (lastPosture === 'away') return ['', '자리 비움', '사람이 보이지 않습니다'];
  if (lastPosture === 'bad') {
    const why = REASON_TEXT[monitor?.state.reason] || '기준에서 벗어났어요';
    if (monitor?.state.alerted) return ['alert', why, '편하게 고쳐 앉아 보세요'];
    return ['bad', why, `${Math.max(0, Math.ceil((settings.hold * 1000 - lastBadFor) / 1000))}초 뒤 알림`];
  }
  return ['good', '바른 자세', '확인 중'];
}
function paintPip() {
  const [kind, title, sub] = pipState();
  if (pipEls) {
    pipEls.p.className = `p ${kind}`; pipEls.t.textContent = title;
    pipEls.s.textContent = bannerKind === 'rest' ? '쉬어 갈 시간입니다' : sub;
    pipEls.bp.textContent = phase === 'paused' ? '다시 시작' : '잠시 멈춤';
  }
  if (pipCanvas && document.pictureInPictureElement === pipVideo) {
    const c = pipCanvas.getContext('2d'), w = pipCanvas.width, hh = pipCanvas.height;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, hh);
    if (stream && video.videoWidth) { c.save(); c.translate(w, 0); c.scale(-1, 1); c.drawImage(video, 0, 0, w, hh - 56); c.restore(); }
    c.fillStyle = { good: '#34d399', bad: '#fbbf24', alert: '#f87171' }[kind] || '#555';
    c.fillRect(0, hh - 56, w, 56);
    c.fillStyle = '#111'; c.font = 'bold 20px sans-serif'; c.fillText(title, 12, hh - 30);
    c.font = '14px sans-serif'; c.fillText(sub, 12, hh - 10);
  }
}

/* ---------- 오늘 기록 ---------- */
const bars = $('#bars');
const barEls = Array.from({ length: 24 }, (_, i) => {
  const g = h('i', { class: 'g' }), b = h('i', { class: 'b' });
  const el = h('div', { class: 'pa-bar', title: `${i}시` }, g, b);
  bars.append(el);
  return { el, g, b };
});
function renderStats() {
  const s = summarize(stats.days[dayKey(Date.now())]);
  $('#kMin').textContent = s.totalMs < 60000 && s.totalMs > 0 ? '1분 미만' : fmtDuration(s.minutes * 60000);
  $('#kPct').textContent = s.goodPct == null ? '–' : `${s.goodPct}%`;
  $('#kAlert').textContent = `${s.alerts}회`;
  $('#kBreak').textContent = `${s.breaks}회`;
  const max = Math.max(s.maxHourMs, 10 * 60000); // 막대 높이: 한 시간 칸 중 가장 긴 값(최소 10분 기준)
  for (const hr of s.hours) {
    const e = barEls[hr.hour];
    e.g.style.height = `${(hr.good / max) * 100}%`; e.b.style.height = `${(hr.bad / max) * 100}%`;
    e.el.title = `${hr.hour}시 · 바른 자세 ${fmtDuration(hr.good)} · 벗어남 ${fmtDuration(hr.bad)}`;
  }
}
renderStats();
$('#clearStats').addEventListener('click', () => {
  if (!confirm('오늘 기록을 지울까요?')) return;
  delete stats.days[dayKey(Date.now())]; statsDirty = true; saveStats(); renderStats();
});

/* ---------- 버튼·페이지 이벤트 ---------- */
btn.start.addEventListener('click', start);
btn.calib.addEventListener('click', beginCalibration);
btn.recalib.addEventListener('click', async () => {
  if (phase === 'paused') { try { await openCamera(); } catch (e) { setStatus(status, cameraError(e), 'bad'); return; } if (pipWin) movePipVideo(); }
  releaseWake(); beginCalibration();
});
btn.useSaved.addEventListener('click', () => {
  const b = loadBaseline();
  if (!b) return;
  track('tool_use', { tool: SLUG, action: 'use_saved_baseline' });
  startMonitoring(b.baseline, '지난번 기준으로 확인을 시작했습니다. 카메라 위치가 바뀌었다면 기준을 다시 잡아 주세요.');
});
btn.pip.addEventListener('click', openPip);
btn.pause.addEventListener('click', pauseResume);
btn.stop.addEventListener('click', stopAll);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (phase === 'monitoring') lockWake();
    renderStats();
    if (hiddenGap) {
      hiddenGap = false;
      setStatus(status, `탭이 가려진 동안 브라우저가 확인을 멈춘 적이 있습니다(최대 ${Math.round(maxGap / 1000)}초).${bg.mode !== 'none' ? ' 다른 창에서 쓰실 때는 "작은 창으로 띄우기"를 켜 두세요.' : ''}`, 'warn');
    }
  } else {
    saveStats();
  }
});
addEventListener('pagehide', saveStats);
