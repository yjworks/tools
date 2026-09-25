import { describe, it, expect } from 'vitest';
import { romanizeName, romanizeSyllables, cleanName } from '../src/_shared/name-romanize.js';

const r = (n, o) => romanizeName(n, o);

describe('이름 로마자 — 고시 예시', () => {
  it('한복남 Han Boknam (Han Bok-nam)', () => { const x = r('한복남'); expect(x.full).toBe('Han Boknam'); expect(x.fullHyphen).toBe('Han Bok-nam'); });
  it('홍빛나 Hong Bitna (Hong Bit-na)', () => { const x = r('홍빛나'); expect(x.full).toBe('Hong Bitna'); expect(x.fullHyphen).toBe('Hong Bit-na'); });
  it('민용하 Min Yongha', () => { expect(r('민용하').full).toBe('Min Yongha'); expect(r('민용하').fullHyphen).toBe('Min Yong-ha'); });
  it('송나리 Song Nari', () => expect(r('송나리').full).toBe('Song Nari'));
});

describe('이름 로마자 — 여러 이름', () => {
  const cases = [
    ['김철수', 'Gim Cheolsu'], ['이순신', 'I Sunsin'], ['박지성', 'Bak Jiseong'], ['최민정', 'Choe Minjeong'],
    ['정다은', 'Jeong Daeun'], ['유관순', 'Yu Gwansun'], ['김연아', 'Gim Yeona'], ['윤봉길', 'Yun Bonggil'],
    ['최설리', 'Choe Seolli'], ['조꽃님', 'Jo Kkotnim'], ['강밝음', 'Gang Bakeum'], ['이의진', 'I Uijin'],
    ['김희', 'Gim Hui'], ['오은비', 'O Eunbi'], ['장쯔위', 'Jang Jjeuwi'], ['류현진', 'Ryu Hyeonjin'],
    ['신뢰', 'Sin Roe'], ['임꺽정', 'Im Kkeokjeong'], ['권혁', 'Gwon Hyeok'], ['황예린', 'Hwang Yerin'],
    ['서하윤', 'Seo Hayun'], ['안중근', 'An Junggeun'], ['차은우', 'Cha Eunu'], ['백곰', 'Baek Gom'],
    ['김 철 수', 'Gim Cheolsu'], ['노을', 'No Eul'], ['표앎', 'Pyo Am'], ['김닭', 'Gim Dak'], ['구뷁', 'Gu Bwek'],
  ];
  for (const [ko, en] of cases) it(`${ko} → ${en}`, () => expect(r(ko).full).toBe(en));
});

describe('이름 로마자 — 옵션·보조 정보', () => {
  it('두 글자 성', () => {
    expect(r('남궁민수', { surnameLength: 2 }).full).toBe('Namgung Minsu');
    expect(r('황보혜정', { surnameLength: 2 }).full).toBe('Hwangbo Hyejeong');
    expect(r('제갈량', { surnameLength: 2 }).full).toBe('Jegal Ryang');
    expect(r('선우정아', { surnameLength: 2 }).full).toBe('Seonu Jeonga');
    expect(r('독고영재', { surnameLength: 2 }).full).toBe('Dokgo Yeongjae');
  });
  it('두 글자 성 힌트', () => {
    expect(r('남궁민').twoSyllableHint).toBe(true);
    expect(r('김남궁').twoSyllableHint).toBe(false);
    expect(r('남궁민', { surnameLength: 2 }).twoSyllableHint).toBe(false);
  });
  it('여권식 대문자', () => expect(r('홍빛나').passport).toBe('HONG BITNA'));
  it('많이 쓰는 성 표기', () => {
    expect(r('김철수').common).toEqual(['Kim']);
    expect(r('이순신').common).toContain('Lee');
    expect(r('박지성').common).toContain('Park');
    expect(r('최민정').common).toContain('Choi');
    expect(r('남궁민수', { surnameLength: 2 }).common).toContain('Namgung');
  });
  it('헷갈리는 음절 경계', () => {
    expect(r('이선영').ambiguous).toBe(true);   // Seonyeong
    expect(r('이한결').ambiguous).toBe(true);   // Hangyeol
    expect(r('김서은').ambiguous).toBe(true);   // Seoeun
    expect(r('홍빛나').ambiguous).toBe(false);
    expect(r('김희').ambiguous).toBe(false);
  });
  it('ㄹㄹ → ll', () => expect(romanizeSyllables('별라')).toEqual(['byeol', 'la']));
  it('잘못된 입력', () => {
    expect(r('kim')).toBe(null); expect(r('김')).toBe(null); expect(r('')).toBe(null);
    expect(r('남궁', { surnameLength: 2 })).toBe(null); expect(cleanName('김a')).toBe(null);
  });
});
