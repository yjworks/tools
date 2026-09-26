/* 타자 연습 계산. 화면과 떨어진 순수 로직이라 테스트에서 실제 글자로 검증한다.
 *
 * 타수(한글): 두벌식 자판에서 실제로 누르는 키 수. 자모 하나 = 키 하나,
 *   Shift 가 필요한 자모(ㄲㄸㅃㅆㅉ·ㅒㅖ)는 Shift 까지 2타, 겹모음(ㅘ 등)·겹받침(ㄳ 등)은 두 자모라 2타.
 *   예) 한 = ㅎ ㅏ ㄴ = 3타, 까 = Shift+ㄱ ㅏ = 3타, 왔 = ㅇ ㅗ ㅏ Shift+ㅅ = 5타.
 *   띄어쓰기·문장 부호는 1타(Shift 가 필요한 ? ! " 등은 2타).
 * 영문: 분당 글자 수(CPM, 띄어쓰기 포함)와 WPM(= CPM ÷ 5, 5글자를 한 낱말로 치는 관례).
 * 속도는 "맞게 친 글자"만 센다(순 타수). 틀린 글자는 속도에 넣지 않는다.
 */
import { korToEng, engToKor } from './hangul.js';

const SHIFT_SYMBOLS = '~!@#$%^&*()_+{}|:"<>?';
const BASE_OF_SHIFT = { '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' };

export const isHangulChar = (c) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c || '');
const isHangulSyllable = (c) => /[가-힣]/.test(c || '');

/** 글자를 두벌식/QWERTY 키 문자열로. 대문자 = Shift+그 키. (한 → gks, 까 → Rk) */
export function keysOf(text) {
  let out = '';
  for (const ch of text) out += isHangulChar(ch) ? korToEng(ch) : ch;
  return out;
}

/** 키 문자열의 실제 타수: 키 하나 1타, Shift 가 필요하면 +1 */
export function strokesOfKeys(keys) {
  let n = 0;
  for (const k of keys) n += needsShift(k) ? 2 : 1;
  return n;
}

export const needsShift = (k) => /[A-Z]/.test(k) || SHIFT_SYMBOLS.includes(k);

/** 글의 타수 (한글은 자모 키, Shift 포함) */
export const strokeCount = (text) => strokesOfKeys(keysOf(text));

/** 키 → 자판 위 실제 키 이름(소문자·Shift 없는 기호)과 Shift 여부 */
export function physicalKey(k) {
  if (k === ' ') return { key: 'space', shift: false };
  if (/[A-Z]/.test(k)) return { key: k.toLowerCase(), shift: true };
  if (BASE_OF_SHIFT[k]) return { key: BASE_OF_SHIFT[k], shift: true };
  return { key: k.toLowerCase(), shift: false };
}

/** 문장 부호를 자판으로 칠 수 있는 모양으로: 굽은 따옴표·줄표·말줄임표·특수 공백 */
export function normalizeText(s) {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s*[—―]\s*/g, ' - ')
    .replace(/[–‐‑]/g, '-')
    .replace(/…+|…+/g, '...')
    .replace(/[  - 　]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** 긴 글을 줄로 나눈다. 빈 줄·줄바꿈은 줄 경계, 한 줄이 max 자를 넘으면 띄어쓰기에서 자른다. */
export function splitLines(text, max = 40) {
  const out = [];
  for (const para of normalizeText(text).split('\n')) {
    const words = para.split(' ').filter(Boolean);
    let line = '';
    for (const w of words) {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= max) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * 친 글(typed)을 목표 글(target)과 비교한다.
 * 마지막 글자가 한글이고 아직 조합 중일 수 있으면(친 키가 목표 키의 앞부분이면) 'pending' — 틀림으로 치지 않는다.
 *   예) 목표 "하나", 친 글 "한" → 'gks' 는 'gksk' 의 앞부분이라 아직 맞게 치는 중.
 * 반환: status[i] = 'ok' | 'bad' | 'pending' | 'todo' (목표 글자마다), extra = 목표보다 더 친 글자 수
 */
export function compareTyped(target, typed, { final = false } = {}) {
  const t = [...target], y = [...typed];
  const status = t.map(() => 'todo');
  let ok = 0, bad = 0, pending = -1;
  for (let i = 0; i < Math.min(t.length, y.length); i++) {
    if (y[i] === t[i]) { status[i] = 'ok'; ok++; continue; }
    const last = i === y.length - 1;
    if (!final && last && isHangulChar(y[i]) && keysOf(t.slice(i, i + 2).join('')).startsWith(keysOf(y[i]))) {
      status[i] = 'pending'; pending = i; continue;
    }
    status[i] = 'bad'; bad++;
  }
  return { status, ok, bad, pending, extra: Math.max(0, y.length - t.length) };
}

/** 순 타수: 맞게 친 글자의 타수 + 조합 중인 글자가 목표의 앞부분이면 그만큼 */
export function netStrokes(target, typed, cmp = compareTyped(target, typed)) {
  const t = [...target], y = [...typed];
  let n = 0;
  cmp.status.forEach((s, i) => {
    if (s === 'ok') n += strokeCount(t[i]);
    else if (s === 'pending') n += strokeCount(y[i]);
  });
  return n;
}

/** 맞게 친 글자 수 (영문 CPM 용) */
export const netChars = (cmp) => cmp.ok;

/** 틀린 글자에서 원래 눌렀어야 할 키: 두 글자의 키를 앞에서부터 견주어 처음 달라지는 곳 */
export function errorKey(targetChar, typedChar) {
  const a = keysOf(targetChar), b = keysOf(typedChar || '');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const k = a[Math.min(i, a.length - 1)];
  return k == null ? null : physicalKey(k).key;
}

/** 분당 속도. ms 가 0 이면 0 */
export function speed({ strokes = 0, chars = 0, ms = 0 }) {
  if (ms <= 0) return { kpm: 0, cpm: 0, wpm: 0 };
  const min = ms / 60000;
  return { kpm: Math.round(strokes / min), cpm: Math.round(chars / min), wpm: Math.round(chars / 5 / min) };
}

/** 정확도(%): 확정해서 친 글자 중 한 번이라도 틀렸던 글자를 뺀 비율. 고친 오타도 오타로 센다. */
export function accuracy(typedChars, errorCount) {
  if (typedChars <= 0) return 100;
  return Math.max(0, Math.round(((typedChars - Math.min(errorCount, typedChars)) / typedChars) * 1000) / 10);
}

/* ---------- 자판 배치와 손가락 ---------- */

/** 자판 줄: [키, 너비(칸)] — 키 이름은 Shift 없는 글자, 특수 키는 이름 */
export const KEY_ROWS = [
  [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['backspace', 2]],
  [['tab', 1.5], ['q', 1], ['w', 1], ['e', 1], ['r', 1], ['t', 1], ['y', 1], ['u', 1], ['i', 1], ['o', 1], ['p', 1], ['[', 1], [']', 1], ['\\', 1.5]],
  [['caps', 1.8], ['a', 1], ['s', 1], ['d', 1], ['f', 1], ['g', 1], ['h', 1], ['j', 1], ['k', 1], ['l', 1], [';', 1], ["'", 1], ['enter', 2.2]],
  [['shiftL', 2.3], ['z', 1], ['x', 1], ['c', 1], ['v', 1], ['b', 1], ['n', 1], ['m', 1], [',', 1], ['.', 1], ['/', 1], ['shiftR', 2.7]],
  [['space', 15]],
];

/** 손가락: L1 왼손 새끼 … L4 왼손 검지, R4 오른손 검지 … R1 오른손 새끼, T 엄지 */
const FINGER_KEYS = {
  L1: '`1qaz', L2: '2wsx', L3: '3edc', L4: '45rtfgvb',
  R4: '67yuhjnm', R3: '8ik,', R2: '9ol.', R1: "0-=p[]\\;'/",
};
export const FINGER = { space: 'T', shiftL: 'L1', shiftR: 'R1', tab: 'L1', caps: 'L1', enter: 'R1', backspace: 'R1' };
for (const [f, ks] of Object.entries(FINGER_KEYS)) for (const k of ks) FINGER[k] = f;
export const FINGER_NAME = { L1: '왼손 새끼', L2: '왼손 약지', L3: '왼손 중지', L4: '왼손 검지', R4: '오른손 검지', R3: '오른손 중지', R2: '오른손 약지', R1: '오른손 새끼', T: '엄지' };

/** 키에 적힌 글자: 한글 자판이면 자모(Shift 자모가 따로 있으면 함께), 영문이면 글자 */
export function keyLabel(key, lang) {
  if (key.length !== 1) return { main: '', shift: '' };
  if (lang === 'ko' && /[a-z]/.test(key)) {
    const main = engToKor(key), sh = engToKor(key.toUpperCase());
    return { main, shift: sh !== main ? sh : '' };
  }
  if (/[a-z]/.test(key)) return { main: key.toUpperCase(), shift: '' };
  const shifted = Object.keys(BASE_OF_SHIFT).find((s) => BASE_OF_SHIFT[s] === key) || '';
  return { main: key, shift: shifted };
}

/** 다음에 누를 키: 목표 글의 키 문자열에서, 지금까지 맞게 친 부분 다음 키 */
export function nextKey(target, typed) {
  const cmp = compareTyped(target, typed);
  if (cmp.bad || cmp.extra) return { key: 'backspace', shift: false };
  const t = [...target], y = [...typed];
  let done = 0;
  for (let i = 0; i < t.length && cmp.status[i] === 'ok'; i++) done = i + 1;
  const rest = keysOf(t.slice(done).join(''));
  const typedPart = cmp.pending >= 0 ? keysOf(y[cmp.pending]).length : 0;
  const k = rest[typedPart];
  return k == null ? null : physicalKey(k);
}

/* ---------- 자리 연습 단계 ---------- */

/** 단계마다 새로 익힐 키. 앞 단계 키는 계속 섞는다. */
export const DRILL_LEVELS = [
  { id: 'home', name: '1. 기본 자리', keys: 'asdfjkl;', note: '왼손 ㅁㄴㅇㄹ(ASDF), 오른손 ㅓㅏㅣ;(JKL;)' },
  { id: 'index', name: '2. 가운데 줄 전체', keys: 'gh', note: '검지를 안쪽으로 뻗어 ㅎ(G)·ㅗ(H)' },
  { id: 'top', name: '3. 윗줄', keys: 'qwertyuiop', note: 'ㅂㅈㄷㄱㅅ ㅛㅕㅑㅐㅔ(QWERTYUIOP)' },
  { id: 'bottom', name: '4. 아랫줄', keys: 'zxcvbnm,./', note: 'ㅋㅌㅊㅍ ㅠㅜㅡ(ZXCVBNM)와 쉼표·마침표' },
  { id: 'shift', name: '5. Shift', keys: 'QWERTOP', note: '쌍자음 ㅃㅉㄸㄲㅆ과 ㅒㅖ (영문은 대문자)' },
  { id: 'number', name: '6. 숫자 줄', keys: '1234567890', note: '숫자 1~0' },
  { id: 'all', name: '7. 전체 복습', keys: '', note: '지금까지 익힌 키를 모두 섞습니다' },
];

/** 단계 i 까지 쓰는 키 모음과 이번 단계 새 키 */
export function levelKeys(i) {
  const lv = DRILL_LEVELS.slice(0, i + 1);
  const all = lv.map((l) => l.keys).join('');
  const fresh = DRILL_LEVELS[i].keys || all;
  return { all: [...new Set(all)], fresh: [...new Set(fresh)] };
}

/** 자리 연습 문제: 키 3~5개 묶음을 띄어쓰기로 나눈 줄. 새 키가 절반쯤 나오게 한다. rnd 는 0~1 난수 함수. */
export function drillLine(i, rnd = Math.random, groups = 6) {
  const { all, fresh } = levelKeys(i);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const out = [];
  for (let g = 0; g < groups; g++) {
    const len = 3 + Math.floor(rnd() * 3);
    let w = '';
    for (let k = 0; k < len; k++) {
      let c = rnd() < 0.5 ? pick(fresh) : pick(all);
      if (w.endsWith(c) && rnd() < 0.7) c = pick(all); // 같은 키가 이어지는 일을 줄인다
      w += c;
    }
    out.push(w);
  }
  return out.join(' ');
}

/** 키보드 이벤트의 code(KeyA, Digit1, Semicolon…) → 키 이름 */
const CODE_KEY = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Space: 'space', Backspace: 'backspace', Enter: 'enter', Tab: 'tab',
};
export function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return CODE_KEY[code] || null;
}

/** 자리 연습에서 누른 키가 맞는지: 목표 키 글자(대문자·Shift 기호 포함)와 눌린 키·Shift 비교 */
export function drillMatch(targetChar, pressedKey, shift) {
  const p = physicalKey(targetChar);
  return p.key === pressedKey && p.shift === !!shift;
}

/* ---------- 오타 지도 ---------- */

/** 오타 지도에 기록: tries[key] 는 그 키를 눌러야 했던 횟수, errs[key] 는 틀린 횟수 */
export function addTries(map, text) {
  for (const k of keysOf(text)) {
    const p = physicalKey(k);
    map.tries[p.key] = (map.tries[p.key] || 0) + 1;
  }
  return map;
}
export function addError(map, key) {
  if (key) map.errs[key] = (map.errs[key] || 0) + 1;
  return map;
}
/** 키별 오타 비율(0~1). 3번 미만으로 쳐 본 키는 표본이 적어 null */
export function errorRate(map, key, minTries = 3) {
  const t = map.tries[key] || 0;
  if (t < minTries) return null;
  return Math.min(1, (map.errs[key] || 0) / t);
}
/** 오타가 많은 키 순서 (비율, 같으면 횟수) */
export function worstKeys(map, n = 5, minTries = 3) {
  return Object.keys(map.errs)
    .map((k) => ({ key: k, errs: map.errs[k], tries: map.tries[k] || 0, rate: errorRate(map, k, minTries) }))
    .filter((x) => x.rate != null && x.errs > 0)
    .sort((a, b) => b.rate - a.rate || b.errs - a.errs)
    .slice(0, n);
}

/* ---------- 기록 ---------- */

/** 한 판 결과를 기록 형식으로. 속도 지표는 한글이면 타수, 영문이면 WPM 을 대표값으로 쓴다. */
export function makeRecord({ mode, lang, strokes, chars, typed, errors, ms, at = Date.now(), textId = '' }) {
  const sp = speed({ strokes, chars, ms });
  return { at, mode, lang, textId, kpm: sp.kpm, cpm: sp.cpm, wpm: sp.wpm, acc: accuracy(typed, errors), sec: Math.round(ms / 1000), chars: typed };
}
export const scoreOf = (r) => (r.lang === 'en' ? r.wpm : r.kpm);

/** 개인 최고 기록: 같은 모드·언어에서 대표 속도가 가장 높은 기록. 정확도 90% 미만·20초 미만은 빼고 센다. */
export function bestOf(history, mode, lang) {
  let best = null;
  for (const r of history) {
    if (r.mode !== mode || r.lang !== lang || r.acc < 90 || r.sec < 20) continue;
    if (!best || scoreOf(r) > scoreOf(best)) best = r;
  }
  return best;
}
