import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { isJpeg, isPng, readJpegExif, redraw } from '../_shared/exif.js';
import { loadPdf, prepareSource, assemblePdf, pagesFromFiles, regroupByFiles, moveBlock, shiftKeys, rotatePage, normRotation, summarize, safeFileName } from '../_shared/pdf-merge.js';
import { hasSignature } from '../_shared/pdf-compress.js';
import { openPdf, closePdf, renderThumb, thumbQueue } from '../_shared/pdf-thumbs.js';
import { sortable } from './sortable.js';

const COLORS = ['#2f6fed', '#d4380d', '#0f8a5f', '#7c3aed', '#b45309', '#0e7490', '#be185d', '#4d7c0f'];
const status = $('#status'), filesUl = $('#files'), grid = $('#grid'), panel = $('#pagesPanel');
const actbar = $('#actbar'), makeBtn = $('#make'), result = $('#result');

let files = [];        // { key, id, name, size, kind, color, pageCount, state, prepared, pdfjs, img, flags }
let pages = [];        // { key, file, page, rotate }
let sel = new Set();   // 고른 쪽 key
let seq = 0;
const cards = new Map();   // 쪽 key → 요소(미리보기를 다시 그리지 않게 보관)
const queue = thumbQueue(2);
const fileOf = (id) => files.find((f) => f.id === id);
const okFiles = () => files.filter((f) => f.state === 'ok');

/* ---------- 파일 넣기 ---------- */

async function readImage(file) {
  const buf = await file.arrayBuffer();
  if (isJpeg(buf)) {
    const ex = readJpegExif(buf);
    if (!ex || !ex.orientation || ex.orientation === 1) return { bytes: new Uint8Array(buf), type: 'jpg' };
  } else if (isPng(buf)) return { bytes: new Uint8Array(buf), type: 'png' };
  const blob = await redraw(file, 'image/jpeg', 0.92);   // WEBP, 회전 정보가 있는 JPG
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' };
}

function looksPdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

async function addFiles(list) {
  const accepted = list.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  if (!accepted.length) { setStatus(status, 'PDF나 JPG·PNG·WEBP 사진만 넣을 수 있습니다.', 'warn'); return; }
  result.hidden = true;
  let pdfs = 0, images = 0, locked = 0, broken = 0;
  for (const file of accepted) {
    const id = `f${++seq}`;
    const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    const entry = { key: id, id, name: file.name, size: file.size, kind: isPdf ? 'pdf' : 'image', color: COLORS[(seq - 1) % COLORS.length], pageCount: 0, state: 'loading', flags: {} };
    files.push(entry);
    renderFiles();
    setStatus(status, `${file.name} 읽는 중…`);
    try {
      if (isPdf) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksPdf(bytes)) throw new Error('not pdf');
        const doc = await loadPdf(bytes);
        entry.prepared = prepareSource(doc);
        entry.pageCount = entry.prepared.pageCount;
        entry.flags.signed = hasSignature(doc);
        try { entry.flags.form = doc.getForm().getFields().length > 0; } catch { entry.flags.form = false; }
        entry.flags.outline = entry.prepared.outline.length > 0;
        entry.pdfjs = openPdf(bytes);
        entry.pdfjs.catch(() => {});
        pdfs++;
      } else {
        entry.img = await readImage(file);
        entry.img.url = URL.createObjectURL(new Blob([entry.img.bytes], { type: entry.img.type === 'png' ? 'image/png' : 'image/jpeg' }));
        entry.pageCount = 1;
        images++;
      }
      entry.state = entry.pageCount ? 'ok' : 'empty';
      pages.push(...pagesFromFiles([entry]));
    } catch (e) {
      if (e.encrypted) { entry.state = 'encrypted'; locked++; } else { entry.state = 'error'; broken++; console.warn(e); }
    }
    renderFiles();
    renderPages();
  }
  const msgs = [];
  if (locked) msgs.push(`암호가 걸린 PDF ${locked}개는 합칠 수 없습니다. 원래 프로그램에서 암호를 해제한 뒤 넣어 주세요.`);
  if (broken) msgs.push(`${broken}개는 읽지 못했습니다(손상되었거나 PDF·사진이 아닌 파일).`);
  setStatus(status, msgs.length ? msgs.join(' ') : `${okFiles().length}개 파일, 모두 ${pages.length}쪽입니다.`, msgs.length ? 'warn' : '');
  track('tool_use', { tool: 'pdf-merge', pdfs, images, locked, broken });
}

/* ---------- 파일 목록 ---------- */

function stateTag(f) {
  if (f.state === 'loading') return h('span', { class: 'tag' }, '읽는 중');
  if (f.state === 'encrypted') return h('span', { class: 'tag warn', title: '암호화된 PDF는 합칠 수 없습니다' }, '암호화됨');
  if (f.state === 'error') return h('span', { class: 'tag warn' }, '읽기 실패');
  if (f.state === 'empty') return h('span', { class: 'tag warn' }, '쪽 없음');
  return h('span', { class: 'tag' }, f.kind === 'image' ? '사진' : `${f.pageCount}쪽`);
}

function renderFiles() {
  filesUl.replaceChildren(...files.map((f, i) => h('li', { 'data-id': f.id },
    h('span', { class: 'grip', title: '끌어서 파일 순서 바꾸기', 'aria-hidden': 'true' }, '⠿'),
    h('span', { class: 'swatch', style: `background:${f.color}` }),
    h('span', { class: 'name' }, f.name, ' ', h('small', { class: 'muted' }, fmtBytes(f.size))),
    stateTag(f),
    h('span', { class: 'btns' },
      h('button', { class: 'small ghost', 'aria-label': `${f.name} 앞으로`, disabled: i === 0, onclick: () => moveFile(i, -1) }, '▲'),
      h('button', { class: 'small ghost', 'aria-label': `${f.name} 뒤로`, disabled: i === files.length - 1, onclick: () => moveFile(i, 1) }, '▼'),
      h('button', { class: 'small ghost', 'aria-label': `${f.name} 빼기`, onclick: () => removeFile(f.id) }, '✕')),
  )));
}

function moveFile(i, d) {
  files = shiftKeys(files, [files[i].key], d);
  pages = regroupByFiles(pages, files.map((f) => f.id));
  renderFiles(); renderPages();
}

function removeFile(id) {
  const f = fileOf(id);
  if (!f) return;
  closePdf(f.pdfjs);
  if (f.img?.url) URL.revokeObjectURL(f.img.url);
  files = files.filter((x) => x.id !== id);
  pages = pages.filter((p) => p.file !== id);
  for (const k of [...sel]) if (k.startsWith(`${id}:`)) sel.delete(k);
  renderFiles(); renderPages();
  setStatus(status, files.length ? `${okFiles().length}개 파일, 모두 ${pages.length}쪽입니다.` : '');
}

/* ---------- 쪽 목록 ---------- */

function makeCard(p) {
  const f = fileOf(p.file);
  const box = h('div', { class: 'box' }, h('div', { class: 'ph' }, '…'));
  const card = h('div', { class: 'pg', tabindex: '0', role: 'button', 'aria-pressed': 'false', 'data-key': p.key },
    box,
    h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
    h('span', { class: 'grip', title: '끌어서 옮기기', 'aria-hidden': 'true' }, '⠿'),
    h('span', { class: 'rot', hidden: true }),
    h('div', { class: 'cap' }, h('b', { class: 'no' }), h('span', { class: 'dot', style: `background:${f.color}` }), h('span', { class: 'src' })));
  card.addEventListener('click', () => toggle(p.key));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.key); } });
  if (f.kind === 'image') {
    box.replaceChildren(h('img', { src: f.img.url, alt: '' }));
  } else {
    queue.observe(card, async () => {
      try {
        const doc = await f.pdfjs;
        const c = await renderThumb(doc, p.page, 110);
        box.replaceChildren(c);
        applyRotation(card);
      } catch {
        box.replaceChildren(h('div', { class: 'ph' }, '미리보기 없음'));
      }
    });
  }
  return card;
}

function applyRotation(card) {
  const p = pages.find((x) => x.key === card.dataset.key);
  if (!p) return;
  const r = normRotation(p.rotate);
  const el = card.querySelector('.box > *');
  if (el) el.style.transform = r ? `rotate(${r}deg)` : '';
  const tag = card.querySelector('.rot');
  tag.hidden = !r;
  tag.textContent = r ? `${r}°` : '';
}

function renderPages() {
  panel.hidden = !files.length;
  const keys = new Set(pages.map((p) => p.key));
  for (const [k, el] of cards) if (!keys.has(k)) { queue.forget(el); el.remove(); cards.delete(k); }
  pages.forEach((p, i) => {
    let card = cards.get(p.key);
    if (!card) { card = makeCard(p); cards.set(p.key, card); }
    const f = fileOf(p.file);
    card.querySelector('.no').textContent = i + 1;
    card.querySelector('.src').textContent = f.kind === 'image' ? '사진' : `${p.page + 1}쪽`;   // 파일은 점 색으로 구분(파일 목록의 색 막대와 같음)
    card.title = `${f.name} ${f.kind === 'image' ? '' : `${p.page + 1}쪽`}`.trim();
    card.setAttribute('aria-label', `${i + 1}번째 쪽: ${f.name} ${p.page + 1}쪽${p.rotate ? `, ${normRotation(p.rotate)}도 돌림` : ''}`);
    card.setAttribute('aria-pressed', sel.has(p.key) ? 'true' : 'false');
    applyRotation(card);
    if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
  });
  const s = summarize(pages);
  $('#pageCount').textContent = pages.length ? `· ${s.pages}쪽${s.rotated ? `, ${s.rotated}쪽 돌림` : ''}` : '';
  $('#imgFitWrap').hidden = !files.some((f) => f.kind === 'image' && f.state === 'ok');
  makeBtn.disabled = !pages.length;
  renderSel();
}

function renderSel() {
  for (const k of [...sel]) if (!pages.some((p) => p.key === k)) sel.delete(k);
  actbar.hidden = !sel.size;
  $('#selCount').textContent = `${sel.size}쪽 고름`;
  for (const [k, el] of cards) el.setAttribute('aria-pressed', sel.has(k) ? 'true' : 'false');
}

function toggle(key) { if (sel.has(key)) sel.delete(key); else sel.add(key); renderSel(); }

$('#actPrev').addEventListener('click', () => { pages = shiftKeys(pages, sel, -1); renderPages(); });
$('#actNext').addEventListener('click', () => { pages = shiftKeys(pages, sel, 1); renderPages(); });
$('#actLeft').addEventListener('click', () => { pages = pages.map((p) => (sel.has(p.key) ? rotatePage(p, -90) : p)); renderPages(); });
$('#actRight').addEventListener('click', () => { pages = pages.map((p) => (sel.has(p.key) ? rotatePage(p, 90) : p)); renderPages(); });
$('#actDel').addEventListener('click', () => { const n = sel.size; pages = pages.filter((p) => !sel.has(p.key)); sel.clear(); renderPages(); setStatus(status, `${n}쪽을 뺐습니다. 되살리려면 "쪽 되돌리기"를 누르세요.`); });
$('#actNone').addEventListener('click', () => { sel.clear(); renderSel(); });
$('#selAll').addEventListener('click', () => { sel = new Set(pages.map((p) => p.key)); renderSel(); });
$('#reset').addEventListener('click', () => { pages = pagesFromFiles(okFiles()); sel.clear(); renderPages(); setStatus(status, '쪽 목록을 처음 상태(파일 순서대로, 돌리지 않음)로 되돌렸습니다.'); });
$('#clear').addEventListener('click', () => {
  for (const f of files) { closePdf(f.pdfjs); if (f.img?.url) URL.revokeObjectURL(f.img.url); }
  files = []; pages = []; sel.clear();
  renderFiles(); renderPages();
  result.hidden = true;
  setStatus(status, '');
});

sortable(grid, {
  item: '.pg', handle: '.grip', axis: 'x',
  onDrop(from, target) {
    const key = pages[from]?.key;
    if (!key) return;
    pages = moveBlock(pages, sel.has(key) ? sel : new Set([key]), target);
    renderPages();
  },
});
sortable(filesUl, {
  item: 'li', handle: '.grip', axis: 'y',
  onDrop(from, target) {
    files = moveBlock(files, [files[from].key], target);
    pages = regroupByFiles(pages, files.map((f) => f.id));
    renderFiles(); renderPages();
  },
});

/* ---------- 합치기 ---------- */

makeBtn.addEventListener('click', async () => {
  if (!pages.length) return;
  makeBtn.disabled = true;
  result.hidden = true;
  setStatus(status, `${pages.length}쪽 합치는 중…`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const sources = new Map(), titles = new Map();
    for (const f of okFiles()) {
      titles.set(f.id, baseName(f.name));
      if (f.kind === 'pdf') sources.set(f.id, { kind: 'pdf', prepared: f.prepared });
      else sources.set(f.id, { kind: 'image', bytes: f.img.bytes, type: f.img.type, fit: $('#imgFit').value });
    }
    const r = await assemblePdf(sources, pages, { keepOutline: $('#keepOutline').checked, fileBookmarks: $('#fileBookmarks').checked, titles });
    const name = safeFileName($('#fname').value);
    download(new Blob([r.bytes], { type: 'application/pdf' }), `${name}.pdf`);
    const used = new Set(pages.map((p) => p.file));
    const usedFiles = okFiles().filter((f) => used.has(f.id));
    const notes = [];
    if (r.outlineCount) notes.push(`책갈피 ${r.outlineCount}개를 넣었습니다.`);
    else if ($('#keepOutline').checked && usedFiles.some((f) => f.flags.outline)) notes.push('남은 쪽을 가리키는 책갈피가 없어 책갈피를 넣지 않았습니다.');
    if (r.linksKept) notes.push(`문서 안 링크 ${r.linksKept}개를 새 쪽 번호로 다시 연결했습니다.`);
    if (r.linksDropped) notes.push(`뺀 쪽을 가리키던 링크 ${r.linksDropped}개는 지웠습니다.`);
    if (usedFiles.some((f) => f.flags.form)) notes.push('입력 칸이 있는 PDF가 섞여 있습니다. 칸 모양은 남지만 합친 파일에서는 입력이 안 될 수 있습니다.');
    if (usedFiles.some((f) => f.flags.signed)) notes.push('전자서명이 있던 PDF가 섞여 있습니다. 합친 파일에서는 서명 효력이 없습니다.');
    setStatus(status, `${r.pageCount}쪽, ${fmtBytes(r.bytes.length)} PDF를 저장했습니다.`, 'ok');
    result.replaceChildren(...(notes.length ? [h('ul', {}, notes.map((n) => h('li', {}, n)))] : []));
    result.hidden = !notes.length;
    track('tool_download', { tool: 'pdf-merge', files: used.size, pages: r.pageCount, mb: Math.round(r.bytes.length / 1e6) });
  } catch (e) {
    console.error(e);
    setStatus(status, `합치지 못했습니다: ${e.message}`, 'bad');
  } finally {
    makeBtn.disabled = !pages.length;
  }
});

fileDrop($('.drop'), (list) => { addFiles(list); });
