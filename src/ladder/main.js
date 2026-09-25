import { $, h, track } from '../_shared/ui.js';
import { makeLadder, trace } from '../_shared/ladder.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#e05a4a', '#2f6fed', '#0f8a5f', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#b45309', '#0d9488', '#9333ea'];
const LEVELS = 10, ROW = 30, TOP = 46, BOTTOM = 52;
const board = $('#board'), summary = $('#summary'), allBtn = $('#all');
let state = null;

const s = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function build() {
  const names = lines($('#names').value).slice(0, 12);
  if (names.length < 2) { summary.replaceChildren(h('p', { class: 'status warn' }, '참가자를 두 명 이상 적어 주세요.')); return; }
  let results = lines($('#results').value).slice(0, names.length);
  while (results.length < names.length) results.push($('#results').value.trim() ? '꽝' : `${results.length + 1}번`);
  const n = names.length;
  const X = Math.max(58, Math.min(96, 720 / n));
  const W = X * n, H = TOP + LEVELS * ROW + BOTTOM + 10;
  const x = (c) => X / 2 + c * X, y = (l) => TOP + 10 + (l + 0.5) * ROW;
  const rungs = makeLadder(n, LEVELS);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': '사다리' });
  svg.style.maxWidth = '100%'; svg.style.display = 'block'; svg.style.margin = '14px auto 0';
  const stroke = getComputedStyle(document.body).color;
  for (let c = 0; c < n; c++) svg.append(s('line', { x1: x(c), y1: TOP + 4, x2: x(c), y2: H - BOTTOM, stroke, 'stroke-width': 2.5, opacity: 0.55 }));
  rungs.forEach((row, l) => row.forEach((on, g) => on && svg.append(s('line', { x1: x(g), y1: y(l), x2: x(g + 1), y2: y(l), stroke, 'stroke-width': 2.5, opacity: 0.55 }))));
  const paths = s('g', {}); svg.append(paths);
  const resultEls = [];
  results.forEach((r, c) => {
    const t = s('text', { x: x(c), y: H - BOTTOM + 30, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'currentColor' });
    t.textContent = $('#hide').checked ? '?' : r; svg.append(t); resultEls.push(t);
  });
  names.forEach((name, c) => {
    const g = s('g', { cursor: 'pointer', tabindex: 0, role: 'button' });
    g.append(s('rect', { x: x(c) - X / 2 + 4, y: 4, width: X - 8, height: 32, rx: 9, fill: COLORS[c % COLORS.length] }));
    const t = s('text', { x: x(c), y: 25, 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 700, fill: '#fff' });
    t.textContent = name.length > 6 ? name.slice(0, 6) + '…' : name; g.append(t);
    g.addEventListener('click', () => reveal(c)); g.addEventListener('keydown', (e) => e.key === 'Enter' && reveal(c));
    svg.append(g);
  });
  state = { names, results, rungs, x, y, n, paths, resultEls, shown: new Set(), H };
  board.replaceChildren(svg); summary.replaceChildren(); allBtn.hidden = false;
  track('tool_use', { tool: 'ladder', players: n });
}

function reveal(c, animate = true) {
  if (!state) return;
  const { rungs, x, y, paths, resultEls, results, names, H } = state;
  const { end, path } = trace(rungs, c);
  const pts = path.map(([col, l]) => `${x(col)},${l < 0 ? TOP + 4 : l >= LEVELS ? H - BOTTOM : y(l)}`).join(' ');
  const pl = s('polyline', { points: pts, fill: 'none', stroke: COLORS[c % COLORS.length], 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  paths.append(pl);
  const len = pl.getTotalLength();
  const done = () => { resultEls[end].textContent = results[end]; resultEls[end].setAttribute('fill', COLORS[c % COLORS.length]); };
  if (animate) {
    pl.style.strokeDasharray = len; pl.style.strokeDashoffset = len;
    pl.getBoundingClientRect();
    pl.style.transition = 'stroke-dashoffset 1.6s ease-in-out'; pl.style.strokeDashoffset = 0;
    setTimeout(done, 1600);
  } else done();
  state.shown.add(c);
  if (state.shown.size === names.length) showSummary();
}

function showSummary() {
  const { names, results, rungs } = state;
  const rows = names.map((nm, c) => h('tr', {}, h('td', {}, nm), h('td', {}, '→'), h('td', {}, h('b', {}, results[trace(rungs, c).end]))));
  summary.replaceChildren(h('table', { class: 'preview', style: 'margin-top:14px;display:table;width:auto' }, rows));
}

$('#make').addEventListener('click', build);
allBtn.addEventListener('click', () => { if (!state) return; state.paths.replaceChildren(); state.shown.clear(); state.names.forEach((_, c) => reveal(c, false)); });
