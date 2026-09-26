/*
 * 거북목 알리미(posture-alert)의 순수 로직. 화면·카메라와 떨어져 있어 테스트한다.
 *
 * 입력은 MediaPipe PoseLandmarker 의 정규화 좌표(x·y 0~1, 왼쪽 위가 0)다.
 * 영상은 다루지 않는다. 좌표 몇 개로 "기준 자세와 얼마나 달라졌나"만 계산한다.
 * 의료 판단이 아니라, 처음에 잡은 기준 자세에서 벗어난 정도를 알려 주는 용도다.
 */

/** 자세 인식 모델(Apache-2.0). 받기 전에 크기를 알린다. */
export const MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  bytes: 5777746,
};
/** public/mediapipe/wasm 의 파일 크기(@mediapipe/tasks-vision 1.0.1). 받기 전 안내용. */
export const WASM_BYTES = { simd: 11756954, nosimd: 10960242 };

/** BlazePose 33점 중 쓰는 점. 사람 기준 왼쪽/오른쪽이다. */
export const LM = { NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12 };
export const MIN_VIS = 0.5;

/**
 * 민감도별 허용 폭. 기준 대비 이만큼 달라지면 "벗어남"(점수 1).
 * drop: 눈~어깨 높이가 줄어든 비율, fwd: 어깨 폭 대비 얼굴 폭이 커진 비율(고개가 앞으로),
 * close: 화면 속 얼굴 폭이 커진 비율(화면에 가까워짐), tilt: 눈높이 기울기(도), lean: 어깨 가운데에서 옆으로 비킨 정도(어깨 폭 대비).
 */
export const SENSITIVITY = {
  low: { drop: 0.25, fwd: 0.22, close: 0.3, tilt: 16, lean: 0.35 },
  mid: { drop: 0.17, fwd: 0.15, close: 0.22, tilt: 12, lean: 0.25 },
  high: { drop: 0.11, fwd: 0.1, close: 0.15, tilt: 8, lean: 0.18 },
};

export const REASON_TEXT = {
  drop: '고개가 내려갔어요',
  fwd: '고개가 앞으로 나왔어요',
  close: '화면에 가까워졌어요',
  tilt: '고개가 한쪽으로 기울었어요',
  lean: '몸이 한쪽으로 기울었어요',
};

const vis = (p) => (p && typeof p.visibility === 'number' ? p.visibility : 1);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 한 장면의 좌표 → 자세 수치. aspect = 영상 가로/세로(좌표를 같은 단위로 맞춘다. 단위는 '영상 높이').
 * 어깨가 안 보이면 partial(얼굴 크기·기울기만), 얼굴이 안 보이면 ok:false.
 */
export function frameMetrics(lms, aspect = 4 / 3) {
  if (!lms || lms.length < 13) return { ok: false, reason: 'none' };
  const P = (i) => ({ x: lms[i].x * aspect, y: lms[i].y, v: vis(lms[i]) });
  const nose = P(LM.NOSE), le = P(LM.L_EYE), re = P(LM.R_EYE), la = P(LM.L_EAR), ra = P(LM.R_EAR);
  const ls = P(LM.L_SH), rs = P(LM.R_SH);
  if (Math.min(nose.v, le.v, re.v) < MIN_VIS) return { ok: false, reason: 'face' };
  const eye = mid(le, re);
  const size = Math.hypot(la.x - ra.x, la.y - ra.y);
  const [a, b] = le.x <= re.x ? [le, re] : [re, le];
  const roll = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const base = { ok: true, size, roll };
  if (Math.min(ls.v, rs.v) < MIN_VIS) return { ...base, partial: true, reason: 'shoulders' };
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (sw < 0.05) return { ...base, partial: true, reason: 'far' };
  const sh = mid(ls, rs);
  return {
    ...base,
    partial: false,
    sw,
    neck: (sh.y - eye.y) / sw,
    face: size / sw,
    lean: (eye.x - sh.x) / sw,
  };
}

export function median(arr) {
  const s = [...arr].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 기준 잡기: 몇 초 동안 모은 수치의 중앙값. 어깨까지 보이는 장면이 minFrames 이상 있어야 한다.
 * 크게 움직였으면(목 높이의 20~80% 구간 폭이 중앙값의 maxSpread 넘음) 다시 하게 한다. 한두 장면 튄 값은 무시된다.
 */
export function calibrate(samples, { minFrames = 5, maxSpread = 0.2 } = {}) {
  const full = samples.filter((m) => m && m.ok && !m.partial);
  if (full.length < minFrames) {
    const partial = samples.filter((m) => m && m.ok && m.partial).length;
    return { ok: false, reason: partial >= minFrames ? 'shoulders' : 'few' };
  }
  const keys = ['neck', 'face', 'size', 'roll', 'lean', 'sw'];
  const baseline = Object.fromEntries(keys.map((k) => [k, median(full.map((m) => m[k]))]));
  if (!(baseline.neck > 0.1)) return { ok: false, reason: 'pose' };
  const necks = full.map((m) => m.neck).sort((x, y) => x - y), n = necks.length - 1;
  const spread = (necks[Math.round(n * 0.8)] - necks[Math.round(n * 0.2)]) / baseline.neck;
  if (spread > maxSpread) return { ok: false, reason: 'moving' };
  return { ok: true, baseline, frames: full.length };
}

/**
 * 기준과 비교한 점수. score 1 이상 = 허용 폭을 넘음. parts 는 항목별 점수, reason 은 가장 큰 항목.
 * 어깨가 안 보이는 장면(partial)은 '화면에 가까워짐'만 판단하고, 그것도 아니면 판단 불가(null).
 */
export function deviation(m, base, sens = SENSITIVITY.mid) {
  if (!m || !m.ok || !base) return null;
  const parts = {
    close: Math.max(0, m.size / base.size - 1) / sens.close,
    tilt: Math.abs(m.roll - base.roll) / sens.tilt,
  };
  if (!m.partial) {
    parts.drop = Math.max(0, (base.neck - m.neck) / base.neck) / sens.drop;
    parts.fwd = Math.max(0, m.face / base.face - 1) / sens.fwd;
    parts.lean = Math.abs(m.lean - base.lean) / sens.lean;
  } else if (parts.close < 1) {
    return null;
  }
  let reason = 'close';
  for (const k of Object.keys(parts)) if (parts[k] > parts[reason]) reason = k;
  return { score: parts[reason], reason, parts };
}

/** 흔들림 줄이기: 이전 값과 섞는다(alpha 가 클수록 새 값 비중이 크다). */
export function smoothMetrics(prev, cur, alpha = 0.5) {
  if (!cur || !cur.ok) return cur;
  if (!prev || !prev.ok || prev.partial !== cur.partial) return cur;
  const out = { ...cur };
  for (const k of ['size', 'roll', 'sw', 'neck', 'face', 'lean']) {
    if (typeof cur[k] === 'number' && typeof prev[k] === 'number') out[k] = prev[k] + alpha * (cur[k] - prev[k]);
  }
  return out;
}

export const MONITOR_DEFAULTS = {
  holdMs: 15000, // 이만큼 계속 벗어나 있으면 알림
  cooldownMs: 60000, // 알림 뒤 이 시간 안에는 다시 알리지 않음
  recoverAt: 0.7, // 점수가 이 아래로 내려와야 '바른 자세'로 돌아옴(히스테리시스)
  awayMs: 4000, // 사람이 이만큼 안 보이면 자리 비움
  maxGapMs: 3000, // 장면 사이 간격이 이보다 길면(탭이 멈춤 등) 이어서 본 것으로 치지 않음
};

/**
 * 알림 상태 기계. update(t, dev) 에 시각(ms)과 deviation() 결과(없으면 null)를 넣는다.
 * posture: 'unknown' | 'good' | 'bad' | 'away'. 돌려주는 events: {type:'alert', reason} | {type:'recovered'} | {type:'away'} | {type:'back'}
 * counted: 이번 장면 사이 시간을 어느 칸에 셀지({kind:'good'|'bad'|'away', ms}).
 */
export function createMonitor(opts = {}) {
  const cfg = { ...MONITOR_DEFAULTS, ...opts };
  const st = { posture: 'unknown', badSince: null, lastSeen: null, lastT: null, lastAlert: null, alerted: false, reason: null, score: 0 };
  function update(t, dev) {
    const events = [];
    const gap = st.lastT == null ? 0 : t - st.lastT;
    const dt = Math.max(0, Math.min(gap, cfg.maxGapMs));
    const broken = gap > cfg.maxGapMs;
    st.lastT = t;
    const prev = st.posture;
    if (!dev) {
      if (st.lastSeen == null || t - st.lastSeen >= cfg.awayMs || broken) {
        if (prev !== 'away') events.push({ type: 'away' });
        st.posture = 'away'; st.badSince = null; st.alerted = false;
      }
    } else {
      st.lastSeen = t; st.score = dev.score;
      if (dev.score >= 1) { st.posture = 'bad'; st.reason = dev.reason; }
      else if (dev.score <= cfg.recoverAt || prev === 'away' || prev === 'unknown') st.posture = 'good';
      if (prev === 'away') events.push({ type: 'back' });
      if (st.posture === 'bad') {
        if (st.badSince == null || broken) st.badSince = t;
      } else {
        if (st.alerted) events.push({ type: 'recovered' });
        st.badSince = null; st.alerted = false;
      }
    }
    if (st.posture === 'bad' && t - st.badSince >= cfg.holdMs && (st.lastAlert == null || t - st.lastAlert >= cfg.cooldownMs)) {
      st.lastAlert = t; st.alerted = true;
      events.push({ type: 'alert', reason: st.reason });
    }
    const kind = st.posture === 'unknown' ? 'away' : st.posture;
    return { posture: st.posture, badFor: st.badSince == null ? 0 : t - st.badSince, events, counted: { kind, ms: dt } };
  }
  function set(o) { Object.assign(cfg, o); }
  return { update, set, get state() { return { ...st }; }, get config() { return { ...cfg }; } };
}

/**
 * 휴식 알림: 자리에 있던 시간을 모아 intervalMs 가 되면 알린다.
 * awayResetMs 이상 자리를 비우면 쉬고 온 것으로 보고 처음부터 센다.
 */
export function createBreakTimer({ intervalMs = 20 * 60000, awayResetMs = 3 * 60000, maxGapMs = 3000 } = {}) {
  let active = 0, away = 0, lastT = null;
  return {
    update(t, present) {
      const dt = lastT == null ? 0 : Math.max(0, Math.min(t - lastT, maxGapMs));
      lastT = t;
      if (!intervalMs) return { due: false, remainingMs: Infinity };
      if (present) { active += dt; away = 0; }
      else { away += dt; if (away >= awayResetMs) active = 0; }
      if (active >= intervalMs) { active = 0; return { due: true, remainingMs: intervalMs }; }
      return { due: false, remainingMs: intervalMs - active };
    },
    reset() { active = 0; away = 0; },
    setInterval(ms) { intervalMs = ms; if (active >= ms) active = 0; },
  };
}

/* ---------- 오늘 기록(이 기기 localStorage 에만) ---------- */

export const STATS_KEY = 'posture-alert:stats';
export const SETTINGS_KEY = 'posture-alert:settings';
export const BASELINE_KEY = 'posture-alert:baseline';

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDay() {
  return { good: Array(24).fill(0), bad: Array(24).fill(0), alerts: 0, breaks: 0 };
}

export function parseStore(json) {
  try {
    const s = JSON.parse(json);
    if (!s || typeof s !== 'object' || typeof s.days !== 'object' || !s.days) return { days: {} };
    for (const [k, d] of Object.entries(s.days)) {
      if (!/^\d{4}-\d\d-\d\d$/.test(k) || !Array.isArray(d.good) || d.good.length !== 24 || !Array.isArray(d.bad) || d.bad.length !== 24) delete s.days[k];
    }
    return s;
  } catch { return { days: {} }; }
}

function dayOf(store, ts) {
  const k = dayKey(ts);
  return (store.days[k] ||= emptyDay());
}

/** 자세 시간 더하기(kind: 'good' | 'bad'. 자리 비움은 세지 않는다). ts 가 속한 시각(시)에 넣는다. */
export function addTime(store, ts, ms, kind) {
  if (!(ms > 0) || (kind !== 'good' && kind !== 'bad')) return store;
  const d = dayOf(store, ts);
  d[kind][new Date(ts).getHours()] += Math.round(ms);
  return store;
}

export function addEvent(store, ts, kind) {
  if (kind !== 'alerts' && kind !== 'breaks') return store;
  dayOf(store, ts)[kind] += 1;
  return store;
}

/** 오래된 날 지우기(keepDays 일만 남긴다). */
export function prune(store, now, keepDays = 14) {
  const keys = Object.keys(store.days).sort();
  const today = dayKey(now);
  for (const k of keys) if (k > today) delete store.days[k];
  const rest = Object.keys(store.days).sort();
  for (const k of rest.slice(0, Math.max(0, rest.length - keepDays))) delete store.days[k];
  return store;
}

export function summarize(day) {
  const d = day || emptyDay();
  const good = d.good.reduce((a, b) => a + b, 0), bad = d.bad.reduce((a, b) => a + b, 0);
  const total = good + bad;
  const hours = d.good.map((g, i) => ({ hour: i, good: g, bad: d.bad[i], total: g + d.bad[i] }));
  return {
    totalMs: total,
    minutes: Math.floor(total / 60000),
    goodPct: total ? Math.round((good / total) * 100) : null,
    alerts: d.alerts,
    breaks: d.breaks,
    hours,
    maxHourMs: Math.max(0, ...hours.map((h) => h.total)),
  };
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}

export function fmtMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)}MB`; }

/** 이 브라우저에서 다른 창을 쓰는 동안 계속 확인할 방법. */
export function backgroundSupport({ documentPip = false, videoPip = false, mobile = false } = {}) {
  if (mobile) return { mode: 'none', text: '휴대폰·태블릿에서는 화면이 꺼지거나 다른 앱으로 가면 확인이 멈춥니다. 이 화면을 켜 둔 채로 쓰세요.' };
  if (documentPip) return { mode: 'document', text: '작은 창으로 띄우면 다른 창에서 일하는 동안에도 계속 확인합니다.' };
  if (videoPip) return { mode: 'video', text: '카메라 화면을 작은 창(화면 속 화면)으로 띄우면 다른 창에서도 확인이 이어질 수 있습니다. 브라우저에 따라 느려지거나 멈출 수 있습니다.' };
  return { mode: 'none', text: '이 브라우저는 작은 창을 지원하지 않습니다. 다른 탭으로 가면 확인이 느려지거나 멈출 수 있으니, 이 탭을 보이는 창에 두세요.' };
}
