/* QR 코드 만들기·읽기의 계산 부분.
   - 만들기: qrcode-generator(MIT). 한글이 깨지지 않도록 UTF-8 바이트로 바꿔 넣는다
     (이 라이브러리의 기본 변환은 글자마다 1바이트로 잘라 한글을 망가뜨린다).
   - Wi-Fi 문자열: WIFI:T:<보안>;S:<이름>;P:<비밀번호>;H:<숨김>;; — 값 안의 \ ; , : " 는 앞에 \ 를 붙인다.
   - 연락처: vCard 3.0. */
import qrcode from 'qrcode-generator';

/** 오류 복원 레벨: 가려지거나 더러워져도 복원할 수 있는 코드워드 비율(대략) */
export const ECC = {
  L: { pct: 7, name: '낮음 (L, 약 7%)' },
  M: { pct: 15, name: '보통 (M, 약 15%)' },
  Q: { pct: 25, name: '높음 (Q, 약 25%)' },
  H: { pct: 30, name: '최고 (H, 약 30%)' },
};

/** 문자열 → UTF-8 바이트를 글자 하나당 1바이트로 담은 문자열 */
export function utf8ByteString(s) {
  const b = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}

/** QR 행렬. {size, isDark(r,c), version}. 담을 수 없을 만큼 길면 오류. */
export function makeMatrix(text, ecc = 'M') {
  if (!text) throw new Error('담을 내용이 없습니다');
  const qr = qrcode(0, ecc);
  qr.addData(utf8ByteString(text), 'Byte');
  try { qr.make(); } catch { throw new Error('내용이 너무 길어 QR 코드 하나에 담을 수 없습니다'); }
  const size = qr.getModuleCount();
  return { size, version: (size - 17) / 4, isDark: (r, c) => qr.isDark(r, c) };
}

/** 행렬을 RGBA 픽셀로(한 칸 scale 픽셀, 둘레 여백 margin 칸) */
export function matrixToRgba(m, { scale = 4, margin = 4, fg = [0, 0, 0], bg = [255, 255, 255] } = {}) {
  const px = (m.size + margin * 2) * scale;
  const out = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    const r = Math.floor(y / scale) - margin;
    for (let x = 0; x < px; x++) {
      const c = Math.floor(x / scale) - margin;
      const dark = r >= 0 && c >= 0 && r < m.size && c < m.size && m.isDark(r, c);
      const col = dark ? fg : bg, i = (y * px + x) * 4;
      out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2]; out[i + 3] = 255;
    }
  }
  return { data: out, width: px, height: px };
}

/** SVG 문자열. 가로로 이어진 검은 칸을 한 사각형으로 묶어 path 하나로 그린다. */
export function matrixToSvg(m, { margin = 4, fg = '#000000', bg = '#ffffff', px = 0 } = {}) {
  const n = m.size + margin * 2;
  let d = '';
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.isDark(r, c)) { c++; continue; }
      let e = c;
      while (e < m.size && m.isDark(r, e)) e++;
      d += `M${c + margin} ${r + margin}h${e - c}v1h-${e - c}z`;
      c = e;
    }
  }
  const size = px ? ` width="${px}" height="${px}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${size} shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${bg}"/><path fill="${fg}" d="${d}"/></svg>`;
}

const escWifi = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');

/** Wi-Fi 접속 문자열. type: WPA(WPA/WPA2/WPA3) | WEP | nopass */
export function wifiString({ ssid, password = '', type = 'WPA', hidden = false }) {
  if (!ssid) throw new Error('와이파이 이름(SSID)을 넣어 주세요');
  let s = `WIFI:T:${type};S:${escWifi(ssid)};`;
  if (type !== 'nopass') s += `P:${escWifi(password)};`;
  if (hidden) s += 'H:true;';
  return s + ';';
}

/** WIFI: 문자열 해석. 아니면 null */
export function parseWifi(text) {
  if (!/^WIFI:/i.test(text)) return null;
  const body = text.slice(5), out = { type: '', ssid: '', password: '', hidden: false };
  let key = '', val = '', inKey = true;
  const flush = () => {
    const k = key.toUpperCase();
    if (k === 'T') out.type = val; else if (k === 'S') out.ssid = val; else if (k === 'P') out.password = val;
    else if (k === 'H') out.hidden = /^true$/i.test(val);
    key = ''; val = ''; inKey = true;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inKey) { if (ch === ':') inKey = false; else if (ch !== ';') key += ch; continue; }
    if (ch === '\\' && i + 1 < body.length) { val += body[++i]; continue; }
    if (ch === ';') { flush(); continue; }
    val += ch;
  }
  if (key) flush();
  return out;
}

const escV = (s) => String(s).replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

/** 연락처 vCard 3.0 */
export function vcardString({ name = '', org = '', title = '', tel = '', email = '', url = '' }) {
  if (!name && !tel && !email) throw new Error('이름·전화·이메일 중 하나는 넣어 주세요');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escV(name)};;;;`, `FN:${escV(name)}`];
  if (org) lines.push(`ORG:${escV(org)}`);
  if (title) lines.push(`TITLE:${escV(title)}`);
  if (tel) lines.push(`TEL;TYPE=CELL:${tel.replace(/[^0-9+\-() ]/g, '')}`);
  if (email) lines.push(`EMAIL:${escV(email)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** 읽은 내용의 종류 */
export function classify(text) {
  if (/^WIFI:/i.test(text)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(text)) return 'vcard';
  if (/^https?:\/\/\S+$/i.test(text.trim())) return 'url';
  if (/^(mailto|tel|sms|smsto):/i.test(text)) return 'uri';
  return 'text';
}

/** 주소처럼 보이면 https:// 를 붙여 준다(예: dibrain.dev → https://dibrain.dev) */
export function normalizeUrl(s) {
  const t = s.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return `https://${t}`;
  return t;
}
