/**
 * 요괴의 움직임. 종류마다 함수 하나를 MOVES 에 등록한다 (data/enemies.ts 의 move).
 * 등록되지 않은 이름은 곧장 쫓아온다.
 */
import { PLAYER, SEPARATION, SPAWN, TICK } from '../data/balance';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { updateBoss } from './bosses';
import { addFx, addProjectile, dmgGrowth, edgePoint, hurtPlayer } from './core';
import { FX, MODE, PROJ, type Enemy, type State } from './state';
import { OUT, PUSH, pushOut } from './terrain';

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

/**
 * 죽순 요괴: 땅속에 숨어 있다가(sub 0) 가까이 가면 튀어나와(sub 1, 잠깐) 빠르게 쫓아온다(sub 2).
 * 숨어 있는 동안에는 맞지 않고 닿아도 피해가 없다.
 */
const ambush: EnemyMove = (s, e, def, dx, dy, d) => {
  if (e.sub === 0) {
    e.hidden = true;
    if (d < (def.extra?.wakeR ?? 150)) {
      e.sub = 1;
      e.patT = def.extra?.wakeSec ?? 0.4;
      addFx(s, FX.puff, e.x, e.y, e.r * 1.4, 0, 0, 0.3);
    }
    return;
  }
  if (e.sub === 1) {
    e.patT -= TICK;
    if (e.patT <= 0) {
      e.sub = 2;
      e.hidden = false;
    }
    return;
  }
  chase(s, e, def, dx, dy, d);
};

/**
 * 수문장 요괴: 줄지어 한 방향으로 밀고 들어온다. 방향을 천천히만 틀고(ax, ay 가 지금 방향) 줄에서의 제 자리를 지키며,
 * 옆으로 비키면 지나쳐 갔다가 크게 돌아온다.
 */
const line: EnemyMove = (_s, e, def, dx, dy, d) => {
  if (d < 1) return;
  if (e.ax === 0 && e.ay === 0) {
    e.ax = dx / d;
    e.ay = dy / d;
  }
  // 지금 방향에서 내 쪽으로 조금씩만 돈다. 줄지어 온 요괴는 줄에서의 제 자리(patT)만큼 옆을 겨눈다
  const turn = (def.extra?.turn ?? 0.7) * TICK;
  const tx = dx - e.ay * e.patT;
  const ty = dy + e.ax * e.patT;
  const td = Math.hypot(tx, ty) || 1;
  const cross = e.ax * (ty / td) - e.ay * (tx / td);
  const a = cross > 0 ? turn : -turn;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const nx = e.ax * cos - e.ay * sin;
  const ny = e.ax * sin + e.ay * cos;
  e.ax = nx;
  e.ay = ny;
  e.x += e.ax * e.speed * TICK;
  e.y += e.ay * e.speed * TICK;
};

/** 해골 병사: 쓰러져 있는 동안(sub 1) 가만히 누워 있다가 되살아난다(sub 2). 쓰러뜨리는 처리는 core.ts 의 killEnemy */
const revive: EnemyMove = (s, e, def, dx, dy, d) => {
  if (e.sub === 1) {
    e.patT -= TICK;
    if (e.patT <= 0) {
      e.sub = 2;
      e.hidden = false;
      e.hp = e.maxHp * (def.extra?.reviveHp ?? 0.6);
      addFx(s, FX.puff, e.x, e.y, e.r * 1.4, 0, 0, 0.3);
    }
    return;
  }
  chase(s, e, def, dx, dy, d);
};

export const MOVES: Record<string, EnemyMove> = { chase, wave, ranged, ambush, line, revive, ghost: chase };

const MOVE_OF = ENEMIES.map((d) => MOVES[d.move] ?? chase);
/** 장애물을 통과하는 요괴 (원혼) */
const NOCLIP = ENEMIES.map((d) => d.move === 'ghost');
const PT = { x: 0, y: 0 };

/** 요괴끼리 겹치지 않게 서로 밀어낸다 (같은 칸과 이웃 칸만 본다) */
function pushApart(a: Enemy, b: Enemy) {
  if (a.dead || b.dead || a.hidden || b.hidden) return;
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

/**
 * 장애물에 막힌 요괴: 밖으로 밀어내고, 장애물을 끼고 옆으로 돌아가게 한다.
 * 한 번 정한 쪽(side)을 잠깐 유지해서 두 장애물 사이의 오목한 곳에서 왔다 갔다 하지 않는다.
 */
function avoid(s: State, e: Enemy, dx: number, dy: number, d: number) {
  if (!pushOut(s.map.terrain, s.terrainSeed, e.x, e.y, e.r)) {
    if (e.sideT > 0 && --e.sideT === 0) e.side = 0;
    return;
  }
  e.x = OUT.x;
  e.y = OUT.y;
  // 장애물의 겉을 따라가는 방향 (밀려난 방향에 수직)
  let tx = -PUSH.y;
  let ty = PUSH.x;
  if (e.side === 0) {
    const dot = d > 1 ? (tx * dx + ty * dy) / d : 0;
    // 내 쪽에 가까운 방향으로, 정면으로 막혔으면 요괴마다 다른 쪽으로
    e.side = dot > 0.25 ? 1 : dot < -0.25 ? -1 : e.uid % 2 ? 1 : -1;
  }
  e.sideT = 40;
  tx *= e.side;
  ty *= e.side;
  const v = e.speed * TICK * 0.9;
  e.x += tx * v;
  e.y += ty * v;
  if (pushOut(s.map.terrain, s.terrainSeed, e.x, e.y, e.r)) {
    e.x = OUT.x;
    e.y = OUT.y;
  }
}

/** 걸음마다: 모든 요괴를 움직이고, 내게 닿았으면 피해를 준다 */
export function updateEnemies(s: State) {
  const p = s.player;
  const list = s.enemies.items;
  const n = s.enemies.n;
  const touch = PLAYER.r * 0.8;
  const terrain = s.map.terrain.kind !== 'none';
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
      e.ax = e.ay = 0;
      dx = p.x - e.x;
      dy = p.y - e.y;
    }
    const d = Math.sqrt(dx * dx + dy * dy);
    if (e.boss >= 0) updateBoss(s, e, dx, dy, d);
    else {
      // 느려진 요괴(양털 구름)는 절반 빠르기
      const sp = e.speed;
      if (e.slow > 0) {
        e.slow--;
        e.speed = sp * 0.5;
      }
      MOVE_OF[e.kind](s, e, ENEMIES[e.kind], dx, dy, d);
      e.speed = sp;
      // 지형: 장애물에 막힌다 (원혼은 통과한다. 보스는 장애물을 부수며 지나간다고 본다)
      if (terrain && !NOCLIP[e.kind]) avoid(s, e, dx, dy, d);
    }
    if (e.hidden) continue;
    const ex = p.x - e.x;
    const ey = p.y - e.y;
    const rr = e.r + touch;
    if (ex * ex + ey * ey < rr * rr) hurtPlayer(s, e.dmg);
  }
  separate(s);
}
