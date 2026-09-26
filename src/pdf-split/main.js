import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { loadPdf, prepareSource } from '../_shared/pdf-merge.js';
import { parseRanges, planOutputs, pageMembership, MAX_OUTPUTS, splitPdf } from '../_shared/pdf-split.js';
import { openPdf, closePdf, renderThumb, thumbQueue } from '../_shared/pdf-thumbs.js';

const COLORS = ['#2f6fed', '#d4380d', '#0f8a5f', '#7c3aed', '#b45309', '#0e7490', '#be185d', '#4d7c0f'];
const panel = $('#panel'), grid = $('#grid'), plan = $('#plan'), runBtn = $('#run');
const status = $('#status'), status0 = $('#status0'), resultBox = $('#resultBox'), resultsUl = $('#results');

let src = null;          // { name, size, prepared(pdf-lib 문서 준비본), pdfjs, pageCount }
let picked = new Set();  // 고른 쪽(1부터)
let outputs = [];
let made = [];           // 만든 결과 [{ name, bytes, url }]
let queue = thumbQueue(2);

const mode = () => document.querySelector('input[name=mode]:checked').value;

function clearResults() {
  for (const m of made) URL.revokeObjectURL(m.url);
  made = [];
  resultsUl.replaceChildren();
  resultBox.hidden = true;
}

/* ---------- 계획 ---------- */

function computePlan() {
  if (!src) return { outputs: [], errors: [] };
  const base = baseName(src.name);
  const m = mode();
  if (m === 'ranges') {
    const { ranges, errors } = parseRanges($('#ranges').value, src.pageCount);
    return { outputs: planOutputs(base, src.pageCount, 'ranges', ranges), errors };
  }
  if (m === 'every') return { outputs: planOutputs(base, src.pageCount, 'every', $('#every').value), errors: [] };
  return { outputs: planOutputs(base, src.pageCount, $('#pickOut').value, [...picked]), errors: [] };
}

function update() {
  const m = mode();
  $('#optRanges').hidden = m !== 'ranges';
  $('#optEvery').hidden = m !== 'every';
  $('#optPick').hidden = m !== 'pick';
  grid.classList.toggle('picking', m === 'pick');
  if (!src) return;
  const p = computePlan();
  outputs = p.outputs;
  const nodes = [];
  if (p.errors.length) nodes.push(h('p', { class: 'err' }, '확인해 주세요: ', p.errors.map((e) => `"${e.part}" — ${e.message}`).join(' · ')));
  if (!outputs.length) {
    nodes.push(h('p', { class: 'muted' }, m === 'ranges' ? '나눌 범위를 적어 주세요.' : m === 'pick' ? '뽑을 쪽을 골라 주세요.' : '1 이상의 숫자를 적어 주세요.'));
  } else if (outputs.length > MAX_OUTPUTS) {
    nodes.push(h('p', { class: 'err' }, `${outputs.length.toLocaleString()}개는 너무 많습니다. 한 번에 ${MAX_OUTPUTS}개까지 만들 수 있습니다.`));
  } else {
    nodes.push(h('p', {}, `${outputs.length}개 파일을 만듭니다${outputs.length > 1 ? ' (ZIP으로 묶어 저장)' : ''}.`));
    nodes.push(h('ol', {}, outputs.slice(0, 50).map((o) => h('li', {}, `${o.name} — ${o.pages.length}쪽`)), outputs.length > 50 ? h('li', { class: 'muted' }, `…외 ${outputs.length - 50}개`) : null));
  }
  plan.replaceChildren(...nodes);
  runBtn.disabled = !outputs.length || outputs.length > MAX_OUTPUTS;
  paintGrid();
}

/* ---------- 쪽 그림 ---------- */

function buildGrid() {
  grid.replaceChildren();
  queue = thumbQueue(2);
  for (let i = 0; i < src.pageCount; i++) {
    const box = h('div', { class: 'box' }, h('div', { class: 'ph' }, '…'));
    const card = h('button', { type: 'button', class: 'pg', 'data-page': i + 1, 'aria-pressed': 'false', 'aria-label': `${i + 1}쪽` },
      box, h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
      h('span', { class: 'cap' }, h('b', {}, `${i + 1}`), h('span', { class: 'grp' })));
    card.addEventListener('click', () => {
      if (mode() !== 'pick') return;
      const n = i + 1;
      if (picked.has(n)) picked.delete(n); else picked.add(n);
      update();
    });
    const doc = src.pdfjs;
    queue.observe(card, async () => {
      try { box.replaceChildren(await renderThumb(await doc, i, 100)); } catch { box.replaceChildren(h('div', { class: 'ph' }, '미리보기 없음')); }
    });
    grid.append(card);
  }
}

function paintGrid() {
  const m = mode();
  const member = pageMembership(outputs.length <= MAX_OUTPUTS ? outputs : [], src.pageCount);
  [...grid.children].forEach((card, i) => {
    const groups = member[i];
    const tag = card.querySelector('.grp');
    const inPick = m === 'pick';
    card.setAttribute('aria-pressed', inPick && picked.has(i + 1) ? 'true' : 'false');
    card.classList.toggle('out', !inPick && !groups.length);
    if (!inPick && groups.length) {
      tag.textContent = groups.length > 1 ? `${groups[0] + 1}+` : `${groups[0] + 1}번`;
      tag.style.background = COLORS[groups[0] % COLORS.length];
      tag.hidden = false;
    } else tag.hidden = true;
    card.setAttribute('aria-label', inPick ? `${i + 1}쪽${picked.has(i + 1) ? ', 고름' : ''}` : `${i + 1}쪽${groups.length ? `, ${groups.map((g) => g + 1).join('·')}번 파일` : ', 어느 파일에도 안 들어감'}`);
  });
}

/* ---------- 파일 넣기 ---------- */

fileDrop($('.drop'), async ([file]) => {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { setStatus(status0, 'PDF 파일을 넣어 주세요.', 'warn'); return; }
  panel.hidden = true; clearResults(); setStatus(status, '');
  if (src?.pdfjs) closePdf(src.pdfjs);
  src = null; picked = new Set();
  setStatus(status0, `${file.name} (${fmtBytes(file.size)}) 읽는 중…`);
  let doc;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    doc = await loadPdf(bytes);
  } catch (e) {
    track('tool_use', { tool: 'pdf-split', result: e.encrypted ? 'encrypted' : 'error' });
    return setStatus(status0, e.encrypted
      ? '암호가 걸린 PDF입니다. 이 도구는 암호화된 PDF를 풀 수 없어 나눌 수 없습니다. 원래 프로그램에서 보안을 해제해 저장한 뒤 넣어 주세요.'
      : 'PDF를 읽지 못했습니다. 손상되었거나 PDF가 아닌 파일일 수 있습니다.', 'bad');
  }
  const pageCount = doc.getPageCount();
  if (!pageCount) return setStatus(status0, '쪽이 없는 PDF입니다.', 'bad');
  src = { name: file.name, size: file.size, prepared: prepareSource(doc), pageCount, pdfjs: openPdf(bytes) };
  src.pdfjs.catch(() => {});
  setStatus(status0, '');
  $('#fileName').textContent = file.name;
  $('#fileMeta').textContent = `${pageCount}쪽 · ${fmtBytes(file.size)}`;
  if (!$('#ranges').value) $('#ranges').value = pageCount > 1 ? `1-${Math.ceil(pageCount / 2)}, ${Math.ceil(pageCount / 2) + 1}-` : '1';
  panel.hidden = false;
  buildGrid();
  update();
  track('tool_use', { tool: 'pdf-split', pages: pageCount, mb: Math.round(file.size / 1e6) });
});

for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', update);
$('#ranges').addEventListener('input', update);
$('#every').addEventListener('input', update);
$('#pickOut').addEventListener('change', update);
const pickWhere = (fn) => { picked = new Set(); for (let n = 1; n <= (src?.pageCount || 0); n++) if (fn(n)) picked.add(n); update(); };
$('#pickAll').addEventListener('click', () => pickWhere(() => true));
$('#pickNone').addEventListener('click', () => pickWhere(() => false));
$('#pickOdd').addEventListener('click', () => pickWhere((n) => n % 2 === 1));
$('#pickEven').addEventListener('click', () => pickWhere((n) => n % 2 === 0));

/* ---------- 나누기 ---------- */

function zipAll() {
  const entries = {};
  for (const m of made) entries[m.name] = [m.bytes, { level: 0 }];   // PDF 는 이미 압축돼 있어 다시 압축하지 않는다
  return zipSync(entries);
}

runBtn.addEventListener('click', async () => {
  if (!src || !outputs.length) return;
  runBtn.disabled = true;
  clearResults();
  try {
    const files = await splitPdf(src.prepared, outputs, (i, n) => setStatus(status, `${i + 1} / ${n} 만드는 중…`));
    made = files.map((f) => ({ ...f, url: URL.createObjectURL(new Blob([f.bytes], { type: 'application/pdf' })) }));
    const total = made.reduce((s, f) => s + f.bytes.length, 0);
    resultsUl.replaceChildren(...made.map((f) => h('li', {},
      h('span', { class: 'name' }, f.name), h('span', { class: 'muted' }, `${f.pages}쪽 · ${fmtBytes(f.bytes.length)}`),
      h('a', { href: f.url, download: f.name }, '받기'))));
    $('#zipBtn').hidden = made.length < 2;
    resultBox.hidden = false;
    if (made.length === 1) download(new Blob([made[0].bytes], { type: 'application/pdf' }), made[0].name);
    else download(new Blob([zipAll()], { type: 'application/zip' }), `${baseName(src.name)}_나눔.zip`);
    setStatus(status, `${made.length}개 파일(모두 ${fmtBytes(total)})을 저장했습니다.${made.length > 1 ? ' 아래에서 하나씩 받을 수도 있습니다.' : ''}`, 'ok');
    track('tool_download', { tool: 'pdf-split', mode: mode(), files: made.length, pages: src.pageCount });
  } catch (e) {
    console.error(e);
    setStatus(status, `나누지 못했습니다: ${e.message}`, 'bad');
  } finally {
    runBtn.disabled = !outputs.length || outputs.length > MAX_OUTPUTS;
  }
});

$('#zipBtn').addEventListener('click', () => {
  if (made.length) download(new Blob([zipAll()], { type: 'application/zip' }), `${baseName(src.name)}_나눔.zip`);
});

update();
