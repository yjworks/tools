import { describe, it, expect } from 'vitest';
import { engToKor, korToEng } from '../src/_shared/hangul.js';
import { toKorean, parseAmount, contractLine } from '../src/_shared/amount.js';
import { decode, encodeUtf8, parseCsv, guessSeparator } from '../src/_shared/csv.js';
import { meshStats, estimatePrint } from '../src/_shared/stl.js';
import { readJpegExif, stripJpeg, stripPng, pngMetaChunks } from '../src/_shared/exif.js';

describe('한영타', () => {
  const cases = [
    ['dkssud', '안녕'], ['gksrmf', '한글'], ['dkssudgktpdy', '안녕하세요'], ['ekfrl', '달기'], ['ekfrdl', '닭이'],
    ['ekfrdmf', '닭을'], ['dhkd', '왕'], ['dml', '의'], ['rkqt', '값'], ['rkqtdl', '값이'],
    ['Ekfrl', '딸기'], ['EkfRl', '딸끼'], ['Rkcl', '까치'], ['dkssud 123!', '안녕 123!'], ['ㅏ', 'ㅏ'], ['hk', 'ㅘ'],
    ['tkfkd', '사랑'], ['whgdms dkcla', '좋은 아침'], ['ghkdlxld', '화이팅'],
  ];
  for (const [en, ko] of cases) it(`${en} → ${ko}`, () => expect(engToKor(en)).toBe(ko));
  for (const w of ['안녕하세요', '닭을', '값이', '왕', '의사', '좋은 아침', '딸기', '뷁']) {
    it(`왕복 ${w}`, () => expect(engToKor(korToEng(w))).toBe(w));
  }
  it('한→영', () => { expect(korToEng('안녕')).toBe('dkssud'); expect(korToEng('닭')).toBe('ekfr'); expect(korToEng('뷁')).toBe('qnpfr'); });
});

describe('한글 금액', () => {
  const k = (n, o) => toKorean(BigInt(n), o);
  it('기본', () => {
    expect(k(5000000)).toBe('오백만');
    expect(k(1000000)).toBe('일백만');
    expect(k(1000000, { il: false })).toBe('백만');
    expect(k(10000, { il: false })).toBe('만');
    expect(k(10000)).toBe('일만');
    expect(k(110000, { il: false })).toBe('십일만');
    expect(k(123456789)).toBe('일억이천삼백사십오만육천칠백팔십구');
    expect(k(100000001, { il: false })).toBe('일억일');
    expect(k(0)).toBe('영');
    expect(k(1203000, { spacing: true })).toBe('일백이십만 삼천');
  });
  it('갖은자', () => { expect(k(5000000, { hanja: true })).toBe('伍佰萬'); expect(k(11, { hanja: true })).toBe('壹拾壹'); });
  it('계약서 줄', () => expect(contractLine(5000000n, { il: true })).toBe('일금 오백만원정 (₩5,000,000)'));
  it('입력 해석', () => { expect(parseAmount('5,000,000원')).toBe(5000000n); expect(parseAmount('abc')).toBe(null); expect(parseAmount('')).toBe(null); });
});

describe('CSV', () => {
  const cp949 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x41]); // "한글,A" (CP949)
  it('CP949 자동 판별', () => { const r = decode(cp949); expect(r.encoding).toBe('euc-kr'); expect(r.text).toBe('한글,A'); });
  it('UTF-8 BOM', () => { const r = decode(encodeUtf8('한글,A', true)); expect(r.encoding).toBe('utf-8'); expect(r.bom).toBe(true); expect(r.text).toBe('한글,A'); });
  it('UTF-8', () => expect(decode(encodeUtf8('가,나', false)).encoding).toBe('utf-8'));
  it('따옴표 파싱', () => expect(parseCsv('a,"b,c","d""e"\n1,2,3')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]));
  it('구분자', () => { expect(guessSeparator('a\tb\tc\n1\t2\t3')).toBe('\t'); expect(guessSeparator('a,b\n1,2')).toBe(','); });
});

describe('STL', () => {
  // 한 변 10mm 정육면체: 부피 1000mm³, 겉넓이 600mm²
  const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const v = (x, y, z) => [x * 10, y * 10, z * 10];
  const cube = new Float32Array([
    ...q(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), ...q(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...q(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), ...q(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
    ...q(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), ...q(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
  ]);
  it('정육면체', () => {
    const s = meshStats(cube);
    expect(s.volume).toBeCloseTo(1000, 3); expect(s.area).toBeCloseTo(600, 3); expect(s.size).toEqual([10, 10, 10]); expect(s.triangles).toBe(12);
  });
  it('무게 추정: 100% 채움이면 부피×밀도', () => {
    const e = estimatePrint({ volume: 1000, area: 600 }, { density: 1.24, infill: 1, wall: 0.8, pricePerKg: 20000 });
    expect(e.grams).toBeCloseTo(1.24, 5); expect(e.cost).toBeCloseTo(24.8, 5);
    expect(e.meters).toBeCloseTo(1.24 / (Math.PI * 0.0875 ** 2 * 100 * 1.24), 5);
  });
});

describe('사진 메타데이터', () => {
  // 최소 JPEG: SOI + APP1(EXIF, IFD0 에 Orientation=6) + APP2 + SOS + 데이터 + EOI
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
  const app1Body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, 0, app1Body.length + 2, ...app1Body];
  const app2 = [0xff, 0xe2, 0, 4, 1, 2];
  const jpeg = new Uint8Array([0xff, 0xd8, ...app1, ...app2, 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9]);
  it('Orientation 읽기', () => expect(readJpegExif(jpeg.buffer).orientation).toBe(6));
  it('APP1 만 빼고 나머지는 그대로', () => {
    const out = stripJpeg(jpeg.buffer);
    expect([...out]).toEqual([0xff, 0xd8, ...app2, 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9]);
    expect(readJpegExif(out.buffer)).toBe(null);
  });
  it('PNG tEXt 제거', () => {
    const chunk = (type, data) => { const t = [...type].map((c) => c.charCodeAt(0)); return [0, 0, 0, data.length, ...t, ...data, 0, 0, 0, 0]; };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [1, 2]), ...chunk('tEXt', [65, 0, 66]), ...chunk('IEND', [])]);
    expect(pngMetaChunks(png.buffer)).toEqual(['tEXt']);
    const out = stripPng(png.buffer);
    expect(pngMetaChunks(out.buffer)).toEqual([]);
    expect(out.length).toBe(png.length - 15);
  });
});

import { makeLadder, trace } from '../src/_shared/ladder.js';
describe('사다리', () => {
  it('도착점이 서로 겹치지 않는다(일대일)', () => {
    for (let t = 0; t < 200; t++) {
      const n = 2 + (t % 10);
      const r = makeLadder(n, 10, (k) => Math.floor(Math.random() * k));
      const ends = new Set(Array.from({ length: n }, (_, i) => trace(r, i).end));
      expect(ends.size).toBe(n);
      for (const row of r) for (let g = 1; g < row.length; g++) expect(row[g] && row[g - 1]).toBe(false);
      for (let g = 0; g < n - 1; g++) expect(r.some((row) => row[g])).toBe(true);
    }
  });
});
