/**
 * 도구·앱 아이콘 SVG. vite.config.js(빌드)와 scripts/pwa-icons.cjs(설치용 PNG)가 같이 쓴다.
 *
 * src/<slug>/icon.svg 가 있으면 그 파일을 그대로 쓰고(앱처럼 그림을 직접 그린 경우),
 * 없으면 meta.json 의 color 바탕에 iconText 글자를 얹어 만든다.
 * 모양 규칙은 블로그 저장소 brand/README.md: 모서리 22/96, 가운데 그림 하나.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function iconSvg(t) {
  const custom = resolve(SRC, t.slug, 'icon.svg');
  if (existsSync(custom)) return readFileSync(custom, 'utf8');
  const text = esc(t.iconText || t.name.slice(0, 1));
  const size = text.length >= 3 ? 30 : text.length === 2 ? 40 : 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<rect width="96" height="96" rx="22" fill="${t.color || '#2f6fed'}"/>
<text x="48" y="50" text-anchor="middle" dominant-baseline="central" fill="#fff"
 font-family="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" font-weight="800" font-size="${size}">${text}</text>
</svg>`;
}

/** 홈 화면용: 모서리 없이 꽉 채운 판. OS 가 자기 모양으로 자른다. */
export function maskableSvg(t) {
  return iconSvg(t).replace(/(<rect[^>]*?)\s+rx="[^"]*"/, '$1');
}
