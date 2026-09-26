/* HEIC → JPG/PNG 변환의 순수 로직. 화면·캔버스와 떨어져 있어 테스트할 수 있다.
   - HEIF 컨테이너(ISOBMFF) 읽기: 대표 사진(pitm), 사진 개수, EXIF 항목, 색 프로필(ICC)
   - EXIF 고치기: 방향(Orientation)을 1로, 위치(GPS) 지우기, 작은 미리보기(IFD1) 떼기
   - JPEG 에 APP1(EXIF)·APP2(ICC) 끼우기, PNG 에 eXIf·iCCP 청크 끼우기
   - 저장 이름 만들기, 합계 계산
   사진의 픽셀은 여기서 다루지 않는다(해독은 브라우저 또는 libheif). */
import { zlibSync } from 'fflate';

/* ───────── HEIF 컨테이너 ───────── */

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2', 'avif', 'avis']);
const IMAGE_TYPES = new Set(['hvc1', 'grid', 'iovl', 'iden', 'av01', 'jpeg', 'unci', 'vvc1', 'tmap']);
const META_TYPES = new Set(['Exif', 'mime', 'uri ']);

const str4 = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

/** 파일 앞부분(ftyp 상자)만 보고 HEIF 계열인지 판단. 'heic' | 'avif' | null */
export function sniffHeif(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 16 || str4(u8, 4) !== 'ftyp') return null;
  const size = Math.min(readU32(u8, 0) || u8.length, u8.length);
  const brands = [str4(u8, 8)];
  for (let p = 16; p + 4 <= size; p += 4) brands.push(str4(u8, p));
  if (brands.some((b) => b === 'avif' || b === 'avis') && !brands.some((b) => b.startsWith('he'))) return 'avif';
  return brands.some((b) => HEIF_BRANDS.has(b)) ? 'heic' : null;
}

/** 이름·MIME·앞부분 바이트로 HEIC 로 다룰 파일인지 */
export function looksHeic(name = '', type = '', head = null) {
  if (/^image\/hei[cf](-sequence)?$/i.test(type)) return true;
  if (/\.(heic|heif|hif)$/i.test(name)) return true;
  return head ? sniffHeif(head) === 'heic' : false;
}

function readU32(u8, p) { return ((u8[p] << 24) >>> 0) + (u8[p + 1] << 16) + (u8[p + 2] << 8) + u8[p + 3]; }
function readU16(u8, p) { return (u8[p] << 8) | u8[p + 1]; }
function readN(u8, p, n) {
  if (n === 0) return 0;
  if (n === 2) return readU16(u8, p);
  if (n === 4) return readU32(u8, p);
  if (n === 8) return readU32(u8, p) * 2 ** 32 + readU32(u8, p + 4);
  throw new Error('bad field size');
}

/** start~end 사이 상자들 [{type, start(내용 시작), end}] */
function boxes(u8, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = readU32(u8, p), head = 8;
    const type = str4(u8, p + 4);
    if (size === 1) { size = readN(u8, p + 8, 8); head = 16; } else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type, start: p + head, end: p + size });
    p += size;
  }
  return out;
}

/**
 * HEIF 파일 구조 읽기. 실패하면 오류를 던진다.
 * 결과: { primaryId, imageCount, width, height, rotation, exif(TIFF 바이트|null), icc(Uint8Array|null) }
 * width·height 는 회전 전(ispe) 크기, rotation 은 반시계 방향 각도(irot).
 */
export function parseHeif(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const meta = boxes(u8, 0, u8.length).find((b) => b.type === 'meta');
  if (!meta) throw new Error('meta 상자가 없습니다');
  const kids = boxes(u8, meta.start + 4, meta.end);   // meta 는 FullBox(버전·플래그 4바이트)
  const get = (t) => kids.find((b) => b.type === t);

  let primaryId = null;
  const pitm = get('pitm');
  if (pitm) primaryId = u8[pitm.start] === 0 ? readU16(u8, pitm.start + 4) : readU32(u8, pitm.start + 4);

  // iinf: 항목 id·종류·숨김
  const items = new Map();
  const iinf = get('iinf');
  if (iinf) {
    const v = u8[iinf.start];
    const first = iinf.start + 4 + (v === 0 ? 2 : 4);
    for (const infe of boxes(u8, first, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const iv = u8[infe.start], flags = u8[infe.start + 3];
      if (iv < 2) continue;                              // 옛 형식(v0·v1)은 사진 파일에 쓰이지 않는다
      let p = infe.start + 4;
      const id = iv === 2 ? readU16(u8, p) : readU32(u8, p);
      p += (iv === 2 ? 2 : 4) + 2;                        // item_protection_index
      items.set(id, { id, type: str4(u8, p), typeAt: p, hidden: !!(flags & 1) });
    }
  }

  // iloc: 항목 데이터 위치
  const loc = new Map();
  const iloc = get('iloc');
  if (iloc) {
    const v = u8[iloc.start];
    let p = iloc.start + 4;
    const offSize = u8[p] >> 4, lenSize = u8[p] & 15, baseSize = u8[p + 1] >> 4, idxSize = v ? u8[p + 1] & 15 : 0;
    p += 2;
    const count = v < 2 ? readU16(u8, p) : readU32(u8, p); p += v < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const id = v < 2 ? readU16(u8, p) : readU32(u8, p); p += v < 2 ? 2 : 4;
      let method = 0;
      if (v === 1 || v === 2) { method = readU16(u8, p) & 15; p += 2; }
      p += 2;                                              // data_reference_index
      const base = readN(u8, p, baseSize); p += baseSize;
      const n = readU16(u8, p); p += 2;
      const extents = [];
      for (let e = 0; e < n; e++) {
        p += idxSize;
        const off = readN(u8, p, offSize); p += offSize;
        const len = readN(u8, p, lenSize); p += lenSize;
        extents.push([base + off, len]);
      }
      loc.set(id, { method, extents });
    }
  }
  const idat = get('idat');
  const itemData = (id) => {
    const l = loc.get(id);
    if (!l || l.method === 2) return null;
    const origin = l.method === 1 ? (idat ? idat.start : null) : 0;
    if (origin == null) return null;
    const parts = l.extents.map(([off, len]) => {
      const s = origin + off, e = len ? s + len : (l.method === 1 ? idat.end : u8.length);
      if (s < 0 || e > u8.length || s > e) throw new Error('항목 위치가 파일 밖입니다');
      return u8.subarray(s, e);
    });
    return parts.length === 1 ? parts[0] : concat(parts);
  };

  // iref: 항목 사이 관계
  const refs = [];
  const iref = get('iref');
  if (iref) {
    const wide = u8[iref.start] !== 0, w = wide ? 4 : 2, rd = wide ? readU32 : readU16;
    for (const r of boxes(u8, iref.start + 4, iref.end)) {
      let p = r.start;
      const from = rd(u8, p); p += w;
      const n = readU16(u8, p); p += 2;
      const to = [];
      for (let i = 0; i < n && p + w <= r.end; i++, p += w) to.push(rd(u8, p));
      refs.push({ type: r.type, from, to });
    }
  }

  // 최상위 사진 = 사진 항목 중 타일(dimg 대상)·미리보기(thmb)·보조(auxl: 깊이·알파) 가 아닌 것
  const notTop = new Set();
  for (const r of refs) {
    if (r.type === 'dimg') r.to.forEach((id) => notTop.add(id));
    if (r.type === 'thmb' || r.type === 'auxl') notTop.add(r.from);
  }
  // tmap(HDR 게인맵 합성)은 따로 세지 않는다. 대표 사진은 다른 항목이 가리켜도 늘 최상위로 본다.
  const top = [...items.values()].filter((it) => IMAGE_TYPES.has(it.type) && it.type !== 'tmap' && (it.id === primaryId || (!notTop.has(it.id) && !it.hidden)));
  if (primaryId == null && top.length) primaryId = top[0].id;

  // iprp: 대표 사진의 속성(크기·회전·색 프로필)
  let width = 0, height = 0, rotation = 0, icc = null;
  const iprp = get('iprp');
  if (iprp && primaryId != null) {
    const pk = boxes(u8, iprp.start, iprp.end);
    const ipco = pk.find((b) => b.type === 'ipco');
    const props = ipco ? boxes(u8, ipco.start, ipco.end) : [];
    for (const ipma of pk.filter((b) => b.type === 'ipma')) {
      const v = u8[ipma.start], flags = u8[ipma.start + 3];
      let p = ipma.start + 4;
      const n = readU32(u8, p); p += 4;
      for (let i = 0; i < n; i++) {
        const id = v < 1 ? readU16(u8, p) : readU32(u8, p); p += v < 1 ? 2 : 4;
        const cnt = u8[p++];
        for (let k = 0; k < cnt; k++) {
          const idx = flags & 1 ? readU16(u8, p) & 0x7fff : u8[p] & 0x7f;
          p += flags & 1 ? 2 : 1;
          if (id !== primaryId || !idx || !props[idx - 1]) continue;
          const pr = props[idx - 1];
          if (pr.type === 'ispe') { width = readU32(u8, pr.start + 4); height = readU32(u8, pr.start + 8); }
          else if (pr.type === 'irot') rotation = (u8[pr.start] & 3) * 90;
          else if (pr.type === 'colr' && !icc) {
            const ct = str4(u8, pr.start);
            if (ct === 'prof' || ct === 'rICC') icc = u8.slice(pr.start + 4, pr.end);
          }
        }
      }
    }
  }

  // EXIF: 대표 사진을 가리키는(cdsc) Exif 항목, 없으면 첫 Exif 항목
  let exif = null;
  const exifItems = [...items.values()].filter((it) => it.type === 'Exif');
  const pick = exifItems.find((it) => refs.some((r) => r.type === 'cdsc' && r.from === it.id && r.to.includes(primaryId))) || exifItems[0];
  if (pick) {
    const d = itemData(pick.id);
    if (d && d.length > 8) {
      const skip = readU32(d, 0);                          // exif_tiff_header_offset
      const t = 4 + skip;
      if (t + 8 <= d.length && isTiff(d, t)) exif = d.slice(t);
      else {                                               // 일부 파일은 "Exif\0\0" 가 앞에 더 있다
        const k = findTiff(d);
        if (k >= 0) exif = d.slice(k);
      }
    }
  }

  return { primaryId, imageCount: top.length, width, height, rotation, exif, icc, items, refs };
}

/**
 * 여러 장이 든 HEIF 에서 대표 사진만 남긴 사본.
 * libheif 를 감싼 해독기(heic-to)는 '첫 최상위 사진'을 해독하는데, 그것이 대표 사진(pitm)과 다를 수 있다.
 * 그래서 대표 사진과 거기 딸린 것(타일·미리보기·보조 사진)을 뺀 사진 항목과, 그 사진에만 붙은 메타데이터 항목의
 * 종류 이름(4글자)을 알 수 없는 이름으로 바꿔 해독기가 건너뛰게 한다. 길이가 같아 다른 위치는 그대로다.
 * 바꿀 것이 없으면 원래 바이트를 돌려준다. 결과: { bytes, hidden(가린 항목 수) }
 */
export const HIDE_TYPE = 'xhid';
export function primaryOnly(buf, info = null) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const inf = info || parseHeif(u8);
  const { primaryId, items, refs } = inf;
  if (primaryId == null || !items.has(primaryId)) return { bytes: u8, hidden: 0 };
  const keep = new Set([primaryId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of refs) {
      const add = (id) => { if (!keep.has(id) && items.has(id)) { keep.add(id); grew = true; } };
      if (r.type === 'dimg' && keep.has(r.from) && items.get(r.from)?.type !== 'tmap') r.to.forEach(add);   // 타일·원본
      if ((r.type === 'thmb' || r.type === 'auxl' || r.type === 'base') && r.to.some((id) => keep.has(id))) add(r.from);
    }
  }
  const hide = [...items.values()].filter((it) => IMAGE_TYPES.has(it.type) && !keep.has(it.id));
  if (!hide.length) return { bytes: u8, hidden: 0 };
  const hid = new Set(hide.map((it) => it.id));
  for (const it of items.values()) {
    if (!META_TYPES.has(it.type)) continue;
    const targets = refs.filter((r) => r.type === 'cdsc' && r.from === it.id).flatMap((r) => r.to);
    if (targets.length && targets.every((id) => hid.has(id))) hide.push(it);
  }
  const out = u8.slice();
  for (const it of hide) for (let i = 0; i < 4; i++) out[it.typeAt + i] = HIDE_TYPE.charCodeAt(i);
  return { bytes: out, hidden: hide.length };
}

function isTiff(d, p) { return (d[p] === 0x49 && d[p + 1] === 0x49 && d[p + 2] === 0x2a && d[p + 3] === 0) || (d[p] === 0x4d && d[p + 1] === 0x4d && d[p + 2] === 0 && d[p + 3] === 0x2a); }
function findTiff(d) { for (let i = 0; i + 4 <= Math.min(d.length, 64); i++) if (isTiff(d, i)) return i; return -1; }

/* ───────── EXIF(TIFF) 고치기 ───────── */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/**
 * EXIF(TIFF) 복사본을 고친다. 원본은 바꾸지 않는다.
 * opts.dropGps: 위치 정보(GPS IFD) 삭제 — 항목을 빼고 그 자리 바이트를 0으로 채운다
 * opts.orientation: 방향 값을 이 값으로(보통 1: 픽셀을 이미 바로 세웠으므로)
 * opts.dropThumbnail: 작은 미리보기(IFD1) 연결을 끊고 그 바이트를 0으로
 * 구조를 읽지 못하면 null.
 */
export function editExif(tiff, { dropGps = false, orientation = null, dropThumbnail = true } = {}) {
  try {
    const u8 = new Uint8Array(tiff), n8 = u8.length;
    if (!isTiff(u8, 0)) return null;
    const dv = new DataView(u8.buffer);
    const le = u8[0] === 0x49;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const zero = (s, len) => { if (s >= 0 && s + len <= n8) u8.fill(0, s, s + len); };
    const ifd0 = u32(4);
    if (ifd0 + 2 > n8) return null;
    const entryAt = (ifd, i) => ifd + 2 + i * 12;
    const valueInfo = (e) => {
      const type = u16(e + 2), count = u32(e + 4), size = (TYPE_SIZE[type] || 1) * count;
      return { size, off: size > 4 ? u32(e + 8) : e + 8, outOfLine: size > 4 };
    };
    const wipeIfd = (ifd) => {                              // IFD 표와 거기 딸린 값을 0으로
      if (!ifd || ifd + 2 > n8) return;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = entryAt(ifd, i);
        if (e + 12 > n8) break;
        const v = valueInfo(e);
        if (v.outOfLine) zero(v.off, v.size);
      }
      zero(ifd, Math.min(2 + n * 12 + 4, n8 - ifd));
    };

    let count = u16(ifd0);
    if (entryAt(ifd0, count) + 4 > n8) return null;
    for (let i = 0; i < count; i++) {
      const e = entryAt(ifd0, i), tag = u16(e);
      if (tag === 0x0112 && orientation != null) dv.setUint16(e + 8, orientation, le);
      if (tag === 0x8825 && dropGps) {
        wipeIfd(u32(e + 8));
        const tail = entryAt(ifd0, count) + 4;             // 뒤 항목들과 다음 IFD 위치를 한 칸 당긴다
        u8.copyWithin(e, e + 12, tail);
        zero(tail - 12, 12);
        count -= 1; dv.setUint16(ifd0, count, le); i -= 1;
      }
    }
    const nextPtr = entryAt(ifd0, count);
    if (dropThumbnail) {
      const ifd1 = u32(nextPtr);
      if (ifd1 && ifd1 + 2 <= n8) {
        const n = u16(ifd1);
        let off = 0, len = 0;
        for (let i = 0; i < n; i++) {
          const e = entryAt(ifd1, i);
          if (e + 12 > n8) break;
          if (u16(e) === 0x0201) off = u32(e + 8);
          if (u16(e) === 0x0202) len = u32(e + 8);
        }
        if (off && len) zero(off, len);
        wipeIfd(ifd1);
      }
      dv.setUint32(nextPtr, 0, le);
    }
    return u8;
  } catch {
    return null;
  }
}

/* ───────── JPEG·PNG 에 넣기 ───────── */

const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0, 0];                       // "Exif\0\0"
const ICC_HEAD = [...'ICC_PROFILE'].map((c) => c.charCodeAt(0)).concat(0); // "ICC_PROFILE\0"
export const MAX_APP_DATA = 65535 - 2;                                  // 길이 필드 2바이트 포함 최대 65535

function segment(marker, payload) {
  const len = payload.length + 2;
  if (len > 65535) throw new Error('JPEG 조각 한도(64KB)를 넘습니다');
  const s = new Uint8Array(4 + payload.length);
  s[0] = 0xff; s[1] = marker; s[2] = len >> 8; s[3] = len & 255;
  s.set(payload, 4);
  return s;
}

/** EXIF(TIFF) → APP1 조각. 64KB 를 넘으면 null */
export function exifSegment(tiff) {
  if (tiff.length + EXIF_HEAD.length > MAX_APP_DATA) return null;
  return segment(0xe1, concat([Uint8Array.from(EXIF_HEAD), tiff]));
}

/** ICC 프로필 → APP2 조각들(64KB 넘으면 여러 개로 나눈다) */
export function iccSegments(icc) {
  const room = MAX_APP_DATA - ICC_HEAD.length - 2;       // 65519
  const total = Math.ceil(icc.length / room);
  if (!total || total > 255) return [];
  const out = [];
  for (let i = 0; i < total; i++) {
    out.push(segment(0xe2, concat([Uint8Array.from(ICC_HEAD), Uint8Array.of(i + 1, total), icc.subarray(i * room, (i + 1) * room)])));
  }
  return out;
}

/** JPEG 의 SOI(및 바로 뒤 APP0 JFIF) 다음에 조각들을 끼운다.
    새로 넣는 종류와 같은 기존 조각(APP1 EXIF, APP2 ICC)만 뺀다(브라우저가 넣은 sRGB 프로필은 ICC 를 새로 넣을 때만 바뀐다). */
export function insertJpegSegments(jpeg, segs) {
  const u8 = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('JPEG 파일이 아닙니다');
  const addExif = segs.some((s) => s[1] === 0xe1), addIcc = segs.some((s) => s[1] === 0xe2);
  const head = [u8.subarray(0, 2)], rest = [];
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const m = u8[p + 1];
    if (m === 0xda) break;
    const len = readU16(u8, p + 2), part = u8.subarray(p, p + 2 + len);
    const isExif = m === 0xe1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66;
    const isIcc = m === 0xe2 && str4(u8, p + 4) === 'ICC_';
    if (m === 0xe0 && p === 2) head.push(part);
    else if (!(isExif && addExif) && !(isIcc && addIcc)) rest.push(part);
    p += 2 + len;
  }
  return concat([...head, ...segs, ...rest, u8.subarray(p)]);
}

/* PNG */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** ICC → iCCP 청크 내용(이름 + 압축 방식 0 + zlib) */
export function iccpData(icc, name = 'ICC Profile') {
  return concat([Uint8Array.from([...name].map((c) => c.charCodeAt(0))), Uint8Array.of(0, 0), zlibSync(icc)]);
}

/** PNG 의 첫 IDAT 앞에 청크를 끼운다. drop 에 적은 종류는 뺀다(iCCP 를 넣을 때 sRGB·gAMA·cHRM 과 겹치지 않게). */
export function insertPngChunks(png, chunks, drop = []) {
  const u8 = png instanceof Uint8Array ? png : new Uint8Array(png);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [u8.subarray(0, 8)];
  let p = 8, placed = false;
  while (p + 12 <= u8.length) {
    const len = dv.getUint32(p), type = str4(u8, p + 4), part = u8.subarray(p, p + 12 + len);
    if (!placed && (type === 'IDAT' || type === 'IEND')) { out.push(...chunks); placed = true; }
    if (!drop.includes(type)) out.push(part);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return concat(out);
}

/* ───────── 메타데이터 선택 ───────── */

/** 사용자가 고른 메타데이터 방식 → 무엇을 남길지. 방향은 늘 픽셀에 반영하고 값은 1로 둔다. */
export function metaPlan(mode) {
  if (mode === 'none') return { keepExif: false, dropGps: true };
  if (mode === 'all') return { keepExif: true, dropGps: false };
  return { keepExif: true, dropGps: true };                // 기본: 위치만 지우고 촬영 정보는 남긴다
}

/**
 * 결과 파일에 붙일 메타데이터 조각 계획.
 * decoder: 'native'(브라우저가 이미 sRGB 로 바꿔 줌) | 'libheif'(색 값 그대로 → 원래 ICC 를 붙여야 색이 맞다)
 */
export function outputMeta({ mode, exif, icc, decoder }) {
  const plan = metaPlan(mode);
  let tiff = null, exifNote = null;
  if (plan.keepExif && exif) {
    tiff = editExif(exif, { dropGps: plan.dropGps, orientation: 1, dropThumbnail: true });
    if (!tiff) exifNote = 'EXIF 구조를 읽지 못해 뺐습니다';
    else if (tiff.length + 6 > MAX_APP_DATA) { tiff = null; exifNote = 'EXIF 가 64KB 를 넘어 뺐습니다'; }
  }
  return { tiff, icc: decoder === 'libheif' && icc ? icc : null, exifNote };
}

/* ───────── 이름·합계 ───────── */

/** 원래 이름에서 확장자를 바꾸고, 같은 이름이 이미 있으면 -2, -3 을 붙인다. taken 은 소문자 Set. */
export function outputName(name, ext, taken = new Set()) {
  let base = String(name || '').replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'photo';
  if (base.length > 120) base = base.slice(0, 120);
  let out = `${base}.${ext}`, i = 2;
  while (taken.has(out.toLowerCase())) out = `${base}-${i++}.${ext}`;
  taken.add(out.toLowerCase());
  return out;
}

/** 합계: 끝난 것만 결과 크기에 넣는다 */
export function summarize(items) {
  let before = 0, after = 0, done = 0, failed = 0, beforeDone = 0;
  for (const it of items) {
    before += it.size || 0;
    if (it.state === 'done') { done++; after += it.outSize || 0; beforeDone += it.size || 0; }
    else if (it.state === 'error') failed++;
  }
  return { count: items.length, done, failed, before, beforeDone, after, ratio: beforeDone ? after / beforeDone : 0 };
}

/** iOS·iPadOS 사파리는 캔버스 넓이가 약 1,677만 화소(4096×4096)를 넘으면 그리지 못한다. */
export const IOS_CANVAS_PIXELS = 4096 * 4096;
export const DEFAULT_CANVAS_PIXELS = 268_435_456;           // 크롬·파이어폭스 계열 한도(약 2.68억 화소)
export function canvasLimit({ ua = '', touchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  return ios ? IOS_CANVAS_PIXELS : DEFAULT_CANVAS_PIXELS;
}
/** 화소 수 한도 안으로 줄인 크기(비율 유지, 정수) */
export function fitPixels(w, h, maxPixels) {
  if (w * h <= maxPixels) return { width: w, height: h, scaled: false };
  const s = Math.sqrt(maxPixels / (w * h));
  let width = Math.max(1, Math.floor(w * s)), height = Math.max(1, Math.floor(h * s));
  while (width * height > maxPixels) { width -= 1; height = Math.max(1, Math.floor((width * h) / w)); }
  return { width, height, scaled: true };
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}
