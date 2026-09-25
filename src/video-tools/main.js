import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { VIDEO_AV_TYPES, VIDEO_ONLY_TYPES, pickMime, extForMime, fmtClock, fmtSec, startRecording } from '../_shared/media.js';
import {
  SPEEDS, MAX_FRAMES, clampSpeed, hasChanges, outputSize, rotationMatrix, outputDuration, frameTimes, frameName, uniqueNames,
} from '../_shared/video-tools.js';

const status = $('#status'), work = $('#work'), player = $('#player'), info = $('#info');
const imgFmt = $('#imgFmt'), every = $('#every'), from = $('#from'), to = $('#to'), grabNote = $('#grabNote');
const muteBox = $('#mute'), rotSel = $('#rot'), speedSel = $('#speed');
const btnConvert = $('#convert'), btnCancel = $('#cancel'), prog = $('#prog'), convNote = $('#convNote');
const convResult = $('#convResult'), outVideo = $('#outVideo'), outInfo = $('#outInfo');

speedSel.replaceChildren(...SPEEDS.map((s) => h('option', { value: s, selected: s === 1 }, `${s}배속`)));

let file = null, url = '', base = 'video';
let job = null; // 변환 중 상태
let outBlob = null, outUrl = '';

/* ---------- 기능 확인 ---------- */
const canRecord = typeof window.MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
const isSup = (t) => (typeof window.MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(t) : false);
if (!canRecord) {
  const u = $('#convUnsupported');
  u.textContent = '이 브라우저는 캔버스 녹화(MediaRecorder·captureStream)를 지원하지 않아 음소거·회전·속도 변환을 할 수 없습니다. 프레임 추출은 쓸 수 있습니다.';
  u.hidden = false;
  btnConvert.disabled = true;
}

/* ---------- 파일 열기 ---------- */

fileDrop($('.drop'), (files) => {
  const f = files[0];
  if (!f) return;
  if (job) { setStatus(status, '변환 중에는 다른 파일을 열 수 없습니다. 먼저 취소해 주세요.', 'warn'); return; }
  if (url) URL.revokeObjectURL(url);
  file = f; base = baseName(f.name) || 'video'; url = URL.createObjectURL(f);
  convResult.hidden = true;
  setStatus(status, '영상을 여는 중…');
  player.onloadedmetadata = () => {
    work.hidden = false;
    to.value = player.duration.toFixed(1);
    info.textContent = `${player.videoWidth}×${player.videoHeight} · ${fmtClock(player.duration)} · ${fmtBytes(f.size)}`;
    setStatus(status, '영상을 열었습니다.', 'ok');
    updateGrabNote(); updateConvNote();
    track('tool_use', { tool: 'video-tools', seconds: Math.round(player.duration), height: player.videoHeight });
  };
  player.onerror = () => setStatus(status, '이 영상을 열지 못했습니다. 브라우저가 재생할 수 있는 형식(MP4·WebM 등)인지 확인해 주세요.', 'bad');
  player.src = url;
});

/* ---------- ① 프레임 추출 ---------- */

const imgType = () => (imgFmt.value === 'jpg' ? 'image/jpeg' : 'image/png');

function frameToBlob(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('그림을 만들지 못했습니다'))), imgType(), 0.92));
}

function seek(video, t) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && Math.abs(video.currentTime - t) < 1e-3) { resolve(); return; }
    const timer = setTimeout(() => { video.removeEventListener('seeked', on); reject(new Error('탐색 시간이 너무 오래 걸립니다')); }, 15000);
    function on() { clearTimeout(timer); video.removeEventListener('seeked', on); setTimeout(resolve, 30); }
    video.addEventListener('seeked', on);
    video.currentTime = t;
  });
}

function currentTimes() {
  return frameTimes(player.duration, Number(every.value), { start: Number(from.value) || 0, end: to.value === '' ? player.duration : Number(to.value), max: MAX_FRAMES });
}

function updateGrabNote() {
  if (!player.duration) return;
  const { times, truncated } = currentTimes();
  grabNote.textContent = times.length ? `${times.length}장${truncated ? ` (최대 ${MAX_FRAMES}장까지만)` : ''}` : '간격을 확인해 주세요';
}
[every, from, to].forEach((el) => el.addEventListener('input', updateGrabNote));

$('#grab').addEventListener('click', async () => {
  if (!player.videoWidth) return;
  try {
    const t = player.currentTime;
    const blob = await frameToBlob(player);
    download(blob, frameName(base, 0, t, imgFmt.value).replace('-001-', '-'));
    setStatus(status, `${fmtSec(t)} 장면을 저장했습니다 (${fmtBytes(blob.size)}).`, 'ok');
    track('tool_download', { tool: 'video-tools', kind: 'frame', count: 1 });
  } catch (e) { setStatus(status, `장면을 저장하지 못했습니다: ${e.message}`, 'bad'); }
});

let grabbing = false;
$('#grabAll').addEventListener('click', async () => {
  if (grabbing || !url) return;
  const { times } = currentTimes();
  if (!times.length) { setStatus(status, '간격과 시작·끝을 확인해 주세요.', 'warn'); return; }
  grabbing = true;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('영상을 읽지 못했습니다')); });
    const names = [], datas = [];
    for (let i = 0; i < times.length; i++) {
      setStatus(status, `사진을 뽑는 중… ${i + 1} / ${times.length}`);
      await seek(v, times[i]);
      const b = await frameToBlob(v);
      names.push(frameName(base, i, times[i], imgFmt.value));
      datas.push(new Uint8Array(await b.arrayBuffer()));
    }
    if (datas.length === 1) download(new Blob([datas[0]], { type: imgType() }), names[0]);
    else {
      const files = {};
      uniqueNames(names).forEach((n, i) => (files[n] = [datas[i], { level: 0 }]));
      download(new Blob([zipSync(files)], { type: 'application/zip' }), `${base}-frames.zip`);
    }
    const total = datas.reduce((s, d) => s + d.length, 0);
    setStatus(status, `${datas.length}장을 저장했습니다 (${fmtBytes(total)}).`, 'ok');
    track('tool_download', { tool: 'video-tools', kind: 'frames', count: datas.length });
  } catch (e) {
    setStatus(status, `사진을 뽑지 못했습니다: ${e.message}`, 'bad');
  } finally {
    v.removeAttribute('src'); v.load();
    grabbing = false;
  }
});

/* ---------- ② 음소거·회전·속도 ---------- */

function opts() { return { mute: muteBox.checked, rotation: Number(rotSel.value), speed: clampSpeed(speedSel.value) }; }

function updateConvNote() {
  if (!player.duration) return;
  const o = opts();
  convNote.textContent = hasChanges(o) ? `약 ${fmtClock(outputDuration(player.duration, o.speed))} 걸립니다` : '바꿀 항목을 골라 주세요';
}
[muteBox, rotSel, speedSel].forEach((el) => el.addEventListener('change', updateConvNote));

function convUi(on) {
  btnConvert.hidden = on; btnCancel.hidden = !on; prog.hidden = !on;
  [muteBox, rotSel, speedSel].forEach((el) => (el.disabled = on));
}

function endJob() {
  if (!job) return;
  job.cancelled = true;
  cancelAnimationFrame(job.raf);
  job.video.pause();
  job.stream?.getTracks().forEach((t) => t.stop());
  job.actx?.close().catch(() => {});
  job.video.removeAttribute('src'); job.video.load();
  clearInterval(job.progTimer);
}

btnConvert.addEventListener('click', async () => {
  if (job || !url) return;
  const o = opts();
  if (!hasChanges(o)) { setStatus(status, '소리 없애기·회전·속도 중 하나 이상을 바꿔 주세요.', 'warn'); return; }
  convResult.hidden = true;
  const v = document.createElement('video');
  v.playsInline = true; v.preload = 'auto'; v.src = url;
  v.muted = o.mute;
  job = { video: v, raf: 0, cancelled: false };
  convUi(true);
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('영상을 읽지 못했습니다')); });
    const { sw, sh, W, H } = outputSize(v.videoWidth, v.videoHeight, o.rotation);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const m = rotationMatrix(o.rotation, sw, sh);
    const draw = () => { g.setTransform(...m); g.drawImage(v, 0, 0, sw, sh); };
    draw();
    const vTrack = canvas.captureStream().getVideoTracks()[0];
    let aTrack = null;
    if (!o.mute) {
      job.actx = new AudioContext();
      const dest = job.actx.createMediaStreamDestination();
      job.actx.createMediaElementSource(v).connect(dest); // 스피커로는 내보내지 않는다
      await job.actx.resume?.();
      aTrack = dest.stream.getAudioTracks()[0];
    }
    job.stream = new MediaStream([vTrack, ...(aTrack ? [aTrack] : [])]);
    const all = aTrack ? VIDEO_AV_TYPES : VIDEO_ONLY_TYPES;
    const mime = pickMime(all, isSup);
    const bps = Math.min(12e6, Math.max(2.5e6, W * H * 4));
    let r;
    try { r = startRecording(job.stream, mime, { bitsPerSecond: bps }); }
    catch { r = startRecording(job.stream, ''); }
    job.rec = r.rec;

    v.playbackRate = o.speed;
    if ('preservesPitch' in v) v.preservesPitch = true;
    const loop = () => {
      if (job?.cancelled) return;
      draw();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop); else job.raf = requestAnimationFrame(loop);
    };
    loop();
    job.progTimer = setInterval(() => {
      prog.value = v.duration ? v.currentTime / v.duration : 0;
      setStatus(status, `변환 중… ${Math.round(prog.value * 100)}% (이 탭을 띄워 두세요)`);
    }, 300);
    v.onended = () => { draw(); if (job?.rec?.state !== 'inactive') job.rec.stop(); };
    await v.play();
    const blob = await r.done;
    const cancelled = job.cancelled;
    endJob(); job = null; convUi(false);
    if (cancelled) return;
    if (outUrl) URL.revokeObjectURL(outUrl);
    outBlob = blob; outUrl = URL.createObjectURL(blob);
    outVideo.src = outUrl; convResult.hidden = false;
    outInfo.textContent = `${W}×${H} · ${fmtBytes(blob.size)} · ${extForMime(blob.type).toUpperCase()}`;
    setStatus(status, '변환이 끝났습니다. 확인하고 저장하세요.', 'ok');
    track('tool_use', { tool: 'video-tools', kind: 'convert', mute: o.mute, rotation: o.rotation, speed: o.speed });
  } catch (e) {
    const cancelled = job?.cancelled;
    endJob(); job = null; convUi(false);
    if (!cancelled) setStatus(status, e?.name === 'NotAllowedError' ? '브라우저가 재생을 막았습니다. 변환 시작을 다시 눌러 주세요.' : `변환하지 못했습니다: ${e.message}`, 'bad');
  }
});

btnCancel.addEventListener('click', () => {
  if (!job) return;
  job.cancelled = true;
  if (job.rec && job.rec.state !== 'inactive') job.rec.stop(); else { endJob(); job = null; convUi(false); }
  setStatus(status, '변환을 취소했습니다.', 'warn');
});

$('#saveOut').addEventListener('click', () => {
  if (!outBlob) return;
  download(outBlob, `${base}-edit.${extForMime(outBlob.type)}`);
  track('tool_download', { tool: 'video-tools', kind: 'convert', format: extForMime(outBlob.type) });
});

window.addEventListener('beforeunload', (e) => { if (job || grabbing) { e.preventDefault(); e.returnValue = ''; } });
