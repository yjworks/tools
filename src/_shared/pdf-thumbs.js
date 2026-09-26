/* PDF 쪽 그림 그리기(pdf-merge·pdf-split·pdf-compress 공통).
   pdf.js(pdfjs-dist, Apache-2.0)를 처음 쓸 때만 불러온다. 워커·CMap·글꼴·wasm 은 모두 이 사이트 안의 파일이다(CDN 없음).
   오래된 휴대폰 브라우저에서도 열리게 legacy 빌드를 쓴다(최신 빌드는 Map.getOrInsertComputed 같은 새 기능을 요구한다). */
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/* 한국어 문서에 쓰이는 CMap, 문서에 들어 있지 않은 기호 글꼴(Symbol·ZapfDingbats), JPEG2000·JBIG2 해독용 wasm.
   브라우저에서는 useSystemFonts 가 켜져 있어 Helvetica·Times 같은 나머지 기본 글꼴은 기기 글꼴로 대신 그리므로
   LiberationSans(GPL+글꼴 예외) 파일은 싣지 않는다. 기호 글꼴 두 개(Foxit, BSD 계열 PDFium 라이선스)만 둔다.
   빌드가 해시 붙은 파일로 내보내므로, 이름 → 주소 표를 만들어 두고 필요할 때만 받는다. */
const CMAPS = import.meta.glob('../../node_modules/pdfjs-dist/cmaps/*{KS,Korea}*.bcmap', { eager: true, query: '?no-inline&url', import: 'default' });
const FONTS = import.meta.glob('../../node_modules/pdfjs-dist/standard_fonts/{FoxitSymbol,FoxitDingbats}.pfb', { eager: true, query: '?no-inline&url', import: 'default' });
const WASM = import.meta.glob('../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', { eager: true, query: '?no-inline&url', import: 'default' });

const byName = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k.split('/').pop(), v]));
const FILES = { cMapUrl: byName(CMAPS), standardFontDataUrl: byName(FONTS), wasmUrl: byName(WASM) };

let libPromise = null, worker = null;

/** pdf.js 를 한 번만 불러오고, 워커 하나를 여러 문서가 같이 쓴다. */
export function loadPdfjs() {
  if (!libPromise) {
    libPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      worker = new lib.PDFWorker();
      return lib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

class LocalDataFactory {
  constructor() {}
  async fetch({ kind, filename }) {
    const url = FILES[kind]?.[filename];
    if (!url) throw new Error(`pdf.js 보조 파일 없음: ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pdf.js 보조 파일을 받지 못함: ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/**
 * PDF 를 pdf.js 로 연다. bytes 는 복사해서 넘긴다(pdf.js 가 버퍼를 워커로 옮겨 원본이 비워지므로).
 * 암호가 필요한 파일이면 { needsPassword: true } 를 던진다.
 */
export async function openPdf(bytes) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: bytes.slice(),
    worker,
    BinaryDataFactory: LocalDataFactory,
    cMapUrl: 'local/', standardFontDataUrl: 'local/', wasmUrl: 'local/',
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
    verbosity: 0,
  });
  try {
    return await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') { const err = new Error('password'); err.needsPassword = true; throw err; }
    throw e;
  }
}

/** 문서를 닫아 워커 쪽 메모리를 비운다(워커 자체는 다른 문서와 같이 쓰므로 남는다). */
export function closePdf(doc) {
  return Promise.resolve(doc).then((d) => d?.loadingTask?.destroy()).catch(() => {});
}

/** 쪽 하나를 캔버스에 그린다. width 는 CSS 픽셀 기준 폭, extraRotation 은 사용자가 더 돌린 각도(90 단위). */
export async function renderThumb(doc, pageIndex, width = 160, extraRotation = 0) {
  const page = await doc.getPage(pageIndex + 1);
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: (width * dpr) / base.width, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport, background: '#ffffff', annotationMode: 1 }).promise;   // 1 = AnnotationMode.ENABLE: 도장·입력 칸 모양도 그린다
  page.cleanup();
  return canvas;
}

/**
 * 한 번에 몇 개씩만 그리는 대기열. 수백 쪽 문서도 메모리가 터지지 않게 화면에 보이는 것부터 그린다.
 * observe(el, job): el 이 화면에 가까워지면 job() 을 실행한다.
 */
export function thumbQueue(concurrency = 2) {
  const waiting = [];
  let running = 0;
  const pump = () => {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running++;
      Promise.resolve().then(job).catch(() => {}).finally(() => { running--; pump(); });
    }
  };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const job = e.target._thumbJob;
        e.target._thumbJob = null;
        if (job) { waiting.push(job); pump(); }
      }
    }, { rootMargin: '300px 0px' })
    : null;
  return {
    observe(el, job) {
      if (!io) { waiting.push(job); pump(); return; }
      el._thumbJob = job;
      io.observe(el);
    },
    forget(el) { if (io) io.unobserve(el); el._thumbJob = null; },
  };
}
