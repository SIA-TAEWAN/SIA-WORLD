/**
 * 공격·스킬을 이루는 동작 조각. 무기 기본 공격, 무기 스킬, 대원 고유 스킬이 모두 이 조각들의 목록이다.
 * 전투(src/game/sim.ts)는 조각 종류만 알고, 무기·대원 이름은 모른다.
 */

/** 맞는 범위 (대원 위치 · 바라보는 방향 기준) */
export type Shape =
  | { k: 'arc'; r: number; half: number } // 부채꼴 (half = 반각, 라디안)
  | { k: 'line'; len: number; w: number } // 앞으로 긴 직사각형
  | { k: 'circle'; r: number }; // 내 둘레 전체

/** 맞은 요괴에게 붙는 효과 */
export interface OnHit {
  /** 밀려나는 세기 */
  kb?: number;
  /** 기절 (초) */
  stun?: number;
  /** 느려짐 */
  slow?: { mul: number; dur: number };
  /** 불·독: dur 초 동안 초당 (공격력 × mul) 피해 */
  dot?: { mul: number; dur: number };
}

export type ShotLook = 'arrow' | 'spear' | 'orb';
export type ZoneLook = 'rain' | 'wind' | 'poison';

/** at = 버튼을 누른 뒤 이 시간(초)이 지나서 나간다 */
export type Act =
  /** 범위 한 번 때리기. quiet = 맞은 요괴가 있을 때만 휘두른 자국을 그린다 (활·부채의 밀쳐 내기) */
  | ({ t: 'hit'; at?: number; shape: Shape; mul: number; quiet?: boolean } & OnHit)
  /** 날아가는 것 n 발 (spread = 발 사이 각도). pierce = 뚫고 지나가는 요괴 수 */
  | ({ t: 'shot'; at?: number; n: number; spread: number; speed: number; range: number; radius: number; mul: number; pierce: number; look: ShotLook } & OnHit)
  /** 앞으로 돌진하며 지나간 자리의 요괴를 벤다 (돌진 동안 무적) */
  | ({ t: 'dash'; at?: number; dist: number; time: number; w: number; mul: number } & OnHit)
  /** 땅에 남는 범위: tick 초마다 피해. aim = 이 거리 안의 가까운 요괴 자리에(없으면 ahead 만큼 앞에), pull = 가운데로 끌어당기는 속도 */
  | ({ t: 'zone'; at?: number; look: ZoneLook; ahead: number; aim?: number; r: number; dur: number; tick: number; mul: number; pull?: number } & OnHit)
  /** 가까운 요괴부터 차례로 옮겨 가며 때린다 (옮길 때마다 피해 × falloff) */
  | ({ t: 'chain'; at?: number; range: number; jumps: number; jumpRange: number; mul: number; falloff: number } & OnHit)
  /** 회복 (최대치의 비율) */
  | { t: 'heal'; at?: number; hp?: number; mp?: number }
  /** 잠깐 강해지기: atk·speed 는 배율, crit 은 더하기, guard 는 받는 피해 배율 */
  | { t: 'buff'; at?: number; dur: number; atk?: number; speed?: number; crit?: number; guard?: number };
