/* 집중 타이머 계산: 집중·휴식 순서, 시각 기준 남은 시간, 기록 모으기.
 * 시간은 모두 Date.now() 같은 밀리초 시각(에포크)으로 받는다. 1초마다 숫자를 줄이지 않고
 * "시작 시각 + 이미 흐른 시간"에서 매번 새로 계산하므로, 탭이 숨었다가 돌아와도 오차가 쌓이지 않는다. */

export const PRESETS = {
  p25: { focus: 25, short: 5, long: 15, every: 4 },
  p50: { focus: 50, short: 10, long: 20, every: 3 },
};
export const LIMITS = { min: 0.1, max: 240, everyMin: 1, everyMax: 12 };
/** 이 길이보다 짧은 집중(바로 건너뛴 경우 등)은 기록하지 않는다 */
export const MIN_LOG_MS = 5000;

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** 설정 정리: 분 단위(소수 허용), 긴 휴식 간격은 정수 */
export function sanitizeConfig(c = {}) {
  const d = PRESETS.p25;
  return {
    focus: clamp(c.focus, LIMITS.min, LIMITS.max, d.focus),
    short: clamp(c.short, LIMITS.min, LIMITS.max, d.short),
    long: clamp(c.long, LIMITS.min, LIMITS.max, d.long),
    every: Math.round(clamp(c.every, LIMITS.everyMin, LIMITS.everyMax, d.every)),
  };
}

/**
 * index 번째 단계. 0 집중, 1 휴식, 2 집중, 3 휴식 …
 * n 번째 집중(0부터) 다음 휴식은 (n+1) 이 every 의 배수일 때 긴 휴식.
 * 반환: { type: 'focus'|'short'|'long', ms, round (몇 번째 집중, 1부터), slot (한 묶음 안 위치, 1..every) }
 */
export function phaseAt(index, cfg) {
  const c = sanitizeConfig(cfg);
  const n = Math.floor(index / 2);
  const round = n + 1;
  const slot = (n % c.every) + 1;
  if (index % 2 === 0) return { type: 'focus', ms: c.focus * 60000, round, slot };
  const isLong = round % c.every === 0;
  return { type: isLong ? 'long' : 'short', ms: (isLong ? c.long : c.short) * 60000, round, slot };
}

/** 새 상태: 첫 집중 단계, 멈춘 채 */
export const initialState = () => ({ index: 0, running: false, startedAt: null, acc: 0 });

/** 지금 단계에서 흐른 시간 */
export const elapsedMs = (st, now) => st.acc + (st.running ? Math.max(0, now - st.startedAt) : 0);
/** 남은 시간 (0 아래로 내려가지 않음) */
export const remainingMs = (st, cfg, now) => Math.max(0, phaseAt(st.index, cfg).ms - elapsedMs(st, now));

export function start(st, now) {
  if (st.running) return st;
  return { ...st, running: true, startedAt: now };
}
export function pause(st, now) {
  if (!st.running) return st;
  return { ...st, running: false, startedAt: null, acc: elapsedMs(st, now) };
}

/** 단계 하나를 끝낸 기록: 시작·끝 시각, 실제로 흐른 시간 */
function finishRecord(st, cfg, end, ms, skipped) {
  const p = phaseAt(st.index, cfg);
  return { type: p.type, index: st.index, round: p.round, start: end - ms, end, ms, skipped };
}

/**
 * 시간이 다 된 단계를 정리한다. 탭이 오래 숨어 있었다면 그동안 끝난 단계를 모두 차례로 처리한다.
 * opts.autoBreak: 집중이 끝나면 휴식을 바로 시작, opts.autoFocus: 휴식이 끝나면 집중을 바로 시작.
 * 자동 시작이 꺼져 있으면 다음 단계에서 멈춘다. 다음 단계의 시작 시각은 앞 단계가 끝난 시각이다(지금이 아니라).
 * 반환: { state, finished: [기록…] }
 */
export function settle(st, cfg, now, opts = {}) {
  const finished = [];
  let s = st;
  for (let guard = 0; guard < 1000 && s.running; guard++) {
    const p = phaseAt(s.index, cfg);
    const el = elapsedMs(s, now);
    if (el < p.ms) break;
    const end = now - (el - p.ms);
    finished.push(finishRecord(s, cfg, end, p.ms, false));
    const next = phaseAt(s.index + 1, cfg);
    const auto = next.type === 'focus' ? !!opts.autoFocus : !!opts.autoBreak;
    s = auto ? { index: s.index + 1, running: true, startedAt: end, acc: 0 } : { index: s.index + 1, running: false, startedAt: null, acc: 0 };
  }
  return { state: s, finished };
}

/** 건너뛰기: 지금 단계를 여기서 끝내고 다음 단계로. 돌아가던 중이면 다음 단계도 바로 시작한다. */
export function skip(st, cfg, now) {
  const el = elapsedMs(st, now);
  const rec = finishRecord(st, cfg, now, el, true);
  const state = st.running ? { index: st.index + 1, running: true, startedAt: now, acc: 0 } : { index: st.index + 1, running: false, startedAt: null, acc: 0 };
  return { state, finished: el > 0 ? [rec] : [] };
}

/** 끝난 단계 가운데 기록할 집중 시간만 골라 저장 형식으로 */
export function toSessions(finished, label = '') {
  return finished
    .filter((f) => f.type === 'focus' && f.ms >= MIN_LOG_MS)
    .map((f) => ({ s: Math.round(f.start), e: Math.round(f.end), done: !f.skipped, ...(label ? { l: label.slice(0, 60) } : {}) }));
}

/* ---------- 기록 모으기 ---------- */

const pad = (n) => String(n).padStart(2, '0');
/** 기기 시간대 기준 날짜 열쇠 YYYY-MM-DD */
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

/** 기록 하나가 [a, b) 구간과 겹치는 밀리초 */
const overlap = (s, a, b) => Math.max(0, Math.min(s.e, b) - Math.max(s.s, a));

/**
 * 최근 days 일(오늘 포함)의 날마다 집중한 분. 자정을 넘긴 집중은 두 날에 나눠 넣는다.
 * 반환: [{ key, date(ms), weekday(0=일), minutes }] 오래된 날 → 오늘
 */
export function dailyMinutes(sessions, now, days = 7) {
  const today = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const a = addDays(today, -i), b = addDays(today, -i + 1);
    let ms = 0;
    for (const s of sessions) ms += overlap(s, a, b);
    out.push({ key: dayKey(a), date: a, weekday: new Date(a).getDay(), minutes: Math.round(ms / 60000 * 10) / 10 });
  }
  return out;
}

/** 오늘 요약: 집중한 분, 끝까지 마친 집중 수, 할 일 이름별 분 */
export function todaySummary(sessions, now) {
  const a = startOfDay(now), b = addDays(a, 1);
  let ms = 0, done = 0;
  const byLabel = new Map();
  for (const s of sessions) {
    const o = overlap(s, a, b);
    if (!o) continue;
    ms += o;
    if (s.done && s.e >= a && s.e < b) done++;
    const k = s.l || '';
    byLabel.set(k, (byLabel.get(k) || 0) + o);
  }
  const labels = [...byLabel].map(([label, m]) => ({ label, minutes: Math.round(m / 60000 * 10) / 10 })).sort((x, y) => y.minutes - x.minutes);
  return { minutes: Math.round(ms / 60000 * 10) / 10, done, labels };
}

/** 오래된 기록 정리: keepDays 일보다 오래된 것은 버린다 */
export function prune(sessions, now, keepDays = 120) {
  const cut = addDays(startOfDay(now), -keepDays);
  return sessions.filter((s) => s.e >= cut);
}

/** 남은 시간 표시: 초 단위 올림 (25:00 에서 시작해 끝나는 순간 00:00). 1시간 이상이면 h:mm:ss */
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 분을 "1시간 5분"처럼 */
export function fmtMinutes(min) {
  if (min > 0 && min < 0.5) return '1분 미만';
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

export const PHASE_NAME = { focus: '집중', short: '짧은 휴식', long: '긴 휴식' };
