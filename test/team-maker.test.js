import { describe, it, expect } from 'vitest';
import { parseNames, parseGroups, teamSizes, makeTeams, teamsText } from '../src/_shared/team-maker.js';

const people = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const flat = (teams) => teams.flatMap((t) => t.members);
const spread = (teams) => { const s = teams.map((t) => t.members.length); return Math.max(...s) - Math.min(...s); };
const sameTeam = (teams, a, b) => teams.some((t) => t.members.includes(a) && t.members.includes(b));

describe('조 편성 — 입력', () => {
  it('이름 나누기', () => {
    expect(parseNames('철수\n영희, 민수\t지은\n\n ')).toEqual(['철수', '영희', '민수', '지은']);
    expect(parseGroups('철수, 영희\n민수\n지은/현우/서연')).toEqual([['철수', '영희'], ['지은', '현우', '서연']]);
  });
  it('조 크기 (차이 1 이하)', () => {
    expect(teamSizes(10, { teams: 3 })).toEqual([4, 3, 3]);
    expect(teamSizes(10, { perTeam: 4 })).toEqual([4, 3, 3]);
    expect(teamSizes(12, { perTeam: 4 })).toEqual([4, 4, 4]);
    expect(teamSizes(13, { perTeam: 4 })).toEqual([4, 3, 3, 3]);
    expect(teamSizes(5, { teams: 8 })).toEqual([1, 1, 1, 1, 1]);
    expect(teamSizes(7, { perTeam: 1 })).toHaveLength(7);
  });
});

describe('조 편성 — 균형', () => {
  for (const [n, opt] of [[10, { teams: 3 }], [23, { teams: 4 }], [23, { perTeam: 5 }], [2, { teams: 2 }], [31, { perTeam: 6 }], [50, { teams: 7 }]]) {
    it(`${n}명 ${JSON.stringify(opt)}`, () => {
      for (let k = 0; k < 20; k++) {
        const r = makeTeams(people(n), opt);
        expect(r.ok).toBe(true);
        expect(flat(r.teams).sort()).toEqual(people(n).sort());
        expect(spread(r.teams)).toBeLessThanOrEqual(1);
      }
    });
  }
  it('조당 인원 모드의 조 개수', () => {
    expect(makeTeams(people(10), { perTeam: 4 }).teams).toHaveLength(3);
    expect(makeTeams(people(9), { perTeam: 3 }).teams).toHaveLength(3);
  });
});

describe('조 편성 — 조건', () => {
  it('같은 조 안 됨 조건을 지킨다', () => {
    const names = people(12);
    const avoid = [['P1', 'P2'], ['P1', 'P3'], ['P2', 'P3'], ['P4', 'P5', 'P6', 'P7'], ['P8', 'P9']];
    for (let k = 0; k < 50; k++) {
      const r = makeTeams(names, { teams: 4, avoid });
      expect(r.ok).toBe(true);
      expect(r.violations).toEqual([]);
      for (const g of avoid) for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) expect(sameTeam(r.teams, g[a], g[b])).toBe(false);
      expect(spread(r.teams)).toBeLessThanOrEqual(1);
    }
  });
  it('빡빡하지만 가능한 조건 (2조, 두 무리로 딱 나뉨)', () => {
    // P1~P3 끼리, P4~P6 끼리 안 됨 → 각 조에 한 무리에서 한 명씩... 3명 무리 2개, 2조면 불가능
    const bad = makeTeams(people(6), { teams: 2, avoid: [['P1', 'P2', 'P3']] });
    expect(bad.ok).toBe(false);
    expect(bad.proven).toBe(true);
    expect(bad.reason).toMatch(/3개 이상/);
    expect(bad.teams).toHaveLength(2);            // 조건 일부를 못 지킨 편성은 보여 준다
    expect(spread(bad.teams)).toBeLessThanOrEqual(1);
    expect(bad.violations.length).toBeGreaterThan(0);
    // 3조면 가능
    const good = makeTeams(people(6), { teams: 3, avoid: [['P1', 'P2', 'P3'], ['P4', 'P5', 'P6']] });
    expect(good.ok).toBe(true);
  });
  it('조합으로만 드러나는 불가능 (삼각형 셋, 조 3개인데 인원 3명씩이면 가능 / 2조면 불가능)', () => {
    const avoid = [['P1', 'P2'], ['P2', 'P3'], ['P1', 'P3']];
    const r = makeTeams(people(4), { teams: 2, avoid });
    expect(r.ok).toBe(false);
    expect(r.proven).toBe(true);
  });
  it('크기 제약 때문에 불가능: 4명 2조(2+2)인데 P1이 P2·P3·P4 모두와 안 됨', () => {
    const r = makeTeams(people(4), { teams: 2, avoid: [['P1', 'P2'], ['P1', 'P3'], ['P1', 'P4']] });
    expect(r.ok).toBe(false);
    expect(r.proven).toBe(true);
    expect(r.reason).toMatch(/없습니다/);
  });
  it('조장은 조마다 한 명, 맨 앞', () => {
    for (let k = 0; k < 30; k++) {
      const r = makeTeams(people(15), { teams: 3, leaders: ['P1', 'P2', 'P3'], avoid: [['P1', 'P4'], ['P2', 'P4']] });
      expect(r.ok).toBe(true);
      expect(r.teams.map((t) => t.leader).sort()).toEqual(['P1', 'P2', 'P3']);
      for (const t of r.teams) expect(t.members[0]).toBe(t.leader);
      expect(sameTeam(r.teams, 'P1', 'P4') || sameTeam(r.teams, 'P2', 'P4')).toBe(false);
    }
  });
  it('조장이 조보다 많으면 편성하지 않는다', () => {
    const r = makeTeams(people(6), { teams: 2, leaders: ['P1', 'P2', 'P3'] });
    expect(r.ok).toBe(false);
    expect(r.teams).toEqual([]);
  });
  it('목록에 없는 이름·같은 이름은 알려 준다', () => {
    const r = makeTeams(['가', '나', '다', '다'], { teams: 2, avoid: [['가', '없음']], leaders: ['모름'] });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/없음/);
    expect(r.warnings.join(' ')).toMatch(/모름/);
    expect(r.warnings.join(' ')).toMatch(/같은 이름/);
  });
  it('인원이 너무 적으면 오류', () => {
    expect(makeTeams(['혼자'], { teams: 2 }).ok).toBe(false);
  });
  it('복사용 글', () => {
    expect(teamsText([{ leader: 'A', members: ['A', 'B'] }, { leader: null, members: ['C'] }])).toBe('1조 (2명): A(조장), B\n2조 (1명): C');
  });
  it('고정 난수로 재현 가능', () => {
    const rng = { randInt: () => 0, shuffle: (a) => [...a] };
    const r = makeTeams(people(5), { teams: 2 }, rng);
    expect(r.teams.map((t) => t.members.length)).toEqual([3, 2]);
  });
});
