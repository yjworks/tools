import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { readJpegExif } from '../_shared/exif.js';
import {
  looksHeic, parseHeif, primaryOnly, outputMeta, exifSegment, iccSegments, insertJpegSegments,
  pngChunk, iccpData, insertPngChunks, outputName, summarize, canvasLimit, fitPixels, concat,
} from '../_shared/heic-to-jpg.js';

const SLUG = 'heic-to-jpg';
const list = $('#files'), status = $('#status'), go = $('#go'), zipBtn = $('#zip'), clearBtn = $('#clear');
const totalBar = $('#total'), sum = $('#sum'), quality = $('#quality');
const LIMIT = canvasLimit({ ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints || 0 });

let items = [], busy = false, seq = 0, heicLib = null;

const opts = () => ({
  fmt: document.querySelector('input[name=fmt]:checked').value,
  q: Number(quality.value),
  meta: $('#meta').value,
});

/* ───── 해독 ───── */

/** 브라우저가 스스로 푸는지(사파리 등). 못 풀면 오류 */
async function nativeDecode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 <img> 로 한 번 더 */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error('empty');
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

/** libheif(heic-to) — 필요할 때만 따로 불러온다 */
async function libheifDecode(bytes) {
  if (!heicLib) {
    setStatus(status, 'HEIC 해독기(libheif, 약 3MB)를 불러오는 중… 처음 한 번만 받습니다.');
    heicLib = import('heic-to');
  }
  const { heicTo } = await heicLib;
  return heicTo({ blob: new Blob([bytes]), type: 'bitmap' });
}

/* ───── 한 장 변환 ───── */

function stage(it, text, pct) {
  it.stage = text; it.pct = pct;
  paintItem(it);
}

async function convert(it, o) {
  stage(it, '읽는 중', 10);
  const bytes = new Uint8Array(await it.file.arrayBuffer());
  let info = null;
  try { info = parseHeif(bytes); } catch { /* 구조를 못 읽어도 해독은 시도한다 */ }
  it.images = info?.imageCount || 1;

  stage(it, '해독 중', 30);
  let src, decoder = 'native';
  try { src = await nativeDecode(it.file); }
  catch {
    decoder = 'libheif';
    let input = bytes;
    if (info && info.imageCount > 1) { try { input = primaryOnly(bytes, info).bytes; } catch { /* 그대로 */ } }
    try { src = await libheifDecode(input); }
    catch (e) { throw new Error(/not found|parse|Invalid/i.test(String(e)) ? 'HEIC 구조를 읽지 못했습니다(파일이 잘렸거나 다른 형식)' : '해독하지 못했습니다'); }
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('사진 크기를 읽지 못했습니다');

  stage(it, '저장 중', 75);
  const fit = fitPixels(w0, h0, LIMIT);
  const c = document.createElement('canvas');
  c.width = fit.width; c.height = fit.height;
  const ctx = c.getContext('2d');
  if (o.fmt === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  const type = o.fmt === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((res) => c.toBlob(res, type, o.q / 100));
  if (!blob) throw new Error('이 브라우저가 이 크기의 사진을 저장하지 못했습니다');

  // 미리보기(작게)
  const t = document.createElement('canvas'), s = 104 / Math.max(c.width, c.height);
  t.width = Math.max(1, Math.round(c.width * s)); t.height = Math.max(1, Math.round(c.height * s));
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  it.thumb = t.toDataURL('image/jpeg', 0.7);
  c.width = c.height = 1;

  // 메타데이터 붙이기
  const meta = outputMeta({ mode: o.meta, exif: info?.exif || null, icc: info?.icc || null, decoder });
  let out = new Uint8Array(await blob.arrayBuffer());
  if (type === 'image/jpeg') {
    const segs = [];
    if (meta.tiff) { const s1 = exifSegment(meta.tiff); if (s1) segs.push(s1); }
    if (meta.icc) segs.push(...iccSegments(meta.icc));
    if (segs.length) out = insertJpegSegments(out, segs);
  } else {
    const chunks = [], drop = [];
    if (meta.icc) { chunks.push(pngChunk('iCCP', iccpData(meta.icc))); drop.push('sRGB', 'gAMA', 'cHRM', 'iCCP'); }
    if (meta.tiff) { chunks.push(pngChunk('eXIf', meta.tiff)); drop.push('eXIf'); }
    if (chunks.length) out = insertPngChunks(out, chunks, drop);
  }

  it.out = new Blob([out], { type });
  it.outSize = out.length;
  it.dims = `${fit.width}×${fit.height}`;
  it.decoder = decoder;
  it.notes = [];
  if (fit.scaled) it.notes.push(`브라우저 한도로 ${w0}×${h0}에서 줄임`);
  if (it.images > 1) it.notes.push(`${it.images}장 중 대표 사진`);
  if (meta.exifNote) it.notes.push(meta.exifNote);
  if (info?.exif && o.meta !== 'none') {
    const had = readJpegExif(concat([Uint8Array.of(0xff, 0xd8), exifSegment(info.exif) || new Uint8Array(), Uint8Array.of(0xff, 0xd9)]).buffer);
    if (had?.gps) it.notes.push(o.meta === 'nogps' ? '위치 지움' : '위치 남김');
  }
  it.state = 'done';
  stage(it, '완료', 100);
}

/* ───── 화면 ───── */

function paintItem(it) {
  if (!it.li) return;
  const tag = it.state === 'done' ? h('span', { class: 'tag ok' }, fmtBytes(it.outSize))
    : it.state === 'error' ? h('span', { class: 'tag bad' }, '실패')
      : h('span', { class: 'tag' }, it.state === 'work' ? it.stage : '대기');
  const detail = [fmtBytes(it.size)];
  if (it.state === 'done') detail.push(it.dims, ...it.notes);
  if (it.state === 'error') detail.push(it.error);
  const dl = it.state === 'done'
    ? h('button', { class: 'small ghost', onclick: () => { download(it.out, it.outName); track('tool_download', { tool: SLUG, files: 1, mode: 'single' }); } }, '받기')
    : null;
  const thumb = h('span', { class: 'thumb' }, it.thumb ? h('img', { src: it.thumb, alt: '' }) : 'HEIC');
  const bar = h('div', { class: 'bar' + (it.state === 'done' ? ' done' : it.state === 'error' ? ' fail' : '') }, h('span', { style: `width:${it.state === 'error' ? 100 : it.pct || 0}%` }));
  it.li.replaceChildren(...[thumb, h('span', { class: 'name' }, it.file.name, h('br'), h('small', { class: 'muted' }, detail.join(' · '))), tag, dl, bar].filter(Boolean));
}

function render() {
  list.replaceChildren();
  for (const it of items) { it.li = h('li'); paintItem(it); list.append(it.li); }
  refresh();
}

function refresh() {
  const s = summarize(items);
  const pending = items.filter((it) => it.state === 'wait').length;
  go.disabled = busy || !pending;
  go.textContent = s.done && pending ? `남은 ${pending}장 변환하기` : '변환하기';
  zipBtn.hidden = s.done < 1;
  zipBtn.textContent = s.done > 1 ? `ZIP으로 모두 받기(${s.done}장)` : '받기';
  clearBtn.hidden = !items.length || busy;
  totalBar.hidden = !items.length;
  totalBar.firstElementChild.style.width = items.length ? `${((s.done + s.failed) / items.length) * 100}%` : '0';
  sum.hidden = !s.done;
  if (s.done) {
    const pct = Math.round((s.ratio - 1) * 100);
    sum.innerHTML = '';
    sum.append('원본 ', h('b', {}, fmtBytes(s.beforeDone)), ` (${s.done}장) → 결과 `, h('b', {}, fmtBytes(s.after)),
      h('span', { class: 'muted' }, ` · ${pct >= 0 ? `${pct}% 커짐` : `${-pct}% 작아짐`}`));
  }
}

function resetResults() {
  if (busy) return;
  let changed = false;
  for (const it of items) if (it.state !== 'wait') { it.state = 'wait'; it.out = null; it.outSize = 0; it.pct = 0; it.thumb = null; changed = true; }
  if (changed) { render(); setStatus(status, '설정을 바꿨습니다. 변환하기를 다시 누르세요.'); }
}

/* ───── 이벤트 ───── */

quality.addEventListener('input', () => { $('#qVal').textContent = quality.value; });
quality.addEventListener('change', resetResults);
$('#meta').addEventListener('change', resetResults);
for (const r of document.querySelectorAll('input[name=fmt]')) r.addEventListener('change', () => {
  $('#qField').hidden = opts().fmt !== 'jpg';
  resetResults();
});

go.addEventListener('click', async () => {
  if (busy) return;
  busy = true; refresh();
  const o = opts(), todo = items.filter((it) => it.state === 'wait');
  const taken = new Set(items.filter((it) => it.state === 'done').map((it) => it.outName.toLowerCase()));
  const ext = o.fmt === 'jpg' ? 'jpg' : 'png';
  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    it.state = 'work';
    it.outName = outputName(it.file.name, ext, taken);
    setStatus(status, `${i + 1} / ${todo.length}장 변환 중…`);
    try { await convert(it, o); ok++; }
    catch (e) {
      it.state = 'error'; it.error = e?.message || '변환하지 못했습니다'; fail++;
      paintItem(it);
    }
    refresh();
    await new Promise((r) => setTimeout(r, 0));   // 화면이 멈추지 않게 한 번 쉬어 간다
  }
  busy = false; refresh();
  setStatus(status, fail ? `${ok}장 변환, ${fail}장 실패. 실패한 사진의 이유를 확인하세요.` : `${ok}장을 변환했습니다.`, fail ? (ok ? 'warn' : 'bad') : 'ok');
  const s = summarize(items);
  track('tool_use', { tool: SLUG, files: todo.length, ok, fail, format: o.fmt, quality: o.q, meta: o.meta,
    decoder: todo.some((t) => t.decoder === 'libheif') ? 'libheif' : 'native', in_kb: Math.round(s.beforeDone / 1024), out_kb: Math.round(s.after / 1024) });
});

zipBtn.addEventListener('click', () => {
  const done = items.filter((it) => it.state === 'done');
  if (done.length === 1) { download(done[0].out, done[0].outName); track('tool_download', { tool: SLUG, files: 1, mode: 'single' }); return; }
  Promise.all(done.map(async (it) => [it.outName, new Uint8Array(await it.out.arrayBuffer())])).then((pairs) => {
    const files = {};
    for (const [n, b] of pairs) files[n] = [b, { level: 0 }];   // JPG·PNG 는 이미 압축돼 있어 저장만
    download(new Blob([zipSync(files)], { type: 'application/zip' }), `heic-${opts().fmt}-${done.length}.zip`);
    track('tool_download', { tool: SLUG, files: done.length, mode: 'zip' });
  });
});

clearBtn.addEventListener('click', () => {
  if (busy) return;
  items = []; render(); setStatus(status, '');
});

fileDrop($('.drop'), async (files) => {
  const accepted = [], skipped = [];
  for (const f of files) {
    const head = new Uint8Array(await f.slice(0, 64).arrayBuffer());
    (looksHeic(f.name, f.type, head) ? accepted : skipped).push(f);
  }
  for (const file of accepted) items.push({ id: ++seq, file, size: file.size, state: 'wait', pct: 0 });
  render();
  if (!accepted.length) setStatus(status, 'HEIC·HEIF 파일이 아닙니다. JPG·PNG 용량을 줄이려면 아래 "사진 용량 줄이기"를 이용하세요.', 'warn');
  else setStatus(status, `${accepted.length}장을 넣었습니다${skipped.length ? ` (HEIC가 아닌 파일 ${skipped.length}개는 뺐습니다)` : ''}. 변환하기를 누르세요.`, skipped.length ? 'warn' : '');
  if (accepted.length) track('tool_add', { tool: SLUG, files: accepted.length, skipped: skipped.length });
});
