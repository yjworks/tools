import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { loadExcel, mergeFiles, inputKind } from '../_shared/excel-merge.js';

const list = $('#files'), status = $('#status'), runBtn = $('#run'), clearBtn = $('#clear'), made = $('#made');
const stackOpts = $('#stackOpts');
let items = []; // { file, bytes }

const mode = () => document.querySelector('input[name=mode]:checked').value;

function render() {
  list.replaceChildren();
  items.forEach((it, i) => {
    const kind = inputKind(it.file.name, it.bytes);
    const tag = kind === 'xls' ? h('span', { class: 'tag warn' }, '.xls 불가')
      : kind == null ? h('span', { class: 'tag warn' }, '형식 모름')
      : h('span', { class: 'tag' }, kind === 'csv' ? 'CSV' : 'XLSX');
    list.append(h('li', {},
      h('span', { class: 'ord' }, `${i + 1}`),
      h('span', { class: 'name', title: it.file.name }, it.file.name),
      h('span', { class: 'muted' }, fmtBytes(it.file.size)), tag,
      h('button', { class: 'small ghost', 'aria-label': '위로', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'small ghost', 'aria-label': '빼기', onclick: () => { items.splice(i, 1); render(); } }, '✕'),
    ));
  });
  runBtn.disabled = !items.length;
  clearBtn.disabled = !items.length;
  if (!items.length) setStatus(status, '');
  else setStatus(status, `${items.length}개 파일. 순서와 방식을 확인하고 합쳐서 내려받기를 누르세요.`);
}
function move(i, d) { const [x] = items.splice(i, 1); items.splice(i + d, 0, x); render(); }

fileDrop($('.drop'), async (files) => {
  const added = await Promise.all(files.map(async (file) => ({ file, bytes: new Uint8Array(await file.arrayBuffer()) })));
  items.push(...added);
  made.replaceChildren();
  render();
  if (items.some((it) => inputKind(it.file.name, it.bytes) === 'xlsx')) loadExcel().catch(() => {}); // 미리 불러 두기
});

for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => { stackOpts.hidden = mode() !== 'stack'; });
clearBtn.addEventListener('click', () => { items = []; made.replaceChildren(); render(); });

const REASON = { xls: '.xls 형식이라 건너뜀(.xlsx로 저장해 다시 넣어 주세요)', empty: '빈 파일이라 건너뜀', kind: '엑셀·CSV가 아니라 건너뜀', broken: '읽지 못해 건너뜀(손상되었거나 암호가 걸린 파일)' };

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  made.replaceChildren();
  setStatus(status, '합치는 중입니다…');
  try {
    const m = mode();
    const r = await mergeFiles(items.map((it) => ({ name: it.file.name, bytes: it.bytes })), {
      mode: m,
      allSheets: $('#allSheets').checked,
      hasHeader: $('#hasHeader').checked,
      addSource: $('#addSource').checked,
    });
    for (const s of r.skipped) made.append(h('li', {}, `${s.name}: ${REASON[s.reason] || '건너뜀'}`));
    if (!r.bytes) { setStatus(status, '합칠 수 있는 파일이 없습니다.', 'bad'); return; }
    const name = ($('#outName').value.trim() || '합친파일').replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '');
    download(new Blob([r.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
    if (m === 'sheets') {
      for (const s of r.sheets) made.prepend(h('li', {}, `시트 「${s.name}」 ${s.rows.toLocaleString()}줄`));
      setStatus(status, `시트 ${r.sheets.length}개로 합쳤습니다${r.skipped.length ? ` (${r.skipped.length}개 건너뜀)` : ''}.`, r.skipped.length ? 'warn' : 'ok');
    } else {
      setStatus(status, `한 시트에 ${r.sheets[0].rows.toLocaleString()}줄로 합쳤습니다${r.skipped.length ? ` (${r.skipped.length}개 건너뜀)` : ''}.`, r.skipped.length ? 'warn' : 'ok');
    }
    track('tool_use', { tool: 'excel-merge', mode: m, files: items.length, sheets: r.sheets.length });
  } catch (e) {
    console.error(e);
    setStatus(status, '합치는 중 문제가 생겼습니다. 파일이 너무 크거나 손상되었을 수 있습니다.', 'bad');
  } finally {
    runBtn.disabled = !items.length;
  }
});
