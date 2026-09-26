import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { readJpegExif, stripJpeg, stripPng, isJpeg, isPng } from '../_shared/exif.js';
import { editExif, exifSegment, insertJpegSegments, pngChunk, insertPngChunks, canvasLimit, fitPixels } from '../_shared/heic-to-jpg.js';
import {
  parseTarget, fitLongSide, scaledSize, inputMime, resolveFormat, outName, savedPercent, fitToTarget,
  preferOriginal, totals, jpegExifTiff, downscaleSteps, lossless, webpHasMeta,
} from '../_shared/image-compress.js';

const SLUG = 'image-compress';
const list = $('#files'), status = $('#status'), go = $('#go'), zipBtn = $('#zip'), clearBtn = $('#clear');
const totalBar = $('#total'), sum = $('#sum'), quality = $('#quality');
const LIMIT = canvasLimit({ ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints || 0 });
const CAN_WEBP = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; } })();

let items = [], busy = false, seq = 0, selected = null, zoom = 'fit';

if (!CAN_WEBP) {
  $('#webpOpt').textContent = 'WebP (이 브라우저는 저장 불가 → JPG)';
}

const opts = () => ({
  mode: document.querySelector('input[name=mode]:checked').value,
  q: Number(quality.value) / 100,
  target: parseTarget($('#target').value, $('#unit').value),
  maxLong: Number($('#maxLong').value),
  fmt: $('#fmt').value,
  allowResize: $('#allowResize').checked,
  strip: $('#strip').checked,
});

/* ───── 그리기·저장 ───── */

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return createImageBitmap(file); }
}

function drawScaled(src, sw, sh, tw, th, opaque) {
  let cur = src, cw = sw, ch = sh;
  for (const [w, hh] of downscaleSteps(sw, sh, tw, th)) {
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (opaque && w === tw && hh === th) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, w, hh);
    if (cur !== src) cur.width = cur.height = 1;
    cur = c; cw = w; ch = hh;
  }
  return cur;
}

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('이 브라우저가 이 크기의 사진을 저장하지 못했습니다'))), type, q));

/** 원본 JPG 의 EXIF 를 결과에 옮길 조각(방향은 1로, 미리보기는 뺀다). 옮길 수 없으면 null */
function keptMeta(buf, outMime) {
  if (!isJpeg(buf) || outMime === 'image/webp') return null;
  const tiff = jpegExifTiff(buf);
  if (!tiff) return null;
  const t = editExif(tiff, { dropGps: false, orientation: 1, dropThumbnail: true });
  if (!t) return null;
  if (outMime === 'image/jpeg') { const s = exifSegment(t); return s ? { jpeg: s, extra: s.length } : null; }
  const c = pngChunk('eXIf', t);
  return { png: c, extra: c.length };
}

async function compress(it, o) {
  const buf = await it.file.arrayBuffer();
  const inMime = it.mime;
  const { mime: outMime, fallback } = resolveFormat(o.fmt, inMime, CAN_WEBP);
  const orientation = isJpeg(buf) ? readJpegExif(buf)?.orientation || 1 : 1;
  const bmp = await decode(it.file);
  const w0 = bmp.width, h0 = bmp.height;
  let base = fitLongSide(w0, h0, o.maxLong);
  const lim = fitPixels(base.width, base.height, LIMIT);
  if (lim.scaled) base = { width: lim.width, height: lim.height, scale: lim.width / w0 };
  const meta = o.strip ? null : keptMeta(buf, outMime);
  const extra = meta?.extra || 0;
  const opaque = outMime === 'image/jpeg';

  const canvases = new Map();
  let tries = 0;
  const encode = async (scale, q) => {
    const key = scale.toFixed(4);
    if (!canvases.has(key)) {
      for (const [k, c] of canvases) { c.width = c.height = 1; canvases.delete(k); }   // 이전 해상도는 버린다
      const { width, height } = scaledSize(base.width, base.height, scale);
      canvases.set(key, drawScaled(bmp, w0, h0, width, height, opaque));
    }
    const c = canvases.get(key);
    const blob = await toBlob(c, outMime, lossless(outMime) ? undefined : q);
    tries++;
    stagePaint(it, `맞추는 중 (${tries}번째)`);
    return { size: blob.size + extra, blob, width: c.width, height: c.height };
  };

  let r;
  if (o.mode === 'target') {
    r = await fitToTarget(encode, o.target, { isLossless: lossless(outMime), allowResize: o.allowResize });
  } else {
    const res = { q: o.q, ...(await encode(1, o.q)) };
    r = { result: res, scale: 1, quality: o.q, fits: true };
  }
  for (const c of canvases.values()) c.width = c.height = 1;
  bmp.close?.();

  const res = r.result;
  const resized = res.width !== w0 || res.height !== h0;
  let bytes = new Uint8Array(await res.blob.arrayBuffer());
  if (meta?.jpeg) bytes = insertJpegSegments(bytes, [meta.jpeg]);
  if (meta?.png) bytes = insertPngChunks(bytes, [meta.png], ['eXIf']);

  it.notes = [];
  it.kept = false;
  if (preferOriginal({ inMime, outMime, resized, origSize: it.size, outSize: bytes.length, target: o.mode === 'target' ? o.target : null, stripMeta: o.strip, orientation, hasMeta: inMime === 'image/webp' ? webpHasMeta(buf) !== false : true })) {
    const orig = new Uint8Array(buf);
    bytes = o.strip ? (isJpeg(buf) ? stripJpeg(buf) : isPng(buf) ? stripPng(buf) : orig) : orig;
    it.kept = true;
    it.notes.push('원본 유지(다시 저장하면 더 커서)');
  }
  it.out = new Blob([bytes], { type: outMime });
  it.outSize = bytes.length;
  it.outMime = outMime;
  it.dims = it.kept ? `${w0}×${h0}` : `${w0}×${h0}${resized ? ` → ${res.width}×${res.height}` : ''}`;
  if (!it.kept && !lossless(outMime)) it.notes.push(`품질 ${Math.round(res.q * 100)}`);
  if (lim.scaled) it.notes.push('브라우저 한도로 크기 줄임');
  if (fallback) it.notes.push('WebP 저장 불가 → JPG');
  if (!o.strip && !meta && !it.kept) it.notes.push('정보는 옮기지 못함');
  it.fits = o.mode !== 'target' || it.outSize <= o.target;
  it.resultUrl && URL.revokeObjectURL(it.resultUrl);
  it.resultUrl = URL.createObjectURL(it.out);
  it.outDims = it.kept ? [w0, h0] : [res.width, res.height];
  it.srcDims = [w0, h0];
}

/* ───── 화면 ───── */

function stagePaint(it, text) { it.stage = text; paintItem(it); }

function paintItem(it) {
  if (!it.li) return;
  let tag;
  if (it.state === 'done') {
    const p = savedPercent(it.size, it.outSize);
    tag = h('span', { class: 'tag ' + (it.fits ? 'ok' : 'warn'), title: it.fits ? '' : '목표 용량보다 큽니다' }, `${fmtBytes(it.outSize)} (${p > 0 ? `−${p}%` : p < 0 ? `+${-p}%` : '±0%'})`);
  } else if (it.state === 'error') tag = h('span', { class: 'tag bad' }, '실패');
  else tag = h('span', { class: 'tag' }, it.state === 'work' ? it.stage || '준비 중' : '대기');
  const detail = [fmtBytes(it.size)];
  if (it.state === 'done') { detail.push(it.dims, ...it.notes); if (!it.fits) detail.push('목표 용량을 맞추지 못함'); }
  if (it.state === 'error') detail.push(it.error);
  const btns = it.state === 'done' ? h('span', { class: 'btns' },
    h('button', { class: 'small ghost', onclick: () => showCompare(it) }, '비교'),
    h('button', { class: 'small ghost', onclick: () => { download(it.out, it.outName); track('tool_download', { tool: SLUG, files: 1, mode: 'single' }); } }, '받기')) : null;
  it.li.className = selected === it ? 'sel' : '';
  it.li.replaceChildren(...[h('img', { src: it.url, alt: '' }), h('span', { class: 'name' }, it.file.name, h('br'), h('small', { class: 'muted' }, detail.join(' · '))), tag, btns].filter(Boolean));
}

function render() {
  list.replaceChildren();
  for (const it of items) { it.li = h('li'); paintItem(it); list.append(it.li); }
  refresh();
}

function refresh() {
  const done = items.filter((it) => it.state === 'done');
  const failed = items.filter((it) => it.state === 'error').length;
  const pending = items.filter((it) => it.state === 'wait').length;
  go.disabled = busy || !pending;
  go.textContent = done.length && pending ? `남은 ${pending}장 줄이기` : '줄이기';
  zipBtn.hidden = !done.length;
  zipBtn.textContent = done.length > 1 ? `ZIP으로 모두 받기(${done.length}장)` : '받기';
  clearBtn.hidden = !items.length || busy;
  totalBar.hidden = !items.length;
  totalBar.firstElementChild.style.width = items.length ? `${((done.length + failed) / items.length) * 100}%` : '0';
  const t = totals(done);
  sum.hidden = !t.done;
  if (t.done) {
    sum.replaceChildren(`${t.done}장 `, h('b', {}, fmtBytes(t.before)), ' → ', h('b', {}, fmtBytes(t.after)),
      h('span', { class: 'muted' }, t.saved >= 0 ? ` · ${fmtBytes(t.saved)} 절약(${t.percent}%)` : ` · ${fmtBytes(-t.saved)} 늘어남`));
  }
}

/* 비교 */
const cmp = $('#cmp'), viewA = $('#viewA'), viewB = $('#viewB'), imgA = $('#imgA'), imgB = $('#imgB');
function applyZoom() {
  for (const b of document.querySelectorAll('.zoom button')) b.setAttribute('aria-pressed', String(b.dataset.z === zoom));
  const it = selected;
  if (!it) return;
  for (const [v, img] of [[viewA, imgA], [viewB, imgB]]) {
    v.classList.toggle('fit', zoom === 'fit');
    if (zoom === 'fit') { img.style.width = ''; img.style.height = ''; }
    else {
      // 둘 다 원본 화소 기준 크기로 보여 준다(결과를 줄였다면 늘려서). 화면 화소 비율로 나눠 실제 1:1 로
      const z = Number(zoom) / (window.devicePixelRatio || 1);
      img.style.width = `${Math.round(it.srcDims[0] * z)}px`; img.style.height = `${Math.round(it.srcDims[1] * z)}px`;
    }
  }
  if (zoom !== 'fit') for (const v of [viewA, viewB]) { v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; v.scrollTop = (v.scrollHeight - v.clientHeight) / 2; }
}
function showCompare(it) {
  const prev = selected; selected = it;
  if (prev) paintItem(prev);
  paintItem(it);
  cmp.hidden = false;
  $('#cmpName').textContent = it.file.name;
  $('#cmpA').textContent = `${fmtBytes(it.size)} · ${it.srcDims.join('×')}`;
  $('#cmpB').textContent = `${fmtBytes(it.outSize)} · ${it.outDims.join('×')}`;
  imgA.src = it.url; imgB.src = it.resultUrl;
  applyZoom();
  cmp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
for (const b of document.querySelectorAll('.zoom button')) b.addEventListener('click', () => { zoom = b.dataset.z; applyZoom(); });
let syncing = false;
for (const [a, b] of [[viewA, viewB], [viewB, viewA]]) {
  a.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true; b.scrollLeft = a.scrollLeft; b.scrollTop = a.scrollTop;
    requestAnimationFrame(() => { syncing = false; });
  });
}

/* ───── 설정 ───── */

function syncFields() {
  const o = opts();
  $('#targetField').hidden = o.mode !== 'target';
  $('#resizeCheck').hidden = o.mode !== 'target';
  $('#qField').hidden = o.mode !== 'quality';
  const note = $('#fmtNote');
  const msgs = [];
  if (o.fmt === 'webp' && !CAN_WEBP) msgs.push('이 브라우저는 WebP로 저장할 수 없어 JPG로 저장합니다.');
  if (o.fmt === 'png') msgs.push('PNG는 품질 값이 없어 해상도로만 용량이 바뀝니다. 사진은 JPG·WebP가 훨씬 작습니다.');
  if (!o.strip && o.fmt === 'webp') msgs.push('WebP 결과에는 사진 정보를 옮기지 않습니다.');
  if (!o.strip) msgs.push('정보를 남기면 촬영 위치(GPS)도 함께 남습니다.');
  note.textContent = msgs.join(' ');
  note.hidden = !msgs.length;
}

function resetResults() {
  syncFields();
  if (busy) return;
  let changed = false;
  for (const it of items) if (it.state !== 'wait') {
    it.state = 'wait'; it.out = null; it.outSize = null;
    if (it.resultUrl) { URL.revokeObjectURL(it.resultUrl); it.resultUrl = null; }
    changed = true;
  }
  if (changed) { selected = null; cmp.hidden = true; render(); setStatus(status, '설정을 바꿨습니다. 줄이기를 다시 누르세요.'); }
}

quality.addEventListener('input', () => { $('#qVal').textContent = quality.value; });
for (const el of [quality, $('#target'), $('#unit'), $('#maxLong'), $('#fmt'), $('#allowResize'), $('#strip')]) el.addEventListener('change', resetResults);
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', resetResults);
syncFields();

go.addEventListener('click', async () => {
  if (busy) return;
  const o = opts();
  if (o.mode === 'target' && !o.target) { setStatus(status, '목표 용량을 1KB 이상 숫자로 넣어 주세요.', 'warn'); return; }
  busy = true; refresh();
  const todo = items.filter((it) => it.state === 'wait');
  const taken = new Set(items.filter((it) => it.state === 'done').map((it) => it.outName.toLowerCase()));
  let ok = 0, fail = 0, missed = 0;
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    it.state = 'work'; it.stage = '읽는 중'; paintItem(it);
    setStatus(status, `${i + 1} / ${todo.length}장 줄이는 중…`);
    try {
      await compress(it, o);
      it.outName = outName(it.file.name, it.outMime, taken);
      it.state = 'done'; ok++;
      if (!it.fits) missed++;
    } catch (e) { it.state = 'error'; it.error = e?.message || '처리하지 못했습니다'; fail++; }
    paintItem(it); refresh();
    await new Promise((r) => setTimeout(r, 0));
  }
  busy = false; refresh();
  const msg = [`${ok}장을 줄였습니다.`];
  if (missed) msg.push(`${missed}장은 목표 용량을 맞추지 못했습니다.`);
  if (fail) msg.push(`${fail}장은 실패했습니다.`);
  setStatus(status, msg.join(' '), fail || missed ? 'warn' : 'ok');
  const t = totals(items.filter((it) => it.state === 'done'));
  track('tool_use', { tool: SLUG, files: todo.length, ok, fail, missed, mode: o.mode, format: o.fmt, max_long: o.maxLong, strip: o.strip,
    target_kb: o.mode === 'target' ? Math.round(o.target / 1000) : 0, in_kb: Math.round(t.before / 1024), out_kb: Math.round(t.after / 1024) });
  const first = items.find((it) => it.state === 'done');
  if (first && !selected) showCompare(first);
});

zipBtn.addEventListener('click', async () => {
  const done = items.filter((it) => it.state === 'done');
  if (done.length === 1) { download(done[0].out, done[0].outName); track('tool_download', { tool: SLUG, files: 1, mode: 'single' }); return; }
  const files = {};
  for (const it of done) files[it.outName] = [new Uint8Array(await it.out.arrayBuffer()), { level: 0 }];
  download(new Blob([zipSync(files)], { type: 'application/zip' }), `photos-small-${done.length}.zip`);
  track('tool_download', { tool: SLUG, files: done.length, mode: 'zip' });
});

clearBtn.addEventListener('click', () => {
  if (busy) return;
  for (const it of items) { URL.revokeObjectURL(it.url); if (it.resultUrl) URL.revokeObjectURL(it.resultUrl); }
  items = []; selected = null; cmp.hidden = true; render(); setStatus(status, '');
});

fileDrop($('.drop'), (files) => {
  const ok = [], skipped = [];
  for (const f of files) { const m = inputMime(f.type, f.name); (m ? ok : skipped).push([f, m]); }
  for (const [file, mime] of ok) items.push({ id: ++seq, file, mime, size: file.size, state: 'wait', url: URL.createObjectURL(file) });
  render();
  if (!ok.length) {
    const heic = skipped.some(([f]) => /\.(heic|heif)$/i.test(f.name));
    setStatus(status, heic ? 'HEIC 사진은 먼저 "HEIC → JPG 변환"으로 바꾼 뒤 넣어 주세요.' : 'JPG·PNG·WebP 사진만 넣을 수 있습니다.', 'warn');
    return;
  }
  setStatus(status, `${ok.length}장을 넣었습니다${skipped.length ? ` (지원하지 않는 파일 ${skipped.length}개는 뺐습니다)` : ''}. 줄이기를 누르세요.`, skipped.length ? 'warn' : '');
  track('tool_add', { tool: SLUG, files: ok.length, skipped: skipped.length });
});
