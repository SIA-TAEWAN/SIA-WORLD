/**
 * 이야기 사건 12개 (games/card/src/data/events.json 과 같은 내용). 선택지·값은 PRD 사용자 스펙 그대로.
 * acts: 나오는 막 (빈 목록 = 전체). 한 판에 같은 사건은 한 번.
 */
import type { EventDef } from '../types.ts';

export const EVENTS: EventDef[] = [
  {
    id: 'jangseung', name: '길가의 장승', acts: [], art: 'story-1',
    text: '길가에 우뚝 선 장승이 무섭게 노려본다. 정성을 바치면 힘을 빌려줄 것 같다.',
    choices: [
      { label: '체력 6을 바치고 카드 1장 강화', ops: [{ t: 'hp', n: -6 }, { t: 'upgrade', n: 1 }] },
      { label: '지나가기', ops: [] },
    ],
  },
  {
    id: 'ssireum', name: '도깨비 씨름', acts: [1], art: 'story-1',
    text: '도깨비가 씨름 한 판 하자며 소매를 걷어붙인다. 이기면 엽전을 준단다.',
    choices: [
      { label: '씨름하기 (반반: 엽전 60 / 지면 체력 8)', ops: [{ t: 'chance', p: 0.5, win: [{ t: 'gold', n: 60 }], lose: [{ t: 'hp', n: -8 }], winText: '번쩍 들어 메쳤다! 엽전 60을 받았다.', loseText: '모래판에 나뒹굴었다… 체력 8을 잃었다.' }] },
      { label: '도망가기', ops: [] },
    ],
  },
  {
    id: 'jumak', name: '주막', acts: [], art: 'story-2',
    text: '구수한 국밥 냄새가 나는 주막이다. 주모가 반갑게 맞는다.',
    choices: [
      { label: '엽전 30으로 국밥 한 그릇 (체력 20)', needGold: 30, ops: [{ t: 'gold', n: -30 }, { t: 'hp', n: 20 }] },
      { label: '공짜 막걸리 (체력 8 + 도깨비 장난 1장)', ops: [{ t: 'hp', n: 8 }, { t: 'curse', id: 'prank', n: 1 }] },
    ],
  },
  {
    id: 'well', name: '우물 속 목소리', acts: [], art: 'story-3',
    text: '오래된 우물 속에서 누군가 속삭인다. 필요 없는 걸 버리렴… 아니면 물을 마시렴…',
    choices: [
      { label: '카드 1장 없애기', ops: [{ t: 'remove', n: 1 }] },
      { label: '우물물 마시기 (체력 10)', ops: [{ t: 'hp', n: 10 }] },
    ],
  },
  {
    id: 'painter', name: '떠돌이 화가', acts: [], art: 'story-2',
    text: '붓을 든 떠돌이 화가가 그 카드를 똑같이 그려 주겠다고 한다.',
    choices: [
      { label: '엽전 40으로 카드 1장 복사', needGold: 40, ops: [{ t: 'gold', n: -40 }, { t: 'copy', n: 1 }] },
      { label: '지나가기', ops: [] },
    ],
  },
  {
    id: 'seonang', name: '서낭당', acts: [], art: 'story-3',
    text: '오색 천이 걸린 서낭당. 돌무더기 위에 반짝이는 부적이 놓여 있다.',
    choices: [
      { label: '부적 가져가기 (도깨비 장난 2장)', ops: [{ t: 'relic' }, { t: 'curse', id: 'prank', n: 2 }] },
      { label: '절하고 가기 (체력 5)', ops: [{ t: 'hp', n: 5 }] },
    ],
  },
  {
    id: 'ginseng', name: '산삼 밭', acts: [1], art: 'story-1',
    text: '깊은 숲속에서 산삼 밭을 찾았다!',
    choices: [
      { label: '먹기 (최대 체력 +5)', ops: [{ t: 'maxHp', n: 5 }] },
      { label: '팔기 (엽전 50)', ops: [{ t: 'gold', n: 50 }] },
    ],
  },
  {
    id: 'gut', name: '무당의 굿', acts: [2, 3], art: 'story-4',
    text: '무당이 방울을 흔들며 굿판을 벌이고 있다.',
    choices: [
      { label: '체력 10으로 고급 카드 1장', ops: [{ t: 'hp', n: -10 }, { t: 'card', rarity: 'uncommon' }] },
      { label: '엽전 50으로 부적 1개', needGold: 50, ops: [{ t: 'gold', n: -50 }, { t: 'relic' }] },
      { label: '지나가기', ops: [] },
    ],
  },
  {
    id: 'foxFork', name: '갈림길의 여우', acts: [1, 2], art: 'story-2',
    text: '갈림길에서 꼬리 달린 여우가 길을 막는다. 자기를 이기면 큰 상을 준단다.',
    choices: [
      { label: '천년 여우와 싸우기 (정예 · 보상 2배)', ops: [{ t: 'elite', double: true, foes: ['foxElite', 'foxElite2'] }] },
      { label: '무시하기', ops: [] },
    ],
  },
  {
    id: 'smith', name: '대장간 노인', acts: [2, 3], art: 'forge',
    text: '대장간 노인이 망치를 두드리며 엽전만 내면 두 장을 벼려 주겠다고 한다.',
    choices: [
      { label: '엽전 80으로 카드 2장 강화', needGold: 80, ops: [{ t: 'gold', n: -80 }, { t: 'upgrade', n: 2 }] },
      { label: '지나가기', ops: [] },
    ],
  },
  {
    id: 'monk', name: '탁발승', acts: [], art: 'story-4',
    text: '목탁을 두드리는 스님이 시주를 청한다. 복을 빌어 주겠다고 한다.',
    choices: [
      { label: '엽전 20 시주 (다음 전투 첫 턴 기력 +2)', needGold: 20, ops: [{ t: 'gold', n: -20 }, { t: 'nextEnergy', n: 2 }] },
      { label: '지나가기', ops: [] },
    ],
  },
  {
    id: 'gatekeeper', name: '저승 문지기', acts: [3], art: 'story-4',
    text: '저승 문지기가 목숨 한 줌을 내면 귀한 것을 주겠다며 손을 내민다.',
    choices: [
      { label: '최대 체력 15%를 내고 전설 카드 1장', ops: [{ t: 'maxHpPct', n: 15 }, { t: 'card', rarity: 'legend' }] },
      { label: '거절하기', ops: [] },
    ],
  },
];
