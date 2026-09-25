import { $, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { encodeWav, channelsOf, fmtSec } from '../_shared/media.js';
import {
  RINGTONE_MAX_SEC, clampSelection, waveformPeaks, renderSelection, aacRateFor, aacConfigs, encodeM4a,
} from '../_shared/ringtone-maker.js';

const status = $('#status'), editor = $('#editor'), canvas = $('#wave');
const startIn = $('#start'), endIn = $('#end'), fadeIn = $('#fadeIn'), fadeOut = $('#fadeOut');
const lenEl = $('#len'), btnPlay = $('#play'), aacNote = $('#aacNote');
const btnM4r = $('#saveM4r'), btnM4a = $('#saveM4a'), btnWav = $('#saveWav');

let audio = null; // { name, channels, rate, duration, peaks }
let sel = { start: 0, end: 0 };
let aacConfig = null;
let player = null; // { ctx, src, t0, raf }
let busy = false;

/* ---------- 파일 열기 ---------- */

async function checkAac(rate, nch) {
  if (typeof window.AudioEncoder === 'undefined' || typeof window.AudioData === 'undefined') return null;
  for (const cfg of aacConfigs(aacRateFor(rate), nch)) {
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return r.config || cfg; } catch { /* 다음 후보 */ }
  }
  return null;
}

fileDrop($('.drop'), async (files) => {
  const file = files[0];
  if (!file) return;
  stopPlay();
  setStatus(status, '파일을 여는 중…');
  let ctx;
  try {
    ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = channelsOf(buf).slice(0, 2).map((c) => Float32Array.from(c));
    audio = { name: baseName(file.name), channels, rate: buf.sampleRate, duration: buf.duration, peaks: null };
  } catch {
    setStatus(status, '이 파일을 열지 못했습니다. 브라우저가 재생할 수 있는 음악 파일(MP3·M4A·WAV 등)인지 확인해 주세요.', 'bad');
    return;
  } finally { ctx?.close().catch(() => {}); }

  sel = clampSelection(0, Math.min(RINGTONE_MAX_SEC, audio.duration), audio.duration, { moved: 'end' });
  $('#fileName').textContent = `${audio.name} · ${fmtSec(audio.duration)} · ${fmtBytes(file.size)}`;
  editor.hidden = false;
  aacConfig = await checkAac(audio.rate, audio.channels.length);
  btnM4r.disabled = btnM4a.disabled = !aacConfig;
  aacNote.hidden = !!aacConfig;
  if (!aacConfig) aacNote.textContent = '이 브라우저는 AAC(m4a·m4r) 인코딩을 지원하지 않아 WAV로만 저장할 수 있습니다. 아이폰 벨소리는 m4r이어야 하니, Windows·macOS의 Chrome·Edge 최신판에서 다시 만들거나, WAV를 아이폰 GarageBand로 불러와 벨소리로 내보내 주세요.';
  syncInputs();
  drawWave();
  setStatus(status, audio.duration > RINGTONE_MAX_SEC ? '구간을 고른 뒤 저장하세요. 벨소리는 30초까지 고를 수 있습니다.' : '곡 전체가 30초 이내라 그대로 저장해도 됩니다.', 'ok');
  track('tool_use', { tool: 'ringtone-maker', seconds: Math.round(audio.duration), aac: !!aacConfig });
});

/* ---------- 구간 ---------- */

function setSel(start, end, moved) {
  sel = clampSelection(start, end, audio.duration, { moved });
  syncInputs();
  drawWave();
}

function syncInputs() {
  startIn.value = sel.start.toFixed(1);
  endIn.value = sel.end.toFixed(1);
  startIn.max = endIn.max = audio.duration.toFixed(1);
  const len = sel.end - sel.start;
  lenEl.textContent = `길이 ${len.toFixed(1)}초 / 최대 ${RINGTONE_MAX_SEC}초`;
  lenEl.classList.toggle('over', len > RINGTONE_MAX_SEC + 0.01);
}

startIn.addEventListener('change', () => setSel(Number(startIn.value) || 0, sel.end, 'start'));
endIn.addEventListener('change', () => setSel(sel.start, Number(endIn.value) || 0, 'end'));

/* ---------- 파형 ---------- */

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

function drawWave(playT = null) {
  if (!audio) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(100, Math.round(canvas.clientWidth * dpr)), H = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== W || canvas.height !== H || !audio.peaks) {
    canvas.width = W; canvas.height = H;
    audio.peaks = waveformPeaks(audio.channels, W);
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const x0 = (sel.start / audio.duration) * W, x1 = (sel.end / audio.duration) * W;
  g.fillStyle = css('--accent-weak');
  g.fillRect(x0, 0, x1 - x0, H);
  const mid = H / 2, accent = css('--accent'), sub = css('--sub');
  for (let x = 0; x < W; x++) {
    g.fillStyle = x >= x0 && x <= x1 ? accent : sub;
    const top = mid - audio.peaks.max[x] * mid * 0.95, bot = mid - audio.peaks.min[x] * mid * 0.95;
    g.fillRect(x, top, 1, Math.max(1, bot - top));
  }
  g.fillStyle = accent;
  for (const x of [x0, x1]) { g.fillRect(Math.round(x) - dpr, 0, 2 * dpr, H); g.fillRect(Math.round(x) - 5 * dpr, 0, 10 * dpr, 6 * dpr); }
  if (playT != null) { g.fillStyle = css('--bad'); g.fillRect(Math.round((playT / audio.duration) * W), 0, 2 * dpr, H); }
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!audio) return;
  const rect = canvas.getBoundingClientRect();
  const t = ((e.clientX - rect.left) / rect.width) * audio.duration;
  const px = (sec) => (sec / audio.duration) * rect.width;
  const x = e.clientX - rect.left;
  const dS = Math.abs(x - px(sel.start)), dE = Math.abs(x - px(sel.end));
  if (Math.min(dS, dE) > 14 && t > sel.start && t < sel.end) drag = { mode: 'move', offset: t - sel.start, len: sel.end - sel.start };
  else drag = { mode: dS <= dE ? 'start' : 'end' };
  canvas.setPointerCapture(e.pointerId);
  moveDrag(e);
});
canvas.addEventListener('pointermove', (e) => { if (drag) moveDrag(e); });
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function moveDrag(e) {
  const rect = canvas.getBoundingClientRect();
  const t = Math.min(audio.duration, Math.max(0, ((e.clientX - rect.left) / rect.width) * audio.duration));
  if (drag.mode === 'move') {
    const s = Math.max(0, Math.min(audio.duration - drag.len, t - drag.offset));
    setSel(s, s + drag.len, 'start');
  } else if (drag.mode === 'start') setSel(t, sel.end, 'start');
  else setSel(sel.start, t, 'end');
}

window.addEventListener('resize', () => { if (audio && !editor.hidden) { audio.peaks = null; drawWave(); } });

/* ---------- 미리 듣기 ---------- */

function rendered() {
  return renderSelection(audio.channels, audio.rate, sel.start, sel.end, { fadeIn: Number(fadeIn.value), fadeOut: Number(fadeOut.value) });
}

function stopPlay() {
  if (!player) return;
  cancelAnimationFrame(player.raf);
  try { player.src.stop(); } catch { /* 이미 끝남 */ }
  player.ctx.close().catch(() => {});
  player = null;
  btnPlay.textContent = '▶ 구간 듣기';
  drawWave();
}

btnPlay.addEventListener('click', () => {
  if (player) { stopPlay(); return; }
  const chs = rendered();
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(chs.length, chs[0].length, audio.rate);
  chs.forEach((c, i) => buf.copyToChannel(c, i));
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination);
  src.onended = () => stopPlay();
  src.start();
  player = { ctx, src, t0: ctx.currentTime, raf: 0 };
  btnPlay.textContent = '■ 멈춤';
  const loop = () => { if (!player) return; drawWave(sel.start + (player.ctx.currentTime - player.t0)); player.raf = requestAnimationFrame(loop); };
  loop();
});

/* ---------- 저장 ---------- */

async function toAacRate(chs) {
  const target = aacRateFor(audio.rate);
  if (target === audio.rate) return chs;
  const off = new OfflineAudioContext(chs.length, Math.ceil((chs[0].length * target) / audio.rate), target);
  const buf = off.createBuffer(chs.length, chs[0].length, audio.rate);
  chs.forEach((c, i) => buf.copyToChannel(c, i));
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return channelsOf(await off.startRendering());
}

async function saveAac(ext, btn) {
  if (busy || !aacConfig) return;
  busy = true; btn.disabled = true;
  try {
    setStatus(status, 'AAC로 압축하는 중…');
    const chs = await toAacRate(rendered());
    const bytes = await encodeM4a(chs, aacRateFor(audio.rate), { AudioEncoder: window.AudioEncoder, AudioData: window.AudioData }, aacConfig,
      (p) => setStatus(status, `AAC로 압축하는 중… ${Math.round(p * 100)}%`));
    download(new Blob([bytes], { type: ext === 'm4r' ? 'audio/x-m4r' : 'audio/mp4' }), `${audio.name}-ringtone.${ext}`);
    setStatus(status, `${ext} 파일을 저장했습니다 (${fmtBytes(bytes.length)}, ${(sel.end - sel.start).toFixed(1)}초).`, 'ok');
    track('tool_download', { tool: 'ringtone-maker', format: ext, seconds: Math.round(sel.end - sel.start) });
  } catch (e) {
    setStatus(status, `AAC로 만들지 못했습니다: ${e.message}. WAV로 저장해 주세요.`, 'bad');
  } finally { busy = false; btn.disabled = false; }
}

btnM4r.addEventListener('click', () => saveAac('m4r', btnM4r));
btnM4a.addEventListener('click', () => saveAac('m4a', btnM4a));
btnWav.addEventListener('click', () => {
  if (!audio) return;
  const wav = encodeWav(rendered(), audio.rate);
  download(new Blob([wav], { type: 'audio/wav' }), `${audio.name}-ringtone.wav`);
  setStatus(status, `WAV 파일을 저장했습니다 (${fmtBytes(wav.length)}).`, 'ok');
  track('tool_download', { tool: 'ringtone-maker', format: 'wav', seconds: Math.round(sel.end - sel.start) });
});
