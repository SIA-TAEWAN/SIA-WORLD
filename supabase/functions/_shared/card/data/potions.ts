/**
 * 물약 (games/card/src/data/potions.json 과 같은 내용). 스펙은 '최대 3개, 기력 없이 사용'만 정해서
 * 종류·수치는 정한 값이다 (PROGRESS.md '물어볼 것').
 */
import type { PotionDef } from '../types.ts';

export const POTIONS: PotionDef[] = [
  { id: 'heal', name: '회복 물약', text: '체력 15 회복', target: 'none', ops: [{ op: 'heal', n: 15 }], art: 'ic-acc-potion' },
  { id: 'block', name: '방어 물약', text: '방어 12', target: 'none', ops: [{ op: 'block', n: 12 }], art: 'ic-armor' },
  { id: 'energy', name: '기력 물약', text: '기력 +2', target: 'none', ops: [{ op: 'energy', n: 2 }], art: 'ic-mp' },
  { id: 'fire', name: '불 물약', text: '적 하나에 피해 15', target: 'enemy', ops: [{ op: 'dmg', n: 15 }], art: 'fx-flame' },
  { id: 'swift', name: '날쌘 물약', text: '카드 3장 뽑기', target: 'none', ops: [{ op: 'draw', n: 3 }], art: 'ic-acc-speed' },
];
