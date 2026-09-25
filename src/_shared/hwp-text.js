/*
 * HWP·HWPX 텍스트 추출. 한글 프로그램 없이 브라우저 안에서만 읽는다.
 *
 * 본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
 * (참고: 한글과컴퓨터 「한글 문서 파일 구조 5.0」 revision 1.3, 2018-11-08 공개.
 *  공개 문서의 저작권 조항에 따라 위 문구를 사용자 화면·도움말·소스에 함께 적는다.)
 *
 * HWP 5.x: OLE(CFB) 복합 파일 → FileHeader(서명·속성) → BodyText/Section0..N 스트림
 *          (압축 속성이면 raw deflate) → 레코드 → HWPTAG_PARA_TEXT 의 UTF-16LE 글자.
 * HWPX:    zip → Contents/section0.xml … → <hp:p> 문단 안의 <hp:t> 글자.
 */

export const HWP_NOTICE = '본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.';

export const HWP_SIGNATURE = 'HWP Document File';
export const HWPTAG_BEGIN = 0x10;
export const HWPTAG_PARA_HEADER = HWPTAG_BEGIN + 50; // 66
export const HWPTAG_PARA_TEXT = HWPTAG_BEGIN + 51; // 67

/* FileHeader 속성(DWORD) 비트 */
export const FLAG = { COMPRESSED: 1 << 0, PASSWORD: 1 << 1, DISTRIBUTION: 1 << 2, DRM: 1 << 4, CERT_ENCRYPTED: 1 << 8, CERT_DRM: 1 << 10 };

/*
 * 문단 글자 안의 제어 문자(코드 0~31). 공개 문서 "제어 문자" 표 기준.
 * char     : 글자 1개(WCHAR 1개) 크기 — 0, 10(줄 바꿈), 13(문단 끝), 24(하이픈), 25~29(예약), 30(묶음 빈칸), 31(고정폭 빈칸)
 * inline   : WCHAR 8개(코드 + 12바이트 정보 + 같은 코드) — 4(필드 끝), 5~7(예약), 8(title mark), 9(탭), 19·20(예약)
 * extended : WCHAR 8개(코드 + 컨트롤 포인터 등 12바이트 + 같은 코드) — 1(예약), 2(구역·단 정의), 3(필드 시작),
 *            11(그리기 개체·표), 12(예약), 14(예약), 15(숨은 설명), 16(머리말·꼬리말), 17(각주·미주),
 *            18(자동 번호), 21(페이지 컨트롤), 22(책갈피·찾아보기 표식), 23(덧말·글자 겹침)
 * 표·글상자 안의 글자는 extended 컨트롤(11) 뒤에 이어지는 별도 문단 레코드로 들어 있다.
 */
export const CHAR_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
export const INLINE_CONTROLS = new Set([4, 5, 6, 7, 8, 9, 19, 20]);
export const EXTENDED_CONTROLS = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

/** 레코드 헤더 32비트: Tag ID 10비트 · Level 10비트 · Size 12비트. Size 가 0xFFF 면 뒤 4바이트가 실제 크기 */
export function* readRecords(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  while (off + 4 <= u8.length) {
    const h = dv.getUint32(off, true); off += 4;
    const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) { if (off + 4 > u8.length) return; size = dv.getUint32(off, true); off += 4; }
    const end = Math.min(off + size, u8.length);
    yield { tag, level, size, data: u8.subarray(off, end) };
    off += size;
  }
}

/** 레코드 헤더 만들기(테스트·검증용) */
export function recordHeader(tag, level, size) {
  if (size >= 0xfff) {
    const b = new Uint8Array(8); const dv = new DataView(b.buffer);
    dv.setUint32(0, ((0xfff << 20) | (level << 10) | tag) >>> 0, true); dv.setUint32(4, size, true);
    return b;
  }
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, ((size << 20) | (level << 10) | tag) >>> 0, true);
  return b;
}

/** PARA_TEXT 레코드 본문(UTF-16LE) → 글자. 제어 문자는 위 표에 따라 건너뛰고, 탭·줄 바꿈·빈칸만 글자로 바꾼다 */
export function paraText(data) {
  const n = data.length >> 1;
  const out = [];
  for (let i = 0; i < n;) {
    const c = data[2 * i] | (data[2 * i + 1] << 8);
    if (c >= 32) { out.push(c); i++; continue; }
    if (CHAR_CONTROLS.has(c)) {
      if (c === 10) out.push(10);
      else if (c === 24) out.push(0x2d); // 하이픈
      else if (c === 30 || c === 31) out.push(0x20);
      i++; // 0·13·25~29 는 글자로 내보내지 않는다
    } else {
      if (c === 9) out.push(9); // 탭(inline)
      i += 8; // inline·extended 는 WCHAR 8개
    }
  }
  let s = '';
  for (let k = 0; k < out.length; k += 8192) s += String.fromCharCode.apply(null, out.slice(k, k + 8192));
  return s;
}

/** 구역 스트림(압축 해제된 레코드들) → 문단 줄 배열. 글자 없는 문단은 빈 줄 */
export function sectionLines(u8) {
  const lines = [];
  let cur = -1;
  for (const r of readRecords(u8)) {
    if (r.tag === HWPTAG_PARA_HEADER) { lines.push(''); cur = lines.length - 1; }
    else if (r.tag === HWPTAG_PARA_TEXT) {
      const t = paraText(r.data);
      if (cur < 0) { lines.push(t); cur = lines.length - 1; } else lines[cur] += t;
    }
  }
  return lines;
}

/** FileHeader 스트림(256바이트) 읽기 */
export function parseFileHeader(u8) {
  const sig = String.fromCharCode(...u8.subarray(0, 32)).replace(/\0+$/, '');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ver = u8.length >= 36 ? dv.getUint32(32, true) : 0;
  const flags = u8.length >= 40 ? dv.getUint32(36, true) : 0;
  return {
    ok: sig.startsWith(HWP_SIGNATURE),
    version: `${ver >>> 24}.${(ver >>> 16) & 0xff}.${(ver >>> 8) & 0xff}.${ver & 0xff}`,
    flags,
    compressed: !!(flags & FLAG.COMPRESSED),
    encrypted: !!(flags & (FLAG.PASSWORD | FLAG.CERT_ENCRYPTED)),
    distribution: !!(flags & FLAG.DISTRIBUTION),
    drm: !!(flags & (FLAG.DRM | FLAG.CERT_DRM)),
  };
}

/** 오류 코드 → 화면 문구 */
export const ERRORS = {
  ENCRYPTED: '암호가 걸린 문서는 열 수 없습니다. 한글에서 암호를 해제하고 저장한 뒤 다시 넣어 주세요.',
  DISTRIBUTION: '배포용 문서는 지원하지 않습니다. 배포용 문서는 본문이 암호화되어 있어 글자를 꺼낼 수 없습니다.',
  DRM: '보안(DRM)이 걸린 문서는 열 수 없습니다.',
  OLD: '한글 97 이전(3.x) 형식은 지원하지 않습니다. 한글에서 .hwp(5.0) 또는 .hwpx로 다시 저장해 주세요.',
  NOT_HWP: 'HWP·HWPX 문서가 아닌 것 같습니다.',
  BROKEN: '문서를 읽는 중 문제가 생겼습니다. 파일이 손상되었을 수 있습니다.',
  NO_BODY: '본문 구역을 찾지 못했습니다.',
};

export class HwpError extends Error { constructor(code) { super(ERRORS[code] || code); this.code = code; } }

const lazy = {};
const load = (name) => (lazy[name] ||= name === 'cfb' ? import('cfb').then((m) => m.default || m) : import('fflate'));

/** HWP 5.x 바이트 → { format, version, sections, lines } */
export async function extractHwp(bytes) {
  const CFB = await load('cfb');
  const { inflateSync, unzlibSync } = await load('fflate');
  let doc;
  try { doc = CFB.read(bytes, { type: 'array' }); } catch { throw new HwpError('BROKEN'); }
  const entries = doc.FullPaths.map((p, i) => ({ path: p, entry: doc.FileIndex[i] }));
  const fh = entries.find((e) => /\/FileHeader$/.test(e.path));
  if (!fh) throw new HwpError('NOT_HWP');
  const header = parseFileHeader(new Uint8Array(fh.entry.content));
  if (!header.ok) throw new HwpError('NOT_HWP');
  if (header.encrypted) throw new HwpError('ENCRYPTED');
  if (header.drm) throw new HwpError('DRM');
  if (header.distribution) throw new HwpError('DISTRIBUTION');
  const sections = entries
    .map((e) => ({ ...e, m: e.path.match(/\/BodyText\/Section(\d+)$/) }))
    .filter((e) => e.m && e.entry.type === 2)
    .sort((a, b) => a.m[1] - b.m[1]);
  if (!sections.length) throw new HwpError('NO_BODY');
  const out = [];
  for (const s of sections) {
    let data = new Uint8Array(s.entry.content);
    if (header.compressed) {
      try { data = inflateSync(data); } catch {
        try { data = unzlibSync(data); } catch { throw new HwpError('BROKEN'); } // zlib 머리가 붙은 드문 경우
      }
    }
    out.push(sectionLines(data));
  }
  return { format: 'HWP', version: header.version, sections: out.length, lines: out };
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e] ?? m;
  });
}

const XML_TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;

/** HWPX 구역 XML → 문단 줄 배열. <hp:p> 하나가 한 줄, 글자는 <hp:t> 안에서만 모은다 */
export function hwpxSectionLines(xml) {
  const lines = [];
  const stack = [];
  let inT = 0;
  const add = (s) => { if (inT > 0 && stack.length) lines[stack[stack.length - 1]] += s; };
  XML_TOKEN.lastIndex = 0;
  for (let m; (m = XML_TOKEN.exec(xml));) {
    if (m[1] != null) { add(m[1]); continue; }
    if (m[6] != null) { add(decodeEntities(m[6])); continue; }
    if (!m[3]) continue;
    const close = m[2] === '/', self = m[5] === '/';
    const local = m[3].slice(m[3].indexOf(':') + 1);
    if (local === 'p') {
      if (close) stack.pop();
      else if (self) lines.push('');
      else { lines.push(''); stack.push(lines.length - 1); }
    } else if (local === 't') {
      if (close) inT = Math.max(0, inT - 1); else if (!self) inT++;
    } else if (!close && inT > 0) {
      if (local === 'tab') add('\t');
      else if (local === 'lineBreak') add('\n');
      else if (local === 'nbSpace' || local === 'fwSpace') add(' ');
      else if (local === 'hyphen') add('-');
    }
  }
  return lines;
}

/** HWPX 바이트 → { format, sections, lines } */
export async function extractHwpx(bytes) {
  const { unzipSync, strFromU8 } = await load('fflate');
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => /^Contents\/section\d+\.xml$/i.test(f.name) || f.name === 'META-INF/manifest.xml' || f.name === 'mimetype' });
  } catch { throw new HwpError('BROKEN'); }
  const manifest = files['META-INF/manifest.xml'] ? strFromU8(files['META-INF/manifest.xml']) : '';
  if (/encryption-data/i.test(manifest)) throw new HwpError('ENCRYPTED');
  const names = Object.keys(files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => a.match(/(\d+)\.xml$/i)[1] - b.match(/(\d+)\.xml$/i)[1]);
  if (!names.length) throw new HwpError(files.mimetype ? 'NO_BODY' : 'NOT_HWP');
  return { format: 'HWPX', version: '', sections: names.length, lines: names.map((n) => hwpxSectionLines(strFromU8(files[n]))) };
}

/** 파일 종류를 앞 바이트로 판별해 알맞은 추출기로 */
export async function extractText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) return extractHwp(u8);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return extractHwpx(u8);
  const head = String.fromCharCode(...u8.subarray(0, 32));
  if (head.startsWith('HWP Document File V')) throw new HwpError('OLD');
  throw new HwpError('NOT_HWP');
}

/** 줄 배열 → 한 덩어리 글. collapse=true 면 빈 줄이 여러 개 이어질 때 하나로 줄이고 줄 끝 공백을 지운다 */
export function joinText(sectionsLines, { collapse = true } = {}) {
  let text = sectionsLines.map((lines) => lines.join('\n')).join('\n\n');
  text = text.replace(/\r\n?/g, '\n');
  if (collapse) text = text.replace(/[ \t ]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  return text.replace(/^\n+|\s+$/g, '');
}
