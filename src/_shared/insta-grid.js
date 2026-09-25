/* 인스타 그리드 분할 계산.
   사진 한 장을 cols×rows 조각으로 나눈다. 조각 비율(tileRatio = 가로/세로)을 정하면
   전체 격자 비율(cols·tileRatio : rows)에 맞게 사진 가운데를 먼저 잘라 낸다.
   인스타그램 프로필은 최신 게시물이 왼쪽 위에 오므로, 오른쪽 아래 조각부터 올려야 한다. */

/** 사진 w×h 에서 비율 ratio(가로/세로) 로 잘라 낼 영역. focusX/Y(0~1)는 남길 위치(0.5 = 가운데). */
export function cropToRatio(w, h, ratio, focusX = 0.5, focusY = 0.5) {
  if (!ratio) return { x: 0, y: 0, w, h };
  let cw = w, ch = w / ratio;
  if (ch > h) { ch = h; cw = h * ratio; }
  cw = Math.round(cw); ch = Math.round(ch);
  return { x: Math.round((w - cw) * focusX), y: Math.round((h - ch) * focusY), w: cw, h: ch };
}

/** 조각 목록. 각 조각 {row, col, x, y, w, h, order}. order 는 올리는 순서(1 = 가장 먼저). 조각 한 변은 maxTile 이하. */
export function gridTiles(imgW, imgH, { cols = 3, rows = 1, tileRatio = 0, focusX = 0.5, focusY = 0.5, maxTile = 1080 } = {}) {
  const gridRatio = tileRatio ? (cols * tileRatio) / rows : 0;
  const area = cropToRatio(imgW, imgH, gridRatio, focusX, focusY);
  const tw = area.w / cols, th = area.h / rows;
  // 출력 조각 크기: 원본 해상도를 넘지 않게, 가로는 maxTile 까지
  const scale = Math.min(1, maxTile / tw);
  const outW = Math.max(1, Math.round(tw * scale)), outH = Math.max(1, Math.round(th * scale));
  const total = cols * rows, tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(area.x + c * tw), x1 = Math.round(area.x + (c + 1) * tw);
      const y0 = Math.round(area.y + r * th), y1 = Math.round(area.y + (r + 1) * th);
      tiles.push({ row: r + 1, col: c + 1, x: x0, y: y0, w: x1 - x0, h: y1 - y0, outW, outH, order: postOrder(r, c, cols, rows) });
    }
  }
  return { area, tiles, total };
}

/** 올리는 순서: 오른쪽 아래(마지막 조각)가 1번, 왼쪽 위가 total 번. */
export function postOrder(r, c, cols, rows) {
  return cols * rows - (r * cols + c);
}

/** 파일 이름: 올리는 순서 두 자리 + 위치. 예) 01_3행3열.jpg */
export function tileName(t, ext = 'jpg') {
  return `${String(t.order).padStart(2, '0')}_${t.row}행${t.col}열.${ext}`;
}
