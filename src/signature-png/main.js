import { $, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import {
  luminance, flattenLight, removeBackground, trimBounds, crop, otsuThreshold, smoothPath, addPoint, hexToRgb,
} from '../_shared/signature-png.js';

const status = $('#status');

/* ---------- 탭 ---------- */
function showTab(draw) {
  $('#tabDraw').setAttribute('aria-selected', String(draw));
  $('#tabPhoto').setAttribute('aria-selected', String(!draw));
  $('#drawPane').hidden = !draw; $('#photoPane').hidden = draw;
  setStatus(status, '');
  if (draw) sizePad();
}
$('#tabDraw').addEventListener('click', () => showTab(true));
$('#tabPhoto').addEventListener('click', () => showTab(false));

/* ---------- 직접 쓰기 ---------- */
const pad = $('#pad'), pctx = pad.getContext('2d');
let strokes = [];   // {w, pts:[[x,y],...]} — 좌표는 CSS 픽셀
let cur = null, dpr = 1;

function sizePad() {
  const r = pad.getBoundingClientRect();
  if (!r.width) return;
  dpr = Math.min(3, window.devicePixelRatio || 1);
  pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
  redraw();
}

function paint(ctx, list, k, color, ox = 0, oy = 0) {
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of list) {
    const pts = s.pts.map(([x, y]) => [(x - ox) * k, (y - oy) * k]);
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], (s.w * k) / 2, 0, Math.PI * 2); ctx.fill(); continue; }
    const p = smoothPath(pts);
    ctx.lineWidth = s.w * k;
    ctx.beginPath(); ctx.moveTo(p.start[0], p.start[1]);
    for (const [cx, cy, x, y] of p.segs) ctx.quadraticCurveTo(cx, cy, x, y);
    ctx.stroke();
  }
}

function redraw() {
  pctx.clearRect(0, 0, pad.width, pad.height);
  paint(pctx, strokes, dpr, $('#penColor').value);
  const has = strokes.length > 0;
  $('#undo').disabled = !has; $('#clear').disabled = !has; $('#saveDraw').disabled = !has;
}

const pos = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
pad.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  cur = { w: Number($('#pen').value), pts: [pos(e)] };
  strokes.push(cur);
  redraw();
});
pad.addEventListener('pointermove', (e) => {
  if (!cur) return;
  // 빠르게 움직일 때 브라우저가 묶어 둔 중간 점까지 모두 쓴다
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  let changed = false;
  for (const ev of evs.length ? evs : [e]) changed = addPoint(cur.pts, pos(ev)) || changed;
  if (changed) redraw();
});
const end = () => { cur = null; };
pad.addEventListener('pointerup', end);
pad.addEventListener('pointercancel', end);
window.addEventListener('resize', () => { if (!$('#drawPane').hidden) sizePad(); });

$('#pen').addEventListener('input', () => { $('#penVal').textContent = $('#pen').value; });
$('#penColor').addEventListener('input', redraw);
$('#undo').addEventListener('click', () => { strokes.pop(); redraw(); });
$('#clear').addEventListener('click', () => { strokes = []; redraw(); });

$('#saveDraw').addEventListener('click', () => {
  // 획이 있는 범위만 3배 해상도로 다시 그린다
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) {
    x0 = Math.min(x0, x - s.w); y0 = Math.min(y0, y - s.w); x1 = Math.max(x1, x + s.w); y1 = Math.max(y1, y + s.w);
  }
  const k = 3, m = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0 + m * 2) * k); c.height = Math.ceil((y1 - y0 + m * 2) * k);
  paint(c.getContext('2d'), strokes, k, $('#penColor').value, x0 - m, y0 - m);
  c.toBlob((b) => {
    download(b, 'signature.png');
    setStatus(status, `저장했습니다 (${c.width}×${c.height}, ${fmtBytes(b.size)}).`, 'ok');
    track('tool_download', { tool: 'signature-png', mode: 'draw', strokes: strokes.length });
  }, 'image/png');
});

/* ---------- 종이 사진에서 ---------- */
const prev = $('#photoPrev'), prevCtx = prev.getContext('2d');
let src = null;         // {rgba, w, h, gray, flat}
let result = null;      // {rgba, box}
let pending = 0;

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { URL.revokeObjectURL(url); }
  }
}

async function openPhoto(file) {
  setStatus(status, '사진을 여는 중…');
  let bmp;
  try { bmp = await loadBitmap(file); }
  catch { setStatus(status, '이 사진을 열지 못했습니다. HEIC라면 JPG로 바꿔 넣어 주세요.', 'bad'); return; }
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), hh = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, hh);
  bmp.close?.();
  const rgba = ctx.getImageData(0, 0, w, hh).data;
  const gray = luminance(rgba);
  src = { rgba, w, h: hh, gray, flat: null };
  $('#photoBox').hidden = false;
  suggestThreshold();
  process();
  track('tool_use', { tool: 'signature-png', mode: 'photo' });
}

function judgeGray() {
  if (!$('#flat').checked) return src.gray;
  if (!src.flat) src.flat = flattenLight(src.gray, src.w, src.h);
  return src.flat;
}

function suggestThreshold() {
  const t = otsuThreshold(judgeGray());
  $('#th').value = String(Math.max(90, Math.min(235, t + 25)));
}

function inkColor() {
  const v = $('#inkMode').value;
  if (v === 'orig') return null;
  return hexToRgb(v === 'custom' ? $('#inkColor').value : v);
}

function process() {
  if (!src) return;
  const th = Number($('#th').value), edge = Number($('#edge').value) / 100;
  $('#thVal').textContent = th; $('#edgeVal').textContent = `${Math.round(edge * 100)}%`;
  const rgba = removeBackground(src.rgba, judgeGray(), { threshold: th, ink: inkColor() });
  // 테두리 무시: 가장자리 띠를 투명하게
  const ex = Math.round(src.w * edge), ey = Math.round(src.h * edge);
  if (ex || ey) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      if (x < ex || x >= src.w - ex || y < ey || y >= src.h - ey) rgba[(y * src.w + x) * 4 + 3] = 0;
    }
  }
  const box = trimBounds(rgba, src.w, src.h, { minAlpha: 40, pad: Math.round(Math.max(src.w, src.h) * 0.01) });
  if (!box) {
    result = null; prev.width = 1; prev.height = 1;
    setStatus(status, '남은 잉크가 없습니다. 배경 기준 밝기를 올려 보세요.', 'warn');
    $('#savePhoto').disabled = true;
    return;
  }
  result = { rgba: crop(rgba, src.w, box), box };
  prev.width = box.w; prev.height = box.h;
  prevCtx.putImageData(new ImageData(result.rgba, box.w, box.h), 0, 0);
  $('#savePhoto').disabled = false;
  const ratio = box.w * box.h / (src.w * src.h);
  setStatus(status, ratio > 0.8 ? '잘린 영역이 거의 사진 전체입니다. 얼룩·그림자가 남았다면 기준 밝기를 낮추거나 테두리 무시를 올려 보세요.' : `${box.w}×${box.h} 크기로 잘랐습니다.`, ratio > 0.8 ? 'warn' : 'ok');
}

const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(process); };
$('#th').addEventListener('input', schedule);
$('#edge').addEventListener('input', schedule);
$('#flat').addEventListener('change', () => { if (!src) return; suggestThreshold(); process(); });
$('#inkMode').addEventListener('change', () => { $('#customBox').hidden = $('#inkMode').value !== 'custom'; process(); });
$('#inkColor').addEventListener('input', schedule);

$('#savePhoto').addEventListener('click', () => {
  if (!result) return;
  prev.toBlob((b) => {
    download(b, 'signature.png');
    setStatus(status, `저장했습니다 (${result.box.w}×${result.box.h}, ${fmtBytes(b.size)}).`, 'ok');
    track('tool_download', { tool: 'signature-png', mode: 'photo' });
  }, 'image/png');
});

fileDrop($('#photoPane .drop'), (files) => {
  const f = files.find((x) => x.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(x.name));
  if (!f) { setStatus(status, '사진 파일을 넣어 주세요.', 'warn'); return; }
  openPhoto(f);
});

sizePad();
