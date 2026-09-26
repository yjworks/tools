import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { readJpegExif } from '../_shared/exif.js';
import { loadPdf } from '../_shared/pdf-merge.js';
import {
  PRESETS, decide, fitEdge, rasterSize, shouldReplaceImage,
  finishCleanup, listJpegImages, replaceJpeg, buildImagePdf,
} from '../_shared/pdf-compress.js';
import { loadPdfjs, openPdf, closePdf } from '../_shared/pdf-thumbs.js';

const panel = $('#panel'), status = $('#status'), status0 = $('#status0'), runBtn = $('#run'), saveBtn = $('#save');
let src = null;      // { name, size, bytes, pageCount, images: { total, eligible, bytes } }
let out = null;      // { bytes, name }

const method = () => document.querySelector('input[name=method]:checked').value;
const tick = () => new Promise((r) => setTimeout(r, 0));

function updateOptions() {
  const m = method();
  $('#rasterWarn').hidden = m !== 'raster';
  $('#levelWrap').hidden = m === 'lossless';
  $('#cleanOpts').hidden = m === 'raster';   // 그림으로 바꾸면 새 문서라 해당 없음
  const lv = $('#level').value;
  $('#levelDesc').textContent = m === 'images'
    ? `사진 긴 변 최대 ${PRESETS.images[lv].maxEdge.toLocaleString()}픽셀, JPEG 품질 ${Math.round(PRESETS.images[lv].quality * 100)}%`
    : m === 'raster' ? `${PRESETS.raster[lv].dpi}dpi, JPEG 품질 ${Math.round(PRESETS.raster[lv].quality * 100)}%` : '';
  resetResult();
}

function resetResult() {
  out = null;
  saveBtn.hidden = true;
  $('#sizes').hidden = true;
  setStatus(status, '');
}

fileDrop($('.drop'), async ([file]) => {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { setStatus(status0, 'PDF 파일을 넣어 주세요.', 'warn'); return; }
  panel.hidden = true; src = null; resetResult();
  setStatus(status0, `${file.name} (${fmtBytes(file.size)}) 살펴보는 중…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc;
  try { doc = await loadPdf(bytes); } catch (e) {
    track('tool_use', { tool: 'pdf-compress', result: e.encrypted ? 'encrypted' : 'error' });
    return setStatus(status0, e.encrypted
      ? '암호가 걸린 PDF입니다. 암호화된 PDF는 이 도구에서 줄일 수 없습니다. 원래 프로그램에서 보안을 해제해 저장한 뒤 넣어 주세요.'
      : 'PDF를 읽지 못했습니다. 손상되었거나 PDF가 아닌 파일일 수 있습니다.', 'bad');
  }
  const imgs = listJpegImages(doc);
  const ok = imgs.filter((x) => !x.reason);
  src = {
    name: file.name, size: file.size, bytes, pageCount: doc.getPageCount(),
    images: { total: imgs.length, eligible: ok.length, bytes: ok.reduce((s, x) => s + x.bytes.length, 0) },
  };
  setStatus(status0, '');
  $('#fileName').textContent = file.name;
  $('#fileMeta').textContent = `${src.pageCount}쪽 · ${fmtBytes(file.size)}`;
  const im = src.images;
  $('#imgInfo').textContent = im.total
    ? `JPEG 사진 ${im.total}개 중 다시 압축할 수 있는 것 ${im.eligible}개(${fmtBytes(im.bytes)}, 파일의 ${Math.round((im.bytes / file.size) * 100)}%)`
    : '문서 안에 JPEG 사진이 없습니다.';
  const mImages = $('#mImages');
  mImages.disabled = !im.eligible;
  if (mImages.disabled && mImages.checked) document.querySelector('input[name=method][value=lossless]').checked = true;
  $('#imagesDesc').textContent = im.eligible
    ? '문서에 들어 있는 JPEG 사진만 해상도와 품질을 낮춥니다. 글자·표·도형은 그대로라 선택·검색도 됩니다.'
    : '이 문서에는 다시 압축할 수 있는 JPEG 사진이 없어 고를 수 없습니다.';
  panel.hidden = false;
  updateOptions();
  track('tool_use', { tool: 'pdf-compress', pages: src.pageCount, mb: Math.round(file.size / 1e6), jpegs: im.eligible });
});

/* ---------- 방법 2: 사진만 다시 압축 ---------- */

async function recompressImages(opts) {
  const { maxEdge, quality } = PRESETS.images[$('#level').value];
  const doc = await loadPdf(src.bytes);
  const list = listJpegImages(doc).filter((x) => !x.reason);
  let replaced = 0, skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    setStatus(status, `사진 ${i + 1} / ${list.length} 다시 압축하는 중…`);
    await tick();
    try {
      const ex = readJpegExif(it.bytes.buffer.slice(it.bytes.byteOffset, it.bytes.byteOffset + it.bytes.byteLength));
      if (ex?.orientation && ex.orientation !== 1) { skipped++; continue; }   // PDF 는 EXIF 회전을 무시하므로 브라우저 해독과 어긋날 수 있다
      const bmp = await createImageBitmap(new Blob([it.bytes], { type: 'image/jpeg' }));
      if (bmp.width !== it.width || bmp.height !== it.height) { bmp.close?.(); skipped++; continue; }
      const t = fitEdge(bmp.width, bmp.height, maxEdge);
      const c = document.createElement('canvas');
      c.width = t.width; c.height = t.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.width, t.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, t.width, t.height);
      bmp.close?.();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      c.width = c.height = 0;
      if (!blob) { skipped++; continue; }
      const nb = new Uint8Array(await blob.arrayBuffer());
      if (shouldReplaceImage(it.bytes.length, nb.length)) { replaceJpeg(doc, it.ref, nb, t.width, t.height, it.kind); replaced++; } else skipped++;
    } catch { skipped++; }
  }
  setStatus(status, '정리해서 저장하는 중…');
  await tick();
  const r = await finishCleanup(doc, opts);
  return { bytes: r.bytes, notes: [`사진 ${replaced}개를 다시 압축했습니다${skipped ? `(${skipped}개는 줄지 않거나 다룰 수 없어 그대로 둠)` : ''}.`, ...cleanupNotes(r)] };
}

/* ---------- 방법 3: 모든 쪽을 그림으로 ---------- */

async function rasterize() {
  const { dpi, quality } = PRESETS.raster[$('#level').value];
  const lib = await loadPdfjs();
  const pdf = await openPdf(src.bytes);
  const pages = [];
  let minDpi = dpi;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus(status, `${i} / ${pdf.numPages}쪽 그리는 중…`);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const size = rasterSize(base.width, base.height, dpi);
      minDpi = Math.min(minDpi, size.dpi);
      const viewport = page.getViewport({ scale: size.scale });
      const c = document.createElement('canvas');
      c.width = size.width; c.height = size.height;
      await page.render({ canvas: c, viewport, background: '#ffffff', intent: 'print', annotationMode: lib.AnnotationMode.ENABLE }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      c.width = c.height = 0;
      page.cleanup();
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), widthPt: base.width, heightPt: base.height });
    }
  } finally { closePdf(pdf); }
  setStatus(status, '새 PDF로 묶는 중…');
  await tick();
  const bytes = await buildImagePdf(pages);
  const notes = [`${pages.length}쪽을 ${dpi}dpi 그림으로 바꿨습니다. 글자는 선택·검색되지 않습니다.`];
  if (minDpi < dpi) notes.push(`아주 큰 쪽은 기기 메모리 한도 때문에 ${minDpi}dpi로 그렸습니다.`);
  return { bytes, notes };
}

function cleanupNotes(r) {
  const n = [];
  if (r.removed) n.push(`쓰이지 않는 객체 ${r.removed.toLocaleString()}개를 지웠습니다.`);
  if (r.deduped) n.push(`똑같은 데이터 ${r.deduped}개를 하나로 합쳤습니다.`);
  if (r.deflated) n.push(`압축 안 된 데이터 ${r.deflated}개를 압축했습니다.`);
  if (r.stripped) n.push(`부가 데이터 ${r.stripped}개를 지웠습니다.`);
  if (r.signed) n.push('전자서명이 있던 문서입니다. 줄인 파일에서는 서명 효력이 없습니다.');
  return n;
}

runBtn.addEventListener('click', async () => {
  if (!src) return;
  const m = method();
  runBtn.disabled = true;
  resetResult();
  setStatus(status, '준비하는 중…');
  await tick();
  const opts = { extras: $('#optExtras').checked, info: $('#optInfo').checked };
  const t0 = performance.now();
  try {
    let r;
    if (m === 'lossless') {
      const doc = await loadPdf(src.bytes);
      const c = await finishCleanup(doc, opts);
      r = { bytes: c.bytes, notes: cleanupNotes(c) };
    } else if (m === 'images') r = await recompressImages(opts);
    else r = await rasterize();
    showResult(r, m, performance.now() - t0);
  } catch (e) {
    console.error(e);
    setStatus(status, `줄이지 못했습니다: ${e.message}`, 'bad');
  } finally { runBtn.disabled = false; }
});

function showResult(r, m, ms) {
  const d = decide(src.size, r.bytes.length);
  const max = Math.max(src.size, r.bytes.length);
  $('#barBefore').style.width = `${(src.size / max) * 100}%`;
  $('#barAfter').style.width = `${(r.bytes.length / max) * 100}%`;
  $('#txtBefore').textContent = `원본 ${fmtBytes(src.size)}`;
  $('#txtAfter').textContent = `결과 ${fmtBytes(r.bytes.length)}${d.useResult ? ` (−${d.percent}%)` : ''}`;
  $('#barAfterWrap').classList.toggle('worse', !d.useResult);
  $('#detail').replaceChildren(...r.notes.map((n) => h('li', {}, n)));
  $('#sizes').hidden = false;
  if (d.useResult) {
    out = { bytes: r.bytes, name: `${baseName(src.name)}_줄임.pdf` };
    saveBtn.hidden = false;
    setStatus(status, `${fmtBytes(d.saved)} 줄었습니다. 저장을 누르면 새 파일로 받습니다.`, 'ok');
  } else {
    setStatus(status, d.grew
      ? '결과가 원본보다 커서 원본을 그대로 두었습니다. 다른 방법이나 더 낮은 품질을 골라 보세요.'
      : '원본보다 거의 작아지지 않아 원본을 그대로 두었습니다. 다른 방법을 골라 보세요.', 'warn');
  }
  track('tool_result', { tool: 'pdf-compress', method: m, level: m === 'lossless' ? '' : $('#level').value, percent: Math.round(d.percent), smaller: d.useResult, sec: Math.round(ms / 1000) });
}

saveBtn.addEventListener('click', () => {
  if (!out) return;
  download(new Blob([out.bytes], { type: 'application/pdf' }), out.name);
  track('tool_download', { tool: 'pdf-compress', method: method() });
});

for (const r of document.querySelectorAll('input[name=method]')) r.addEventListener('change', updateOptions);
$('#level').addEventListener('change', updateOptions);
$('#optExtras').addEventListener('change', resetResult);
$('#optInfo').addEventListener('change', resetResult);
