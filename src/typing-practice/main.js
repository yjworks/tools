import { $, h, track } from '../_shared/ui.js';
import { rand, shuffle } from '../_shared/random.js';
import {
  compareTyped, netStrokes, errorKey, speed, accuracy, splitLines, normalizeText, nextKey, keyLabel, keyFromCode,
  drillMatch, drillLine, needsShift, physicalKey, KEY_ROWS, FINGER, FINGER_NAME, DRILL_LEVELS, addTries, addError,
  errorRate, worstKeys, makeRecord, bestOf, scoreOf,
} from '../_shared/typing-practice.js';
import { WORDS, SHORT, LONG } from './texts.js';

const SLUG = 'typing-practice';
const K = { prefs: `${SLUG}:prefs`, hist: `${SLUG}:history`, err: `${SLUG}:errmap` };
const IDLE_CAP = 10000; // 입력 사이 10초 넘는 공백은 10초까지만 센다
const SIZE = { drill: 4, words: 20, short: 5 };
const MODE_NAME = { drill: '자리 연습', words: '낱말 연습', short: '짧은 글', long: '긴 글' };

const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간이 막혀 있어도 연습은 된다 */ } };

const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
const prefs = { mode: 'short', lang: 'ko', level: 0, longKo: LONG.ko[0].id, longEn: LONG.en[0].id, showKb: !coarse, ...load(K.prefs, {}) };
let history = load(K.hist, []);
if (!Array.isArray(history)) history = [];
let errMaps = load(K.err, {});
for (const l of ['ko', 'en']) if (!errMaps[l] || !errMaps[l].tries) errMaps[l] = { tries: {}, errs: {} };

const el = {
  target: $('#target'), upcoming: $('#upcoming'), input: $('#typeIn'), hint: $('#hint'), bar: $('#bar'), source: $('#source'),
  board: $('#board'), result: $('#result'), kb: $('#kb'), kbWrap: $('#kbWrap'), showKb: $('#showKb'), heat: $('#heat'),
  level: $('#level'), levelField: $('#levelField'), textSel: $('#textSel'), textField: $('#textField'), mobileNote: $('#mobileNote'),
  spLabel: $('#spLabel'), spUnit: $('#spUnit'), stSpeed: $('#stSpeed'), stAcc: $('#stAcc'), stProg: $('#stProg'), stTime: $('#stTime'),
};

/* ---------- 한 판 상태 ---------- */
let S;
function newSession() {
  const { mode, lang } = prefs;
  let units = [], source = '', textId = '';
  if (mode === 'drill') {
    units = Array.from({ length: SIZE.drill }, () => drillLine(prefs.level, rand, coarse ? 4 : 6));
    source = DRILL_LEVELS[prefs.level].note;
    textId = DRILL_LEVELS[prefs.level].id;
  } else if (mode === 'words') {
    units = shuffle(WORDS[lang]).slice(0, SIZE.words);
    source = lang === 'ko' ? '자주 쓰는 낱말 · 띄어쓰기나 Enter 로 다음 낱말' : 'Common English words · Space or Enter for the next word';
  } else if (mode === 'short') {
    const picks = shuffle(SHORT[lang]).slice(0, SIZE.short);
    units = picks.map((p) => normalizeText(p.text));
    return startWith(units, picks.map((p) => p.source), '');
  } else {
    const t = LONG[lang].find((x) => x.id === (lang === 'ko' ? prefs.longKo : prefs.longEn)) || LONG[lang][0];
    units = splitLines(t.text, lang === 'ko' ? 34 : 60);
    source = t.source;
    textId = t.id;
  }
  return startWith(units, units.map(() => source), textId);
}
function startWith(units, sources, textId) {
  S = {
    mode: prefs.mode, lang: prefs.lang, units, sources, textId, ui: 0, pos: 0,
    activeMs: 0, lastAt: null, done: false,
    tot: { strokes: 0, chars: 0, typed: 0, errors: 0 },
    unitErr: new Set(), sessErr: { tries: {}, errs: {} }, enterPending: false,
  };
  el.input.value = '';
  el.result.hidden = true;
  el.result.replaceChildren();
  render();
}

/* ---------- 시간 ---------- */
function tick() {
  const now = performance.now();
  if (S.lastAt != null) S.activeMs += Math.min(now - S.lastAt, IDLE_CAP);
  S.lastAt = now;
}
const liveMs = () => (S.lastAt == null ? 0 : S.done ? S.activeMs : S.activeMs + Math.min(performance.now() - S.lastAt, IDLE_CAP));
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- 오타 기록 ---------- */
function recordError(key) {
  if (!key) return;
  addError(S.sessErr, key);
  addError(errMaps[S.lang], key);
}
function recordTries(text) {
  addTries(S.sessErr, text);
  addTries(errMaps[S.lang], text);
}

/* ---------- 글 연습 (낱말·짧은 글·긴 글) ---------- */
let composing = false;
const curTarget = () => S.units[S.ui] ?? '';

function onType() {
  if (!S || S.done || S.mode === 'drill') return;
  const v = el.input.value;
  if (v === '' && S.lastAt == null) return;
  tick();
  if (S.mode === 'words' && /\s/.test(v)) {
    const w = v.split(/\s/)[0];
    if (w) finishUnit(w); else el.input.value = '';
    return;
  }
  const target = curTarget();
  const cmp = compareTyped(target, v);
  const t = [...target], y = [...v];
  cmp.status.forEach((s, i) => {
    if (s === 'bad' && !S.unitErr.has(i)) { S.unitErr.add(i); recordError(errorKey(t[i], y[i])); }
  });
  if (S.mode !== 'words' && !composing && v === target) { finishUnit(v); return; }
  render(cmp);
}

function finishUnit(typedRaw) {
  const target = curTarget();
  let typed = typedRaw;
  if ([...typed].length > [...target].length) typed = typed.replace(/\s+$/, '');
  if (!typed) return;
  const cmp = compareTyped(target, typed, { final: true });
  const t = [...target], y = [...typed];
  let missing = 0;
  cmp.status.forEach((s, i) => {
    if (s === 'bad' && !S.unitErr.has(i)) { S.unitErr.add(i); recordError(errorKey(t[i], y[i])); }
    if (s === 'todo') missing++;
  });
  S.tot.strokes += netStrokes(target, typed, cmp);
  S.tot.chars += cmp.ok;
  S.tot.typed += Math.max(t.length, y.length);
  S.tot.errors += S.unitErr.size + missing + cmp.extra;
  recordTries(target);
  S.unitErr = new Set();
  S.enterPending = false;
  S.ui++;
  el.input.value = '';
  if (S.ui >= S.units.length) finishSession();
  else render();
}

function tryAdvance() {
  if (!S || S.done || S.mode === 'drill') return;
  const v = el.input.value;
  if (!v.trim()) return;
  tick();
  finishUnit(v);
}

el.input.addEventListener('compositionstart', () => { composing = true; });
el.input.addEventListener('compositionupdate', () => requestAnimationFrame(onType));
el.input.addEventListener('compositionend', () => {
  composing = false;
  onType();
  if (S && S.enterPending) { S.enterPending = false; setTimeout(tryAdvance, 0); }
});
el.input.addEventListener('input', onType);
el.input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.isComposing || composing) { if (S) S.enterPending = true; return; } // 조합을 끝내는 Enter: 끝난 뒤 넘어간다
  e.preventDefault();
  tryAdvance();
});
el.input.addEventListener('blur', () => { composing = false; });

/* ---------- 자리 연습 (실제 키 위치로 판정) ---------- */
function onDrillKey(e) {
  if (!S || S.mode !== 'drill' || S.done) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
  const key = keyFromCode(e.code);
  if (!key || key === 'tab') return;
  e.preventDefault();
  el.mobileNote.hidden = true;
  if (e.repeat || key === 'backspace' || key === 'enter') return;
  tick();
  const unit = S.units[S.ui];
  const want = unit[S.pos];
  S.tot.typed++;
  if (drillMatch(want, key, e.shiftKey)) {
    S.tot.strokes += needsShift(want) ? 2 : 1;
    S.tot.chars++;
    recordTries(want);
    S.pos++;
    if (S.pos >= unit.length) { S.ui++; S.pos = 0; }
    if (S.ui >= S.units.length) { finishSession(); return; }
  } else {
    S.tot.errors++;
    recordError(physicalKey(want).key);
    flashKey(key);
  }
  render();
}
document.addEventListener('keydown', onDrillKey);

function flashKey(key) {
  const k = el.kb.querySelector(`[data-k="${CSS.escape(key)}"]`);
  if (!k) return;
  k.classList.remove('wrong'); void k.offsetWidth; k.classList.add('wrong');
  setTimeout(() => k.classList.remove('wrong'), 300);
}

/* ---------- 화면 그리기 ---------- */
function renderTarget(cmp) {
  const frag = document.createDocumentFragment();
  if (S.mode === 'drill') {
    el.target.className = 'tp-target drill';
    const unit = S.units[S.ui] || '';
    [...unit].forEach((c, i) => {
      const show = c === ' ' ? ' ' : S.lang === 'ko' && /[a-zA-Z]/.test(c) ? keyLabel(c.toLowerCase(), 'ko')[needsShift(c) ? 'shift' : 'main'] || c : c;
      frag.append(h('span', { class: (i < S.pos ? 'ok' : i === S.pos ? 'cur' : '') + (c === ' ' ? ' sp' : '') }, show));
    });
    el.target.replaceChildren(frag);
    const nxt = S.units[S.ui + 1];
    el.upcoming.textContent = nxt ? [...nxt].map((c) => (S.lang === 'ko' && /[a-zA-Z]/.test(c) ? keyLabel(c.toLowerCase(), 'ko')[needsShift(c) ? 'shift' : 'main'] || c : c)).join('') : '';
    return;
  }
  el.target.className = 'tp-target';
  const target = curTarget();
  const c = cmp || compareTyped(target, el.input.value);
  const typedLen = [...el.input.value].length;
  const cur = c.pending >= 0 ? c.pending : Math.min(typedLen, [...target].length);
  [...target].forEach((ch, i) => {
    const cls = [c.status[i] === 'todo' ? '' : c.status[i], i === cur ? 'cur' : '', ch === ' ' ? 'sp' : ''].filter(Boolean).join(' ');
    frag.append(h('span', { class: cls || null }, ch));
  });
  if (c.extra) frag.append(h('span', { class: 'extra' }, `+${c.extra}`));
  el.target.replaceChildren(frag);
  if (S.mode === 'words') el.upcoming.textContent = S.units.slice(S.ui + 1, S.ui + 5).join('  ');
  else el.upcoming.textContent = S.units[S.ui + 1] || '';
}

function currentStats() {
  let { strokes, chars, typed, errors } = S.tot;
  if (S.mode !== 'drill' && !S.done) {
    const target = curTarget(), v = el.input.value;
    const cmp = compareTyped(target, v);
    strokes += netStrokes(target, v, cmp);
    chars += cmp.ok;
    typed += cmp.ok + cmp.bad + cmp.extra;
    errors += S.unitErr.size;
  }
  return { strokes, chars, typed, errors, ms: liveMs() };
}

function renderStats() {
  const st = currentStats();
  const sp = speed(st);
  const ko = S.lang === 'ko';
  el.spLabel.textContent = ko ? '타수' : 'WPM';
  el.spUnit.textContent = ko ? '타/분' : `· ${sp.cpm} CPM`;
  el.stSpeed.textContent = st.ms < 1500 ? '–' : ko ? sp.kpm : sp.wpm;
  el.stAcc.textContent = accuracy(st.typed, st.errors);
  if (S.mode === 'drill') {
    const total = S.units.reduce((a, u) => a + u.length, 0);
    const done = S.units.slice(0, S.ui).reduce((a, u) => a + u.length, 0) + S.pos;
    el.stProg.textContent = `${Math.min(S.ui + 1, S.units.length)}/${S.units.length}줄`;
    el.bar.style.width = `${(done / total) * 100}%`;
  } else {
    el.stProg.textContent = `${Math.min(S.ui + (S.done ? 0 : 1), S.units.length)}/${S.units.length}`;
    el.bar.style.width = `${(S.ui / S.units.length) * 100}%`;
  }
  el.stTime.textContent = fmtTime(st.ms);
}

function renderHint() {
  let text = '', warn = false;
  const v = el.input.value;
  if (S.done) text = '';
  else if (S.mode === 'drill') text = coarse ? '' : '화면 자판에 칠해진 키를 누르세요. 틀린 키를 누르면 넘어가지 않습니다. 한/영 상태는 상관없습니다.';
  else if (S.lang === 'ko' && /[A-Za-z]/.test(v) && !/[A-Za-z]/.test(curTarget())) { text = '영문으로 입력되고 있습니다. 한/영 키로 한글 입력으로 바꿔 주세요.'; warn = true; }
  else if (S.lang === 'en' && /[ㄱ-ㅣ가-힣]/.test(v)) { text = 'Korean input is on. Switch your keyboard to English (한/영 key).'; warn = true; }
  else if (S.mode !== 'words' && [...v].length >= [...curTarget()].length && v !== curTarget()) { text = '틀린 곳을 고치거나 Enter를 누르면 다음 줄로 넘어갑니다.'; }
  else if (S.mode === 'words') text = '띄어쓰기나 Enter를 누르면 다음 낱말로 넘어갑니다.';
  else text = '줄을 다 치면 다음 줄로 넘어갑니다. 중간에 넘기려면 Enter를 누르세요.';
  el.hint.textContent = text;
  el.hint.classList.toggle('warn', warn);
}

function renderNextKey() {
  el.kb.querySelectorAll('.next').forEach((k) => k.classList.remove('next'));
  if (!prefs.showKb || S.done) return;
  let nk = null;
  if (S.mode === 'drill') {
    const want = (S.units[S.ui] || '')[S.pos];
    if (want != null) nk = physicalKey(want);
  } else {
    nk = nextKey(curTarget(), el.input.value);
  }
  if (!nk) return;
  const k = el.kb.querySelector(`[data-k="${CSS.escape(nk.key)}"]`);
  if (k) k.classList.add('next');
  if (nk.shift) {
    const side = (FINGER[nk.key] || 'L').startsWith('L') ? 'shiftR' : 'shiftL';
    el.kb.querySelector(`[data-k="${side}"]`)?.classList.add('next');
  }
}

function render(cmp) {
  renderTarget(cmp);
  renderStats();
  renderHint();
  renderNextKey();
  el.source.textContent = S.done ? '' : S.sources[Math.min(S.ui, S.sources.length - 1)] || '';
  const drill = S.mode === 'drill';
  el.input.hidden = drill;
  el.mobileNote.hidden = !(drill && coarse);
}

/* ---------- 자판 ---------- */
const FN_LABEL = { backspace: '←', tab: 'Tab', caps: 'Caps', enter: 'Enter', shiftL: 'Shift', shiftR: 'Shift', space: '' };
function buildKeyboard(root, lang) {
  root.replaceChildren(...KEY_ROWS.map((row) => h('div', { class: 'kr' }, row.map(([k, w]) => {
    const fn = k.length > 1;
    const lab = fn ? { main: FN_LABEL[k] ?? '', shift: '' } : keyLabel(k, lang);
    return h('div', { class: `k${fn ? ' fn' : ''}${k === 'f' || k === 'j' ? ' home' : ''}`, 'data-k': k, 'data-f': FINGER[k] || null, style: `--w:${w}`, title: FINGER_NAME[FINGER[k]] || null },
      lab.shift ? h('small', {}, lab.shift) : null, lab.main);
  }))));
}

function renderHeat() {
  const lang = prefs.lang;
  buildKeyboard(el.heat, lang);
  const map = errMaps[lang];
  el.heat.querySelectorAll('.k').forEach((k) => {
    const key = k.dataset.k;
    const tries = map.tries[key] || 0, errs = map.errs[key] || 0;
    const r = errorRate(map, key);
    if (r != null && r > 0) {
      const pct = Math.round(Math.min(1, r / 0.25) * 85);
      k.dataset.h = '1';
      k.style.setProperty('--h', pct);
      if (pct > 50) k.classList.add('hot');
    }
    const lab = keyLabel(key, lang).main;
    if (tries) k.title = `${lab || key}: ${tries}번 중 ${errs}번 틀림 (${Math.round((errs / tries) * 100)}%)`;
  });
  const worst = worstKeys(map, 5);
  const name = (k) => { const l = keyLabel(k, lang).main; return k === 'space' ? '띄어쓰기' : lang === 'ko' && /[a-z]/.test(k) ? `${l}(${k.toUpperCase()})` : l || k; };
  $('#worst').textContent = worst.length
    ? `많이 틀리는 키: ${worst.map((w) => `${name(w.key)} ${Math.round(w.rate * 100)}%`).join(', ')}`
    : '아직 기록이 적습니다. 몇 판 연습하면 자주 틀리는 키가 여기에 나옵니다.';
}

/* ---------- 결과와 기록 ---------- */
function finishSession() {
  tick();
  S.done = true;
  const st = currentStats();
  const prevBest = bestOf(history, S.mode, S.lang);
  const rec = makeRecord({ mode: S.mode, lang: S.lang, strokes: st.strokes, chars: st.chars, typed: st.typed, errors: st.errors, ms: st.ms, textId: S.textId });
  history.unshift(rec);
  history = history.slice(0, 300);
  save(K.hist, history);
  save(K.err, errMaps);
  const nowBest = bestOf(history, S.mode, S.lang);
  const isNew = nowBest === rec && (!prevBest || scoreOf(rec) > scoreOf(prevBest));
  track('tool_use', { tool: SLUG, action: 'finish', mode: S.mode, lang: S.lang, speed: scoreOf(rec), acc: Math.round(rec.acc), sec: rec.sec });

  const ko = S.lang === 'ko';
  const worst = worstKeys(S.sessErr, 3, 1);
  const name = (k) => { const l = keyLabel(k, S.lang).main; return k === 'space' ? '띄어쓰기' : ko && /[a-z]/.test(k) ? `${l}(${k.toUpperCase()})` : l || k; };
  const box = el.result;
  box.replaceChildren(
    h('h3', {}, `${MODE_NAME[S.mode]} 끝`, isNew ? h('span', { class: 'new' }, '개인 최고 기록') : null),
    h('div', { class: 'big' },
      ko ? h('div', {}, h('small', {}, '타수'), h('b', {}, rec.kpm), ' 타/분')
        : h('div', {}, h('small', {}, 'WPM'), h('b', {}, rec.wpm), ` · ${rec.cpm} CPM`),
      h('div', {}, h('small', {}, '정확도'), h('b', {}, rec.acc), '%'),
      h('div', {}, h('small', {}, '시간'), h('b', {}, fmtTime(rec.sec * 1000)))),
    h('p', {}, `친 글자 ${st.typed}개 중 틀린 글자 ${st.errors}개` + (prevBest && !isNew ? ` · 이 연습의 최고 기록 ${ko ? `${prevBest.kpm}타` : `${prevBest.wpm} WPM`}` : '')),
    worst.length ? h('p', {}, `이번에 틀린 키: ${worst.map((w) => `${name(w.key)} ${w.errs}번`).join(', ')}`) : h('p', {}, '이번 판은 틀린 키가 없습니다.'),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', onclick: () => { newSession(); focusPractice(); } }, '다시 하기'),
      nextButton()),
  );
  box.hidden = false;
  render();
  el.input.blur();
  renderRecords();
  box.querySelector('button')?.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function nextButton() {
  if (S.mode === 'drill' && prefs.level < DRILL_LEVELS.length - 1) {
    return h('button', { type: 'button', class: 'ghost', onclick: () => { prefs.level++; savePrefs(); syncControls(); newSession(); focusPractice(); } }, '다음 단계로');
  }
  if (S.mode === 'long') {
    return h('button', { type: 'button', class: 'ghost', onclick: () => {
      const list = LONG[prefs.lang], key = prefs.lang === 'ko' ? 'longKo' : 'longEn';
      const i = list.findIndex((x) => x.id === prefs[key]);
      prefs[key] = list[(i + 1) % list.length].id; savePrefs(); syncControls(); newSession(); focusPractice();
    } }, '다음 글');
  }
  return null;
}

const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function renderRecords() {
  const lang = prefs.lang, ko = lang === 'ko';
  $('#recLang').textContent = ko ? '· 한글' : '· English';
  const best = $('#best');
  best.replaceChildren(...Object.keys(MODE_NAME).map((m) => {
    const b = bestOf(history, m, lang);
    return h('div', {}, h('small', {}, `${MODE_NAME[m]} 최고`), b ? h('b', {}, ko ? `${b.kpm}타` : `${b.wpm} WPM`) : h('b', { class: 'muted' }, '–'),
      b ? h('small', {}, `정확도 ${b.acc}% · ${fmtDate(b.at)}`) : h('small', {}, '기록 없음'));
  }));
  const rows = history.filter((r) => r.lang === lang).slice(0, 15);
  const hist = $('#hist');
  hist.replaceChildren(
    h('tr', {}, h('th', {}, '날짜'), h('th', {}, '연습'), h('th', {}, ko ? '타수' : 'WPM'), h('th', {}, '정확도'), h('th', {}, '시간')),
    ...(rows.length ? rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.at)), h('td', {}, MODE_NAME[r.mode] || r.mode),
      h('td', {}, ko ? `${r.kpm}` : `${r.wpm}`), h('td', {}, `${r.acc}%`), h('td', {}, fmtTime(r.sec * 1000))))
      : [h('tr', {}, h('td', { colspan: '5', class: 'muted' }, '아직 기록이 없습니다.'))]),
  );
  renderHeat();
}

$('#clearRec').addEventListener('click', () => {
  if (!confirm('이 기기에 저장된 타자 기록과 오타 지도를 모두 지울까요?')) return;
  history = []; errMaps = { ko: { tries: {}, errs: {} }, en: { tries: {}, errs: {} } };
  save(K.hist, history); save(K.err, errMaps);
  renderRecords();
});

/* ---------- 선택 ---------- */
function savePrefs() { save(K.prefs, prefs); }

function syncControls() {
  document.querySelectorAll('#modeTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === prefs.mode)));
  document.querySelectorAll('#langTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lang === prefs.lang)));
  el.levelField.hidden = prefs.mode !== 'drill';
  el.textField.hidden = prefs.mode !== 'long';
  el.level.replaceChildren(...DRILL_LEVELS.map((l, i) => h('option', { value: String(i), selected: i === prefs.level }, l.name)));
  const list = LONG[prefs.lang], cur = prefs.lang === 'ko' ? prefs.longKo : prefs.longEn;
  el.textSel.replaceChildren(...list.map((t) => h('option', { value: t.id, selected: t.id === cur }, t.title)));
  el.showKb.checked = prefs.showKb;
  el.kbWrap.hidden = !prefs.showKb;
  buildKeyboard(el.kb, prefs.lang);
}

function focusPractice() {
  if (prefs.mode === 'drill') { document.activeElement?.blur?.(); el.board.focus({ preventScroll: true }); }
  else if (!coarse) el.input.focus({ preventScroll: true });
}

document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => {
  prefs.mode = b.dataset.mode; savePrefs(); syncControls(); newSession(); focusPractice();
}));
document.querySelectorAll('#langTabs button').forEach((b) => b.addEventListener('click', () => {
  prefs.lang = b.dataset.lang; savePrefs(); syncControls(); newSession(); renderRecords(); focusPractice();
}));
el.level.addEventListener('change', () => { prefs.level = Number(el.level.value) || 0; savePrefs(); newSession(); focusPractice(); });
el.textSel.addEventListener('change', () => { prefs[prefs.lang === 'ko' ? 'longKo' : 'longEn'] = el.textSel.value; savePrefs(); newSession(); focusPractice(); });
$('#restart').addEventListener('click', () => { newSession(); focusPractice(); });
el.showKb.addEventListener('change', () => { prefs.showKb = el.showKb.checked; savePrefs(); el.kbWrap.hidden = !prefs.showKb; renderNextKey(); });
el.board.addEventListener('click', () => { if (prefs.mode === 'drill') el.board.focus({ preventScroll: true }); else el.input.focus(); });

/* 시간 표시만 주기적으로 새로 그린다(계산은 입력 시각 기준) */
setInterval(() => { if (S && !S.done && S.lastAt != null) renderStats(); }, 500);

if (prefs.level >= DRILL_LEVELS.length) prefs.level = 0;
syncControls();
newSession();
renderRecords();

/* 테스트·디버그용: 친 글은 담지 않고 숫자만 */
window.__typingPractice = { stats: () => (S ? { ...currentStats(), mode: S.mode, lang: S.lang, done: S.done, ui: S.ui, units: S.units.length } : null), units: () => S?.units.slice(), history: () => history.slice() };
