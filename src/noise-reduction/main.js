import { $, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { encodeWav, channelsOf, mixToMono, resampleLinear, fmtClock } from '../_shared/media.js';
import { RNNOISE_RATE, denoise, mixDryWet, reductionDb } from '../_shared/noise-reduction.js';

const status = $('#status'), prog = $('#prog'), result = $('#result');
const before = $('#before'), after = $('#after'), amount = $('#amount'), amountOut = $('#amountOut');
const stats = $('#stats'), saveInfo = $('#saveInfo');

let rnnoise = null; // 한 번 불러오면 다시 쓴다
let data = null;    // { name, dry, wet, voice }
let beforeUrl = '', afterUrl = '', afterWav = null;
let busy = false;

const hasWasm = typeof WebAssembly === 'object';
const hasAudio = typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined';
if (!hasWasm || !hasAudio) {
  const u = $('#unsupported');
  u.textContent = '이 브라우저는 WebAssembly 또는 Web Audio를 지원하지 않아 잡음 제거를 할 수 없습니다. 최신 Chrome·Edge·Firefox·Safari로 열어 주세요.';
  u.hidden = false;
  $('.drop').hidden = true;
}

async function loadEngine() {
  if (rnnoise) return rnnoise;
  const { Rnnoise } = await import('@shiguredo/rnnoise-wasm');
  rnnoise = await Rnnoise.load();
  return rnnoise;
}

/** 48 kHz 모노로 바꾸기: OfflineAudioContext 가 안 되면 직접 평균·선형 보간 */
async function toMono48k(buf) {
  if (buf.sampleRate === RNNOISE_RATE && buf.numberOfChannels === 1) return Float32Array.from(buf.getChannelData(0));
  try {
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * RNNOISE_RATE), RNNOISE_RATE);
    const src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    return Float32Array.from(out.getChannelData(0));
  } catch {
    return resampleLinear(mixToMono(channelsOf(buf)), buf.sampleRate, RNNOISE_RATE);
  }
}

function wavUrl(samples) {
  const bytes = encodeWav([samples], RNNOISE_RATE);
  return { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })) };
}

function renderAfter() {
  if (!data) return;
  const a = Number(amount.value) / 100;
  const mixed = a >= 1 ? data.wet : mixDryWet(data.dry, data.wet, a);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  const w = wavUrl(mixed);
  afterUrl = w.url; afterWav = w.bytes;
  const t = after.currentTime, playing = !after.paused;
  after.src = afterUrl;
  if (t) after.currentTime = t;
  if (playing) after.play().catch(() => {});
  const red = reductionDb(data.dry, mixed);
  stats.textContent = `전체 소리 에너지 ${Number.isFinite(red) ? red.toFixed(1) : '∞'} dB 감소 · 목소리로 판단한 비율 약 ${Math.round(data.voice * 100)}%`;
  saveInfo.textContent = `48 kHz 모노 WAV · ${fmtBytes(afterWav.length)}`;
}

fileDrop($('.drop'), async (files) => {
  const file = files[0];
  if (!file || busy) return;
  busy = true;
  result.hidden = true;
  prog.hidden = false; prog.value = 0;
  let ctx, state;
  try {
    setStatus(status, '파일을 푸는 중…');
    ctx = new AudioContext();
    let buf;
    try { buf = await ctx.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error('이 파일을 열지 못했습니다. 브라우저가 재생할 수 있는 음성 파일인지 확인해 주세요.'); }
    const dry = await toMono48k(buf);
    setStatus(status, rnnoise ? '잡음을 줄이는 중…' : '잡음 제거 엔진을 불러오는 중… (처음 한 번)');
    const rn = await loadEngine();
    state = rn.createDenoiseState();
    const t0 = performance.now();
    const { output, voice } = await denoise(dry, (f) => state.processFrame(f), {
      onProgress: (p) => { prog.value = p; setStatus(status, `잡음을 줄이는 중… ${Math.round(p * 100)}%`); },
    });
    data = { name: baseName(file.name), dry, wet: output, voice };
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    beforeUrl = wavUrl(dry).url;
    before.src = beforeUrl;
    renderAfter();
    result.hidden = false;
    const secs = dry.length / RNNOISE_RATE;
    setStatus(status, `${fmtClock(secs)} 길이를 ${((performance.now() - t0) / 1000).toFixed(1)}초 만에 처리했습니다. 전후를 비교해 들어 보세요.`, 'ok');
    track('tool_use', { tool: 'noise-reduction', seconds: Math.round(secs) });
  } catch (e) {
    setStatus(status, e.message.startsWith('이 파일') ? e.message : `처리하지 못했습니다: ${e.message}`, 'bad');
  } finally {
    state?.destroy();
    ctx?.close().catch(() => {});
    prog.hidden = true;
    busy = false;
  }
});

amount.addEventListener('input', () => { amountOut.textContent = `${amount.value}%`; });
amount.addEventListener('change', renderAfter);

$('#save').addEventListener('click', () => {
  if (!afterWav || !data) return;
  download(new Blob([afterWav], { type: 'audio/wav' }), `${data.name}-denoised.wav`);
  track('tool_download', { tool: 'noise-reduction', amount: Number(amount.value) });
});
