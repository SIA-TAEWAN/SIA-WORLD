// 기체 목록. M1 은 청룡호 하나만 (나머지 12종은 M3).
import { MATGO, TABLE } from '../theme';

// speed = 키보드로 움직일 때 한 스텝(1/60초) 거리. 드래그는 손가락이 움직인 만큼 따라간다.
export type ShipId = 'dragon';

export interface Ship {
  id: ShipId;
  name: string;
  pilot: string;
  animal: string;
  speed: number;
  /** 임시 그림 색 (몸통 · 날개, 작은 면이라 기존 토큰에서 고름). 새 그림이 오면 쓰지 않는다 */
  color: [number, number];
  shot: string;
  charge: string;
  bomb: string;
}

export const SHIPS: Record<ShipId, Ship> = {
  dragon: {
    id: 'dragon', name: '청룡호', pilot: '여의룡', animal: '용', speed: 9,
    color: [TABLE.matgo, MATGO.matDark],
    shot: '전방 집중 발칸', charge: '관통 레이저', bomb: '화면 세로 화염',
  },
};
