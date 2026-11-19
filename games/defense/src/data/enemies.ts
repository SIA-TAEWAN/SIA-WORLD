import type { ZodiacId } from './balance';

/**
 * 일반 요괴 (PRD 5장). 수치는 1지역 첫 웨이브 기준이고, 스테이지의 체력 배율(stage.hp)과 웨이브 배율(WAVE_HP)이 곱해진다.
 * 새 요괴 = 여기에 한 줄 (+ 그림 public/art/e-<id>.png 와 scenes/art.ts 의 ART_FILES).
 * 특성은 칸으로 적는다 (계산은 src/game/core.ts · sim.ts 가 칸을 읽는다):
 *   air 공중 · regen 회복 · cycle + stealth 숨었다 나왔다 · cycle + ghost 무적이 됐다 풀렸다 · shield 정면 방패 · revive 되살아남
 */
export interface EnemyDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  /** 이동 속도 (px/초) */
  speed: number;
  /** 처치하면 얻는 기운 */
  bounty: number;
  /** 판정 원 반지름 (범위 공격이 닿는 거리 계산) */
  r: number;
  /** 화면에 그리는 크기 (px) */
  size: number;
  /** 공중 요괴: 길이 아니라 공중 경로(route.air)로 온다. 공중을 맞힐 수 있는 캐릭터만 노릴 수 있다 */
  air?: boolean;
  /** 초마다 최대 체력의 이 비율을 회복한다 (독에 걸린 동안에는 회복하지 못한다) */
  regen?: number;
  /** 주기: on 초 동안 특성이 켜지고 off 초 동안 꺼진다 (stealth · ghost 가 쓴다) */
  cycle?: { on: number; off: number };
  /** 은신: 켜진 동안에는 감지하는 캐릭터의 사거리 밖에서 노릴 수 없다 */
  stealth?: boolean;
  /** 무적: 켜진 동안에는 피해를 받지 않는다 (멈춤·감속은 먹힌다) */
  ghost?: boolean;
  /** 정면 방패: 요괴가 가는 쪽(앞)에서 온 공격은 이 배율만 받는다. 관통·독·범위 폭발은 그대로 받는다 */
  shield?: number;
  /** 쓰러져도 이 횟수만큼 되살아난다 */
  revive?: number;
  /** 잘 듣는 캐릭터 (출전 준비·도감에 보여 준다) */
  weak: ZodiacId[];
}

export const ENEMIES: EnemyDef[] = [
  { id: 'imp', name: '꼬마 도깨비', desc: '기본 요괴. 무리 지어 와요', hp: 92, speed: 58, bounty: 6, r: 18, size: 64, weak: ['rabbit', 'dragon'] },
  { id: 'wisp', name: '도깨비불', desc: '빠르고 약해요', hp: 48, speed: 112, bounty: 5, r: 14, size: 54, weak: ['rat', 'sheep'] },
  { id: 'club', name: '방망이 도깨비', desc: '느리고 단단해요', hp: 430, speed: 36, bounty: 16, r: 22, size: 84, weak: ['snake', 'horse'] },
  { id: 'water', name: '물귀신', desc: '체력이 조금씩 회복돼요', hp: 170, speed: 52, bounty: 9, r: 18, size: 66, regen: 0.05, weak: ['tiger', 'snake'] },
  { id: 'fox', name: '여우불', desc: '공중으로 날아 길을 가로질러 와요', hp: 64, speed: 78, bounty: 8, r: 16, size: 60, air: true, weak: ['monkey'] },
  { id: 'bamboo', name: '죽순 요괴', desc: '땅속으로 숨어 이동해요. 가끔 고개를 내밀어요', hp: 130, speed: 60, bounty: 9, r: 16, size: 60, stealth: true, cycle: { on: 3.2, off: 1.6 }, weak: ['dog', 'monkey'] },
];

export const ENEMY_INDEX: Record<string, number> = Object.fromEntries(ENEMIES.map((e, i) => [e.id, i]));
