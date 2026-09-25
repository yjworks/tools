# 도구 만들기 규격

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
  "group": "문서·텍스트 | 사진·이미지 | 오디오·영상 | 생활 계산 | 모임·놀이 | 3D 프린팅",
  "order": 100,
  "iconText": "아이콘에 들어갈 1~3글자",
  "color": "#hex (배경색, 흰 글씨가 잘 보이는 진한 색)",
  "category": "UtilitiesApplication | GameApplication | MultimediaApplication | FinanceApplication"
}
```

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
- 이미 설치된 패키지: pdf-lib, three, fflate, qrcode-generator, jsqr, cfb, @shiguredo/rnnoise-wasm, mp4-muxer, occt-import-js, exceljs

## 5. 원칙

1. **파일·입력은 네트워크로 보내지 않는다.** fetch 로 외부 API 를 부르지 않는다. 모든 처리는 브라우저 안에서.
2. **추측 금지.** 법정 요율·공휴일·기준금리 같은 사실은 공식 출처(법령, 정부·공공기관 발표)로 확인한 값만 쓰고,
   글 안에 출처와 기준일을 적는다. 확인 못 한 값은 "확인 필요"로 적고 사용자가 직접 입력하게 한다.
   해마다 바뀌는 값은 `src/_shared/<slug>.js` 맨 위 상수 한곳에 모으고 기준일 주석을 단다.
3. **설명 글은 도구마다 다르게.** 사용법 / 이 도구만의 원리·기준 / 자주 묻는 질문 3개 이상.
   다른 도구의 문장을 복사하지 않는다. 설명 없는 도구는 광고 심사에서 떨어진다.
4. 브라우저가 지원하지 않는 기능(예: 모바일의 화면 녹화)은 기능 확인 후 친절한 안내 문구를 띄운다.
5. 휴대폰 화면(폭 360px)에서 가로로 넘치지 않게.
6. 존댓말. 과장("최고", "완벽") 금지.

## 6. 확인

```
npx vitest run test/<slug>.test.js
npx vite build --outDir /tmp/build-<이름> --emptyOutDir     # dist 를 여러 명이 동시에 쓰지 않게
```
