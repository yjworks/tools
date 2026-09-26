/* PDF 합치기(그리고 나누기)의 순수 로직과 pdf-lib 조립기. 화면(DOM)과 떨어져 있어 테스트한다.
   - 쪽 목록 다루기: 옮기기, 파일 순서로 다시 모으기, 돌리기
   - 책갈피(outline) 읽기 → 남은 쪽에 맞춰 다시 쓰기
   - 문서 안 링크(목차 클릭 → 쪽 이동)를 새 쪽 번호로 다시 잇기
   pdf-lib 는 copyPages 로 쪽만 옮기고 책갈피·문서 안 링크는 옮기지 않으므로 그 부분을 여기서 직접 한다. */
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFNull, PDFHexString, PDFString, degrees } from 'pdf-lib';
import { removeUnreachable } from './pdf-compress.js';

/* ---------- 쪽 목록(순수) ---------- */

/** 배열에서 from 자리 항목을 to 자리로 옮긴 새 배열. */
export function moveItem(list, from, to) {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}

/**
 * 고른 항목들(keys)을 한 덩어리로 target 자리 앞에 끼운다. target 은 옮기기 전 목록의 자리(0~length).
 * 끌어다 놓기에 쓴다. 항목에는 key 가 있어야 한다.
 */
export function moveBlock(list, keys, target) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const moving = list.filter((x) => set.has(x.key));
  if (!moving.length) return list.slice();
  const before = list.slice(0, Math.max(0, Math.min(list.length, target))).filter((x) => !set.has(x.key)).length;
  const rest = list.filter((x) => !set.has(x.key));
  rest.splice(before, 0, ...moving);
  return rest;
}

/**
 * 고른 항목들을 한 칸 앞(-1)이나 뒤(+1)로. 버튼으로 옮길 때 쓴다.
 * 이미 맨 앞(뒤)에 붙은 항목은 그 자리에 둔다.
 */
export function shiftKeys(list, keys, dir) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const out = list.slice();
  const idx = out.map((x, i) => (set.has(x.key) ? i : -1)).filter((i) => i >= 0);
  if (dir < 0) {
    let wall = 0;
    for (const i of idx) { if (i > wall && !set.has(out[i - 1].key)) { [out[i - 1], out[i]] = [out[i], out[i - 1]]; } else wall = i + 1; }
  } else {
    let wall = out.length - 1;
    for (const i of idx.reverse()) { if (i < wall && !set.has(out[i + 1].key)) { [out[i + 1], out[i]] = [out[i], out[i + 1]]; } else wall = i - 1; }
  }
  return out;
}

/** 파일 목록 → 쪽 목록. files: [{ id, pageCount }] */
export function pagesFromFiles(files) {
  const pages = [];
  for (const f of files) for (let i = 0; i < f.pageCount; i++) pages.push({ key: `${f.id}:${i}`, file: f.id, page: i, rotate: 0 });
  return pages;
}

/** 파일 순서를 바꾼 뒤 쪽을 파일별로 다시 모은다. 한 파일 안의 쪽 순서·회전은 그대로 둔다. */
export function regroupByFiles(pages, fileOrder) {
  const rank = new Map(fileOrder.map((id, i) => [id, i]));
  return pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => rank.has(p.file))
    .sort((a, b) => rank.get(a.p.file) - rank.get(b.p.file) || a.i - b.i)
    .map(({ p }) => p);
}

/** 각도를 0·90·180·270 으로 맞춘다. */
export function normRotation(deg) {
  const d = Math.round(Number(deg) / 90) * 90;
  return ((d % 360) + 360) % 360;
}

export function rotatePage(page, delta) {
  return { ...page, rotate: normRotation((page.rotate || 0) + delta) };
}

/** 합칠 결과를 한 줄로 요약: 파일 수, 쪽 수, 돌린 쪽 수 */
export function summarize(pages) {
  return {
    pages: pages.length,
    files: new Set(pages.map((p) => p.file)).size,
    rotated: pages.filter((p) => normRotation(p.rotate) !== 0).length,
  };
}

/** 파일 이름에 쓸 수 없는 글자를 바꾸고, 비었으면 기본값. */
export function safeFileName(name, fallback = '합친문서') {
  const s = String(name || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);
  return s || fallback;
}

/**
 * 책갈피 나무를 남은 쪽에 맞춘다.
 * items: [{ title, page: 원래 쪽 번호(0부터) 또는 null, open, rest, children }]
 * keep: 원래 쪽 번호 → 새 쪽 번호(0부터) Map. 없는 쪽을 가리키는 항목은 버리되,
 * 자식이 남으면 첫 자식의 쪽을 가리키게 바꿔 남긴다.
 */
export function remapOutline(items, keep) {
  const out = [];
  for (const it of items || []) {
    const children = remapOutline(it.children, keep);
    let page = it.page != null && keep.has(it.page) ? keep.get(it.page) : null;
    let rest = page != null ? it.rest : null;
    if (page == null && children.length) { page = children[0].page; rest = null; }
    if (page == null) continue;
    out.push({ title: it.title, page, open: !!it.open, rest, children });
  }
  return out;
}

export function countOutline(items) {
  return (items || []).reduce((n, it) => n + 1 + countOutline(it.children), 0);
}

/* ---------- pdf-lib 부분 ---------- */

export function isEncryptedError(e) {
  return e?.constructor?.name === 'EncryptedPDFError' || /is encrypted/i.test(String(e?.message || ''));
}

/** PDF 읽기. 암호 걸린 파일은 { encrypted: true } 오류를 던진다. */
export async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (isEncryptedError(e)) { const err = new Error('encrypted'); err.encrypted = true; throw err; }
    throw e;
  }
}

const N = (s) => PDFName.of(s);
const text = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : null);

/** 이름 붙은 목적지(named destination) 표 만들기: 옛 /Dests 사전과 /Names /Dests 이름 나무 둘 다. */
function namedDests(doc) {
  const map = new Map();
  const ctx = doc.context, cat = doc.catalog;
  const old = cat.lookupMaybe(N('Dests'), PDFDict);
  if (old) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  const names = cat.lookupMaybe(N('Names'), PDFDict);
  const root = names?.lookupMaybe(N('Dests'), PDFDict);
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || depth > 32 || seen.has(node)) return;
    seen.add(node);
    const arr = node.lookupMaybe(N('Names'), PDFArray);
    if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) {
      const k = text(ctx.lookup(arr.get(i)));
      if (k != null) map.set(k, arr.get(i + 1));
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(ctx.lookup(kids.get(i)), depth + 1);
  };
  walk(root, 0);
  return map;
}

/** 목적지(배열·이름·GoTo 동작)를 { page, rest } 로 푼다. 못 풀면 null. */
function resolveDest(doc, refIndex, names, destObj) {
  const ctx = doc.context;
  let d = destObj instanceof PDFRef ? ctx.lookup(destObj) : destObj;
  for (let hop = 0; hop < 4 && d; hop++) {
    if (d instanceof PDFArray) {
      const first = d.get(0);
      let page = null;
      if (first instanceof PDFRef) page = refIndex.get(first.toString()) ?? null;
      else if (first instanceof PDFNumber) page = first.asNumber();   // 잘못 만든 파일이 쪽 번호를 바로 쓰는 경우
      if (page == null) return null;
      const rest = [];
      for (let i = 1; i < d.size(); i++) {
        const v = d.get(i);
        rest.push(v instanceof PDFName ? { name: v.decodeText() } : v instanceof PDFNumber ? v.asNumber() : null);
      }
      return { page, rest };
    }
    if (d instanceof PDFDict) { d = d.get(N('D')); if (d instanceof PDFRef) d = ctx.lookup(d); continue; }
    const key = text(d);
    if (key == null || !names.has(key)) return null;
    d = names.get(key);
    if (d instanceof PDFRef) d = ctx.lookup(d);
  }
  return null;
}

/** 링크·책갈피가 쓰는 동작/목적지를 꺼낸다. 문서 안 이동이 아니면 null(웹 주소 링크 등은 그대로 둔다). */
function internalTarget(doc, refIndex, names, dict) {
  const dest = dict.get(N('Dest'));
  if (dest) return { dest: resolveDest(doc, refIndex, names, dest), internal: true };
  const a = dict.lookupMaybe(N('A'), PDFDict);
  if (a && a.get(N('S')) === N('GoTo')) return { dest: resolveDest(doc, refIndex, names, a.get(N('D'))), internal: true };
  return { dest: null, internal: false };
}

function readOutline(doc, refIndex, names) {
  const ctx = doc.context;
  const root = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  const seen = new Set();
  let budget = 20000;
  const level = (first, depth) => {
    const items = [];
    let ref = first;
    while (ref && budget-- > 0 && depth < 40) {
      const key = ref instanceof PDFRef ? ref.toString() : null;
      if (key && seen.has(key)) break;
      if (key) seen.add(key);
      const node = ctx.lookup(ref);
      if (!(node instanceof PDFDict)) break;
      const title = text(node.lookup(N('Title'))) ?? '';
      const { dest } = internalTarget(doc, refIndex, names, node);
      const count = node.lookup(N('Count'));
      items.push({
        title: title.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''),
        page: dest ? dest.page : null,
        rest: dest ? dest.rest : null,
        open: count instanceof PDFNumber ? count.asNumber() > 0 : false,
        children: level(node.get(N('First')), depth + 1),
      });
      ref = node.get(N('Next'));
    }
    return items;
  };
  return root ? level(root.get(N('First')), 0) : [];
}

/**
 * 원본 문서를 합치기용으로 준비한다(문서마다 한 번).
 * 링크 주석에서 문서 안 목적지와 /P(자기 쪽 참조)를 떼어 두어, 쪽을 복사할 때 원본의 다른 쪽이 딸려오지 않게 한다.
 */
export function prepareSource(doc) {
  const pages = doc.getPages();
  const refIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const names = namedDests(doc);
  const outline = readOutline(doc, refIndex, names);
  const links = new Map();   // 쪽 번호 → [{ at, dest|null, hadP }]
  let internalLinks = 0;
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    const list = [];
    for (let k = 0; k < annots.size(); k++) {
      const a = doc.context.lookup(annots.get(k));
      if (!(a instanceof PDFDict)) continue;
      const hadP = a.has(N('P'));
      if (hadP) a.delete(N('P'));
      if (a.get(N('Subtype')) === N('Link')) {
        const t = internalTarget(doc, refIndex, names, a);
        if (t.internal) {
          internalLinks++;
          a.delete(N('Dest'));
          a.delete(N('A'));
          list.push({ at: k, dest: t.dest, hadP });
          continue;
        }
      }
      if (hadP) list.push({ at: k, dest: undefined, hadP });
    }
    if (list.length) links.set(i, list);
  });
  return { doc, pageCount: pages.length, outline, links, internalLinks };
}

function destArray(ctx, pageRef, rest) {
  const arr = [pageRef];
  const r = rest && rest.length ? rest : [{ name: 'XYZ' }, null, null, null];
  for (const v of r) arr.push(v && typeof v === 'object' ? N(v.name) : typeof v === 'number' ? PDFNumber.of(v) : PDFNull);
  return ctx.obj(arr);
}

/** 책갈피 나무를 새 문서에 쓴다. items 의 page 는 새 문서 쪽 번호. */
function writeOutline(out, items) {
  if (!items.length) return;
  const ctx = out.context;
  const pageRefs = out.getPages().map((p) => p.ref);
  const rootRef = ctx.nextRef();
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((it, i) => {
      const d = ctx.obj({});
      d.set(N('Title'), PDFHexString.fromText(it.title || '(제목 없음)'));
      d.set(N('Parent'), parentRef);
      if (i > 0) d.set(N('Prev'), refs[i - 1]);
      if (i < list.length - 1) d.set(N('Next'), refs[i + 1]);
      d.set(N('Dest'), destArray(ctx, pageRefs[it.page], it.rest));
      if (it.children.length) {
        const sub = build(it.children, refs[i]);
        d.set(N('First'), sub.first);
        d.set(N('Last'), sub.last);
        d.set(N('Count'), PDFNumber.of(it.open ? sub.visible : -it.children.length));
        if (it.open) visible += sub.visible;
      }
      ctx.assign(refs[i], d);
      visible += 1;
    });
    return { first: refs[0], last: refs[refs.length - 1], visible };
  };
  const top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }));
  out.catalog.set(N('Outlines'), rootRef);
  out.catalog.set(N('PageMode'), N('UseOutlines'));
}

const A4 = [595.28, 841.89];

/** 사진 한 장을 쪽으로. fit: 'a4'(A4 에 맞춤, 가로 사진은 가로 쪽) | 'image'(사진 크기, 96dpi 기준) */
async function addImagePage(out, src) {
  const img = src.type === 'png' ? await out.embedPng(src.bytes) : await out.embedJpg(src.bytes);
  if (src.fit === 'image') {
    const w = img.width * 0.75, hgt = img.height * 0.75;
    const p = out.addPage([w, hgt]);
    p.drawImage(img, { x: 0, y: 0, width: w, height: hgt });
    return p;
  }
  let [pw, ph] = A4;
  if (img.width > img.height) [pw, ph] = [ph, pw];
  const m = 18, s = Math.min((pw - m * 2) / img.width, (ph - m * 2) / img.height);
  const w = img.width * s, hgt = img.height * s;
  const p = out.addPage([pw, ph]);
  p.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
  return p;
}

/**
 * 쪽들을 새 PDF 로 조립한다.
 * sources: Map(id → { kind: 'pdf', prepared } | { kind: 'image', bytes, type: 'jpg'|'png', fit, name })
 * pages: [{ file, page, rotate }]  (rotate 는 원래 회전에 더할 각도)
 * options: { keepOutline = true, fileBookmarks = false, titles: Map(id → 책갈피 제목) }
 */
export async function assemblePdf(sources, pages, options = {}) {
  const { keepOutline = true, fileBookmarks = false, titles = new Map(), producer = 'DigitalBrain 도구 (dibrain.dev/tools)' } = options;
  const out = await PDFDocument.create({ updateMetadata: false });
  const ctx = out.context;

  // 원본마다 필요한 쪽을 한 번에 복사해야 글꼴·그림 같은 공유 자원이 두 번 들어가지 않는다.
  const need = new Map();
  for (const p of pages) {
    const s = sources.get(p.file);
    if (!s) throw new Error(`없는 파일: ${p.file}`);
    if (s.kind === 'pdf') { if (!need.has(p.file)) need.set(p.file, new Set()); need.get(p.file).add(p.page); }
  }
  const copied = new Map();   // `${file}:${page}` → PDFPage
  for (const [id, set] of need) {
    const idx = [...set];
    const got = await out.copyPages(sources.get(id).prepared.doc, idx);
    idx.forEach((pi, k) => copied.set(`${id}:${pi}`, got[k]));
  }

  const newIndex = new Map();   // file → Map(원래 쪽 → 새 쪽)
  const firstPageOf = new Map();
  for (let i = 0; i < pages.length; i++) {
    const { file, page, rotate = 0 } = pages[i];
    const s = sources.get(file);
    let pg;
    if (s.kind === 'pdf') {
      pg = copied.get(`${file}:${page}`);
      out.addPage(pg);
      pg.setRotation(degrees(normRotation(pg.getRotation().angle + rotate)));
    } else {
      pg = await addImagePage(out, s);
      if (normRotation(rotate)) pg.setRotation(degrees(normRotation(rotate)));
    }
    if (!newIndex.has(file)) newIndex.set(file, new Map());
    newIndex.get(file).set(page, i);
    if (!firstPageOf.has(file)) firstPageOf.set(file, i);
  }

  // 문서 안 링크를 새 쪽에 다시 잇는다. 가리키던 쪽이 빠졌으면 링크 영역을 지운다.
  let linksKept = 0, linksDropped = 0;
  for (const [id, set] of need) {
    const prep = sources.get(id).prepared, map = newIndex.get(id);
    for (const pi of set) {
      const list = prep.links.get(pi);
      if (!list) continue;
      const pg = copied.get(`${id}:${pi}`);
      const annots = pg.node.Annots();
      if (!annots) continue;
      const drop = [];
      for (const l of list) {
        const a = ctx.lookup(annots.get(l.at));
        if (!(a instanceof PDFDict)) continue;
        if (l.hadP) a.set(N('P'), pg.ref);
        if (l.dest === undefined) continue;
        if (l.dest && map.has(l.dest.page)) {
          a.set(N('Dest'), destArray(ctx, out.getPage(map.get(l.dest.page)).ref, l.dest.rest));
          linksKept++;
        } else { drop.push(l.at); linksDropped++; }
      }
      for (const at of drop.sort((x, y) => y - x)) annots.remove(at);
    }
  }

  // 책갈피
  let outline = [];
  const order = [...firstPageOf.keys()];
  for (const id of order) {
    const s = sources.get(id);
    const own = keepOutline && s.kind === 'pdf' ? remapOutline(s.prepared.outline, newIndex.get(id)) : [];
    if (fileBookmarks) outline.push({ title: titles.get(id) || String(id), page: firstPageOf.get(id), open: false, rest: null, children: own });
    else outline.push(...own);
  }
  writeOutline(out, outline);

  out.setProducer(producer);
  out.setCreator(producer);
  const now = new Date();
  out.setCreationDate(now);
  out.setModificationDate(now);
  removeUnreachable(out);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pageCount: pages.length, outlineCount: countOutline(outline), linksKept, linksDropped };
}
