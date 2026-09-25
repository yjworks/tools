import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { gridTiles, tileName } from '../_shared/insta-grid.js';

const status = $('#status'), prev = $('#prev'), pctx = prev.getContext('2d');
let img = null;             // ImageBitmap/Image (방향 보정됨)
let focus = [0.5, 0.5];
let layout = null;
let thumbs = [];

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const im = new Image(); im.src = url; await im.decode(); return im; }
    finally { URL.revokeObjectURL(url); }
  }
}

function opts() {
  const [cols, rows] = $('#grid').value.split('x').map(Number);
  return { cols, rows, tileRatio: Number($('#ratio').value), focusX: focus[0], focusY: focus[1] };
}

function drawPreview() {
  if (!img) return;
  const o = opts();
  layout = gridTiles(img.width, img.height, o);
  const s = Math.min(1, 900 / Math.max(img.width, img.height));
  prev.width = Math.round(img.width * s); prev.height = Math.round(img.height * s);
  pctx.drawImage(img, 0, 0, prev.width, prev.height);
  const a = layout.area;
  pctx.fillStyle = 'rgba(0,0,0,.55)';
  pctx.beginPath(); pctx.rect(0, 0, prev.width, prev.height); pctx.rect(a.x * s, a.y * s, a.w * s, a.h * s); pctx.fill('evenodd');
  pctx.strokeStyle = '#fff'; pctx.lineWidth = Math.max(1, prev.width / 400);
  const fs = Math.max(12, Math.round(Math.min(a.w / o.cols, a.h / o.rows) * s * 0.22));
  pctx.font = `bold ${fs}px sans-serif`; pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
  for (const t of layout.tiles) {
    pctx.strokeRect(t.x * s, t.y * s, t.w * s, t.h * s);
    const cx = (t.x + t.w / 2) * s, cy = (t.y + t.h / 2) * s;
    pctx.fillStyle = 'rgba(0,0,0,.55)'; pctx.beginPath(); pctx.arc(cx, cy, fs * 0.9, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = '#fff'; pctx.fillText(String(t.order), cx, cy + 1);
  }
  const t0 = layout.tiles[0];
  $('#info').textContent = `${layout.tiles.length}장 · 조각 ${t0.outW}×${t0.outH}`;
  scheduleThumbs();
}

/* 조각 미리보기(누르면 저장) — 끄는 동안 매번 만들지 않도록 잠깐 기다렸다 만든다 */
let thumbTimer = 0;
function scheduleThumbs() { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 250); }
function renderThumbs() {
  const box = $('#tiles');
  thumbs.forEach((u) => URL.revokeObjectURL(u)); thumbs = [];
  box.replaceChildren();
  box.style.gridTemplateColumns = `repeat(${opts().cols}, 1fr)`;
  for (const t of layout.tiles) {
    const c = tileCanvas(t, 240);
    const url = c.toDataURL('image/jpeg', 0.8);
    box.append(h('button', { type: 'button', title: `${t.order}번 조각 저장`, onclick: () => saveOne(t) }, h('img', { src: url, alt: `${t.order}번 조각` }), h('b', {}, String(t.order))));
  }
}

function tileCanvas(t, maxW = 0) {
  const s = maxW ? Math.min(1, maxW / t.outW) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(t.outW * s)); c.height = Math.max(1, Math.round(t.outH * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, t.x, t.y, t.w, t.h, 0, 0, c.width, c.height);
  return c;
}
const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));

async function saveOne(t) {
  const b = await toBlob(tileCanvas(t));
  download(b, tileName(t));
  track('tool_download', { tool: 'insta-grid', mode: 'single' });
}

$('#zip').addEventListener('click', async () => {
  const btn = $('#zip'); btn.disabled = true;
  try {
    const files = {};
    for (const t of [...layout.tiles].sort((a, b) => a.order - b.order)) {
      setStatus(status, `${t.order} / ${layout.tiles.length} 조각 만드는 중…`);
      files[tileName(t)] = [new Uint8Array(await (await toBlob(tileCanvas(t))).arrayBuffer()), { level: 0 }];
    }
    const zip = zipSync(files);
    download(new Blob([zip], { type: 'application/zip' }), `insta-grid-${$('#grid').value}.zip`);
    setStatus(status, `${layout.tiles.length}장을 ZIP으로 저장했습니다 (${fmtBytes(zip.length)}). 01번부터 차례로 올리세요.`, 'ok');
    track('tool_download', { tool: 'insta-grid', grid: $('#grid').value, ratio: $('#ratio').value });
  } catch (e) {
    setStatus(status, `만들지 못했습니다: ${e.message}`, 'bad');
  } finally { btn.disabled = false; }
});

/* 끌어서 남길 위치 옮기기 */
let dragFrom = null;
prev.addEventListener('pointerdown', (e) => { if (!img) return; dragFrom = { x: e.clientX, y: e.clientY, f: [...focus] }; prev.setPointerCapture(e.pointerId); prev.style.cursor = 'grabbing'; });
prev.addEventListener('pointermove', (e) => {
  if (!dragFrom || !layout) return;
  const r = prev.getBoundingClientRect(), k = img.width / r.width;
  const a = layout.area, freeX = img.width - a.w, freeY = img.height - a.h;
  const dx = (e.clientX - dragFrom.x) * k, dy = (e.clientY - dragFrom.y) * k;
  focus = [freeX > 0 ? Math.min(1, Math.max(0, dragFrom.f[0] + dx / freeX)) : 0.5, freeY > 0 ? Math.min(1, Math.max(0, dragFrom.f[1] + dy / freeY)) : 0.5];
  drawPreview();
});
const endDrag = () => { dragFrom = null; prev.style.cursor = 'grab'; };
prev.addEventListener('pointerup', endDrag);
prev.addEventListener('pointercancel', endDrag);

$('#grid').addEventListener('change', drawPreview);
$('#ratio').addEventListener('change', drawPreview);

fileDrop($('.drop'), async (files) => {
  const f = files.find((x) => x.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(x.name));
  if (!f) { setStatus(status, '사진 파일을 넣어 주세요.', 'warn'); return; }
  try { img?.close?.(); img = await loadBitmap(f); }
  catch { setStatus(status, '이 사진을 열지 못했습니다. HEIC라면 JPG로 바꿔 넣어 주세요.', 'bad'); return; }
  focus = [0.5, 0.5];
  $('#work').hidden = false;
  drawPreview();
  setStatus(status, `${img.width}×${img.height} 사진을 열었습니다.`, 'ok');
  track('tool_use', { tool: 'insta-grid' });
});
