/* 영상 도구: 프레임 추출 시각, 회전 변환 행렬, 출력 크기, 속도. */

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const MAX_FRAMES = 300;

export function clampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

/** 바꿀 것이 하나라도 있는지 */
export function hasChanges({ mute = false, rotation = 0, speed = 1 } = {}) {
  return !!mute || normRotation(rotation) !== 0 || clampSpeed(speed) !== 1;
}

export function normRotation(r) { return ((Math.round(Number(r) / 90) * 90) % 360 + 360) % 360; }

/** 결과 영상 길이(초): 속도를 두 배로 하면 절반 */
export function outputDuration(duration, speed) { return duration / clampSpeed(speed); }

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/**
 * 출력 크기. 긴 변을 maxSide 이하로 줄이고 짝수로 맞춘다(인코더가 짝수를 좋아한다).
 * sw·sh: 회전 전 그림 크기, W·H: 회전 뒤 캔버스 크기
 */
export function outputSize(vw, vh, rotation = 0, maxSide = 1920) {
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const sw = even(vw * scale), sh = even(vh * scale);
  const r = normRotation(rotation);
  return r === 90 || r === 270 ? { sw, sh, W: sh, H: sw } : { sw, sh, W: sw, H: sh };
}

/**
 * 캔버스 setTransform(a, b, c, d, e, f) 값. 그림을 (0,0,sw,sh)에 그리면 시계 방향으로 rotation 만큼 돌아간다.
 * X = a·x + c·y + e,  Y = b·x + d·y + f
 */
export function rotationMatrix(rotation, sw, sh) {
  switch (normRotation(rotation)) {
    case 90: return [0, 1, -1, 0, sh, 0];
    case 180: return [-1, 0, 0, -1, sw, sh];
    case 270: return [0, -1, 1, 0, 0, sw];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** 점 하나를 행렬로 옮기기(시험용) */
export function applyMatrix([a, b, c, d, e, f], x, y) { return [a * x + c * y + e, b * x + d * y + f]; }

/**
 * N초마다 뽑을 시각 목록. 끝 지점은 마지막 프레임을 얻을 수 있도록 살짝 앞으로 당긴다.
 * @returns {{ times: number[], truncated: boolean }}
 */
export function frameTimes(duration, every, { start = 0, end = duration, max = MAX_FRAMES } = {}) {
  const step = Number(every);
  if (!(duration > 0) || !(step > 0)) return { times: [], truncated: false };
  const s = Math.max(0, Math.min(start, duration)), e = Math.max(s, Math.min(end, duration));
  const lastSafe = Math.max(0, duration - 0.05);
  const times = [];
  let truncated = false;
  for (let k = 0; ; k++) {
    const t = s + k * step;
    if (t > e + 1e-9) break;
    if (times.length >= max) { truncated = true; break; }
    times.push(Math.round(Math.min(t, lastSafe) * 1000) / 1000);
  }
  return { times: [...new Set(times)], truncated };
}

/** 프레임 파일 이름: clip-001-12.50s.png */
export function frameName(base, index, t, ext) {
  return `${base}-${String(index + 1).padStart(3, '0')}-${t.toFixed(2)}s.${ext}`;
}

/** 이름이 겹치면 -2, -3 을 붙인다(zip 용) */
export function uniqueNames(names) {
  const seen = new Set();
  return names.map((n) => {
    let out = n, i = 2;
    while (seen.has(out)) out = n.replace(/(\.\w+)?$/, (m) => `-${i++}${m}`);
    seen.add(out);
    return out;
  });
}
