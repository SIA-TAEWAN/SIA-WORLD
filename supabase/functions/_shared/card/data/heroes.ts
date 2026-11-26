/**
 * 영웅 13종 (games/card/src/data/heroes.json 과 같은 내용). 값은 PRD 사용자 스펙 그대로.
 * 시작 덱 = 베기5 + 막기4 + 전용카드1. ready = 고를 수 있음 (3단계부터 13명 전부).
 * 고양이는 locked — 해금·구매는 5단계, 지금은 테스트 모드(?local=1)에서만 고를 수 있다.
 * 패시브 효과: 전투 쪽은 battle.ts, 쉼터·보상·승리 회복은 run.ts (run.hero 로 나눈다).
 */
import type { HeroDef } from '../types.ts';

export const HEROES: HeroDef[] = [
  { id: 'rat', name: '찍찍이', animal: '쥐', hp: 64, passive: '턴 시작 1장 더', cards: ['ratHole', 'ratFire'], ready: true },
  { id: 'ox', name: '우직이', animal: '소', hp: 85, passive: '턴 끝 남은 방어 절반 유지', cards: ['headbutt', 'steadfast'], ready: true },
  { id: 'tiger', name: '어흥이', animal: '호랑이', hp: 72, passive: '전투 시작 모든 적 약화1', cards: ['tigerClaw', 'tigerMajesty'], ready: true },
  { id: 'rabbit', name: '깡총이', animal: '토끼', hp: 66, passive: '쉼터 회복 +10', cards: ['hop', 'mortar'], ready: true },
  { id: 'dragon', name: '여의룡', animal: '용', hp: 75, passive: '전투 첫 턴 기력+1', cards: ['dragonBreath', 'ascend'], ready: true },
  { id: 'snake', name: '스르르', animal: '뱀', hp: 68, passive: '턴마다 첫 공격카드에 독1', cards: ['coil', 'shed'], ready: true },
  { id: 'horse', name: '따각이', animal: '말', hp: 70, passive: '턴마다 첫 공격카드 +3', cards: ['charge', 'galloper'], ready: true },
  { id: 'sheep', name: '몽실이', animal: '양', hp: 74, passive: '전투 시작 방어6', cards: ['woolShield', 'shear'], ready: true },
  { id: 'monkey', name: '재롱이', animal: '원숭이', hp: 64, passive: '카드 보상 선택지 4장', cards: ['mimic', 'cloneArt'], ready: true },
  { id: 'rooster', name: '꼬꼬댁', animal: '닭', hp: 66, passive: '전투 첫 턴 2장 더', cards: ['peck', 'crow'], ready: true },
  { id: 'dog', name: '멍뭉이', animal: '개', hp: 76, passive: '체력 50% 이하면 피해 +25%', cards: ['watchdog', 'track'], ready: true },
  { id: 'pig', name: '꿀꿀이', animal: '돼지', hp: 90, passive: '전투 승리 시 체력3 회복', cards: ['bellyFlop', 'gluttony'], ready: true },
  { id: 'cat', name: '야옹이', animal: '고양이', hp: 70, passive: '한 판에 한 번 쓰러질 피해를 받으면 체력1로 버티고 방어10', cards: ['scratch', 'sneak'], ready: true, locked: true },
];
