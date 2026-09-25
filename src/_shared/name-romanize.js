/* 한글 이름 → 로마자 (국어의 로마자 표기법, 문화체육관광부 고시 제2014-42호).
 * 인명 규칙(제3장 제4항): 성과 이름을 띄어 쓰고, 이름은 붙여 쓰되 음절 사이 붙임표(-)를 허용한다.
 * 이름에서 일어나는 음운 변화는 반영하지 않는다(한복남 Han Boknam, 홍빛나 Hong Bitna).
 * 그래서 음절마다 따로 옮긴다. 받침은 대표음(k·n·t·l·m·p·ng)으로 적고, ㄹㄹ 은 ll 로 적는다(제2장 제2항). */

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// 받침 28개(0 = 없음): ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅄ ㅅ ㅆ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const RIEUL_INITIAL = 5, RIEUL_FINAL = 8;

/** 두 글자 성 (이 도구에서 고를 수 있게 한 것) */
export const TWO_SYLLABLE_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문'];

/* 흔히 보이는 성씨 로마자 표기. 규정이 아니라 여권·명함 등에서 많이 쓰이는 관용 표기다.
 * (성의 표기는 로마자 표기법에서 "따로 정한다"고만 되어 있고 아직 정해진 것이 없다.) 순서는 빈도 순위가 아니다. */
export const COMMON_SURNAME_SPELLINGS = {
  김: ['Kim'], 이: ['Lee', 'Yi', 'Rhee'], 박: ['Park', 'Pak'], 최: ['Choi', 'Choe'], 정: ['Jung', 'Jeong', 'Chung'],
  강: ['Kang'], 조: ['Cho', 'Jo'], 윤: ['Yoon', 'Yun'], 장: ['Jang', 'Chang'], 임: ['Lim', 'Im'], 림: ['Lim'],
  한: ['Han'], 오: ['Oh'], 서: ['Seo', 'Suh'], 신: ['Shin'], 권: ['Kwon'], 황: ['Hwang'], 안: ['Ahn'], 송: ['Song'],
  류: ['Ryu', 'Yoo'], 유: ['Yoo', 'Yu'], 전: ['Jeon', 'Jun'], 홍: ['Hong'], 고: ['Ko', 'Koh'], 문: ['Moon'], 양: ['Yang'],
  손: ['Son', 'Sohn'], 배: ['Bae'], 백: ['Baek', 'Paik'], 허: ['Heo', 'Huh'], 노: ['Noh', 'Roh'], 남: ['Nam'], 심: ['Shim', 'Sim'],
  하: ['Ha'], 곽: ['Kwak'], 성: ['Sung', 'Seong'], 차: ['Cha'], 주: ['Joo', 'Ju'], 우: ['Woo'], 구: ['Koo', 'Ku'], 민: ['Min'],
  진: ['Jin'], 지: ['Ji'], 엄: ['Eom', 'Um'], 채: ['Chae'], 원: ['Won'], 천: ['Cheon', 'Chun'], 방: ['Bang'], 공: ['Kong'],
  현: ['Hyun'], 함: ['Ham'], 변: ['Byun', 'Byeon'], 염: ['Yeom'], 여: ['Yeo'], 추: ['Choo', 'Chu'], 도: ['Do'], 석: ['Seok'],
  선: ['Sun'], 설: ['Seol'], 마: ['Ma'], 길: ['Gil', 'Kil'], 연: ['Yeon'], 위: ['Wi'], 표: ['Pyo'], 명: ['Myung'], 기: ['Ki'],
  반: ['Ban'], 나: ['Na'], 라: ['Ra'], 왕: ['Wang'], 금: ['Keum'], 옥: ['Ok'], 육: ['Yuk'], 인: ['In'], 맹: ['Maeng'],
  제: ['Je'], 모: ['Mo'], 탁: ['Tak'], 국: ['Kook'], 은: ['Eun'], 봉: ['Bong'], 경: ['Kyung'], 태: ['Tae'], 가: ['Ka'],
  남궁: ['Namgung', 'Namkoong'], 황보: ['Hwangbo'], 제갈: ['Jegal'], 선우: ['Sunwoo', 'Seonu'], 독고: ['Dokgo'],
  사공: ['Sagong'], 서문: ['Seomun'],
};

const isSyllable = (ch) => { const c = ch.codePointAt(0); return c >= 0xac00 && c <= 0xd7a3; };

function split(ch) {
  const i = ch.codePointAt(0) - 0xac00;
  return { l: Math.floor(i / 588), v: Math.floor((i % 588) / 28), t: i % 28 };
}

/** 한글 음절 문자열 → 음절별 로마자 조각 배열. 이름 규칙대로 음운 변화 없이 옮긴다. */
export function romanizeSyllables(text) {
  const out = [];
  let prevFinal = 0;
  for (const ch of text) {
    const { l, v, t } = split(ch);
    const init = l === RIEUL_INITIAL && prevFinal === RIEUL_FINAL ? 'l' : INITIAL[l]; // ㄹㄹ → ll
    out.push(init + VOWEL[v] + FINAL[t]);
    prevFinal = t;
  }
  return out;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** 한글 이름만 남긴다(공백 등 제거). 한글 음절이 아닌 글자가 있으면 null. */
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/\s+/g, '');
  if (!s) return '';
  for (const ch of s) if (!isSyllable(ch)) return null;
  return s;
}

/* 붙여 쓰면 음절 경계가 헷갈릴 수 있는 곳: 앞 음절이 자음으로 끝나고 뒤 음절이 모음으로 시작(선영 Seonyeong),
 * 또는 n + g(한결 Hangyeol 은 Hang-yeol 로도 읽힘). */
function ambiguousJoin(parts) {
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i - 1], b = parts[i];
    if (/[^aeiouwy]$/.test(a) && /^[aeiouwy]/.test(b)) return true;
    if (/n$/.test(a) && /^g/.test(b)) return true;
    if (/[aeiou]$/.test(a) && /^[aeiou]/.test(b)) return true; // 모음이 이어짐(서은 Seoeun)
  }
  return false;
}

/**
 * 이름 전체 변환.
 * @param {string} raw 한글 이름 (예: '홍빛나')
 * @param {{surnameLength?: 1|2}} opt
 */
export function romanizeName(raw, opt = {}) {
  const name = cleanName(raw);
  if (!name) return null;
  const chars = [...name];
  const sl = opt.surnameLength === 2 ? 2 : 1;
  if (chars.length <= sl) return null;
  const familyKo = chars.slice(0, sl).join('');
  const givenKo = chars.slice(sl).join('');
  const family = cap(romanizeSyllables(familyKo).join(''));
  const givenParts = romanizeSyllables(givenKo);
  const given = cap(givenParts.join(''));
  const givenHyphen = cap(givenParts.join('-'));
  return {
    familyKo, givenKo, family, given, givenHyphen,
    full: `${family} ${given}`,
    fullHyphen: `${family} ${givenHyphen}`,
    passport: `${family} ${given}`.toUpperCase(),
    common: COMMON_SURNAME_SPELLINGS[familyKo] || [],
    ambiguous: givenParts.length > 1 && ambiguousJoin(givenParts),
    twoSyllableHint: sl === 1 && chars.length >= 3 && TWO_SYLLABLE_SURNAMES.includes(chars.slice(0, 2).join('')),
  };
}
