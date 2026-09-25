/* 사진 메타데이터 읽기·지우기. 화질 손실 없이 바이트에서 메타데이터 블록만 뺀다.
   JPEG: APP1(EXIF·XMP), APP13(IPTC·포토샵), COM(주석) 제거. 색 정보(APP2 ICC)는 남긴다.
   PNG: tEXt·iTXt·zTXt·eXIf·tIME 청크 제거.
   회전 정보(Orientation)도 EXIF 안에 있으므로, 회전된 사진은 호출하는 쪽에서 캔버스로 다시 그려야 한다. */

/** JPEG 의 EXIF 에서 필요한 것만 읽는다. EXIF 가 없으면 null. */
export function readJpegExif(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const marker = u8[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (marker === 0xe1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
      return parseTiff(new DataView(u8.buffer, u8.byteOffset + p + 10, len - 8));
    }
    p += 2 + len;
  }
  return null;
}

function parseTiff(dv) {
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const out = { orientation: 1, make: null, model: null, date: null, gps: null, software: null };
  const ascii = (off, n) => { let s = ''; for (let i = 0; i < n - 1 && off + i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(off + i)); return s.trim() || null; };
  const entries = (ifd) => {
    const list = [];
    if (ifd + 2 > dv.byteLength) return list;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
      list.push({ tag: u16(e), type, count, valOff: size * count > 4 ? u32(e + 8) : e + 8 });
    }
    return list;
  };
  const rational = (off) => u32(off) / (u32(off + 4) || 1);
  let exifIfd = 0, gpsIfd = 0;
  for (const e of entries(u32(4))) {
    if (e.tag === 0x0112) out.orientation = u16(e.valOff);
    else if (e.tag === 0x010f) out.make = ascii(e.valOff, e.count);
    else if (e.tag === 0x0110) out.model = ascii(e.valOff, e.count);
    else if (e.tag === 0x0131) out.software = ascii(e.valOff, e.count);
    else if (e.tag === 0x8769) exifIfd = u32(e.valOff);
    else if (e.tag === 0x8825) gpsIfd = u32(e.valOff);
  }
  if (exifIfd) for (const e of entries(exifIfd)) if (e.tag === 0x9003) out.date = ascii(e.valOff, e.count);
  if (gpsIfd) {
    const g = {};
    for (const e of entries(gpsIfd)) {
      if (e.tag === 1 || e.tag === 3) g[e.tag] = String.fromCharCode(dv.getUint8(e.valOff));
      else if ((e.tag === 2 || e.tag === 4) && e.count === 3) g[e.tag] = rational(e.valOff) + rational(e.valOff + 8) / 60 + rational(e.valOff + 16) / 3600;
    }
    if (g[2] != null && g[4] != null && (g[2] || g[4])) {
      out.gps = { lat: g[1] === 'S' ? -g[2] : g[2], lon: g[3] === 'W' ? -g[4] : g[4] };
    }
  }
  return out;
}

/** JPEG 에서 메타데이터 블록을 뺀 새 바이트. 이미지 데이터는 한 바이트도 바꾸지 않는다. */
export function stripJpeg(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('JPEG 파일이 아닙니다');
  const keep = [u8.subarray(0, 2)];
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) throw new Error('JPEG 구조를 읽지 못했습니다');
    const marker = u8[p + 1];
    if (marker === 0xda) { keep.push(u8.subarray(p)); break; } // 여기부터는 이미지 데이터
    const len = (u8[p + 2] << 8) | u8[p + 3];
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) keep.push(u8.subarray(p, p + 2 + len));
    p += 2 + len;
  }
  return concat(keep);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

export function isPng(buf) { const u8 = new Uint8Array(buf, 0, 8); return PNG_SIG.every((b, i) => u8[i] === b); }
export function isJpeg(buf) { const u8 = new Uint8Array(buf, 0, 2); return u8[0] === 0xff && u8[1] === 0xd8; }

/** PNG 에 메타데이터 청크가 있는지와 그 이름들 */
export function pngMetaChunks(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset);
  const found = []; let p = 8;
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
    if (PNG_DROP.has(type)) found.push(type);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return found;
}

export function stripPng(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset);
  const keep = [u8.subarray(0, 8)]; let p = 8;
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
    if (!PNG_DROP.has(type)) keep.push(u8.subarray(p, p + 12 + len));
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return concat(keep);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

/** 회전 정보를 반영해 캔버스로 다시 그린 JPEG/PNG Blob (메타데이터 없음) */
export async function redraw(file, type = 'image/jpeg', quality = 0.92) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((res) => c.toBlob(res, type, quality));
}
