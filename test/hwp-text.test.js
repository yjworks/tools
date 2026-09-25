import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, deflateSync } from 'fflate';
import CFB from 'cfb';
import {
  readRecords, recordHeader, paraText, sectionLines, parseFileHeader, hwpxSectionLines, extractText,
  joinText, decodeEntities, HWPTAG_PARA_HEADER, HWPTAG_PARA_TEXT, HWP_NOTICE,
} from '../src/_shared/hwp-text.js';

/* ---- 합성 HWP 만들기 도우미 ---- */
const u16 = (codes) => { const b = new Uint8Array(codes.length * 2); codes.forEach((c, i) => { b[2 * i] = c & 0xff; b[2 * i + 1] = c >> 8; }); return b; };
const str = (s) => [...s].flatMap((ch) => { const cp = ch.codePointAt(0); return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]; });
/** inline·extended 컨트롤: 코드 + 6 WCHAR 정보 + 코드 = 8 WCHAR. 정보 칸에는 일부러 글자처럼 보이는 값을 넣는다 */
const ctrl = (code, info = [0x6274, 0x206c, 0x41, 0x42, 0x43, 0x44]) => [code, ...info, code];
const concat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const rec = (tag, level, data) => concat(recordHeader(tag, level, data.length), data);
const para = (codes, level = 0) => concat(rec(HWPTAG_PARA_HEADER, level, new Uint8Array(22)), rec(HWPTAG_PARA_TEXT, level + 1, u16(codes)), rec(HWPTAG_PARA_TEXT + 1, level + 1, new Uint8Array(8)));

function fileHeader(flags = 1, sig = 'HWP Document File') {
  const b = new Uint8Array(256);
  b.set(strToU8(sig));
  const dv = new DataView(b.buffer);
  dv.setUint32(32, 0x05000300, true); dv.setUint32(36, flags, true);
  return b;
}
function makeHwp(sections, flags = 1) {
  const doc = CFB.utils.cfb_new();
  CFB.utils.cfb_add(doc, '/FileHeader', fileHeader(flags));
  CFB.utils.cfb_add(doc, '/DocInfo', new Uint8Array(16));
  sections.forEach((s, i) => CFB.utils.cfb_add(doc, `/BodyText/Section${i}`, flags & 1 ? deflateSync(s) : s));
  return new Uint8Array(CFB.write(doc, { type: 'array' }));
}

describe('HWP 레코드', () => {
  it('헤더 비트 배치: Tag 10 · Level 10 · Size 12', () => {
    const h = recordHeader(67, 1, 10);
    expect(new DataView(h.buffer).getUint32(0, true)).toBe((10 << 20) | (1 << 10) | 67);
    const [r] = readRecords(concat(h, new Uint8Array(10)));
    expect(r).toMatchObject({ tag: 67, level: 1, size: 10 });
  });
  it('크기 4095 이상은 0xFFF 뒤 4바이트로', () => {
    const big = new Uint8Array(5000).fill(7);
    const bytes = concat(recordHeader(67, 2, big.length), big, recordHeader(66, 0, 2), new Uint8Array(2));
    expect(bytes.length).toBe(8 + 5000 + 4 + 2);
    const rs = [...readRecords(bytes)];
    expect(rs.map((r) => [r.tag, r.level, r.size])).toEqual([[67, 2, 5000], [66, 0, 2]]);
    expect(rs[0].data.length).toBe(5000);
  });
  it('태그 번호: PARA_HEADER 66, PARA_TEXT 67', () => { expect(HWPTAG_PARA_HEADER).toBe(66); expect(HWPTAG_PARA_TEXT).toBe(67); });
});

describe('PARA_TEXT 제어 문자', () => {
  it('extended(구역 정의 2, 표 11)는 8 WCHAR 통째로 건너뜀', () => {
    expect(paraText(u16([...ctrl(2), ...ctrl(11), ...str('안녕'), 13]))).toBe('안녕');
  });
  it('inline 탭(9)은 탭 글자로, 필드 끝(4)은 버림', () => {
    expect(paraText(u16([...str('이름'), ...ctrl(9), ...str('홍길동'), ...ctrl(4), 13]))).toBe('이름\t홍길동');
  });
  it('char 컨트롤은 1 WCHAR: 줄 바꿈 10, 하이픈 24, 묶음 빈칸 30, 고정폭 빈칸 31', () => {
    expect(paraText(u16([...str('가'), 10, ...str('나'), 24, ...str('다'), 30, ...str('라'), 31, ...str('마'), 13]))).toBe('가\n나-다 라 마');
  });
  it('필드 시작(3)·각주(17)·머리말(16)·책갈피(22)·덧말(23)·자동번호(18)', () => {
    const codes = [...ctrl(3), ...str('A'), ...ctrl(17), ...str('B'), ...ctrl(16), ...ctrl(22), ...ctrl(23), ...ctrl(18), ...str('C'), 13];
    expect(paraText(u16(codes))).toBe('ABC');
  });
  it('예약 inline 5~8, 19, 20 도 8 WCHAR', () => {
    const codes = [5, 6, 7, 8, 19, 20].flatMap((c) => [...ctrl(c), ...str(String(c % 10))]);
    expect(paraText(u16(codes))).toBe('567890');
  });
  it('보조 평면 글자(서로게이트 쌍)·영문·숫자', () => {
    expect(paraText(u16([...str('Hi 2026 😀 끝'), 13]))).toBe('Hi 2026 😀 끝');
  });
});

describe('HWP 구역 → 문단', () => {
  it('문단마다 한 줄, 빈 문단은 빈 줄, 표 칸 글자도 포함', () => {
    const section = concat(
      para([...ctrl(2), ...ctrl(2), ...str('제목'), 13]),
      rec(HWPTAG_PARA_HEADER, 0, new Uint8Array(22)), // 글자 없는 문단
      para([...str('표 앞 '), ...ctrl(11), ...str(' 표 뒤'), 13]),
      para([...str('칸1'), 13], 2),
      para([...str('칸2'), 13], 2),
      para([...str('끝'), 13]),
    );
    expect(sectionLines(section)).toEqual(['제목', '', '표 앞  표 뒤', '칸1', '칸2', '끝']);
  });
});

describe('FileHeader', () => {
  it('서명·버전·속성 비트', () => {
    const h = parseFileHeader(fileHeader(0b111));
    expect(h).toMatchObject({ ok: true, version: '5.0.3.0', compressed: true, encrypted: true, distribution: true, drm: false });
    expect(parseFileHeader(fileHeader(1, 'Not a HWP')).ok).toBe(false);
    expect(parseFileHeader(fileHeader(1 << 4)).drm).toBe(true);
  });
});

describe('HWP 5.x 파일 전체', () => {
  const s0 = concat(para([...ctrl(2), ...str('첫 구역'), 13]), para([...str('둘째 줄'), 13]));
  const s1 = concat(para([...str('두 번째 구역'), 13]));
  it('압축된 문서', async () => {
    const r = await extractText(makeHwp([s0, s1], 1));
    expect(r).toMatchObject({ format: 'HWP', sections: 2, version: '5.0.3.0' });
    expect(joinText(r.lines)).toBe('첫 구역\n둘째 줄\n\n두 번째 구역');
  });
  it('압축하지 않은 문서', async () => {
    const r = await extractText(makeHwp([s0], 0));
    expect(r.lines).toEqual([['첫 구역', '둘째 줄']]);
  });
  it('구역 10개 이상도 번호 순서대로', async () => {
    const secs = Array.from({ length: 12 }, (_, i) => para([...str(`S${i}`), 13]));
    const r = await extractText(makeHwp(secs, 1));
    expect(r.lines.map((l) => l[0])).toEqual(secs.map((_, i) => `S${i}`));
  });
  it('암호 문서·배포용 문서·옛 형식은 알맞은 안내', async () => {
    await expect(extractText(makeHwp([s0], 1 | 2))).rejects.toMatchObject({ code: 'ENCRYPTED', message: expect.stringContaining('암호가 걸린 문서는 열 수 없습니다') });
    await expect(extractText(makeHwp([s0], 1 | 4))).rejects.toMatchObject({ code: 'DISTRIBUTION', message: expect.stringContaining('배포용 문서는 지원하지 않습니다') });
    await expect(extractText(strToU8('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05'))).rejects.toMatchObject({ code: 'OLD' });
    await expect(extractText(strToU8('hello'))).rejects.toMatchObject({ code: 'NOT_HWP' });
  });
});

describe('HWPX', () => {
  const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
  const sec0 = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>`
    + '<hp:p id="1"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>안녕하세요 &amp; &lt;반갑&gt; &#x1F600;</hp:t></hp:run></hp:p>'
    + '<hp:p id="2"><hp:run><hp:t>이름<hp:tab width="4000"/>홍길동<hp:lineBreak/>둘째 줄</hp:t></hp:run></hp:p>'
    + '<hp:p id="3"><hp:run/></hp:p>'
    + '<hp:p id="4"><hp:run><hp:t>표 앞</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>칸1</hp:t></hp:run></hp:p></hp:subList></hp:tc>'
    + '<hp:tc><hp:subList><hp:p><hp:run><hp:t>칸2</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
    + '<hp:p><hp:run><hp:t/></hp:run><hp:run><hp:t>나<hp:nbSpace/>란<hp:hyphen/>히</hp:t></hp:run></hp:p></hs:sec>';
  const sec1 = `<hs:sec ${NS}><hp:p><hp:run><hp:t><![CDATA[a<b]]></hp:t></hp:run></hp:p></hs:sec>`;

  it('구역 XML → 문단 줄', () => {
    expect(hwpxSectionLines(sec0)).toEqual(['안녕하세요 & <반갑> 😀', '이름\t홍길동\n둘째 줄', '', '표 앞', '칸1', '칸2', '나 란-히']);
  });
  it('zip 전체: 구역 번호 순서, 구역 수', async () => {
    const zip = zipSync({
      mimetype: strToU8('application/hwp+zip'),
      'Contents/section10.xml': strToU8(sec1.replace('a<b', '열')),
      'Contents/section1.xml': strToU8(sec1),
      'Contents/section0.xml': strToU8(sec0),
      'Contents/header.xml': strToU8('<hh:head><hp:t>머리 정보는 빼야 함</hp:t></hh:head>'),
    });
    const r = await extractText(zip);
    expect(r).toMatchObject({ format: 'HWPX', sections: 3 });
    expect(r.lines[1]).toEqual(['a<b']);
    expect(r.lines[2]).toEqual(['열']);
    expect(joinText(r.lines)).not.toContain('머리 정보');
  });
  it('암호화된 HWPX 는 안내', async () => {
    const zip = zipSync({ mimetype: strToU8('application/hwp+zip'), 'META-INF/manifest.xml': strToU8('<odf:manifest><odf:file-entry><odf:encryption-data/></odf:file-entry></odf:manifest>'), 'Contents/section0.xml': strToU8(sec1) });
    await expect(extractText(zip)).rejects.toMatchObject({ code: 'ENCRYPTED' });
  });
  it('엔티티', () => expect(decodeEntities('&quot;A&apos; &#65;&#x42; &unknown;')).toBe('"A\' AB &unknown;'));
});

describe('글 합치기·고지문', () => {
  it('빈 줄 여러 개는 하나로, 줄 끝 공백 제거', () => {
    expect(joinText([['a  ', '', '', '', 'b'], ['c']])).toBe('a\n\nb\n\nc');
    expect(joinText([['a', '', '', 'b']], { collapse: false })).toBe('a\n\n\nb');
  });
  it('공개 문서 고지문', () => expect(HWP_NOTICE).toBe('본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.'));
});
