import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { pngSize, buildIco, readIco, manifest, htmlSnippet, normPath, textScale } from '../src/_shared/favicon-generator.js';

/* 테스트용 진짜 PNG (단색, 8비트 RGBA). CRC 는 검사에 쓰지 않지만 규격대로 계산한다. */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (u8) => { let c = 0xffffffff; for (const b of u8) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makePng(w, h) {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set([...type].map((c) => c.charCodeAt(0)), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([47, 111, 237, 255], y * (1 + w * 4) + 1 + x * 4);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('ICO 만들기', () => {
  const p16 = makePng(16, 16), p32 = makePng(32, 32), p48 = makePng(48, 48);
  const ico = buildIco([p16, p32, p48]);
  it('PNG 크기 읽기', () => expect(pngSize(p32)).toEqual({ width: 32, height: 32 }));
  it('머리 6바이트: 예약 0, 종류 1, 그림 3장', () => expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]));
  it('첫 목록 16바이트', () => {
    const e = ico.subarray(6, 22), dv = new DataView(e.buffer, e.byteOffset, 16);
    expect([e[0], e[1], e[2], e[3]]).toEqual([16, 16, 0, 0]);
    expect(dv.getUint16(4, true)).toBe(1);           // 면
    expect(dv.getUint16(6, true)).toBe(32);          // 비트
    expect(dv.getUint32(8, true)).toBe(p16.length);  // 크기
    expect(dv.getUint32(12, true)).toBe(6 + 16 * 3); // 첫 그림 위치 = 54
  });
  it('그림 위치가 이어지고, 그 자리에 PNG 가 그대로 있다', () => {
    const list = readIco(ico);
    expect(list.map((x) => x.width)).toEqual([16, 32, 48]);
    expect(list[1].offset).toBe(54 + p16.length);
    expect(list[2].offset).toBe(54 + p16.length + p32.length);
    expect(ico.length).toBe(54 + p16.length + p32.length + p48.length);
    for (const [i, p] of [p16, p32, p48].entries()) expect([...ico.subarray(list[i].offset, list[i].offset + 8)]).toEqual([...p.subarray(0, 8)]);
  });
  it('256px 는 0 으로 적는다', () => {
    const big = buildIco([makePng(256, 256)]);
    expect([big[6], big[7]]).toEqual([0, 0]);
    expect(readIco(big)[0].width).toBe(256);
  });
  it('PNG 가 아니거나 너무 크면 오류', () => {
    expect(() => buildIco([new Uint8Array(30)])).toThrow();
    expect(() => buildIco([makePng(300, 300)])).toThrow();
    expect(() => buildIco([])).toThrow();
  });
});

describe('manifest·HTML', () => {
  it('경로 정리', () => {
    expect(normPath('')).toBe('/');
    expect(normPath('assets')).toBe('/assets/');
    expect(normPath('/img/')).toBe('/img/');
    expect(normPath('https://cdn.x/i')).toBe('https://cdn.x/i/');
  });
  it('manifest', () => {
    const m = JSON.parse(manifest({ name: '내 사이트', theme: '#112233', path: 'static' }));
    expect(m.short_name).toBe('내 사이트');
    expect(m.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(m.icons[0].src).toBe('/static/android-chrome-192x192.png');
    expect(m.theme_color).toBe('#112233');
  });
  it('HTML', () => {
    const h = htmlSnippet({ theme: '#abcdef' });
    expect(h).toContain('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">');
    expect(h).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">');
    expect(h).toContain('<meta name="theme-color" content="#abcdef">');
  });
  it('글자 크기 비율', () => { expect(textScale('A')).toBeGreaterThan(textScale('AB')); expect(textScale('😀')).toBe(0.62); });
});
