/* 화면 녹화: 지원 여부 판단, getDisplayMedia 설정, 소리 구성. */

/**
 * 지원 여부와 안내 문구.
 * 근거(MDN browser-compat-data, 2026-09-25 확인): getDisplayMedia 는 Chrome 72·Edge 79·Firefox 66·Safari 13 이상 데스크톱에서 되고,
 * Chrome Android·Firefox Android·iOS Safari 에서는 지원하지 않는다.
 */
export function screenSupport({ secure = true, getDisplayMedia = false, mediaRecorder = false, mobile = false } = {}) {
  if (!secure) return { ok: false, msg: '보안 연결(https)에서만 화면을 녹화할 수 있습니다.' };
  if (!getDisplayMedia) {
    return {
      ok: false,
      msg: mobile
        ? '휴대폰·태블릿 브라우저는 웹 화면 녹화를 지원하지 않습니다. PC의 Chrome·Edge·Firefox·Safari에서 열어 주세요. 휴대폰 화면은 기기에 들어 있는 화면 기록 기능을 쓰시면 됩니다.'
        : '이 브라우저는 화면 녹화(getDisplayMedia)를 지원하지 않습니다. 최신 Chrome·Edge·Firefox·Safari에서 열어 주세요.',
    };
  }
  if (!mediaRecorder) return { ok: false, msg: '이 브라우저는 녹화 기능(MediaRecorder)을 지원하지 않습니다. 최신 브라우저로 열어 주세요.' };
  return { ok: true, msg: '' };
}

/** getDisplayMedia 옵션. 모르는 옵션은 브라우저가 무시한다(systemAudio·surfaceSwitching 은 Chrome 계열 전용). */
export function displayOptions({ audio = false, frameRate = 30 } = {}) {
  const o = { video: { frameRate: { ideal: frameRate } }, audio: !!audio, surfaceSwitching: 'include' };
  if (audio) o.systemAudio = 'include';
  return o;
}

/** 소리 구성: 'none' | 'display' | 'mic' | 'mix' */
export function audioPlan({ displayAudio = false, mic = false } = {}) {
  if (displayAudio && mic) return 'mix';
  if (displayAudio) return 'display';
  if (mic) return 'mic';
  return 'none';
}

/** 녹화 크기 대략(MB): 비트레이트(bps) × 초 */
export function estimateMB(bitsPerSecond, seconds) {
  return (bitsPerSecond * seconds) / 8 / 1024 / 1024;
}
