/*
 * meta.json 에 "pwa": true 인 도구의 설치 아이콘 PNG 를 public/<slug>/ 에 만든다.
 * (icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png)
 *
 *   NODE_PATH=<playwright 가 있는 node_modules> node scripts/pwa-icons.cjs [slug ...]
 *
 * 빌드 서버(GitHub Actions)에는 브라우저가 없어서 PNG 는 여기서 만들어 저장소에 올린다.
 * 아이콘을 바꾸면(meta.json 의 color·iconText 또는 src/<slug>/icon.svg) 이 스크립트를 다시 돌린다.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

(async () => {
  const { iconSvg, maskableSvg } = await import('./icon.js');
  const only = process.argv.slice(2);
  const tools = fs.readdirSync(SRC)
    .filter((s) => !s.startsWith('_') && fs.existsSync(path.join(SRC, s, 'meta.json')))
    .map((slug) => ({ slug, ...JSON.parse(fs.readFileSync(path.join(SRC, slug, 'meta.json'), 'utf8')) }))
    .filter((t) => t.pwa && (!only.length || only.includes(t.slug)));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  // 글자 아이콘이 기기 글꼴에 따라 달라지지 않게 Pretendard 를 쓴다(있으면).
  const font = process.env.PRETENDARD_CSS ? `<link rel="stylesheet" href="${process.env.PRETENDARD_CSS}">` : '';
  async function render(svg, size, out) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><head>${font}</head><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  for (const t of tools) {
    const dir = path.join(ROOT, 'public', t.slug);
    fs.mkdirSync(dir, { recursive: true });
    await render(iconSvg(t), 192, path.join(dir, 'icon-192.png'));
    await render(iconSvg(t), 512, path.join(dir, 'icon-512.png'));
    await render(maskableSvg(t), 512, path.join(dir, 'maskable-512.png'));
    await render(maskableSvg(t), 180, path.join(dir, 'apple-touch-icon.png'));
    console.log('pwa-icons:', t.slug);
  }
  await browser.close();
})();
