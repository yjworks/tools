/* STEP·IGES 뷰어: occt-import-js 결과(JSON)를 부품별 통계로 바꾼다.
   occt-import-js 는 linearUnit 을 millimeter 로 주면(기본값) 파일 안의 단위(inch, m 등)를 mm 로 바꿔서 돌려준다. */
import { meshStats } from './stl.js';

/** 파일 형식: 확장자 우선, 없으면 내용 앞부분으로 짐작. 'step' | 'iges' | 'brep' | null */
export function detectFormat(fileName, head = '') {
  const ext = (String(fileName).match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  if (ext === 'step' || ext === 'stp' || ext === 'p21') return 'step';
  if (ext === 'iges' || ext === 'igs') return 'iges';
  if (ext === 'brep' || ext === 'brp') return 'brep';
  const s = String(head).slice(0, 400);
  if (/ISO-10303-21/.test(s)) return 'step';
  const first = s.split(/\r?\n/)[0] || '';
  if (first.length >= 73 && first[72] === 'S') return 'iges';
  if (/^DBRep_DrawableShape/.test(s)) return 'brep';
  return null;
}

/** 인덱스가 있는 메시를 삼각형마다 꼭짓점 3개를 늘어놓은 좌표로 풀어 쓴다 (meshStats 입력 형식). */
export function expandIndexed(position, index) {
  if (!index || !index.length) return Float32Array.from(position);
  const out = new Float32Array(index.length * 3);
  for (let i = 0; i < index.length; i++) {
    const v = index[i] * 3;
    out[i * 3] = position[v]; out[i * 3 + 1] = position[v + 1]; out[i * 3 + 2] = position[v + 2];
  }
  return out;
}

/**
 * 닫힌 메시인지: 좌표가 같은 꼭짓점을 하나로 보고(면마다 꼭짓점이 따로 있어도), 모든 모서리를
 * 정확히 두 삼각형이 나눠 쓰면 닫힌 것으로 본다. 부피 계산은 닫힌 메시에서만 믿을 수 있다.
 */
export function isClosed(position, index, tol = 1e-4) {
  const n = index && index.length ? index.length : position.length / 3;
  const vid = new Map(); const ids = new Int32Array(position.length / 3);
  for (let v = 0; v < ids.length; v++) {
    const key = `${Math.round(position[v * 3] / tol)},${Math.round(position[v * 3 + 1] / tol)},${Math.round(position[v * 3 + 2] / tol)}`;
    let id = vid.get(key); if (id == null) { id = vid.size; vid.set(key, id); }
    ids[v] = id;
  }
  const at = (i) => ids[index && index.length ? index[i] : i];
  const edges = new Map(); const V = vid.size;
  for (let i = 0; i + 2 < n; i += 3) {
    const t = [at(i), at(i + 1), at(i + 2)];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue; // 넓이 0인 삼각형은 건너뜀
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? a * V + b : b * V + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  if (!edges.size) return false;
  for (const c of edges.values()) if (c !== 2) return false;
  return true;
}

/** 트리를 돌며 메시 번호 → { path: 속한 노드 이름 경로, k: 그 노드 안에서 몇 번째, of: 노드의 메시 수 } */
export function meshNames(root) {
  const names = new Map();
  const walk = (node, path) => {
    if (!node) return;
    const here = node.name ? [...path, node.name] : path;
    const list = node.meshes || [];
    list.forEach((m, k) => names.set(m, { path: here, k: k + 1, of: list.length }));
    for (const c of node.children || []) walk(c, here);
  };
  walk(root, []);
  return names;
}

const GENERIC = /^(solid|body|shell|part|open\s?cascade.*|\(unsaved\))?\s*\d*$/i;

/** 부품 이름: 노드에 메시가 하나면 노드 이름, 여러 개면 메시 이름(뜻이 있을 때) 또는 "노드 이름 #번호" */
export function partName(info, meshName, i) {
  const node = info?.path?.[info.path.length - 1];
  const own = meshName && !GENERIC.test(meshName.trim()) ? meshName.trim() : '';
  if (info && info.of > 1) return own || (node ? `${node} #${info.k}` : `부품 ${i + 1}`);
  return node || own || meshName || `부품 ${i + 1}`;
}

/**
 * occt 결과 → 부품 목록. 좌표는 mm.
 * 각 부품: { index, name, path, triangles, volume(mm³), area(mm²), size[mm], closed, color }
 */
export function partsFromResult(result) {
  if (!result || !result.success) throw new Error('파일을 해석하지 못했습니다.');
  const names = meshNames(result.root);
  return (result.meshes || []).map((m, i) => {
    const position = m.attributes?.position?.array || m.position || [];
    const index = m.index?.array || m.index || null;
    const s = meshStats(expandIndexed(position, index));
    const info = names.get(i);
    return {
      index: i, name: partName(info, m.name, i), path: (info?.path || []).join(' / '), meshName: m.name || '',
      triangles: s.triangles, volume: s.volume, area: s.area, size: s.size, signed: s.signed,
      closed: isClosed(position, index), color: m.color || null,
    };
  });
}

/** 여러 부품 합계. size 는 전체 좌표 범위가 따로 필요하므로 여기서는 부피·겉넓이·삼각형만 더한다. */
export function sumParts(parts) {
  return parts.reduce((a, p) => ({ volume: a.volume + p.volume, area: a.area + p.area, triangles: a.triangles + p.triangles, open: a.open + (p.closed ? 0 : 1) }),
    { volume: 0, area: 0, triangles: 0, open: 0 });
}

/** 여러 좌표 배열 전체의 크기(가로·세로·높이, mm) */
export function boundsSize(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) for (let i = 0; i + 2 < p.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
  }
  return min[0] === Infinity ? [0, 0, 0] : max.map((v, k) => v - min[k]);
}
