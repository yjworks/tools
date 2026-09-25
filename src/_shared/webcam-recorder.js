/* 웹캠 녹화: 해상도·카메라 설정 만들기. */

export const RESOLUTIONS = [
  { id: '480p', w: 640, h: 480, label: '480p (640×480)' },
  { id: '720p', w: 1280, h: 720, label: '720p (1280×720)' },
  { id: '1080p', w: 1920, h: 1080, label: '1080p (1920×1080)' },
];

export function resolutionById(id) { return RESOLUTIONS.find((r) => r.id === id) || RESOLUTIONS[1]; }

/** getUserMedia 의 video 설정. ideal 이라서 카메라가 못 하면 가까운 값으로 열린다. */
export function videoConstraints({ deviceId = '', res = '720p', frameRate = 30 } = {}) {
  const r = resolutionById(res);
  const c = { width: { ideal: r.w }, height: { ideal: r.h }, frameRate: { ideal: frameRate } };
  if (deviceId) c.deviceId = { exact: deviceId };
  else c.facingMode = 'user';
  return c;
}

/** 카메라 이름. 권한 전에는 label 이 비어 있다. */
export function cameraLabel(device, index) {
  return (device && device.label) || `카메라 ${index + 1}`;
}

/** 실제로 열린 설정 설명: "1280×720 · 30fps" */
export function describeSettings(s = {}) {
  const parts = [];
  if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
  if (s.frameRate) parts.push(`${Math.round(s.frameRate)}fps`);
  return parts.join(' · ');
}

export function webcamSupport({ secure = true, getUserMedia = false, mediaRecorder = false } = {}) {
  if (!secure) return { ok: false, msg: '보안 연결(https)에서만 카메라를 쓸 수 있습니다.' };
  if (!getUserMedia) return { ok: false, msg: '이 브라우저는 카메라 사용(getUserMedia)을 지원하지 않습니다.' };
  if (!mediaRecorder) return { ok: false, msg: '이 브라우저는 녹화 기능(MediaRecorder)을 지원하지 않습니다. 최신 브라우저로 열어 주세요.' };
  return { ok: true, msg: '' };
}
