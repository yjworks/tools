/* 사진 콜라주 배치 계산.
   배치는 cols×rows 격자 위의 칸 목록(c, r, cs=가로 칸 수, rs=세로 칸 수)으로 적는다.
   간격(gap)은 바깥 테두리와 사진 사이 모두 같은 폭으로 둔다. */

const g = (cols, rows, cells) => ({ cols, rows, cells: cells.map(([c, r, cs = 1, rs = 1]) => ({ c, r, cs, rs })) });
const grid = (cols, rows) => g(cols, rows, Array.from({ length: cols * rows }, (_, i) => [i % cols, Math.floor(i / cols)]));

/** 배치 목록. id → {name, n, make(W,H) → 격자} */
export const LAYOUTS = [
  { id: '2h', name: '2장 가로로 나란히', n: 2, make: () => grid(2, 1) },
  { id: '2v', name: '2장 위아래', n: 2, make: () => grid(1, 2) },
  { id: '3big', name: '3장 (큰 사진 1 + 2)', n: 3, make: () => g(2, 2, [[0, 0, 1, 2], [1, 0], [1, 1]]) },
  { id: '3top', name: '3장 (위 1 + 아래 2)', n: 3, make: () => g(2, 2, [[0, 0, 2, 1], [0, 1], [1, 1]]) },
  { id: '3row', name: '3장 한 줄', n: 3, make: (W, H) => (W >= H ? grid(3, 1) : grid(1, 3)) },
  { id: '4', name: '4장 격자', n: 4, make: () => grid(2, 2) },
  { id: '4big', name: '4장 (큰 사진 1 + 3)', n: 4, make: () => g(3, 3, [[0, 0, 3, 2], [0, 2], [1, 2], [2, 2]]) },
  { id: '5', name: '5장 (위 2 + 아래 3)', n: 5, make: () => g(6, 2, [[0, 0, 3], [3, 0, 3], [0, 1, 2], [2, 1, 2], [4, 1, 2]]) },
  { id: '6', name: '6장 격자', n: 6, make: (W, H) => (W >= H ? grid(3, 2) : grid(2, 3)) },
  { id: '7', name: '7장 (2 + 2 + 3)', n: 7, make: () => g(6, 3, [[0, 0, 3], [3, 0, 3], [0, 1, 3], [3, 1, 3], [0, 2, 2], [2, 2, 2], [4, 2, 2]]) },
  { id: '8', name: '8장 (3 + 2 + 3)', n: 8, make: () => g(6, 3, [[0, 0, 2], [2, 0, 2], [4, 0, 2], [0, 1, 3], [3, 1, 3], [0, 2, 2], [2, 2, 2], [4, 2, 2]]) },
  { id: '9', name: '9장 격자', n: 9, make: () => grid(3, 3) },
];

export const SIZES = {
  square: { w: 1080, h: 1080, name: '정사각 1080×1080' },
  portrait: { w: 1080, h: 1350, name: '세로 1080×1350 (4:5)' },
  wide: { w: 1920, h: 1080, name: '가로 1920×1080 (16:9)' },
};

/** 사진 수에 맞는 배치들 */
export function layoutsFor(n) { return LAYOUTS.filter((l) => l.n === n); }

/** 격자 + 출력 크기 + 간격 → 칸마다 픽셀 사각형 {x, y, w, h} (정수, 겹치지 않음) */
export function cellRects(layout, W, H, gap = 0) {
  const { cols, rows, cells } = layout;
  const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
  if (cw <= 0 || ch <= 0) throw new Error('간격이 너무 넓습니다');
  const X = (c) => Math.round(gap + c * (cw + gap)), Y = (r) => Math.round(gap + r * (ch + gap));
  return cells.map(({ c, r, cs, rs }) => {
    const x = X(c), y = Y(r);
    return { x, y, w: Math.round(X(c + cs) - gap) - x, h: Math.round(Y(r + rs) - gap) - y };
  });
}

/** 꽉 채우기(cover): 사진 sw×sh 에서 칸 비율에 맞게 잘라 낼 원본 영역 {sx, sy, sw, sh}. 가운데 기준. */
export function coverCrop(sw, sh, dw, dh, fx = 0.5, fy = 0.5) {
  const s = Math.max(dw / sw, dh / sh);
  const cw = dw / s, ch = dh / s;
  return { sx: (sw - cw) * fx, sy: (sh - ch) * fy, sw: cw, sh: ch };
}
