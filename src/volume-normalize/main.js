import { $, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { encodeWav, channelsOf, fmtClock } from '../_shared/media.js';
import { measure, normalize } from '../_shared/volume-normalize.js';

const status = $('#status'), panel = $('#panel'), out = $('#out');
const modeSel = $('#mode'), target = $('#target'), limiterBox = $('#limiter'), ceiling = $('#ceiling');
const gainInfo = $('#gainInfo'), before = $('#before'), after = $('#after'), saveInfo = $('#saveInfo');

const DEFAULTS = { peak: -1, rms: -20, lufs: -16 };
const UNITS = { peak: 'dBFS', rms: 'dBFS', lufs: 'LUFS' };

let src = null;   // { name, channels, rate, stats, url }
let res = null;   // { wav, url }
let beforeUrl = '';

const fmtDb = (v, unit) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : `-∞ ${unit}`);

function showStats(prefix, s) {
  $(`#${prefix}-peak`).textContent = fmtDb(s.peakDb, 'dBFS');
  $(`#${prefix}-rms`).textContent = fmtDb(s.rmsDb, 'dBFS');
  $(`#${prefix}-lufs`).textContent = fmtDb(s.lufs, 'LUFS');
}

function syncMode() {
  const m = modeSel.value;
  target.value = DEFAULTS[m];
  $('#targetLabel').textContent = `목표 (${UNITS[m]})`;
  const noLimiter = m === 'peak';
  limiterBox.disabled = noLimiter; ceiling.disabled = noLimiter || !limiterBox.checked;
}
modeSel.addEventListener('change', syncMode);
limiterBox.addEventListener('change', () => { ceiling.disabled = modeSel.value === 'peak' || !limiterBox.checked; });
syncMode();

fileDrop($('.drop'), async (files) => {
  const file = files[0];
  if (!file) return;
  setStatus(status, '파일을 풀고 음량을 재는 중…');
  let ctx;
  try {
    ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = channelsOf(buf).map((c) => Float32Array.from(c));
    await new Promise((r) => setTimeout(r, 0));
    const stats = measure(channels, buf.sampleRate);
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    beforeUrl = URL.createObjectURL(file);
    src = { name: baseName(file.name), channels, rate: buf.sampleRate, stats };
    $('#fileName').textContent = `${file.name} · ${fmtClock(buf.duration)} · ${channels.length === 1 ? '모노' : channels.length === 2 ? '스테레오' : `${channels.length}채널`} · ${(buf.sampleRate / 1000).toFixed(1)} kHz`;
    showStats('b', stats);
    ['a-peak', 'a-rms', 'a-lufs'].forEach((id) => ($(`#${id}`).textContent = '—'));
    panel.hidden = false; out.hidden = true; gainInfo.textContent = '';
    before.src = beforeUrl;
    setStatus(status, stats.peak > 0 ? '측정했습니다. 기준과 목표를 고르고 적용하세요.' : '소리가 없는 파일입니다.', stats.peak > 0 ? 'ok' : 'warn');
    track('tool_use', { tool: 'volume-normalize', seconds: Math.round(buf.duration), channels: channels.length });
  } catch {
    setStatus(status, '이 파일을 열지 못했습니다. 브라우저가 재생할 수 있는 음성·음악 파일인지 확인해 주세요.', 'bad');
  } finally { ctx?.close().catch(() => {}); }
});

$('#apply').addEventListener('click', async () => {
  if (!src) return;
  const mode = modeSel.value;
  const tgt = Number(target.value);
  if (!Number.isFinite(tgt) || tgt > 0) { setStatus(status, '목표값은 0 이하의 숫자로 적어 주세요.', 'warn'); return; }
  const ceil = Math.min(0, Number(ceiling.value) || -1);
  setStatus(status, '처리하는 중…');
  await new Promise((r) => setTimeout(r, 0));
  const r = normalize(src.channels, src.rate, src.stats, { mode, target: tgt, limiter: limiterBox.checked, ceilingDb: ceil });
  const after2 = measure(r.channels, src.rate);
  showStats('a', after2);
  const wav = encodeWav(r.channels, src.rate);
  if (res?.url) URL.revokeObjectURL(res.url);
  res = { wav, url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })) };
  after.src = res.url;
  out.hidden = false;
  const sign = r.gainDb >= 0 ? '+' : '';
  const notes = [`${sign}${r.gainDb.toFixed(1)} dB 적용`];
  if (r.limitedSamples) notes.push(`리미터 최대 ${r.maxReductionDb.toFixed(1)} dB`);
  gainInfo.textContent = notes.join(' · ');
  saveInfo.textContent = `16비트 WAV · ${fmtBytes(wav.length)}`;
  if (r.clipped) setStatus(status, `${r.clipped.toLocaleString()}개 샘플이 0 dBFS를 넘어 잘렸습니다(찌그러짐). 리미터를 켜거나 목표를 낮춰 주세요.`, 'warn');
  else setStatus(status, '평준화했습니다. 들어 보고 저장하세요.', 'ok');
});

$('#save').addEventListener('click', () => {
  if (!res || !src) return;
  download(new Blob([res.wav], { type: 'audio/wav' }), `${src.name}-normalized.wav`);
  track('tool_download', { tool: 'volume-normalize', mode: modeSel.value, target: Number(target.value) });
});
