import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { SIZES, layoutsFor, cellRects, coverCrop } from '../_shared/photo-collage.js';

const MAX = 9;
const status = $('#status'), canvas = $('#canvas'), ctx = canvas.getContext('2d');
let items = [];      // {src: canvas, thumb, fx, fy}
let rects = [];
let selected = -1;

for (const [k, v] of Object.entries(SIZES)) $('#size').append(h('option', { value: k }, v.name));

async function loadImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { bmp = new Image(); bmp.src = url; await bmp.decode(); } finally { URL.revokeObjectURL(url); }
  }
  // 메모리를 아끼려고 긴 변 2000px 로 줄여 둔다(결과는 최대 1920px 이므로 화질 차이 없음)
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
  cx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const t = document.createElement('canvas'), ts = 104 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { src: c, thumb: t.toDataURL('image/jpeg', 0.7), fx: 0.5, fy: 0.5 };
}

function currentLayout() {
  const list = layoutsFor(items.length);
  return list.find((l) => l.id === $('#layout').value) || list[0];
}

function fillLayouts() {
  const sel = $('#layout'), prevId = sel.value;
  sel.replaceChildren();
  const list = layoutsFor(items.length);
  if (!list.length) { sel.append(h('option', {}, '사진을 2장 이상 넣어 주세요')); return; }
  for (const l of list) sel.append(h('option', { value: l.id, selected: l.id === prevId }, l.name));
}

function render() {
  const n = items.length;
  $('#work').hidden = n < 2;
  if (n < 2) return;
  const { w: W, h: H } = SIZES[$('#size').value];
  const gap = Number($('#gap').value);
  $('#gapVal').textContent = `${gap}px`;
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = $('#bg').value; ctx.fillRect(0, 0, W, H);
  try { rects = cellRects(currentLayout().make(W, H), W, H, gap); }
  catch (e) { setStatus(status, e.message, 'warn'); return; }
  ctx.imageSmoothingQuality = 'high';
  rects.forEach((r, i) => {
    const it = items[i];
    const c = coverCrop(it.src.width, it.src.height, r.w, r.h, it.fx, it.fy);
    ctx.drawImage(it.src, c.sx, c.sy, c.sw, c.sh, r.x, r.y, r.w, r.h);
  });
  if (selected >= 0 && rects[selected]) {
    const r = rects[selected];
    ctx.strokeStyle = '#2f6fed'; ctx.lineWidth = Math.max(4, W / 200);
    ctx.strokeRect(r.x + ctx.lineWidth / 2, r.y + ctx.lineWidth / 2, r.w - ctx.lineWidth, r.h - ctx.lineWidth);
  }
}

function renderList() {
  const list = $('#files');
  list.replaceChildren();
  items.forEach((it, i) => {
    const move = (d) => { const [x] = items.splice(i, 1); items.splice(i + d, 0, x); selected = -1; renderList(); render(); };
    list.append(h('li', {},
      h('span', { class: 'tag' }, String(i + 1)),
      h('img', { src: it.thumb, alt: '' }),
      h('span', { class: 'grow muted' }, `${i + 1}번 칸`),
      h('button', { class: 'small ghost', title: '앞으로', disabled: i === 0, onclick: () => move(-1) }, '▲'),
      h('button', { class: 'small ghost', title: '뒤로', disabled: i === items.length - 1, onclick: () => move(1) }, '▼'),
      h('button', { class: 'small ghost', title: '빼기', onclick: () => { items.splice(i, 1); selected = -1; fillLayouts(); renderList(); render(); } }, '✕')));
  });
  if (items.length === 1) setStatus(status, '사진을 1장 더 넣어 주세요.', 'warn');
}

/* 미리보기에서 끌기(보이는 부분 옮기기)·누르기(자리 바꾸기) */
let drag = null;
const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height]; };
const hit = ([x, y]) => rects.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

canvas.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e), i = hit(p);
  if (i < 0) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { i, start: p, fx: items[i].fx, fy: items[i].fy, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCanvas(e), dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
  if (!drag.moved && Math.hypot(dx, dy) < canvas.width / 100) return;
  drag.moved = true;
  const it = items[drag.i], r = rects[drag.i];
  const c = coverCrop(it.src.width, it.src.height, r.w, r.h);
  const k = c.sw / r.w;                       // 화면 1px 당 원본 px
  const freeX = it.src.width - c.sw, freeY = it.src.height - c.sh;
  it.fx = freeX > 0.5 ? Math.min(1, Math.max(0, drag.fx - (dx * k) / freeX)) : 0.5;
  it.fy = freeY > 0.5 ? Math.min(1, Math.max(0, drag.fy - (dy * k) / freeY)) : 0.5;
  render();
});
canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  if (!drag.moved) {
    const i = drag.i;
    if (selected < 0) { selected = i; setStatus(status, '자리를 바꿀 다른 칸을 누르세요.'); }
    else if (selected === i) { selected = -1; setStatus(status, ''); }
    else { [items[selected], items[i]] = [items[i], items[selected]]; selected = -1; renderList(); setStatus(status, '두 사진의 자리를 바꿨습니다.', 'ok'); }
    render();
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });

['layout', 'size', 'gap', 'bg'].forEach((id) => $('#' + id).addEventListener('input', render));

async function save(type) {
  const s = selected; selected = -1; render();   // 선택 테두리가 찍히지 않게
  const blob = await new Promise((res) => canvas.toBlob(res, type, 0.92));
  selected = s; render();
  download(blob, `collage.${type === 'image/png' ? 'png' : 'jpg'}`);
  setStatus(status, `저장했습니다 (${canvas.width}×${canvas.height}, ${fmtBytes(blob.size)}).`, 'ok');
  track('tool_download', { tool: 'photo-collage', photos: items.length, layout: currentLayout().id, size: $('#size').value });
}
$('#saveJpg').addEventListener('click', () => save('image/jpeg'));
$('#savePng').addEventListener('click', () => save('image/png'));

fileDrop($('.drop'), async (files) => {
  const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name));
  if (!imgs.length) { setStatus(status, '사진 파일을 넣어 주세요.', 'warn'); return; }
  const room = MAX - items.length;
  if (room <= 0) { setStatus(status, '9장까지 넣을 수 있습니다. 빼고 다시 넣어 주세요.', 'warn'); return; }
  setStatus(status, '사진을 여는 중…');
  let failed = 0;
  for (const f of imgs.slice(0, room)) {
    try { items.push(await loadImage(f)); } catch { failed++; }
  }
  fillLayouts(); renderList(); render();
  const extra = imgs.length > room ? ` ${imgs.length - room}장은 9장을 넘어 넣지 않았습니다.` : '';
  if (items.length >= 2) setStatus(status, `${items.length}장을 배치했습니다.${extra}${failed ? ` ${failed}장은 열지 못했습니다(HEIC 등).` : ''}`, failed || extra ? 'warn' : 'ok');
  track('tool_use', { tool: 'photo-collage', photos: items.length });
});
