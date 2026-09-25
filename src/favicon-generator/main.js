import { zipSync, strToU8 } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, copyText, track } from '../_shared/ui.js';
import { buildIco, FILES, ICO_SIZES, manifest, htmlSnippet, textScale } from '../_shared/favicon-generator.js';

const MASTER = 512;
const status = $('#status');
let mode = 'text';
let logo = null;   // ImageBitmap / Image

/* ---------- 탭 ---------- */
function showTab(text) {
  mode = text ? 'text' : 'image';
  $('#tabText').setAttribute('aria-selected', String(text));
  $('#tabImg').setAttribute('aria-selected', String(!text));
  $('#textPane').hidden = !text; $('#imgPane').hidden = text;
  update();
}
$('#tabText').addEventListener('click', () => showTab(true));
$('#tabImg').addEventListener('click', () => showTab(false));

/* ---------- 그리기 ---------- */
function shapePath(ctx, s, shape) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') { const r = s * 0.2; ctx.roundRect ? ctx.roundRect(0, 0, s, s, r) : ctx.rect(0, 0, s, s); }
  else ctx.rect(0, 0, s, s);
}

/** 512px 원본. opaque = 애플 아이콘용(배경을 사각형으로 꽉 채움) */
function renderMaster(opaque = false) {
  const s = MASTER, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  let shape = $('#shape').value;
  const bg = $('#bgc').value;
  if (opaque) shape = 'square';
  if (shape !== 'none') { ctx.fillStyle = bg; shapePath(ctx, s, shape); ctx.fill(); }
  else if (opaque) { ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s); }
  ctx.save();
  if (shape === 'circle' || shape === 'rounded') { shapePath(ctx, s, shape); ctx.clip(); }
  if (mode === 'text') drawGlyph(ctx, s);
  else if (logo) drawLogo(ctx, s, shape);
  ctx.restore();
  return c;
}

function drawGlyph(ctx, s) {
  const text = $('#glyph').value.trim() || '?';
  const size = s * textScale(text);
  ctx.font = `800 ${size}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillStyle = $('#fgc').value;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  // 실제 글자 윤곽의 위아래 가운데를 칸 가운데에 맞춘다
  const asc = m.actualBoundingBoxAscent ?? size * 0.72, desc = m.actualBoundingBoxDescent ?? 0;
  const maxW = s * 0.86;
  if (m.width > maxW) { ctx.save(); ctx.translate(s / 2, 0); ctx.scale(maxW / m.width, 1); ctx.fillText(text, 0, s / 2 + (asc - desc) / 2); ctx.restore(); }
  else ctx.fillText(text, s / 2, s / 2 + (asc - desc) / 2);
}

function drawLogo(ctx, s, shape) {
  const pad = (Number($('#pad').value) / 100) * s + (shape === 'circle' ? s * 0.08 : 0);
  const box = s - pad * 2, w = logo.width, hh = logo.height;
  ctx.imageSmoothingQuality = 'high';
  if ($('#fit').value === 'cover') {
    const k = Math.max(box / w, box / hh), cw = box / k, ch = box / k;
    ctx.drawImage(logo, (w - cw) / 2, (hh - ch) / 2, cw, ch, pad, pad, box, box);
  } else {
    const k = Math.min(box / w, box / hh), dw = w * k, dh = hh * k;
    ctx.drawImage(logo, (s - dw) / 2, (s - dh) / 2, dw, dh);
  }
}

/** 절반씩 여러 번 줄여 작은 크기도 선이 뭉개지지 않게 */
function resize(src, size) {
  let cur = src;
  while (cur.width / 2 >= size * 1.5) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(cur.width / 2);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const x = out.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, size, size);
  return out;
}

let rendered = {};   // name → canvas
function update() {
  const master = renderMaster(false), opaque = renderMaster(true);
  rendered = {};
  for (const f of FILES) rendered[f.name] = resize(f.opaque ? opaque : master, f.size);
  const box = $('#previews');
  box.replaceChildren();
  const name = $('#siteName').value.trim() || '내 사이트';
  const tab = h('div', { class: 'tabbar' }, copy(rendered['favicon-16x16.png'], 16), h('span', {}, name));
  box.append(h('figure', {}, tab, '브라우저 탭'));
  for (const [file, label, css] of [['favicon-16x16.png', '16'], ['favicon-32x32.png', '32'], ['favicon-48x48.png', '48'], ['apple-touch-icon.png', '180 (애플)', 'big'], ['android-chrome-192x192.png', '192 (안드로이드)', 'big']]) {
    const c = copy(rendered[file]);
    if (css) c.className = css;
    box.append(h('figure', {}, c, label));
  }
  const opt = { name, shortName: name.slice(0, 12), theme: $('#bgc').value, background: $('#shape').value === 'none' ? '#ffffff' : $('#bgc').value, path: $('#path').value };
  $('#html').textContent = htmlSnippet(opt);
  $('#manifest').textContent = manifest(opt);
  const ready = mode === 'text' || logo;
  $('#zip').disabled = $('#ico').disabled = !ready;
}
function copy(src, cssSize) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  if (cssSize) c.style.width = c.style.height = `${cssSize}px`;
  return c;
}

const pngBytes = (c) => new Promise((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('PNG를 만들지 못했습니다'))), 'image/png'));

async function makeIco() {
  const pngs = [];
  for (const s of ICO_SIZES) pngs.push(await pngBytes(rendered[`favicon-${s}x${s}.png`]));
  return buildIco(pngs);
}

$('#ico').addEventListener('click', async () => {
  try {
    const ico = await makeIco();
    download(new Blob([ico], { type: 'image/x-icon' }), 'favicon.ico');
    setStatus(status, `favicon.ico를 저장했습니다 (${fmtBytes(ico.length)}).`, 'ok');
    track('tool_download', { tool: 'favicon-generator', type: 'ico', source: mode });
  } catch (e) { setStatus(status, e.message, 'bad'); }
});

$('#zip').addEventListener('click', async () => {
  try {
    const files = { 'favicon.ico': await makeIco() };
    for (const f of FILES) files[f.name] = await pngBytes(rendered[f.name]);
    files['site.webmanifest'] = strToU8($('#manifest').textContent);
    files['head-snippet.html'] = strToU8($('#html').textContent + '\n');
    const zip = zipSync(files);
    download(new Blob([zip], { type: 'application/zip' }), 'favicon.zip');
    setStatus(status, `ZIP을 저장했습니다 (${Object.keys(files).length}개 파일, ${fmtBytes(zip.length)}).`, 'ok');
    track('tool_download', { tool: 'favicon-generator', type: 'zip', source: mode, shape: $('#shape').value });
  } catch (e) { setStatus(status, e.message, 'bad'); }
});

$('#copyHtml').addEventListener('click', (e) => copyText($('#html').textContent, e.currentTarget));

let timer = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 80); };
$('#tool').addEventListener('input', schedule);
$('#tool').addEventListener('change', schedule);
$('#pad').addEventListener('input', () => { $('#padVal').textContent = `${$('#pad').value}%`; });

async function loadLogo(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    // SVG 는 크기 정보가 없을 수 있어 Image 로 그린다
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas');
      const w = img.naturalWidth || MASTER, hh = img.naturalHeight || MASTER, k = MASTER / Math.max(w, hh);
      c.width = Math.round(w * k); c.height = Math.round(hh * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

fileDrop($('#imgPane .drop'), async (files) => {
  const f = files[0];
  try { logo = await loadLogo(f); }
  catch { setStatus(status, '이미지를 열지 못했습니다. PNG·JPG·SVG·WEBP를 넣어 주세요.', 'bad'); return; }
  if (Math.min(logo.width, logo.height) < 180) setStatus(status, '이미지가 작아 큰 아이콘(180·512)이 흐릴 수 있습니다. 512px 이상을 권합니다.', 'warn');
  else setStatus(status, `${logo.width}×${logo.height} 이미지를 불러왔습니다.`, 'ok');
  if (logo.width !== logo.height) $('#fit').value = 'contain';
  update();
  track('tool_use', { tool: 'favicon-generator', source: 'image' });
});

// 웹 글꼴이 늦게 도착하면 글자 모양이 바뀌므로 한 번 더 그린다
update();
document.fonts?.ready.then(update);
