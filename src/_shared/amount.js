/* 숫자 → 한글·한자 금액 표기. 계약서·영수증의 "금 오백만원정" 같은 표기. 경(10^16) 단위까지. */

const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조', '경'];
/* 갖은자: 고쳐 쓰기 어렵게 획을 늘린 한자. 수표·계약서에 쓴다. */
const H_DIGIT = ['', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const H_SMALL = ['', '拾', '佰', '仟'];
const H_BIG = ['', '萬', '億', '兆', '京'];

/** "5,000,000" · "5000000원" · 5e6 같은 입력을 BigInt 로. 숫자가 아니면 null. */
export function parseAmount(input) {
  const s = String(input).replace(/[,\s원₩]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  if (n >= 10n ** 20n) return null; // 경 단위(10^16) 위로 네 자리까지만
  return n;
}

/**
 * @param {bigint} n
 * @param {{il?: boolean, hanja?: boolean, spacing?: boolean}} opt
 *   il: 십·백·천·만 앞의 '일'을 쓴다(일백만). 금액을 고쳐 쓰지 못하게 하려는 관례.
 *   hanja: 갖은자(壹貳參…)로 쓴다. 갖은자는 항상 壹을 쓴다.
 *   spacing: 만·억·조 단위마다 띄어 쓴다(오백만 삼천).
 */
export function toKorean(n, opt = {}) {
  const { il = true, hanja = false, spacing = false } = opt;
  if (n === 0n) return hanja ? '零' : '영';
  const D = hanja ? H_DIGIT : DIGIT, S = hanja ? H_SMALL : SMALL, B = hanja ? H_BIG : BIG;
  const groups = [];
  let x = n;
  while (x > 0n) { groups.push(Number(x % 10000n)); x /= 10000n; }
  const parts = [];
  for (let g = groups.length - 1; g >= 0; g--) {
    const v = groups[g];
    if (!v) continue;
    let s = '';
    const digits = [Math.floor(v / 1000), Math.floor(v / 100) % 10, Math.floor(v / 10) % 10, v % 10];
    digits.forEach((d, i) => {
      const pos = 3 - i;
      if (!d) return;
      const one = d === 1 && pos > 0 && !il && !hanja; // '일십' → '십'
      s += (one ? '' : D[d]) + S[pos];
    });
    // '만' 단위가 1 하나뿐일 때: il=false 면 '만'(일만 아님). 억·조는 '일억'이 관례.
    if (!il && !hanja && v === 1 && g === 1) s = '';
    parts.push(s + B[g]);
  }
  return parts.join(spacing ? ' ' : '');
}

/** 계약서용 한 줄: 일금 오백만원정 (₩5,000,000) */
export function contractLine(n, opt = {}) {
  const word = toKorean(n, opt);
  return opt.hanja
    ? `金 ${word}圓整 (₩${n.toLocaleString('en-US')})`
    : `일금 ${word}원정 (₩${n.toLocaleString('en-US')})`;
}

export function withCommas(n) { return n.toLocaleString('en-US'); }
