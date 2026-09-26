# 도구 만들기 규격

**도구냐 앱이냐**: 한 페이지에서 끝나는 기능은 여기(도구)에 넣는다. AI 샷 정도로 화면·기능이 여럿 얽힌 것은
도구가 아니라 **독립 저장소의 앱**으로 만든다(블로그 저장소 brand/README.md 의 '앱 추가' 참고).

dibrain.dev/tools 에 도구를 추가할 때 지키는 규칙. 사람이든 AI든 이 문서대로 만든다.

## 1. 파일

```
src/<slug>/meta.json    ← 반드시 맨 마지막에 만든다 (index.html·main.js 가 먼저 있어야 빌드가 안 깨진다)
src/<slug>/index.html
src/<slug>/main.js
src/_shared/<slug>.js   ← 화면과 떨어진 순수 로직(계산·변환). 테스트 대상
test/<slug>.test.js     ← vitest. 로직마다 실제 값으로 검증
```

- slug 는 영문 소문자·숫자·하이픈. 주소가 `dibrain.dev/tools/<slug>/` 가 된다.
- `vite.config.js`, `src/_shared/tool.css`, `src/_shared/ui.js`, `package.json` 은 고치지 않는다.
  필요한 스타일은 도구의 index.html 안 `<style>` 에 둔다. 새 npm 패키지는 설치하지 않는다(이미 설치된 것만).

## 2. meta.json

```json
{
  "name": "짧은 이름 (목록 카드용, 12자 안팎)",
  "title": "검색 결과 제목 — 사람들이 실제로 검색하는 말을 넣는다",
  "desc": "검색 결과 설명 1~2문장 (90자 안팎). 무엇을, 어떻게, 업로드 없음 여부",
  "keywords": ["검색어", "..."],
  "group": "생활 계산 | 문서·텍스트 | PDF | 사진 편집 | 이미지 변환 | 오디오·영상 | 공부·집중 | 모임·놀이 | 3D 프린팅",
  "order": 100,
  "iconText": "아이콘에 들어갈 1~3글자",
  "color": "#hex (배경색, 흰 글씨가 잘 보이는 진한 색)",
  "category": "UtilitiesApplication | GameApplication | MultimediaApplication | FinanceApplication",

  "pwa": true,            // 선택. 홈 화면 설치 + 오프라인. 켜면 아래 '설치형 앱' 규칙을 따른다
  "shortName": "누끼",     // 선택. 홈 화면 아이콘 밑 이름(6자 안팎)
  "storage": ["focus-timer:"],   // 기기에 무엇이든 저장하면 필수. localStorage 키 접두사 목록 → 맨 아래 '기록 전체 삭제'
  "storageNote": "집중 기록과 설정"  // 확인창에 나오는 '무엇이 지워지는지'
}
```

### 기록 전체 삭제 (`storage`)

- `storage` 가 있으면(빈 목록 `[]` 이어도) 페이지 맨 아래에 '기록 전체 삭제' 줄이 붙는다. 없으면 붙지 않는다.
- 누르면 그 도구 것만 지우고 새로고침한다:
  - localStorage: `storage` 의 접두사로 시작하는 키
  - Cache Storage: `dbt-<slug>-` 로 시작하는 캐시(페이지·JS)와 `dbt-models-<slug>`(받아 둔 AI 모델·엔진)
- localStorage 는 안 쓰고 모델만 받아 두는 설치형 도구도 `"storage": []` 와 `"storageNote": "받아 둔 AI 모델"` 을 적는다
  (remove-background 참고). 모델도 쓰고 기록도 저장하면 `storageNote` 에 둘 다 적는다(posture-alert 참고).
- IndexedDB 는 지우지 않는다. IndexedDB 를 쓰는 도구는 이름을 `<slug>-` 로 시작하게 하고 이 줄의 코드(vite.config.js resetRow)를 함께 고친다.

(위 `//` 설명은 문서용이다. 실제 meta.json 에는 주석을 넣지 않는다.)

### 아이콘

- 기본은 `color` 바탕 + `iconText` 글자. 앱처럼 그림이 필요하면 `src/<slug>/icon.svg` 를 두면 그 파일을 쓴다.
- `icon.svg` 규칙(블로그 저장소 `brand/README.md`): `viewBox="0 0 96 96"`, `<rect width="96" height="96" rx="22" fill="앱 색">`,
  가운데 흰(또는 검정) 그림 하나. 글자 로고·캐릭터·사진 금지. **유명 서비스 로고와 닮은 구도 금지**(예: 둥근 사각형 안 원 + 오른쪽 위 점 = 인스타그램).
  그림은 가운데 지름 76(=80%) 원 안에 둔다(홈 화면에서 잘리지 않게).

### 설치형 앱 (`"pwa": true`)

- 빌드가 `<slug>/manifest.webmanifest` 와 `<slug>/sw.js` 를 만들고 머리말에 연결한다. 직접 만들지 않는다.
- 설치 아이콘 PNG 는 `node scripts/pwa-icons.cjs <slug>` 로 `public/<slug>/` 에 만든다(없으면 빌드가 멈춘다).
  글자 아이콘이면 `PRETENDARD_CSS=file:///…/pretendard.css` 를 주어 Pretendard 로 그린다.
- 오프라인: 페이지와 JS·CSS 는 서비스 워커가 알아서 저장한다(캐시 `dbt-<slug>-<빌드>`, 새 배포 때 옛것은 지운다).
  AI 모델처럼 큰 파일은 `/models/` 경로, `/mediapipe/` 엔진, 모델 호스트에서 받으면 배포가 바뀌어도 지워지지 않는
  **도구별** 캐시 `dbt-models-<slug>` 에 들어간다. 받아 둔 모델이 있는지 볼 때는 `caches.match(url)` 이나
  `caches.open('dbt-models-<slug>')` 를 쓴다. 모델을 받아 두는 도구는 meta.json 에 `storage` 를 적는다(위 '기록 전체 삭제').

## 3. index.html 뼈대

```html
<!doctype html>
<html lang="ko">
<head>
<!--HEAD-->
</head>
<body>
<!--HEADER-->
<main class="wrap">
  <h1>…</h1>
  <p class="lede">…한두 문장…</p>
  <p class="badge-local">🔒 업로드 없음 · 브라우저 안에서 처리</p>   <!-- 파일을 다루는 도구만 -->
  <section class="tool" id="tool"> …도구 화면… </section>
  <!--AD-->
  <article class="guide">
    <h2>사용법</h2> …
    <h2>(원리·기준·계산 방법 등 이 도구만의 설명)</h2> …
    <h2>자주 묻는 질문</h2> <details><summary>…</summary><p>…</p></details> …
  </article>
  <!--RELATED-->
</main>
<!--FOOTER-->
<script type="module" src="./main.js"></script>
</body>
</html>
```

자리표시(`<!--HEAD-->` 등)는 빌드가 채운다. 지우지 않는다.

## 4. 쓸 수 있는 공통 요소

- `import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, copyText, track } from '../_shared/ui.js';`
  - `fileDrop(labelEl, files => …)`: `<label class="drop"><b>…</b><span class="muted">…</span><input type="file" …></label>`
  - `track('tool_use', { tool: '<slug>', … })`: 숫자·종류만. **파일 이름·내용·입력한 글은 절대 넣지 않는다.**
- 난수: `import { randInt, rand, shuffle } from '../_shared/random.js'` (crypto 기반)
- CSS 클래스: `.tool .row .field .drop .status(.ok/.warn/.bad) .out .muted button(.ghost/.small) ul.files table.preview .guide details .cards .card`
- 이미 설치된 패키지: pdf-lib, three, fflate, qrcode-generator, jsqr, cfb, @shiguredo/rnnoise-wasm, mp4-muxer, occt-import-js, exceljs,
  heic-to(LGPL-3.0: `import()` 로 따로 불러 별도 파일로 두고 고치지 않는다), pdfjs-dist, @mediapipe/tasks-vision
- 새로 쓴 패키지는 `public/third-party-licenses.txt` 에 이름·버전·라이선스 전문을 더한다.

## 5. 원칙

1. **파일·입력은 네트워크로 보내지 않는다.** fetch 로 외부 API 를 부르지 않는다. 모든 처리는 브라우저 안에서.
   예외는 **받기만 하는** 정적 파일: AI 모델·wasm 을 `storage.googleapis.com`(MediaPipe), `huggingface.co`, `cdn.jsdelivr.net` 에서 받는 것.
   처음 받기 전에 크기를 알리고 진행률을 보여 준다. 사용자의 사진·소리·글은 어떤 경우에도 올리지 않는다.
   5MB 이하 모델은 `public/<slug>/models/` 에 넣어도 된다(저장소 파일 하나 50MB 넘기지 않기).
   MediaPipe 엔진 wasm 은 `public/mediapipe/<tasks-vision 버전>/` 하나를 같이 쓴다. 패키지를 올리면 새 버전 폴더를 만들고
   코드의 경로를 바꾼다(옛 폴더 이름을 재사용하면 방문자 캐시에 옛 엔진이 남는다).
   tasks-vision 은 Google 로 사용 통계를 보내므로(odml.pa.googleapis.com) 페이지 맨 위에서 막는다(remove-background·posture-alert 참고).
2. **추측 금지.** 법정 요율·공휴일·기준금리 같은 사실은 공식 출처(법령, 정부·공공기관 발표)로 확인한 값만 쓰고,
   글 안에 출처와 기준일을 적는다. 확인 못 한 값은 "확인 필요"로 적고 사용자가 직접 입력하게 한다.
   해마다 바뀌는 값은 `src/_shared/<slug>.js` 맨 위 상수 한곳에 모으고 기준일 주석을 단다.
3. **설명 글은 도구마다 다르게.** 사용법 / 이 도구만의 원리·기준 / 자주 묻는 질문 3개 이상.
   다른 도구의 문장을 복사하지 않는다. 설명 없는 도구는 광고 심사에서 떨어진다.
4. 브라우저가 지원하지 않는 기능(예: 모바일의 화면 녹화)은 기능 확인 후 친절한 안내 문구를 띄운다.
5. 휴대폰 화면(폭 360px)에서 가로로 넘치지 않게.
6. 존댓말. 과장("최고", "완벽") 금지.
7. 기기에 저장하는 키는 `<slug>:` 로 시작한다(다른 앱·도구와 같은 주소를 쓴다). meta.json 의 `storage` 에 적어 두면 맨 아래에 '기록 전체 삭제'가 붙는다.
   Cache Storage 는 서비스 워커가 만들고 지운다. 도구 코드에서 캐시를 따로 만들지 않는다(만들면 '기록 전체 삭제'가 지우지 못한다).
8. 누르는 곳(버튼·링크·접는 줄)은 높이 44px 이상. 공통 `button`·`button.small`·머리글 메뉴·자주 묻는 질문 줄은 이미 맞춰져 있으니 도구 스타일로 더 작게 줄이지 않는다.

## 6. 확인

```
npx vitest run test/<slug>.test.js
npx vite build --outDir /tmp/build-<이름> --emptyOutDir     # dist 를 여러 명이 동시에 쓰지 않게
```
