import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { readJpegExif } from '../src/_shared/exif.js';
import {
  sniffHeif, looksHeic, parseHeif, primaryOnly, HIDE_TYPE, editExif, exifSegment, iccSegments, insertJpegSegments,
  crc32, pngChunk, iccpData, insertPngChunks, metaPlan, outputMeta, outputName, summarize, canvasLimit, fitPixels,
  IOS_CANVAS_PIXELS, concat,
} from '../src/_shared/heic-to-jpg.js';

/* ───── 시험용 바이트 만들기 ───── */
const enc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const u16 = (n) => Uint8Array.of(n >> 8, n & 255);
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), enc(type), body]); };
const full = (type, v, flags, ...parts) => box(type, Uint8Array.of(v, 0, 0, flags), ...parts);
const infe = (id, type, flags = 0) => full('infe', 2, flags, u16(id), u16(0), enc(type), Uint8Array.of(0));

/** 작은 리틀엔디언 TIFF: IFD0(Make, Orientation, GPS 포인터) → IFD1(미리보기) , GPS IFD(북위 37°33'59.4", 동경 126°58'40.7") */
function makeTiff({ orientation = 6 } = {}) {
  const b = new Uint8Array(216), dv = new DataView(b.buffer);
  b.set([0x49, 0x49, 0x2a, 0]); dv.setUint32(4, 8, true);
  // IFD0 @8: 3 entries → 8 + 2 + 36 + 4 = 50
  dv.setUint16(8, 3, true);
  const ent = (p, tag, type, count, val) => { dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); dv.setUint32(p + 8, val, true); };
  ent(10, 0x010f, 2, 6, 120);          // Make → 120
  ent(22, 0x0112, 3, 1, orientation);  // Orientation
  ent(34, 0x8825, 4, 1, 60);           // GPS IFD → 60
  dv.setUint32(46, 130, true);         // 다음 IFD(IFD1) → 130
  // GPS IFD @60: 4 entries → 60 + 2 + 48 + 4 = 114
  dv.setUint16(60, 4, true);
  ent(62, 1, 2, 2, 0x4e);              // 'N'
  ent(74, 2, 5, 3, 160);               // 위도 → 160 (24바이트)
  ent(86, 3, 2, 2, 0x45);              // 'E'
  ent(98, 4, 5, 3, 184);               // 경도 → 184 (24바이트, 끝 208)
  b.set(enc('Apple\0'), 120);
  // IFD1 @130: 2 entries (미리보기 위치 208, 길이 8) → 130 + 2 + 24 + 4 = 160
  dv.setUint16(130, 2, true);
  ent(132, 0x0201, 4, 1, 208);
  ent(144, 0x0202, 4, 1, 8);
  const rat = (p, vals) => vals.forEach(([n, d], i) => { dv.setUint32(p + i * 8, n, true); dv.setUint32(p + i * 8 + 4, d, true); });
  rat(160, [[37, 1], [33, 1], [594, 10]]);
  rat(184, [[126, 1], [58, 1], [407, 10]]);
  b.fill(0xab, 208, 216);               // 미리보기 바이트
  return b;
}
const jpegWith = (tiff) => concat([Uint8Array.of(0xff, 0xd8), exifSegment(tiff), Uint8Array.of(0xff, 0xd9)]).buffer;

/**
 * 시험용 HEIF: 사진 항목 1(hvc1, 800×600), 2(hvc1, 640×480, 대표·90° 회전·ICC), 3(Exif, 사진 2 설명),
 * 4(hvc1 미리보기 → 사진 2), 5(hvc1 미리보기 → 사진 1)
 */
function makeHeif({ primary = 2, icc = enc('FAKEICCPROFILE') } = {}) {
  const tiff = makeTiff();
  const exifData = concat([u32(0), tiff]);
  const ftyp = box('ftyp', enc('heic'), u32(0), enc('mif1'), enc('heic'));
  const hdlr = full('hdlr', 0, 0, u32(0), enc('pict'), new Uint8Array(12), Uint8Array.of(0));
  const pitm = full('pitm', 0, 0, u16(primary));
  const iinf = full('iinf', 0, 0, u16(5), infe(1, 'hvc1'), infe(2, 'hvc1'), infe(3, 'Exif'), infe(4, 'hvc1'), infe(5, 'hvc1'));
  const iref = full('iref', 0, 0,
    box('cdsc', u16(3), u16(1), u16(2)),
    box('thmb', u16(4), u16(1), u16(2)),
    box('thmb', u16(5), u16(1), u16(1)));
  const ispe = (w, hh) => full('ispe', 0, 0, u32(w), u32(hh));
  const ipco = box('ipco', ispe(800, 600), ispe(640, 480), box('irot', Uint8Array.of(1)), box('colr', enc('prof'), icc));
  // ipma: 항목 1 → [1], 항목 2 → [2,3,4]
  const ipma = full('ipma', 0, 0, u32(2), u16(1), Uint8Array.of(1, 0x81), u16(2), Uint8Array.of(3, 0x82, 3, 0x84));
  const iprp = box('iprp', ipco, ipma);
  // iloc: v0, offset 4 / length 4, base 0; Exif 만 실제 위치를 가리킨다(나중에 채움)
  const ilocFor = (off) => full('iloc', 0, 0, Uint8Array.of(0x44, 0x00), u16(1), u16(3), u16(0), u16(1), u32(off), u32(exifData.length));
  const metaFor = (off) => full('meta', 0, 0, hdlr, pitm, ilocFor(off), iinf, iref, iprp);
  const pre = ftyp.length + metaFor(0).length + 8;          // mdat 머리 8바이트 뒤가 Exif 시작
  return concat([ftyp, metaFor(pre), box('mdat', exifData)]);
}

describe('HEIF 알아보기', () => {
  it('ftyp 브랜드로 HEIC·AVIF 를 구분한다', () => {
    const heic = makeHeif();
    expect(sniffHeif(heic)).toBe('heic');
    expect(sniffHeif(concat([u32(20), enc('ftypavif'), u32(0), enc('avif')]))).toBe('avif');
    expect(sniffHeif(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe(null);
  });
  it('이름·MIME·바이트 중 하나로 HEIC 를 받아들인다', () => {
    expect(looksHeic('IMG_0001.HEIC', '')).toBe(true);
    expect(looksHeic('a.hif', '')).toBe(true);
    expect(looksHeic('photo', 'image/heif')).toBe(true);
    expect(looksHeic('photo.bin', '', makeHeif().subarray(0, 64))).toBe(true);
    expect(looksHeic('photo.jpg', 'image/jpeg', Uint8Array.of(0xff, 0xd8))).toBe(false);
  });
});

describe('parseHeif', () => {
  it('대표 사진, 사진 수, 크기·회전·ICC·EXIF 를 읽는다', () => {
    const r = parseHeif(makeHeif());
    expect(r.primaryId).toBe(2);
    expect(r.imageCount).toBe(2);                 // 미리보기(4,5)는 세지 않는다
    expect([r.width, r.height]).toEqual([640, 480]);
    expect(r.rotation).toBe(90);
    expect(new TextDecoder().decode(r.icc)).toBe('FAKEICCPROFILE');
    expect(r.exif.length).toBe(216);
    expect(readJpegExif(jpegWith(r.exif)).make).toBe('Apple');
  });
  it('대표가 1이면 1의 속성을 읽는다', () => {
    const r = parseHeif(makeHeif({ primary: 1 }));
    expect([r.primaryId, r.width, r.height, r.rotation, r.icc]).toEqual([1, 800, 600, 0, null]);
  });
  it('meta 가 없으면 오류', () => {
    expect(() => parseHeif(box('ftyp', enc('heic'), u32(0)))).toThrow('meta');
  });
});

describe('primaryOnly — 대표 사진만 남기기', () => {
  it('대표가 아닌 사진과 그 미리보기의 종류 이름만 바꾼다(길이 그대로)', () => {
    const src = makeHeif();
    const { bytes, hidden } = primaryOnly(src);
    expect(hidden).toBe(2);                       // 사진 1 + 사진 1의 미리보기 5
    expect(bytes.length).toBe(src.length);
    const r = parseHeif(bytes);
    const types = Object.fromEntries([...r.items.values()].map((it) => [it.id, it.type]));
    expect(types).toEqual({ 1: HIDE_TYPE, 2: 'hvc1', 3: 'Exif', 4: 'hvc1', 5: HIDE_TYPE });
    expect(r.imageCount).toBe(1);
    expect(src.filter((b, i) => b !== bytes[i]).length).toBe(8);   // 4글자 × 2곳만 바뀐다
  });
  it('사진이 하나뿐이면 원래 바이트를 그대로 돌려준다', () => {
    const one = makeHeif();
    const info = parseHeif(one);
    info.items.delete(1); info.items.delete(5);
    const { bytes, hidden } = primaryOnly(one, info);
    expect(hidden).toBe(0);
    expect(bytes).toBe(one);
  });
});

describe('editExif', () => {
  it('GPS 를 지우고 방향을 1로, 미리보기를 뗀다', () => {
    const src = makeTiff();
    const out = editExif(src, { dropGps: true, orientation: 1, dropThumbnail: true });
    const ex = readJpegExif(jpegWith(out));
    expect(ex.gps).toBe(null);
    expect(ex.orientation).toBe(1);
    expect(ex.make).toBe('Apple');
    const dv = new DataView(out.buffer);
    expect(dv.getUint16(8, true)).toBe(2);        // IFD0 항목 3 → 2
    expect(dv.getUint32(8 + 2 + 2 * 12, true)).toBe(0);   // 다음 IFD 없음
    expect(dv.getUint32(160, true)).toBe(0);      // 위도 37 이 0으로
    expect(dv.getUint32(184, true)).toBe(0);      // 경도 126 이 0으로
    expect([...out.subarray(208, 216)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);   // 미리보기 바이트
    expect(readJpegExif(jpegWith(src)).gps.lat).toBeCloseTo(37.5665, 4);    // 원본은 그대로
  });
  it('위치를 남기라고 하면 GPS 는 그대로 두고 방향만 바꾼다', () => {
    const ex = readJpegExif(jpegWith(editExif(makeTiff(), { dropGps: false, orientation: 1 })));
    expect(ex.orientation).toBe(1);
    expect(ex.gps.lat).toBeCloseTo(37.5665, 4);
    expect(ex.gps.lon).toBeCloseTo(126.9780, 4);
  });
  it('TIFF 가 아니면 null', () => {
    expect(editExif(enc('not a tiff at all'))).toBe(null);
  });
});

describe('JPEG 조각 끼우기', () => {
  const jfif = concat([Uint8Array.of(0xff, 0xd8), Uint8Array.of(0xff, 0xe0, 0, 16), enc('JFIF\0'), new Uint8Array(9),
    Uint8Array.of(0xff, 0xdb, 0, 4, 1, 2), Uint8Array.of(0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9)]);
  it('APP0 뒤에 APP1(EXIF)·APP2(ICC) 를 넣는다', () => {
    const out = insertJpegSegments(jfif, [exifSegment(makeTiff()), ...iccSegments(enc('ICCDATA'))]);
    expect([out[2], out[3]]).toEqual([0xff, 0xe0]);
    expect([out[20], out[21]]).toEqual([0xff, 0xe1]);
    expect(readJpegExif(out.buffer).make).toBe('Apple');
    expect(out.length).toBe(jfif.length + (4 + 6 + 216) + (4 + 12 + 2 + 7));
  });
  it('이미 있던 EXIF 는 바꿔 끼운다(두 번 넣어도 하나)', () => {
    const once = insertJpegSegments(jfif, [exifSegment(makeTiff())]);
    const twice = insertJpegSegments(once, [exifSegment(makeTiff())]);
    expect(twice.length).toBe(once.length);
  });
  it('EXIF 만 넣을 때는 브라우저가 넣은 ICC 를 남기고, ICC 를 넣을 때만 바꾼다', () => {
    const withIcc = insertJpegSegments(jfif, iccSegments(enc('SRGB')));
    const exifOnly = insertJpegSegments(withIcc, [exifSegment(makeTiff())]);
    expect(exifOnly.length).toBe(withIcc.length + 4 + 6 + 216);
    const iccAgain = insertJpegSegments(exifOnly, iccSegments(enc('P3P3P3')));
    expect(iccAgain.length).toBe(exifOnly.length + 2);          // 4바이트 → 6바이트 프로필로 바뀜
  });
  it('64KB 넘는 EXIF 는 조각을 만들지 않는다', () => {
    expect(exifSegment(new Uint8Array(65528))).toBe(null);
    expect(exifSegment(new Uint8Array(65527)).length).toBe(65537);
  });
  it('큰 ICC 는 65519바이트씩 나눈다', () => {
    const segs = iccSegments(new Uint8Array(140000));
    expect(segs.length).toBe(3);
    expect(segs.map((s) => [s[16], s[17]])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(segs[0].length).toBe(65537);
  });
});

describe('PNG 청크', () => {
  it('CRC32 가 표준 값과 같다', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc('IEND'))).toBe(0xae426082);
  });
  it('첫 IDAT 앞에 넣고 sRGB 는 뺀다', () => {
    const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const png = concat([sig, pngChunk('IHDR', new Uint8Array(13)), pngChunk('sRGB', Uint8Array.of(0)), pngChunk('IDAT', Uint8Array.of(1, 2, 3)), pngChunk('IEND', new Uint8Array())]);
    const icc = enc('ICCDATA'.repeat(20));
    const out = insertPngChunks(png, [pngChunk('iCCP', iccpData(icc)), pngChunk('eXIf', makeTiff())], ['sRGB']);
    const types = []; let p = 8;
    const dv = new DataView(out.buffer);
    while (p < out.length) { const len = dv.getUint32(p); types.push(String.fromCharCode(...out.subarray(p + 4, p + 8))); if (types.at(-1) === 'iCCP') {
      const d = out.subarray(p + 8, p + 8 + len);
      expect(new TextDecoder().decode(d.subarray(0, 11))).toBe('ICC Profile');
      expect(unzlibSync(d.subarray(13))).toEqual(icc);
    } p += 12 + len; }
    expect(types).toEqual(['IHDR', 'iCCP', 'eXIf', 'IDAT', 'IEND']);
  });
});

describe('메타데이터 계획', () => {
  it('세 가지 방식', () => {
    expect(metaPlan('nogps')).toEqual({ keepExif: true, dropGps: true });
    expect(metaPlan('none')).toEqual({ keepExif: false, dropGps: true });
    expect(metaPlan('all')).toEqual({ keepExif: true, dropGps: false });
    expect(metaPlan('???')).toEqual({ keepExif: true, dropGps: true });
  });
  it('기본값: 위치 없음·방향 1, libheif 로 풀었을 때만 ICC 를 붙인다', () => {
    const exif = makeTiff(), icc = enc('P3');
    const a = outputMeta({ mode: 'nogps', exif, icc, decoder: 'libheif' });
    const ex = readJpegExif(jpegWith(a.tiff));
    expect([ex.gps, ex.orientation, ex.make]).toEqual([null, 1, 'Apple']);
    expect(a.icc).toBe(icc);
    expect(outputMeta({ mode: 'nogps', exif, icc, decoder: 'native' }).icc).toBe(null);
    expect(outputMeta({ mode: 'none', exif, icc, decoder: 'native' }).tiff).toBe(null);
    expect(readJpegExif(jpegWith(outputMeta({ mode: 'all', exif, icc: null, decoder: 'native' }).tiff)).gps.lat).toBeCloseTo(37.5665, 4);
  });
  it('읽지 못하는 EXIF 는 빼고 이유를 남긴다', () => {
    expect(outputMeta({ mode: 'all', exif: enc('garbage!'), icc: null, decoder: 'native' })).toEqual({ tiff: null, icc: null, exifNote: 'EXIF 구조를 읽지 못해 뺐습니다' });
  });
});

describe('이름·합계·크기 한도', () => {
  it('확장자를 바꾸고 겹치면 번호를 붙인다(대소문자 무시)', () => {
    const taken = new Set();
    expect(outputName('IMG_0001.HEIC', 'jpg', taken)).toBe('IMG_0001.jpg');
    expect(outputName('IMG_0001.heic', 'jpg', taken)).toBe('IMG_0001-2.jpg');
    expect(outputName('img_0001.heif', 'jpg', taken)).toBe('img_0001-3.jpg');
    expect(outputName('여행/사진:1.heic', 'png', taken)).toBe('여행_사진_1.png');
    expect(outputName('.heic', 'jpg', taken)).toBe('photo.jpg');
  });
  it('끝난 것만 결과 합계에 넣는다', () => {
    const s = summarize([
      { size: 2_000_000, state: 'done', outSize: 3_000_000 },
      { size: 1_000_000, state: 'done', outSize: 1_500_000 },
      { size: 500_000, state: 'error' },
      { size: 700_000, state: 'wait' },
    ]);
    expect(s).toEqual({ count: 4, done: 2, failed: 1, before: 4_200_000, beforeDone: 3_000_000, after: 4_500_000, ratio: 1.5 });
  });
  it('iOS 사파리만 캔버스 한도를 1,677만 화소로 본다', () => {
    expect(canvasLimit({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' })).toBe(IOS_CANVAS_PIXELS);
    expect(canvasLimit({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', touchPoints: 5 })).toBe(16_777_216);
    expect(canvasLimit({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', touchPoints: 0 })).toBe(268_435_456);
    expect(canvasLimit({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0' })).toBe(268_435_456);
  });
  it('4800만 화소(8064×6048)를 한도 안으로 비율 유지해 줄인다', () => {
    const r = fitPixels(8064, 6048, IOS_CANVAS_PIXELS);
    expect(r).toEqual({ width: 4729, height: 3547, scaled: true });
    expect(r.width * r.height).toBeLessThanOrEqual(16_777_216);
    expect(fitPixels(4032, 3024, IOS_CANVAS_PIXELS)).toEqual({ width: 4032, height: 3024, scaled: false });
  });
});
