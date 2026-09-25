/* 본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다. */
import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, copyText, track } from '../_shared/ui.js';
import { extractText, joinText } from '../_shared/hwp-text.js';

const status = $('#status'), out = $('#out'), facts = $('#facts'), textEl = $('#text'), collapse = $('#collapse');
let result = null, name = 'document';

function show() {
  if (!result) return;
  const text = joinText(result.lines, { collapse: collapse.checked });
  textEl.value = text;
  const paras = result.lines.reduce((s, l) => s + l.filter((x) => x.trim()).length, 0);
  facts.replaceChildren(
    h('li', {}, result.format + (result.version ? ` ${result.version}` : '')),
    h('li', {}, `구역 ${result.sections}개`),
    h('li', {}, `글이 있는 문단 ${paras.toLocaleString()}개`),
    h('li', {}, `${[...text.replace(/\s/g, '')].length.toLocaleString()}자 (공백 제외)`),
  );
  return text;
}

fileDrop($('.drop'), async ([file]) => {
  out.hidden = true; result = null;
  setStatus(status, `${file.name} (${fmtBytes(file.size)}) 읽는 중…`);
  try {
    result = await extractText(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (!e.code) console.error(e);
    setStatus(status, e.code ? e.message : '문서를 읽는 중 문제가 생겼습니다. 파일이 손상되었을 수 있습니다.', 'bad');
    track('tool_use', { tool: 'hwp-text', result: e.code || 'error' });
    return;
  }
  name = baseName(file.name);
  const text = show();
  out.hidden = false;
  if (text) setStatus(status, '글자를 꺼냈습니다. 복사하거나 .txt로 저장하세요.', 'ok');
  else setStatus(status, '문서에서 글자를 찾지 못했습니다. 그림이나 도형만 있는 문서일 수 있습니다.', 'warn');
  track('tool_use', { tool: 'hwp-text', format: result.format, sections: result.sections });
});

collapse.addEventListener('change', show);
$('#copy').addEventListener('click', (e) => copyText(textEl.value, e.currentTarget));
$('#save').addEventListener('click', () => {
  // 윈도우 메모장에서도 줄이 바르게 보이도록 CRLF, 한글이 깨지지 않도록 UTF-8 BOM
  const body = '﻿' + textEl.value.replace(/\n/g, '\r\n');
  download(new Blob([body], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
  track('tool_download', { tool: 'hwp-text', format: result?.format });
});
