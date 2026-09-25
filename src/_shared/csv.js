/* CSV 인코딩 판별·변환. 브라우저 기본 TextDecoder 만 쓴다(외부 라이브러리 없음).
   'euc-kr' 레이블은 WHATWG 표준에서 windows-949(CP949, 확장 완성형)로 해석되므로
   엑셀이 한국어 윈도우에서 저장한 "CSV(쉼표로 분리)" 파일을 그대로 읽는다. */

export const ENCODINGS = {
  auto: '자동 판별',
  'utf-8': 'UTF-8',
  'euc-kr': 'EUC-KR / CP949 (한국어 윈도우 엑셀)',
  'utf-16le': 'UTF-16 LE',
};

/** 바이트를 글자로. forced 가 'auto' 면 BOM → UTF-8(엄격) → CP949 순서로 시도한다. */
export function decode(bytes, forced = 'auto') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (forced !== 'auto') {
    const skip = forced === 'utf-8' && hasUtf8Bom(u8) ? 3 : forced === 'utf-16le' && u8[0] === 0xff && u8[1] === 0xfe ? 2 : 0;
    return { text: new TextDecoder(forced).decode(u8.subarray(skip)), encoding: forced, bom: skip > 0 };
  }
  if (hasUtf8Bom(u8)) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'utf-8', bom: true };
  if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'utf-16le', bom: true };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8', bom: false };
  } catch {
    return { text: new TextDecoder('euc-kr').decode(u8), encoding: 'euc-kr', bom: false };
  }
}

export function hasUtf8Bom(u8) { return u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf; }

/** 엑셀이 한글을 제대로 여는 UTF-8(BOM 포함) 바이트. bom=false 면 BOM 없이. */
export function encodeUtf8(text, bom = true) {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]); out.set(body, 3);
  return out;
}

/** 미리보기용 CSV 파서. 따옴표 안의 쉼표·줄바꿈·"" 를 처리한다. */
export function parseCsv(text, maxRows = Infinity, sep = ',') {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= maxRows) return rows;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 구분자 추정: 첫 몇 줄에서 쉼표·탭·세미콜론 중 가장 고르게 많은 것. */
export function guessSeparator(text) {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 5);
  let best = ',', bestScore = 0;
  for (const s of [',', '\t', ';']) {
    const counts = lines.map((l) => l.split(s).length - 1);
    const min = Math.min(...counts);
    if (min > bestScore) { best = s; bestScore = min; }
  }
  return best;
}

/** 깨진 글자(치환 문자 �)가 섞였는지 */
export function replacementCount(text) { return (text.match(/�/g) || []).length; }
