/**
 * 고양이 머리 (PRD 5장 · 7장): 할 일이 없을 때 무엇을 할지 고른다.
 * 1) 아프면 축 처져 재채기  2) 자기 밥그릇 · 물그릇 · 화장실이 필요하면 그 앞에서 야옹  3) 기분이 낮으면 등을 돌리고 식빵
 * 4) 밤에는 대부분 잔다 (10단계면 집사 옆에서, 친구가 있으면 꼭 붙어서)  5) 그 밖에는 시간대(아침 · 낮 · 저녁 · 밤)마다 다른 비율로 행동을 고른다.
 * 친밀도 단계가 오르면 새 행동이 열린다: 무릎(3) · 따라다니기(4, 바닥을 누르면) · 배 보여 주기(6) · 꾹꾹이(8) · 같이 자기(10).
 * 5단계: 놓인 가구를 실제로 쓴다 — 캣타워 꼭대기로 폴짝 · 숨숨집에 쏙(눈만 반짝) · 방석 · 쿠션 · 바구니에서 자기 · 스크래처 긁기 ·
 *   책상 위 컵 떨어뜨리기 · 꽃병 냄새. 고양이가 둘 이상이면 서로 그루밍 · 꼭 붙어 자기 · 잡기 놀이.
 * 처음 보는 행동은 ctx.saw 가 행동 도감(서버)에 남긴다. 지금 하는 행동(v.behavior)은 사진에 남는다.
 */
import { BEHAVIOR, CONST } from '../data/balance';
import { needs } from '../game/rules';
import type { Act, Spot2 } from './cat';
import { LICK_POSES } from './catart';
import { floatAt, sfx } from './common';
import { clamp, sleep, type CatView, type FurnView, type RoomCtx, type TimeOfDay } from './ctx';

type Pick = { id: string; w: Record<TimeOfDay, number>; ok?: (ctx: RoomCtx, v: CatView) => boolean; run: (ctx: RoomCtx, v: CatView, t: number) => void };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const near = (a: Spot2, b: Spot2, d = 0.05) => Math.hypot(a.x - b.x, a.y - b.y) < d;
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const pose = (v: CatView, p: Act & { kind: 'pose' }) => (v.actor.act = p);
/** 행동 시작: 도감에 남기고 지금 하는 행동으로 */
const begin = (ctx: RoomCtx, v: CatView, id: string) => {
  v.behavior = id;
  if (ctx.level(v.slot) >= (BEHAVIOR[id]?.level ?? 1)) ctx.saw(v, id);
};
/** 걸어간 뒤에 할 일 */
const onArrive = (v: CatView, fn: () => void) => {
  const a = v.actor.act;
  if (a.kind === 'walk') a.arrive = fn;
};

// ---------- 연출 잡기 (가구 쓰기 · 고양이끼리): 쓰다듬기 · 밥 주기가 끼어들면 놓아준다 ----------
const tokens = new WeakMap<CatView, number>();
let tokSeq = 0;
function hold(v: CatView, scene: 'furn' | 'social', mate: number | null = null): number {
  const k = ++tokSeq;
  tokens.set(v, k);
  v.scene = scene;
  v.mate = mate;
  // 앞 연출이 남긴 높이 · 숨기를 지운다
  Object.assign(v.actor, { lift: 0, vanish: false, forcePose: null, sink: 0 });
  return k;
}
/** 아직 이 연출이 고양이를 쥐고 있는지 */
const mine = (v: CatView, k: number) => tokens.get(v) === k && (v.scene === 'furn' || v.scene === 'social');
function release(v: CatView, k: number) {
  if (!mine(v, k)) return;
  const a = v.actor;
  v.scene = null;
  v.mate = null;
  a.forcePose = null;
  a.lift = 0;
  a.vanish = false;
  a.sink = 0;
  a.act = { kind: 'idle', until: performance.now() + 1500 + Math.random() * 2500 };
}
/** 화면 높이로 천천히 올리기 · 내리기 */
async function liftTo(v: CatView, to: number, ms: number) {
  const a = v.actor;
  const from = a.lift;
  const t0 = performance.now();
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.lift = from + (to - from) * (1 - (1 - k) * (1 - k));
    if (k >= 1) return;
    await sleep(16);
  }
}

// ---------- 가구 자리 ----------
/** 잘 곳: 놓인 방석 · 쿠션 · 바구니 중 하나 (없으면 방 앞쪽 바닥) */
export function bedSpot(ctx: RoomCtx, prefer?: FurnView): Spot2 {
  const beds = ctx.furnUse('bed');
  const b = prefer ?? (beds.length ? pick(beds) : undefined);
  return b ? { x: b.at.x, y: b.at.y - (b.f.w > 1 ? 0.06 : 0.03) } : { x: 0.56, y: 0.92 };
}
/** 잠자리 가구 위에 누웠으면 가구보다 앞에 그린다 (가구 뒤에 파묻혀 보이지 않게) */
function onBed(ctx: RoomCtx, v: CatView) {
  const p = v.actor.pos;
  if (ctx.furnUse('bed').some((b) => Math.abs(b.at.x - p.x) < 0.1 + b.f.w / 16 && p.y < b.at.y + 0.02 && p.y > b.at.y - 0.2)) v.actor.bedLift = 60;
}
export const LAP: Spot2 = { x: 0.5, y: 1.0 };
/** 여러 마리가 같은 곳으로 갈 때 겹치지 않게 고양이마다 조금씩 비켜 선다 */
function spread(ctx: RoomCtx, v: CatView, p: Spot2): Spot2 {
  const n = ctx.views.length;
  if (n < 2) return p;
  const i = ctx.views.indexOf(v);
  return { x: clamp(p.x + (i - (n - 1) / 2) * 0.13, 0.04, 0.96), y: clamp(p.y + (i % 2) * 0.04, 0, 1) };
}
export const BOX_SPOT = (ctx: RoomCtx): Spot2 | null => {
  const b = ctx.furn('box');
  return b ? { x: b.at.x, y: b.at.y - 0.03 } : null;
};

function hearts(ctx: RoomCtx, v: CatView, n = 3) {
  const p = v.actor.mouthPoint();
  for (let i = 0; i < n; i++) setTimeout(() => floatAt(ctx.room, p.x + rand(-30, 30), p.y - 30 - rand(0, 30), '♥', 'float heart small'), i * 260);
}

const PICKS: Pick[] = [
  {
    id: 'wander', w: { morning: 4, day: 3, dusk: 4, night: 1 },
    run: (ctx, v) => {
      begin(ctx, v, 'walk');
      ctx.walkTo(v, { x: rand(0.08, 0.92), y: rand(0.3, 0.95) });
    },
  },
  {
    id: 'loaf', w: { morning: 2, day: 4, dusk: 2, night: 1 },
    run: (ctx, v, t) => {
      const rug = ctx.furnUse('rug')[0];
      if (rug && Math.random() < 0.5) {
        // 러그 위에서 식빵
        ctx.walkTo(v, { x: rug.at.x + rand(-0.04, 0.04), y: rug.at.y - 0.02 }, { kind: 'pose', pose: 'loaf', until: 0, ms: rand(7000, 14000) });
        return onArrive(v, () => begin(ctx, v, 'loaf'));
      }
      begin(ctx, v, 'loaf');
      pose(v, { kind: 'pose', pose: 'loaf', until: t + rand(7000, 15000) });
    },
  },
  {
    id: 'window', w: { morning: 3, day: 2, dusk: 3, night: 0.3 },
    run: (ctx, v) => {
      ctx.walkTo(v, { x: 0.5, y: 0.03 }, { kind: 'pose', pose: 'sit', until: 0, ms: 6500, face: 1 });
      onArrive(v, () => {
        begin(ctx, v, 'window');
        ctx.room.classList.add('birds');
        setTimeout(() => v.actor.say('짹짹…?', 1800), 700);
        setTimeout(() => (v.actor.facing = -1), 2600);
        setTimeout(() => ctx.room.classList.remove('birds'), 6000);
      });
    },
  },
  {
    id: 'zoomies', w: { morning: 1, day: 1, dusk: 3, night: 0.3 },
    run: (ctx, v) => {
      begin(ctx, v, 'zoomies');
      v.actor.say('우다다!', 1200);
      let act: Act | undefined;
      for (let i = 0; i < 4; i++) act = { kind: 'walk', to: { x: rand(0.06, 0.94), y: rand(0.25, 0.98) }, speed: 460, then: act };
      v.actor.act = act!;
    },
  },
  {
    id: 'stretch', w: { morning: 3, day: 1, dusk: 1, night: 0.5 },
    run: (ctx, v, t) => {
      begin(ctx, v, 'stretch');
      pose(v, { kind: 'pose', pose: 'stretch', until: t + 2000 });
    },
  },
  {
    // 책상 위 컵 떨어뜨리기
    id: 'knock', w: { morning: 1, day: 1.5, dusk: 1.5, night: 0.3 },
    ok: (ctx) => !!ctx.furn('desk') && !ctx.furn('desk')!.el.classList.contains('knocked'),
    run: (ctx, v) => {
      const tb = ctx.furn('desk')!;
      const side = tb.at.x > 0.7 ? -1 : 1;
      ctx.walkTo(v, { x: clamp(tb.at.x + 0.15 * side, 0.03, 0.97), y: tb.at.y + 0.02 }, { kind: 'pose', pose: 'sit', until: 0, ms: 1400, face: side > 0 ? -1 : 1 });
      onArrive(v, () => {
        begin(ctx, v, 'knock');
        setTimeout(() => {
          if (ctx.furn('desk') !== tb) return;
          v.actor.act = { kind: 'pose', pose: 'pounce', until: performance.now() + 700, face: side > 0 ? -1 : 1 };
          tb.el.classList.toggle('flip', side < 0);
          tb.el.classList.add('knocked');
          sfx('nyangDrop', { rate: 1.4 });
          v.actor.say('툭', 1000);
        }, 900);
        setTimeout(() => tb.el.classList.remove('knocked'), 9000);
      });
    },
  },
  {
    id: 'rub', w: { morning: 2, day: 1.5, dusk: 1.5, night: 0.5 },
    run: (ctx, v) => {
      const y = 0.96;
      let act: Act = { kind: 'pose', pose: 'blink', until: 0, ms: 1500 };
      for (let i = 0; i < 3; i++) act = { kind: 'walk', to: { x: i % 2 ? 0.44 : 0.56, y }, speed: 80, then: act };
      ctx.walkTo(v, { x: 0.5, y }, act);
      onArrive(v, () => {
        begin(ctx, v, 'rub');
        v.actor.say('부비부비', 1500);
        hearts(ctx, v, 4);
        sfx('nyangPurr', { volume: 0.6 });
      });
    },
  },
  {
    id: 'box', w: { morning: 1, day: 2, dusk: 1, night: 0.5 },
    ok: (ctx) => !!BOX_SPOT(ctx) && !ctx.furn('box')!.el.classList.contains('away'),
    run: (ctx, v) => {
      ctx.walkTo(v, BOX_SPOT(ctx)!, { kind: 'pose', pose: 'sit', until: 0, ms: rand(8000, 14000), face: 1 });
      onArrive(v, () => {
        begin(ctx, v, 'box');
        v.actor.sink = boxSink(v) * 0.55;
      });
    },
  },
  {
    // 방석 · 쿠션 · 바구니에서 낮잠
    id: 'nap', w: { morning: 0.5, day: 3, dusk: 1, night: 0 },
    run: (ctx, v) => {
      ctx.walkTo(v, spread(ctx, v, bedSpot(ctx)), { kind: 'pose', pose: 'sleep', until: 0, ms: rand(12000, 22000) });
      onArrive(v, () => {
        begin(ctx, v, 'sleep');
        onBed(ctx, v);
      });
    },
  },
  {
    id: 'lap', w: { morning: 1, day: 2, dusk: 2, night: 1 }, ok: (ctx, v) => ctx.level(v.slot) >= BEHAVIOR.lap.level,
    run: (ctx, v) => {
      ctx.walkTo(v, LAP, { kind: 'pose', pose: 'loaf', until: 0, ms: rand(9000, 15000) });
      onArrive(v, () => {
        begin(ctx, v, 'lap');
        v.actor.say('(무릎 위) 골골…', 2200);
        sfx('nyangPurr', { volume: 0.6 });
        hearts(ctx, v);
      });
    },
  },
  {
    id: 'belly', w: { morning: 1, day: 2, dusk: 1, night: 0.5 }, ok: (ctx, v) => ctx.level(v.slot) >= BEHAVIOR.belly.level,
    run: (ctx, v, t) => {
      begin(ctx, v, 'belly');
      pose(v, { kind: 'pose', pose: 'belly', until: t + rand(6000, 10000) });
      setTimeout(() => v.actor.say('냐앙~', 1400), 500);
    },
  },
  {
    id: 'knead', w: { morning: 1, day: 1, dusk: 1, night: 1 }, ok: (ctx, v) => ctx.level(v.slot) >= BEHAVIOR.knead.level,
    run: (ctx, v) => {
      ctx.walkTo(v, bedSpot(ctx), { kind: 'pose', pose: 'knead', until: 0, ms: 6500 });
      onArrive(v, () => {
        begin(ctx, v, 'knead');
        v.actor.say('꾹꾹…', 1600);
      });
    },
  },
  // ---------- 5단계: 가구 쓰기 ----------
  {
    id: 'tower', w: { morning: 2, day: 2.5, dusk: 2.5, night: 0.4 },
    ok: (ctx) => !!ctx.furn('cat_tower') && !occupied(ctx, 'tower'),
    run: (ctx, v) => {
      const tw = ctx.furn('cat_tower')!;
      ctx.walkTo(v, { x: tw.at.x - 0.01, y: tw.at.y + 0.012 }, { kind: 'hold', pose: 'sit' });
      onArrive(v, () => void climbTower(ctx, v, tw));
    },
  },
  {
    id: 'hide', w: { morning: 1, day: 2, dusk: 1.5, night: 0.6 },
    ok: (ctx) => !!ctx.furn('hideaway') && !occupied(ctx, 'hide'),
    run: (ctx, v) => {
      const hd = ctx.furn('hideaway')!;
      ctx.walkTo(v, { x: hd.at.x - 0.02, y: hd.at.y + 0.01 }, { kind: 'hold', pose: 'loaf' });
      onArrive(v, () => void hideIn(ctx, v, hd));
    },
  },
  {
    id: 'scratch', w: { morning: 2, day: 1, dusk: 2, night: 0.3 },
    ok: (ctx) => !!ctx.furn('scratcher') && !occupied(ctx, 'scratch'),
    run: (ctx, v) => {
      const sc = ctx.furn('scratcher')!;
      const side = sc.at.x > 0.5 ? -1 : 1;
      ctx.walkTo(v, { x: sc.at.x - 0.075 * side, y: sc.at.y + 0.012 }, { kind: 'hold', pose: 'sit' });
      onArrive(v, () => void scratchPost(ctx, v, sc, side as 1 | -1));
    },
  },
  {
    // 꽃병 냄새 (꽃을 꽂아 두었을 때)
    id: 'sniff', w: { morning: 1.2, day: 1, dusk: 1, night: 0.2 },
    ok: (ctx) => !!ctx.furn('vase') && !!ctx.state().profile.layout.vase,
    run: (ctx, v) => {
      const vs = ctx.furn('vase')!;
      const side = vs.at.x > 0.5 ? -1 : 1;
      ctx.walkTo(v, { x: vs.at.x - 0.08 * side, y: vs.at.y + 0.01 }, { kind: 'pose', pose: 'sit', until: 0, ms: 3200, face: side as 1 | -1 });
      onArrive(v, () => {
        begin(ctx, v, 'sit');
        v.actor.say(pick(['킁킁… 꽃냄새', '좋은 냄새다옹', '킁킁']), 1800);
      });
    },
  },
];

/** 가구를 다른 고양이가 쓰는 중인지 */
const occupied = (ctx: RoomCtx, behavior: string) => ctx.views.some((u) => u.scene === 'furn' && u.behavior === behavior);

/** 캣타워: 두 번 폴짝 뛰어 꼭대기 방석에 앉았다가 내려온다 */
async function climbTower(ctx: RoomCtx, v: CatView, tw: FurnView) {
  const k = hold(v, 'furn');
  const a = v.actor;
  begin(ctx, v, 'tower');
  const h = tw.el.getBoundingClientRect().height;
  a.facing = Math.random() < 0.5 ? 1 : -1;
  a.act = { kind: 'hold', pose: 'jump' };
  sfx('click', { rate: 1.6, volume: 0.5 });
  await liftTo(v, h * 0.44, 300);
  if (!mine(v, k)) return;
  a.act = { kind: 'hold', pose: 'sit' };
  await sleep(500);
  if (!mine(v, k)) return;
  a.act = { kind: 'hold', pose: 'jump' };
  await liftTo(v, h * 0.74, 300);
  if (!mine(v, k)) return;
  a.act = { kind: 'hold', pose: Math.random() < 0.5 ? 'loaf' : 'sit' };
  a.say(pick(['높다옹!', '여기가 내 자리', '다 보인다옹']), 1800);
  await sleep(rand(8000, 15000));
  if (!mine(v, k) || ctx.furn('cat_tower') !== tw) return release(v, k);
  a.act = { kind: 'hold', pose: 'jump' };
  await liftTo(v, 0, 420);
  release(v, k);
}
/** 숨숨집: 쏙 들어가 구멍으로 눈만 반짝 → 잠시 뒤 나온다 */
async function hideIn(ctx: RoomCtx, v: CatView, hd: FurnView) {
  const k = hold(v, 'furn');
  begin(ctx, v, 'hide');
  v.actor.vanish = true;
  hd.el.classList.add('occupied');
  sfx('click', { rate: 0.8, volume: 0.4 });
  const r = hd.el.getBoundingClientRect();
  const rr = ctx.room.getBoundingClientRect();
  setTimeout(() => floatAt(ctx.room, r.left - rr.left + r.width * 0.42, r.top - rr.top + r.height * 0.1, '…', 'float heart small'), 1500);
  await sleep(rand(8000, 14000));
  hd.el.classList.remove('occupied');
  if (!mine(v, k)) {
    v.actor.vanish = false;
    return;
  }
  v.actor.vanish = false;
  release(v, k);
  ctx.walkTo(v, { x: v.actor.pos.x, y: clamp(v.actor.pos.y + 0.14, 0, 1) }, { kind: 'pose', pose: 'stretch', until: 0, ms: 1500 });
}
/** 스크래처: 일어서서 북북 긁기 */
async function scratchPost(ctx: RoomCtx, v: CatView, sc: FurnView, side: 1 | -1) {
  const k = hold(v, 'furn');
  const a = v.actor;
  begin(ctx, v, 'scratch');
  a.facing = side;
  a.act = { kind: 'hold', pose: 'stretch' };
  sc.el.classList.add('scratching');
  const r = sc.el.getBoundingClientRect();
  const rr = ctx.room.getBoundingClientRect();
  for (let i = 0; i < 6 && mine(v, k); i++) {
    a.shake = performance.now() + 200;
    if (i % 2 === 0) floatAt(ctx.room, r.left - rr.left + r.width * 0.5 + rand(-8, 8), r.top - rr.top + r.height * rand(0.3, 0.6), '///', 'float scratch');
    sfx('nyangScoop', { rate: 1.7, volume: 0.35 });
    await sleep(420);
  }
  sc.el.classList.remove('scratching');
  if (!mine(v, k)) return;
  a.say('시원하다옹', 1300);
  release(v, k);
}

// ---------- 5단계: 고양이끼리 ----------
function partnerOf(ctx: RoomCtx, v: CatView): CatView | null {
  const list = ctx.views.filter((u) => u !== v && !u.scene && !u.actor.vanish && !ctx.levels(u.slot).sick && u.actor.act.kind !== 'pet');
  return list.length ? pick(list) : null;
}
async function waitStill(vs: CatView[], ks: number[], ms = 12000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (vs.some((v, i) => !mine(v, ks[i]))) return false;
    if (vs.every((v) => v.actor.act.kind !== 'walk')) return true;
    await sleep(60);
  }
  return false;
}
/** 서로 그루밍: 한 마리가 다가가 혀로 핥아 주고, 받는 고양이는 눈을 감고 골골 */
async function groom(ctx: RoomCtx, v: CatView, u: CatView) {
  const kv = hold(v, 'social', u.slot);
  const ku = hold(u, 'social', v.slot);
  begin(ctx, v, 'groom');
  begin(ctx, u, 'groom');
  u.actor.act = { kind: 'hold', pose: 'loaf' };
  const side = v.actor.pos.x < u.actor.pos.x ? -1 : 1;
  const to = { x: clamp(u.actor.pos.x + side * 0.11, 0.04, 0.96), y: clamp(u.actor.pos.y + 0.006, 0, 1) };
  if (Math.abs(to.x - u.actor.pos.x) < 0.08) to.x = clamp(u.actor.pos.x - side * 0.11, 0.04, 0.96);
  ctx.walkTo(v, to, { kind: 'hold', pose: 'sit' });
  if (!(await waitStill([v, u], [kv, ku]))) return (release(v, kv), release(u, ku));
  v.actor.facing = u.actor.pos.x > v.actor.pos.x ? 1 : -1;
  u.actor.act = { kind: 'hold', pose: 'blink' };
  u.actor.say('골골…', 1800);
  sfx('nyangPurr', { volume: 0.5 });
  let i = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 5200 && mine(v, kv) && mine(u, ku)) {
    v.actor.forcePose = LICK_POSES[i++ % LICK_POSES.length];
    if (i % 10 === 0) hearts(ctx, u, 1);
    await sleep(125);
  }
  v.actor.forcePose = null;
  if (mine(u, ku)) hearts(ctx, u, 3);
  release(v, kv);
  release(u, ku);
}
/** 꼭 붙어 자기: 같은 잠자리에 나란히 */
async function cuddle(ctx: RoomCtx, v: CatView, u: CatView) {
  const kv = hold(v, 'social', u.slot);
  const ku = hold(u, 'social', v.slot);
  const bed = bedSpot(ctx);
  // 잠자리 앞쪽에 나란히 (둘 다 보이게 — 한 마리가 잠자리에 가려지지 않게)
  ctx.walkTo(v, { x: clamp(bed.x - 0.06, 0.03, 0.97), y: clamp(bed.y + 0.05, 0, 1) }, { kind: 'hold', pose: 'sleep' });
  ctx.walkTo(u, { x: clamp(bed.x + 0.06, 0.03, 0.97), y: clamp(bed.y + 0.055, 0, 1) }, { kind: 'hold', pose: 'sleep' });
  if (!(await waitStill([v, u], [kv, ku], 15000))) return (release(v, kv), release(u, ku));
  begin(ctx, v, 'cuddle');
  begin(ctx, u, 'cuddle');
  v.actor.facing = 1;
  u.actor.facing = -1;
  v.actor.say('zZ', 2200);
  hearts(ctx, u, 3);
  const until = performance.now() + rand(14000, 24000);
  while (performance.now() < until && mine(v, kv) && mine(u, ku)) await sleep(250);
  release(v, kv);
  release(u, ku);
}
/** 잡기 놀이: 한 마리가 도망가고 다른 한 마리가 뒤쫓다가 폴짝 */
async function chase(ctx: RoomCtx, v: CatView, u: CatView) {
  const kv = hold(v, 'social', u.slot);
  const ku = hold(u, 'social', v.slot);
  begin(ctx, v, 'chase');
  begin(ctx, u, 'chase');
  const path: Spot2[] = [];
  for (let i = 0; i < 4; i++) path.push({ x: rand(0.42, 0.94), y: rand(0.25, 0.98) });
  let ua: Act | undefined;
  for (let i = path.length - 1; i >= 0; i--) ua = { kind: 'walk', to: path[i], speed: 440, then: ua };
  u.actor.act = ua!;
  u.actor.say('잡아 봐라옹!', 1300);
  const trail = [{ ...u.actor.pos }, ...path.slice(0, -1), { x: clamp(path[3].x + (path[3].x > 0.5 ? -0.09 : 0.09), 0.04, 0.96), y: path[3].y }];
  let va: Act | undefined = { kind: 'hold', pose: 'jump' };
  for (let i = trail.length - 1; i >= 0; i--) va = { kind: 'walk', to: trail[i], speed: 400, then: va };
  setTimeout(() => mine(v, kv) && ((v.actor.act = va!), (v.actor.perky = true)), 350);
  await sleep(500);
  if (!(await waitStill([v, u], [kv, ku], 15000))) return (release(v, kv), release(u, ku), (v.actor.perky = false));
  v.actor.perky = false;
  v.actor.facing = u.actor.pos.x > v.actor.pos.x ? 1 : -1;
  u.actor.act = { kind: 'hold', pose: 'belly' };
  v.actor.say('잡았다옹!', 1300);
  sfx('nyangMeow', { rate: 1.4, volume: 0.6 });
  await sleep(1800);
  release(v, kv);
  release(u, ku);
}
/** 친구가 있으면 어울리기 (true = 시작했다) */
function social(ctx: RoomCtx, v: CatView, night: boolean): boolean {
  const u = partnerOf(ctx, v);
  if (!u) return false;
  const r = Math.random();
  if (night || r < 0.3) void cuddle(ctx, v, u);
  else if (r < 0.65) void groom(ctx, v, u);
  else void chase(ctx, v, u);
  return true;
}

/** 상자 속에 숨을 때 가라앉는 깊이 (화면 px) */
export function boxSink(v: CatView) {
  return 300 * v.actor.screen().s;
}

/** 할 일이 없을 때 (room.ts 의 매 장면에서 부른다) */
export function think(ctx: RoomCtx, v: CatView, t: number) {
  const a = v.actor;
  v.behavior = null;
  v.mate = null;
  a.sink = 0;
  a.lift = 0;
  a.vanish = false;
  a.perky = false;
  a.forcePose = null;
  const c = ctx.cat(v.slot);
  const lv = ctx.levels(v.slot);
  const nd = needs(c, Math.floor(ctx.now()));
  const r = Math.random();
  if (lv.sick) {
    if (r < 0.4) {
      a.say('에취!', 1400, t);
      sfx('nyangMeow', { rate: 1.6, volume: 0.5 });
      begin(ctx, v, 'sneeze');
    }
    a.act = { kind: 'pose', pose: 'loaf', until: t + 5000 + Math.random() * 5000 };
    return;
  }
  if (nd.food || nd.water || nd.litter) {
    // 자기 그릇 앞 (그릇 오른쪽에서 왼쪽을 본다) · 화장실 옆
    const bw = ctx.bowl(v.slot);
    const target = nd.food ? bw.food : nd.water ? bw.water : ctx.props.litter;
    const isLitter = target === ctx.props.litter;
    const spot = isLitter ? { x: target.at.x + 0.2, y: target.at.y + 0.08 } : { x: target.at.x + 0.13, y: target.at.y + 0.03 };
    if (!near(a.pos, spot)) return ctx.walkTo(v, spot);
    a.facing = -1;
    const words = nd.food ? '배고파옹…' : nd.water ? (lv.spoiled ? '물이 이상해옹' : '목말라옹…') : '화장실이…';
    if (t > v.nextMeow) {
      a.say(words, 2200, t);
      sfx('nyangMeow', { rate: 0.9 + Math.random() * 0.2 });
      v.nextMeow = t + 9000;
    }
    if (nd.water) target.el.classList.add('tap'), setTimeout(() => target.el.classList.remove('tap'), 700);
    a.act = { kind: 'pose', pose: 'sit', until: t + 3500 };
    return;
  }
  if (nd.mood) {
    // 심심해서 등을 돌리고 식빵 (상자가 있으면 상자 속에서)
    const bs = BOX_SPOT(ctx);
    if (bs && r < 0.5) {
      if (!near(a.pos, bs, 0.03)) return ctx.walkTo(v, bs);
      a.sink = boxSink(v) * 0.7;
    }
    a.facing = -1;
    if (r < 0.3) a.say('…', 1500, t);
    a.act = { kind: 'pose', pose: 'loaf', until: t + 6000 };
    return;
  }
  // 캣닢을 먹고 10분 동안은 신나서 우다다 (4단계)
  if (ctx.now() - c.nipAt < CONST.nip_sec && r < 0.75) {
    begin(ctx, v, 'zoomies');
    if (r < 0.3) a.say(['냥냥냥!', '우다다다!', '신난다옹!'][Math.floor(Math.random() * 3)], 1200, t);
    let act: Act | undefined;
    for (let i = 0; i < 4; i++) act = { kind: 'walk', to: { x: rand(0.06, 0.94), y: rand(0.25, 0.98) }, speed: 500, then: act };
    a.act = act!;
    return;
  }
  const night = ctx.timeOfDay() === 'night';
  // 친구가 있으면 가끔 어울린다 (밤에는 꼭 붙어 자기)
  if (ctx.views.length > 1 && Math.random() < (night ? 0.35 : 0.2) && social(ctx, v, night)) return;
  if (night && r < 0.8) {
    const together = ctx.level(v.slot) >= BEHAVIOR.together.level && Math.random() < 0.5;
    const bed = spread(ctx, v, together ? LAP : bedSpot(ctx));
    if (!near(a.pos, bed, 0.04)) return ctx.walkTo(v, bed);
    begin(ctx, v, together ? 'together' : 'sleep');
    a.act = { kind: 'pose', pose: 'sleep', until: t + 20000 + Math.random() * 20000 };
    if (!together) onBed(ctx, v);
    if (Math.random() < 0.5) a.say(together ? '(집사 옆) zZ' : 'zZ', 2500, t);
    return;
  }
  const tod = ctx.timeOfDay();
  const list = PICKS.filter((p) => !p.ok || p.ok(ctx, v));
  const sum = list.reduce((s, p) => s + p.w[tod], 0);
  let x = Math.random() * sum;
  for (const p of list) {
    x -= p.w[tod];
    if (x <= 0) return p.run(ctx, v, t);
  }
  begin(ctx, v, 'sit');
  a.act = { kind: 'idle', until: t + 3000 + Math.random() * 3000 };
}

/** 바닥을 눌렀을 때: 친밀도 4단계부터 꼬리를 세우고 따라온다 */
export function follow(ctx: RoomCtx, v: CatView, to: Spot2) {
  const a = v.actor;
  if (v.scene || a.act.kind === 'pet') return;
  if (ctx.levels(v.slot).sick) return;
  if (ctx.level(v.slot) < BEHAVIOR.follow.level) {
    // 아직은 쳐다보기만
    a.facing = to.x > a.pos.x ? 1 : -1;
    if (Math.random() < 0.3) a.say('?', 900);
    return;
  }
  v.behavior = 'follow';
  a.sink = 0;
  a.perky = true;
  ctx.walkTo(v, to, { kind: 'pose', pose: 'sit', until: 0, ms: 2500 });
  ctx.saw(v, 'follow');
  if (Math.random() < 0.4) a.say('냥!', 900);
}

/** 개발용 (?local=1): 행동 하나를 바로 시키기 — window.__nyang.act(slot, 'tower' | 'groom' | …) */
export function devAct(ctx: RoomCtx, v: CatView, id: string) {
  const u = ctx.views.find((x) => x !== v);
  if (u && (id === 'groom' || id === 'cuddle' || id === 'chase')) {
    u.scene = null;
    return void (id === 'groom' ? groom : id === 'cuddle' ? cuddle : chase)(ctx, v, u);
  }
  const p = PICKS.find((x) => x.id === id);
  if (p) p.run(ctx, v, performance.now());
}
