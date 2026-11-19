import type { ZodiacId } from './balance';

/**
 * 일반 요괴 (PRD 5장). 수치는 1지역 첫 웨이브 기준이고, 스테이지의 체력 배율(stage.hp)과 웨이브 배율(WAVE_HP)이 곱해진다.
 * 새 요괴 = 여기에 한 줄 (+ 그림 public/art/e-<id>.png 와 scenes/art.ts 의 ART_FILES).
 * 1~3단계에는 1지역의 2종만 있다. 나머지 7종(방망이 도깨비·물귀신·여우불·죽순 요괴·수문장 요괴·해골 병사·원혼)은
 * 5~6단계에서 특성 칸(air 공중 · 그 밖의 특성)과 함께 추가한다.
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
  /** 공중 요괴: 길이 아니라 공중 경로(route.air)로 온다 */
  air?: boolean;
  /** 잘 듣는 캐릭터 (출전 준비·도감에 보여 준다) */
  weak: ZodiacId[];
}

export const ENEMIES: EnemyDef[] = [
  { id: 'imp', name: '꼬마 도깨비', desc: '기본 요괴. 무리 지어 와요', hp: 92, speed: 58, bounty: 6, r: 18, size: 64, weak: ['rabbit', 'dragon'] },
  { id: 'wisp', name: '도깨비불', desc: '빠르고 약해요', hp: 48, speed: 112, bounty: 5, r: 14, size: 54, weak: ['rat', 'sheep'] },
];

export const ENEMY_INDEX: Record<string, number> = Object.fromEntries(ENEMIES.map((e, i) => [e.id, i]));
