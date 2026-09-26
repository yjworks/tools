import { describe, it, expect } from 'vitest';
import {
  KB, MB, parseTarget, fitLongSide, scaledSize, inputMime, resolveFormat, extFor, lossless, outName, savedPercent,
  searchQuality, nextScale, fitToTarget, preferOriginal, totals, jpegExifTiff, downscaleSteps, webpHasMeta,
} from '../src/_shared/image-compress.js';

/* 가짜 인코더: 용량 = 배율² × (100,000 + 900,000 × 품질²) 바이트. 품질·화소가 늘면 커진다. */
const fake = (s, q) => Math.round(s * s * (100_000 + 900_000 * q * q));

describe('목표 용량 해석', () => {
  it('1KB = 1,000바이트, 1MB = 1,000,000바이트로 잡는다(1,024 기준도 넘지 않게)', () => {
    expect(KB).toBe(1000);
    expect(parseTarget('500', 'KB')).toBe(500_000);
    expect(parseTarget('1.5', 'MB')).toBe(1_500_000);
    expect(parseTarget('1,000', 'KB')).toBe(1_000_000);
    expect(parseTarget(' 200 ')).toBe(200_000);
    expect(500 * MB / 1000).toBe(500_000);
  });
  it('0, 음수, 숫자가 아닌 값, 1KB 미만은 받지 않는다', () => {
    expect(parseTarget('0')).toBe(null);
    expect(parseTarget('-3')).toBe(null);
    expect(parseTarget('abc')).toBe(null);
    expect(parseTarget('0.5', 'KB')).toBe(null);
  });
});

describe('크기 계산', () => {
  it('긴 변 기준으로 비율을 지켜 줄인다', () => {
    expect(fitLongSide(4032, 3024, 1920)).toEqual({ width: 1920, height: 1440, scale: 1920 / 4032 });
    expect(fitLongSide(3024, 4032, 1280)).toEqual({ width: 960, height: 1280, scale: 1280 / 4032 });
    expect(fitLongSide(800, 600, 1920)).toEqual({ width: 800, height: 600, scale: 1 });   // 키우지 않는다
    expect(fitLongSide(4000, 3000, 0)).toEqual({ width: 4000, height: 3000, scale: 1 });
  });
  it('배율 적용(최소 1px)', () => {
    expect(scaledSize(1920, 1440, 0.5)).toEqual({ width: 960, height: 720 });
    expect(scaledSize(1000, 3, 0.1)).toEqual({ width: 100, height: 1 });
  });
  it('크게 줄일 때는 반씩 줄여 간다', () => {
    expect(downscaleSteps(4032, 3024, 800, 600)).toEqual([[2016, 1512], [1008, 756], [800, 600]]);
    expect(downscaleSteps(1920, 1440, 1280, 960)).toEqual([[1280, 960]]);
    expect(downscaleSteps(1000, 800, 1000, 800)).toEqual([[1000, 800]]);
  });
});

describe('형식', () => {
  it('입력 형식은 MIME 이 없으면 이름으로', () => {
    expect(inputMime('image/png', 'a.jpg')).toBe('image/png');
    expect(inputMime('', 'IMG.JPEG')).toBe('image/jpeg');
    expect(inputMime('', 'x.webp')).toBe('image/webp');
    expect(inputMime('image/gif', 'x.gif')).toBe(null);
  });
  it('원래 형식 유지·지정, WebP 를 못 쓰면 JPG 로', () => {
    expect(resolveFormat('keep', 'image/png', true)).toEqual({ mime: 'image/png', fallback: false });
    expect(resolveFormat('webp', 'image/jpeg', true)).toEqual({ mime: 'image/webp', fallback: false });
    expect(resolveFormat('webp', 'image/jpeg', false)).toEqual({ mime: 'image/jpeg', fallback: true });
    expect(resolveFormat('keep', 'image/webp', false)).toEqual({ mime: 'image/jpeg', fallback: true });
    expect(resolveFormat('jpg', 'image/png', false)).toEqual({ mime: 'image/jpeg', fallback: false });
  });
  it('확장자·무손실 여부', () => {
    expect([extFor('image/jpeg'), extFor('image/webp'), extFor('image/png')]).toEqual(['jpg', 'webp', 'png']);
    expect([lossless('image/png'), lossless('image/jpeg'), lossless('image/webp')]).toEqual([true, false, false]);
  });
  it('저장 이름: -small 을 붙이고 겹치면 번호', () => {
    const taken = new Set();
    expect(outName('IMG_1234.JPG', 'image/jpeg', taken)).toBe('IMG_1234-small.jpg');
    expect(outName('img_1234.jpeg', 'image/jpeg', taken)).toBe('img_1234-small-2.jpg');
    expect(outName('캡처 1.png', 'image/webp', taken)).toBe('캡처 1-small.webp');
    expect(outName('a|b?.png', 'image/png', taken)).toBe('a_b_-small.png');
  });
  it('줄어든 비율(소수 첫째 자리)', () => {
    expect(savedPercent(5_836_986, 480_000)).toBe(91.8);
    expect(savedPercent(100_000, 120_000)).toBe(-20);
    expect(savedPercent(0, 10)).toBe(0);
  });
});

describe('품질 이진 탐색', () => {
  it('500KB 이하 중 가장 높은 품질(0.66)을 8번 만에 찾는다', async () => {
    const seen = [];
    const r = await searchQuality(async (q) => { seen.push(q); return { size: fake(1, q) }; }, 500_000);
    expect(r.best).toEqual({ q: 0.66, size: 492_040 });
    expect(fake(1, 0.67)).toBeGreaterThan(500_000);          // 한 단계 위는 넘는다
    expect(seen).toEqual([0.92, 0.5, 0.71, 0.61, 0.66, 0.69, 0.68, 0.67]);
    expect(r.tries).toBe(8);
  });
  it('최고 품질로도 목표 이하면 한 번에 끝낸다', async () => {
    const r = await searchQuality(async (q) => ({ size: fake(1, q) }), 900_000);
    expect(r).toEqual({ best: { q: 0.92, size: 861_760 }, smallest: { q: 0.92, size: 861_760 }, tries: 1 });
  });
  it('최저 품질로도 크면 best 없이 가장 작은 결과를 준다', async () => {
    const r = await searchQuality(async (q) => ({ size: fake(1, q) }), 300_000);
    expect(r.best).toBe(null);
    expect(r.smallest).toEqual({ q: 0.5, size: 325_000 });
  });
  it('품질과 용량이 거꾸로 가는 구간이 있어도 목표 이하 중 최고 품질을 고른다', async () => {
    const sizes = { 0.92: 900, 0.5: 300, 0.71: 450, 0.81: 520, 0.76: 480, 0.78: 510, 0.77: 505 };
    const r = await searchQuality(async (q) => ({ size: sizes[q] ?? 999 }), 500);
    expect(r.best).toEqual({ q: 0.76, size: 480 });
  });
});

describe('목표 용량 맞추기(해상도 포함)', () => {
  it('다음 배율 = √(목표/현재)×0.93, 0.5~0.9 배 사이', () => {
    expect(nextScale(1, 325_000, 200_000)).toBeCloseTo(0.72955, 5);
    expect(nextScale(1, 10_000_000, 100_000)).toBe(0.5);
    expect(nextScale(0.8, 110_000, 100_000)).toBeCloseTo(0.70938, 5);   // 0.8 × 0.8867
  });
  it('품질 하한(0.5)에서도 크면 해상도를 약 73%로 줄이고 품질 0.55를 찾는다', async () => {
    const r = await fitToTarget(async (s, q) => ({ size: fake(s, q) }), 200_000);
    expect(r.fits).toBe(true);
    expect(r.scale).toBeCloseTo(0.72955, 5);
    expect(r.result).toEqual({ q: 0.55, size: 198_129 });
    expect(r.tries).toBe(9);
  });
  it('무손실(PNG)은 해상도만 줄인다', async () => {
    const r = await fitToTarget(async (s) => ({ size: Math.round(s * s * 1_000_000) }), 300_000, { isLossless: true });
    expect(r.fits).toBe(true);
    expect(r.scale).toBeCloseTo(0.50938, 5);
    expect(r.result.size).toBe(259_470);
    expect(r.tries).toBe(2);
  });
  it('해상도 줄이기를 끄면 품질을 0.05까지 낮추고, 그래도 크면 fits=false', async () => {
    const r = await fitToTarget(async (s, q) => ({ size: fake(s, q) }), 50_000, { allowResize: false });
    expect(r).toEqual({ result: { q: 0.05, size: 102_250 }, scale: 1, quality: 0.05, fits: false, tries: 2 });
  });
  it('끝까지 못 맞추면 가장 작았던 결과를 돌려준다', async () => {
    const r = await fitToTarget(async () => ({ size: 5000 }), 1000, { isLossless: true, maxRounds: 3 });
    expect(r.fits).toBe(false);
    expect(r.result.size).toBe(5000);
  });
});

describe('원본을 그대로 쓸지', () => {
  const base = { inMime: 'image/jpeg', outMime: 'image/jpeg', resized: false, origSize: 400_000, outSize: 450_000, stripMeta: true, orientation: 1 };
  it('다시 저장한 것이 더 크면 원본', () => expect(preferOriginal(base)).toBe(true));
  it('결과가 더 작으면 결과', () => expect(preferOriginal({ ...base, outSize: 390_000 })).toBe(false));
  it('형식이 바뀌거나 크기를 줄였으면 결과', () => {
    expect(preferOriginal({ ...base, outMime: 'image/webp' })).toBe(false);
    expect(preferOriginal({ ...base, resized: true })).toBe(false);
  });
  it('원본이 목표 용량을 넘으면 결과', () => expect(preferOriginal({ ...base, target: 300_000 })).toBe(false));
  it('정보를 지워야 하는데 방향 정보가 있거나 WebP 면 손실 없이 지울 수 없어 결과', () => {
    expect(preferOriginal({ ...base, orientation: 6 })).toBe(false);
    expect(preferOriginal({ ...base, inMime: 'image/webp', outMime: 'image/webp' })).toBe(false);
    expect(preferOriginal({ ...base, orientation: 6, stripMeta: false })).toBe(true);
  });
  it('지울 정보가 없는 WebP 는 원본을 그대로 써도 된다', () => {
    expect(preferOriginal({ ...base, inMime: 'image/webp', outMime: 'image/webp', hasMeta: false })).toBe(true);
  });
  it('WebP 안의 EXIF·XMP 청크를 찾는다', () => {
    const riff = (...chunks) => {
      const body = chunks.flatMap(([t, n]) => { const pad = n & 1; return [...t].map((c) => c.charCodeAt(0)).concat([n & 255, n >> 8, 0, 0], new Array(n + pad).fill(0)); });
      const size = 4 + body.length;
      return Uint8Array.from([82, 73, 70, 70, size & 255, (size >> 8) & 255, 0, 0, 87, 69, 66, 80, ...body]);
    };
    expect(webpHasMeta(riff(['VP8X', 10], ['VP8 ', 5], ['EXIF', 8]))).toBe(true);
    expect(webpHasMeta(riff(['VP8X', 10], ['XMP ', 3]))).toBe(true);
    expect(webpHasMeta(riff(['VP8 ', 7]))).toBe(false);
    expect(webpHasMeta(Uint8Array.of(0xff, 0xd8))).toBe(null);
  });
});

describe('합계·EXIF 꺼내기', () => {
  it('끝난 것만 더한다', () => {
    expect(totals([{ size: 5_836_986, outSize: 480_000 }, { size: 119_158, outSize: 60_000 }, { size: 999 }]))
      .toEqual({ done: 2, before: 5_956_144, after: 540_000, saved: 5_416_144, percent: 90.9 });
  });
  it('JPEG APP1 에서 TIFF 부분만 꺼낸다', () => {
    const tiff = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0);
    const len = 2 + 6 + tiff.length;
    const jpg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda, 0, 2, 0xff, 0xd9);
    expect([...jpegExifTiff(jpg)]).toEqual([...tiff]);
    expect(jpegExifTiff(Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2))).toBe(null);
    expect(jpegExifTiff(Uint8Array.of(0x89, 0x50))).toBe(null);
  });
});
