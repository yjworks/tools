/* 타이머·스톱워치 계산. setInterval 횟수를 세지 않고 "시작한 시각과 지금 시각의 차이"로 잰다.
   now 는 performance.now() 처럼 밀리초 단위로 늘어나는 시계. 테스트에서는 가짜 시계를 넣는다. */

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 잰 시간(누적): 시작·멈춤을 반복해도 멈춘 동안은 더하지 않는다. */
export class Stopwatch {
  constructor(now = defaultNow) { this.now = now; this.reset(); }
  get running() { return this.startedAt != null; }
  start() { if (!this.running) this.startedAt = this.now(); return this; }
  stop() { if (this.running) { this.acc += this.now() - this.startedAt; this.startedAt = null; } return this; }
  toggle() { return this.running ? this.stop() : this.start(); }
  reset() { this.acc = 0; this.startedAt = null; this.laps = []; return this; }
  elapsed() { return this.acc + (this.running ? this.now() - this.startedAt : 0); }
  /** 랩: 이번 구간(lap)과 누적(total) */
  lap() {
    const total = this.elapsed();
    const prev = this.laps.length ? this.laps[this.laps.length - 1].total : 0;
    const rec = { n: this.laps.length + 1, lap: total - prev, total };
    this.laps.push(rec);
    return rec;
  }
}

/** 카운트다운: 정한 시간에서 흐른 시간을 뺀다. 0 아래로는 내려가지 않는다. */
export class Countdown {
  constructor(durationMs, now = defaultNow) { this.sw = new Stopwatch(now); this.duration = durationMs; }
  get running() { return this.sw.running; }
  start() { if (!this.done) this.sw.start(); return this; }
  pause() { this.sw.stop(); return this; }
  toggle() { return this.running ? this.pause() : this.start(); }
  reset(durationMs = this.duration) { this.duration = durationMs; this.sw.reset(); return this; }
  remaining() { return Math.max(0, this.duration - this.sw.elapsed()); }
  /** 끝난 뒤 얼마나 지났는지(초과 시간) */
  overtime() { return Math.max(0, this.sw.elapsed() - this.duration); }
  get done() { return this.duration > 0 && this.sw.elapsed() >= this.duration; }
}

/** 카운트다운 표시: 초 단위 올림 (5:00 에서 시작해 정확히 끝날 때 0:00). 1시간 이상이면 h:mm:ss */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 스톱워치 표시: 1/100초 내림. mm:ss.cc, 1시간 이상이면 h:mm:ss.cc */
export function formatStopwatch(ms) {
  const cs = Math.max(0, Math.floor(ms / 10 + 1e-9));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(c)}`;
}

/** 분·초 입력을 밀리초로. 음수·숫자 아님은 0, 최대 99시간 59분 59초. */
export function toDuration(min, sec) {
  const m = Math.max(0, Math.floor(Number(min) || 0)), s = Math.max(0, Math.floor(Number(sec) || 0));
  return Math.min((m * 60 + s) * 1000, (99 * 3600 + 59 * 60 + 59) * 1000);
}

/** 랩 기록 복사용 글 */
export function lapsText(laps) {
  return laps.map((l) => `랩 ${l.n}\t${formatStopwatch(l.lap)}\t${formatStopwatch(l.total)}`).join('\n');
}
