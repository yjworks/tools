import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFArray, PDFHexString, degrees } from 'pdf-lib';
import {
  moveItem, moveBlock, shiftKeys, pagesFromFiles, regroupByFiles, normRotation, rotatePage, summarize, safeFileName,
  remapOutline, countOutline, loadPdf, prepareSource, assemblePdf, isEncryptedError,
} from '../src/_shared/pdf-merge.js';

describe('쪽 목록 다루기', () => {
  it('moveItem: 2번째를 맨 뒤로, 범위를 벗어나면 끝에 붙임', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('pagesFromFiles: 파일 순서대로 쪽을 늘어놓는다', () => {
    expect(pagesFromFiles([{ id: 'A', pageCount: 2 }, { id: 'B', pageCount: 1 }])).toEqual([
      { key: 'A:0', file: 'A', page: 0, rotate: 0 }, { key: 'A:1', file: 'A', page: 1, rotate: 0 }, { key: 'B:0', file: 'B', page: 0, rotate: 0 },
    ]);
  });
  const L = (s) => s.split('').map((key) => ({ key }));
  const K = (list) => list.map((x) => x.key).join('');
  it('moveBlock: 끌어다 놓은 자리(옮기기 전 기준) 앞에 고른 항목을 덩어리로 끼운다', () => {
    expect(K(moveBlock(L('abcdef'), ['b'], 5))).toBe('acdebf');
    expect(K(moveBlock(L('abcdef'), ['e'], 0))).toBe('eabcdf');
    expect(K(moveBlock(L('abcdef'), ['b', 'd'], 6))).toBe('acefbd');
    expect(K(moveBlock(L('abcdef'), ['a', 'f'], 3))).toBe('bcafde');
    expect(K(moveBlock(L('abc'), ['x'], 1))).toBe('abc');
  });
  it('shiftKeys: 한 칸씩 앞뒤로, 끝에 붙은 항목은 그대로', () => {
    expect(K(shiftKeys(L('abcde'), ['c'], -1))).toBe('acbde');
    expect(K(shiftKeys(L('abcde'), ['c', 'd'], 1))).toBe('abecd');
    expect(K(shiftKeys(L('abcde'), ['a', 'b', 'd'], -1))).toBe('abdce');
    expect(K(shiftKeys(L('abcde'), ['e'], 1))).toBe('abcde');
    expect(K(shiftKeys(L('abcde'), ['a', 'c'], -1))).toBe('acbde');
  });
  it('regroupByFiles: 파일 순서를 바꾸면 쪽이 파일별로 모이고, 파일 안 순서·회전은 유지', () => {
    const pages = [
      { file: 'A', page: 1, rotate: 90 }, { file: 'B', page: 0, rotate: 0 }, { file: 'A', page: 0, rotate: 0 }, { file: 'C', page: 0, rotate: 0 },
    ];
    expect(regroupByFiles(pages, ['B', 'A'])).toEqual([
      { file: 'B', page: 0, rotate: 0 }, { file: 'A', page: 1, rotate: 90 }, { file: 'A', page: 0, rotate: 0 },
    ]);
  });
  it('회전 각도 정리', () => {
    expect(normRotation(-90)).toBe(270);
    expect(normRotation(450)).toBe(90);
    expect(normRotation(360)).toBe(0);
    expect(rotatePage({ file: 'A', page: 0, rotate: 270 }, 90).rotate).toBe(0);
  });
  it('요약과 파일 이름', () => {
    expect(summarize([{ file: 'A', rotate: 90 }, { file: 'A', rotate: 0 }, { file: 'B', rotate: 360 }])).toEqual({ pages: 3, files: 2, rotated: 1 });
    expect(safeFileName('계약서: 최종/수정.pdf')).toBe('계약서_ 최종_수정');
    expect(safeFileName('   ')).toBe('합친문서');
  });
});

describe('책갈피 다시 맞추기', () => {
  const tree = [
    { title: '1장', page: 0, open: true, rest: null, children: [{ title: '1.1', page: 1, children: [] }, { title: '1.2', page: 2, children: [] }] },
    { title: '2장', page: 3, open: false, rest: null, children: [{ title: '2.1', page: 4, children: [] }] },
    { title: '부록', page: 5, children: [] },
  ];
  it('빠진 쪽을 가리키는 항목은 버리고, 부모는 남은 첫 자식 쪽으로', () => {
    // 원래 0,2,4 쪽만 남고 새 순서는 4→0, 0→1, 2→2
    const keep = new Map([[4, 0], [0, 1], [2, 2]]);
    const r = remapOutline(tree, keep);
    expect(r.map((x) => [x.title, x.page])).toEqual([['1장', 1], ['2장', 0]]);
    expect(r[0].children.map((x) => [x.title, x.page])).toEqual([['1.2', 2]]);
    expect(r[1].children.map((x) => [x.title, x.page])).toEqual([['2.1', 0]]);
    expect(countOutline(r)).toBe(4);
  });
});

/* ---------- 실제 PDF 로 합치기 ---------- */

async function makePdf(label, n, { width = 300, outline = false, link = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([width + i, 400]);
    p.drawText(`${label} ${i + 1}`, { x: 30, y: 350, size: 24, font });
  }
  const ctx = doc.context, pages = doc.getPages();
  if (outline) {
    // 쪽마다 책갈피 하나(평면 목록)
    const root = ctx.nextRef();
    const refs = pages.map(() => ctx.nextRef());
    pages.forEach((p, i) => {
      const d = ctx.obj({ Title: PDFHexString.fromText(`${label}-bm${i + 1}`), Parent: root, Dest: [p.ref, 'Fit'] });
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < pages.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      ctx.assign(refs[i], d);
    });
    ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
    doc.catalog.set(PDFName.of('Outlines'), root);
  }
  if (link) {
    // 1쪽에 마지막 쪽으로 가는 링크, 웹 주소 링크 하나
    const toLast = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Border: [0, 0, 0], Dest: [pages[n - 1].ref, 'XYZ', null, null, null] });
    const web = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 50, 100, 80], Border: [0, 0, 0], A: { S: 'URI', URI: PDFHexString.fromText('https://dibrain.dev/') } });
    pages[0].node.set(PDFName.of('Annots'), ctx.obj([ctx.register(toLast), ctx.register(web)]));
  }
  return doc.save();
}

async function source(bytes) { return { kind: 'pdf', prepared: prepareSource(await loadPdf(bytes)) }; }

describe('assemblePdf (실제 PDF)', () => {
  it('두 파일을 섞은 순서·회전·삭제대로 합친다', async () => {
    const A = await makePdf('A', 3, { width: 300 });
    const B = await makePdf('B', 2, { width: 500 });
    const sources = new Map([['A', await source(A)], ['B', await source(B)]]);
    // B2, A1(90도), A3 — A2 와 B1 은 뺀다
    const pages = [{ file: 'B', page: 1, rotate: 0 }, { file: 'A', page: 0, rotate: 90 }, { file: 'A', page: 2, rotate: 0 }];
    const r = await assemblePdf(sources, pages);
    const out = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(3);
    expect(out.getPages().map((p) => p.getWidth())).toEqual([501, 300, 302]);
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
    expect(out.getProducer()).toContain('DigitalBrain');
  });

  it('원래 회전이 있는 쪽은 그 위에 더한다', async () => {
    const d = await PDFDocument.create();
    d.addPage([200, 300]).setRotation(degrees(90));
    const sources = new Map([['X', await source(await d.save())]]);
    const r = await assemblePdf(sources, [{ file: 'X', page: 0, rotate: 270 }]);
    expect((await PDFDocument.load(r.bytes)).getPage(0).getRotation().angle).toBe(0);
  });

  it('책갈피: 남은 쪽만, 파일별 책갈피를 켜면 파일 이름이 위에', async () => {
    const A = await makePdf('A', 3, { outline: true });
    const B = await makePdf('B', 2, { outline: true });
    const sources = new Map([['A', await source(A)], ['B', await source(B)]]);
    const pages = [{ file: 'A', page: 0 }, { file: 'A', page: 2 }, { file: 'B', page: 0 }, { file: 'B', page: 1 }];
    const plain = await assemblePdf(sources, pages);
    expect(plain.outlineCount).toBe(4);   // A-bm2 는 빠진 쪽이라 없음
    const titles = await readOutlineTitles(plain.bytes);
    expect(titles).toEqual([['A-bm1', 0], ['A-bm3', 1], ['B-bm1', 2], ['B-bm2', 3]]);

    const grouped = await assemblePdf(sources, pages, { fileBookmarks: true, titles: new Map([['A', '첫 파일'], ['B', '둘째 파일']]) });
    expect(grouped.outlineCount).toBe(6);
    expect(await readOutlineTitles(grouped.bytes, true)).toEqual([['첫 파일', 0], ['둘째 파일', 2]]);
  });

  it('문서 안 링크는 새 쪽으로 다시 잇고, 대상 쪽이 빠지면 링크를 지우며, 웹 링크는 남긴다', async () => {
    const A = await makePdf('A', 3, { link: true });
    const sources = new Map([['A', await source(A)]]);
    const kept = await assemblePdf(sources, [{ file: 'A', page: 2 }, { file: 'A', page: 0 }]);
    expect(kept.linksKept).toBe(1);
    const d = await PDFDocument.load(kept.bytes);
    const annots = d.getPage(1).node.Annots();
    expect(annots.size()).toBe(2);
    const link = d.context.lookup(annots.get(0));
    const dest = link.lookup(PDFName.of('Dest'), PDFArray);
    expect(dest.get(0).toString()).toBe(d.getPage(0).ref.toString());   // 원래 3쪽 = 새 1쪽
    // 원본의 다른 쪽이 딸려오지 않아야 한다: 쪽 객체는 2개뿐
    const pageObjs = [...d.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Page'));
    expect(pageObjs.length).toBe(2);

    const dropped = await assemblePdf(new Map([['A', await source(A)]]), [{ file: 'A', page: 0 }]);
    expect(dropped.linksDropped).toBe(1);
    const d2 = await PDFDocument.load(dropped.bytes);
    const left = d2.getPage(0).node.Annots();
    expect(left.size()).toBe(1);
    expect(d2.context.lookup(left.get(0)).lookup(PDFName.of('A'), PDFDict).get(PDFName.of('S'))).toBe(PDFName.of('URI'));
  });

  it('사진을 A4 쪽으로 넣는다(가로 사진은 가로 A4)', async () => {
    // 2×1 픽셀 PNG
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGAEAHfEC/pJvyHkAAAAASUVORK5CYII=', 'base64'));
    const sources = new Map([['I', { kind: 'image', bytes: png, type: 'png', fit: 'a4' }]]);
    const r = await assemblePdf(sources, [{ file: 'I', page: 0 }]);
    const p = (await PDFDocument.load(r.bytes)).getPage(0);
    expect([Math.round(p.getWidth()), Math.round(p.getHeight())]).toEqual([842, 595]);
  });

  it('암호 걸린 파일은 encrypted 오류', async () => {
    const d = await PDFDocument.create();
    d.addPage();
    const bytes = await d.save({ useObjectStreams: false });
    // 트레일러에 /Encrypt 를 넣은 것처럼 흉내: pdf-lib 는 Encrypt 항목이 있으면 거부한다
    const s = Buffer.from(bytes).toString('latin1').replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>');
    await expect(loadPdf(Buffer.from(s, 'latin1'))).rejects.toMatchObject({ encrypted: true });
    expect(isEncryptedError({ message: 'Input document to `PDFDocument.load` is encrypted.' })).toBe(true);
  });
});

async function readOutlineTitles(bytes, topOnly = false) {
  const d = await PDFDocument.load(bytes);
  const refIdx = new Map(d.getPages().map((p, i) => [p.ref.toString(), i]));
  const root = d.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const out = [];
  const walk = (ref) => {
    while (ref) {
      const n = d.context.lookup(ref);
      out.push([n.lookup(PDFName.of('Title')).decodeText(), refIdx.get(n.lookup(PDFName.of('Dest'), PDFArray).get(0).toString())]);
      if (!topOnly && n.get(PDFName.of('First'))) walk(n.get(PDFName.of('First')));
      ref = n.get(PDFName.of('Next'));
    }
  };
  walk(root.get(PDFName.of('First')));
  return out;
}
