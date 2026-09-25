import { $, h, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import {
  VIDEO_AV_TYPES, VIDEO_ONLY_TYPES, supportedContainers, containerOf, pickMime, extForMime,
  fmtClock, stampName, createClock, startRecording,
} from '../_shared/media.js';
import { RESOLUTIONS, videoConstraints, cameraLabel, describeSettings, webcamSupport } from '../_shared/webcam-recorder.js';

const status = $('#status');
const camSel = $('#cam'), resSel = $('#res'), fmtSel = $('#fmt'), micOn = $('#micOn'), mirror = $('#mirror');
const live = $('#live'), placeholder = $('#placeholder'), badge = $('#badge'), timerEl = $('#timer');
const btnOpen = $('#open'), btnRec = $('#rec'), btnPause = $('#pause'), btnStop = $('#stop'), btnClose = $('#close');
const result = $('#result'), preview = $('#preview'), resultInfo = $('#resultInfo');

const hasRecorder = typeof window.MediaRecorder !== 'undefined';
const isSup = (t) => (hasRecorder && typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(t) : false);

let stream = null, session = null, lastBlob = null, lastUrl = '', unsaved = false;

resSel.replaceChildren(...RESOLUTIONS.map((r) => h('option', { value: r.id, selected: r.id === '720p' }, r.label)));
const formats = supportedContainers(VIDEO_AV_TYPES, isSup);
fmtSel.replaceChildren(...(formats.length ? formats.map((o) => h('option', { value: o.container }, o.container.toUpperCase())) : [h('option', { value: '' }, '브라우저 기본값')]));

function chooseMime(withAudio) {
  const all = withAudio ? VIDEO_AV_TYPES : VIDEO_ONLY_TYPES;
  const want = fmtSel.value;
  return pickMime(all.filter((t) => !want || containerOf(t) === want), isSup) || pickMime(all, isSup);
}

function errorText(e) {
  switch (e?.name) {
    case 'NotAllowedError': return '카메라(마이크) 권한이 거부되었습니다. 주소창의 자물쇠 아이콘에서 허용한 뒤 새로고침해 주세요.';
    case 'NotFoundError': return '카메라를 찾지 못했습니다. 연결을 확인해 주세요.';
    case 'NotReadableError': return '카메라를 열 수 없습니다. 다른 프로그램이 카메라를 쓰고 있는지 확인해 주세요.';
    default: return `카메라를 켜지 못했습니다: ${e?.message || e}`;
  }
}

async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const cur = stream?.getVideoTracks()[0]?.getSettings().deviceId || camSel.value;
    camSel.replaceChildren(...devs.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === cur }, cameraLabel(d, i))));
    if (!devs.length) camSel.append(h('option', { value: '' }, '기본 카메라'));
  } catch { /* 목록을 못 읽어도 기본 카메라로 계속 */ }
}

function stopStream() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }

async function openCamera() {
  if (session) return;
  stopStream();
  setStatus(status, '카메라를 켜는 중…');
  const audio = micOn.checked ? { echoCancellation: true, noiseSuppression: true } : false;
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints({ deviceId: camSel.value, res: resSel.value }), audio });
    } catch (e) {
      if (e.name !== 'OverconstrainedError') throw e;
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints({ res: resSel.value }), audio });
    }
  } catch (e) {
    setStatus(status, errorText(e), 'bad');
    return;
  }
  live.srcObject = stream;
  live.hidden = false; placeholder.hidden = true;
  live.play().catch(() => {});
  btnOpen.hidden = true; btnRec.hidden = false; btnClose.hidden = false;
  await listCameras();
  const s = stream.getVideoTracks()[0]?.getSettings() || {};
  const mic = stream.getAudioTracks().length ? '마이크 켜짐' : '마이크 없음';
  setStatus(status, `카메라가 켜졌습니다 · ${describeSettings(s) || '크기 확인 불가'} · ${mic}`, 'ok');
}

function closeCamera() {
  if (session) return;
  stopStream();
  live.srcObject = null; live.hidden = true; placeholder.hidden = false;
  btnOpen.hidden = false; btnRec.hidden = true; btnClose.hidden = true;
  setStatus(status, '카메라를 껐습니다.');
}

function uiRecording(on) {
  btnRec.hidden = on; btnPause.hidden = !on; btnStop.hidden = !on; btnClose.hidden = on;
  badge.hidden = !on; badge.classList.remove('paused'); btnPause.textContent = '일시정지';
  [camSel, resSel, fmtSel, micOn].forEach((el) => (el.disabled = on));
}

function startRec() {
  if (!stream || session) return;
  result.hidden = true;
  const withAudio = stream.getAudioTracks().length > 0;
  let r;
  try { r = startRecording(stream, chooseMime(withAudio)); }
  catch {
    try { r = startRecording(stream, ''); } catch (e) { setStatus(status, `녹화를 시작하지 못했습니다: ${e.message}`, 'bad'); return; }
  }
  const clock = createClock(); clock.start();
  session = { ...r, clock, timer: setInterval(() => (timerEl.textContent = fmtClock(clock.elapsed() / 1000)), 250) };
  timerEl.textContent = '0:00';
  uiRecording(true);
  setStatus(status, '녹화 중입니다.');
  r.done.then(finish).catch((e) => { clearInterval(session?.timer); session = null; uiRecording(false); setStatus(status, `녹화 중 오류가 났습니다: ${e.message}`, 'bad'); });
}

function stopRec() {
  if (!session || session.stopping) return;
  session.stopping = true; session.clock.pause();
  if (session.rec.state !== 'inactive') session.rec.stop();
}

function togglePause() {
  if (!session) return;
  if (session.rec.state === 'recording') { session.rec.pause(); session.clock.pause(); btnPause.textContent = '이어서 녹화'; badge.classList.add('paused'); }
  else if (session.rec.state === 'paused') { session.rec.resume(); session.clock.resume(); btnPause.textContent = '일시정지'; badge.classList.remove('paused'); }
}

function finish(blob) {
  const secs = session.clock.elapsed() / 1000;
  clearInterval(session.timer);
  session = null;
  uiRecording(false);
  if (!blob.size) { setStatus(status, '녹화된 내용이 없습니다. 다시 시도해 주세요.', 'warn'); return; }
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastBlob = blob; lastUrl = URL.createObjectURL(blob); unsaved = true;
  preview.src = lastUrl; result.hidden = false;
  resultInfo.textContent = `${fmtClock(secs)} · ${fmtBytes(blob.size)} · ${extForMime(blob.type).toUpperCase()}`;
  setStatus(status, '녹화가 끝났습니다. 아래에서 확인하고 저장하세요.', 'ok');
  track('tool_use', { tool: 'webcam-recorder', seconds: Math.round(secs), format: extForMime(blob.type), res: resSel.value });
}

$('#save').addEventListener('click', () => {
  if (!lastBlob) return;
  download(lastBlob, `${stampName('webcam')}.${extForMime(lastBlob.type)}`);
  unsaved = false;
  track('tool_download', { tool: 'webcam-recorder', format: extForMime(lastBlob.type) });
});
btnOpen.addEventListener('click', openCamera);
btnClose.addEventListener('click', closeCamera);
btnRec.addEventListener('click', startRec);
btnStop.addEventListener('click', stopRec);
btnPause.addEventListener('click', togglePause);
[camSel, resSel, micOn].forEach((el) => el.addEventListener('change', () => { if (stream && !session) openCamera(); }));
mirror.addEventListener('change', () => live.classList.toggle('mirror', mirror.checked));
window.addEventListener('beforeunload', (e) => { if (session || unsaved) { e.preventDefault(); e.returnValue = ''; } });

const support = webcamSupport({ secure: window.isSecureContext !== false, getUserMedia: !!navigator.mediaDevices?.getUserMedia, mediaRecorder: hasRecorder });
if (!support.ok) {
  const u = $('#unsupported'); u.textContent = support.msg; u.hidden = false;
  btnOpen.disabled = true; $('#setup').hidden = true;
}
