/* 파비콘 만들기의 계산 부분.
   ICO 파일 구조(모두 리틀 엔디언):
     머리(6바이트)   예약 0(2) · 종류 1=아이콘(2) · 그림 수(2)
     목록(16바이트씩) 가로(1, 256 은 0) · 세로(1) · 색 수 0(1) · 예약 0(1) · 면 1(2) · 비트 32(2) · 크기(4) · 위치(4)
     그림 데이터     PNG 파일을 그대로 넣는다(윈도 비스타 이후·모든 최신 브라우저가 읽는다). */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 바이트의 가로·세로(IHDR). PNG 가 아니면 오류. */
export function pngSize(png) {
  if (!PNG_SIG.every((b, i) => png[i] === b)) throw new Error('PNG 가 아닙니다');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** PNG 여러 장 → ICO 바이트 */
export function buildIco(pngs) {
  if (!pngs.length) throw new Error('그림이 없습니다');
  const head = 6 + 16 * pngs.length;
  const total = head + pngs.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); dv.setUint16(2, 1, true); dv.setUint16(4, pngs.length, true);
  let offset = head;
  pngs.forEach((png, i) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error('ICO 안의 그림은 256px 이하여야 합니다');
    const e = 6 + i * 16;
    out[e] = width === 256 ? 0 : width;
    out[e + 1] = height === 256 ? 0 : height;
    out[e + 2] = 0; out[e + 3] = 0;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, png.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}

/** ICO 목록 읽기(검증용) */
export function readIco(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) return null;
  const n = dv.getUint16(4, true), list = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + i * 16;
    list.push({ width: bytes[e] || 256, height: bytes[e + 1] || 256, bits: dv.getUint16(e + 6, true), size: dv.getUint32(e + 8, true), offset: dv.getUint32(e + 12, true) });
  }
  return list;
}

/** 만들 파일 목록 */
export const FILES = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'favicon-48x48.png', size: 48 },
  { name: 'apple-touch-icon.png', size: 180, opaque: true },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
];
export const ICO_SIZES = [16, 32, 48];

/** 경로 앞부분 정리: '' → '/', 'assets' → '/assets/' */
export function normPath(p) {
  let s = (p || '').trim();
  if (!s) return '/';
  if (!/^(https?:)?\//.test(s)) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s;
}

/** site.webmanifest 내용 */
export function manifest({ name = '', shortName = '', theme = '#ffffff', background = '#ffffff', path = '/' } = {}) {
  const p = normPath(path);
  return JSON.stringify({
    name, short_name: shortName || name,
    icons: [
      { src: `${p}android-chrome-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${p}android-chrome-512x512.png`, sizes: '512x512', type: 'image/png' },
    ],
    theme_color: theme, background_color: background, display: 'standalone',
  }, null, 2);
}

/** <head> 에 붙일 HTML */
export function htmlSnippet({ theme = '#ffffff', path = '/' } = {}) {
  const p = normPath(path);
  return [
    `<link rel="icon" href="${p}favicon.ico" sizes="16x16 32x32 48x48">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${p}favicon-32x32.png">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${p}favicon-16x16.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${p}apple-touch-icon.png">`,
    `<link rel="manifest" href="${p}site.webmanifest">`,
    `<meta name="theme-color" content="${theme}">`,
  ].join('\n');
}

/** 글자 아이콘에 맞는 글자 크기 비율(글자 수에 따라) */
export function textScale(text) {
  const n = [...text].length;
  return n <= 1 ? 0.62 : n === 2 ? 0.48 : 0.36;
}
