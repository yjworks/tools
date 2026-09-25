import { $, setStatus, copyText, track } from '../_shared/ui.js';
import { engToKor, korToEng, hasHangul } from '../_shared/hangul.js';

const inp = $('#in'), out = $('#out'), status = $('#status'), auto = $('#auto');
let used = false;

function run(dir) {
  const text = inp.value;
  if (!text) { out.value = ''; setStatus(status, ''); return; }
  const d = dir || (hasHangul(text) ? 'en' : 'ko');
  out.value = d === 'ko' ? engToKor(text) : korToEng(text);
  setStatus(status, d === 'ko' ? '영타 → 한글로 바꿨습니다' : '한글 → 영타로 바꿨습니다', 'ok');
  if (!used) { used = true; track('tool_use', { tool: 'hangul-keyboard', dir: d }); }
}

inp.addEventListener('input', () => auto.checked && run());
$('#toKo').addEventListener('click', () => run('ko'));
$('#toEn').addEventListener('click', () => run('en'));
$('#copy').addEventListener('click', (e) => copyText(out.value, e.currentTarget));

const q = new URLSearchParams(location.search).get('q');
if (q) { inp.value = q; run(); }
