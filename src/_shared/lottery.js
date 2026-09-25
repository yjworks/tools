/* 제비뽑기·당첨자 뽑기. 난수는 random.js(암호학적 난수), 테스트에서는 바꿔 끼울 수 있다. */
import { randInt as cryptoRandInt } from './random.js';

/** 참가자: 줄바꿈·쉼표·탭으로 나눈다. 같은 이름을 여러 번 적으면 그만큼 뽑힐 확률이 커진다. */
export function parseNames(text) {
  return String(text || '').split(/[\n,，\t]+/).map((s) => s.trim()).filter(Boolean);
}

/** 경품: 한 줄에 하나. 끝에 "x3", "×3", "*3", "3개" 를 붙이면 그 수만큼. */
export function parsePrizes(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(.*?)\s*(?:[x×X*]\s*(\d{1,3})|(\d{1,3})\s*개)$/);
    const name = m && m[1].trim() ? m[1].trim() : s;
    const count = m && m[1].trim() ? Number(m[2] || m[3]) : 1;
    if (count > 0) out.push({ name, count });
  }
  return out;
}

/** 뽑을 자리 목록. 경품이 있으면 경품 수만큼(적은 순서대로), 없으면 count 개의 빈 자리. */
export function buildSlots(prizes, count) {
  if (prizes && prizes.length) return prizes.flatMap((p) => Array(p.count).fill(p.name));
  return Array(Math.max(0, Math.floor(count || 0))).fill(null);
}

/** 서로 다른 사람 수 (중복 당첨을 막을 때 최대 당첨자 수) */
export const distinctCount = (names) => new Set(names).size;

/**
 * 한 명씩 뽑는 추첨. 뽑을 때마다 남은 사람 중에서 새로 뽑는다.
 * allowDuplicate=false 이면 당첨된 이름은 (여러 번 적혔어도) 모두 빠진다.
 */
export function createDraw(names, { allowDuplicate = false } = {}, randInt = cryptoRandInt) {
  let pool = [...names];
  return {
    get remaining() { return allowDuplicate ? pool.length : distinctCount(pool); },
    next() {
      if (!pool.length) return null;
      const name = pool[randInt(pool.length)];
      if (!allowDuplicate) pool = pool.filter((x) => x !== name);
      return name;
    },
  };
}

/** 모든 자리를 한 번에 뽑는다. 사람이 모자라면 오류. */
export function drawAll(names, slots, { allowDuplicate = false } = {}, randInt = cryptoRandInt) {
  if (!names.length) throw new Error('참가자를 한 명 이상 적어 주세요.');
  if (!slots.length) throw new Error('당첨 개수를 1 이상으로 정해 주세요.');
  if (!allowDuplicate && slots.length > distinctCount(names)) {
    throw new Error(`당첨 자리(${slots.length})가 참가자(${distinctCount(names)}명)보다 많습니다. 중복 당첨을 허용하거나 자리를 줄여 주세요.`);
  }
  const d = createDraw(names, { allowDuplicate }, randInt);
  return slots.map((prize) => ({ prize, name: d.next() }));
}

/** 복사용 글 */
export function resultsText(results, when = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const lines = results.map((r, i) => `${i + 1}. ${r.prize ? `${r.prize} — ` : ''}${r.name}`);
  return `추첨 결과 (${stamp})\n${lines.join('\n')}`;
}
