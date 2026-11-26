/**
 * 부적 30개 (games/card/src/data/relics.json 과 같은 내용). 값은 PRD 사용자 스펙 그대로.
 * 효과는 이름(id)으로 battle.ts · run.ts 에서 건다 (RELIC_READY = 효과까지 구현된 것).
 */
import type { RelicDef } from '../types.ts';

export const RELICS: RelicDef[] = [
  // 일반
  { id: 'gourd', name: '호리병', rarity: 'common', text: '전투 후 체력6', art: 'ic-acc-potion' },
  { id: 'luckyPouch', name: '복주머니', rarity: 'common', text: '엽전+30%', art: 'ic-acc-coin' },
  { id: 'goblinClub', name: '도깨비 방망이', rarity: 'common', text: '전투 첫 턴 기력+1', art: 'ic-w-sword-0' },
  { id: 'woodShield', name: '나무 방패', rarity: 'common', text: '전투 시작 방어8', art: 'ic-w-fan-3' },
  { id: 'cairnStone', name: '돌탑 조각', rarity: 'common', text: '최대 체력+8', art: 'ic-stone' },
  { id: 'whetstone', name: '숫돌', rarity: 'common', text: '전투마다 첫 공격카드 +4', art: 'ic-w-sword-2' },
  { id: 'strawShoes', name: '짚신', rarity: 'common', text: '전투 첫 턴 2장 더', art: 'ic-acc-speed' },
  { id: 'rope', name: '새끼줄', rarity: 'common', text: '3턴마다 방어6', art: 'ic-w-fan-4' },
  { id: 'sorghum', name: '수수깡', rarity: 'common', text: '체력 50% 이하가 되면 한 번 체력10', art: 'ic-hp' },
  { id: 'emberCharm', name: '불씨', rarity: 'common', text: '내가 거는 화상+1', art: 'p-fire' },
  { id: 'snakeFang', name: '독사 이빨', rarity: 'common', text: '전투 시작 모든 적 독2', art: 'ic-w-spear-2' },
  { id: 'umbrella', name: '우산', rarity: 'common', text: '젖음 면역', art: 'ic-w-fan-7' },
  { id: 'janggu', name: '장구', rarity: 'common', text: '전투 시작 모든 적 약화1', art: 'ic-w-bow-1' },
  { id: 'coinPurse', name: '엽전 돈주머니', rarity: 'common', text: '얻을 때 엽전+100', art: 'ic-coin' },
  // 고급
  { id: 'tigerWhisker', name: '호랑이 수염', rarity: 'uncommon', text: '정예·보스 피해+20%', art: 'ic-u-tiger' },
  { id: 'smithHammer', name: '대장간 망치', rarity: 'uncommon', text: '쉼터 강화 한 장 더', art: 'ic-w-sword-4' },
  { id: 'treasureMap', name: '보물 지도', rarity: 'uncommon', text: '지도에 보물 칸+2', art: 'ic-key' },
  { id: 'moonOrb', name: '달빛 구슬', rarity: 'uncommon', text: '턴 끝 손패 1장 남길 수 있음', art: 'p-orb' },
  { id: 'beoseon', name: '버선 한 쌍', rarity: 'uncommon', text: '전투에 한 번 첫 카드 기력-1', art: 'ic-w-fan-8' },
  { id: 'bambooTube', name: '대나무 통', rarity: 'uncommon', text: '소멸 카드 쓸 때마다 방어4', art: 'ic-w-spear-3' },
  { id: 'magpieFeather', name: '까치 깃털', rarity: 'uncommon', text: '고급 이상 카드가 더 자주', art: 'ic-star' },
  { id: 'wildGinseng', name: '산삼', rarity: 'uncommon', text: '쉼터 회복+15', art: 'fx-heal' },
  { id: 'iceJar', name: '얼음 항아리', rarity: 'uncommon', text: '턴이 끝나도 방어3 남김', art: 'ic-w-fan-9' },
  { id: 'thunderFan', name: '번개 부채', rarity: 'uncommon', text: '젖은 적 공격 시 +3', art: 'ic-sk-bolt' },
  // 보스
  { id: 'dragonPearl', name: '여의주 조각', rarity: 'boss', text: '매 턴 기력+1, 쉼터 회복 불가', art: 'ic-u-dragon' },
  { id: 'yeomraLedger', name: '염라의 장부', rarity: 'boss', text: '매 턴 기력+1, 전투 시작 시 저승 사슬1', art: 'ic-w-bow-8' },
  { id: 'foxOrb', name: '구미호 구슬', rarity: 'boss', text: '전투 시작 분신이 첫 공격 대신 맞음', art: 'p-foxorb' },
  { id: 'bulgasalIron', name: '불가살 쇠조각', rarity: 'boss', text: '한 판에 한 번 쓰러지면 20%로 부활', art: 'ic-armor' },
  { id: 'imugiScale', name: '이무기 비늘', rarity: 'boss', text: '매 턴 1장 더, 손패 최대 7', art: 'ic-w-spear-4' },
  { id: 'dokkaebiClub', name: '큰도깨비 방망이', rarity: 'boss', text: '엽전 쓸 때 25% 돌려받음', art: 'ic-w-sword-5' },
];
