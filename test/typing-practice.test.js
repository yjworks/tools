import { describe, it, expect } from 'vitest';
import {
  keysOf, strokeCount, compareTyped, netStrokes, errorKey, speed, accuracy, normalizeText, splitLines,
  nextKey, keyLabel, keyFromCode, drillMatch, drillLine, levelKeys, addTries, addError, errorRate, worstKeys,
  makeRecord, bestOf, physicalKey, FINGER,
} from '../src/_shared/typing-practice.js';

describe('타수 세기 (두벌식)', () => {
  it('기본 자모는 1타', () => {
    expect(keysOf('한')).toBe('gks');
    expect(strokeCount('한')).toBe(3);
    expect(strokeCount('한글')).toBe(6); // ㅎㅏㄴ ㄱㅡㄹ
    expect(strokeCount('가')).toBe(2);
  });
  it('쌍자음은 Shift 까지 2타', () => {
    expect(keysOf('까')).toBe('Rk');
    expect(strokeCount('까')).toBe(3);
    expect(strokeCount('빵')).toBe(4); // Shift+ㅂ ㅏ ㅇ
    expect(strokeCount('있')).toBe(4); // ㅇ ㅣ Shift+ㅅ
    expect(strokeCount('닭')).toBe(4); // ㄷ ㅏ ㄹ ㄱ
  });
  it('겹모음·ㅒㅖ', () => {
    expect(strokeCount('와')).toBe(3); // ㅇ ㅗ ㅏ
    expect(strokeCount('왔')).toBe(5); // ㅇ ㅗ ㅏ Shift+ㅅ
    expect(strokeCount('얘')).toBe(3); // ㅇ Shift+ㅐ
    expect(strokeCount('뭘')).toBe(4); // ㅁ ㅜ ㅓ ㄹ
    expect(strokeCount('의')).toBe(3);
  });
  it('띄어쓰기·부호·영문', () => {
    expect(strokeCount('안녕 하세요.')).toBe(3 + 3 + 1 + 2 + 2 + 2 + 1);
    expect(strokeCount('?')).toBe(2);
    expect(strokeCount('Hi!')).toBe(2 + 1 + 2);
  });
  it('홀로 선 자모', () => {
    expect(strokeCount('ㄲ')).toBe(2);
    expect(strokeCount('ㅘ')).toBe(2);
  });
});

describe('친 글 비교와 조합 중 글자', () => {
  it('영문: 글자마다 맞음/틀림', () => {
    const c = compareTyped('cat', 'cot');
    expect(c.status).toEqual(['ok', 'bad', 'ok']);
    expect(c.ok).toBe(2);
    expect(c.bad).toBe(1);
  });
  it('조합 중인 한글은 틀림으로 치지 않는다', () => {
    expect(compareTyped('한글', '하').status).toEqual(['pending', 'todo']);
    expect(compareTyped('하나', '한').status).toEqual(['pending', 'todo']); // gks 는 gksk 의 앞부분
    expect(compareTyped('한글', '한그').status).toEqual(['ok', 'pending']);
    expect(compareTyped('한글', '핫').status).toEqual(['bad', 'todo']);
  });
  it('끝난 줄(final)은 조합 중 예외 없이 비교', () => {
    expect(compareTyped('한글', '한그', { final: true }).status).toEqual(['ok', 'bad']);
  });
  it('더 친 글자', () => {
    expect(compareTyped('ab', 'abcd').extra).toBe(2);
  });
  it('순 타수: 맞은 글자 + 조합 중 부분', () => {
    expect(netStrokes('한글', '한그')).toBe(3 + 2);
    expect(netStrokes('한글', '핫')).toBe(0);
    expect(netStrokes('까치', '까치')).toBe(3 + 2);
  });
  it('다음 누를 키', () => {
    expect(nextKey('한글', '')).toEqual({ key: 'g', shift: false });
    expect(nextKey('한글', '하')).toEqual({ key: 's', shift: false });
    expect(nextKey('한글', '한')).toEqual({ key: 'r', shift: false });
    expect(nextKey('까', '')).toEqual({ key: 'r', shift: true });
    expect(nextKey('ab', 'x')).toEqual({ key: 'backspace', shift: false });
    expect(nextKey('a b', 'a')).toEqual({ key: 'space', shift: false });
    expect(nextKey('ab', 'ab')).toBe(null);
  });
});

describe('오타 키', () => {
  it('처음 달라진 키를 눌렀어야 할 키로 본다', () => {
    expect(errorKey('한', '핫')).toBe('s'); // ㄴ 대신 ㅅ
    expect(errorKey('까', '가')).toBe('r'); // Shift 빠짐 → ㄱ 키
    expect(errorKey('a', 's')).toBe('a');
    expect(errorKey(' ', 'x')).toBe('space');
    expect(errorKey('A', 'a')).toBe('a');
  });
  it('오타 지도 비율', () => {
    const m = { tries: {}, errs: {} };
    addTries(m, 'aaaa');
    addTries(m, '한');
    addError(m, 'a');
    expect(m.tries.a).toBe(4);
    expect(m.tries.g).toBe(1);
    expect(errorRate(m, 'a')).toBe(0.25);
    expect(errorRate(m, 'g')).toBe(null); // 3번 미만
    expect(worstKeys(m)).toEqual([{ key: 'a', errs: 1, tries: 4, rate: 0.25 }]);
  });
});

describe('속도·정확도', () => {
  it('1분에 300타', () => {
    expect(speed({ strokes: 300, chars: 100, ms: 60000 })).toEqual({ kpm: 300, cpm: 100, wpm: 20 });
  });
  it('30초에 125글자 = 250 CPM = 50 WPM', () => {
    expect(speed({ strokes: 125, chars: 125, ms: 30000 })).toEqual({ kpm: 250, cpm: 250, wpm: 50 });
  });
  it('시간 0', () => {
    expect(speed({ strokes: 10, chars: 10, ms: 0 })).toEqual({ kpm: 0, cpm: 0, wpm: 0 });
  });
  it('정확도는 고친 오타도 센다', () => {
    expect(accuracy(200, 3)).toBe(98.5);
    expect(accuracy(0, 0)).toBe(100);
    expect(accuracy(3, 5)).toBe(0);
  });
});

describe('글 다듬기·줄 나누기', () => {
  it('굽은 따옴표·줄표·말줄임표', () => {
    expect(normalizeText('“Hi,” she said — ‘yes’…')).toBe('"Hi," she said - \'yes\'...');
    expect(normalizeText('  a  b \n c ')).toBe('a b\nc');
  });
  it('긴 줄은 띄어쓰기에서 자른다', () => {
    expect(splitLines('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(splitLines('가나 다라\n마바', 40)).toEqual(['가나 다라', '마바']);
  });
});

describe('자판', () => {
  it('키 이름과 글자', () => {
    expect(keyLabel('q', 'ko')).toEqual({ main: 'ㅂ', shift: 'ㅃ' });
    expect(keyLabel('a', 'ko')).toEqual({ main: 'ㅁ', shift: '' });
    expect(keyLabel('o', 'ko')).toEqual({ main: 'ㅐ', shift: 'ㅒ' });
    expect(keyLabel('a', 'en')).toEqual({ main: 'A', shift: '' });
    expect(keyLabel('1', 'en')).toEqual({ main: '1', shift: '!' });
    expect(keyFromCode('KeyQ')).toBe('q');
    expect(keyFromCode('Digit7')).toBe('7');
    expect(keyFromCode('Semicolon')).toBe(';');
    expect(keyFromCode('ShiftLeft')).toBe(null);
  });
  it('손가락', () => {
    expect(FINGER.f).toBe('L4');
    expect(FINGER.j).toBe('R4');
    expect(FINGER[';']).toBe('R1');
    expect(FINGER.space).toBe('T');
  });
  it('자리 연습 판정', () => {
    expect(drillMatch('q', 'q', false)).toBe(true);
    expect(drillMatch('Q', 'q', false)).toBe(false);
    expect(drillMatch('Q', 'q', true)).toBe(true);
    expect(drillMatch(';', ';', false)).toBe(true);
    expect(physicalKey('?')).toEqual({ key: '/', shift: true });
  });
  it('자리 연습 문제는 그 단계 키만 쓴다', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const line = drillLine(0, rnd, 8);
    expect(line.split(' ')).toHaveLength(8);
    expect(/^[asdfjkl; ]+$/.test(line)).toBe(true);
    expect(levelKeys(1).fresh).toEqual(['g', 'h']);
    expect(levelKeys(1).all).toContain('a');
  });
});

describe('기록', () => {
  it('한 판 기록과 최고 기록', () => {
    const a = makeRecord({ mode: 'short', lang: 'ko', strokes: 300, chars: 100, typed: 100, errors: 2, ms: 60000, at: 1 });
    expect(a).toMatchObject({ kpm: 300, acc: 98, sec: 60 });
    const b = makeRecord({ mode: 'short', lang: 'ko', strokes: 400, chars: 130, typed: 130, errors: 30, ms: 60000, at: 2 }); // 정확도 76.9% → 제외
    const c = makeRecord({ mode: 'short', lang: 'ko', strokes: 350, chars: 120, typed: 120, errors: 1, ms: 60000, at: 3 });
    expect(bestOf([a, b, c], 'short', 'ko').at).toBe(3);
    expect(bestOf([a, b, c], 'long', 'ko')).toBe(null);
  });
});
