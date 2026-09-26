/* 타자 연습 글감. 저작권 걱정 없는 글만 쓴다.
 *  - own: DigitalBrain 이 직접 쓴 글
 *  - proverb: 전해 오는 속담(저작자 없음)
 *  - pd: 공유 저작물. 한국 저작권법은 저작자 사망 다음 해부터 70년(2013년 7월 이전에 이미 끝난 권리는 되살아나지 않음).
 *        아래 작가는 모두 1945년 이전에 세상을 떠나 보호 기간이 끝났다.
 *        영어 글은 1860년대 이전 발표작(저자 사망 후 100년 이상) 또는 미국 정부 공문(링컨 연설).
 *  노래 가사·최근 책·기사는 넣지 않는다. 문장 부호는 자판으로 칠 수 있게 바꿨다(normalizeText).
 */

export const WORDS = {
  ko: `사과 바다 하늘 나무 구름 학교 친구 가족 시간 사람 마음 생각 이야기 도서관 운동장 자전거 기차역 우체국 병원 약국
시장 공원 거리 골목 창문 책상 의자 연필 공책 가방 신발 모자 우산 안경 시계 달력 거울 수건 비누 칫솔
김치 된장 떡볶이 비빔밥 냉면 만두 호박 감자 고구마 옥수수 딸기 포도 복숭아 수박 참외 귤 배추 무 파 마늘
아침 점심 저녁 오늘 내일 어제 주말 봄날 여름 가을 겨울 새벽 한낮 햇볕 바람 눈송이 빗방울 무지개 번개 안개
쓰다 읽다 걷다 뛰다 웃다 울다 앉다 닦다 씻다 끓이다 짜다 싸우다 빨래 뻐꾸기 찌개 떡국 꽃잎 깻잎 까치 꼬리
괜찮다 궁금하다 왜냐하면 과자 원숭이 의사 회의 외국 귀엽다 쉽다 뭐든지 돼지 웬일 훨씬 괴롭다 뒤쪽 위로 왼쪽 샘물 예쁘다
얘기 계단 계절 시계탑 폐지 차례 세계 지혜 앉히다 않다 읽기 밟다 넓다 삶 값 몫 흙 닭 젊다 없다
컴퓨터 키보드 모니터 전화기 냉장고 세탁기 청소기 선풍기 텔레비전 사진기 비행기 자동차 지하철 버스 택시 정류장 횡단보도 신호등 주차장 엘리베이터`
    .split(/\s+/).filter(Boolean),
  en: `the and that have with this from they would there their what about which when make like time just know take people into year
your good some could them other than then look only come over think also back after work first well even want because these give
most very water after around every house world school still night never under while light small place same right great where
between always another family money story young point both paper group river friend change table follow begin music early month
river quiet garden window yellow basket travel winter summer autumn spring morning evening letter number market bridge forest
village island simple gentle careful strong bright little middle during against without perhaps enough almost together keyboard
practice typing finger balance sentence journal kitchen bottle pocket orange purple silver planet rocket candle ladder puzzle`
    .split(/\s+/).filter(Boolean),
};

/** 짧은 글: 한 줄짜리 문장. source 는 글 밑에 보인다. */
export const SHORT = {
  ko: [
    ...[
      '가는 말이 고와야 오는 말이 곱다.', '낮말은 새가 듣고 밤말은 쥐가 듣는다.', '세 살 버릇 여든까지 간다.',
      '천 리 길도 한 걸음부터.', '티끌 모아 태산.', '소 잃고 외양간 고친다.', '원숭이도 나무에서 떨어질 때가 있다.',
      '백지장도 맞들면 낫다.', '등잔 밑이 어둡다.', '돌다리도 두들겨 보고 건너라.', '하늘이 무너져도 솟아날 구멍이 있다.',
      '발 없는 말이 천 리 간다.', '빈 수레가 요란하다.', '개구리 올챙이 적 생각 못 한다.', '아니 땐 굴뚝에 연기 날까.',
      '공든 탑이 무너지랴.', '말 한마디로 천 냥 빚을 갚는다.', '윗물이 맑아야 아랫물이 맑다.', '벼는 익을수록 고개를 숙인다.',
      '가랑비에 옷 젖는 줄 모른다.', '뛰는 놈 위에 나는 놈 있다.', '꿩 먹고 알 먹는다.', '바늘 도둑이 소도둑 된다.',
      '열 번 찍어 안 넘어가는 나무 없다.', '콩 심은 데 콩 나고 팥 심은 데 팥 난다.',
    ].map((text) => ({ text, source: '속담' })),
    ...[
      '아침마다 창문을 열고 찬 공기를 한 번 깊게 들이마십니다.',
      '버스를 놓쳐서 한 정거장을 걸었더니 오히려 머리가 맑아졌다.',
      '냉장고에 남은 채소를 모두 썰어 넣고 볶음밥을 만들었다.',
      '오래 쓴 키보드는 자주 누르는 키만 글자가 반들반들 닳아 있다.',
      '비 온 뒤 골목에는 흙냄새와 풀냄새가 뒤섞여 있었다.',
      '회의 자료는 어젯밤에 다 만들어 두었으니 걱정하지 않아도 된다.',
      '주말에는 휴대폰을 서랍에 넣어 두고 밀린 책을 읽었다.',
      '빨래를 널고 나니 햇볕이 쨍쨍해서 금방 마를 것 같았다.',
      '처음 가 본 동네에서 길을 잃었지만 덕분에 괜찮은 빵집을 찾았다.',
      '따뜻한 보리차 한 잔이면 쌀쌀한 저녁도 견딜 만하다.',
      '계단을 오를 때마다 숨이 차서 이번 달부터 운동을 시작했다.',
      '뭐든지 꾸준히 하다 보면 어느새 손에 익는 날이 온다.',
      '할머니께서 싸 주신 깻잎장아찌는 밥도둑이 따로 없었다.',
      '편의점 앞 의자에 앉아 친구와 한참 동안 얘기를 나눴다.',
      '엘리베이터가 고장 나서 십이 층까지 걸어 올라갔다.',
      '새로 산 운동화는 발이 편해서 하루 종일 신어도 괜찮았다.',
      '밤하늘에 별이 잘 보이는 날은 일부러 불을 끄고 창밖을 본다.',
      '택배 상자를 뜯으니 뽁뽁이가 한가득 들어 있었다.',
      '쪽지 시험을 망쳤지만 틀린 문제를 다시 풀어 보니 이해가 됐다.',
      '가을이 되면 은행나무 길이 노랗게 물들어 사진 찍는 사람이 많다.',
      '회사 근처 국숫집은 점심시간마다 줄이 길게 늘어선다.',
      '오늘 할 일을 세 가지만 적어 두면 하루가 덜 흩어진다.',
      '낡은 자전거에 기름칠을 했더니 체인 소리가 훨씬 조용해졌다.',
      '잘 모르는 낱말이 나오면 사전을 찾아보는 습관을 들이고 있다.',
      '손가락을 기본 자리에 두고 화면만 보며 천천히 쳐 봅시다.',
    ].map((text) => ({ text, source: 'DigitalBrain 작성' })),
  ],
  en: [
    ...[
      'Actions speak louder than words.', 'Where there is a will, there is a way.', 'Practice makes perfect.',
      'Better late than never.', 'Every cloud has a silver lining.', 'Two heads are better than one.',
      'The early bird catches the worm.', 'Look before you leap.', 'Slow and steady wins the race.',
      'Rome was not built in a day.', 'A journey of a thousand miles begins with a single step.',
      'When in Rome, do as the Romans do.', 'Many hands make light work.',
    ].map((text) => ({ text, source: 'English proverb' })),
    ...[
      'The quick brown fox jumps over the lazy dog.', 'Sphinx of black quartz, judge my vow.',
    ].map((text) => ({ text, source: 'Traditional pangram' })),
    ...[
      'I left the window open, and the whole room smelled of rain.',
      'She keeps a small notebook in her pocket for ideas that arrive on the bus.',
      'The coffee was too hot, so I read the first page of the newspaper twice.',
      'Our train was delayed by ten minutes, which gave us time to buy bread.',
      'He fixed the squeaky door with a drop of oil and a little patience.',
      'Please keep your fingers on the home row and look at the screen.',
      'On quiet mornings the park is full of joggers, dogs, and pigeons.',
      'My neighbor grows tomatoes, basil, and peppers on a tiny balcony.',
      'We packed sandwiches, water, and a map before walking up the hill.',
      'The meeting ended early, so everyone went outside to enjoy the sun.',
      'Typing slowly without mistakes is better than typing fast with many.',
      'A good chair and a steady desk make long evenings of work easier.',
    ].map((text) => ({ text, source: 'Written by DigitalBrain' })),
  ],
};

/** 긴 글. id 는 기록·선택 저장용. */
export const LONG = {
  ko: [
    {
      id: 'seosi', title: '서시', source: '윤동주, 「서시」(1941년 작, 유고 시집 『하늘과 바람과 별과 시』 1948) · 공유 저작물(1945년 사망)',
      text: `죽는 날까지 하늘을 우러러
한 점 부끄럼이 없기를,
잎새에 이는 바람에도
나는 괴로워했다.
별을 노래하는 마음으로
모든 죽어 가는 것을 사랑해야지
그리고 나한테 주어진 길을
걸어가야겠다.
오늘 밤에도 별이 바람에 스치운다.`,
    },
    {
      id: 'star', title: '별 헤는 밤', source: '윤동주, 「별 헤는 밤」(1941년 작, 『하늘과 바람과 별과 시』 1948) · 공유 저작물(1945년 사망)',
      text: `계절이 지나가는 하늘에는
가을로 가득 차 있습니다.
나는 아무 걱정도 없이
가을 속의 별들을 다 헤일 듯합니다.
가슴 속에 하나 둘 새겨지는 별을
이제 다 못 헤는 것은
쉬이 아침이 오는 까닭이요,
내일 밤이 남은 까닭이요,
아직 나의 청춘이 다하지 않은 까닭입니다.
별 하나에 추억과
별 하나에 사랑과
별 하나에 쓸쓸함과
별 하나에 동경과
별 하나에 시와
별 하나에 어머니, 어머니,
어머님, 나는 별 하나에 아름다운 말 한마디씩 불러 봅니다. 소학교 때 책상을 같이 했던 아이들의 이름과, 패, 경, 옥, 이런 이국 소녀들의 이름과, 벌써 아기 어머니 된 계집애들의 이름과, 가난한 이웃 사람들의 이름과, 비둘기, 강아지, 토끼, 노새, 노루, 프랑시스 잠, 라이너 마리아 릴케, 이런 시인의 이름을 불러 봅니다.
이네들은 너무나 멀리 있습니다.
별이 아스라이 멀듯이.
어머님,
그리고 당신은 멀리 북간도에 계십니다.
나는 무엇인지 그리워
이 많은 별빛이 내린 언덕 위에
내 이름자를 써 보고,
흙으로 덮어 버리었습니다.
딴은 밤을 새워 우는 벌레는
부끄러운 이름을 슬퍼하는 까닭입니다.
그러나 겨울이 지나고 나의 별에도 봄이 오면
무덤 위에 파란 잔디가 피어나듯이
내 이름자 묻힌 언덕 위에도
자랑처럼 풀이 무성할 거외다.`,
    },
    {
      id: 'selfportrait', title: '자화상', source: '윤동주, 「자화상」(1939년 작, 『하늘과 바람과 별과 시』 1948) · 공유 저작물(1945년 사망)',
      text: `산모퉁이를 돌아 논가 외딴 우물을 홀로 찾아가선 가만히 들여다봅니다.
우물 속에는 달이 밝고 구름이 흐르고 하늘이 펼치고 파아란 바람이 불고 가을이 있습니다.
그리고 한 사나이가 있습니다.
어쩐지 그 사나이가 미워져 돌아갑니다.
돌아가다 생각하니 그 사나이가 가엾어집니다.
도로 가 들여다보니 사나이는 그대로 있습니다.
다시 그 사나이가 미워져 돌아갑니다.
돌아가다 생각하니 그 사나이가 그리워집니다.
우물 속에는 달이 밝고 구름이 흐르고 하늘이 펼치고 파아란 바람이 불고 가을이 있고 추억처럼 사나이가 있습니다.`,
    },
    {
      id: 'newroad', title: '새로운 길', source: '윤동주, 「새로운 길」(1938년 작, 『하늘과 바람과 별과 시』 1948) · 공유 저작물(1945년 사망)',
      text: `내를 건너서 숲으로
고개를 넘어서 마을로
어제도 가고 오늘도 갈
나의 길 새로운 길
민들레가 피고 까치가 날고
아가씨가 지나고 바람이 일고
나의 길은 언제나 새로운 길
오늘도... 내일도...
내를 건너서 숲으로
고개를 넘어서 마을로`,
    },
    {
      id: 'azalea', title: '진달래꽃', source: '김소월, 「진달래꽃」(시집 『진달래꽃』 1925) · 공유 저작물(1934년 사망)',
      text: `나 보기가 역겨워
가실 때에는
말없이 고이 보내 드리우리다
영변에 약산
진달래꽃
아름 따다 가실 길에 뿌리우리다
가시는 걸음 걸음
놓인 그 꽃을
사뿐히 즈려밟고 가시옵소서
나 보기가 역겨워
가실 때에는
죽어도 아니 눈물 흘리우리다`,
    },
    {
      id: 'sanyuhwa', title: '산유화', source: '김소월, 「산유화」(시집 『진달래꽃』 1925) · 공유 저작물(1934년 사망)',
      text: `산에는 꽃 피네
꽃이 피네
갈 봄 여름 없이
꽃이 피네
산에
산에
피는 꽃은
저만치 혼자서 피어 있네
산에서 우는 작은 새여
꽃이 좋아
산에서
사노라네
산에는 꽃 지네
꽃이 지네
갈 봄 여름 없이
꽃이 지네`,
    },
    {
      id: 'farday', title: '먼 후일', source: '김소월, 「먼 후일」(시집 『진달래꽃』 1925) · 공유 저작물(1934년 사망)',
      text: `먼 훗날 당신이 찾으시면
그때에 내 말이 "잊었노라"
당신이 속으로 나무라면
"무척 그리다가 잊었노라"
그래도 당신이 나무라면
"믿기지 않아서 잊었노라"
오늘도 어제도 아니 잊고
먼 훗날 그때에 "잊었노라"`,
    },
    {
      id: 'silence', title: '님의 침묵', source: '한용운, 「님의 침묵」(시집 『님의 침묵』 1926) · 공유 저작물(1944년 사망)',
      text: `님은 갔습니다. 아아, 사랑하는 나의 님은 갔습니다.
푸른 산빛을 깨치고 단풍나무 숲을 향하여 난 작은 길을 걸어서 차마 떨치고 갔습니다.
황금의 꽃같이 굳고 빛나던 옛 맹세는 차디찬 티끌이 되어서 한숨의 미풍에 날아갔습니다.
날카로운 첫 키스의 추억은 나의 운명의 지침을 돌려놓고 뒷걸음쳐서 사라졌습니다.
나는 향기로운 님의 말소리에 귀먹고 꽃다운 님의 얼굴에 눈멀었습니다.
사랑도 사람의 일이라 만날 때에 미리 떠날 것을 염려하고 경계하지 아니한 것은 아니지만, 이별은 뜻밖의 일이 되고 놀란 가슴은 새로운 슬픔에 터집니다.
그러나 이별을 쓸데없는 눈물의 원천을 만들고 마는 것은 스스로 사랑을 깨치는 것인 줄 아는 까닭에, 걷잡을 수 없는 슬픔의 힘을 옮겨서 새 희망의 정수박이에 들어부었습니다.
우리는 만날 때에 떠날 것을 염려하는 것과 같이 떠날 때에 다시 만날 것을 믿습니다.
아아, 님은 갔지마는 나는 님을 보내지 아니하였습니다.
제 곡조를 못 이기는 사랑의 노래는 님의 침묵을 휩싸고 돕니다.`,
    },
    {
      id: 'grapes', title: '청포도', source: '이육사, 「청포도」(『문장』 1939) · 공유 저작물(1944년 사망)',
      text: `내 고장 칠월은
청포도가 익어 가는 시절.
이 마을 전설이 주저리주저리 열리고
먼 데 하늘이 꿈꾸며 알알이 들어와 박혀
하늘 밑 푸른 바다가 가슴을 열고
흰 돛 단 배가 곱게 밀려서 오면
내가 바라는 손님은 고달픈 몸으로
청포를 입고 찾아온다고 했으니
내 그를 맞아 이 포도를 따 먹으면
두 손은 함뿍 적셔도 좋으련
아이야 우리 식탁엔 은쟁반에
하이얀 모시 수건을 마련해 두렴`,
    },
    {
      id: 'buckwheat', title: '메밀꽃 필 무렵 (한 대목)', source: '이효석, 「메밀꽃 필 무렵」(『조광』 1936) 가운데 · 공유 저작물(1942년 사망)',
      text: `길은 지금 긴 산허리에 걸려 있다. 밤중을 지난 무렵인지 죽은 듯이 고요한 속에서 짐승 같은 달의 숨소리가 손에 잡힐 듯이 들리며, 콩 포기와 옥수수 잎새가 한층 달에 푸르게 젖었다. 산허리는 온통 메밀밭이어서 피기 시작한 꽃이 소금을 뿌린 듯이 흐뭇한 달빛에 숨이 막힐 지경이다. 붉은 대궁이 향기같이 애잔하고 나귀들의 걸음도 시원하다. 길이 좁은 까닭에 세 사람은 나귀를 타고 외줄로 늘어섰다. 방울 소리가 시원스럽게 딸랑딸랑 메밀밭께로 흘러간다.`,
    },
    {
      id: 'luckyday', title: '운수 좋은 날 (첫머리)', source: '현진건, 「운수 좋은 날」(『개벽』 1924) 첫머리 · 공유 저작물(1943년 사망)',
      text: `새침하게 흐린 품이 눈이 올 듯하더니 눈은 아니 오고 얼다가 만 비가 추적추적 내리는 날이었다. 이날이야말로 동소문 안에서 인력거꾼 노릇을 하는 김첨지에게는 오래간만에도 닥친 운수 좋은 날이었다.`,
    },
    {
      id: 'camellia', title: '동백꽃 (첫머리)', source: '김유정, 「동백꽃」(『조광』 1936) 첫머리 · 공유 저작물(1937년 사망)',
      text: `오늘도 또 우리 수탉이 막 쫓기었다. 내가 점심을 먹고 나무를 하러 갈 양으로 나올 때이었다. 산으로 올라서려니까 등 뒤에서 푸드득, 푸드득 하고 닭의 횃소리가 야단이다. 깜짝 놀라서 고개를 돌려보니 아니나 다르랴, 두 놈이 또 얼리었다.`,
    },
    {
      id: 'wings', title: '날개 (끝부분)', source: '이상, 「날개」(『조광』 1936) 끝부분 · 공유 저작물(1937년 사망)',
      text: `나는 걸음을 멈추고 그리고 어디 한번 이렇게 외쳐 보고 싶었다.
날개야 다시 돋아라.
날자. 날자. 날자. 한 번만 더 날자꾸나.
한 번만 더 날아 보자꾸나.`,
    },
    {
      id: 'own-walk', title: '저녁 산책', source: 'DigitalBrain 작성',
      text: `퇴근길에 한 정거장 먼저 내려서 걷기 시작한 지 한 달쯤 되었다. 처음에는 다리가 뻐근하고 시간이 아까웠는데, 요즘은 그 이십 분이 하루 중 가장 조용한 시간이 되었다. 가게 불빛이 하나둘 켜지는 거리를 지나면서 오늘 있었던 일을 천천히 정리한다. 잘한 일은 한 가지만 떠올리고, 아쉬운 일은 내일 할 일 하나로 바꿔 둔다. 집에 도착할 즈음이면 머릿속이 한결 가벼워져 있다. 대단한 결심이 아니어도 좋다. 조금 돌아가는 길이 생각을 정리할 자리를 만들어 준다.`,
    },
  ],
  en: [
    {
      id: 'gettysburg', title: 'The Gettysburg Address', source: 'Abraham Lincoln, Gettysburg Address (1863) · public domain',
      text: `Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.
Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this.
But, in a larger sense, we can not dedicate - we can not consecrate - we can not hallow - this ground. The brave men, living and dead, who struggled here, have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember what we say here, but it can never forget what they did here.`,
    },
    {
      id: 'twocities', title: 'A Tale of Two Cities (opening)', source: 'Charles Dickens, A Tale of Two Cities (1859), Book 1, Chapter 1 · public domain',
      text: `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way - in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.`,
    },
    {
      id: 'pride', title: 'Pride and Prejudice (opening)', source: 'Jane Austen, Pride and Prejudice (1813), Chapter 1 · public domain',
      text: `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.
However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.`,
    },
    {
      id: 'moby', title: 'Moby-Dick (opening)', source: 'Herman Melville, Moby-Dick (1851), Chapter 1 · public domain',
      text: `Call me Ishmael. Some years ago - never mind how long precisely - having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen, and regulating the circulation.`,
    },
    {
      id: 'alice', title: "Alice's Adventures in Wonderland (opening)", source: "Lewis Carroll, Alice's Adventures in Wonderland (1865), Chapter 1 · public domain",
      text: `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "and what is the use of a book," thought Alice "without pictures or conversations?"
So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.`,
    },
    {
      id: 'walden', title: 'Walden (Where I Lived)', source: 'Henry David Thoreau, Walden (1854), "Where I Lived, and What I Lived For" · public domain',
      text: `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.`,
    },
    {
      id: 'aesop-hare', title: 'The Tortoise and the Hare', source: "Aesop's fable, retold in our own words by DigitalBrain",
      text: `A hare laughed at a tortoise for walking so slowly, so the tortoise offered to race him. The hare shot ahead, and when he could no longer see his rival, he lay down under a tree for a short nap. The tortoise kept going, one small step after another, and never stopped to rest. When the hare finally woke up, he ran as fast as he could, but the tortoise was already crossing the finish line. Steady effort had beaten careless speed.`,
    },
    {
      id: 'aesop-wind', title: 'The North Wind and the Sun', source: "Aesop's fable, retold in our own words by DigitalBrain",
      text: `The North Wind and the Sun argued about which of them was stronger. They agreed that whoever could make a traveler take off his coat would win. The Wind blew as hard as it could, but the harder it blew, the tighter the man held his coat. Then the Sun came out and shone warmly on the road. Before long the traveler grew hot, unbuttoned his coat, and took it off. Gentle warmth had done what force could not.`,
    },
    {
      id: 'aesop-ant', title: 'The Ant and the Grasshopper', source: "Aesop's fable, retold in our own words by DigitalBrain",
      text: `All summer long a grasshopper sang in the fields while an ant carried grain back to its nest. The grasshopper asked why the ant worked so hard on such fine days. The ant said that winter would come, and food would be hard to find. When the cold arrived, the ant had plenty to eat, and the grasshopper had nothing at all. There is a time for play and a time to prepare.`,
    },
    {
      id: 'own-desk', title: 'A Tidy Desk', source: 'Written by DigitalBrain',
      text: `Every Friday afternoon I spend ten minutes clearing my desk. I throw away old notes, put pens back in the cup, and wipe the keyboard with a soft cloth. It is a small habit, but on Monday morning it feels like opening a clean notebook. Nothing is waiting to distract me, and the first task of the week is easier to begin.`,
    },
  ],
};
