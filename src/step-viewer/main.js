import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// occt-import-js(LGPL-2.1)는 번들에 섞지 않고 원본 파일 그대로 따로 내보낸 뒤 주소로 불러 쓴다
import occtJsUrl from 'occt-import-js/dist/occt-import-js.js?url';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { $, h, fileDrop, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { estimatePrint, MATERIALS } from '../_shared/stl.js';
import { detectFormat, partsFromResult, sumParts, boundsSize } from '../_shared/step-viewer.js';

const JS_URL = new URL(occtJsUrl, location.href).href;
const WASM_URL = new URL(occtWasmUrl, location.href).href;
const PALETTE = [0x7aa2ff, 0xf59e0b, 0x34d399, 0xf87171, 0xa78bfa, 0x22d3ee, 0xf472b6, 0xa3e635, 0xfbbf24, 0x60a5fa];

const view = $('#view'), status = $('#status'), statsEl = $('#stats'), busy = $('#busy');
const partsEl = $('#parts'), partsBox = $('#partsBox'), matSel = $('#mat');
for (const [k, v] of Object.entries(MATERIALS)) matSel.append(h('option', { value: k }, `${k} (${v} g/cm³)`));

let renderer = null, scene, camera, controls, group = null, home = null;
let parts = [], meshes = [], included = [], selected = -1, working = false;

/* ---------- 해석: 워커 우선, 안 되면 메인 스레드 ---------- */
let worker = null;
function parseInWorker(format, buffer, onStage) {
  return new Promise((resolve, reject) => {
    try { worker ||= new Worker(new URL('./occt-worker.js', import.meta.url)); } catch (e) { reject(Object.assign(e, { noWorker: true })); return; }
    const w = worker;
    const done = () => { w.onmessage = null; w.onerror = null; };
    w.onmessage = (ev) => {
      const d = ev.data;
      if (d.type === 'progress') onStage(d.stage);
      else if (d.type === 'done') { done(); resolve(d.result); }
      else { done(); w.terminate(); worker = null; reject(new Error(d.message === 'parse' ? 'parse' : d.message)); }
    };
    w.onerror = (ev) => { ev.preventDefault?.(); done(); w.terminate(); worker = null; reject(Object.assign(new Error(ev.message || 'worker'), { noWorker: true })); };
    w.postMessage({ jsUrl: JS_URL, wasmUrl: WASM_URL, format, buffer, params: { linearUnit: 'millimeter' } }, [buffer]);
  });
}

let mainOcct = null;
async function parseOnMain(format, buffer, onStage) {
  if (!mainOcct) {
    onStage('engine');
    if (!window.occtimportjs) {
      await new Promise((res, rej) => document.head.append(h('script', { src: JS_URL, onload: res, onerror: () => rej(new Error('엔진 파일을 받지 못했습니다')) })));
    }
    mainOcct = window.occtimportjs({ locateFile: (p) => (p.endsWith('.wasm') ? WASM_URL : p) });
  }
  const occt = await mainOcct;
  onStage('parse-main');
  await new Promise((r) => setTimeout(r, 50)); // 안내 문구가 먼저 그려지게
  const r = occt.ReadFile(format, new Uint8Array(buffer), { linearUnit: 'millimeter' });
  if (!r || !r.success) throw new Error('parse');
  return r;
}

/* ---------- 3D 화면 ---------- */
function setupView() {
  view.hidden = false; $('#viewbar').hidden = false;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  view.append(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d24);
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.4));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6); dir.position.set(1, 2, 1.5); scene.add(dir);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const resize = () => { const w = view.clientWidth, hh = view.clientHeight; renderer.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(view); resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

function clearScene() {
  if (!group) return;
  scene.remove(group);
  group.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  group = null; meshes = [];
}

function build(result) {
  if (!renderer) setupView();
  clearScene();
  group = new THREE.Group();
  meshes = result.meshes.map((m, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (m.normal && m.normal.length === m.position.length) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    else g.computeVertexNormals();
    // 색이 없거나 거의 검정이면(IGES 기본값 등) 어두운 배경에서 안 보이므로 기본 색을 쓴다
    const usable = m.color && 0.2126 * m.color[0] + 0.7152 * m.color[1] + 0.0722 * m.color[2] > 0.08;
    const color = usable ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(PALETTE[i % PALETTE.length]);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0x0b0d12, transparent: true, opacity: 0.55 }));
    edges.visible = $('#edges').checked;
    mesh.add(edges);
    group.add(mesh);
    return mesh;
  });
  group.rotation.x = -Math.PI / 2; // CAD 는 보통 Z 가 위
  scene.add(group);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  group.position.sub(box.getCenter(new THREE.Vector3()));
  const r = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  home = { pos: new THREE.Vector3(r * 1.6, r * 1.2, r * 2.0), near: r / 100, far: r * 100 };
  resetView();
}

function resetView() {
  if (!home) return;
  camera.position.copy(home.pos); camera.near = home.near; camera.far = home.far; camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0); controls.update();
}

function highlight(i) {
  selected = selected === i ? -1 : i;
  meshes.forEach((m, k) => m.material.emissive.setHex(k === selected ? 0x553300 : 0x000000));
  [...partsEl.querySelectorAll('tr[data-i]')].forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.i) === selected));
}

/* ---------- 표·견적 ---------- */
const fmt = (n, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const cm3 = (mm3) => (mm3 / 1000 < 0.01 && mm3 > 0 ? fmt(mm3 / 1000, 4) : fmt(mm3 / 1000, 2));

function renderParts() {
  partsBox.hidden = false;
  $('#partsCount').textContent = `${parts.length}개`;
  const head = h('tr', {}, h('th', {}, '포함'), h('th', {}, '이름'), h('th', {}, '부피 cm³'), h('th', {}, '크기 mm'), h('th', {}, '상태'));
  const rows = parts.map((p, i) => {
    const hex = '#' + meshes[i].material.color.getHexString();
    const cb = h('input', { type: 'checkbox', 'aria-label': `${p.name} 포함` }); cb.checked = included[i];
    cb.addEventListener('change', () => { included[i] = cb.checked; meshes[i].visible = cb.checked; update(); });
    return h('tr', { 'data-i': i },
      h('td', {}, cb),
      h('td', { class: 'name', title: p.path || p.name }, h('button', { class: 'link', type: 'button', onclick: () => highlight(i) }, h('span', { class: 'sw', style: `background:${hex}` }), p.name)),
      h('td', { class: 'num' }, cm3(p.volume)),
      h('td', { class: 'num' }, p.size.map((v) => fmt(v, 1)).join(' × ')),
      h('td', {}, p.closed ? '닫힘' : h('span', { style: 'color:var(--warn)' }, '열림')));
  });
  partsEl.replaceChildren(h('thead', {}, head), h('tbody', {}, rows));
}

function update() {
  if (!parts.length) return;
  const on = parts.filter((_, i) => included[i]);
  const row = (label, value, strong) => h('tr', {}, h('td', { class: 'muted' }, label), h('td', {}, strong ? h('b', {}, value) : value));
  if (!on.length) { statsEl.replaceChildren(h('p', { class: 'status warn' }, '포함된 부품이 없습니다. 목록에서 체크해 주세요.')); return; }
  const density = MATERIALS[matSel.value];
  const infill = Math.min(100, Math.max(0, Number($('#infill').value) || 0)) / 100;
  const wall = Math.max(0, Number($('#wall').value) || 0);
  const price = Math.max(0, Number($('#price').value) || 0);
  const e = on.map((p) => estimatePrint(p, { density, infill, wall, pricePerKg: price }))
    .reduce((a, x) => ({ grams: a.grams + x.grams, meters: a.meters + x.meters, cost: a.cost + x.cost, fullGrams: a.fullGrams + x.fullGrams }), { grams: 0, meters: 0, cost: 0, fullGrams: 0 });
  const s = sumParts(on);
  const size = boundsSize(on.map((p) => meshes[p.index].geometry.getAttribute('position').array));
  statsEl.replaceChildren(h('table', { class: 'preview', style: 'display:table;width:100%;margin-top:14px' },
    row('포함한 부품', `${on.length} / ${parts.length}개`),
    row('전체 크기 (X×Y×Z)', `${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm`),
    row('부피 합계', `${cm3(s.volume)} cm³`),
    row('겉넓이 합계', `${fmt(s.area / 100, 1)} cm²`),
    row('삼각형 수', s.triangles.toLocaleString('ko-KR')),
    row('예상 출력 무게', `${fmt(e.grams, 1)} g`, true),
    row('필라멘트 길이 (1.75mm)', `${fmt(e.meters, 2)} m`, true),
    row('예상 재료비', `${Math.round(e.cost).toLocaleString('ko-KR')} 원`, true),
    row('참고: 100% 채움일 때', `${fmt(e.fullGrams, 1)} g`),
  ));
  if (s.open) statsEl.append(h('p', { class: 'status warn' }, `닫히지 않은(열림) 부품이 ${s.open}개 있어 부피와 무게가 실제와 다를 수 있습니다.`));
}

/* ---------- 파일 열기 ---------- */
async function load(file) {
  if (working) return;
  const format = detectFormat(file.name, await file.slice(0, 400).text());
  if (!format) { setStatus(status, 'STEP(.step .stp) 또는 IGES(.iges .igs) 파일을 골라 주세요.', 'bad'); return; }
  working = true; busy.hidden = false;
  const t0 = performance.now();
  const big = file.size > 50 * 1024 * 1024 ? ' 파일이 커서 오래 걸리거나 메모리가 모자랄 수 있습니다.' : '';
  const stage = (s) => setStatus(status,
    s === 'engine' ? '해석 엔진(약 7.6MB)을 불러오는 중… 처음 한 번만 받습니다.'
      : s === 'parse-main' ? `${file.name} 해석 중… 이 브라우저는 백그라운드 처리를 못 해서 화면이 잠시 멈출 수 있습니다.${big}`
        : `${file.name} (${fmtBytes(file.size)}) 해석·삼각형 나누는 중…${big}`);
  stage('read');
  try {
    const buffer = await file.arrayBuffer();
    let result;
    try { result = await parseInWorker(format, buffer.slice(0), stage); } catch (e) {
      if (!e.noWorker) throw e;
      result = await parseOnMain(format, buffer, stage);
      result = { ...result, meshes: result.meshes.map((m) => ({ name: m.name, color: m.color, position: Float32Array.from(m.attributes.position.array), normal: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null, index: m.index ? Uint32Array.from(m.index.array) : null })) };
    }
    if (!result.meshes.length) throw new Error('empty');
    parts = partsFromResult(result);
    included = parts.map(() => true); selected = -1;
    build(result);
    renderParts();
    update();
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    const s = sumParts(parts);
    setStatus(status, `${file.name} · 부품 ${parts.length}개 · 삼각형 ${s.triangles.toLocaleString('ko-KR')}개 · ${sec}초. 좌표는 mm로 바꿔 계산했습니다.`, s.open ? 'warn' : 'ok');
    track('tool_use', { tool: 'step-viewer', format, parts: parts.length, triangles: s.triangles });
  } catch (e) {
    const msg = e.message === 'parse' || e.message === 'empty'
      ? '모양을 읽지 못했습니다. 파일이 손상됐거나, 솔리드·면이 없는 파일(도면·점만 있는 파일)일 수 있습니다.'
      : /memory|OOM|Aborted/i.test(e.message) ? '메모리가 모자라 해석하지 못했습니다. 더 작은 파일로 나눠 보거나 컴퓨터에서 열어 주세요.'
        : `해석하지 못했습니다: ${e.message}`;
    setStatus(status, msg, 'bad');
  } finally {
    working = false; busy.hidden = true;
  }
}

fileDrop($('#drop'), (files) => load(files[0]));
for (const id of ['mat', 'infill', 'wall', 'price']) $('#' + id).addEventListener('input', update);
$('#resetView').addEventListener('click', resetView);
$('#edges').addEventListener('change', (e) => meshes.forEach((m) => { m.children[0].visible = e.target.checked; }));
$('#allOn').addEventListener('click', () => { included = parts.map(() => true); meshes.forEach((m) => { m.visible = true; }); renderParts(); update(); });
$('#allOff').addEventListener('click', () => { included = parts.map(() => false); meshes.forEach((m) => { m.visible = false; }); renderParts(); update(); });
