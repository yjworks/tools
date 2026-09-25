import { $, h, setStatus, copyText, track } from '../_shared/ui.js';
import { parseNames, parseGroups, teamSizes, makeTeams, teamsText } from '../_shared/team-maker.js';

const COLORS = ['#2f6fed', '#e05a4a', '#0f8a5f', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#b45309', '#0d9488', '#9333ea'];
const namesEl = $('#names'), byEl = $('#by'), numEl = $('#num'), avoidEl = $('#avoid'), leadersEl = $('#leaders');
const makeBtn = $('#make'), copyBtn = $('#copy'), teamsEl = $('#teams'), status = $('#status'), info = $('#info');
const KEY = 'dibrain-team-maker';
let last = null;

try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s) {
    namesEl.value = s.names ?? namesEl.value; byEl.value = s.by || 'teams'; numEl.value = s.num || 3;
    avoidEl.value = s.avoid || ''; leadersEl.value = s.leaders || '';
    if (s.avoid || s.leaders) $('#opts').open = true;
  }
} catch { /* 저장소를 못 쓰면 기본값 */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ names: namesEl.value, by: byEl.value, num: numEl.value, avoid: avoidEl.value, leaders: leadersEl.value })); } catch { /* 무시 */ } };

function options() {
  const n = Math.max(1, Math.floor(Number(numEl.value) || 1));
  return {
    ...(byEl.value === 'teams' ? { teams: n } : { perTeam: n }),
    avoid: parseGroups(avoidEl.value),
    leaders: parseNames(leadersEl.value),
  };
}

function refreshInfo() {
  $('#numLabel').textContent = byEl.value === 'teams' ? '조 개수' : '조당 인원(최대)';
  const names = parseNames(namesEl.value);
  if (names.length < 2) { info.textContent = `참가자 ${names.length}명`; return; }
  const sizes = teamSizes(names.length, options());
  const big = Math.max(...sizes), small = Math.min(...sizes);
  const nBig = sizes.filter((s) => s === big).length;
  info.textContent = `참가자 ${names.length}명 → ${sizes.length}개 조 · ` +
    (big === small ? `모두 ${big}명` : `${big}명 ${nBig}개 조, ${small}명 ${sizes.length - nBig}개 조`);
}

function make() {
  const names = parseNames(namesEl.value);
  const r = makeTeams(names, options());
  const notes = [...r.warnings];
  if (!r.teams.length) {
    teamsEl.replaceChildren(); copyBtn.disabled = true; last = null;
    setStatus(status, [r.reason, ...notes].join(' '), 'bad');
    return;
  }
  const bad = new Set(r.violations.flat());
  teamsEl.replaceChildren(...r.teams.map((t, i) => h('div', { class: 'tm-team', style: `animation-delay:${Math.min(i, 20) * 50}ms` },
    h('h3', { style: `background:${COLORS[i % COLORS.length]}` }, `${i + 1}조`, h('small', {}, `${t.members.length}명`)),
    h('ul', {}, t.members.map((m, k) => h('li', { class: [k === 0 && t.leader === m ? 'lead' : '', bad.has(m) ? 'bad' : ''].join(' ').trim() || null }, m))))));
  last = r.teams;
  copyBtn.disabled = false;
  makeBtn.textContent = '다시 섞기';
  if (!r.ok) {
    const pairs = r.violations.slice(0, 6).map(([a, b]) => `${a}·${b}`).join(', ');
    setStatus(status, `${r.reason} 같은 조가 된 사람: ${pairs}${r.violations.length > 6 ? ' 외' : ''}. ${notes.join(' ')}`.trim(), 'bad');
  } else if (notes.length) setStatus(status, notes.join(' '), 'warn');
  else {
    const o = options();
    const cond = o.avoid.length || o.leaders.length ? ' 조건을 모두 지켰습니다.' : '';
    setStatus(status, `${r.teams.length}개 조로 나눴습니다.${cond}`, 'ok');
  }
  track('tool_use', { tool: 'team-maker', people: names.length, teams: r.teams.length, rules: options().avoid.length, ok: r.ok });
}

makeBtn.addEventListener('click', make);
copyBtn.addEventListener('click', () => last && copyText(teamsText(last), copyBtn));
for (const el of [namesEl, byEl, numEl, avoidEl, leadersEl]) el.addEventListener('input', () => { save(); refreshInfo(); makeBtn.textContent = '조 짜기'; });
refreshInfo();
