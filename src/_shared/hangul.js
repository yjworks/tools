/* 두벌식 한영타 변환. 영문 자판으로 친 글자 → 한글(dkssud → 안녕), 그 반대도. */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/* 자판 → 자모 (두벌식 표준) */
const KEY = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
};
const JAMO_TO_KEY = {};
for (const [k, v] of Object.entries(KEY)) if (!(v in JAMO_TO_KEY)) JAMO_TO_KEY[v] = k;

const VOWEL_PAIR = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const FINAL_PAIR = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
const SPLIT_VOWEL = Object.fromEntries(Object.entries(VOWEL_PAIR).map(([k, v]) => [v, k]));
const SPLIT_FINAL = Object.fromEntries(Object.entries(FINAL_PAIR).map(([k, v]) => [v, k]));

const isVowel = (j) => JUNG.includes(j);
const compose = (c, v, f = '') => String.fromCharCode(0xac00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(v)) * 28 + JONG.indexOf(f));

export const hasHangul = (s) => /[가-힣ㄱ-ㆎ]/.test(s);
export const hasLatin = (s) => /[A-Za-z]/.test(s);

/** 영문 자판으로 친 글자 → 한글 */
export function engToKor(input) {
  let out = '';
  let cho = '', jung = '', jong = '';
  const flush = () => {
    if (cho && jung) out += compose(cho, jung, jong);
    else out += cho + jung + jong;
    cho = jung = jong = '';
  };
  for (const ch of input) {
    const jamo = KEY[ch] ?? KEY[ch.toLowerCase()];
    if (!jamo) { flush(); out += ch; continue; }
    if (isVowel(jamo)) {
      if (jong) {
        // 받침이 다음 글자의 첫소리로 넘어간다: 겹받침이면 뒤 자음만 넘어간다
        const pair = SPLIT_FINAL[jong];
        const moved = pair ? pair[1] : jong;
        jong = pair ? pair[0] : '';
        flush();
        cho = moved; jung = jamo;
      } else if (jung) {
        const v = VOWEL_PAIR[jung + jamo];
        if (v && cho) jung = v;
        else if (v && !cho) jung = v;
        else { flush(); jung = jamo; }
      } else {
        jung = jamo;
      }
    } else {
      if (!cho && !jung) cho = jamo;
      else if (cho && !jung) { flush(); cho = jamo; }
      else if (!cho && jung) { flush(); cho = jamo; }
      else if (!jong) {
        if (JONG.includes(jamo)) jong = jamo; // ㄸ·ㅃ·ㅉ 은 받침이 될 수 없다
        else { flush(); cho = jamo; }
      } else {
        const f = FINAL_PAIR[jong + jamo];
        if (f) jong = f;
        else { flush(); cho = jamo; }
      }
    }
  }
  flush();
  return out;
}

/** 한글 → 영문 자판 키 (안녕 → dkssud) */
export function korToEng(input) {
  let out = '';
  const key = (j) => {
    const pair = SPLIT_VOWEL[j] || SPLIT_FINAL[j];
    if (pair) return JAMO_TO_KEY[pair[0]] + JAMO_TO_KEY[pair[1]];
    return JAMO_TO_KEY[j] ?? j;
  };
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const n = code - 0xac00;
      out += key(CHO[Math.floor(n / 588)]) + key(JUNG[Math.floor((n % 588) / 28)]) + (n % 28 ? key(JONG[n % 28]) : '');
    } else if (code >= 0x3131 && code <= 0x318e) out += key(ch);
    else out += ch;
  }
  return out;
}
