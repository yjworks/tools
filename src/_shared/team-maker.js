/* 조 편성: 인원을 고르게 나누고, "같은 조 안 됨" 조건과 조장(고정 리더)을 지킨다.
   난수는 random.js(암호학적 난수)를 쓰고, 테스트에서는 바꿔 끼울 수 있게 인자로 받는다. */
import { randInt as cryptoRandInt, shuffle as cryptoShuffle } from './random.js';

const DEFAULT_RNG = { randInt: cryptoRandInt, shuffle: cryptoShuffle };
const MAX_STEPS = 200_000;

/** 이름 목록: 줄바꿈·쉼표·탭으로 나눈다. */
export function parseNames(text) {
  return String(text || '').split(/[\n,，\t]+/).map((s) => s.trim()).filter(Boolean);
}

/** "같은 조 안 됨" 목록: 한 줄에 쉼표(또는 /)로 2명 이상. 한 줄 안의 사람들은 서로 모두 다른 조. */
export function parseGroups(text) {
  return String(text || '').split('\n')
    .map((line) => line.split(/[,，/]+/).map((s) => s.trim()).filter(Boolean))
    .filter((g) => g.length >= 2);
}

/** 조 크기: 차이가 1을 넘지 않게. { teams } 또는 { perTeam } 중 하나. */
export function teamSizes(n, { teams, perTeam } = {}) {
  let t = teams ? Math.floor(teams) : Math.ceil(n / Math.max(1, Math.floor(perTeam || 1)));
  t = Math.max(1, Math.min(t, n));
  const base = Math.floor(n / t), extra = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * 조 편성.
 * @param {string[]} names 참가자
 * @param {{teams?:number, perTeam?:number, avoid?:string[][], leaders?:string[]}} opt
 * @returns {{ok:boolean, teams:{leader:string|null, members:string[]}[], reason?:string, proven?:boolean,
 *            violations:[string,string][], warnings:string[]}}
 *   ok=false 이고 teams 가 비어 있으면 편성 자체가 불가능(입력 오류). teams 가 있으면 조건 일부를 못 지킨 편성.
 */
export function makeTeams(names, opt = {}, rng = DEFAULT_RNG) {
  const warnings = [];
  const n = names.length;
  const fail = (reason) => ({ ok: false, teams: [], reason, violations: [], warnings });
  if (n < 2) return fail('참가자를 2명 이상 적어 주세요.');
  if (opt.teams != null && !(opt.teams >= 1)) return fail('조 개수를 1 이상으로 적어 주세요.');
  if (opt.teams == null && !(opt.perTeam >= 1)) return fail('조당 인원을 1 이상으로 적어 주세요.');
  if (opt.teams > n) warnings.push(`조 개수(${opt.teams})가 인원(${n}명)보다 많아 ${n}개 조로 나눴습니다.`);

  const sizes = rng.shuffle(teamSizes(n, opt));  // 어느 조가 한 명 더 받는지도 무작위
  const T = sizes.length;

  const idx = new Map();
  names.forEach((nm, i) => { if (!idx.has(nm)) idx.set(nm, []); idx.get(nm).push(i); });
  const dup = [...idx].filter(([, v]) => v.length > 1).map(([k]) => k);
  if (dup.length) warnings.push(`같은 이름이 있습니다: ${dup.join(', ')}. 서로 다른 사람이면 구분되게 적어 주세요.`);

  // 조장: 조마다 한 명씩 먼저 앉힌다
  const leaderOf = Array(T).fill(-1);
  const team = Array(n).fill(-1);
  const leaders = [];
  const used = new Set();
  for (const nm of opt.leaders || []) {
    const i = (idx.get(nm) || []).find((k) => !used.has(k));
    if (i == null) { warnings.push(`조장 "${nm}"은(는) 참가자 목록에 없어 뺐습니다.`); continue; }
    used.add(i); leaders.push(i);
  }
  if (leaders.length > T) return fail(`조장(${leaders.length}명)이 조 개수(${T}개)보다 많습니다. 조장을 줄이거나 조를 늘려 주세요.`);
  rng.shuffle(leaders).forEach((i, t) => { leaderOf[t] = i; team[i] = t; });

  // 충돌 관계
  const conflict = Array.from({ length: n }, () => new Set());
  let reason = null;
  for (const g of opt.avoid || []) {
    const people = [];
    for (const nm of g) {
      const list = idx.get(nm);
      if (!list) { warnings.push(`"${nm}"은(는) 참가자 목록에 없어 조건에서 뺐습니다.`); continue; }
      for (const i of list) if (!people.includes(i)) people.push(i);
    }
    for (let a = 0; a < people.length; a++) for (let b = a + 1; b < people.length; b++) {
      conflict[people[a]].add(people[b]); conflict[people[b]].add(people[a]);
    }
    if (people.length > T && !reason) reason = `${g.join(', ')} — ${people.length}명을 모두 다른 조에 넣으려면 조가 ${people.length}개 이상 필요합니다(지금 ${T}개).`;
  }
  const members = Array.from({ length: T }, (_, t) => (leaderOf[t] >= 0 ? [leaderOf[t]] : []));
  // 조장끼리는 이미 서로 다른 조라 충돌이 없다. 나머지를 조건이 많은 사람부터 배치
  const rest = rng.shuffle([...Array(n).keys()].filter((i) => team[i] < 0))
    .map((i, k) => [i, k]).sort((x, y) => conflict[y[0]].size - conflict[x[0]].size || x[1] - y[1]).map(([i]) => i);

  const hasConflicts = conflict.some((s) => s.size);
  let solved = false, proven = false;
  if (!reason) {
    const r = backtrack(rest, members, sizes, leaderOf, conflict, team, rng);
    solved = r.solved; proven = !r.solved && r.exhausted;
    if (!solved) reason = proven
      ? '조건을 모두 지키는 편성이 없습니다. 조를 늘리거나 조건을 줄여 주세요.'
      : '조건을 모두 지키는 편성을 찾지 못했습니다. 조를 늘리거나 조건을 줄여 보세요.';
  } else proven = true;

  if (!solved) greedy(rest, members, sizes, conflict, team, rng);

  const violations = [];
  if (hasConflicts) for (let a = 0; a < n; a++) for (const b of conflict[a]) if (a < b && team[a] === team[b]) violations.push([names[a], names[b]]);

  const teams = members.map((list, t) => {
    const lead = leaderOf[t] >= 0 ? leaderOf[t] : null;
    const others = rng.shuffle(list.filter((i) => i !== lead));
    return { leader: lead == null ? null : names[lead], members: (lead == null ? others : [lead, ...others]).map((i) => names[i]) };
  });
  const ok = violations.length === 0;
  return { ok, teams, reason: ok ? undefined : reason || '일부 조건을 지키지 못했습니다.', proven: ok ? undefined : proven, violations, warnings };
}

function backtrack(order, members, sizes, leaderOf, conflict, team, rng) {
  let steps = 0, exhausted = true;
  const T = sizes.length;
  const place = (k) => {
    if (k === order.length) return true;
    if (++steps > MAX_STEPS) { exhausted = false; return false; }
    const p = order[k];
    const triedEmpty = new Set();
    for (const t of rng.shuffle([...Array(T).keys()])) {
      if (members[t].length >= sizes[t]) continue;
      // 비어 있고 조장도 없는 조는 크기가 같으면 서로 바꿔도 같으므로 한 번만 시도
      if (members[t].length === 0 && leaderOf[t] < 0) { if (triedEmpty.has(sizes[t])) continue; triedEmpty.add(sizes[t]); }
      if (members[t].some((q) => conflict[p].has(q))) continue;
      members[t].push(p); team[p] = t;
      if (place(k + 1)) return true;
      members[t].pop(); team[p] = -1;
      if (!exhausted) return false;
    }
    return false;
  };
  const solved = place(0);
  return { solved, exhausted };
}

/* 조건을 다 못 지킬 때: 충돌이 가장 적은 조에 차례로 넣는다(크기 균형은 지킨다). */
function greedy(order, members, sizes, conflict, team, rng) {
  for (const t of members.keys()) members[t] = members[t].filter((i) => team[i] >= 0 && !order.includes(i));
  for (const p of order) team[p] = -1;
  for (const p of order) {
    let best = [], bestC = Infinity;
    for (let t = 0; t < sizes.length; t++) {
      if (members[t].length >= sizes[t]) continue;
      const c = members[t].filter((q) => conflict[p].has(q)).length;
      if (c < bestC) { bestC = c; best = [t]; } else if (c === bestC) best.push(t);
    }
    const t = best[rng.randInt(best.length)];
    members[t].push(p); team[p] = t;
  }
}

/** 복사용 글 */
export function teamsText(teams) {
  return teams.map((t, i) => `${i + 1}조 (${t.members.length}명): ${t.members.map((m) => (m === t.leader ? `${m}(조장)` : m)).join(', ')}`).join('\n');
}
