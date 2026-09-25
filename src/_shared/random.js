/* 공정한 난수: Math.random 대신 브라우저의 암호학적 난수를 쓴다. */
export function randInt(n) {
  if (n <= 0) return 0;
  const lim = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= lim);
  return b[0] % n;
}
export const rand = () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 0x100000000; };
export function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
