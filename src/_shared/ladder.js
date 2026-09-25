import { randInt } from './random.js';

/** 사다리 만들기: rungs[level][gap] = true 면 gap 번째 세로줄과 그 오른쪽 줄 사이에 가로줄.
    같은 높이에서 가로줄이 붙어 있으면 길이 갈라지므로 이웃한 칸에는 놓지 않는다. 모든 칸에 한 줄 이상. */
export function makeLadder(cols, levels, rnd = randInt) {
  const gaps = cols - 1;
  const rungs = Array.from({ length: levels }, () => Array(gaps).fill(false));
  for (let l = 0; l < levels; l++) {
    for (let g = 0; g < gaps; g++) {
      if (g > 0 && rungs[l][g - 1]) continue;
      if (rnd(100) < 45) rungs[l][g] = true;
    }
  }
  // 가로줄이 없는 칸이 있으면 임의의 높이에 놓고, 붙어 버린 이웃 칸의 줄은 지운다. 모든 칸이 찰 때까지 반복.
  for (let pass = 0; pass < 100; pass++) {
    const empty = [];
    for (let g = 0; g < gaps; g++) if (!rungs.some((r) => r[g])) empty.push(g);
    if (!empty.length) break;
    const g = empty[rnd(empty.length)], l = rnd(levels);
    rungs[l][g] = true;
    if (g > 0) rungs[l][g - 1] = false;
    if (g < gaps - 1) rungs[l][g + 1] = false;
  }
  return rungs;
}

/** start 세로줄에서 내려가며 지나는 [열, 높이] 목록과 도착 열 */
export function trace(rungs, start) {
  let c = start; const path = [[c, -1]];
  rungs.forEach((row, l) => {
    if (c > 0 && row[c - 1]) { path.push([c, l], [c - 1, l]); c--; }
    else if (row[c]) { path.push([c, l], [c + 1, l]); c++; }
  });
  path.push([c, rungs.length]);
  return { end: c, path };
}
