import { describe, it, expect } from 'vitest';
import { Stopwatch, Countdown, formatCountdown, formatStopwatch, toDuration, lapsText } from '../src/_shared/timer.js';

const fakeClock = () => { let t = 1000; const now = () => t; now.add = (ms) => { t += ms; }; return now; };

describe('타이머 표시', () => {
  it('카운트다운은 초 올림', () => {
    expect(formatCountdown(300000)).toBe('05:00');
    expect(formatCountdown(299001)).toBe('05:00');
    expect(formatCountdown(299000)).toBe('04:59');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-500)).toBe('00:00');
    expect(formatCountdown(3600000)).toBe('1:00:00');
    expect(formatCountdown(3725000)).toBe('1:02:05');
  });
  it('스톱워치는 1/100초 내림', () => {
    expect(formatStopwatch(0)).toBe('00:00.00');
    expect(formatStopwatch(12345)).toBe('00:12.34');
    expect(formatStopwatch(61009)).toBe('01:01.00');
    expect(formatStopwatch(3600000 + 2000)).toBe('1:00:02.00');
  });
  it('분·초 입력', () => {
    expect(toDuration(1, 30)).toBe(90000);
    expect(toDuration('', '45')).toBe(45000);
    expect(toDuration(-3, 'x')).toBe(0);
    expect(toDuration(99999, 0)).toBe((99 * 3600 + 59 * 60 + 59) * 1000);
  });
});

describe('스톱워치', () => {
  it('멈춘 동안은 더하지 않는다', () => {
    const now = fakeClock(); const sw = new Stopwatch(now);
    sw.start(); now.add(1500); expect(sw.elapsed()).toBe(1500);
    sw.stop(); now.add(10000); expect(sw.elapsed()).toBe(1500);
    sw.start(); now.add(500); expect(sw.elapsed()).toBe(2000);
    sw.start(); now.add(100); expect(sw.elapsed()).toBe(2100); // 두 번 시작해도 그대로
  });
  it('랩', () => {
    const now = fakeClock(); const sw = new Stopwatch(now).start();
    now.add(10000); expect(sw.lap()).toEqual({ n: 1, lap: 10000, total: 10000 });
    now.add(12500); expect(sw.lap()).toEqual({ n: 2, lap: 12500, total: 22500 });
    expect(lapsText(sw.laps)).toBe('랩 1\t00:10.00\t00:10.00\n랩 2\t00:12.50\t00:22.50');
    sw.reset(); expect(sw.laps).toEqual([]); expect(sw.elapsed()).toBe(0); expect(sw.running).toBe(false);
  });
  it('setInterval 없이도 오래 돌려 오차가 쌓이지 않는다', () => {
    const now = fakeClock(); const sw = new Stopwatch(now).start();
    for (let i = 0; i < 1000; i++) now.add(16.7);
    expect(sw.elapsed()).toBeCloseTo(16700, 6);
  });
});

describe('카운트다운', () => {
  it('남은 시간·끝남·초과', () => {
    const now = fakeClock(); const cd = new Countdown(60000, now);
    expect(cd.remaining()).toBe(60000); expect(cd.done).toBe(false);
    cd.start(); now.add(20000); expect(cd.remaining()).toBe(40000);
    cd.pause(); now.add(99999); expect(cd.remaining()).toBe(40000);
    cd.toggle(); now.add(40000); expect(cd.remaining()).toBe(0); expect(cd.done).toBe(true);
    now.add(3000); expect(cd.overtime()).toBe(3000); expect(cd.remaining()).toBe(0);
    cd.reset(); expect(cd.remaining()).toBe(60000); expect(cd.running).toBe(false);
    cd.reset(180000); expect(cd.remaining()).toBe(180000);
  });
  it('끝난 뒤에는 다시 시작하지 않는다', () => {
    const now = fakeClock(); const cd = new Countdown(1000, now).start();
    now.add(1000); cd.pause(); cd.start(); expect(cd.running).toBe(false);
  });
});
