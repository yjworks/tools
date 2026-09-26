/**
 * dibrain.dev/tools 빌드 설정.
 *
 * 도구 하나 = src/<slug>/ 폴더 하나 (index.html + main.js + meta.json). 배포 주소는 dibrain.dev/tools/<slug>/.
 * 공통 코드·스타일은 src/_shared/.
 * 공통 머리말·머리글·바닥글·광고 자리는 이 파일의 htmlParts 플러그인이 끼워 넣는다.
 * 도구 목록(registry.json), 사이트맵, 도구 아이콘도 빌드할 때 meta.json 에서 만든다.
 * 새 도구를 추가하면 폴더만 만들면 되고, 이 파일은 고칠 필요가 없다.
 *
 * meta.json 에 "pwa": true 가 있으면 그 폴더만 홈 화면에 설치되는 앱이 된다:
 *   <slug>/manifest.webmanifest, <slug>/sw.js 를 만들고 페이지 머리말에 연결한다.
 *   설치 아이콘 PNG 는 public/<slug>/ 에 둔다(scripts/pwa-icons.cjs 로 만든다).
 *   /tools/ 자체에는 manifest 를 붙이지 않는다. 상위 경로에 설치된 앱이 있으면 안드로이드가 하위 앱 설치를 막는다.
 * "kind": "app" 이면 dibrain.dev 첫 화면의 '앱' 칸에 나온다(registry.json 의 kind).
 */
import { defineConfig } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconSvg } from './scripts/icon.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ROOT, 'src');
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'site.config.json'), 'utf8'));
const BUILD_ID = Date.now().toString(36);

function loadTools() {
  return readdirSync(SRC)
    .filter((slug) => !slug.startsWith('_') && existsSync(resolve(SRC, slug, 'meta.json')))
    .map((slug) => ({ slug, ...JSON.parse(readFileSync(resolve(SRC, slug, 'meta.json'), 'utf8')) }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  const pwa = page.pwa
    ? `<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="${esc(page.shortName || page.name)}">
<script>if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){})});</script>`
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
${pwa}
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${cfg.gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${cfg.gaId}',{content_group:'${page.kind === 'app' ? 'app' : 'tool'}'${page.slug ? `,tool_slug:'${page.slug}'` : ''}});</script>
${ads}`;
}

const header = `<header class="site"><div class="wrap">
<a class="brand" href="/"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="22" fill="#2f6fed"/><path fill="#fff" d="M25.5 24H40.5a3.5 3.5 0 0 1 3.5 3.5V68.5a3.5 3.5 0 0 1-3.5 3.5H25.5a3.5 3.5 0 0 1-3.5-3.5V27.5a3.5 3.5 0 0 1 3.5-3.5Z M49 23.2a24.8 24.8 0 0 1 0 49.6Z"/></svg>DigitalBrain</a>
<nav><a href="/#apps">앱</a><a href="/tools/">도구</a><a href="${cfg.blogUrl}">블로그</a></nav>
</div></header>`;

/* 기록을 저장하는 도구(meta.json "storage": 키 접두사 목록)는 맨 아래에 '기록 전체 삭제'를 둔다.
   dibrain.dev 는 모든 앱·도구가 같은 주소를 쓰므로 그 도구의 키만 지운다(블로그 저장소 brand/README.md '기록 전체 삭제'). */
function resetRow(page) {
  if (!page || !page.storage || !page.storage.length) return '';
  const msg = `이 도구에 저장된 기록을 모두 지웁니다${page.storageNote ? `(${page.storageNote})` : ''}. 되돌릴 수 없습니다. 계속할까요?`;
  return `<p class="reset-row"><span>기록은 이 기기에만 저장됩니다.${page.storageNote ? ` (${esc(page.storageNote)})` : ''}</span>
<button type="button" class="ghost small" id="db-reset">기록 전체 삭제</button></p>
<script>(function(){var P=${JSON.stringify(page.storage)},M=${JSON.stringify(msg)};
document.getElementById('db-reset').addEventListener('click',function(){if(!confirm(M))return;
try{var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(P.some(function(p){return k.indexOf(p)===0}))ks.push(k)}ks.forEach(function(k){localStorage.removeItem(k)})}catch(e){}
location.reload()})})();</script>`;
}

const footer = (page) => `<footer class="site"><div class="wrap">
${resetRow(page)}
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
const GROUPS = [['생활 계산', 'life'], ['문서·텍스트', 'docs'], ['PDF', 'pdf'], ['사진 편집', 'photo'], ['이미지 변환', 'image'], ['오디오·영상', 'media'], ['공부·집중', 'focus'], ['모임·놀이', 'play'], ['3D 프린팅', '3d']];

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

/* 설치형 도구의 서비스 워커. 페이지는 네트워크 먼저(새 배포가 바로 보이게), 나머지는 캐시 먼저.
   AI 모델처럼 큰 파일(/models/ 경로, /mediapipe/<버전>/ 엔진, 모델 저장소 호스트)은 배포가 바뀌어도 지우지 않는 별도 캐시에 둔다.
   광고·통계 요청은 건드리지 않는다. */
function swSource(slug) {
  return `/* ${slug} — scripts 가 빌드 때 만든 파일. 직접 고치지 말 것 (vite.config.js swSource). */
const PREFIX = 'dbt-${slug}-';
const CACHE = PREFIX + '${BUILD_ID}';
const MODELS = 'dbt-models';
const MODEL_HOST = /(^|\\.)(huggingface\\.co|hf\\.co)$|^storage\\.googleapis\\.com$|^cdn\\.jsdelivr\\.net$/;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const u = new URL(r.url);
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put('./', c)); return res; })
      .catch(() => caches.match('./')));
    return;
  }
  const model = MODEL_HOST.test(u.host) || (u.origin === location.origin && (u.pathname.includes('/models/') || u.pathname.includes('/mediapipe/')));
  if (!model && u.origin !== location.origin) return;
  const name = model ? MODELS : CACHE;
  e.respondWith(caches.open(name).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => {
    if (res.ok) c.put(r, res.clone());
    return res;
  }))));
});
`;
}

function manifest(t) {
  return JSON.stringify({
    id: `/tools/${t.slug}/`,
    name: t.name,
    short_name: t.shortName || t.name,
    description: t.desc,
    lang: 'ko',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: t.color || '#2f6fed',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }, null, 2);
}

function htmlParts() {
  let tools = loadTools();
  return {
    name: 'dibrain-html-parts',
    buildStart() {
      tools = loadTools();
      for (const t of tools) {
        this.addWatchFile(resolve(SRC, t.slug, 'meta.json'));
        if (t.pwa) for (const f of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
          if (!existsSync(resolve(ROOT, 'public', t.slug, f))) this.error(`설치 아이콘 없음: public/${t.slug}/${f} — node scripts/pwa-icons.cjs 로 만드세요`);
        }
      }
    },
    transformIndexHtml(html, ctx) {
      const m = ctx.path.match(/^\/([^/_][^/]*)\/index\.html$/);
      const page = m
        ? tools.find((t) => t.slug === m[1])
        : { title: '브라우저 도구 모음 — 설치·업로드 없이 바로 | DigitalBrain', desc: 'CSV 한글 깨짐 복구, 한영타 변환, 사진 위치정보 제거, 사진 PDF 변환, STL 무게·비용 견적까지. 파일을 서버로 보내지 않고 브라우저 안에서만 처리합니다.' };
      if (!page) throw new Error(`meta.json 없음: ${ctx.path}`);
      return html
        .replace('<!--HEAD-->', head(page))
        .replace('<!--HEADER-->', header)
        .replace('<!--FOOTER-->', footer(m ? page : null))
        .replace('<!--AD-->', ad)
        .replace('<!--RELATED-->', m ? related(tools, m[1]) : '')
        .replace('<!--TOOL_LIST-->', toolList(tools));
    },
    generateBundle() {
      this.emitFile({
        type: 'asset', fileName: 'registry.json',
        source: JSON.stringify(tools.map((t) => ({ slug: t.slug, name: t.name, desc: t.desc, group: t.group, kind: t.kind || 'tool', icon: `/tools/${t.slug}/icon.svg` })), null, 1),
      });
      for (const t of tools) {
        this.emitFile({ type: 'asset', fileName: `${t.slug}/icon.svg`, source: iconSvg(t) });
        if (t.pwa) {
          this.emitFile({ type: 'asset', fileName: `${t.slug}/manifest.webmanifest`, source: manifest(t) });
          this.emitFile({ type: 'asset', fileName: `${t.slug}/sw.js`, source: swSource(t.slug) });
        }
      }
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
