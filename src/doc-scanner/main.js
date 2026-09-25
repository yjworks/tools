import { PDFDocument } from 'pdf-lib';
import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import {
  outputSize, warpPerspective, toGray, adaptiveThreshold, detectQuad, insetQuad, rotateQuad,
} from '../_shared/doc-scanner.js';

const MAX_WORK = 3000;   // 원본을 이 크기 안으로 줄여서 다룬다(메모리 보호)
const view = $('#view'), vctx = view.getContext('2d');
const out = $('#out'), octx = out.getContext('2d');
const status = $('#status');

let work = null;        // 원본(방향 보정·축소) 캔버스
let workData = null;    // 원본 ImageData
let quad = null;        // 원본 좌표 [좌상, 우상, 우하, 좌하]
let warped = null;      // 펴 낸 컬러 RGBA {data, width, height}
let drag = -1, dragPos = null;
let pages = [];
let counter = 0;

/* ---------- 불러오기 ---------- */
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { URL.revokeObjectURL(url); }
  }
}

async function open(file) {
  setStatus(status, '사진을 여는 중…');
  let bmp;
  try { bmp = await loadBitmap(file); }
  catch { setStatus(status, '이 사진을 열지 못했습니다. HEIC라면 JPG로 바꿔 넣어 주세요.', 'bad'); return; }
  const w0 = bmp.width, h0 = bmp.height, s = Math.min(1, MAX_WORK / Math.max(w0, h0));
  work = document.createElement('canvas');
  work.width = Math.round(w0 * s); work.height = Math.round(h0 * s);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(bmp, 0, 0, work.width, work.height);
  bmp.close?.();
  workData = wctx.getImageData(0, 0, work.width, work.height);
  warped = null;
  $('#result').hidden = true;
  $('#editor').hidden = false;
  const found = autoQuad();
  quad = found || insetQuad(work.width, work.height);
  sizeView();
  setStatus(status, found ? '문서 모서리를 찾았습니다. 맞는지 확인하고 필요하면 끌어서 고치세요.' : '모서리를 자동으로 찾지 못했습니다. 동그라미를 문서 꼭짓점으로 끌어 주세요.', found ? 'ok' : 'warn');
  track('tool_use', { tool: 'doc-scanner', auto: found ? 1 : 0 });
}

/** 작게 줄인 사본에서 모서리 찾기 */
function autoQuad() {
  const s = Math.min(1, 320 / Math.max(work.width, work.height));
  const w = Math.max(1, Math.round(work.width * s)), hh = Math.max(1, Math.round(work.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(work, 0, 0, w, hh);
  const q = detectQuad(toGray(ctx.getImageData(0, 0, w, hh).data), w, hh);
  return q ? q.map(([x, y]) => [Math.min(work.width, x / s), Math.min(work.height, y / s)]) : null;
}

/* ---------- 모서리 맞추기 화면 ---------- */
let scale = 1, dpr = 1;
function sizeView() {
  if (!work) return;
  const cssW = view.parentElement.clientWidth || 320;
  const maxH = window.innerHeight * 0.7;
  let w = cssW, hh = (cssW * work.height) / work.width;
  if (hh > maxH) { hh = maxH; w = (hh * work.width) / work.height; }
  dpr = Math.min(2, window.devicePixelRatio || 1);
  view.style.width = `${w}px`; view.style.height = `${hh}px`;
  view.style.margin = '0 auto';
  view.width = Math.round(w * dpr); view.height = Math.round(hh * dpr);
  scale = view.width / work.width;
  draw();
}

const LABELS = ['좌상', '우상', '우하', '좌하'];
function draw() {
  if (!work) return;
  vctx.clearRect(0, 0, view.width, view.height);
  vctx.drawImage(work, 0, 0, view.width, view.height);
  const P = quad.map(([x, y]) => [x * scale, y * scale]);
  // 문서 밖을 어둡게
  vctx.save();
  vctx.fillStyle = 'rgba(0,0,0,.45)';
  vctx.beginPath(); vctx.rect(0, 0, view.width, view.height);
  vctx.moveTo(P[0][0], P[0][1]); for (let i = 3; i >= 1; i--) vctx.lineTo(P[i][0], P[i][1]); vctx.closePath();
  vctx.fill('evenodd');
  vctx.restore();
  vctx.lineWidth = 2 * dpr; vctx.strokeStyle = '#2f6fed';
  vctx.beginPath(); P.forEach(([x, y], i) => (i ? vctx.lineTo(x, y) : vctx.moveTo(x, y))); vctx.closePath(); vctx.stroke();
  const r = 11 * dpr;
  P.forEach(([x, y], i) => {
    vctx.beginPath(); vctx.arc(x, y, r, 0, Math.PI * 2);
    vctx.fillStyle = i === drag ? 'rgba(47,111,237,.55)' : 'rgba(255,255,255,.35)'; vctx.fill();
    vctx.lineWidth = 2.5 * dpr; vctx.strokeStyle = '#2f6fed'; vctx.stroke();
  });
  // 위쪽 가장자리 표시(결과의 위가 어디인지)
  vctx.fillStyle = '#2f6fed'; vctx.font = `${12 * dpr}px sans-serif`; vctx.textAlign = 'center';
  vctx.fillText('위', (P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 - 8 * dpr);
  if (drag >= 0) loupe(P[drag]);
}

/** 손가락에 가려지는 곳을 크게 보여 주는 확대경 */
function loupe([px, py]) {
  const R = 52 * dpr, zoom = 3;
  const cx = px < view.width / 2 ? view.width - R - 8 * dpr : R + 8 * dpr, cy = R + 8 * dpr;
  vctx.save();
  vctx.beginPath(); vctx.arc(cx, cy, R, 0, Math.PI * 2); vctx.clip();
  vctx.fillStyle = '#000'; vctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  const sw = (R * 2) / (zoom * scale);
  vctx.drawImage(work, px / scale - sw / 2, py / scale - sw / 2, sw, sw, cx - R, cy - R, R * 2, R * 2);
  vctx.strokeStyle = '#ff3b30'; vctx.lineWidth = 1.5 * dpr;
  vctx.beginPath(); vctx.moveTo(cx - 12 * dpr, cy); vctx.lineTo(cx + 12 * dpr, cy); vctx.moveTo(cx, cy - 12 * dpr); vctx.lineTo(cx, cy + 12 * dpr); vctx.stroke();
  vctx.restore();
  vctx.beginPath(); vctx.arc(cx, cy, R, 0, Math.PI * 2); vctx.lineWidth = 2 * dpr; vctx.strokeStyle = '#fff'; vctx.stroke();
}

function evPos(e) {
  const rect = view.getBoundingClientRect();
  return [((e.clientX - rect.left) * view.width) / rect.width, ((e.clientY - rect.top) * view.height) / rect.height];
}

view.addEventListener('pointerdown', (e) => {
  if (!work) return;
  const [x, y] = evPos(e);
  let best = -1, bestD = (30 * dpr) ** 2;
  quad.forEach(([qx, qy], i) => { const d = (qx * scale - x) ** 2 + (qy * scale - y) ** 2; if (d < bestD) { bestD = d; best = i; } });
  if (best < 0) return;
  drag = best; dragPos = [x - quad[best][0] * scale, y - quad[best][1] * scale];
  view.setPointerCapture(e.pointerId);
  e.preventDefault();
  draw();
});
view.addEventListener('pointermove', (e) => {
  if (drag < 0) return;
  const [x, y] = evPos(e);
  quad[drag] = [Math.max(0, Math.min(work.width, (x - dragPos[0]) / scale)), Math.max(0, Math.min(work.height, (y - dragPos[1]) / scale))];
  draw();
});
const endDrag = () => { if (drag >= 0) { drag = -1; draw(); } };
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
// 키보드: 모서리 선택은 1~4, 화살표로 이동
let keySel = 0;
view.tabIndex = 0;
view.addEventListener('keydown', (e) => {
  if (!work) return;
  if (/^[1-4]$/.test(e.key)) { keySel = Number(e.key) - 1; setStatus(status, `${LABELS[keySel]} 모서리를 화살표로 움직입니다.`); return; }
  const step = (e.shiftKey ? 20 : 3) / scale;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  const [x, y] = quad[keySel];
  quad[keySel] = [Math.max(0, Math.min(work.width, x + d[0])), Math.max(0, Math.min(work.height, y + d[1]))];
  draw();
});
window.addEventListener('resize', () => sizeView());

$('#auto').addEventListener('click', () => {
  const q = autoQuad();
  if (q) { quad = q; setStatus(status, '문서 모서리를 다시 찾았습니다.', 'ok'); }
  else setStatus(status, '자동으로 찾지 못했습니다. 직접 끌어 맞춰 주세요.', 'warn');
  draw();
});
$('#reset').addEventListener('click', () => { quad = insetQuad(work.width, work.height); draw(); });
$('#rotate').addEventListener('click', () => { quad = rotateQuad(quad); draw(); if (warped) apply(); });

/* ---------- 펴기·색 처리 ---------- */
const tick = () => new Promise((r) => setTimeout(r, 20));

async function apply() {
  if (!work) return;
  $('#apply').disabled = true;
  setStatus(status, '펴는 중…');
  await tick();
  try {
    const { width, height } = outputSize(quad, { maxSide: MAX_WORK, aspect: Number($('#aspect').value) });
    warped = { data: warpPerspective(workData, quad, width, height), width, height };
    renderMode();
    $('#result').hidden = false;
    setStatus(status, `${width}×${height} 화소로 폈습니다.`, 'ok');
    track('tool_use', { tool: 'doc-scanner', step: 'warp', mode: $('#mode').value });
  } catch (e) {
    setStatus(status, `펴지 못했습니다: ${e.message}`, 'bad');
  } finally { $('#apply').disabled = false; }
}

function renderMode() {
  if (!warped) return;
  const { width: w, height: hh } = warped, mode = $('#mode').value;
  const img = new ImageData(w, hh);
  if (mode === 'color') img.data.set(warped.data);
  else {
    const g = toGray(warped.data, w * hh);
    const v = mode === 'bw' ? adaptiveThreshold(g, w, hh, { t: Number($('#sens').value) }) : g;
    for (let i = 0, j = 0; i < v.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = v[i]; img.data[j + 3] = 255; }
  }
  out.width = w; out.height = hh;
  octx.putImageData(img, 0, 0);
}

function syncSens() { $('#sensBox').style.opacity = $('#mode').value === 'bw' ? 1 : 0.45; $('#sensVal').textContent = $('#sens').value; }
$('#mode').addEventListener('change', () => { syncSens(); renderMode(); });
$('#sens').addEventListener('input', () => { syncSens(); });
$('#sens').addEventListener('change', () => renderMode());
$('#aspect').addEventListener('change', () => { if (warped) apply(); });
$('#apply').addEventListener('click', apply);
syncSens();

const toBlob = (type, q) => new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했습니다'))), type, q));

async function save(type) {
  const blob = await toBlob(type, 0.9);
  counter++;
  download(blob, `scan-${counter}.${type === 'image/png' ? 'png' : 'jpg'}`);
  setStatus(status, `저장했습니다 (${fmtBytes(blob.size)}).`, 'ok');
  track('tool_download', { tool: 'doc-scanner', type: type === 'image/png' ? 'png' : 'jpg' });
}
$('#saveJpg').addEventListener('click', () => save('image/jpeg'));
$('#savePng').addEventListener('click', () => save('image/png'));

/* ---------- 여러 장 PDF ---------- */
$('#addPage').addEventListener('click', async () => {
  const bw = $('#mode').value === 'bw';
  const type = bw ? 'image/png' : 'image/jpeg';
  const blob = await toBlob(type, 0.9);
  pages.push({ blob, type, w: out.width, h: out.height, url: URL.createObjectURL(blob) });
  renderPages();
  setStatus(status, `${pages.length}쪽째로 넣었습니다. 다음 사진을 고르면 이어서 추가할 수 있습니다.`, 'ok');
});

function renderPages() {
  const list = $('#pages');
  list.replaceChildren();
  pages.forEach((p, i) => {
    const move = (d) => { const [x] = pages.splice(i, 1); pages.splice(i + d, 0, x); renderPages(); };
    list.append(h('li', {},
      h('span', { class: 'tag' }, `${i + 1}쪽`),
      h('img', { src: p.url, alt: '' }),
      h('span', { class: 'grow muted' }, `${p.w}×${p.h} · ${fmtBytes(p.blob.size)}`),
      h('button', { class: 'small ghost', title: '앞으로', disabled: i === 0, onclick: () => move(-1) }, '▲'),
      h('button', { class: 'small ghost', title: '뒤로', disabled: i === pages.length - 1, onclick: () => move(1) }, '▼'),
      h('button', { class: 'small ghost', title: '빼기', onclick: () => { URL.revokeObjectURL(p.url); pages.splice(i, 1); renderPages(); } }, '✕')));
  });
  $('#pagesBox').hidden = !pages.length;
}

$('#savePdf').addEventListener('click', async () => {
  if (!pages.length) return;
  const btn = $('#savePdf'); btn.disabled = true;
  try {
    const pdf = await PDFDocument.create();
    const a4 = $('#pdfSize').value === 'a4';
    for (const p of pages) {
      const bytes = await p.blob.arrayBuffer();
      const img = p.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      let pw, ph;
      if (a4) { [pw, ph] = img.width > img.height ? [841.89, 595.28] : [595.28, 841.89]; }
      else { pw = (img.width * 72) / 200; ph = (img.height * 72) / 200; } // 200dpi 로 본 크기
      const page = pdf.addPage([pw, ph]);
      const s = Math.min(pw / img.width, ph / img.height);
      page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
    pdf.setProducer('DigitalBrain 도구 (dibrain.dev/tools)');
    const bytes = await pdf.save();
    download(new Blob([bytes], { type: 'application/pdf' }), 'scan.pdf');
    setStatus(status, `PDF를 만들었습니다 (${pages.length}쪽, ${fmtBytes(bytes.length)}).`, 'ok');
    track('tool_download', { tool: 'doc-scanner', type: 'pdf', pages: pages.length });
  } catch (e) {
    setStatus(status, `PDF를 만들지 못했습니다: ${e.message}`, 'bad');
  } finally { btn.disabled = false; }
});

fileDrop($('.drop'), (files) => {
  const f = files.find((x) => x.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(x.name));
  if (!f) { setStatus(status, '사진 파일을 넣어 주세요.', 'warn'); return; }
  open(f);
});
