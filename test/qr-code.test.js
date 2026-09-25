import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import {
  utf8ByteString, makeMatrix, matrixToRgba, matrixToSvg, wifiString, parseWifi, vcardString, classify, normalizeUrl,
} from '../src/_shared/qr-code.js';

const roundTrip = (text, ecc = 'M') => {
  const img = matrixToRgba(makeMatrix(text, ecc), { scale: 4 });
  return jsQR(img.data, img.width, img.height)?.data;
};

describe('만들고 다시 읽기 (jsQR)', () => {
  it('주소', () => expect(roundTrip('https://dibrain.dev/tools/')).toBe('https://dibrain.dev/tools/'));
  it('한글이 깨지지 않는다', () => expect(roundTrip('안녕하세요, 디지털브레인입니다')).toBe('안녕하세요, 디지털브레인입니다'));
  it('오류 복원 H', () => expect(roundTrip('HELLO 123', 'H')).toBe('HELLO 123'));
  it('와이파이', () => {
    const s = wifiString({ ssid: 'My;Home', password: 'p@ss:"1"' });
    expect(roundTrip(s)).toBe(s);
  });
});

describe('행렬', () => {
  it('크기 = 17 + 4×버전, 레벨이 높을수록 같은 내용도 커진다', () => {
    const m = makeMatrix('https://example.com', 'L');
    expect(m.size).toBe(17 + 4 * m.version);
    expect(makeMatrix('https://example.com/very/long/path?x=1', 'H').size).toBeGreaterThanOrEqual(makeMatrix('https://example.com/very/long/path?x=1', 'L').size);
  });
  it('너무 긴 내용은 오류', () => expect(() => makeMatrix('가'.repeat(3000), 'H')).toThrow(/너무 길어/));
  it('빈 내용은 오류', () => expect(() => makeMatrix('')).toThrow());
  it('UTF-8 바이트', () => expect([...utf8ByteString('가')].map((c) => c.charCodeAt(0))).toEqual([0xea, 0xb0, 0x80]));
  it('SVG: 여백 포함 viewBox, 찾기 패턴 첫 줄은 7칸 한 덩어리', () => {
    const m = makeMatrix('A', 'L');
    const svg = matrixToSvg(m, { margin: 4 });
    expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    expect(svg).toContain('M4 4h7v1h-7z');
  });
  it('RGBA: 여백은 흰색, 왼쪽 위 찾기 패턴은 검정', () => {
    const img = matrixToRgba(makeMatrix('A'), { scale: 2, margin: 4 });
    expect(img.data[0]).toBe(255);
    const i = (8 * img.width + 8) * 4;
    expect(img.data[i]).toBe(0);
  });
});

describe('와이파이·연락처', () => {
  it('와이파이 문자열 형식과 특수문자 처리', () => {
    expect(wifiString({ ssid: 'Cafe', password: '1234' })).toBe('WIFI:T:WPA;S:Cafe;P:1234;;');
    expect(wifiString({ ssid: 'a;b', password: 'c\\d', hidden: true })).toBe('WIFI:T:WPA;S:a\\;b;P:c\\\\d;H:true;;');
    expect(wifiString({ ssid: 'Free', type: 'nopass' })).toBe('WIFI:T:nopass;S:Free;;');
    expect(() => wifiString({ ssid: '' })).toThrow();
  });
  it('와이파이 해석(되돌리기)', () => {
    const src = { ssid: 'My;Home:5G', password: 'a"b,c\\', type: 'WPA', hidden: true };
    expect(parseWifi(wifiString(src))).toEqual(src);
    expect(parseWifi('hello')).toBe(null);
  });
  it('vCard', () => {
    const v = vcardString({ name: '홍길동', tel: '010-1234-5678', email: 'a@b.c', org: '회사, 주식' });
    expect(v.split('\r\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:홍길동;;;;', 'FN:홍길동', 'ORG:회사\\, 주식', 'TEL;TYPE=CELL:010-1234-5678', 'EMAIL:a@b.c', 'END:VCARD']);
    expect(() => vcardString({})).toThrow();
  });
  it('종류 판단·주소 보정', () => {
    expect(classify('https://a.b/c')).toBe('url');
    expect(classify('WIFI:T:WPA;S:x;;')).toBe('wifi');
    expect(classify('BEGIN:VCARD\r\n')).toBe('vcard');
    expect(classify('그냥 글')).toBe('text');
    expect(normalizeUrl('dibrain.dev/tools')).toBe('https://dibrain.dev/tools');
    expect(normalizeUrl('http://x.y')).toBe('http://x.y');
    expect(normalizeUrl('안녕')).toBe('안녕');
  });
});
