import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import {
  decide, fitEdge, rasterSize, shouldReplaceImage, PRESETS, MIN_IMAGE_BYTES,
  removeUnreachable, dedupeStreams, deflateRawStreams, stripExtras, hasSignature,
  losslessCleanup, listJpegImages, replaceJpeg, buildImagePdf, colorKind,
} from '../src/_shared/pdf-compress.js';

// 16×8 빨간 JPEG (632바이트)
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=', 'base64'));

describe('판단 함수', () => {
  it('decide: 1% 이상 줄어야 결과를 쓴다', () => {
    expect(decide(1_000_000, 400_000)).toEqual({ useResult: true, saved: 600_000, percent: 60, grew: false });
    expect(decide(1_000_000, 995_000)).toEqual({ useResult: false, saved: 0, percent: 0, grew: false });
    expect(decide(1_000_000, 1_200_000)).toEqual({ useResult: false, saved: 0, percent: 0, grew: true });
    expect(decide(1_000, 333).percent).toBe(66.7);
  });
  it('fitEdge: 긴 변을 맞추고, 작으면 그대로', () => {
    expect(fitEdge(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(fitEdge(1000, 3000, 1600)).toEqual({ width: 533, height: 1600, scaled: true });
    expect(fitEdge(800, 600, 1600)).toEqual({ width: 800, height: 600, scaled: false });
  });
  it('rasterSize: A4 를 150dpi 로 그리면 1240×1753', () => {
    expect(rasterSize(595.28, 841.89, 150)).toMatchObject({ width: 1240, height: 1753, dpi: 150 });
  });
  it('rasterSize: 큰 도면(A0)은 캔버스 한도에 맞춰 dpi 를 낮춘다', () => {
    const r = rasterSize(2383.94, 3370.39, 150);
    expect(r.width * r.height).toBeLessThanOrEqual(12_000_000);
    expect(r.dpi).toBeLessThan(150);
    expect(r.dpi).toBe(88);
  });
  it('그림은 10% 이상 줄 때만 바꾼다', () => {
    expect(shouldReplaceImage(100_000, 89_000)).toBe(true);
    expect(shouldReplaceImage(100_000, 91_000)).toBe(false);
    expect(shouldReplaceImage(100_000, 0)).toBe(false);
  });
  it('미리 정한 값', () => {
    expect(PRESETS.raster.medium).toEqual({ dpi: 110, quality: 0.7 });
    expect(PRESETS.images.low).toEqual({ maxEdge: 1100, quality: 0.55 });
  });
});

async function textPdf(pages = 2) {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([300, 300]).drawText(`Hello ${i + 1}`, { x: 20, y: 200, size: 20, font });
  return d;
}

describe('무손실 정리 (실제 PDF)', () => {
  it('어디에서도 쓰지 않는 객체를 지운다', async () => {
    const d = await textPdf();
    const junk = d.context.register(d.context.stream(new Uint8Array(50_000).fill(65)));
    const before = await d.save({ useObjectStreams: false });
    const loaded = await PDFDocument.load(before);
    expect(loaded.context.lookup(junk)).toBeTruthy();
    expect(removeUnreachable(loaded)).toBeGreaterThanOrEqual(1);
    expect(loaded.context.lookup(junk)).toBeUndefined();
    const after = await loaded.save();
    expect(after.length).toBeLessThan(before.length - 45_000);
    expect((await PDFDocument.load(after)).getPageCount()).toBe(2);
  });

  it('같은 JPEG 가 두 번 들어 있으면 하나로 합친다', async () => {
    const d = await PDFDocument.create();
    for (let i = 0; i < 2; i++) {
      const img = await d.embedJpg(JPEG);   // 같은 그림을 따로 두 번 넣는다
      d.addPage([100, 100]).drawImage(img, { x: 0, y: 0, width: 100, height: 50 });
    }
    const loaded = await PDFDocument.load(await d.save());
    expect(listJpegImages(loaded).length).toBe(2);
    expect(dedupeStreams(loaded)).toBeGreaterThanOrEqual(1);
    removeUnreachable(loaded);
    const again = await PDFDocument.load(await loaded.save());
    expect(listJpegImages(again).length).toBe(1);
    expect(again.getPageCount()).toBe(2);
  });

  it('압축 안 된 스트림을 Flate 로 압축한다', async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([200, 200]);
    const ops = 'BT /F1 12 Tf 10 10 Td (x) Tj ET\n'.repeat(400);
    const raw = d.context.stream(ops);   // Filter 없음
    page.node.set(PDFName.of('Contents'), d.context.register(raw));
    const loaded = await PDFDocument.load(await d.save());
    expect(deflateRawStreams(loaded)).toBe(1);
    const [, s] = [...loaded.context.enumerateIndirectObjects()].find(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode') && !o.dict.has(PDFName.of('Type')));
    expect(s.contents.length).toBeLessThan(ops.length / 10);
  });

  it('부가 데이터·문서 정보 지우기', async () => {
    const d = await textPdf(1);
    d.setTitle('비밀 제목'); d.setAuthor('홍길동');
    d.getPage(0).node.set(PDFName.of('PieceInfo'), d.context.obj({ Illustrator: {} }));
    const loaded = await PDFDocument.load(await d.save());
    expect(stripExtras(loaded, { extras: true, info: true })).toBeGreaterThanOrEqual(3);
    const again = await PDFDocument.load(await loaded.save());
    expect(again.getTitle()).toBeUndefined();
    expect(again.getAuthor()).toBeUndefined();
    expect(again.getPage(0).node.has(PDFName.of('PieceInfo'))).toBe(false);
  });

  it('losslessCleanup: 결과 쪽 수가 같고, 서명 없음', async () => {
    const d = await textPdf(3);
    d.context.register(d.context.stream(new Uint8Array(20_000).fill(1)));
    const bytes = await d.save({ useObjectStreams: false });
    const r = await losslessCleanup(bytes);
    expect(r.signed).toBe(false);
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(r.bytes.length).toBeLessThan(bytes.length);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(3);
    expect(decide(bytes.length, r.bytes.length).useResult).toBe(true);
  });

  it('전자서명 표시(SigFlags)가 있으면 알려 준다', async () => {
    const d = await textPdf(1);
    d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ Fields: [], SigFlags: 3 }));
    expect(hasSignature(d)).toBe(true);
  });
});

describe('문서 속 JPEG', () => {
  it('대상 판단: 작은 그림·CMYK·Decode 가 있는 그림은 건드리지 않는다', async () => {
    const d = await PDFDocument.create();
    const ctx = d.context;
    const big = new Uint8Array(MIN_IMAGE_BYTES + 10);
    const mk = (extra) => ctx.register(ctx.stream(big, { Type: 'XObject', Subtype: 'Image', Width: 400, Height: 300, BitsPerComponent: 8, Filter: 'DCTDecode', ...extra }));
    const ok = mk({ ColorSpace: 'DeviceRGB' });
    mk({ ColorSpace: 'DeviceCMYK' });
    mk({ ColorSpace: 'DeviceRGB', Decode: [1, 0, 1, 0, 1, 0] });
    ctx.register(ctx.stream(new Uint8Array(100), { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, BitsPerComponent: 8, Filter: 'DCTDecode', ColorSpace: 'DeviceGray' }));
    ctx.register(ctx.stream(big, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, BitsPerComponent: 8, Filter: 'FlateDecode', ColorSpace: 'DeviceRGB' }));
    const list = listJpegImages(d);
    expect(list.map((x) => x.reason)).toEqual([null, 'colorspace', 'decode', 'small']);
    expect(list[0]).toMatchObject({ width: 400, height: 300, kind: 'rgb' });
    expect(list[0].ref.toString()).toBe(ok.toString());
  });

  it('ICCBased N=1 은 gray, N=4 는 대상 아님', async () => {
    const d = await PDFDocument.create();
    const icc = (n) => d.context.register(d.context.stream(new Uint8Array(10), { N: n }));
    expect(colorKind(d.context.obj(['ICCBased', icc(1)]), (x) => d.context.lookup(x))).toBe('gray');
    expect(colorKind(d.context.obj(['ICCBased', icc(3)]), (x) => d.context.lookup(x))).toBe('rgb');
    expect(colorKind(d.context.obj(['ICCBased', icc(4)]), (x) => d.context.lookup(x))).toBe(null);
  });

  it('replaceJpeg: 크기·색공간을 바꾸고 SMask 는 남긴다', async () => {
    const d = await PDFDocument.create();
    const ctx = d.context;
    const smask = ctx.register(ctx.stream(new Uint8Array(10), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1 }));
    const ref = ctx.register(ctx.stream(new Uint8Array(30_000), { Type: 'XObject', Subtype: 'Image', Width: 3200, Height: 1600, BitsPerComponent: 8, Filter: 'DCTDecode', ColorSpace: 'DeviceGray', SMask: smask }));
    replaceJpeg(d, ref, JPEG, 16, 8, 'gray');
    const s = ctx.lookup(ref);
    expect(s.contents.length).toBe(632);
    expect(s.dict.get(PDFName.of('Width'))).toEqual(PDFNumber.of(16));
    expect(s.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect(s.dict.get(PDFName.of('SMask')).toString()).toBe(smask.toString());
  });

  it('buildImagePdf: 쪽 크기를 포인트 그대로 쓴다', async () => {
    const bytes = await buildImagePdf([{ jpeg: JPEG, widthPt: 595.28, heightPt: 841.89 }, { jpeg: JPEG, widthPt: 300, heightPt: 150 }]);
    const d = await PDFDocument.load(bytes);
    expect(d.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[595, 842], [300, 150]]);
  });
});
