import jsQR from 'jsqr';
import { $, h, fileDrop, download, setStatus, copyText, track } from '../_shared/ui.js';
import {
  makeMatrix, matrixToSvg, wifiString, parseWifi, vcardString, classify, normalizeUrl,
} from '../_shared/qr-code.js';

const status = $('#status'), qr = $('#qr'), qctx = qr.getContext('2d');
const MARGIN = 4;
let matrix = null, content = '';

/* ---------- 탭 ---------- */
function showTab(make) {
  $('#tabMake').setAttribute('aria-selected', String(make));
  $('#tabRead').setAttribute('aria-selected', String(!make));
  $('#makePane').hidden = !make; $('#readPane').hidden = make;
  if (make) stopCamera();
  setStatus(status, '');
}
$('#tabMake').addEventListener('click', () => showTab(true));
$('#tabRead').addEventListener('click', () => showTab(false));

/* ---------- 만들기 ---------- */
function buildContent() {
  const kind = $('#kind').value;
  if (kind === 'wifi') return wifiString({ ssid: $('#ssid').value, password: $('#wpass').value, type: $('#wtype').value, hidden: $('#whidden').checked });
  if (kind === 'vcard') {
    return vcardString({ name: $('#vname').value.trim(), tel: $('#vtel').value.trim(), email: $('#vmail').value.trim(), org: $('#vorg').value.trim(), title: $('#vtitle').value.trim(), url: $('#vurl').value.trim() ? normalizeUrl($('#vurl').value) : '' });
  }
  const t = $('#text').value;
  if (!t.trim()) throw new Error('담을 주소나 글을 넣어 주세요');
  return /\s/.test(t.trim()) ? t : normalizeUrl(t);
}

function lum(hex) { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255; }

function update() {
  let text;
  try { text = buildContent(); }
  catch (e) { matrix = null; clearQr(); setStatus(status, e.message, 'warn'); return; }
  try { matrix = makeMatrix(text, $('#ecc').value); }
  catch (e) { matrix = null; clearQr(); setStatus(status, e.message, 'bad'); return; }
  content = text;
  const n = matrix.size + MARGIN * 2;
  const scale = Math.max(1, Math.floor(Number($('#px').value) / n));
  qr.width = qr.height = n * scale;
  qctx.fillStyle = '#fff'; qctx.fillRect(0, 0, qr.width, qr.height);
  qctx.fillStyle = $('#fg').value;
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
    if (matrix.isDark(r, c)) qctx.fillRect((c + MARGIN) * scale, (r + MARGIN) * scale, scale, scale);
  }
  const bytes = new TextEncoder().encode(text).length;
  $('#qrInfo').textContent = `${matrix.size}×${matrix.size}칸 (버전 ${matrix.version}) · ${bytes}바이트 · PNG ${qr.width}px`;
  $('#savePng').disabled = $('#saveSvg').disabled = false;
  if (lum($('#fg').value) > 0.5) setStatus(status, '점 색이 너무 밝으면 카메라가 읽지 못할 수 있습니다. 진한 색을 쓰세요.', 'warn');
  else setStatus(status, '');
}
function clearQr() {
  qr.width = qr.height = 1; $('#qrInfo').textContent = '';
  $('#savePng').disabled = $('#saveSvg').disabled = true;
}

let timer = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 120); };
$('#makePane').addEventListener('input', schedule);
$('#makePane').addEventListener('change', schedule);
$('#kind').addEventListener('change', () => {
  const k = $('#kind').value;
  $('#f-text').hidden = k !== 'text'; $('#f-wifi').hidden = k !== 'wifi'; $('#f-vcard').hidden = k !== 'vcard';
});
$('#wtype').addEventListener('change', () => { $('#wpass').disabled = $('#wtype').value === 'nopass'; });

$('#savePng').addEventListener('click', () => {
  qr.toBlob((b) => { download(b, `qr-${$('#kind').value}.png`); track('tool_download', { tool: 'qr-code', type: 'png', kind: $('#kind').value, ecc: $('#ecc').value }); }, 'image/png');
});
$('#saveSvg').addEventListener('click', () => {
  if (!matrix) return;
  const svg = matrixToSvg(matrix, { margin: MARGIN, fg: $('#fg').value });
  download(new Blob([svg], { type: 'image/svg+xml' }), `qr-${$('#kind').value}.svg`);
  track('tool_download', { tool: 'qr-code', type: 'svg', kind: $('#kind').value, ecc: $('#ecc').value });
});

/* ---------- 읽기 ---------- */
function showResult(text, how) {
  const box = $('#readout');
  box.hidden = false; box.replaceChildren();
  const kind = classify(text);
  box.append(h('b', {}, { url: '인터넷 주소', wifi: '와이파이 접속 정보', vcard: '연락처', uri: '전화·메일 등', text: '글' }[kind]));
  if (kind === 'wifi') {
    const w = parseWifi(text);
    box.append(h('dl', {}, h('dt', {}, '이름'), h('dd', {}, w.ssid), h('dt', {}, '비밀번호'), h('dd', {}, w.password || '(없음)'), h('dt', {}, '보안'), h('dd', {}, w.type || '-')));
  } else box.append(h('pre', {}, text));
  const row = h('div', { class: 'row' });
  const copyBtn = h('button', { class: 'small ghost', onclick: () => copyText(kind === 'wifi' ? parseWifi(text).password : text, copyBtn) }, kind === 'wifi' ? '비밀번호 복사' : '복사');
  row.append(copyBtn);
  if (kind === 'url') row.append(h('a', { class: 'btn small', href: text.trim(), target: '_blank', rel: 'noopener noreferrer' }, '주소 열기'));
  box.append(row);
  if (kind === 'url') box.append(h('p', { class: 'muted', style: 'margin:8px 0 0' }, '모르는 곳에서 받은 QR이라면, 열기 전에 주소가 맞는지 확인하세요.'));
  setStatus(status, 'QR 코드를 읽었습니다.', 'ok');
  track('tool_use', { tool: 'qr-code', read: how, kind });
}

async function readFile(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { setStatus(status, '이 사진을 열지 못했습니다.', 'bad'); return; }
  // 큰 사진은 줄이되, 작은 코드가 뭉개지지 않도록 두 크기로 시도한다
  for (const max of [1600, 800, 2400]) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const res = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (res) { bmp.close?.(); showResult(res.data, 'image'); return; }
    if (s === 1) break;
  }
  bmp.close?.();
  $('#readout').hidden = true;
  setStatus(status, 'QR 코드를 찾지 못했습니다. 코드가 크고 선명하게 나오도록 잘라서 다시 넣어 보세요.', 'warn');
}

fileDrop($('#readPane .drop'), (files) => {
  const f = files.find((x) => x.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(x.name));
  if (!f) { setStatus(status, '사진 파일을 넣어 주세요.', 'warn'); return; }
  stopCamera();
  readFile(f);
});

/* 카메라 */
const video = $('#video');
let stream = null, raf = 0, detector = null, lastScan = 0;
const scanCanvas = document.createElement('canvas');

if (!navigator.mediaDevices?.getUserMedia) {
  $('#camBtn').disabled = true;
  $('#camNote').textContent = '이 브라우저에서는 카메라를 쓸 수 없습니다. 사진으로 읽어 주세요.';
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    setStatus(status, e.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다. 주소창의 권한 설정에서 허용하거나 사진으로 읽어 주세요.' : '카메라를 켜지 못했습니다. 사진으로 읽어 주세요.', 'warn');
    return;
  }
  video.srcObject = stream; video.hidden = false;
  await video.play().catch(() => {});
  $('#camBtn').textContent = '■ 카메라 끄기';
  if ('BarcodeDetector' in window) {
    try { if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
  }
  setStatus(status, 'QR 코드를 화면 가운데에 비춰 주세요.');
  loop();
}

function stopCamera() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; video.hidden = true; video.srcObject = null;
  $('#camBtn').textContent = '📷 카메라로 읽기';
}

async function loop() {
  if (!stream) return;
  raf = requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastScan < 200 || video.readyState < 2) return;
  lastScan = now;
  let text = null;
  if (detector) {
    try { const r = await detector.detect(video); if (r.length) text = r[0].rawValue; } catch { detector = null; }
  } else {
    const s = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    scanCanvas.width = Math.round(video.videoWidth * s); scanCanvas.height = Math.round(video.videoHeight * s);
    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const r = jsQR(ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height).data, scanCanvas.width, scanCanvas.height, { inversionAttempts: 'dontInvert' });
    if (r) text = r.data;
  }
  if (text != null && stream) { stopCamera(); showResult(text, 'camera'); }
}

$('#camBtn').addEventListener('click', () => (stream ? stopCamera() : startCamera()));
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

$('#text').value = 'https://dibrain.dev/tools/';
update();
