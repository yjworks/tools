import { $, h, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import {
  AUDIO_TYPES, supportedContainers, containerOf, pickMime, extForMime, fmtClock, stampName,
  createClock, startRecording, meterFraction, encodeWav, channelsOf,
} from '../_shared/media.js';
import { levelOf, holdPeak, micConstraints, levelHint, micSupport } from '../_shared/voice-recorder.js';

const status = $('#status'), rawBox = $('#raw'), fmtSel = $('#fmt');
const clockEl = $('#clock'), fill = $('#fill'), levelDb = $('#levelDb'), levelHintEl = $('#levelHint');
const btnStart = $('#start'), btnPause = $('#pause'), btnStop = $('#stop'), btnTest = $('#test');
const takesEl = $('#takes');

const hasRecorder = typeof window.MediaRecorder !== 'undefined';
const isSup = (t) => (hasRecorder && typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(t) : false);
const formats = supportedContainers(AUDIO_TYPES, isSup);
fmtSel.replaceChildren(...(formats.length
  ? formats.map((o) => h('option', { value: o.container }, o.container === 'mp4' ? 'M4A (AAC)' : `${o.container.toUpperCase()} (Opus)`))
  : [h('option', { value: '' }, '브라우저 기본값')]));

let mic = null;      // { stream, ctx, analyser, raf }
let session = null;  // 녹음 중
let takes = [];
let takeNo = 0;

async function openMic() {
  if (mic) return mic;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints({ raw: rawBox.checked }) });
  const ctx = new AudioContext();
  ctx.resume?.().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  mic = { stream, ctx, analyser, raf: 0, held: -Infinity, last: performance.now() };
  const buf = new Float32Array(analyser.fftSize);
  const loop = (now) => {
    if (!mic) return;
    analyser.getFloatTimeDomainData(buf);
    const { peakDb } = levelOf(buf);
    mic.held = holdPeak(mic.held, peakDb, (now - mic.last) / 1000);
    mic.last = now;
    fill.style.width = `${(meterFraction(mic.held) * 100).toFixed(1)}%`;
    fill.classList.toggle('hot', mic.held > -1);
    levelDb.textContent = Number.isFinite(mic.held) ? `입력 레벨 ${mic.held.toFixed(0)} dBFS` : '입력 레벨 —';
    levelHintEl.textContent = levelHint(mic.held);
    mic.raf = requestAnimationFrame(loop);
  };
  mic.raf = requestAnimationFrame(loop);
  return mic;
}

function closeMic() {
  if (!mic) return;
  cancelAnimationFrame(mic.raf);
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
  fill.style.width = '0'; levelDb.textContent = '입력 레벨 —'; levelHintEl.textContent = '';
  btnTest.textContent = '마이크 확인';
}

function micError(e) {
  if (e?.name === 'NotAllowedError') return '마이크 권한이 거부되었습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 새로고침해 주세요.';
  if (e?.name === 'NotFoundError') return '마이크를 찾지 못했습니다. 연결을 확인해 주세요.';
  return `마이크를 열지 못했습니다: ${e?.message || e}`;
}

btnTest.addEventListener('click', async () => {
  if (session) return;
  if (mic) { closeMic(); setStatus(status, ''); return; }
  try { await openMic(); btnTest.textContent = '확인 끝내기'; setStatus(status, '말해 보세요. 막대가 움직이면 마이크가 잘 들어오고 있습니다.', 'ok'); }
  catch (e) { setStatus(status, micError(e), 'bad'); }
});

function uiRecording(on) {
  btnStart.hidden = on; btnPause.hidden = !on; btnStop.hidden = !on; btnTest.hidden = on;
  rawBox.disabled = on; fmtSel.disabled = on;
  clockEl.classList.toggle('on', on);
  btnPause.textContent = '일시정지';
}

btnStart.addEventListener('click', async () => {
  if (session) return;
  try { await openMic(); } catch (e) { setStatus(status, micError(e), 'bad'); return; }
  const want = fmtSel.value;
  const mime = pickMime(AUDIO_TYPES.filter((t) => !want || containerOf(t) === want), isSup) || pickMime(AUDIO_TYPES, isSup);
  let r;
  try { r = startRecording(mic.stream, mime, { fallbackType: 'audio/webm' }); }
  catch {
    try { r = startRecording(mic.stream, '', { fallbackType: 'audio/webm' }); } catch (e) { setStatus(status, `녹음을 시작하지 못했습니다: ${e.message}`, 'bad'); return; }
  }
  const clock = createClock(); clock.start();
  session = { ...r, clock, timer: setInterval(() => (clockEl.textContent = fmtClock(clock.elapsed() / 1000)), 200) };
  clockEl.textContent = '0:00';
  uiRecording(true);
  setStatus(status, '녹음 중입니다.');
  r.done.then(finish).catch((e) => { clearInterval(session?.timer); session = null; uiRecording(false); closeMic(); setStatus(status, `녹음 중 오류가 났습니다: ${e.message}`, 'bad'); });
});

btnStop.addEventListener('click', () => {
  if (!session || session.stopping) return;
  session.stopping = true; session.clock.pause();
  if (session.rec.state !== 'inactive') session.rec.stop();
});

btnPause.addEventListener('click', () => {
  if (!session) return;
  if (session.rec.state === 'recording') { session.rec.pause(); session.clock.pause(); btnPause.textContent = '이어서 녹음'; clockEl.classList.remove('on'); }
  else if (session.rec.state === 'paused') { session.rec.resume(); session.clock.resume(); btnPause.textContent = '일시정지'; clockEl.classList.add('on'); }
});

function finish(blob) {
  const secs = session.clock.elapsed() / 1000;
  clearInterval(session.timer);
  session = null;
  uiRecording(false);
  closeMic();
  if (!blob.size) { setStatus(status, '녹음된 내용이 없습니다. 다시 시도해 주세요.', 'warn'); return; }
  const take = { no: ++takeNo, blob, url: URL.createObjectURL(blob), secs, saved: false, stamp: stampName('voice') };
  takes.unshift(take);
  render();
  setStatus(status, `녹음 ${take.no}을(를) 만들었습니다. 들어 보고 저장하세요.`, 'ok');
  track('tool_use', { tool: 'voice-recorder', seconds: Math.round(secs), format: extForMime(blob.type), raw: rawBox.checked });
}

async function saveWav(take, btn) {
  btn.disabled = true;
  const old = btn.textContent; btn.textContent = '변환 중…';
  let ctx;
  try {
    ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await take.blob.arrayBuffer());
    const wav = encodeWav(channelsOf(buf), buf.sampleRate);
    download(new Blob([wav], { type: 'audio/wav' }), `${take.stamp}.wav`);
    take.saved = true;
    track('tool_download', { tool: 'voice-recorder', format: 'wav' });
  } catch (e) {
    setStatus(status, `WAV로 바꾸지 못했습니다: ${e.message}. 원본 저장을 이용해 주세요.`, 'bad');
  } finally {
    ctx?.close().catch(() => {});
    btn.disabled = false; btn.textContent = old;
  }
}

function render() {
  takesEl.replaceChildren(...takes.map((t) => {
    const ext = extForMime(t.blob.type);
    const wavBtn = h('button', { class: 'ghost small' }, 'WAV 저장');
    wavBtn.addEventListener('click', () => saveWav(t, wavBtn));
    return h('li', {},
      h('div', { class: 'head' }, h('b', {}, `녹음 ${t.no}`), h('span', { class: 'muted' }, `${fmtClock(t.secs)} · ${fmtBytes(t.blob.size)} · ${ext.toUpperCase()}`)),
      h('audio', { src: t.url, controls: true, preload: 'metadata' }),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => { download(t.blob, `${t.stamp}.${ext}`); t.saved = true; track('tool_download', { tool: 'voice-recorder', format: ext }); } }, `원본 저장 (.${ext})`),
        wavBtn,
        h('button', { class: 'ghost small', onclick: () => { URL.revokeObjectURL(t.url); takes = takes.filter((x) => x !== t); render(); } }, '삭제')));
  }));
}

rawBox.addEventListener('change', async () => {
  if (!mic || session) return; // 마이크 확인 중이면 새 설정으로 다시 연다
  closeMic();
  try { await openMic(); btnTest.textContent = '확인 끝내기'; } catch (e) { setStatus(status, micError(e), 'bad'); }
});

window.addEventListener('beforeunload', (e) => { if (session || takes.some((t) => !t.saved)) { e.preventDefault(); e.returnValue = ''; } });

const support = micSupport({ secure: window.isSecureContext !== false, getUserMedia: !!navigator.mediaDevices?.getUserMedia, mediaRecorder: hasRecorder });
if (!support.ok) {
  const u = $('#unsupported'); u.textContent = support.msg; u.hidden = false;
  btnStart.disabled = true; btnTest.disabled = true; $('#setup').hidden = true;
}
