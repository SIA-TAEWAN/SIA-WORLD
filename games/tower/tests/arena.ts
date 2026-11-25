/**
 * 시험용 빈 방: 벽 두른 방 하나 (19×13 안쪽 바닥). 글자 그리드를 주면 rooms.json 과 같은 글자로 칸을 놓는다.
 * 캐릭터는 가운데, 오른쪽을 본다.
 */
import { INNER_H, INNER_W } from '../src/data';
import { ROOM_H, ROOM_W, T, TILE, type FloorMap, type Obj } from '../src/game/floorgen';
import { newData, type TowerData } from '../src/game/progress';
import { BODY_UP, addEnemy, createRun, noInput, step, type Enemy, type Input, type RunState } from '../src/game/sim';

export function arena(opts: { floor?: number; level?: number; orb?: string; awaken?: boolean; grid?: string[]; data?: Partial<TowerData> } = {}): RunState {
  const floor = opts.floor ?? 12;
  const w = ROOM_W;
  const h = ROOM_H;
  const tiles = new Array<number>(w * h).fill(T.WALL);
  const objs: Obj[] = [];
  const gates: { x: number; y: number }[] = [];
  const pending: Obj[] = [];
  for (let iy = 0; iy < INNER_H; iy++) {
    for (let ix = 0; ix < INNER_W; ix++) {
      const c = opts.grid?.[iy]?.[ix] ?? '.';
      const x = ix + 1;
      const y = iy + 1;
      let t: number = T.FLOOR;
      if (c === '#') t = T.PILLAR;
      if (c === '~') t = T.WATER;
      if (c === 'g') (t = T.GATE), gates.push({ x, y });
      if (c === 'C') (t = T.CHEST), objs.push({ id: 0, kind: 'chest', x, y, room: 0, table: 'puzzle' });
      if (c === 'q') (t = T.PLATE), pending.push({ id: 0, kind: 'plate', x, y, room: 0 });
      if (c === 'h') (t = T.BRAZIER), pending.push({ id: 0, kind: 'brazier', x, y, room: 0 });
      if (c === 'p') (t = T.POST), objs.push({ id: 0, kind: 'post', x, y, room: 0 });
      tiles[y * w + x] = t;
    }
  }
  for (const o of pending) objs.push({ ...o, gates });
  objs.forEach((o, i) => (o.id = i));
  const map: FloorMap = {
    floor, zone: Math.ceil(floor / 10), kind: 'normal', seed: 7, w, h, tiles, objs, stairsHidden: false,
    rooms: [{ id: 0, kind: 'combat', tpl: 'arena', cx: 0, cy: 0, x0: 0, y0: 0, side: false, doors: [], spawns: [] }],
    start: { x: Math.floor(w / 2) * TILE + 8, y: Math.floor(h / 2) * TILE + 8 },
  };
  const d = { ...newData(5), level: opts.level ?? floor, best: floor, ...opts.data };
  if (opts.orb) {
    d.orbs = { ...d.orbs, [opts.orb]: 1 };
    d.equipped = opts.orb;
    if (opts.awaken) d.awakened = [...d.awakened, opts.orb];
  }
  const s = createRun(map, d);
  s.p.face = 2;
  s.p.mp = s.p.stats.mp;
  s.room = 0;
  return s;
}

/** 캐릭터 몸 기준으로 (dx, dy) 자리에 적 (움직이지 않게 wake 를 길게) */
export function foe(s: RunState, id: string, dx: number, dy = 0, still = true): Enemy {
  const e = addEnemy(s, id, s.p.x + dx, s.p.y - BODY_UP + dy);
  if (still) e.wake = 999;
  // 문이 잠긴 싸움 (싸움 밖 회복이 없게)
  s.locked.add(0);
  return e;
}

export const press = (s: RunState, k: keyof Input, n = 1) => {
  step(s, { ...noInput(), [k]: true });
  for (let i = 1; i < n; i++) step(s, noInput());
};
export const wait = (s: RunState, sec: number, inp: Partial<Input> = {}) => {
  for (let i = 0; i < Math.round(sec * 60); i++) step(s, { ...noInput(), ...inp });
};
