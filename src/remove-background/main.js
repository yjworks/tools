import { $, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import {
  MODELS, ENGINE_BYTES, MAX_OUT, WORK_MAX, RATIOS, BACKGROUNDS,
  fitSize, grayOf, guidedFilter, levels, edgeParams, feather, unionMax, foregroundFromBackground,
  paintDab, paintLine, applyEdit, resampleRegion, maskBounds, coverage, cropForRatio, outputSize,
  foregroundColor, composite, hexToRgb, isHeic, pendingBytes,
} from '../_shared/remove-background.js';

/* MediaPipe tasks-vision 1.0.1 은 60초마다 사용 통계(작업 종류·처리 시간, 사진 없음)를 odml.pa.googleapis.com 으로 보낸다.
   이 도구는 모델 파일을 받는 것 말고는 아무것도 내보내지 않으므로, tasks-vision 을 불러오기 전에 그 주소로 가는 요청을 막는다.
   (통계는 전역 fetch 로만 보낸다. 204 를 받으면 라이브러리가 스스로 기록을 멈춘다. sendBeacon·XHR 은 쓰지 않지만 같이 막아 둔다.) */
const BLOCKED_HOSTS = ['odml.pa.googleapis.com'];
const isBlocked = (u) => {
  try { return BLOCKED_HOSTS.includes(new URL(String(u), location.href).hostname); } catch { return false; }
};
{
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => (isBlocked(input instanceof Request ? input.url : input)
    ? Promise.resolve(new Response(null, { status: 204 })) : realFetch(input, init));
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => (isBlocked(url) ? true : realBeacon(url, data));
  }
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    return realOpen.call(this, method, isBlocked(url) ? 'data:,' : url, ...rest);
  };
}

/* 엔진이 정보 줄("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")을 console.error 로 찍는다. 오류가 아니므로 debug 로 옮긴다. */
{
  const realError = console.error.bind(console);
  console.error = (...a) => (typeof a[0] === 'string' && a[0].startsWith('INFO: Created TensorFlow Lite') ? console.debug(...a) : realError(...a));
}

const SLUG = 'remove-background';
const WASM_BASE = new URL('../mediapipe/1.0.1/', location.href).href;
const status = $('#status');

/* ---------- 상태 ---------- */
let photo = null;   // {name, full: canvas(≤4096), work: canvas(≤1536), ww, wh, rgba, gray, bigger}
let mode = 'portrait';
let tool = 'view';
let raw = null;     // 모델 결과(작업 해상도, 0~1)
let taps = [];      // [{x, y, mask: Uint8Array}] 물건 모드에서 누른 점
let guided = null;  // raw 를 원본 경계에 맞춘 것
let leveled = null; // guided 를 '가장자리 부드럽게' 값으로 조인 것
let edit = null;    // 붓질 층 -1~+1
let alpha = null;   // 최종 알파(작업 해상도)
let history = [];   // 되돌리기
let bgKey = 'none';
let split = 0;      // 원본 비교 위치(%)

/* ---------- 모델·엔진 ---------- */
let vision = null, fileset = null, simd = true;
const segmenters = {};
const loading = {};

async function isCached(url) {
  try { return 'caches' in window && !!(await caches.match(url)); } catch { return false; }
}

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length); return b; }
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function neededParts(m) {
  if (!vision) {
    vision = await import('@mediapipe/tasks-vision');
    simd = await vision.FilesetResolver.isSimdSupported();
  }
  const engineUrl = `${WASM_BASE}vision_wasm${simd ? '' : '_nosimd'}_internal.wasm`;
  const parts = [];
  if (!fileset) parts.push({ key: 'engine', url: engineUrl, bytes: simd ? ENGINE_BYTES.simd : ENGINE_BYTES.nosimd, cached: await isCached(engineUrl) });
  if (!segmenters[m]) parts.push({ key: m, url: MODELS[m].url, bytes: MODELS[m].bytes, cached: await isCached(MODELS[m].url) });
  return parts;
}

/** 엔진과 모델을 받아 준비한다. 받는 동안 진행률을 보여 준다. */
function ensureSegmenter(m) {
  if (segmenters[m]) return Promise.resolve(segmenters[m]);
  if (loading[m]) return loading[m];
  loading[m] = (async () => {
    const parts = await neededParts(m);
    const total = parts.reduce((s, p) => s + p.bytes, 0);
    let got = 0;
    const prog = $('#dlProg'), num = $('#dlNum');
    const tick = (n) => {
      got += n;
      prog.value = Math.min(1, got / total);
      num.textContent = `${fmtBytes(Math.min(got, total))} / ${fmtBytes(total)}`;
    };
    if (parts.some((p) => !p.cached)) { prog.hidden = false; $('#dlBtn').hidden = true; }
    for (const p of parts) {
      const bytes = await fetchWithProgress(p.url, tick);
      if (p.key === 'engine') {
        // 받은 wasm 을 그대로 넘겨 두 번 받지 않게 한다
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
        fileset = { wasmLoaderPath: `${WASM_BASE}vision_wasm${simd ? '' : '_nosimd'}_internal.js`, wasmBinaryPath: blobUrl };
      } else p.bytes = bytes;
    }
    const model = parts.find((p) => p.key === m);
    num.textContent = '모델을 준비하는 중…';
    // tasks-vision 1.0.1 의 InteractiveSegmenterLegacy 는 modelAssetBuffer 로 주면 그래프를 시작하지 못한다.
    // 받은 바이트를 blob 주소로 넘기면 두 모델 모두 다시 받지 않고 그대로 읽는다.
    const modelUrl = URL.createObjectURL(new Blob([model.bytes], { type: 'application/octet-stream' }));
    const baseOptions = { modelAssetPath: modelUrl, delegate: 'CPU' };
    segmenters[m] = m === 'portrait'
      ? await vision.ImageSegmenter.createFromOptions(fileset, { baseOptions, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false })
      : await vision.InteractiveSegmenterLegacy.createFromOptions(fileset, { baseOptions, outputConfidenceMasks: true, outputCategoryMask: false });
    URL.revokeObjectURL(modelUrl);
    return segmenters[m];
  })();
  loading[m].catch(() => { delete loading[m]; });
  return loading[m];
}

/** 모델이 준비돼 있지 않으면 받을 크기를 알리고 사용자가 누를 때까지 기다린다. 이미 받아 둔 것만 필요하면 바로 준비. */
async function prepare(m, failed = '') {
  if (segmenters[m]) return segmenters[m];
  const box = $('#dlBox');
  const parts = await neededParts(m);
  const need = pendingBytes(parts);
  const what = m === 'portrait' ? '사람 인식 모델' : '물건 인식 모델';
  if (failed) {
    $('#dlText').textContent = failed;
    $('#dlBtn').hidden = false; $('#dlBtn').disabled = false; $('#dlBtn').textContent = '다시 시도';
    $('#dlProg').hidden = true; $('#dlNum').textContent = '';
    box.hidden = false;
    await new Promise((resolve) => { $('#dlBtn').onclick = () => { $('#dlBtn').disabled = true; resolve(); }; });
  } else if (need > 0) {
    $('#dlText').innerHTML = '';
    $('#dlText').append(`처음 한 번 ${what}${parts.some((p) => p.key === 'engine' && !p.cached) ? '과 인식 엔진' : ''}을 받습니다: `,
      Object.assign(document.createElement('b'), { textContent: fmtBytes(need) }),
      '. 받은 뒤에는 이 기기에 저장돼 인터넷 없이도 쓸 수 있습니다. 사진은 보내지 않습니다.');
    $('#dlBtn').hidden = false; $('#dlBtn').disabled = false;
    $('#dlBtn').textContent = `받고 시작 (${fmtBytes(need)})`;
    $('#dlProg').hidden = true; $('#dlProg').value = 0; $('#dlNum').textContent = '';
    box.hidden = false;
    await new Promise((resolve) => { $('#dlBtn').onclick = () => { $('#dlBtn').disabled = true; resolve(); }; });
  }
  try {
    const seg = await ensureSegmenter(m);
    box.hidden = true;
    return seg;
  } catch (err) {
    return prepare(m, navigator.onLine === false
      ? '인터넷에 연결되어 있지 않아 모델을 받지 못했습니다. 연결한 뒤 다시 눌러 주세요.'
      : `모델을 받거나 준비하지 못했습니다 (${String(err.message || err).split('\n')[0].slice(0, 120)}). 잠시 뒤 다시 눌러 주세요.`);
  }
}

/* ---------- 사진 열기 ---------- */
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { URL.revokeObjectURL(url); }
  }
}

function canvasOf(src, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

async function openFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !isHeic(file.type, file.name) && file.type) {
    setStatus(status, '사진 파일(JPG·PNG·WebP)을 골라 주세요.', 'bad'); return;
  }
  setStatus(status, '사진을 여는 중…');
  let bmp;
  try { bmp = await decode(file); }
  catch {
    if (isHeic(file.type, file.name)) {
      setStatus(status, '이 브라우저는 HEIC 사진을 열지 못합니다. HEIC는 ', 'bad');
      status.append(Object.assign(document.createElement('a'), { href: '../heic-to-jpg/', textContent: "'HEIC → JPG' 도구" }), '로 먼저 바꿔 주세요.');
    } else setStatus(status, '이 사진을 열지 못했습니다. 파일이 손상되지 않았는지 확인하거나 JPG·PNG로 바꿔 넣어 주세요.', 'bad');
    return;
  }
  const W = bmp.width, H = bmp.height;
  const f = fitSize(W, H, MAX_OUT), w = fitSize(W, H, WORK_MAX);
  const full = canvasOf(bmp, f.w, f.h);
  const work = canvasOf(full, w.w, w.h);
  bmp.close?.();
  const rgba = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w.w, w.h).data;
  photo = { name: file.name, full, work, ww: w.w, wh: w.h, rgba, gray: grayOf(rgba), orig: [W, H], bigger: f.scale < 1 };
  edit = new Float32Array(w.w * w.h);
  $('#drop').hidden = true; $('#work').hidden = false;
  setupStage();
  setStatus(status, '');
  await startMode(mode);
}

/* ---------- 모드 ---------- */
function setTool(t) {
  tool = t;
  for (const [id, v] of [['toolView', 'view'], ['toolTap', 'tap'], ['toolErase', 'erase'], ['toolRestore', 'restore']]) $(`#${id}`).setAttribute('aria-pressed', String(v === t));
  const ov = $('#overlay');
  ov.className = t === 'tap' ? 'tap' : t === 'erase' || t === 'restore' ? 'brush' : '';
  $('#brushBox').hidden = !(t === 'erase' || t === 'restore');
  $('#stage').classList.toggle('ghosted', t === 'tap' || t === 'restore' || (mode === 'object' && !taps.length));
  updateBrushLabel();
  render();
}

async function startMode(m) {
  mode = m;
  $('#modePortrait').setAttribute('aria-selected', String(m === 'portrait'));
  $('#modeObject').setAttribute('aria-selected', String(m === 'object'));
  $('#toolTap').hidden = m !== 'object';
  $('#tools').classList.toggle('four', m === 'object');
  raw = null; guided = null; leveled = null; taps = []; history = [];
  if (photo) edit = new Float32Array(photo.ww * photo.wh);
  updateButtons();
  if (!photo) return;
  setTool(m === 'object' ? 'tap' : 'view');
  if (m === 'object') {
    raw = new Float32Array(photo.ww * photo.wh);
    refine();
    showHint('남기고 싶은 물건을 한 번 눌러 주세요');
    render();
    prepare('object').then(() => setStatus(status, '물건 위를 누르면 그 물건만 남깁니다.', ''));
    return;
  }
  showHint('');
  render();
  const seg = await prepare('portrait');
  if (mode !== 'portrait' || !photo) return;
  busy(true, '사람을 찾는 중…');
  await nextFrame();
  const t0 = performance.now();
  let fg = null;
  try {
    const res = seg.segment(photo.work);
    const masks = res.confidenceMasks || [];
    const m0 = masks[0];
    const bg = m0.getAsFloat32Array();
    fg = foregroundFromBackground(m0.width === photo.ww && m0.height === photo.wh ? bg
      : resampleRegion(bg, m0.width, m0.height, 0, 0, m0.width, m0.height, photo.ww, photo.wh));
    res.close?.();
  } catch (err) {
    busy(false);
    setStatus(status, `인식하지 못했습니다 (${err.message || err}). 페이지를 새로 고친 뒤 다시 해 보세요.`, 'bad');
    return;
  }
  raw = fg;
  refine();
  busy(false);
  render();
  const cov = coverage(raw);
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  if (cov < 0.01) {
    setStatus(status, "사람을 찾지 못했습니다. 물건이나 동물 사진이면 위의 '물건 눌러 고르기'를 써 보세요.", 'warn');
  } else {
    setStatus(status, `배경을 지웠습니다(${sec}초, 남은 부분 ${Math.round(cov * 100)}%). 덜 지워지거나 잘린 곳은 붓으로 고치세요.`, 'ok');
  }
  track('tool_use', { tool: SLUG, mode: 'portrait' });
}

async function addTap(x, y) {
  const seg = await prepare('object');
  if (mode !== 'object' || !photo) return;
  busy(true, '물건 윤곽을 찾는 중…');
  await nextFrame();
  try {
    const res = seg.segment(photo.work, { keypoint: { x: x / photo.ww, y: y / photo.wh } });
    const masks = res.confidenceMasks || [];
    const mk = masks[masks.length - 1]; // 한 장(물체 확률)이 나온다. 여러 장이면 마지막이 물체 쪽
    let m = mk.getAsFloat32Array();
    if (mk.width !== photo.ww || mk.height !== photo.wh) m = resampleRegion(m, mk.width, mk.height, 0, 0, mk.width, mk.height, photo.ww, photo.wh);
    res.close?.();
    const u8 = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) u8[i] = Math.round(Math.min(1, Math.max(0, m[i])) * 255);
    taps.push({ x, y, mask: u8 });
    history.push({ type: 'tap' });
    rebuildFromTaps();
    const before = coverage(raw);
    busy(false);
    showHint('');
    $('#stage').classList.toggle('ghosted', tool === 'tap' || tool === 'restore');
    render();
    setStatus(status, before < 0.002
      ? '누른 곳에서 물체를 찾지 못했습니다. 물건의 가운데를 다시 눌러 보세요.'
      : `물건 ${taps.length}개를 골랐습니다. 더 남길 물건이 있으면 계속 누르고, 다 됐으면 '보기'로 결과를 확인하세요.`, before < 0.002 ? 'warn' : 'ok');
    track('tool_use', { tool: SLUG, mode: 'object', taps: taps.length });
  } catch (err) {
    busy(false);
    setStatus(status, `인식하지 못했습니다 (${err.message || err}).`, 'bad');
  }
  updateButtons();
}

function rebuildFromTaps() {
  let u = new Float32Array(photo.ww * photo.wh);
  for (const t of taps) {
    const f = new Float32Array(t.mask.length);
    for (let i = 0; i < f.length; i++) f[i] = t.mask[i] / 255;
    u = unionMax(u, f);
  }
  raw = u;
  refine();
}

/* ---------- 마스크 다듬기 ---------- */
function refine() {
  if (!raw) { guided = leveled = null; return; }
  if (!raw.some((v) => v > 0)) { guided = raw; relevel(); return; } // 아직 아무것도 고르지 않음
  const long = Math.max(photo.ww, photo.wh);
  guided = guidedFilter(photo.gray, raw, photo.ww, photo.wh, Math.max(2, Math.round(long / 200)), 1e-3);
  relevel();
}
function relevel() {
  if (!guided) return;
  const p = edgeParams(Number($('#soft').value), Math.max(photo.ww, photo.wh));
  leveled = levels(guided, p.lo, p.hi);
}
function computeAlpha() {
  if (!leveled) { alpha = null; return; }
  const p = edgeParams(Number($('#soft').value), Math.max(photo.ww, photo.wh));
  alpha = feather(applyEdit(leveled, edit), photo.ww, photo.wh, p.feather);
}

/* ---------- 화면 ---------- */
const stage = $('#stage');
const cv = { ghost: $('#ghost'), after: $('#after'), before: $('#before'), overlay: $('#overlay') };
let afterImg = null;

function setupStage() {
  for (const c of Object.values(cv)) { c.width = photo.ww; c.height = photo.wh; }
  cv.ghost.getContext('2d').drawImage(photo.work, 0, 0);
  cv.before.getContext('2d').drawImage(photo.work, 0, 0);
  afterImg = new ImageData(photo.ww, photo.wh);
  sizeStage();
}

function sizeStage() {
  if (!photo) return;
  const avail = $('#stageWrap').clientWidth || 300;
  const maxH = Math.max(260, Math.min(window.innerHeight * 0.62, 760));
  const k = Math.min(avail / photo.ww, maxH / photo.wh);
  stage.style.width = `${Math.floor(photo.ww * k)}px`;
  stage.style.height = `${Math.floor(photo.wh * k)}px`;
}
window.addEventListener('resize', () => { sizeStage(); drawOverlay(); });

function previewBg() {
  // 누르기·복원 붓을 쓰는 동안은 지운 곳이 흐리게 비치도록 배경색을 칠하지 않는다
  if (tool === 'tap' || tool === 'restore') return null;
  return currentBg();
}
function currentBg() {
  if (bgKey === 'custom') return hexToRgb($('#customColor').value);
  const hex = BACKGROUNDS[bgKey];
  return hex ? hexToRgb(hex) : null;
}

let lastCrop = null; // 작업 해상도 자르기 사각형(그릴 때마다 다시 계산하지 않게)
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderNow(); });
}
function renderNow() {
  if (!photo) return;
  computeAlpha();
  const has = !!alpha && !(mode === 'object' && !taps.length);
  const ctx = cv.after.getContext('2d');
  if (has) {
    afterImg.data.set(photo.rgba);
    composite(afterImg.data, alpha, previewBg());
    ctx.putImageData(afterImg, 0, 0);
  } else ctx.clearRect(0, 0, photo.ww, photo.wh);
  const bg = previewBg();
  stage.classList.toggle('checker', !bg);
  stage.style.backgroundColor = bg ? `rgb(${bg.join(',')})` : '';
  const s = has ? split : 100;
  cv.after.style.clipPath = `inset(0 0 0 ${s}%)`;
  cv.before.style.clipPath = `inset(0 ${100 - s}% 0 0)`;
  lastCrop = cropWork();
  drawOverlay();
  updateOutInfo();
  updateButtons();
}

let cursor = null; // {x, y} 작업 해상도 좌표
function drawOverlay() {
  if (!photo) return;
  const ctx = cv.overlay.getContext('2d'), W = photo.ww, H = photo.wh;
  ctx.clearRect(0, 0, W, H);
  const px = W / (cv.overlay.getBoundingClientRect().width || W); // 화면 1px 이 작업 해상도 몇 px 인지
  const crop = lastCrop;
  if (crop && (crop.w < W - 0.5 || crop.h < H - 0.5)) {
    ctx.fillStyle = 'rgba(17,19,24,.5)';
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(crop.x, crop.y, crop.w, crop.h); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h); ctx.setLineDash([]);
  }
  if (split > 0 && split < 100 && alpha) {
    const x = (W * split) / 100;
    ctx.fillStyle = '#fff'; ctx.fillRect(x - px, 0, 2 * px, H);
  }
  for (const t of taps) {
    ctx.beginPath(); ctx.arc(t.x, t.y, 7 * px, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a'; ctx.fill(); ctx.lineWidth = 2.5 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  if (cursor && (tool === 'erase' || tool === 'restore')) {
    ctx.beginPath(); ctx.arc(cursor.x, cursor.y, brushRadius(), 0, Math.PI * 2);
    ctx.lineWidth = 2 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.lineWidth = 1 * px; ctx.strokeStyle = tool === 'erase' ? '#c0392b' : '#0f8a5f'; ctx.stroke();
  }
}

function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busy').textContent = text; }
function showHint(t) { $('#hint').hidden = !t; $('#hint').textContent = t; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ---------- 자르기 ---------- */
function cropFull() {
  if (!photo) return null;
  const ratio = RATIOS[$('#ratio').value];
  const fw = photo.full.width, fh = photo.full.height, k = fw / photo.ww;
  const b = alpha ? maskBounds(alpha, photo.ww, photo.wh, 0.5) : null;
  const box = b ? { x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k } : null;
  return cropForRatio(fw, fh, ratio, box, Number($('#zoom').value) / 100);
}
function cropWork() {
  const c = cropFull();
  if (!c) return null;
  const k = photo.ww / photo.full.width;
  return { x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k };
}

function updateOutInfo() {
  if (!photo) return;
  const c = cropFull(), o = outputSize(c);
  const note = photo.bigger ? ` · 원본 ${photo.orig[0]}×${photo.orig[1]}이 커서 긴 변 ${MAX_OUT}px로 줄여 저장합니다` : '';
  $('#outInfo').textContent = `저장 크기 ${o.w}×${o.h}px${note}`;
}

/* ---------- 붓·누르기 ---------- */
function brushRadius() {
  return (Number($('#brush').value) / 100) * Math.max(photo.ww, photo.wh) / 2;
}
function updateBrushLabel() {
  if (!photo) return;
  $('#brushVal').textContent = `${Math.round(brushRadius() * 2 * (photo.full.width / photo.ww))}px`;
}
function toWork(e) {
  const r = cv.overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * photo.ww, y: ((e.clientY - r.top) / r.height) * photo.wh };
}
function snapshot() {
  const s = new Int8Array(edit.length);
  for (let i = 0; i < edit.length; i++) s[i] = Math.round(edit[i] * 127);
  return s;
}

let stroke = null, down = null;
cv.overlay.addEventListener('pointerdown', (e) => {
  if (!photo) return;
  const p = toWork(e);
  if (tool === 'erase' || tool === 'restore') {
    if (!leveled) { setStatus(status, mode === 'object' ? '먼저 남길 물건을 눌러 주세요.' : '인식이 끝난 뒤에 고칠 수 있습니다.', 'warn'); return; }
    e.preventDefault();
    try { cv.overlay.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터면 붙잡지 않아도 된다 */ }
    history.push({ type: 'brush', snap: snapshot() });
    // 붓 되돌리기는 최근 30번까지만 기억한다(사진 크기만큼 메모리를 쓰므로)
    if (history.filter((h) => h.snap).length > 30) history.find((h) => h.snap).snap = null;
    stroke = { last: p, value: tool === 'erase' ? -1 : 1 };
    paintDab(edit, photo.ww, photo.wh, p.x, p.y, brushRadius(), stroke.value, 0.55);
    cursor = p;
    render();
  } else if (tool === 'tap') {
    down = { ...p, sx: e.clientX, sy: e.clientY };
  }
});
cv.overlay.addEventListener('pointermove', (e) => {
  if (!photo) return;
  const p = toWork(e);
  cursor = p;
  if (stroke) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const q = toWork(ev);
      paintLine(edit, photo.ww, photo.wh, stroke.last.x, stroke.last.y, q.x, q.y, brushRadius(), stroke.value, 0.55);
      stroke.last = q;
    }
    render();
  } else if (tool === 'erase' || tool === 'restore') drawOverlay();
});
const endStroke = () => { if (stroke) { stroke = null; updateButtons(); track('tool_edit', { tool: SLUG, brush: tool }); } };
cv.overlay.addEventListener('pointerup', (e) => {
  endStroke();
  if (tool === 'tap' && down && Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < 12) {
    const p = down; down = null;
    if (taps.length >= 20) { setStatus(status, '물건은 20번까지 누를 수 있습니다. 나머지는 붓으로 고쳐 주세요.', 'warn'); return; }
    addTap(p.x, p.y);
  }
  down = null;
});
cv.overlay.addEventListener('pointercancel', () => { endStroke(); down = null; });
cv.overlay.addEventListener('pointerleave', () => { cursor = null; if (!stroke) drawOverlay(); });

/* ---------- 버튼 ---------- */
function updateButtons() {
  const ready = !!alpha && !(mode === 'object' && !taps.length);
  $('#savePng').disabled = !ready; $('#saveJpg').disabled = !ready;
  $('#undo').disabled = !history.some((h) => h.type === 'tap' || h.snap);
  $('#reset').disabled = !history.length;
  $('#savePng').textContent = currentBg() ? 'PNG 저장' : '투명 PNG 저장';
  $('#saveJpg').textContent = currentBg() ? 'JPG 저장' : 'JPG 저장(흰 배경)';
  $('#taps').textContent = mode === 'object' && taps.length ? `고른 물건 ${taps.length}개` : '';
}

$('#modePortrait').addEventListener('click', () => { if (mode !== 'portrait') startMode('portrait'); });
$('#modeObject').addEventListener('click', () => { if (mode !== 'object') startMode('object'); });
$('#toolView').addEventListener('click', () => setTool('view'));
$('#toolTap').addEventListener('click', () => setTool('tap'));
$('#toolErase').addEventListener('click', () => setTool('erase'));
$('#toolRestore').addEventListener('click', () => setTool('restore'));

$('#undo').addEventListener('click', () => {
  while (history.length) {
    const h = history.pop();
    if (h.type === 'tap') { taps.pop(); rebuildFromTaps(); break; }
    if (h.snap) { for (let i = 0; i < edit.length; i++) edit[i] = h.snap[i] / 127; break; }
  }
  $('#stage').classList.toggle('ghosted', tool === 'tap' || tool === 'restore' || (mode === 'object' && !taps.length));
  if (mode === 'object' && !taps.length) showHint('남기고 싶은 물건을 한 번 눌러 주세요');
  render();
});
$('#reset').addEventListener('click', () => {
  history = [];
  edit.fill(0);
  if (mode === 'object') { taps = []; rebuildFromTaps(); showHint('남기고 싶은 물건을 한 번 눌러 주세요'); setTool('tap'); }
  render();
});

$('#cmp').addEventListener('input', () => {
  split = Number($('#cmp').value);
  $('#cmpVal').textContent = split === 0 ? '왼쪽으로 밀면 결과만' : `왼쪽 ${split}% 원본`;
  render();
});
$('#brush').addEventListener('input', () => { updateBrushLabel(); drawOverlay(); });
$('#soft').addEventListener('input', () => { $('#softVal').textContent = $('#soft').value; relevel(); render(); });
$('#ratio').addEventListener('change', () => { $('#zoomBox').hidden = $('#ratio').value === 'orig'; setStatus(status, ''); render(); });
$('#zoom').addEventListener('input', () => { $('#zoomVal').textContent = `${$('#zoom').value}%`; render(); });

for (const b of $('#bgs').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    bgKey = b.dataset.bg;
    setStatus(status, '');
    for (const o of $('#bgs').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    $('#customColor').hidden = bgKey !== 'custom';
    if (bgKey === 'custom') $('#customColor').click();
    if (tool === 'tap' || tool === 'restore') setTool('view'); else render();
  });
}
$('#customColor').addEventListener('input', () => { $('#customChip').style.background = $('#customColor').value; render(); });

$('#another').addEventListener('click', () => $('#file').click());

/* ---------- 저장 ---------- */
async function save(fmt) {
  if (!photo || !alpha) return;
  const btns = [$('#savePng'), $('#saveJpg')];
  btns.forEach((b) => { b.disabled = true; });
  busy(true, '원본 크기로 만드는 중…');
  await nextFrame();
  try {
    const crop = cropFull(), o = outputSize(crop);
    const k = photo.ww / photo.full.width;
    const c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.full, crop.x, crop.y, crop.w, crop.h, 0, 0, o.w, o.h);
    const img = ctx.getImageData(0, 0, o.w, o.h);
    const a8 = resampleRegion(alpha, photo.ww, photo.wh, crop.x * k, crop.y * k, crop.w * k, crop.h * k, o.w, o.h, Uint8ClampedArray);
    // 가장자리 색 번짐 줄이기: 작업 해상도에서 앞쪽 색을 추정해 저장 크기로 늘린다
    const fgW = foregroundColor(photo.rgba, alpha, photo.ww, photo.wh, Math.max(2, Math.round(Math.max(photo.ww, photo.wh) / 300)));
    const fc = document.createElement('canvas'); fc.width = photo.ww; fc.height = photo.wh;
    fc.getContext('2d').putImageData(new ImageData(fgW, photo.ww, photo.wh), 0, 0);
    const fc2 = document.createElement('canvas'); fc2.width = o.w; fc2.height = o.h;
    const fctx = fc2.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(fc, crop.x * k, crop.y * k, crop.w * k, crop.h * k, 0, 0, o.w, o.h);
    const fg = fctx.getImageData(0, 0, o.w, o.h).data;
    const bg = currentBg() || (fmt === 'jpg' ? [255, 255, 255] : null);
    composite(img.data, a8, bg, fg);
    ctx.putImageData(img, 0, 0);
    const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.92));
    if (!blob) throw new Error('이미지를 만들지 못했습니다');
    download(blob, `${baseName(photo.name) || 'photo'}-nukki.${fmt}`);
    setStatus(status, `저장했습니다: ${o.w}×${o.h}px, ${fmtBytes(blob.size)}${bg ? '' : ' (투명 배경)'}.`, 'ok');
    track('tool_download', { tool: SLUG, mode, format: fmt, bg: bg ? bgKey : 'none', ratio: $('#ratio').value, taps: taps.length });
  } catch (err) {
    setStatus(status, `저장하지 못했습니다 (${err.message || err}). 사진이 아주 크면 기기 메모리가 모자랄 수 있습니다.`, 'bad');
  } finally {
    busy(false);
    updateButtons();
  }
}
$('#savePng').addEventListener('click', () => save('png'));
$('#saveJpg').addEventListener('click', () => save('jpg'));

fileDrop($('#drop'), (files) => openFile(files[0]));
