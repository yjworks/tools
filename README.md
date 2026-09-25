# DigitalBrain 도구 — https://dibrain.dev/tools/

설치·업로드 없이 브라우저 안에서만 처리하는 도구 모음. 파일은 서버로 보내지 않는다.

## 구조

```
src/
  index.html            도구 목록 (dibrain.dev/tools/)
  _shared/              공통 스타일(tool.css)·UI(ui.js)·도구별 로직(테스트 대상)
  <slug>/               도구 하나 = 폴더 하나 → dibrain.dev/tools/<slug>/
    meta.json           이름·제목·설명·검색어·그룹·순서·아이콘 글자·색
    index.html          도구 화면 + 설명 글. <!--HEAD--> 등 자리표시는 빌드 때 채워진다
    main.js             화면 동작
test/logic.test.js      로직 테스트 (vitest)
site.config.json        GA ID, AdSense(승인 전에는 빈 값), 주소
public/                 그대로 복사되는 파일 (오픈소스 라이선스 고지 등)
```

빌드(`vite.config.js`)가 하는 일: 공통 머리말(SEO 메타·구조화 데이터·GA)·머리글·바닥글·광고 자리 끼워 넣기,
`registry.json`(dibrain.dev 첫 화면이 읽는 도구 목록), `sitemap.xml`, 도구 아이콘 생성.

## 새 도구 추가

1. `src/<slug>/` 에 `meta.json`, `index.html`, `main.js` 를 만든다(기존 도구를 복사해서 시작).
2. 로직은 `src/_shared/` 에 따로 두고 `test/` 에 테스트를 붙인다.
3. `index.html` 에는 **사용법·원리·자주 묻는 질문**을 도구마다 다르게 쓴다. 설명 없는 도구 페이지는
   AdSense 에서 "가치가 낮은 콘텐츠"로 거절되기 쉽다.
4. 외부 라이브러리를 넣으면 라이선스를 `public/third-party-licenses.txt` 에 추가한다.

## 원칙

- 파일·입력한 글은 네트워크로 보내지 않는다. GA 이벤트에도 파일 이름·내용을 넣지 않는다.
- 광고는 도구와 설명 사이 한 곳(`<!--AD-->`)에만. 버튼 옆에 두지 않는다.
- 난수는 `crypto.getRandomValues`(src/_shared/random.js).

```
npm ci && npm test && npm run build   # dist/
npm run dev                           # http://localhost:5173/
```
