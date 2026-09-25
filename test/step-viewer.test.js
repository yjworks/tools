import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { detectFormat, expandIndexed, isClosed, meshNames, partName, partsFromResult, sumParts, boundsSize } from '../src/_shared/step-viewer.js';

const require = createRequire(import.meta.url);
const TF = new URL('../node_modules/occt-import-js/test/testfiles/', import.meta.url).pathname;
let occt;
beforeAll(async () => { occt = await require('occt-import-js')(); }, 60000);
const read = (fmt, f) => occt.ReadFile(fmt, readFileSync(TF + f), null);

// 한 변 10 인 정육면체 (꼭짓점 8개, 삼각형 12개, 인덱스 방식)
const P = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

describe('STEP 뷰어 — 순수 계산', () => {
  it('형식 알아내기', () => {
    expect(detectFormat('a.STEP')).toBe('step');
    expect(detectFormat('a.stp')).toBe('step');
    expect(detectFormat('b.IGS')).toBe('iges');
    expect(detectFormat('b.iges')).toBe('iges');
    expect(detectFormat('c.brep')).toBe('brep');
    expect(detectFormat('model', 'ISO-10303-21;\nHEADER;')).toBe('step');
    expect(detectFormat('model', ' '.repeat(72) + 'S      1\n')).toBe('iges');
    expect(detectFormat('photo.jpg', 'xyz')).toBe(null);
  });
  it('인덱스 풀기 + 닫힘 판정', () => {
    const flat = expandIndexed(P, I);
    expect(flat.length).toBe(36 * 3);
    expect(isClosed(P, I)).toBe(true);
    expect(isClosed(P, I.slice(0, 33))).toBe(false);         // 삼각형 하나 빠짐
    expect(isClosed(flat, null)).toBe(true);                  // 인덱스 없이 좌표로 합쳐도 닫힘
  });
  it('부품 목록: 이름은 트리의 노드 이름', () => {
    const result = { success: true, root: { name: '', meshes: [], children: [{ name: 'BOX', meshes: [0], children: [] }] }, meshes: [{ name: 'SOLID', attributes: { position: { array: P } }, index: { array: I }, color: [1, 0, 0] }] };
    const [p] = partsFromResult(result);
    expect(p.name).toBe('BOX');
    expect(p.volume).toBeCloseTo(1000, 6);
    expect(p.area).toBeCloseTo(600, 6);
    expect(p.closed).toBe(true);
    expect(p.triangles).toBe(12);
    expect(meshNames(result.root).get(0)).toEqual({ path: ['BOX'], k: 1, of: 1 });
  });
  it('부품 이름 규칙', () => {
    expect(partName({ path: ['ASM', 'PLATE'], k: 1, of: 1 }, 'SOLID', 0)).toBe('PLATE');
    expect(partName({ path: ['ASM', 'BRACKET'], k: 2, of: 7 }, 'SOLID', 3)).toBe('BRACKET #2');
    expect(partName({ path: ['ASM', 'rod-assembly'], k: 2, of: 3 }, 'bolt', 3)).toBe('bolt');
    expect(partName({ path: [], k: 1, of: 1 }, 'Solid1', 0)).toBe('Solid1');
    expect(partName(undefined, '', 4)).toBe('부품 5');
    expect(() => partsFromResult({ success: false })).toThrow();
  });
  it('워커가 넘기는 형식(typed array)도 읽는다', () => {
    const [p] = partsFromResult({ success: true, root: { meshes: [0] }, meshes: [{ position: Float32Array.from(P), index: Uint32Array.from(I) }] });
    expect(p.volume).toBeCloseTo(1000, 3);
    expect(p.name).toBe('부품 1');
  });
  it('합계·전체 크기', () => {
    const s = sumParts([{ volume: 1, area: 2, triangles: 3, closed: true }, { volume: 4, area: 5, triangles: 6, closed: false }]);
    expect(s).toEqual({ volume: 5, area: 7, triangles: 9, open: 1 });
    expect(boundsSize([[0, 0, 0, 1, 2, 3], [-1, 0, 0]])).toEqual([2, 2, 3]);
  });
});

describe('STEP 뷰어 — occt-import-js 실제 파일', () => {
  it('10mm 정육면체 STEP: 부피 1000 mm³', () => {
    const parts = partsFromResult(read('step', 'cube-10x10mm/Cube 10x10.stp'));
    expect(parts).toHaveLength(1);
    expect(parts[0].volume).toBeCloseTo(1000, 1);
    expect(parts[0].size.map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 10, 10]);
    expect(parts[0].closed).toBe(true);
  });
  it('10mm 정육면체 IGES', () => {
    const parts = partsFromResult(read('iges', 'cube-10x10mm/Cube 10x10.igs'));
    const t = sumParts(parts);
    expect(t.volume).toBeCloseTo(1000, 0);
  });
  it('단위가 다른 STEP(inch, m, mm) 도 mm 로 나온다', () => {
    const sizes = ['cube-in.step', 'cube-m.step', 'cube-mm.step'].map((f) => partsFromResult(read('step', 'cube-units/' + f))[0].size);
    expect(sizes[2][0]).toBeGreaterThan(1);
    // 세 파일은 같은 모양을 서로 다른 단위로 저장한 것 → mm 로 바꾸면 크기가 같다
    for (const s of sizes) for (let k = 0; k < 3; k++) expect(s[k]).toBeCloseTo(sizes[2][k], 1);
  });
  it('조립품: 부품 여러 개, 이름 있음, 모두 닫힘', () => {
    const parts = partsFromResult(read('step', 'cax-if/as1_pe_203.stp'));
    expect(parts).toHaveLength(18);
    expect(parts[0].name).toBe('PLATE');
    expect(parts[1].name).toBe('L_BRACKET_ASSEMBLY_ASM #1');
    const oc = partsFromResult(read('step', 'cax-if/as1-oc-214.stp')).map((p) => p.name);
    expect(oc).toContain('bolt');
    expect(oc).toContain('plate');
    expect(parts.every((p) => p.volume > 0)).toBe(true);
    expect(parts.filter((p) => p.closed).length).toBeGreaterThanOrEqual(16);
  });
  it('둥근 모서리 정육면체: 곡면도 삼각형으로 근사해 부피가 나온다', () => {
    const [p] = partsFromResult(read('step', 'rounded-cube/rounded-cube.step'));
    expect(p.volume).toBeGreaterThan(0);
    expect(p.closed).toBe(true);
  });
});
