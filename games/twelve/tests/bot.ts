import { ENV, TILE } from '../src/data/balance';
import { STEP, noInput, sightOf, step, tileAt, type Input, type RunState } from '../src/game/sim';

/**
 * 시험용 자동 조종: 가까운 요괴를 찾아가 치고, 빨간 범위에 서 있으면 구르고, 출구가 열리면 출구로 간다.
 * 길은 목표 칸에서 퍼뜨린 걸음 수로 찾는다. 맵이 끝까지 갈 수 있는지·시간이 얼마나 걸리는지 보는 용도다 (사람보다 서툴다).
 */
function flow(s: RunState, tx: number, ty: number): Int16Array {
  const d = new Int16Array(s.cols * s.rows).fill(-1);
  const q = [Math.floor(ty / TILE) * s.cols + Math.floor(tx / TILE)];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % s.cols;
    const y = (c - x) / s.cols;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) continue;
      const n = ny * s.cols + nx;
      if (s.grid[n] === 1 || d[n] >= 0) continue;
      d[n] = d[c] + 1;
      q.push(n);
    }
  }
  return d;
}

/** (x, y) 에서 (tx, ty) 까지 벽이 없는지 (활·부채가 쏠 수 있는 자리인지) */
function sees(s: RunState, x: number, y: number, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const n = Math.ceil(d / (TILE * 0.15));
  // 모서리를 스치는 길은 막힌 것으로 본다 (양옆 16px 도 본다)
  const ox = (-(ty - y) / d) * 16;
  const oy = ((tx - x) / d) * 16;
  for (let i = 1; i < n; i++) {
    const px = x + ((tx - x) * i) / n;
    const py = y + ((ty - y) * i) / n;
    for (const k of [-1, 0, 1]) {
      const cx = Math.floor((px + ox * k) / TILE);
      const cy = Math.floor((py + oy * k) / TILE);
      if (s.grid[cy * s.cols + cx] === 1) return false;
    }
  }
  return true;
}

export interface BotResult {
  phase: RunState['phase'];
  time: number;
  hpLeft: number;
}

export function autoplay(s: RunState, maxSec = 900, o: { chest?: boolean } = {}): BotResult {
  let field: Int16Array | null = null;
  let key = '';
  const inp: Input = noInput();
  for (let i = 0; i < maxSec / STEP && s.phase === 'play'; i++) {
    const p = s.p;
    // 목표: 깨어난 요괴 → (상자) → 출구가 열렸으면 출구 → 아직 잠든 가장 가까운 요괴
    let tx = s.exitX;
    let ty = s.exitY;
    let fight = false;
    let best = Infinity;
    for (const e of s.enemies) {
      if (e.dead || !e.awake) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < best) (best = d), (tx = e.x), (ty = e.y), (fight = true);
    }
    if (!fight) {
      if (o.chest && !s.chest) (tx = s.chestX), (ty = s.chestY);
      else if (!s.exitOpen) {
        for (const e of s.enemies) {
          if (e.dead) continue;
          const d = Math.abs(e.y - p.y) + Math.abs(e.x - p.x);
          if (d < best) (best = d), (tx = e.x), (ty = e.y);
        }
      }
    }
    const k = `${Math.floor(tx / TILE)},${Math.floor(ty / TILE)}`;
    if (k !== key || !field) {
      key = k;
      field = flow(s, tx, ty);
    }
    // 걸음 수가 줄어드는 옆 칸으로 (같은 칸이면 곧장)
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    let gx = tx;
    let gy = ty;
    const here = field[cy * s.cols + cx];
    if (here > 1) {
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) continue;
        const d = field[ny * s.cols + nx];
        if (d >= 0 && d < here) {
          gx = (nx + 0.5) * TILE;
          gy = (ny + 0.5) * TILE;
          break;
        }
      }
    }
    const dx = gx - p.x;
    const dy = gy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    // 칼·창은 붙어서, 활·부채는 떨어져서 싸운다 (조준 거리의 절반쯤에서 멈춰 쏜다)
    const ranged = s.weapon.kind === 'bow' || s.weapon.kind === 'fan';
    // 달그림자(4지형)에서는 보이는 거리 안까지 다가가서 쏜다
    const close = fight && best < (ranged ? Math.min(s.weapon.aim * 0.55, sightOf(s) * 0.8) : s.weapon.kind === 'sword' ? 85 : 140) && (!ranged || sees(s, p.x, p.y, tx, ty));
    inp.mx = close ? 0 : dx / d;
    inp.my = close ? 0 : dy / d;
    // 물길(5지형): 물살에 떠밀리는 만큼 거슬러 올라간다 (사람도 그렇게 한다)
    if (s.env.id === 'water' && s.env.f > 0 && tileAt(s, p.x, p.y) === 2) inp.my -= (ENV.water.push * s.env.f) / (s.stats.speed * 0.6);
    inp.attack = fight && best < s.weapon.aim + 40;
    const skillRange = ranged ? s.weapon.aim * 0.8 : 200;
    inp.skill[0] = fight && best < skillRange && p.skillCd[0] <= 0;
    inp.skill[1] = fight && best < skillRange && p.skillCd[1] <= 0;
    inp.unique = fight && best < 200 && p.uniqueCd <= 0;
    inp.potion[0] = p.hp < s.stats.hp * 0.45;
    inp.potion[1] = p.mp < s.stats.mp * 0.2;
    // 빨간 범위 안에 서 있고 곧 터지면 범위 밖으로 구른다
    inp.roll = false;
    // 활·부채: 요괴가 바짝 붙으면 반대쪽으로 굴러 거리를 벌린다
    if (ranged && fight && best < 90 && p.rollCd <= 0) {
      inp.roll = true;
      inp.mx = -(tx - p.x) / (best || 1);
      inp.my = -(ty - p.y) / (best || 1);
    }
    for (const w of s.warns) {
      if (w.delay > 0 || w.shape === 'none' || w.t > 0.3) continue;
      const wd = Math.hypot(p.x - w.x, p.y - w.y);
      if (wd < (w.shape === 'line' ? w.len : w.r) + 30) {
        inp.roll = true;
        // 범위 가운데에서 멀어지는 쪽 (직선은 옆으로)
        const ax = w.shape === 'line' ? -Math.sin(w.ang) : (p.x - w.x) / (wd || 1);
        const ay = w.shape === 'line' ? Math.cos(w.ang) : (p.y - w.y) / (wd || 1);
        inp.mx = ax || 1;
        inp.my = ay;
      }
    }
    // 날아오는 불: 곧 맞을 것 같으면 옆으로 비킨다 (구를 수 있으면 구른다)
    if (!inp.roll) {
      for (const sh of s.shots) {
        if (!sh.on || !sh.foe) continue;
        const rx = p.x - sh.x;
        const ry = p.y - sh.y;
        const v = Math.hypot(sh.vx, sh.vy) || 1;
        const along = (rx * sh.vx + ry * sh.vy) / v;
        if (along < 0 || along > 100) continue;
        const side = (rx * sh.vy - ry * sh.vx) / v;
        if (Math.abs(side) > 36) continue;
        const sgn = side >= 0 ? 1 : -1;
        inp.mx = (sh.vy / v) * sgn;
        inp.my = (-sh.vx / v) * sgn;
        inp.roll = along < 60 && p.rollCd <= 0;
        break;
      }
    }
    step(s, inp);
    s.events.length = 0;
  }
  return { phase: s.phase, time: s.t, hpLeft: s.p.hp / s.stats.hp };
}
