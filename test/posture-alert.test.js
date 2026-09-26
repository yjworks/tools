import { describe, it, expect } from 'vitest';
import {
  LM, SENSITIVITY, frameMetrics, calibrate, deviation, smoothMetrics, median, createMonitor, createBreakTimer,
  dayKey, emptyDay, parseStore, addTime, addEvent, prune, summarize, fmtDuration, fmtMB, backgroundSupport, MODEL,
} from '../src/_shared/posture-alert.js';

/** 33점짜리 좌표. 안 쓰는 점은 (0.5, 0.9), 쓰는 점만 지정한다. 640×480 영상(aspect 4/3) 기준. */
function pose(points, vis = 0.99) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, z: 0, visibility: vis }));
  for (const [i, [x, y, v]] of Object.entries(points)) a[i] = { x, y, z: 0, visibility: v ?? vis };
  return a;
}
// 바른 자세: 눈 y .38, 귀 폭 .16, 어깨 폭 .40, 어깨 y .80
const GOOD = pose({
  [LM.NOSE]: [0.5, 0.42], [LM.L_EYE]: [0.54, 0.38], [LM.R_EYE]: [0.46, 0.38], [LM.L_EAR]: [0.58, 0.4], [LM.R_EAR]: [0.42, 0.4],
  [LM.L_SH]: [0.7, 0.8], [LM.R_SH]: [0.3, 0.8],
});
// 고개를 앞·아래로: 눈 .47 로 내려오고 귀 폭 .19 로 커짐
const SLOUCH = pose({
  [LM.NOSE]: [0.5, 0.51], [LM.L_EYE]: [0.54, 0.47], [LM.R_EYE]: [0.46, 0.47], [LM.L_EAR]: [0.595, 0.49], [LM.R_EAR]: [0.405, 0.49],
  [LM.L_SH]: [0.7, 0.8], [LM.R_SH]: [0.3, 0.8],
});
// 고개를 옆으로 기울임: 눈 두 점 높이 차 .04
const TILT = pose({
  [LM.NOSE]: [0.5, 0.42], [LM.L_EYE]: [0.54, 0.36], [LM.R_EYE]: [0.46, 0.4], [LM.L_EAR]: [0.58, 0.37], [LM.R_EAR]: [0.42, 0.43],
  [LM.L_SH]: [0.7, 0.8], [LM.R_SH]: [0.3, 0.8],
});
// 조금만 움직임(허용 폭 안): 눈 .40
const NEAR_GOOD = pose({
  [LM.NOSE]: [0.5, 0.44], [LM.L_EYE]: [0.54, 0.4], [LM.R_EYE]: [0.46, 0.4], [LM.L_EAR]: [0.58, 0.42], [LM.R_EAR]: [0.42, 0.42],
  [LM.L_SH]: [0.7, 0.8], [LM.R_SH]: [0.3, 0.8],
});

describe('자세 수치', () => {
  it('바른 자세 좌표 → 수치', () => {
    const m = frameMetrics(GOOD, 4 / 3);
    expect(m.ok).toBe(true); expect(m.partial).toBe(false);
    expect(m.sw).toBeCloseTo(0.5333, 4); // 0.4 × 4/3
    expect(m.neck).toBeCloseTo(0.7875, 4); // (0.80 − 0.38) / 0.5333
    expect(m.size).toBeCloseTo(0.2133, 4); // 0.16 × 4/3
    expect(m.face).toBeCloseTo(0.4, 6);
    expect(m.roll).toBeCloseTo(0, 6); expect(m.lean).toBeCloseTo(0, 6);
  });
  it('거울 영상(좌우 반전)이어도 같은 값', () => {
    const mirrored = GOOD.map((p) => ({ ...p, x: 1 - p.x }));
    const a = frameMetrics(GOOD), b = frameMetrics(mirrored);
    for (const k of ['neck', 'face', 'size', 'roll']) expect(b[k]).toBeCloseTo(a[k], 6);
  });
  it('기울기(도)', () => {
    // atan2(−0.04, 0.08×4/3) = −20.56°
    expect(frameMetrics(TILT).roll).toBeCloseTo(-20.556, 2);
  });
  it('얼굴·어깨가 안 보일 때', () => {
    expect(frameMetrics(null)).toEqual({ ok: false, reason: 'none' });
    expect(frameMetrics(pose({ [LM.NOSE]: [0.5, 0.4, 0.2] })).reason).toBe('face');
    const noSh = GOOD.map((p, i) => (i === LM.L_SH || i === LM.R_SH ? { ...p, visibility: 0.1 } : p));
    const m = frameMetrics(noSh);
    expect(m.ok).toBe(true); expect(m.partial).toBe(true); expect(m.reason).toBe('shoulders');
    expect(m.neck).toBeUndefined(); expect(m.size).toBeCloseTo(0.2133, 4);
  });
});

describe('기준 잡기', () => {
  it('중앙값으로 기준', () => {
    const s = [GOOD, GOOD, NEAR_GOOD, GOOD, GOOD, GOOD].map((l) => frameMetrics(l));
    const r = calibrate(s);
    expect(r.ok).toBe(true); expect(r.frames).toBe(6);
    expect(r.baseline.neck).toBeCloseTo(0.7875, 4);
    expect(median([3, 1, 2])).toBe(2); expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('장면이 모자라거나 어깨가 안 보이거나 많이 움직이면 실패', () => {
    expect(calibrate([frameMetrics(GOOD), null, frameMetrics(GOOD)]).reason).toBe('few');
    const noSh = GOOD.map((p, i) => (i === LM.L_SH || i === LM.R_SH ? { ...p, visibility: 0.1 } : p));
    expect(calibrate(Array(6).fill(frameMetrics(noSh))).reason).toBe('shoulders');
    // 절반이 목 높이 21% 차이 → 움직임
    const moving = [GOOD, SLOUCH, GOOD, SLOUCH, GOOD, SLOUCH].map((l) => frameMetrics(l));
    expect(calibrate(moving).reason).toBe('moving');
    // 10장면 중 1장면만 튀면 무시
    const oneOff = [...Array(9).fill(GOOD), SLOUCH].map((l) => frameMetrics(l));
    expect(calibrate(oneOff).ok).toBe(true);
  });
});

describe('벗어난 정도', () => {
  const base = calibrate(Array(6).fill(frameMetrics(GOOD))).baseline;
  it('바른 자세는 0', () => {
    const d = deviation(frameMetrics(GOOD), base);
    expect(d.score).toBeCloseTo(0, 6);
  });
  it('고개를 앞·아래로 → 보통 민감도에서 1 넘음', () => {
    const d = deviation(frameMetrics(SLOUCH), base, SENSITIVITY.mid);
    // 목 높이 0.7875 → 0.61875 (21.4% 줄어듦) ÷ 0.17 = 1.261
    expect(d.parts.drop).toBeCloseTo(1.2605, 3);
    // 얼굴/어깨 0.4 → 0.475 (+18.75%) ÷ 0.15 = 1.25
    expect(d.parts.fwd).toBeCloseTo(1.25, 3);
    // 화면 속 얼굴 +18.75% ÷ 0.22 = 0.852
    expect(d.parts.close).toBeCloseTo(0.8523, 3);
    expect(d.reason).toBe('drop'); expect(d.score).toBeCloseTo(1.2605, 3);
    // 낮은 민감도에서는 허용 폭 안
    expect(deviation(frameMetrics(SLOUCH), base, SENSITIVITY.low).score).toBeLessThan(1);
  });
  it('조금 움직인 건 허용 폭 안', () => {
    // 목 높이 0.42 → 0.40 (−4.8%) ÷ 0.17 = 0.28
    expect(deviation(frameMetrics(NEAR_GOOD), base).score).toBeCloseTo(0.28, 2);
  });
  it('기울임', () => {
    const d = deviation(frameMetrics(TILT), base);
    expect(d.reason).toBe('tilt'); expect(d.score).toBeCloseTo(20.556 / 12, 2);
  });
  it('어깨가 안 보이면 가까워짐만 판단', () => {
    const noSh = (l) => l.map((p, i) => (i === LM.L_SH || i === LM.R_SH ? { ...p, visibility: 0.1 } : p));
    expect(deviation(frameMetrics(noSh(GOOD)), base)).toBeNull();
    // 얼굴 폭 0.16 → 0.22 (+37.5%) ÷ 0.22 = 1.70
    const close = pose({
      [LM.NOSE]: [0.5, 0.45], [LM.L_EYE]: [0.555, 0.4], [LM.R_EYE]: [0.445, 0.4], [LM.L_EAR]: [0.61, 0.43], [LM.R_EAR]: [0.39, 0.43],
      [LM.L_SH]: [0.8, 1.02, 0.2], [LM.R_SH]: [0.2, 1.02, 0.2],
    });
    const d = deviation(frameMetrics(close), base);
    expect(d.reason).toBe('close'); expect(d.score).toBeCloseTo(1.7045, 3);
    expect(deviation(null, base)).toBeNull();
  });
  it('흔들림 줄이기', () => {
    const a = frameMetrics(GOOD), b = frameMetrics(SLOUCH);
    const s = smoothMetrics(a, b, 0.5);
    expect(s.neck).toBeCloseTo((0.7875 + 0.61875) / 2, 4);
    expect(smoothMetrics(null, b)).toBe(b);
  });
});

describe('알림 상태 기계', () => {
  const bad = { score: 1.3, reason: 'fwd' }, good = { score: 0.2, reason: 'drop' }, middle = { score: 0.85, reason: 'fwd' };
  it('15초 계속 벗어나면 알림 한 번, 1분 안에는 다시 안 알림', () => {
    const mon = createMonitor({ holdMs: 15000, cooldownMs: 60000 });
    const alerts = [];
    for (let t = 0; t <= 80000; t += 500) {
      const r = mon.update(t, t < 2000 ? good : bad);
      for (const e of r.events) if (e.type === 'alert') alerts.push([t, e.reason]);
    }
    // 2.0초부터 나쁨 → 17.0초에 첫 알림, 쿨다운 60초 → 77.0초에 두 번째
    expect(alerts).toEqual([[17000, 'fwd'], [77000, 'fwd']]);
  });
  it('히스테리시스: 0.7~1 사이는 이전 상태 유지', () => {
    const mon = createMonitor();
    expect(mon.update(0, good).posture).toBe('good');
    expect(mon.update(500, middle).posture).toBe('good');
    expect(mon.update(1000, bad).posture).toBe('bad');
    expect(mon.update(1500, middle).posture).toBe('bad');
    expect(mon.update(2000, { score: 0.6 }).posture).toBe('good');
  });
  it('중간에 바로 앉으면 시간이 다시 시작', () => {
    const mon = createMonitor({ holdMs: 10000 });
    let n = 0;
    for (let t = 0; t <= 30000; t += 500) {
      const s = t % 9000 < 8500 ? bad : good; // 8.5초 나쁨, 0.5초 바름 반복
      n += mon.update(t, s).events.filter((e) => e.type === 'alert').length;
    }
    expect(n).toBe(0);
  });
  it('알림 뒤 바로 앉으면 recovered', () => {
    const mon = createMonitor({ holdMs: 3000 });
    const ev = [];
    for (let t = 0; t <= 4000; t += 500) ev.push(...mon.update(t, bad).events.map((e) => e.type));
    ev.push(...mon.update(4500, good).events.map((e) => e.type));
    expect(ev).toEqual(['alert', 'recovered']);
  });
  it('사람이 4초 넘게 안 보이면 자리 비움, 짧게 가려진 건 무시', () => {
    const mon = createMonitor({ holdMs: 5000 });
    mon.update(0, bad);
    expect(mon.update(2000, null).posture).toBe('bad'); // 2초 가려짐
    const r = mon.update(4500, null);
    expect(r.posture).toBe('away'); expect(r.events).toEqual([{ type: 'away' }]);
    expect(r.counted.kind).toBe('away');
    const back = mon.update(5000, good);
    expect(back.posture).toBe('good'); expect(back.events).toEqual([{ type: 'back' }]);
  });
  it('장면 사이가 3초보다 길면(탭 멈춤) 이어 본 것으로 치지 않음', () => {
    const mon = createMonitor({ holdMs: 15000 });
    mon.update(0, bad);
    const r = mon.update(20000, bad); // 20초 만에 다음 장면
    expect(r.events).toEqual([]); expect(r.badFor).toBe(0);
    expect(r.counted.ms).toBe(3000);
  });
});

describe('휴식 알림', () => {
  it('자리에 있던 20분마다, 3분 넘게 비우면 처음부터', () => {
    const bt = createBreakTimer({ intervalMs: 20 * 60000, awayResetMs: 3 * 60000 });
    let due = [];
    for (let t = 0; t <= 45 * 60000; t += 1000) {
      const away = t >= 25 * 60000 && t < 29 * 60000; // 25~29분 자리 비움
      if (bt.update(t, !away).due) due.push(t / 60000);
    }
    // 20분에 한 번. 21~25분 4분 쌓인 건 자리 비움으로 초기화 → 29분부터 20분 뒤 = 49분(범위 밖)
    expect(due).toEqual([20]);
    const off = createBreakTimer({ intervalMs: 0 });
    expect(off.update(0, true).due).toBe(false);
  });
});

describe('오늘 기록', () => {
  const t10 = new Date(2026, 8, 26, 10, 15).getTime();
  const t11 = new Date(2026, 8, 26, 11, 5).getTime();
  it('시간대별로 쌓고 요약', () => {
    const s = { days: {} };
    addTime(s, t10, 30 * 60000, 'good'); addTime(s, t10, 10 * 60000, 'bad');
    addTime(s, t11, 20 * 60000, 'good'); addTime(s, t11, 1000, 'away');
    addEvent(s, t10, 'alerts'); addEvent(s, t11, 'alerts'); addEvent(s, t11, 'breaks'); addEvent(s, t11, 'nope');
    expect(dayKey(t10)).toBe('2026-09-26');
    const sum = summarize(s.days['2026-09-26']);
    expect(sum.minutes).toBe(60); expect(sum.goodPct).toBe(83); // 50 / 60
    expect(sum.alerts).toBe(2); expect(sum.breaks).toBe(1);
    expect(sum.hours[10]).toEqual({ hour: 10, good: 1800000, bad: 600000, total: 2400000 });
    expect(sum.maxHourMs).toBe(2400000);
    expect(summarize(emptyDay()).goodPct).toBeNull();
  });
  it('저장값 읽기·정리', () => {
    expect(parseStore('나쁜 값')).toEqual({ days: {} });
    const s = parseStore(JSON.stringify({ days: { '2026-09-26': emptyDay(), bad: {}, '2026-09-25': { good: [1] } } }));
    expect(Object.keys(s.days)).toEqual(['2026-09-26']);
    const many = { days: {} };
    for (let i = 1; i <= 20; i++) many.days[`2026-09-${String(i).padStart(2, '0')}`] = emptyDay();
    many.days['2026-10-30'] = emptyDay(); // 기기 시계가 앞서 있던 날
    prune(many, t10, 14);
    expect(Object.keys(many.days).sort()[0]).toBe('2026-09-07');
    expect(Object.keys(many.days)).toHaveLength(14);
  });
  it('글자', () => {
    expect(fmtDuration(42000)).toBe('42초'); expect(fmtDuration(125000)).toBe('2분');
    expect(fmtDuration(3600000)).toBe('1시간'); expect(fmtDuration(3900000)).toBe('1시간 5분');
    expect(fmtMB(MODEL.bytes)).toBe('5.5MB');
  });
  it('다른 창에서 쓰는 방법 안내', () => {
    expect(backgroundSupport({ documentPip: true }).mode).toBe('document');
    expect(backgroundSupport({ videoPip: true }).mode).toBe('video');
    expect(backgroundSupport({ documentPip: true, mobile: true }).mode).toBe('none');
  });
});
