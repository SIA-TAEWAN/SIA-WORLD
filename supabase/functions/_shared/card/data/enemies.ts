/**
 * 요괴·보스 데이터 (games/card/src/data/enemies.json 과 같은 내용).
 * 보스 체력·행동 이름·수치는 PRD 사용자 스펙 그대로 (6단계 밸런스로 바꾼 것: 큰도깨비 200→170 · 염라대왕 380→350, 강철이 2단계 불길 — games/card/PROGRESS.md). 일반 요괴의 체력·행동 수치는 스펙에 없어 정한 값(PROGRESS.md '물어볼 것').
 * 4지역 일반 요괴 4종씩(저승의 원귀는 궁궐 원혼과 같은 그림, 더 센 값) — 막이 오를수록 체력·피해가 크다.
 * 보스 12종 + 숨은 최종보스 어둑시니, 불려 나오는 요괴(여우 분신 · 병졸 · 저승사자), 갈림길의 여우 정예(천년 여우).
 * eliteMod: 정예로 나왔을 때만 쓰는 체력 % · 공격 % (9단계 — 정예 쓰러짐률을 5~15% 로 맞춤, 막 보스 수치는 그대로).
 */
import type { EnemyDef } from '../types.ts';

const BASE: EnemyDef[] = [
  // ======================= 1막 · 대나무숲 =======================
  {
    id: 'bamboo',
    name: '대나무 요괴',
    hp: [36, 40],
    art: 'e-bamboo',
    phase1: {
      moves: [
        { id: 'stab', name: '죽창 찌르기', intent: 'atk', ops: [{ op: 'dmg', n: 9 }] },
        { id: 'root', name: '뿌리 내리기', intent: 'def', ops: [{ op: 'block', n: 8 }] },
        { id: 'grow', name: '마디 굵히기', intent: 'buff', ops: [{ op: 'str', n: 2 }] },
      ],
      ai: { type: 'random', weights: [['stab', 50], ['root', 30], ['grow', 20]], noRepeat: true },
    },
  },
  {
    id: 'fox',
    name: '여우',
    hp: [26, 30],
    art: 'e-fox',
    phase1: {
      moves: [
        { id: 'scratch', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 6 }] },
        { id: 'foxfire', name: '여우불', intent: 'atk', ops: [{ op: 'dmg', n: 3 }, { op: 'status', id: 'fire', n: 2 }] },
        { id: 'charm', name: '홀리기', intent: 'debuff', ops: [{ op: 'status', id: 'weak', n: 1 }] },
      ],
      ai: { type: 'cycle', order: ['scratch', 'foxfire', 'charm'] },
    },
  },
  {
    id: 'acorn',
    name: '도토리 요괴',
    hp: [14, 18],
    art: 'e-acorn',
    phase1: {
      moves: [
        { id: 'roll', name: '데굴데굴', intent: 'atk', ops: [{ op: 'dmg', n: 5 }] },
        { id: 'shell', name: '껍질 단단', intent: 'def', ops: [{ op: 'block', n: 5 }] },
      ],
      ai: { type: 'random', weights: [['roll', 70], ['shell', 30]] },
    },
  },
  {
    id: 'lynx',
    name: '스라소니',
    hp: [44, 48],
    art: 'e-lynx',
    phase1: {
      moves: [
        { id: 'glare', name: '노려보기', intent: 'buff', ops: [{ op: 'str', n: 2 }] },
        { id: 'pounce', name: '덮치기', intent: 'atk', ops: [{ op: 'dmg', n: 11 }] },
        { id: 'swipe', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 4, times: 2 }] },
      ],
      ai: { type: 'cycle', order: ['glare', 'pounce', 'swipe', 'pounce'] },
    },
  },

  // ---------- 대나무숲 보스 ----------
  {
    id: 'gumiho',
    name: '구미호',
    hp: [130, 130],
    art: 'b-gumiho',
    eliteMod: { hp: 55, dmg: 85 },
    boss: true,
    phase1: {
      moves: [
        { id: 'claw', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 9 }] },
        { id: 'foxfire', name: '여우불', intent: 'atk', ops: [{ op: 'dmg', n: 6 }, { op: 'status', id: 'fire', n: 2 }] },
        { id: 'clones', name: '분신', intent: 'buff', ops: [{ op: 'summon', id: 'gumihoClone', n: 2, max: 4 }] },
      ],
      ai: { type: 'cycle', order: ['claw', 'foxfire', 'clones'] },
    },
    phase2: {
      shout: '아홉 꼬리가 춤춘다!',
      passive: 'cloneShield',
      // 매 턴 분신 1 (행동 전에)
      turnOps: [{ op: 'summon', id: 'gumihoClone', n: 1, max: 4 }],
      moves: [
        { id: 'claw', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 9 }] },
        { id: 'foxfire', name: '여우불', intent: 'atk', ops: [{ op: 'dmg', n: 6 }, { op: 'status', id: 'fire', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['claw', 'foxfire'] },
    },
  },
  {
    id: 'gumihoClone',
    name: '여우 분신',
    hp: [12, 12],
    art: 'e-fox',
    minion: true,
    phase1: {
      moves: [{ id: 'bite', name: '물기', intent: 'atk', ops: [{ op: 'dmg', n: 4 }] }],
      ai: { type: 'cycle', order: ['bite'] },
    },
  },
  {
    id: 'jangsanbeom',
    name: '장산범',
    hp: [165, 165],
    art: 'b-jangsanbeom',
    boss: true,
    phase1: {
      moves: [
        { id: 'mimicry', name: '흉내 소리', intent: 'atk', ops: [{ op: 'discardNext', n: 1 }, { op: 'dmg', n: 12 }] },
        { id: 'warn', name: '덮치기 예고', intent: 'unknown', ops: [{ op: 'str', n: 2 }] },
        { id: 'pounce', name: '덮치기', intent: 'atk', ops: [{ op: 'dmg', n: 19 }] },
      ],
      ai: { type: 'cycle', order: ['mimicry', 'warn', 'pounce'] },
    },
    phase2: {
      shout: '하얀 털이 곤두선다!',
      moves: [
        { id: 'pounce2', name: '덮치기', intent: 'atk', ops: [{ op: 'dmg', n: 19 }] },
        { id: 'hide', name: '숨기', intent: 'buff', ops: [{ op: 'dodge', n: 1 }] },
      ],
      // 덮치기 2연속, 사이에 숨기
      ai: { type: 'cycle', order: ['pounce2', 'pounce2', 'hide'] },
    },
  },
  {
    id: 'centipede',
    name: '왕지네',
    hp: [135, 135],
    art: 'b-centipede',
    boss: true,
    phase1: {
      moves: [
        { id: 'sting', name: '독침', intent: 'atk', ops: [{ op: 'dmg', n: 5 }, { op: 'status', id: 'poison', n: 3 }] },
        { id: 'coil', name: '몸 감기', intent: 'def', ops: [{ op: 'block', n: 12 }] },
      ],
      ai: { type: 'cycle', order: ['sting', 'coil'] },
    },
    phase2: {
      shout: '수백 개의 다리가 꿈틀댄다!',
      turnOps: [{ op: 'status', id: 'poison', n: 2 }],
      moves: [{ id: 'legs', name: '다리 훑기', intent: 'atk', ops: [{ op: 'dmg', n: 3, times: 4 }] }],
      ai: { type: 'cycle', order: ['legs'] },
    },
  },

  // ======================= 1막 · 들판 =======================
  {
    id: 'club',
    name: '몽둥이 도깨비',
    hp: [40, 44],
    art: 'e-club',
    phase1: {
      moves: [
        { id: 'smash', name: '몽둥이질', intent: 'atk', ops: [{ op: 'dmg', n: 10 }] },
        { id: 'roar', name: '으르렁', intent: 'buff', ops: [{ op: 'str', n: 2 }] },
        { id: 'brace', name: '버티기', intent: 'def', ops: [{ op: 'block', n: 7 }] },
      ],
      ai: { type: 'random', weights: [['smash', 50], ['roar', 25], ['brace', 25]], noRepeat: true },
    },
  },
  {
    id: 'imp',
    name: '꼬마 도깨비',
    hp: [20, 24],
    art: 'e-imp',
    phase1: {
      moves: [
        { id: 'pinch', name: '꼬집기', intent: 'atk', ops: [{ op: 'dmg', n: 5 }] },
        { id: 'prank', name: '장난치기', intent: 'debuff', ops: [{ op: 'curse', id: 'prank', n: 1, pile: 'discard' }] },
      ],
      ai: { type: 'cycle', order: ['pinch', 'prank', 'pinch'] },
    },
  },
  {
    id: 'wisp',
    name: '도깨비불',
    hp: [22, 26],
    art: 'e-wisp',
    phase1: {
      moves: [
        { id: 'spark', name: '불똥', intent: 'atk', ops: [{ op: 'dmg', n: 4 }, { op: 'status', id: 'fire', n: 2 }] },
        { id: 'flicker', name: '깜빡', intent: 'buff', ops: [{ op: 'dodge', n: 1 }] },
      ],
      ai: { type: 'cycle', order: ['spark', 'flicker', 'spark'] },
    },
  },
  {
    id: 'firecart',
    name: '불수레',
    hp: [46, 50],
    art: 'e-firecart',
    phase1: {
      moves: [
        { id: 'kindle', name: '불 붙이기', intent: 'debuff', ops: [{ op: 'status', id: 'fire', n: 3 }] },
        { id: 'ram', name: '들이받기', intent: 'atk', ops: [{ op: 'dmg', n: 12 }] },
        { id: 'rattle', name: '덜컹', intent: 'def', ops: [{ op: 'block', n: 10 }] },
      ],
      ai: { type: 'cycle', order: ['kindle', 'ram', 'rattle', 'ram'] },
    },
  },

  // ---------- 들판 보스 ----------
  {
    id: 'bigDokkaebi',
    name: '큰도깨비',
    hp: [150, 150],
    art: 'b-bigDokkaebi',
    eliteMod: { hp: 55, dmg: 80 },
    boss: true,
    phase1: {
      moves: [
        { id: 'club', name: '방망이', intent: 'atk', ops: [{ op: 'dmg', n: 11 }] },
        { id: 'gold', name: '금 나와라', intent: 'buff', ops: [{ op: 'block', n: 15 }, { op: 'str', n: 1 }] },
      ],
      ai: { type: 'cycle', order: ['club', 'gold'] },
    },
    phase2: {
      shout: '뚝딱! 장난 좀 쳐 볼까!',
      moves: [
        { id: 'club2', name: '방망이 두 번', intent: 'atk', ops: [{ op: 'dmg', n: 9, times: 2 }] },
        { id: 'mischief', name: '도깨비 장난', intent: 'debuff', ops: [{ op: 'curse', id: 'prank', n: 2, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['club2', 'mischief'] },
    },
  },
  {
    id: 'bulgasal',
    name: '불가살',
    hp: [210, 210],
    art: 'b-bulgasal',
    boss: true,
    phase1: {
      moves: [
        { id: 'eat', name: '쇠 먹기', intent: 'def', ops: [{ op: 'block', n: 20 }] },
        { id: 'butt', name: '박치기', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
      ],
      ai: { type: 'cycle', order: ['eat', 'butt'] },
    },
    phase2: {
      shout: '죽여도 죽지 않는다!',
      // 체력 0이면 한 번 30%로 부활, 화상 걸려 있으면 부활 못 함
      passive: 'revive',
      moves: [
        { id: 'eat', name: '쇠 먹기', intent: 'def', ops: [{ op: 'block', n: 20 }] },
        { id: 'butt', name: '박치기', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
      ],
      ai: { type: 'cycle', order: ['butt', 'eat'] },
    },
  },
  {
    id: 'gangcheori',
    name: '강철이',
    hp: [190, 190],
    art: 'b-gangcheori',
    eliteMod: { hp: 66 },
    boss: true,
    phase1: {
      moves: [
        { id: 'flame', name: '불길', intent: 'atk', ops: [{ op: 'dmg', n: 7 }, { op: 'status', id: 'fire', n: 3 }] },
        { id: 'parch', name: '메마름', intent: 'debuff', ops: [{ op: 'halveBlock' }] },
      ],
      ai: { type: 'cycle', order: ['flame', 'parch'] },
    },
    phase2: {
      shout: '온 들판이 타들어 간다!',
      // 매 턴 화상2, 화상 피해 2배, 젖음을 걸면 화상 감소
      passive: 'scorch',
      turnOps: [{ op: 'status', id: 'fire', n: 2 }],
      // 6단계 밸런스: 2단계 불길은 화상 없이 피해만 (매 턴 화상2 + 2배와 겹치면 1막에서 너무 셈 — 정한 값)
      moves: [
        { id: 'flame2', name: '불길', intent: 'atk', ops: [{ op: 'dmg', n: 8 }] },
        { id: 'parch', name: '메마름', intent: 'debuff', ops: [{ op: 'halveBlock' }] },
      ],
      ai: { type: 'cycle', order: ['flame2', 'parch'] },
    },
  },

  // ======================= 2막 · 궁궐 =======================
  {
    id: 'guard',
    name: '궁궐 수문병',
    hp: [62, 68],
    art: 'e-guard',
    phase1: {
      moves: [
        { id: 'thrust', name: '창 찌르기', intent: 'atk', ops: [{ op: 'dmg', n: 14 }] },
        { id: 'shield', name: '방패 세우기', intent: 'def', ops: [{ op: 'block', n: 12 }] },
        { id: 'shout', name: '호령', intent: 'buff', ops: [{ op: 'str', n: 2 }] },
      ],
      ai: { type: 'random', weights: [['thrust', 50], ['shield', 25], ['shout', 25]], noRepeat: true },
    },
  },
  {
    id: 'spirit',
    name: '궁녀 원혼',
    hp: [48, 53],
    art: 'e-spirit',
    phase1: {
      moves: [
        { id: 'touch', name: '서늘한 손', intent: 'atk', ops: [{ op: 'dmg', n: 12 }] },
        { id: 'grudge', name: '원한', intent: 'atk', ops: [{ op: 'dmg', n: 8 }, { op: 'status', id: 'weak', n: 2 }] },
        { id: 'wail', name: '울음', intent: 'debuff', ops: [{ op: 'status', id: 'mud', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['touch', 'grudge', 'wail'] },
    },
  },
  {
    id: 'water',
    name: '물귀신',
    hp: [55, 62],
    art: 'e-water',
    phase1: {
      moves: [
        { id: 'drag', name: '끌어당기기', intent: 'atk', ops: [{ op: 'dmg', n: 9 }, { op: 'status', id: 'wet', n: 2 }] },
        { id: 'splash', name: '물보라', intent: 'atk', ops: [{ op: 'dmg', n: 6, times: 2 }] },
      ],
      ai: { type: 'cycle', order: ['drag', 'splash', 'splash'] },
    },
  },
  {
    id: 'catfish',
    name: '메기 장수',
    hp: [79, 86],
    art: 'e-catfish',
    phase1: {
      moves: [
        { id: 'mire', name: '진흙탕', intent: 'debuff', ops: [{ op: 'status', id: 'mud', n: 2 }, { op: 'block', n: 10 }] },
        { id: 'quake', name: '땅 울림', intent: 'atk', ops: [{ op: 'dmg', n: 18 }] },
        { id: 'whip', name: '수염 채찍', intent: 'atk', ops: [{ op: 'dmg', n: 6, times: 3 }] },
      ],
      ai: { type: 'cycle', order: ['mire', 'quake', 'whip'] },
    },
  },

  // ---------- 궁궐 보스 ----------
  {
    id: 'guardCaptain',
    name: '수문장 대장',
    hp: [255, 255],
    art: 'b-guardCaptain',
    boss: true,
    phase1: {
      moves: [
        { id: 'spear', name: '창 찌르기', intent: 'atk', ops: [{ op: 'dmg', n: 15 }] },
        { id: 'wall', name: '방패벽', intent: 'def', ops: [{ op: 'block', n: 20 }, { op: 'summon', id: 'soldier', n: 1, max: 3 }] },
      ],
      ai: { type: 'cycle', order: ['spear', 'wall'] },
    },
    phase2: {
      shout: '궁궐을 지켜라! 병졸들, 나와라!',
      moves: [
        { id: 'volley', name: '화살 비', intent: 'atk', ops: [{ op: 'dmg', n: 4, times: 4 }] },
        { id: 'muster', name: '병졸 부르기', intent: 'buff', ops: [{ op: 'summon', id: 'soldier', n: 2, max: 3 }] },
      ],
      ai: { type: 'cycle', order: ['muster', 'volley', 'volley'] },
    },
  },
  {
    id: 'soldier',
    name: '병졸',
    hp: [20, 20],
    art: 'e-guard',
    minion: true,
    phase1: {
      moves: [{ id: 'jab', name: '창 찌르기', intent: 'atk', ops: [{ op: 'dmg', n: 6 }] }],
      ai: { type: 'cycle', order: ['jab'] },
    },
  },
  {
    id: 'dueoksini',
    name: '두억시니',
    hp: [265, 265],
    art: 'b-dueoksini',
    boss: true,
    phase1: {
      moves: [
        { id: 'smash', name: '내려치기', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
        { id: 'crush', name: '짓누르기', intent: 'atk', ops: [{ op: 'dmg', n: 10 }, { op: 'status', id: 'mud', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['smash', 'crush'] },
    },
    phase2: {
      shout: '머리가 하늘에 닿는다!',
      // 매 턴 힘 +3
      turnOps: [{ op: 'str', n: 2 }],
      moves: [
        { id: 'smash', name: '내려치기', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
        { id: 'crush', name: '짓누르기', intent: 'atk', ops: [{ op: 'dmg', n: 10 }, { op: 'status', id: 'mud', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['smash', 'crush'] },
    },
  },
  {
    id: 'imugi',
    name: '이무기',
    hp: [300, 300],
    art: 'b-imugi',
    eliteMod: { hp: 70, dmg: 120 },
    boss: true,
    phase1: {
      moves: [
        { id: 'spray', name: '물보라', intent: 'atk', ops: [{ op: 'dmg', n: 9 }, { op: 'status', id: 'wet', n: 2 }] },
        { id: 'bite', name: '물어뜯기', intent: 'atk', ops: [{ op: 'dmg', n: 18 }] },
        { id: 'coil', name: '똬리', intent: 'def', ops: [{ op: 'block', n: 15 }] },
      ],
      ai: { type: 'cycle', order: ['spray', 'bite', 'coil'] },
    },
    phase2: {
      shout: '하늘로 오르려 한다!',
      // 승천 예고 2턴 → 대해일 35. 예고 중 피해 40을 주면 취소 (떨어짐 → 다시 물보라부터)
      moves: [
        { id: 'omen', name: '승천 예고', intent: 'unknown', ops: [{ op: 'charge', n: 50 }] },
        { id: 'omen2', name: '승천 예고', intent: 'unknown', ops: [{ op: 'charge', n: 50 }] },
        { id: 'wave', name: '대해일', intent: 'atk', ops: [{ op: 'dmg', n: 40 }] },
        { id: 'spray', name: '물보라', intent: 'atk', ops: [{ op: 'dmg', n: 9 }, { op: 'status', id: 'wet', n: 2 }] },
        { id: 'fall', name: '떨어짐', intent: 'unknown', ops: [] },
      ],
      ai: { type: 'cycle', order: ['omen', 'omen2', 'wave', 'spray'] },
    },
  },

  // ======================= 3막 · 저승 =======================
  {
    id: 'skeleton',
    name: '해골 병사',
    hp: [73, 79],
    art: 'e-skeleton',
    phase1: {
      moves: [
        { id: 'bone', name: '뼈칼', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
        { id: 'boneShield', name: '뼈 방패', intent: 'def', ops: [{ op: 'block', n: 14 }] },
        { id: 'rattle', name: '덜그럭', intent: 'buff', ops: [{ op: 'str', n: 3 }] },
      ],
      ai: { type: 'random', weights: [['bone', 50], ['boneShield', 25], ['rattle', 25]], noRepeat: true },
    },
  },
  {
    id: 'ferryman',
    name: '저승 뱃사공',
    hp: [92, 99],
    art: 'e-ferryman',
    phase1: {
      moves: [
        { id: 'river', name: '저승 물', intent: 'debuff', ops: [{ op: 'status', id: 'wet', n: 2 }, { op: 'status', id: 'poison', n: 3 }] },
        { id: 'oar', name: '노 휘두르기', intent: 'atk', ops: [{ op: 'dmg', n: 10, times: 2 }] },
        { id: 'fare', name: '뱃삯 받기', intent: 'atk', ops: [{ op: 'discardNext', n: 1 }, { op: 'dmg', n: 12 }] },
      ],
      ai: { type: 'cycle', order: ['river', 'oar', 'fare'] },
    },
  },
  {
    id: 'spirit3',
    name: '저승 원귀',
    hp: [62, 68],
    art: 'e-spirit',
    phase1: {
      moves: [
        { id: 'touch', name: '서늘한 손', intent: 'atk', ops: [{ op: 'dmg', n: 17 }] },
        { id: 'grudge', name: '원한', intent: 'atk', ops: [{ op: 'dmg', n: 13 }, { op: 'status', id: 'weak', n: 2 }] },
        { id: 'bind', name: '혼 묶기', intent: 'debuff', ops: [{ op: 'curse', id: 'chain', n: 1, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['touch', 'grudge', 'bind'] },
    },
  },
  {
    id: 'bomber',
    name: '불폭탄 귀신',
    hp: [44, 51],
    art: 'e-bomber',
    phase1: {
      moves: [
        { id: 'toss', name: '불씨 던지기', intent: 'atk', ops: [{ op: 'dmg', n: 7 }, { op: 'status', id: 'fire', n: 3 }] },
        { id: 'fuse', name: '심지 태우기', intent: 'buff', ops: [{ op: 'str', n: 5 }] },
        { id: 'boom', name: '펑', intent: 'atk', ops: [{ op: 'dmg', n: 23 }] },
      ],
      ai: { type: 'cycle', order: ['toss', 'fuse', 'boom'] },
    },
  },

  // ---------- 저승 보스 ----------
  {
    id: 'reaper',
    name: '저승사자',
    hp: [330, 330],
    art: 'b-reaper',
    boss: true,
    phase1: {
      moves: [
        { id: 'scythe', name: '명부 낫', intent: 'atk', ops: [{ op: 'dmg', n: 15 }] },
        { id: 'call', name: '이름 부르기', intent: 'debuff', ops: [{ op: 'curse', id: 'chain', n: 1, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['scythe', 'call'] },
    },
    phase2: {
      shout: '명부에 네 이름이 있다!',
      // 내 체력 30% 이하면 피해 2배
      passive: 'execute',
      moves: [{ id: 'scythe2', name: '낫 두 번', intent: 'atk', ops: [{ op: 'dmg', n: 10, times: 2 }] }],
      ai: { type: 'cycle', order: ['scythe2'] },
    },
  },
  {
    id: 'yagwanggwi',
    name: '야광귀',
    hp: [400, 400],
    art: 'b-yagwanggwi',
    eliteMod: { hp: 75, dmg: 125 },
    boss: true,
    phase1: {
      moves: [
        { id: 'shoes', name: '신발 훔치기', intent: 'atk', ops: [{ op: 'dmg', n: 6 }, { op: 'drain', n: 1 }] },
        { id: 'claw', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 20 }] },
      ],
      ai: { type: 'cycle', order: ['shoes', 'claw', 'claw'] },
    },
    phase2: {
      shout: '불을 꺼라… 어둠 속으로!',
      // 2턴마다 어둠 속 (받는 피해 -75%), 화상을 걸면 풀림
      moves: [
        { id: 'dark', name: '어둠 속', intent: 'buff', ops: [{ op: 'dark' }] },
        { id: 'claw', name: '할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 20 }] },
        { id: 'shoes', name: '신발 훔치기', intent: 'atk', ops: [{ op: 'dmg', n: 6 }, { op: 'drain', n: 1 }] },
      ],
      ai: { type: 'cycle', order: ['dark', 'claw', 'dark', 'shoes'] },
    },
  },
  {
    id: 'yeomra',
    name: '염라대왕',
    hp: [330, 330],
    art: 'b-yeomra',
    eliteMod: { hp: 65, dmg: 120 },
    boss: true,
    phase1: {
      moves: [
        { id: 'judge', name: '심판', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
        { id: 'karma', name: '업보', intent: 'atk', ops: [{ op: 'karma', k: 2 }] },
        { id: 'chains', name: '저승 사슬', intent: 'debuff', ops: [{ op: 'curse', id: 'chain', n: 2, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['judge', 'karma', 'chains'] },
    },
    phase2: {
      shout: '저승사자는 나와 죄를 물어라!',
      // 저승사자(체력 60) 소환, 업보 매 턴
      turnOps: [{ op: 'karma', k: 1 }],
      moves: [
        { id: 'summon', name: '저승사자 부르기', intent: 'buff', ops: [{ op: 'summon', id: 'reaperMinion', n: 1, max: 1 }] },
        { id: 'judge', name: '심판', intent: 'atk', ops: [{ op: 'dmg', n: 16 }] },
        { id: 'chains', name: '저승 사슬', intent: 'debuff', ops: [{ op: 'curse', id: 'chain', n: 2, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['summon', 'judge', 'chains'] },
    },
  },
  {
    id: 'reaperMinion',
    name: '저승사자',
    hp: [60, 60],
    art: 'b-reaper',
    minion: true,
    phase1: {
      moves: [
        { id: 'scythe', name: '명부 낫', intent: 'atk', ops: [{ op: 'dmg', n: 10 }] },
        { id: 'call', name: '이름 부르기', intent: 'debuff', ops: [{ op: 'curse', id: 'chain', n: 1, pile: 'draw' }] },
      ],
      ai: { type: 'cycle', order: ['scythe', 'call'] },
    },
  },

  // ======================= 숨은 4막 · 어둑시니 =======================
  {
    id: 'final',
    name: '어둑시니',
    hp: [450, 450],
    art: 'b-final',
    boss: true,
    // 내가 공격카드를 쓸 때마다 힘 +1 · 66%·33% 에서 커짐 (그림 230 → 262 → 296)
    rage: 1,
    phaseAt: [0.66, 0.33],
    grow: [230, 262, 296],
    phase1: {
      moves: [{ id: 'pounce', name: '덮침', intent: 'atk', ops: [{ op: 'dmg', n: 12 }] }],
      ai: { type: 'cycle', order: ['pounce'] },
    },
    phase2: {
      shout: '어둠이 부풀어 오른다!',
      moves: [
        { id: 'triple', name: '덮침 세 번', intent: 'atk', ops: [{ op: 'dmg', n: 8, times: 3 }] },
        { id: 'pounce', name: '덮침', intent: 'atk', ops: [{ op: 'dmg', n: 12 }] },
      ],
      ai: { type: 'cycle', order: ['triple', 'pounce'] },
    },
    phase3: {
      shout: '온 세상이 어둠에 잠긴다!',
      moves: [{ id: 'triple', name: '덮침 세 번', intent: 'atk', ops: [{ op: 'dmg', n: 8, times: 3 }] }],
      ai: { type: 'cycle', order: ['triple'] },
    },
  },

  // ======================= 갈림길의 여우 (이야기 정예, 정예 그림 e-fox-elite) =======================
  {
    id: 'foxElite',
    name: '천년 여우',
    hp: [82, 88],
    art: 'e-fox-elite',
    phase1: {
      moves: [
        { id: 'claw', name: '아홉 갈래 할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 6, times: 2 }] },
        { id: 'foxfire', name: '여우불', intent: 'atk', ops: [{ op: 'dmg', n: 6 }, { op: 'status', id: 'fire', n: 3 }] },
        { id: 'charm', name: '홀리기', intent: 'debuff', ops: [{ op: 'status', id: 'weak', n: 2 }, { op: 'dodge', n: 1 }] },
      ],
      ai: { type: 'cycle', order: ['claw', 'foxfire', 'charm'] },
    },
  },
  {
    id: 'foxElite2',
    name: '천년 여우',
    hp: [130, 140],
    art: 'e-fox-elite',
    phase1: {
      moves: [
        { id: 'claw', name: '아홉 갈래 할퀴기', intent: 'atk', ops: [{ op: 'dmg', n: 8, times: 2 }] },
        { id: 'foxfire', name: '여우불', intent: 'atk', ops: [{ op: 'dmg', n: 9 }, { op: 'status', id: 'fire', n: 4 }] },
        { id: 'charm', name: '홀리기', intent: 'debuff', ops: [{ op: 'status', id: 'weak', n: 2 }, { op: 'dodge', n: 1 }, { op: 'str', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['claw', 'foxfire', 'charm'] },
    },
  },
];

// ======================= 강해진 요괴 (2·3막 뒤쪽 일반 전투에 가끔 1마리, 정예 그림 e-*-elite) =======================
/** 강해진 요괴 체력·공격·방어 배수 (정한 값, 11-26 사용자 확정 A5) */
export const STRONG_HP = 1.25;
export const STRONG_DMG = 1.2;

/** 일반 요괴의 정예판: 이름 앞에 '사나운', 체력 ×STRONG_HP, 공격 피해·방어 ×STRONG_DMG (반올림) */
function strongOf(baseId: string, art: string): EnemyDef {
  const b = BASE.find((e) => e.id === baseId)!;
  const d: EnemyDef = JSON.parse(JSON.stringify(b));
  d.id = `${baseId}Strong`;
  d.name = `사나운 ${b.name}`;
  d.art = art;
  d.strong = baseId;
  d.hp = [Math.round(b.hp[0] * STRONG_HP), Math.round(b.hp[1] * STRONG_HP)];
  for (const m of d.phase1.moves)
    for (const op of m.ops as { op: string; n?: number }[]) if ((op.op === 'dmg' || op.op === 'block') && typeof op.n === 'number') op.n = Math.round(op.n * STRONG_DMG);
  return d;
}

const STRONG: EnemyDef[] = [
  strongOf('guard', 'e-guard-elite'),
  strongOf('spirit', 'e-spirit-elite'),
  strongOf('water', 'e-water-elite'),
  strongOf('skeleton', 'e-skeleton-elite'),
  strongOf('spirit3', 'e-spirit-elite'),
];

export const ENEMIES: EnemyDef[] = [...BASE, ...STRONG];
