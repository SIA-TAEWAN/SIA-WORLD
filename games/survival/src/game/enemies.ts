/**
 * 요괴의 움직임. 종류마다 함수 하나를 MOVES 에 등록한다 (data/enemies.ts 의 move).
 * 등록되지 않은 이름(6단계의 맵 전용 요괴)은 곧장 쫓아온다.
 */
import { PLAYER, SEPARATION, SPAWN, TICK } from '../data/balance';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { updateBoss } from './bosses';
import { addProjectile, dmgGrowth, edgePoint, hurtPlayer } from './core';
import { MODE, PROJ, type Enemy, type State } from './state';

export type EnemyMove = (s: State, e: Enemy, def: EnemyDef, dx: number, dy: number, d: number) => void;

/** 곧장 쫓아온다 */
const chase: EnemyMove = (_s, e, _def, dx, dy, d) => {
  if (d < 1) return;
  const v = (e.speed * TICK) / d;
  e.x += dx * v;
  e.y += dy * v;
};

/** 물귀신: 옆으로 출렁이며 다가온다 */
const wave: EnemyMove = (_s, e, def, dx, dy, d) => {
  if (d < 1) return;
  const v = (e.speed * TICK) / d;
  const w = def.wave ?? { amp: 80, freq: 4 };
  // 나아가는 방향에 수직으로 흔들린다 (요괴마다 박자가 다르게)
  const side = (Math.sin(e.t * w.freq + e.uid) * w.amp * TICK) / d;
  e.x += dx * v - dy * side;
  e.y += dy * v + dx * side;
};

/** 여우불: 거리를 두고 맴돌며 불을 쏜다 */
const ranged: EnemyMove = (s, e, def, dx, dy, d) => {
  const sh = def.shoot;
  if (!sh || d < 1) return chase(s, e, def, dx, dy, d);
  const v = (e.speed * TICK) / d;
  if (d > sh.keep + 30) {
    e.x += dx * v;
    e.y += dy * v;
  } else if (d < sh.keep - 60) {
    e.x -= dx * v * 0.6;
    e.y -= dy * v * 0.6;
  } else {
    // 맴돈다 (요괴마다 도는 방향이 다르게)
    const dir = e.uid % 2 ? 0.5 : -0.5;
    e.x += -dy * v * dir;
    e.y += dx * v * dir;
  }
  e.cd -= TICK;
  if (e.cd <= 0 && d < sh.range) {
    e.cd = sh.every;
    const speed = sh.speed;
    addProjectile(s, PROJ.foxfire, MODE.enemy, 7, -1, e.x, e.y, (dx / d) * speed, (dy / d) * speed, sh.size, sh.dmg * dmgGrowth(s), (sh.range * 1.5) / speed);
  }
};

export const MOVES: Record<string, EnemyMove> = { chase, wave, ranged };

const MOVE_OF = ENEMIES.map((d) => MOVES[d.move] ?? chase);
const PT = { x: 0, y: 0 };

/** 요괴끼리 겹치지 않게 서로 밀어낸다 (같은 칸과 이웃 칸만 본다) */
function pushApart(a: Enemy, b: Enemy) {
  if (a.dead || b.dead) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = (a.r + b.r) * 0.85;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  if (d2 < 0.0001) {
    // 정확히 같은 자리: 번호로 방향을 정해 떼어 놓는다
    b.x += a.uid < b.uid ? 0.5 : -0.5;
    return;
  }
  const d = Math.sqrt(d2);
  const push = ((rr - d) / d) * 0.5 * SEPARATION;
  // 보스는 밀리지 않는다
  if (a.boss < 0) {
    a.x -= dx * push;
    a.y -= dy * push;
  }
  if (b.boss < 0) {
    b.x += dx * push;
    b.y += dy * push;
  }
}

function separate(s: State) {
  const g = s.grid;
  const { start, items, cols, rows } = g;
  const list = s.enemies.items;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = row * cols + col;
      const a0 = start[c];
      const a1 = start[c + 1];
      if (a0 === a1) continue;
      for (let k = a0; k < a1; k++) {
        const a = list[items[k]];
        for (let m = k + 1; m < a1; m++) pushApart(a, list[items[m]]);
        if (col + 1 < cols) for (let m = start[c + 1]; m < start[c + 2]; m++) pushApart(a, list[items[m]]);
        if (row + 1 < rows) {
          const d = c + cols;
          const from = col > 0 ? start[d - 1] : start[d];
          const to = col + 1 < cols ? start[d + 2] : start[d + 1];
          for (let m = from; m < to; m++) pushApart(a, list[items[m]]);
        }
      }
    }
  }
}

/** 걸음마다: 모든 요괴를 움직이고, 내게 닿았으면 피해를 준다 */
export function updateEnemies(s: State) {
  const p = s.player;
  const list = s.enemies.items;
  const n = s.enemies.n;
  const touch = PLAYER.r * 0.8;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (e.dead) continue;
    e.t += TICK;
    if (e.flash > 0) e.flash--;
    let dx = p.x - e.x;
    let dy = p.y - e.y;
    // 너무 멀어진 요괴는 내 근처(화면 밖 둘레)로 다시 놓는다 (PRD 3장)
    if (dx > SPAWN.farW || dx < -SPAWN.farW || dy > SPAWN.farH || dy < -SPAWN.farH) {
      edgePoint(s, PT);
      e.x = PT.x;
      e.y = PT.y;
      dx = p.x - e.x;
      dy = p.y - e.y;
    }
    const d = Math.sqrt(dx * dx + dy * dy);
    if (e.boss >= 0) updateBoss(s, e, dx, dy, d);
    else MOVE_OF[e.kind](s, e, ENEMIES[e.kind], dx, dy, d);
    const ex = p.x - e.x;
    const ey = p.y - e.y;
    const rr = e.r + touch;
    if (ex * ex + ey * ey < rr * rr) hurtPlayer(s, e.dmg);
  }
  separate(s);
}
