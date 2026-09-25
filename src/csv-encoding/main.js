import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { ENCODINGS, decode, encodeUtf8, parseCsv, guessSeparator, replacementCount } from '../_shared/csv.js';

const srcSel = $('#src'), dstSel = $('#dst'), status = $('#status'), list = $('#files'), preview = $('#preview');
for (const [v, label] of Object.entries(ENCODINGS)) srcSel.append(h('option', { value: v }, label));

let items = []; // {file, bytes, result}

function convert(item) {
  item.result = decode(item.bytes, srcSel.value);
  return item.result;
}

function render() {
  list.replaceChildren();
  preview.replaceChildren();
  for (const item of items) {
    const r = convert(item);
    const bad = replacementCount(r.text);
    const tag = bad ? h('span', { class: 'tag warn' }, `깨진 글자 ${bad}개`) : h('span', { class: 'tag ok' }, ENCODINGS[r.encoding].split(' ')[0] + (r.bom ? ' (BOM)' : ''));
    const btn = h('button', { class: 'small', onclick: () => save(item) }, '내려받기');
    list.append(h('li', {}, h('span', { class: 'name' }, item.file.name), h('span', { class: 'muted' }, fmtBytes(item.file.size)), tag, btn));
  }
  if (items.length > 1) list.append(h('li', {}, h('span', { class: 'name' }, `${items.length}개 파일`), h('button', { class: 'small', onclick: () => items.forEach(save) }, '모두 내려받기')));
  const first = items[0];
  if (first) {
    const sep = guessSeparator(first.result.text);
    const rows = parseCsv(first.result.text, 30, sep);
    const table = h('table', { class: 'preview' });
    rows.forEach((row, i) => table.append(h('tr', {}, row.map((c) => h(i === 0 ? 'th' : 'td', { title: c }, c)))));
    preview.append(h('p', { class: 'muted' }, `미리보기: ${first.file.name} (앞 30줄)`), table);
    const bad = items.reduce((s, it) => s + replacementCount(it.result.text), 0);
    if (bad) setStatus(status, '깨진 글자(�)가 남아 있습니다. 원래 인코딩을 직접 바꿔 보세요.', 'warn');
    else setStatus(status, '한글이 제대로 보이면 내려받기를 누르세요.', 'ok');
  }
}

function save(item) {
  const bytes = encodeUtf8(item.result.text, dstSel.value === 'bom');
  const ext = (item.file.name.match(/\.[^.]+$/) || ['.csv'])[0];
  download(new Blob([bytes], { type: 'text/csv;charset=utf-8' }), `${baseName(item.file.name)}-utf8${ext}`);
  track('tool_download', { tool: 'csv-encoding', from: item.result.encoding });
}

fileDrop($('.drop'), async (files) => {
  items = await Promise.all(files.map(async (file) => ({ file, bytes: new Uint8Array(await file.arrayBuffer()) })));
  render();
  track('tool_use', { tool: 'csv-encoding', files: items.length });
});
srcSel.addEventListener('change', () => items.length && render());
