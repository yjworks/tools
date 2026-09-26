import { describe, it, expect } from 'vitest';
import {
  sanitizeConfig, phaseAt, initialState, start, pause, elapsedMs, remainingMs, settle, skip, toSessions,
  dailyMinutes, todaySummary, prune, fmtClock, fmtMinutes, dayKey, PRESETS,
} from '../src/_shared/focus-timer.js';

const MIN = 60000;
const cfg = PRESETS.p25; // 25/5, 4번째마다 긴 휴식 15

describe('설정', () => {
  it('범위 밖·잘못된 값은 고친다', () => {
    expect(sanitizeConfig({ focus: 0.1, short: -3, long: 'x', every: 2.6 })).toEqual({ focus: 0.1, short: 5, long: 15, every: 3 });
    expect(sanitizeConfig({ focus: 999, short: 5, long: 15, every: 50 })).toEqual({ focus: 240, short: 5, long: 15, every: 12 });
  });
});

describe('단계 순서', () => {
  it('25/5, 네 번째 집중 뒤 긴 휴식', () => {
    const seq = Array.from({ length: 10 }, (_, i) => phaseAt(i, cfg).type);
    expect(seq).toEqual(['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus', 'short']);
    expect(phaseAt(7, cfg)).toEqual({ type: 'long', ms: 15 * MIN, round: 4, slot: 4 });
    expect(phaseAt(8, cfg)).toEqual({ type: 'focus', ms: 25 * MIN, round: 5, slot: 1 });
  });
  it('50/10, 세 번째마다 긴 휴식', () => {
    expect(phaseAt(5, PRESETS.p50)).toMatchObject({ type: 'long', ms: 20 * MIN });
    expect(phaseAt(1, PRESETS.p50)).toMatchObject({ type: 'short', ms: 10 * MIN });
  });
  it('긴 휴식 간격 1 이면 매번 긴 휴식', () => {
    expect(phaseAt(1, { focus: 30, short: 5, long: 10, every: 1 }).type).toBe('long');
  });
});

describe('시각 기준 계산', () => {
  it('시작·멈춤·이어 하기', () => {
    const t0 = 1_000_000;
    let s = start(initialState(), t0);
    expect(remainingMs(s, cfg, t0 + 10 * MIN)).toBe(15 * MIN);
    s = pause(s, t0 + 10 * MIN);
    // 멈춘 동안 1시간이 지나도 그대로
    expect(remainingMs(s, cfg, t0 + 70 * MIN)).toBe(15 * MIN);
    s = start(s, t0 + 70 * MIN);
    expect(elapsedMs(s, t0 + 75 * MIN)).toBe(15 * MIN);
    expect(remainingMs(s, cfg, t0 + 100 * MIN)).toBe(0);
  });

  it('끝나면 휴식으로 넘어가고, 휴식 시작 시각은 집중이 끝난 시각', () => {
    const t0 = 0;
    const s = start(initialState(), t0);
    const r = settle(s, cfg, t0 + 27 * MIN, { autoBreak: true, autoFocus: false });
    expect(r.finished).toHaveLength(1);
    expect(r.finished[0]).toMatchObject({ type: 'focus', start: 0, end: 25 * MIN, ms: 25 * MIN, skipped: false });
    expect(r.state).toEqual({ index: 1, running: true, startedAt: 25 * MIN, acc: 0 });
    expect(remainingMs(r.state, cfg, t0 + 27 * MIN)).toBe(3 * MIN);
  });

  it('탭이 오래 숨어 있었으면 끝난 단계를 모두 처리하고, 자동 시작이 꺼진 곳에서 멈춘다', () => {
    const s = start(initialState(), 0);
    // 집중 25 + 휴식 5 = 30분 뒤 휴식이 끝남, 다음 집중은 자동 시작 꺼짐
    const r = settle(s, cfg, 90 * MIN, { autoBreak: true, autoFocus: false });
    expect(r.finished.map((f) => f.type)).toEqual(['focus', 'short']);
    expect(r.finished[1]).toMatchObject({ start: 25 * MIN, end: 30 * MIN });
    expect(r.state).toEqual({ index: 2, running: false, startedAt: null, acc: 0 });
  });

  it('모두 자동이면 계속 돈다', () => {
    const s = start(initialState(), 0);
    const r = settle(s, cfg, 61 * MIN, { autoBreak: true, autoFocus: true });
    // 0~25 집중, 25~30 휴식, 30~55 집중, 55~60 휴식, 60~ 집중
    expect(r.finished.map((f) => f.type)).toEqual(['focus', 'short', 'focus', 'short']);
    expect(r.state.index).toBe(4);
    expect(r.state.startedAt).toBe(60 * MIN);
    expect(remainingMs(r.state, cfg, 61 * MIN)).toBe(24 * MIN);
  });

  it('자동 휴식이 꺼져 있으면 집중이 끝나고 멈춘다', () => {
    const s = start(initialState(), 0);
    const r = settle(s, cfg, 26 * MIN, { autoBreak: false });
    expect(r.state).toEqual({ index: 1, running: false, startedAt: null, acc: 0 });
  });

  it('아직 안 끝났으면 그대로', () => {
    const s = start(initialState(), 0);
    expect(settle(s, cfg, 10 * MIN).finished).toEqual([]);
  });

  it('건너뛰기는 흐른 만큼만 기록', () => {
    const s = start(initialState(), 0);
    const r = skip(s, cfg, 12 * MIN);
    expect(r.finished[0]).toMatchObject({ type: 'focus', ms: 12 * MIN, skipped: true });
    expect(r.state).toEqual({ index: 1, running: true, startedAt: 12 * MIN, acc: 0 });
    expect(toSessions(r.finished, '보고서')).toEqual([{ s: 0, e: 12 * MIN, done: false, l: '보고서' }]);
  });

  it('휴식이나 아주 짧은 집중은 기록하지 않는다', () => {
    expect(toSessions([{ type: 'short', start: 0, end: 5 * MIN, ms: 5 * MIN, skipped: false }])).toEqual([]);
    expect(toSessions([{ type: 'focus', start: 0, end: 2000, ms: 2000, skipped: true }])).toEqual([]);
  });
});

describe('기록 모으기', () => {
  // 기기 시간대 기준 날짜로 만든다(어느 시간대에서 돌려도 같은 결과)
  const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime(); // 2026-09-d
  const sessions = [
    { s: at(20, 9), e: at(20, 9, 25), done: true, l: '영어' },
    { s: at(25, 23, 50), e: at(26, 0, 15), done: true }, // 자정을 넘김: 25일 10분, 26일 15분
    { s: at(26, 10), e: at(26, 10, 50), done: true, l: '보고서' },
    { s: at(26, 14), e: at(26, 14, 12), done: false, l: '보고서' },
    { s: at(10, 9), e: at(10, 9, 25), done: true }, // 7일 밖
  ];
  const now = at(26, 18);

  it('최근 7일', () => {
    const d = dailyMinutes(sessions, now, 7);
    expect(d.map((x) => x.key)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(d.map((x) => x.minutes)).toEqual([25, 0, 0, 0, 0, 10, 77]);
    expect(d[6].weekday).toBe(6); // 2026-09-26 은 토요일
  });

  it('오늘 요약', () => {
    expect(todaySummary(sessions, now)).toEqual({
      minutes: 77, done: 2,
      labels: [{ label: '보고서', minutes: 62 }, { label: '', minutes: 15 }],
    });
  });

  it('오래된 기록 정리', () => {
    expect(prune(sessions, now, 10)).toHaveLength(4);
  });

  it('날짜 열쇠', () => {
    expect(dayKey(at(3, 0, 0))).toBe('2026-09-03');
  });
});

describe('표시', () => {
  it('남은 시간은 초 단위 올림', () => {
    expect(fmtClock(25 * MIN)).toBe('25:00');
    expect(fmtClock(25 * MIN - 1)).toBe('25:00');
    expect(fmtClock(59_001)).toBe('01:00');
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(90 * MIN)).toBe('1:30:00');
  });
  it('분 표시', () => {
    expect(fmtMinutes(45)).toBe('45분');
    expect(fmtMinutes(125)).toBe('2시간 5분');
    expect(fmtMinutes(120)).toBe('2시간');
    expect(fmtMinutes(0.1)).toBe('1분 미만');
    expect(fmtMinutes(0)).toBe('0분');
  });
});
