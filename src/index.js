import './_shared/tool.css';

/* 도구 찾기: 이름·설명에 검색어가 들어간 카드만 남기고, 빈 분류와 그 바로가기 칩은 숨긴다.
   규칙은 dibrain.dev 첫 화면(블로그 저장소 hub/index.html)의 도구 찾기와 같다(띄어쓰기·대소문자 무시). */
const input = document.getElementById('tool-search');
const empty = document.getElementById('tool-empty');
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

function filter() {
  const q = norm(input.value || '');
  let shown = 0;
  for (const sec of document.querySelectorAll('section.group')) {
    let n = 0;
    for (const card of sec.querySelectorAll('.card')) {
      const hit = !q || norm(card.textContent).includes(q);
      card.hidden = !hit;
      if (hit) n++;
    }
    sec.hidden = n === 0;
    const chip = document.querySelector(`.chips a[href="#${sec.id}"]`);
    if (chip) chip.parentElement.hidden = n === 0;
    shown += n;
  }
  empty.hidden = shown > 0;
}

if (input) {
  input.addEventListener('input', filter);
  addEventListener('pageshow', filter);   // 뒤로 가기로 돌아왔을 때 브라우저가 채워 둔 검색어에 맞춘다
  filter();
}
