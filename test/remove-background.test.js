import { describe, it, expect } from 'vitest';
import {
  MODELS, fitSize, grayOf, boxBlur, guidedFilter, levels, edgeParams, feather, unionMax, foregroundFromBackground,
  paintDab, paintLine, applyEdit, resampleRegion, maskBounds, coverage, cropForRatio, outputSize, foregroundColor,
  composite, hexToRgb, isHeic, pendingBytes, RATIOS,
} from '../src/_shared/remove-background.js';

const close = (a, b, d = 1e-5) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('크기', () => {
  it('긴 변 기준으로 줄이고, 작은 사진은 키우지 않는다', () => {
    expect(fitSize(6000, 4000, 4096)).toEqual({ w: 4096, h: 2731, scale: 4096 / 6000 });
    expect(fitSize(3024, 4032, 1536)).toEqual({ w: 1152, h: 1536, scale: 1536 / 4032 });
    expect(fitSize(800, 600, 1536)).toEqual({ w: 800, h: 600, scale: 1 });
  });
  it('자른 영역의 저장 크기도 4096 상한', () => {
    expect(outputSize({ x: 0, y: 0, w: 4500, h: 6000 })).toMatchObject({ w: 3072, h: 4096 });
  });
});

describe('밝기·흐림', () => {
  it('Rec.601 밝기', () => {
    const g = grayOf(new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255]));
    close(g[0], 1); close(g[1], 0.299); close(g[2], 0.587); close(g[3], 0);
  });
  it('상자 흐림: 가장자리는 들어간 화소 수로 나눈다', () => {
    const b = boxBlur(new Float32Array([0, 0, 3, 0, 0]), 5, 1, 1);
    expect([...b]).toEqual([0, 1, 1, 1, 0]);
    const e = boxBlur(new Float32Array([4, 0, 0]), 3, 1, 1);
    expect([...e]).toEqual([2, 4 / 3, 0].map(Math.fround));
    // 세로 방향도 같이: 3×3 가운데 9 → 모든 화소 평균이 이웃 수에 맞게
    const c = boxBlur(new Float32Array([0, 0, 0, 0, 9, 0, 0, 0, 0]), 3, 3, 1);
    close(c[4], 1); close(c[0], 9 / 4); close(c[1], 9 / 6);
  });
  it('반경 0 은 그대로 복사', () => {
    const s = new Float32Array([0.2, 0.7]);
    const b = boxBlur(s, 2, 1, 0);
    expect([...b]).toEqual([...s]);
    expect(b).not.toBe(s);
  });
});

describe('가이드 필터', () => {
  it('흐릿한 마스크 경계를 원본의 밝기 경계로 당긴다', () => {
    // 가로 20: 원본은 x<10 어둡고(0.1) x≥10 밝다(0.9). 모델 마스크는 x=6~13 에 걸쳐 흐릿하게 올라간다.
    const w = 20, h = 4, I = new Float32Array(w * h), p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      I[y * w + x] = x < 10 ? 0.1 : 0.9;
      p[y * w + x] = Math.min(1, Math.max(0, (x - 6) / 8));
    }
    const q = guidedFilter(I, p, w, h, 3, 1e-4);
    const row = (a, x) => a[1 * w + x];
    // 경계 바로 안쪽(x=8)은 원래 0.25 → 더 작아지고, 바로 바깥(x=11)은 0.625 → 더 커진다
    expect(row(q, 8)).toBeLessThan(row(p, 8));
    expect(row(q, 11)).toBeGreaterThan(row(p, 11));
    // 계단 폭: 원래 마스크는 0.25~0.75 가 x=8..12 (5칸), 다듬은 뒤엔 경계 두 칸 사이에서 크게 뛴다
    expect(row(q, 10) - row(q, 9)).toBeGreaterThan(0.3);
    for (const v of q) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('평평한 원본이면 마스크를 평균만 낸다(없는 경계를 만들지 않음)', () => {
    const w = 9, h = 1, I = new Float32Array(9).fill(0.5), p = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 1]);
    const q = guidedFilter(I, p, w, h, 1, 1e-3);
    const b = boxBlur(boxBlur(p, w, h, 1), w, h, 1);
    for (let i = 0; i < 9; i++) close(q[i], b[i], 1e-4);
  });
});

describe('조이기·부드럽게', () => {
  it('levels: lo 이하 0, hi 이상 1, 가운데 0.5', () => {
    const l = levels(new Float32Array([0.125, 0.25, 0.5, 0.75, 0.875]), 0.25, 0.75);
    expect([...l]).toEqual([0, 0, 0.5, 1, 1]);
    close(levels(new Float32Array([0.375]), 0.25, 0.75)[0], 0.15625); // t=0.25 → 3t²-2t³
  });
  it('edgeParams: 0 은 날카롭고 흐림 없음, 값이 크면 범위와 반경이 넓어진다', () => {
    expect(edgeParams(0, 1536)).toEqual({ lo: 0.42, hi: 0.58, feather: 0 });
    const p3 = edgeParams(3, 1536);
    close(p3.lo, 0.33); close(p3.hi, 0.67); expect(p3.feather).toBe(3);
    const p10 = edgeParams(10, 1536);
    close(p10.lo, 0.12); expect(p10.feather).toBe(10);
    expect(edgeParams(1, 400).feather).toBe(1); // 작은 사진도 최소 1
    expect(edgeParams(99, 1536)).toEqual(p10);
  });
  it('feather 는 두 번 흐려 합계를 지킨다(가장자리 밖이 없는 경우)', () => {
    const m = new Float32Array(15); m[7] = 1;
    const f = feather(m, 15, 1, 2);
    close(f.reduce((s, v) => s + v, 0), 1, 1e-5);
    close(f[7], 5 / 25); close(f[5], 3 / 25);
    expect(feather(m, 15, 1, 0)).toBe(m);
  });
});

describe('모델 출력', () => {
  it('배경 확률 → 남길 확률', () => {
    const f = foregroundFromBackground(new Float32Array([1, 0.25, 0, 1.2]));
    expect([...f]).toEqual([0, 0.75, 1, 0]);
  });
  it('여러 번 누른 결과는 화소마다 큰 값으로 합친다', () => {
    expect([...unionMax(new Float32Array([0, 0.5, 1]), new Float32Array([0.25, 0.25, 0]))]).toEqual([0.25, 0.5, 1]);
  });
  it('남는 부분 비율과 경계 상자', () => {
    const w = 6, h = 5, m = new Float32Array(w * h);
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) m[y * w + x] = 0.9;
    m[0] = 0.49;
    expect(maskBounds(m, w, h)).toEqual({ x0: 2, y0: 1, x1: 5, y1: 4 });
    expect(maskBounds(new Float32Array(4), 2, 2)).toBeNull();
    close(coverage(m), 9 / 30);
  });
  it('모델 주소는 storage.googleapis.com 의 MediaPipe 모델', () => {
    for (const m of Object.values(MODELS)) expect(new URL(m.url).host).toBe('storage.googleapis.com');
    expect(MODELS.portrait.bytes).toBe(16371837);
    expect(MODELS.object.bytes).toBe(6227884);
  });
});

describe('붓', () => {
  it('지우기 붓은 가운데를 -1 로, 반경 밖은 건드리지 않는다', () => {
    const w = 11, h = 11, e = new Float32Array(w * h);
    const n = paintDab(e, w, h, 5.5, 5.5, 3, -1, 0.5);
    expect(e[5 * w + 5]).toBe(-1);
    expect(e[5 * w + 0]).toBe(0);
    expect(n).toBeGreaterThan(20);
    // 바깥 고리는 반만: 중심에서 2.0 떨어진 (7,5)… 안쪽 1.5 ~ 3 사이 → 1-(2-1.5)/1.5 = 2/3
    close(e[5 * w + 7], -2 / 3, 1e-6);
  });
  it('복원 붓을 지운 곳 위에 칠하면 +1 쪽으로 돌아간다', () => {
    const e = new Float32Array(1); e[0] = -1;
    paintDab(e, 1, 1, 0.5, 0.5, 1, 1, 1);
    expect(e[0]).toBe(1);
  });
  it('선 붓질은 끊기지 않는다', () => {
    const w = 40, h = 5, e = new Float32Array(w * h);
    paintLine(e, w, h, 2, 2.5, 37, 2.5, 2, 1, 1);
    for (let x = 3; x <= 36; x++) expect(e[2 * w + x]).toBe(1);
  });
  it('붓질 층을 마스크에 반영', () => {
    const m = new Float32Array([0.2, 0.2, 0.8, 0.8]);
    const out = applyEdit(m, new Float32Array([1, 0.5, -1, 0]));
    close(out[0], 1); close(out[1], 0.6); close(out[2], 0); close(out[3], 0.8);
  });
});

describe('늘리기', () => {
  it('2×2 마스크를 4×4 로 양선형 보간', () => {
    const r = resampleRegion(new Float32Array([0, 1, 0, 1]), 2, 2, 0, 0, 2, 2, 4, 4);
    expect([...r.slice(0, 4)]).toEqual([0, 0.25, 0.75, 1]);
  });
  it('영역만 떼어 0~255 로', () => {
    const src = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]); // 4×2
    const r = resampleRegion(src, 4, 2, 2, 0, 2, 2, 2, 2, Uint8ClampedArray);
    expect([...r]).toEqual([255, 255, 255, 255]);
    const whole = resampleRegion(src, 4, 2, 0, 0, 4, 2, 2, 1, Uint8ClampedArray);
    expect([...whole]).toEqual([0, 255]); // 가운데 표본 x=0.5, 2.5
  });
});

describe('비율 자르기', () => {
  it('가로 사진에서 3:4 는 세로를 꽉 채우고 인물 가운데로', () => {
    const c = cropForRatio(4000, 3000, RATIOS['3:4'], { x0: 1600, y0: 500, x1: 2600, y1: 3000 });
    expect(c).toEqual({ x: 975, y: 0, w: 2250, h: 3000 }); // 가운데 2100 - 1125
    // 인물이 오른쪽 끝이면 사진 밖으로 나가지 않게 4000-2250 에서 멈춘다
    expect(cropForRatio(4000, 3000, 3 / 4, { x0: 2600, y0: 500, x1: 3400, y1: 3000 }).x).toBe(1750);
  });
  it('확대하면 머리 위 여백 8% 를 두고 내려온다', () => {
    const c = cropForRatio(3000, 4000, RATIOS['3:4'], { x0: 1000, y0: 1000, x1: 2000, y1: 4000 }, 2);
    expect(c).toEqual({ x: 750, y: 840, w: 1500, h: 2000 }); // 1000 - 0.08×2000
  });
  it('35:45 비율, 인물이 없으면 가운데', () => {
    const c = cropForRatio(1000, 1000, RATIOS['35:45']);
    expect(c).toEqual({ x: 111, y: 0, w: 778, h: 1000 });
    expect(Math.abs(c.w / c.h - 35 / 45)).toBeLessThan(0.002);
  });
  it('사진 밖으로 나가지 않게 밀어 넣는다', () => {
    const c = cropForRatio(1000, 800, 1, { x0: 950, y0: 0, x1: 1000, y1: 100 }, 2);
    expect(c).toEqual({ x: 600, y: 0, w: 400, h: 400 });
    expect(cropForRatio(640, 480, null)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });
});

describe('합성', () => {
  const px = () => new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255, 90, 90, 90, 255]);
  it('투명 PNG: 알파만 바꾼다', () => {
    const out = composite(px(), new Uint8ClampedArray([255, 0, 128]));
    expect([...out]).toEqual([200, 100, 50, 255, 10, 20, 30, 0, 90, 90, 90, 128]);
  });
  it('흰 배경 위에: 알파 0 은 흰색, 반은 섞인다', () => {
    const out = composite(px(), new Float32Array([1, 0, 0.5]), hexToRgb('#ffffff'));
    expect([...out]).toEqual([200, 100, 50, 255, 255, 255, 255, 255, 172, 172, 172, 255]); // 90×.5+255×.5=172.5 → 172(짝수 반올림)
  });
  it('가장자리 색 번짐: 반투명 화소는 앞쪽 색으로 섞는다', () => {
    const fg = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 250, 0, 0, 255]);
    const out = composite(px(), new Float32Array([1, 0, 0.5]), null, fg);
    expect([...out.slice(0, 4)]).toEqual([200, 100, 50, 255]); // α=1 은 그대로
    expect([...out.slice(8)]).toEqual([170, 45, 45, 128]);      // 90×.5 + 250×.5, 90×.5
  });
  it('앞쪽 색 추정: 배경(α=0) 쪽 색은 섞이지 않는다', () => {
    // 1×3: 빨강(α1) | 반투명 회색(α.5) | 초록 배경(α0)
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255, 0, 255, 0, 255]);
    const f = foregroundColor(rgba, new Float32Array([1, 0.5, 0]), 3, 1, 1);
    // 가운데: (255×1 + 128×.25 + 0) / 1.25 = 229.6, 초록 (0 + 128×.25 + 255×0)/1.25 = 25.6
    expect(f[4]).toBe(230); expect(f[5]).toBe(26); expect(f[6]).toBe(26);
    expect(f[7]).toBe(255);
  });
  it('색 코드', () => {
    expect(hexToRgb('#cfe3f6')).toEqual([207, 227, 246]);
    expect(hexToRgb('oops')).toEqual([255, 255, 255]);
  });
});

describe('기타', () => {
  it('HEIC 판별', () => {
    expect(isHeic('image/heic', 'a.heic')).toBe(true);
    expect(isHeic('', 'IMG_0001.HEIF')).toBe(true);
    expect(isHeic('image/jpeg', 'a.jpg')).toBe(false);
  });
  it('아직 받지 않은 크기만 더한다', () => {
    expect(pendingBytes([{ bytes: 11756954, cached: false }, { bytes: 16371837, cached: true }])).toBe(11756954);
    expect(pendingBytes([{ bytes: 11756954 }, { bytes: 6227884 }])).toBe(17984838);
  });
});
