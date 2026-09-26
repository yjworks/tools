/* PDF 용량 줄이기의 순수 로직과 pdf-lib 부분. 화면(DOM)·캔버스는 쓰지 않는다(그건 pdf-compress/main.js).
   세 가지 방법:
   1) 구조 정리(무손실): 안 쓰는 객체 지우기, 똑같은 스트림 하나로 합치기, 압축 안 된 스트림 Flate 압축, 객체 스트림으로 저장
   2) 사진만 다시 압축: 문서 속 JPEG(DCTDecode) 그림만 더 낮은 품질·해상도로 바꾼다. 글자·도형은 그대로
   3) 모든 쪽을 그림으로: 쪽마다 JPEG 한 장으로 다시 만든다(글자 선택·검색이 사라진다) */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFRawStream, PDFStream } from 'pdf-lib';
import { zlibSync } from 'fflate';

const N = (s) => PDFName.of(s);

/* ---------- 설정값 ---------- */
export const PRESETS = {
  // 사진만 다시 압축: 긴 변 최대 픽셀, JPEG 품질
  images: { high: { maxEdge: 2400, quality: 0.8 }, medium: { maxEdge: 1600, quality: 0.7 }, low: { maxEdge: 1100, quality: 0.55 } },
  // 모든 쪽을 그림으로: DPI, JPEG 품질
  raster: { high: { dpi: 150, quality: 0.8 }, medium: { dpi: 110, quality: 0.7 }, low: { dpi: 80, quality: 0.6 } },
};
/** 휴대폰 브라우저 캔버스 한도(iOS 약 1,670만 화소)보다 넉넉히 작게. */
export const MAX_CANVAS_PIXELS = 12_000_000;
/** 다시 압축한 그림이 원래보다 이만큼 이상 작아야 바꾼다(조금 줄자고 화질을 버리지 않게). */
export const MIN_IMAGE_GAIN = 0.9;
/** 이보다 작은 그림은 건드리지 않는다. */
export const MIN_IMAGE_BYTES = 20 * 1024;

/* ---------- 판단(순수) ---------- */

/** 결과를 쓸지 원본을 둘지. 1% 도 안 줄면 원본을 그대로 둔다. */
export function decide(originalSize, resultSize) {
  const saved = originalSize - resultSize;
  const percent = originalSize > 0 ? Math.round((saved / originalSize) * 1000) / 10 : 0;
  const useResult = resultSize > 0 && resultSize < originalSize * 0.99;
  return { useResult, saved: useResult ? saved : 0, percent: useResult ? percent : 0, grew: resultSize >= originalSize };
}

/** 긴 변을 maxEdge 에 맞춰 줄인 크기. 이미 작으면 그대로. */
export function fitEdge(w, h, maxEdge) {
  const long = Math.max(w, h);
  if (!maxEdge || long <= maxEdge) return { width: w, height: h, scaled: false };
  const s = maxEdge / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scaled: true };
}

/** 쪽(포인트 단위)을 dpi 로 그릴 때 픽셀 크기. 캔버스 한도를 넘으면 dpi 를 낮춘다. */
export function rasterSize(widthPt, heightPt, dpi, maxPixels = MAX_CANVAS_PIXELS) {
  let scale = dpi / 72;
  let w = widthPt * scale, h = heightPt * scale;
  if (w * h > maxPixels) { const k = Math.sqrt(maxPixels / (w * h)); scale *= k; w *= k; h *= k; }
  return { width: Math.max(1, Math.floor(w)), height: Math.max(1, Math.floor(h)), scale, dpi: Math.round(scale * 72) };
}

export function shouldReplaceImage(oldBytes, newBytes) {
  return newBytes > 0 && newBytes < oldBytes * MIN_IMAGE_GAIN;
}

/* ---------- pdf-lib: 객체 정리 ---------- */

function* childrenOf(obj) {
  if (obj instanceof PDFDict) { for (const [, v] of obj.entries()) yield v; }
  else if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) yield obj.get(i); }
  else if (obj instanceof PDFStream) { for (const [, v] of obj.dict.entries()) yield v; }
}

/** 문서 뿌리(Root·Info)에서 닿지 않는 객체를 지운다. 지운 개수를 돌려준다. */
export function removeUnreachable(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [];
  const { Root, Info } = ctx.trailerInfo;
  for (const r of [Root, Info]) if (r) stack.push(r);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      const k = o.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
      continue;
    }
    for (const c of childrenOf(o)) if (c instanceof PDFRef || c instanceof PDFDict || c instanceof PDFArray || c instanceof PDFStream) stack.push(c);
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) { ctx.delete(ref); removed++; }
  }
  return removed;
}

/** 모든 객체 안의 참조를 map(옛 참조 문자열 → 새 참조)대로 바꾼다. */
function replaceRefs(ctx, map) {
  const fix = (o) => {
    if (o instanceof PDFDict) { for (const [k, v] of o.entries()) { if (v instanceof PDFRef && map.has(v.toString())) o.set(k, map.get(v.toString())); else fix(v); } }
    else if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) { const v = o.get(i); if (v instanceof PDFRef && map.has(v.toString())) o.set(i, map.get(v.toString())); else fix(v); } }
    else if (o instanceof PDFStream) fix(o.dict);
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) fix(obj);
  const t = ctx.trailerInfo;
  for (const key of ['Root', 'Info']) if (t[key] instanceof PDFRef && map.has(t[key].toString())) t[key] = map.get(t[key].toString());
}

function fnv(bytes) {
  let h = 0x811c9dc5;
  const step = bytes.length > 65536 ? Math.floor(bytes.length / 32768) : 1;   // 큰 스트림은 표본만(최종 비교는 전체)
  for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + bytes.length;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function dictKey(dict) {
  return dict.entries().filter(([k]) => k !== N('Length')).map(([k, v]) => `${k}${v}`).sort().join('');
}

/** 내용과 사전이 똑같은 스트림(같은 글꼴·로고가 여러 번 들어간 경우)을 하나로 합친다. 합친 개수를 돌려준다. */
export function dedupeStreams(doc) {
  const ctx = doc.context;
  let total = 0;
  for (let round = 0; round < 3; round++) {   // 글꼴 파일이 합쳐지면 그걸 가리키던 스트림도 같아질 수 있어 몇 번 되풀이
    const buckets = new Map(), map = new Map();
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const key = fnv(obj.contents) + '|' + dictKey(obj.dict);
      const list = buckets.get(key);
      if (!list) { buckets.set(key, [[ref, obj]]); continue; }
      const twin = list.find(([, o]) => sameBytes(o.contents, obj.contents));
      if (twin) map.set(ref.toString(), twin[0]); else list.push([ref, obj]);
    }
    if (!map.size) break;
    replaceRefs(ctx, map);
    for (const k of map.keys()) { const [n, g] = k.split(' '); ctx.delete(PDFRef.of(Number(n), Number(g))); }
    total += map.size;
  }
  return total;
}

/** 필터 없이 저장된 스트림을 Flate 로 압축한다(작아질 때만). XMP 메타데이터는 그대로 둔다. */
export function deflateRawStreams(doc, minBytes = 256) {
  const ctx = doc.context;
  let count = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.has(N('Filter')) || d.has(N('DecodeParms')) || d.get(N('Type')) === N('Metadata')) continue;
    if (obj.contents.length < minBytes) continue;
    const z = zlibSync(obj.contents, { level: 9 });
    if (z.length >= obj.contents.length * 0.95) continue;
    const nd = d.clone(ctx);
    nd.set(N('Filter'), N('FlateDecode'));
    ctx.assign(ref, PDFRawStream.of(nd, z));
    count++;
  }
  return count;
}

/** 전자서명이 들어 있는지(다시 저장하면 서명이 무효가 된다). */
export function hasSignature(doc) {
  const form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!form) return false;
  const flags = form.lookup(N('SigFlags'));
  if (flags instanceof PDFNumber && (flags.asNumber() & 1)) return true;
  const fields = form.lookupMaybe(N('Fields'), PDFArray);
  if (!fields) return false;
  for (let i = 0; i < fields.size(); i++) {
    const f = doc.context.lookup(fields.get(i));
    if (f instanceof PDFDict && f.get(N('FT')) === N('Sig')) return true;
  }
  return false;
}

/**
 * 부가 데이터 지우기.
 * extras: 쪽 미리보기 그림(/Thumb), 편집 프로그램 전용 데이터(/PieceInfo)
 * info: 문서 정보(제목·작성자 등)와 XMP 메타데이터
 */
export function stripExtras(doc, { extras = true, info = false } = {}) {
  let n = 0;
  if (extras) {
    if (doc.catalog.has(N('PieceInfo'))) { doc.catalog.delete(N('PieceInfo')); n++; }
    for (const p of doc.getPages()) {
      for (const k of ['Thumb', 'PieceInfo']) if (p.node.has(N(k))) { p.node.delete(N(k)); n++; }
    }
  }
  if (info) {
    if (doc.catalog.has(N('Metadata'))) { doc.catalog.delete(N('Metadata')); n++; }
    const infoRef = doc.context.trailerInfo.Info;
    const infoDict = infoRef ? doc.context.lookup(infoRef) : null;
    if (infoDict instanceof PDFDict) {
      for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) if (infoDict.has(N(k))) { infoDict.delete(N(k)); n++; }
    }
  }
  return n;
}

/**
 * 무손실 정리. bytes → { bytes, removed, deduped, deflated, stripped }
 * 암호 걸린 파일은 pdf-lib 가 못 풀므로 { encrypted: true } 오류.
 */
export async function losslessCleanup(bytes, opts = {}) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (e?.constructor?.name === 'EncryptedPDFError' || /is encrypted/i.test(String(e?.message))) { const err = new Error('encrypted'); err.encrypted = true; throw err; }
    throw e;
  }
  return finishCleanup(doc, opts);
}

/** 이미 연 문서를 정리해 저장한다(사진 다시 압축 뒤에도 쓴다). */
export async function finishCleanup(doc, { extras = true, info = false } = {}) {
  const signed = hasSignature(doc);
  const stripped = stripExtras(doc, { extras, info });
  const removed = removeUnreachable(doc);
  const deduped = dedupeStreams(doc);
  const deflated = deflateRawStreams(doc);
  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes: out, removed, deduped, deflated, stripped, signed };
}

/* ---------- pdf-lib: 문서 속 JPEG 찾기 ---------- */

/** 이 그림을 다시 압축해도 되는지. 안 되면 이유를 돌려준다. */
export function jpegEligibility(dict, byteLength, lookup = (x) => x) {
  let filter = lookup(dict.get(N('Filter')));
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? lookup(filter.get(0)) : null;
  if (filter !== N('DCTDecode')) return 'not-jpeg';
  if (lookup(dict.get(N('ImageMask')))?.asBoolean?.()) return 'mask';
  if (dict.has(N('Decode'))) return 'decode';
  if (dict.has(N('SMaskInData'))) return 'smask-in-data';
  const bpc = lookup(dict.get(N('BitsPerComponent')));
  if (bpc instanceof PDFNumber && bpc.asNumber() !== 8) return 'bpc';
  const cs = lookup(dict.get(N('ColorSpace')));
  const kind = colorKind(cs, lookup);
  if (!kind) return 'colorspace';
  if (byteLength < MIN_IMAGE_BYTES) return 'small';
  return null;
}

/** 'rgb' | 'gray' | null(CMYK·Indexed·DeviceN 등은 건드리지 않는다) */
export function colorKind(cs, lookup = (x) => x) {
  if (cs === N('DeviceRGB') || cs === N('CalRGB')) return 'rgb';
  if (cs === N('DeviceGray') || cs === N('CalGray')) return 'gray';
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const fam = lookup(cs.get(0));
    if (fam === N('CalRGB')) return 'rgb';
    if (fam === N('CalGray')) return 'gray';
    if (fam === N('ICCBased')) {
      const s = lookup(cs.get(1));
      const n = s?.dict?.lookup(N('N'));
      const nn = n instanceof PDFNumber ? n.asNumber() : 0;
      return nn === 3 ? 'rgb' : nn === 1 ? 'gray' : null;
    }
  }
  return null;
}

/** 문서 속 JPEG 그림 목록. [{ ref, width, height, bytes, kind, reason }] (reason 이 null 이면 다시 압축 대상) */
export function listJpegImages(doc) {
  const ctx = doc.context, list = [];
  const lookup = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (lookup(d.get(N('Subtype'))) !== N('Image')) continue;
    const reason = jpegEligibility(d, obj.contents.length, lookup);
    if (reason === 'not-jpeg') continue;
    const w = lookup(d.get(N('Width'))), h = lookup(d.get(N('Height')));
    list.push({
      ref, width: w instanceof PDFNumber ? w.asNumber() : 0, height: h instanceof PDFNumber ? h.asNumber() : 0,
      bytes: obj.contents, kind: colorKind(lookup(d.get(N('ColorSpace'))), lookup), reason,
    });
  }
  return list;
}

/** 그림 스트림을 새 JPEG(RGB)로 바꾼다. 투명도(SMask)·렌더링 설정은 그대로 둔다. */
export function replaceJpeg(doc, ref, jpegBytes, width, height, kind) {
  const ctx = doc.context;
  const old = ctx.lookup(ref);
  const d = old.dict.clone(ctx);
  d.set(N('Filter'), N('DCTDecode'));
  d.delete(N('DecodeParms'));
  d.set(N('Width'), PDFNumber.of(width));
  d.set(N('Height'), PDFNumber.of(height));
  d.set(N('BitsPerComponent'), PDFNumber.of(8));
  if (kind === 'gray') d.set(N('ColorSpace'), N('DeviceRGB'));   // 캔버스가 만든 JPEG 는 항상 3채널
  ctx.assign(ref, PDFRawStream.of(d, jpegBytes));
}

/* ---------- 모든 쪽을 그림으로 ---------- */

/** pages: [{ jpeg: Uint8Array, widthPt, heightPt }] → PDF 바이트 */
export async function buildImagePdf(pages, producer = 'DigitalBrain 도구 (dibrain.dev/tools)') {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const img = await out.embedJpg(p.jpeg);
    const page = out.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  out.setProducer(producer);
  out.setCreator(producer);
  return out.save({ useObjectStreams: true });
}
