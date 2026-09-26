/* PDF 나누기의 순수 로직: 쪽 범위 해석, N쪽씩 나누기, 고른 쪽 묶기, 결과 파일 이름.
   쪽 번호는 사람이 보는 1부터, 범위 { from, to } 는 양끝 포함. */
import { assemblePdf, prepareSource } from './pdf-merge.js';

/** 한 번에 만들 수 있는 파일 수 상한(휴대폰 메모리·zip 크기를 생각한 값). */
export const MAX_OUTPUTS = 500;

/**
 * "1-3, 5, 8-" 같은 범위 글을 해석한다.
 * - 쉼표·세미콜론·줄바꿈으로 구분. "8-" 은 8쪽부터 끝까지, "-3" 은 처음부터 3쪽까지.
 * - 물결(~)·여러 가지 대시도 범위로 받는다. "끝"·"end"·"last" 는 마지막 쪽.
 * 돌려주는 값: { ranges: [{ from, to }], errors: [{ part, message }] }
 */
export function parseRanges(input, pageCount) {
  const ranges = [], errors = [];
  const src = String(input ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))   // 전각 숫자
    .replace(/[~～〜–—−‐‑]/g, '-')
    .replace(/(끝|마지막|end|last)/gi, String(pageCount))
    .replace(/쪽|페이지|p\.?/gi, '')
    .replace(/\s*-\s*/g, '-');
  const parts = src.split(/[,;，、\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d*)-(\d*)$|^(\d+)$/);
    if (!m || (m[1] === '' && m[2] === '' && m[3] === undefined)) { errors.push({ part, message: '형식을 알 수 없습니다' }); continue; }
    let from, to;
    if (m[3] !== undefined) from = to = Number(m[3]);
    else { from = m[1] === '' ? 1 : Number(m[1]); to = m[2] === '' ? pageCount : Number(m[2]); }
    if (from < 1 || to < 1) { errors.push({ part, message: '쪽 번호는 1부터입니다' }); continue; }
    if (from > pageCount || to > pageCount) { errors.push({ part, message: `문서는 ${pageCount}쪽까지 있습니다` }); continue; }
    if (from > to) { errors.push({ part, message: '앞 번호가 뒤 번호보다 큽니다' }); continue; }
    ranges.push({ from, to });
  }
  return { ranges, errors };
}

/** N쪽씩 나누기. 마지막 묶음은 모자랄 수 있다. */
export function planEvery(pageCount, n) {
  const size = Math.floor(Number(n));
  if (!(size >= 1) || pageCount < 1) return [];
  const out = [];
  for (let from = 1; from <= pageCount; from += size) out.push({ from, to: Math.min(pageCount, from + size - 1) });
  return out;
}

/** 고른 쪽 번호(1부터) → 이어진 구간들. [1,2,3,7,9,10] → [{1,3},{7,7},{9,10}] */
export function groupConsecutive(pageNumbers) {
  const s = [...new Set(pageNumbers.map(Number))].filter((x) => x >= 1).sort((a, b) => a - b);
  const out = [];
  for (const p of s) {
    const last = out[out.length - 1];
    if (last && p === last.to + 1) last.to = p; else out.push({ from: p, to: p });
  }
  return out;
}

/** 범위 → 쪽 번호 목록(0부터, pdf-lib 용). */
export function rangeIndices(r) {
  const out = [];
  for (let p = r.from; p <= r.to; p++) out.push(p - 1);
  return out;
}

export function rangeLabel(r) { return r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`; }

/** 구간 여러 개를 사람이 읽는 글로: "1-3, 7, 9-10" */
export function describeRanges(ranges) { return ranges.map(rangeLabel).join(', '); }

/**
 * 결과 파일 계획.
 * mode 'ranges' | 'every': 범위마다 파일 하나
 * mode 'pick-one': 고른 쪽을 파일 하나로, 'pick-each': 고른 쪽마다 파일 하나
 * 돌려주는 값: [{ name, pages: [0부터 쪽 번호], label }]
 */
export function planOutputs(base, pageCount, mode, value) {
  const width = String(pageCount).length;
  const pad = (n) => String(n).padStart(width, '0');
  const name = (r) => `${base}_${r.from === r.to ? `p${pad(r.from)}` : `p${pad(r.from)}-${pad(r.to)}`}.pdf`;
  let groups;
  if (mode === 'ranges') groups = value.map((r) => ({ label: rangeLabel(r), pages: rangeIndices(r), name: name(r) }));
  else if (mode === 'every') groups = planEvery(pageCount, value).map((r) => ({ label: rangeLabel(r), pages: rangeIndices(r), name: name(r) }));
  else if (mode === 'pick-each') groups = groupConsecutive(value).flatMap(rangeIndices).map((i) => ({ label: `${i + 1}`, pages: [i], name: name({ from: i + 1, to: i + 1 }) }));
  else if (mode === 'pick-one') {
    const g = groupConsecutive(value);
    if (!g.length) return [];
    groups = [{ label: describeRanges(g), pages: g.flatMap(rangeIndices), name: g.length === 1 ? name(g[0]) : `${base}_선택${g.reduce((n, r) => n + r.to - r.from + 1, 0)}쪽.pdf` }];
  } else throw new Error(`알 수 없는 방식: ${mode}`);
  return uniqueNames(groups);
}

/** 같은 이름이 나오면 (2), (3) 을 붙인다. */
export function uniqueNames(groups) {
  const used = new Map();
  return groups.map((g) => {
    const n = used.get(g.name) || 0;
    used.set(g.name, n + 1);
    return n ? { ...g, name: g.name.replace(/\.pdf$/, ` (${n + 1}).pdf`) } : g;
  });
}

/** 각 쪽(0부터)이 몇 번째 결과 파일에 들어가는지. 화면에서 쪽 그림 옆에 번호를 붙일 때 쓴다. */
export function pageMembership(outputs, pageCount) {
  const m = Array.from({ length: pageCount }, () => []);
  outputs.forEach((o, k) => o.pages.forEach((p) => { if (m[p]) m[p].push(k); }));
  return m;
}

/**
 * 실제로 나누기. doc 은 pdf-lib 문서(loadPdf 로 연 것) 또는 prepareSource 결과, outputs 는 planOutputs 결과.
 * 같은 문서로 여러 번 나눌 때는 prepareSource 결과를 넘긴다(준비 과정이 원본 링크 정보를 떼어 내므로 한 번만).
 * 책갈피는 그 파일에 들어간 쪽을 가리키는 것만 남기고, 문서 안 링크도 같은 파일 안이면 이어 둔다.
 */
export async function splitPdf(doc, outputs, onProgress = () => {}) {
  const prepared = doc.links instanceof Map ? doc : prepareSource(doc);
  const sources = new Map([['src', { kind: 'pdf', prepared }]]);
  const files = [];
  for (let i = 0; i < outputs.length; i++) {
    onProgress(i, outputs.length);
    const o = outputs[i];
    const r = await assemblePdf(sources, o.pages.map((page) => ({ file: 'src', page, rotate: 0 })), { keepOutline: true });
    files.push({ name: o.name, bytes: r.bytes, pages: o.pages.length, outlineCount: r.outlineCount });
  }
  return files;
}
