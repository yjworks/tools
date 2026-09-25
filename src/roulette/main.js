import { $, track } from '../_shared/ui.js';
import { randInt, rand, shuffle } from '../_shared/random.js';

const COLORS = ['#2f6fed', '#e05a4a', '#0f8a5f', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#ea580c'];
const canvas = $('#wheel'), ctx = canvas.getContext('2d'), itemsEl = $('#items'), result = $('#result'), spinBtn = $('#spin'), hist = $('#history');
const KEY = 'dibrain-roulette-items';
let rot = 0, spinning = false, history = [];

try { const saved = localStorage.getItem(KEY); if (saved) itemsEl.value = saved; } catch { /* 저장소를 못 쓰면 기본 항목 */ }
const items = () => itemsEl.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30);

function draw() {
  const list = items(), n = list.length, R = canvas.width / 2, c = R;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (n < 2) {
    ctx.fillStyle = '#8888'; ctx.beginPath(); ctx.arc(c, c, R - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 34px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('항목을 2개 이상', c, c + 12); return;
  }
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R - 6, a0, a0 + step); ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length] + (n > COLORS.length && i >= COLORS.length ? 'cc' : ''); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(c, c); ctx.rotate(a0 + step / 2);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const fs = Math.max(18, Math.min(38, 300 / n + 12));
    ctx.font = `700 ${fs}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    const label = list[i].length > 10 ? list[i].slice(0, 10) + '…' : list[i];
    ctx.fillText(label, R - 30, 0); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(c, c, 34, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#16181d33'; ctx.stroke();
}

function spin() {
  const list = items(); const n = list.length;
  if (spinning || n < 2) return;
  spinning = true; spinBtn.disabled = true; result.textContent = '';
  const step = (Math.PI * 2) / n, win = randInt(n);
  const offset = step * (0.12 + 0.76 * rand());
  // 위쪽(-90°) 화살표가 당첨 칸 안쪽을 가리키도록 최종 각도를 정한다
  let target = -Math.PI / 2 - win * step - offset;
  const minEnd = rot + Math.PI * 2 * 6;
  target += Math.ceil((minEnd - target) / (Math.PI * 2)) * Math.PI * 2;
  const start = rot, dur = 4200, t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    rot = start + (target - start) * ease(t); draw();
    if (t < 1) return requestAnimationFrame(frame);
    rot %= Math.PI * 2; spinning = false; spinBtn.disabled = false;
    result.textContent = `🎉 ${list[win]}`;
    history.unshift(list[win]); hist.textContent = '지난 결과: ' + history.slice(0, 12).join(' · ');
    if ($('#remove').checked) { const rest = [...list]; rest.splice(win, 1); itemsEl.value = rest.join('\n'); save(); setTimeout(draw, 900); }
    track('tool_use', { tool: 'roulette', items: n });
  };
  requestAnimationFrame(frame);
}

function save() { try { localStorage.setItem(KEY, itemsEl.value); } catch { /* 무시 */ } }

itemsEl.addEventListener('input', () => { save(); if (!spinning) draw(); });
spinBtn.addEventListener('click', spin);
canvas.addEventListener('click', spin);
$('#shuffle').addEventListener('click', () => { itemsEl.value = shuffle(items()).join('\n'); save(); draw(); });
draw();
