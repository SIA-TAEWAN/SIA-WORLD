/**
 * 고양이 머리 (PRD 5장 · 7장): 할 일이 없을 때 무엇을 할지 고른다.
 * 1) 아프면 축 처져 재채기  2) 밥 · 물 · 화장실이 필요하면 그 앞에서 야옹  3) 기분이 낮으면 등을 돌리고 식빵
 * 4) 밤에는 대부분 잔다 (10단계면 집사 옆에서)  5) 그 밖에는 시간대(아침 · 낮 · 저녁 · 밤)마다 다른 비율로 행동을 고른다.
 * 친밀도 단계가 오르면 새 행동이 열린다: 무릎(3) · 따라다니기(4, 바닥을 누르면) · 배 보여 주기(6) · 꾹꾹이(8) · 같이 자기(10).
 * 처음 보는 행동은 ctx.saw 가 행동 도감(서버)에 남긴다.
 */
import { BEHAVIOR } from '../data/balance';
import { needs } from '../game/rules';
import type { Act, Spot2 } from './cat';
import { floatAt, sfx } from './common';
import type { CatView, RoomCtx, TimeOfDay } from './ctx';

type Pick = { id: string; w: Record<TimeOfDay, number>; ok?: (ctx: RoomCtx, v: CatView) => boolean; run: (ctx: RoomCtx, v: CatView, t: number) => void };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const near = (a: Spot2, b: Spot2, d = 0.05) => Math.hypot(a.x - b.x, a.y - b.y) < d;
const pose = (v: CatView, p: Act & { kind: 'pose' }) => (v.actor.act = p);
/** 행동 시작: 도감에 남기고 지금 하는 행동으로 */
const begin = (ctx: RoomCtx, v: CatView, id: string) => {
  v.behavior = id;
  if (ctx.level(v.slot) >= (BEHAVIOR[id]?.level ?? 1)) ctx.saw(v, id);
};

export const BED = (ctx: RoomCtx): Spot2 => ({ x: ctx.props.cushion.at.x, y: ctx.props.cushion.at.y - 0.06 });
export const LAP: Spot2 = { x: 0.5, y: 1.0 };
export const BOX_SPOT = (ctx: RoomCtx): Spot2 => ({ x: ctx.props.box.at.x, y: ctx.props.box.at.y - 0.03 });

function hearts(ctx: RoomCtx, v: CatView, n = 3) {
  const p = v.actor.mouthPoint();
  for (let i = 0; i < n; i++) setTimeout(() => floatAt(ctx.room, p.x + rand(-30, 30), p.y - 30 - rand(0, 30), '♥', 'float heart small'), i * 260);
}

const PICKS: Pick[] = [
  { id: 'wander', w: { morning: 4, day: 3, dusk: 4, night: 1 }, run: (ctx, v) => ctx.walkTo(v, { x: rand(0.08, 0.92), y: rand(0.3, 0.95) }) },
  {
    id: 'loaf', w: { morning: 2, day: 4, dusk: 2, night: 1 },
    run: (ctx, v, t) => {
      begin(ctx, v, 'loaf');
      pose(v, { kind: 'pose', pose: 'loaf', until: t + rand(7000, 15000) });
    },
  },
  {
    id: 'window', w: { morning: 3, day: 2, dusk: 3, night: 0.3 },
    run: (ctx, v) => {
      ctx.walkTo(v, { x: 0.56, y: 0.03 }, { kind: 'pose', pose: 'sit', until: 0, ms: 6500, face: 1 });
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'window');
        ctx.room.classList.add('birds');
        setTimeout(() => v.actor.say('짹짹…?', 1800), 700);
        setTimeout(() => (v.actor.facing = -1), 2600);
        setTimeout(() => ctx.room.classList.remove('birds'), 6000);
      };
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
    id: 'knock', w: { morning: 1, day: 1.5, dusk: 1.5, night: 0.3 },
    ok: (ctx) => !ctx.props.table.el.classList.contains('knocked'),
    run: (ctx, v) => {
      const tb = ctx.props.table;
      ctx.walkTo(v, { x: tb.at.x + 0.15, y: tb.at.y + 0.02 }, { kind: 'pose', pose: 'sit', until: 0, ms: 1400, face: -1 });
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'knock');
        setTimeout(() => {
          v.actor.act = { kind: 'pose', pose: 'pounce', until: performance.now() + 700, face: -1 };
          tb.el.classList.add('knocked');
          sfx('nyangDrop', { rate: 1.4 });
          v.actor.say('툭', 1000);
        }, 900);
        setTimeout(() => tb.el.classList.remove('knocked'), 9000);
      };
    },
  },
  {
    id: 'rub', w: { morning: 2, day: 1.5, dusk: 1.5, night: 0.5 },
    run: (ctx, v) => {
      const y = 0.96;
      let act: Act = { kind: 'pose', pose: 'blink', until: 0, ms: 1500 };
      for (let i = 0; i < 3; i++) act = { kind: 'walk', to: { x: i % 2 ? 0.44 : 0.56, y }, speed: 80, then: act };
      ctx.walkTo(v, { x: 0.5, y }, act);
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'rub');
        v.actor.say('부비부비', 1500);
        hearts(ctx, v, 4);
        sfx('nyangPurr', { volume: 0.6 });
      };
    },
  },
  {
    id: 'box', w: { morning: 1, day: 2, dusk: 1, night: 0.5 },
    ok: (ctx) => !ctx.props.box.el.classList.contains('hidden'),
    run: (ctx, v) => {
      ctx.walkTo(v, BOX_SPOT(ctx), { kind: 'pose', pose: 'sit', until: 0, ms: rand(8000, 14000), face: 1 });
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'box');
        v.actor.sink = boxSink(v) * 0.55;
      };
    },
  },
  {
    id: 'nap', w: { morning: 0.5, day: 3, dusk: 1, night: 0 },
    run: (ctx, v) => {
      ctx.walkTo(v, BED(ctx), { kind: 'pose', pose: 'sleep', until: 0, ms: rand(12000, 22000) });
      (v.actor.act as { arrive?: () => void }).arrive = () => begin(ctx, v, 'sleep');
    },
  },
  {
    id: 'lap', w: { morning: 1, day: 2, dusk: 2, night: 1 }, ok: (ctx, v) => ctx.level(v.slot) >= BEHAVIOR.lap.level,
    run: (ctx, v) => {
      ctx.walkTo(v, LAP, { kind: 'pose', pose: 'loaf', until: 0, ms: rand(9000, 15000) });
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'lap');
        v.actor.say('(무릎 위) 골골…', 2200);
        sfx('nyangPurr', { volume: 0.6 });
        hearts(ctx, v);
      };
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
      ctx.walkTo(v, BED(ctx), { kind: 'pose', pose: 'knead', until: 0, ms: 6500 });
      (v.actor.act as { arrive?: () => void }).arrive = () => {
        begin(ctx, v, 'knead');
        v.actor.say('꾹꾹…', 1600);
      };
    },
  },
];

/** 상자 속에 숨을 때 가라앉는 깊이 (화면 px) */
export function boxSink(v: CatView) {
  return 300 * v.actor.screen().s;
}

/** 할 일이 없을 때 (room.ts 의 매 장면에서 부른다) */
export function think(ctx: RoomCtx, v: CatView, t: number) {
  const a = v.actor;
  v.behavior = null;
  a.sink = 0;
  a.perky = false;
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
  if (v.slot === ctx.views[0].slot && (nd.food || nd.water || nd.litter)) {
    const target = nd.food ? ctx.props.food : nd.water ? ctx.props.water : ctx.props.litter;
    const spot = target === ctx.props.litter ? { x: 0.58, y: 0.28 } : { x: Math.max(0.12, target.at.x - 0.24), y: target.at.y + 0.05 };
    if (!near(a.pos, spot)) return ctx.walkTo(v, spot);
    a.facing = 1;
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
    if (!ctx.props.box.el.classList.contains('hidden') && r < 0.5) {
      if (!near(a.pos, BOX_SPOT(ctx), 0.03)) return ctx.walkTo(v, BOX_SPOT(ctx));
      a.sink = boxSink(v) * 0.7;
    }
    a.facing = -1;
    if (r < 0.3) a.say('…', 1500, t);
    a.act = { kind: 'pose', pose: 'loaf', until: t + 6000 };
    return;
  }
  if (ctx.timeOfDay() === 'night' && r < 0.8) {
    const together = ctx.level(v.slot) >= BEHAVIOR.together.level && Math.random() < 0.5;
    const bed = together ? LAP : BED(ctx);
    if (!near(a.pos, bed, 0.04)) return ctx.walkTo(v, bed);
    begin(ctx, v, together ? 'together' : 'sleep');
    a.act = { kind: 'pose', pose: 'sleep', until: t + 20000 + Math.random() * 20000 };
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
