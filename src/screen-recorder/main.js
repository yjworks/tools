import { $, h, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import {
  VIDEO_AV_TYPES, VIDEO_ONLY_TYPES, supportedContainers, containerOf, pickMime, extForMime,
  fmtClock, stampName, createClock, isMobileUA, startRecording,
} from '../_shared/media.js';
import { screenSupport, displayOptions, audioPlan } from '../_shared/screen-recorder.js';

const status = $('#status');
const btnStart = $('#start'), btnPause = $('#pause'), btnStop = $('#stop');
const fmtSel = $('#fmt'), fpsSel = $('#fps'), sysAudio = $('#sysAudio'), micBox = $('#mic');
const recBar = $('#recBar'), timerEl = $('#timer'), recInfo = $('#recInfo');
const result = $('#result'), preview = $('#preview'), resultInfo = $('#resultInfo');

const hasRecorder = typeof window.MediaRecorder !== 'undefined';
const isSup = (t) => (hasRecorder && typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(t) : false);

const support = screenSupport({
  secure: window.isSecureContext !== false,
  getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
  mediaRecorder: hasRecorder,
  mobile: isMobileUA(navigator.userAgent, navigator.maxTouchPoints, navigator.userAgentData?.mobile),
});

let session = null; // { rec, done, streams: [], ctx, clock, timer }
let lastBlob = null, lastUrl = '', unsaved = false;

function setupFormats() {
  const list = supportedContainers(VIDEO_AV_TYPES, isSup);
  fmtSel.replaceChildren(...list.map((o) => h('option', { value: o.container }, o.container.toUpperCase())));
  if (!list.length) fmtSel.append(h('option', { value: '' }, '브라우저 기본값'));
}

/** 소리가 있는지에 따라 고른 컨테이너 안에서 가장 알맞은 형식 */
function chooseMime(withAudio) {
  const all = withAudio ? VIDEO_AV_TYPES : VIDEO_ONLY_TYPES;
  const want = fmtSel.value;
  return pickMime(all.filter((t) => !want || containerOf(t) === want), isSup) || pickMime(all, isSup);
}

function uiRecording(on) {
  btnStart.hidden = on; btnPause.hidden = !on; btnStop.hidden = !on;
  recBar.hidden = !on; recBar.classList.remove('paused'); btnPause.textContent = '일시정지';
  $('#setup').querySelectorAll('input,select').forEach((el) => (el.disabled = on));
}

function cleanup() {
  if (!session) return;
  clearInterval(session.timer);
  session.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  session.ctx?.close().catch(() => {});
}

async function start() {
  result.hidden = true;
  const notes = [];
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia(displayOptions({ audio: sysAudio.checked, frameRate: Number(fpsSel.value) }));
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') setStatus(status, '화면 공유를 취소했거나 권한이 없어 녹화하지 않았습니다.', 'warn');
    else setStatus(status, `화면을 가져오지 못했습니다: ${e.message}`, 'bad');
    return;
  }
  const streams = [display];
  let mic = null;
  if (micBox.checked) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.push(mic);
    } catch { notes.push('마이크를 쓸 수 없어 마이크 소리 없이 녹화합니다.'); }
  }
  const dAudio = display.getAudioTracks();
  if (sysAudio.checked && !dAudio.length) notes.push('화면 소리는 담기지 않습니다(오디오 공유를 끄셨거나 이 브라우저·공유 대상이 소리를 지원하지 않습니다).');

  const plan = audioPlan({ displayAudio: dAudio.length > 0, mic: !!mic });
  let audioTrack = null, ctx = null;
  if (plan === 'display') audioTrack = dAudio[0];
  else if (plan === 'mic') audioTrack = mic.getAudioTracks()[0];
  else if (plan === 'mix') {
    ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream(dAudio)).connect(dest);
    ctx.createMediaStreamSource(mic).connect(dest);
    ctx.resume?.().catch(() => {});
    audioTrack = dest.stream.getAudioTracks()[0];
  }
  const stream = new MediaStream([...display.getVideoTracks(), ...(audioTrack ? [audioTrack] : [])]);

  let r;
  try { r = startRecording(stream, chooseMime(!!audioTrack)); }
  catch {
    try { r = startRecording(stream, ''); } catch (e) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); ctx?.close();
      setStatus(status, `이 브라우저에서 녹화를 시작하지 못했습니다: ${e.message}`, 'bad');
      return;
    }
  }
  const clock = createClock();
  clock.start();
  session = { ...r, streams, ctx, clock, plan, timer: setInterval(tick, 250) };
  display.getVideoTracks()[0].addEventListener('ended', stop); // 브라우저의 "공유 중지"
  uiRecording(true);
  recInfo.textContent = `${containerOf(r.rec.mimeType || chooseMime(!!audioTrack)).toUpperCase() || ''} · ${plan === 'none' ? '소리 없음' : plan === 'mix' ? '화면 소리+마이크' : plan === 'mic' ? '마이크' : '화면 소리'}`;
  setStatus(status, notes.join(' ') || '녹화 중입니다. 끝나면 정지를 누르세요.', notes.length ? 'warn' : '');
  tick();
  r.done.then(finish).catch((e) => { cleanup(); session = null; uiRecording(false); setStatus(status, `녹화 중 오류가 났습니다: ${e.message}`, 'bad'); });
}

function tick() { if (session) timerEl.textContent = fmtClock(session.clock.elapsed() / 1000); }

function stop() {
  if (!session || session.stopping) return;
  session.stopping = true;
  session.clock.pause();
  if (session.rec.state !== 'inactive') session.rec.stop();
}

function togglePause() {
  if (!session) return;
  if (session.rec.state === 'recording') { session.rec.pause(); session.clock.pause(); btnPause.textContent = '이어서 녹화'; recBar.classList.add('paused'); }
  else if (session.rec.state === 'paused') { session.rec.resume(); session.clock.resume(); btnPause.textContent = '일시정지'; recBar.classList.remove('paused'); }
}

function finish(blob) {
  const secs = session.clock.elapsed() / 1000;
  const plan = session.plan;
  cleanup();
  session = null;
  uiRecording(false);
  if (!blob.size) { setStatus(status, '녹화된 내용이 없습니다. 다시 시도해 주세요.', 'warn'); return; }
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastBlob = blob; lastUrl = URL.createObjectURL(blob); unsaved = true;
  preview.src = lastUrl;
  result.hidden = false;
  resultInfo.textContent = `${fmtClock(secs)} · ${fmtBytes(blob.size)} · ${extForMime(blob.type).toUpperCase()}`;
  setStatus(status, '녹화가 끝났습니다. 미리 보고 저장하세요.', 'ok');
  track('tool_use', { tool: 'screen-recorder', seconds: Math.round(secs), format: extForMime(blob.type), audio: plan });
}

$('#save').addEventListener('click', () => {
  if (!lastBlob) return;
  download(lastBlob, `${stampName('screen')}.${extForMime(lastBlob.type)}`);
  unsaved = false;
  track('tool_download', { tool: 'screen-recorder', format: extForMime(lastBlob.type) });
});
btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);
btnPause.addEventListener('click', togglePause);
window.addEventListener('beforeunload', (e) => { if (session || unsaved) { e.preventDefault(); e.returnValue = ''; } });

if (!support.ok) {
  const u = $('#unsupported');
  u.textContent = support.msg; u.hidden = false;
  btnStart.disabled = true;
  $('#setup').hidden = true;
} else {
  setupFormats();
  if (!navigator.userAgentData) $('#sysNote').textContent = '이 브라우저는 화면 소리를 지원하지 않을 수 있습니다(Chrome·Edge 권장)';
}
