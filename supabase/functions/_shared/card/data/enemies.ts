/**
 * 요괴·보스 데이터 (games/card/src/data/enemies.json 과 같은 내용).
 * 보스 체력·행동 이름·수치는 PRD 사용자 스펙 그대로. 일반 요괴의 체력·행동 수치는 스펙에 없어 정한 값(PROGRESS.md '물어볼 것').
 * 1~2단계: 대나무숲 요괴 4종 + 보스 3종(구미호·장산범·왕지네, 정식 패턴 다듬기는 4단계).
 */
import type { EnemyDef } from '../types.ts';

export const ENEMIES: EnemyDef[] = [
  // ---------- 대나무숲 요괴 ----------
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
      moves: [
        { id: 'claw2', name: '할퀴기 + 분신', intent: 'atk', ops: [{ op: 'summon', id: 'gumihoClone', n: 1, max: 4 }, { op: 'dmg', n: 9 }] },
        { id: 'foxfire2', name: '여우불 + 분신', intent: 'atk', ops: [{ op: 'summon', id: 'gumihoClone', n: 1, max: 4 }, { op: 'dmg', n: 6 }, { op: 'status', id: 'fire', n: 2 }] },
      ],
      ai: { type: 'cycle', order: ['claw2', 'foxfire2'] },
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
    hp: [140, 140],
    art: 'b-jangsanbeom',
    boss: true,
    phase1: {
      moves: [
        { id: 'mimicry', name: '흉내 소리', intent: 'atk', ops: [{ op: 'discardNext', n: 1 }, { op: 'dmg', n: 8 }] },
        { id: 'warn', name: '덮치기 예고', intent: 'unknown', ops: [] },
        { id: 'pounce', name: '덮치기', intent: 'atk', ops: [{ op: 'dmg', n: 14 }] },
      ],
      ai: { type: 'cycle', order: ['mimicry', 'warn', 'pounce'] },
    },
    phase2: {
      shout: '하얀 털이 곤두선다!',
      moves: [
        { id: 'pounce2', name: '덮치기', intent: 'atk', ops: [{ op: 'dmg', n: 14 }] },
        { id: 'hide', name: '숨기', intent: 'buff', ops: [{ op: 'dodge', n: 1 }] },
      ],
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
      moves: [{ id: 'legs', name: '다리 훑기', intent: 'atk', ops: [{ op: 'dmg', n: 4, times: 4 }] }],
      ai: { type: 'cycle', order: ['legs'] },
    },
  },
];
