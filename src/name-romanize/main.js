import { $, h, setStatus, copyText, track } from '../_shared/ui.js';
import { romanizeName, cleanName } from '../_shared/name-romanize.js';

const input = $('#name'), two = $('#two'), results = $('#results'), status = $('#status');
let used = false;

function line(label, text, note) {
  const btn = h('button', { class: 'small ghost', onclick: (e) => copyText(text, e.currentTarget) }, '복사');
  return h('div', { class: 'nr-line' },
    h('div', {}, h('div', { class: 'muted' }, label), h('div', { class: 'out' }, text), note ? h('div', { class: 'muted' }, note) : null),
    btn);
}

function run() {
  results.replaceChildren();
  const raw = input.value;
  if (!raw.trim()) { setStatus(status, ''); return; }
  if (cleanName(raw) === null) { setStatus(status, '한글 음절로만 입력해 주세요. (자음·모음만 있는 글자, 영문·숫자는 안 됩니다)', 'warn'); return; }
  const r = romanizeName(raw, { surnameLength: two.checked ? 2 : 1 });
  if (!r) { setStatus(status, two.checked ? '두 글자 성 뒤에 이름까지 입력해 주세요.' : '성과 이름을 함께 입력해 주세요. (예: 홍빛나)', 'warn'); return; }

  const msgs = [`성: ${r.familyKo} · 이름: ${r.givenKo}`];
  if (r.twoSyllableHint) msgs.push(`'${r.familyKo}${r.givenKo[0]}'이(가) 두 글자 성이라면 '두 글자 성'을 켜 주세요.`);
  setStatus(status, msgs.join('  ·  '), r.twoSyllableHint ? 'warn' : '');

  results.append(
    line('표기법대로', r.full, r.ambiguous ? '붙여 쓰면 음절 경계가 헷갈릴 수 있습니다. 붙임표 표기도 고려해 보세요.' : null),
    line('이름에 붙임표(-)', r.fullHyphen),
    line('여권식 (대문자)', r.passport, '여권은 로마자 대문자로 표기됩니다.'),
  );

  const box = h('div', { class: 'nr-line' });
  const inner = h('div', {}, h('div', { class: 'muted' }, `'${r.familyKo}' 성의 많이 쓰는 표기 (규정 아님)`));
  if (r.common.length) {
    inner.append(h('div', { class: 'nr-chips' }, r.common.map((s) => h('span', {}, s))));
    inner.append(h('div', { class: 'muted', style: 'margin-top:6px' },
      `예: ${r.common[0]} ${r.given} · ${r.common[0].toUpperCase()} ${r.given.toUpperCase()}`));
  } else {
    inner.append(h('div', { class: 'muted', style: 'margin-top:4px' }, '이 성은 따로 모아 둔 관용 표기가 없습니다. 가족이 쓰는 표기가 있으면 그것을 따르세요.'));
  }
  box.append(inner);
  results.append(box);

  if (!used) { used = true; track('tool_use', { tool: 'name-romanize' }); }
}

input.addEventListener('input', run);
two.addEventListener('change', run);
