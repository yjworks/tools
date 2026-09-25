/* 음성 녹음기: 레벨 계산, 마이크 설정. */
import { gainToDb } from './media.js';

/** 파형 조각(-1~1)의 피크·RMS(dBFS) */
export function levelOf(samples) {
  let peak = 0, sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i]; const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return { peakDb: gainToDb(peak), rmsDb: gainToDb(rms) };
}

/** 피크 표시: 올라갈 땐 바로, 내려갈 땐 초당 decayDb 만큼 천천히 */
export function holdPeak(prevDb, nowDb, dtSec, decayDb = 20) {
  if (!Number.isFinite(prevDb)) return nowDb;
  return nowDb >= prevDb ? nowDb : Math.max(nowDb, prevDb - decayDb * dtSec);
}

/** 마이크 설정. raw=true 면 브라우저의 잡음 억제·에코 제거·자동 음량을 끈다. */
export function micConstraints({ raw = false, deviceId = '' } = {}) {
  const c = { echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: !raw };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

/** 레벨 상태 문구 */
export function levelHint(peakDb) {
  if (!Number.isFinite(peakDb) || peakDb < -50) return '소리가 거의 들어오지 않습니다';
  if (peakDb > -1) return '너무 큽니다 — 마이크에서 조금 떨어지세요';
  if (peakDb < -30) return '작은 편입니다';
  return '적당합니다';
}

export function micSupport({ secure = true, getUserMedia = false, mediaRecorder = false } = {}) {
  if (!secure) return { ok: false, msg: '보안 연결(https)에서만 마이크를 쓸 수 있습니다.' };
  if (!getUserMedia) return { ok: false, msg: '이 브라우저는 마이크 사용(getUserMedia)을 지원하지 않습니다.' };
  if (!mediaRecorder) return { ok: false, msg: '이 브라우저는 녹음 기능(MediaRecorder)을 지원하지 않습니다. 최신 브라우저로 열어 주세요.' };
  return { ok: true, msg: '' };
}
