import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { $, h, fileDrop, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { meshStats, estimatePrint, MATERIALS, UNIT_TO_MM } from '../_shared/stl.js';

const view = $('#view'), status = $('#status'), statsEl = $('#stats');
const matSel = $('#mat');
for (const [k, v] of Object.entries(MATERIALS)) matSel.append(h('option', { value: k }, `${k} (${v} g/cm³)`));
let raw = null, renderer = null, scene, camera, controls, mesh;

function setupView() {
  view.hidden = false;
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

function show(geometry) {
  if (!renderer) setupView();
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  geometry.computeVertexNormals();
  geometry.center();
  mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7aa2ff, metalness: 0.1, roughness: 0.55 }));
  mesh.rotation.x = -Math.PI / 2; // STL 은 보통 Z 가 위
  scene.add(mesh);
  const r = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere()).radius || 1;
  camera.position.set(r * 1.6, r * 1.2, r * 2.0);
  camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0); controls.update();
}

const fmt = (n, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

function update() {
  if (!raw) return;
  const k = UNIT_TO_MM[$('#unit').value];
  const s = { ...raw, volume: raw.volume * k ** 3, area: raw.area * k ** 2, size: raw.size.map((v) => v * k) };
  const density = MATERIALS[matSel.value];
  const infill = Math.min(100, Math.max(0, Number($('#infill').value) || 0)) / 100;
  const wall = Math.max(0, Number($('#wall').value) || 0);
  const price = Math.max(0, Number($('#price').value) || 0);
  const e = estimatePrint(s, { density, infill, wall, pricePerKg: price });
  const row = (label, value, strong) => h('tr', {}, h('td', { class: 'muted' }, label), h('td', {}, strong ? h('b', {}, value) : value));
  statsEl.replaceChildren(h('table', { class: 'preview', style: 'display:table;width:100%;margin-top:14px' },
    row('크기 (가로×세로×높이)', `${fmt(s.size[0])} × ${fmt(s.size[1])} × ${fmt(s.size[2])} mm`),
    row('모델 부피', `${fmt(s.volume / 1000, 2)} cm³`),
    row('겉넓이', `${fmt(s.area / 100, 1)} cm²`),
    row('삼각형 수', raw.triangles.toLocaleString('ko-KR')),
    row('예상 출력 무게', `${fmt(e.grams, 1)} g`, true),
    row('필라멘트 길이 (1.75mm)', `${fmt(e.meters, 2)} m`, true),
    row('예상 재료비', `${Math.round(e.cost).toLocaleString('ko-KR')} 원`, true),
    row('참고: 100% 채움일 때', `${fmt(e.fullGrams, 1)} g`),
  ));
}

async function load(file) {
  setStatus(status, `${file.name} (${fmtBytes(file.size)}) 읽는 중…`);
  try {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    const pos = geometry.getAttribute('position').array;
    raw = meshStats(pos);
    if (!raw.triangles) throw new Error('삼각형이 없습니다');
    show(geometry);
    const warn = raw.signed < 0 ? ' 면 방향(법선)이 뒤집혀 있습니다. 부피는 절댓값으로 계산했습니다.' : '';
    setStatus(status, `${file.name} · 삼각형 ${raw.triangles.toLocaleString('ko-KR')}개.${warn}`, warn ? 'warn' : 'ok');
    update();
    track('tool_use', { tool: 'stl-estimate', triangles: raw.triangles });
  } catch (e) {
    setStatus(status, `STL을 읽지 못했습니다: ${e.message}`, 'bad');
  }
}

fileDrop($('#drop'), (files) => load(files[0]));
for (const id of ['unit', 'mat', 'infill', 'wall', 'price']) $('#' + id).addEventListener('input', update);
