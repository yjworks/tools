/**
 * dibrain.dev/tools 빌드 설정.
 *
 * 도구 하나 = src/<slug>/ 폴더 하나 (index.html + main.js + meta.json). 배포 주소는 dibrain.dev/tools/<slug>/.
 * 공통 코드·스타일은 src/_shared/.
 * 공통 머리말·머리글·바닥글·광고 자리는 이 파일의 htmlParts 플러그인이 끼워 넣는다.
 * 도구 목록(registry.json), 사이트맵, 도구 아이콘도 빌드할 때 meta.json 에서 만든다.
 * 새 도구를 추가하면 폴더만 만들면 되고, 이 파일은 고칠 필요가 없다.
 */
import { defineConfig } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ROOT, 'src');
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'site.config.json'), 'utf8'));

function loadTools() {
  return readdirSync(SRC)
    .filter((slug) => !slug.startsWith('_') && existsSync(resolve(SRC, slug, 'meta.json')))
    .map((slug) => ({ slug, ...JSON.parse(readFileSync(resolve(SRC, slug, 'meta.json'), 'utf8')) }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function iconSvg(t) {
  const text = esc(t.iconText || t.name.slice(0, 1));
  const size = text.length >= 3 ? 30 : text.length === 2 ? 40 : 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<rect width="96" height="96" rx="22" fill="${t.color || '#2f6fed'}"/>
<text x="48" y="50" text-anchor="middle" dominant-baseline="central" fill="#fff"
 font-family="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" font-weight="800" font-size="${size}">${text}</text>
</svg>`;
}

function head(page) {
  const url = page.slug ? `${cfg.siteUrl}${page.slug}/` : cfg.siteUrl;
  const title = page.slug ? `${page.title} | DigitalBrain 도구` : page.title;
  const ld = page.slug
    ? {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: page.title,
        url,
        description: page.desc,
        applicationCategory: page.category || 'UtilitiesApplication',
        operatingSystem: 'Any (웹 브라우저)',
        inLanguage: 'ko',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
      }
    : { '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.title, url, description: page.desc, inLanguage: 'ko' };
  const ads = cfg.adsenseClient
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.adsenseClient}" crossorigin="anonymous"></script>`
    : '';
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.desc)}">
${page.keywords ? `<meta name="keywords" content="${esc(page.keywords.join(', '))}">` : ''}
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.desc)}">
<meta property="og:image" content="${cfg.hubUrl}og-default.png">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${cfg.gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${cfg.gaId}',{content_group:'tool'${page.slug ? `,tool_slug:'${page.slug}'` : ''}});</script>
${ads}`;
}

const header = `<header class="site"><div class="wrap">
<a class="brand" href="/"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5.3" fill="#2f6fed"/><path fill="#fff" fill-rule="evenodd" d="M6.6 5.6H11.4a6.4 6.4 0 0 1 0 12.8H6.6Z M9.6 8.6H11.4a3.4 3.4 0 0 1 0 6.8H9.6Z"/></svg>DigitalBrain</a>
<nav><a href="/tools/">도구</a><a href="/">앱</a><a href="${cfg.blogUrl}">블로그</a></nav>
</div></header>`;

const footer = `<footer class="site"><div class="wrap">
<p class="privacy">🔒 이 사이트의 도구는 파일을 서버로 보내지 않습니다. 모든 처리는 지금 쓰는 브라우저 안에서 끝납니다.</p>
<p><span>© DigitalBrain</span> · <a href="/tools/">도구 목록</a> · <a href="${cfg.blogUrl}privacy/">개인정보처리방침</a> · <a href="mailto:${cfg.contact}">문의·오류 제보</a> · <a href="/tools/third-party-licenses.txt">오픈소스 라이선스</a></p>
</div></footer>`;

/* 광고는 도구와 설명 사이, 버튼에서 떨어진 곳 한 군데에만 둔다(실수 클릭 유도 금지). 승인 전에는 아무것도 나오지 않는다. */
const ad = cfg.adsenseClient && cfg.adSlot
  ? `<aside class="ad"><span class="ad-label">광고</span><ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.adsenseClient}" data-ad-slot="${cfg.adSlot}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></aside>`
  : '';

function related(tools, slug) {
  const others = tools.filter((t) => t.slug !== slug).slice(0, 6);
  if (!others.length) return '';
  return `<section class="related"><h2>다른 도구</h2><div class="cards">${others
    .map((t) => `<a class="card" href="../${t.slug}/"><img src="../${t.slug}/icon.svg" alt="" width="44" height="44" loading="lazy"><span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span></a>`)
    .join('')}</div></section>`;
}

/* 분류 순서와 주소 조각. dibrain.dev 첫 화면(블로그 저장소 hub/index.html, scripts/build_hub.py)과 같게 둔다.
   여기 없는 분류는 뒤에 붙는다. */
const GROUPS = [['생활 계산', 'life'], ['문서·텍스트', 'docs'], ['사진·이미지', 'image'], ['오디오·영상', 'media'], ['모임·놀이', 'play'], ['3D 프린팅', '3d']];

function toolList(tools) {
  const order = GROUPS.map(([g]) => g), ids = Object.fromEntries(GROUPS), by = {};
  for (const t of tools) {
    const g = t.group || '기타';
    if (!by[g]) { by[g] = []; if (!order.includes(g)) order.push(g); }
    by[g].push(t);
  }
  const groups = order.filter((g) => by[g]).map((g, i) => ({ g, id: `t-${ids[g] || `g${i}`}`, list: by[g] }));
  const chips = `<ul class="chips">${groups.map(({ g, id, list }) => `<li><a class="chip" href="#${id}">${esc(g)} <b>${list.length}</b></a></li>`).join('')}</ul>`;
  return chips + groups
    .map(({ g, id, list }) => `<section class="group" id="${id}"><h2>${esc(g)} · ${list.length}</h2><div class="cards">${list
      .map((t) => `<a class="card" href="./${t.slug}/"><img src="./${t.slug}/icon.svg" alt="" width="48" height="48" loading="lazy"><span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span></a>`)
      .join('')}</div></section>`)
    .join('');
}

function htmlParts() {
  let tools = loadTools();
  return {
    name: 'dibrain-html-parts',
    buildStart() { tools = loadTools(); for (const t of tools) this.addWatchFile(resolve(SRC, t.slug, 'meta.json')); },
    transformIndexHtml(html, ctx) {
      const m = ctx.path.match(/^\/([^/_][^/]*)\/index\.html$/);
      const page = m
        ? tools.find((t) => t.slug === m[1])
        : { title: '브라우저 도구 모음 — 설치·업로드 없이 바로 | DigitalBrain', desc: 'CSV 한글 깨짐 복구, 한영타 변환, 사진 위치정보 제거, 사진 PDF 변환, STL 무게·비용 견적까지. 파일을 서버로 보내지 않고 브라우저 안에서만 처리합니다.' };
      if (!page) throw new Error(`meta.json 없음: ${ctx.path}`);
      return html
        .replace('<!--HEAD-->', head(page))
        .replace('<!--HEADER-->', header)
        .replace('<!--FOOTER-->', footer)
        .replace('<!--AD-->', ad)
        .replace('<!--RELATED-->', m ? related(tools, m[1]) : '')
        .replace('<!--TOOL_LIST-->', toolList(tools));
    },
    generateBundle() {
      this.emitFile({
        type: 'asset', fileName: 'registry.json',
        source: JSON.stringify(tools.map((t) => ({ slug: t.slug, name: t.name, desc: t.desc, group: t.group, icon: `/tools/${t.slug}/icon.svg` })), null, 1),
      });
      for (const t of tools) this.emitFile({ type: 'asset', fileName: `${t.slug}/icon.svg`, source: iconSvg(t) });
      const urls = [cfg.siteUrl, ...tools.map((t) => `${cfg.siteUrl}${t.slug}/`)];
      this.emitFile({
        type: 'asset', fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(() => {
  const tools = loadTools();
  const input = { index: resolve(SRC, 'index.html') };
  for (const t of tools) input[t.slug] = resolve(SRC, t.slug, 'index.html');
  return {
    root: SRC,
    publicDir: resolve(ROOT, 'public'),
    base: './',
    plugins: [htmlParts()],
    build: {
      outDir: resolve(ROOT, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      rollupOptions: { input },
    },
    test: { root: ROOT, include: ['test/**/*.test.js'] },
  };
});
