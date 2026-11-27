/**
 * 츄르 주기 · 빗질 (PRD 4장 5 · 7). 츄르는 이 게임에서 가장 공들인 연출:
 *   꺼내면 고양이가 어디서든 달려와 두 발을 모으고 조른다(beg) — 눈이 반짝 · 콩콩 뛰며 '츄르다옹!'
 *   [꾹 눌러서 짜 주기] 를 누르고 있는 동안 츄르가 조금씩 나오고 고양이가 혀를 낼름낼름 — SpriteCook 핥기 8칸(lick0~7, 8fps)을 돌리고
 *   츄르 그림(objects/churu-<맛>)을 입 앞에 겹친다 (떼면 멈추고 '더…!' 하며 조른다)
 *   다 먹으면 입맛을 다시고(혀를 옆으로) 눈을 감고 하트가 퐁퐁 — 그때 서버(nyang_churu)에 하나를 쓴다 (중간에 나가면 쓰지 않는다)
 * 빗질: 고양이 등을 빗으로 여러 번 쓸어내리면 털이 날려 털 뭉치가 커지고, 다 하면 서버(nyang_brush)에.
 */
import { CHURU, CONST, PERSONALITY, SEED_NAME, type ChuruId } from '../data/balance';
import type { WorldArt } from '../data/world.gen';
import { errorText } from '../net/api';
import { artImg } from './art';
import { LICK_POSES } from './catart';
import { buzz, floatAt, josa, sfx, toast } from './common';
import { sleep, type CatView, type RoomCtx } from './ctx';
import { churuTube, comb } from './props';

const combArt = () => artImg('objects-brush', comb);

/** 오늘 더 못 먹으면 고개를 돌린다 */
export function refuseChuru(v: CatView) {
  const a = v.actor;
  a.facing = (a.facing * -1) as 1 | -1;
  a.act = { kind: 'pose', pose: 'loaf', until: performance.now() + 2500 };
  a.say('오늘은 그만 먹을래옹…', 2000);
  sfx('nyangMeow', { rate: 0.8, volume: 0.6 });
}

export async function giveChuru(ctx: RoomCtx, v: CatView, flavor: ChuruId): Promise<void> {
  const a = v.actor;
  const room = ctx.room;
  const liked = PERSONALITY[ctx.cat(v.slot).personality].churu === flavor;
  ctx.setBusy(true);
  v.scene = 'churu';
  a.sink = 0;
  a.perky = true;
  room.classList.add('scene-churu');
  // 1) 달려와서 조르기
  const spot = { x: 0.5, y: 0.9 };
  sfx('nyangMeow', { rate: 1.5 });
  a.say('!!', 700);
  ctx.walkTo(v, spot, { kind: 'hold', pose: 'beg' }, true);
  const tube = document.createElement('div');
  tube.className = 'churu-tube';
  tube.innerHTML = artImg(`objects-churu-${flavor}` as WorldArt, churuTube(CHURU[flavor].color));
  room.append(tube);
  const tray = ctx.tray(`<div class="churu-ctrl">
      <div class="churu-name">${CHURU[flavor].name} 츄르${liked ? ' <em>♥ 제일 좋아하는 맛</em>' : ''}</div>
      <div class="churu-bar"><i></i></div>
      <button class="btn primary wide squeeze" type="button">꾹 눌러서 짜 주기</button></div>`);
  const btn = tray.querySelector<HTMLButtonElement>('.squeeze')!;
  const bar = tray.querySelector<HTMLElement>('.churu-bar i')!;
  btn.disabled = true;
  // 도착할 때까지
  while (a.act.kind === 'walk') await sleep(50);
  a.perky = false;
  a.facing = 1;
  a.setFx('sparkle');
  a.say(liked ? '츄르다옹!! 제일 좋아!' : '츄르다옹!!', 1600);
  sfx('nyangHeart');
  ctx.saw(v, 'churu');
  btn.disabled = false;

  let pressing = false;
  let pressAt = 0;
  let progress = 0;
  let lickAt = 0;
  let begAt = 0;
  const DUR = 3600;
  const down = (e: Event) => {
    e.preventDefault();
    pressing = true;
    pressAt = performance.now();
    btn.classList.add('down');
  };
  const up = () => {
    if (pressing && progress < 1) {
      a.act = { kind: 'hold', pose: 'beg' };
      a.setFx('sparkle');
      if (performance.now() > begAt) {
        a.say(['더…!', '냐앙…', '조금만 더옹'][Math.floor(Math.random() * 3)], 900);
        begAt = performance.now() + 1500;
      }
    }
    pressing = false;
    btn.classList.remove('down');
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  await new Promise<void>((done) => {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      // 츄르는 입 바로 앞에 (고양이가 콩콩 뛰는 것을 따라간다)
      const m = a.mouthPoint();
      // 그림의 뜯은 입구(오른쪽 위 = 78% · 8%)를 입 바로 앞에 두고, 몸통은 오른쪽 위로 (집사 손) — 그 점을 축으로 돌린다
      const tw = Math.max(30, a.screen().s * 125);
      tube.style.width = `${tw}px`;
      tube.style.height = `${tw * 1.25}px`;
      tube.style.transformOrigin = '78% 8%';
      tube.style.transform = `translate(${m.x + 10 - tw * 0.78}px, ${m.y - tw * 1.25 * 0.08}px) rotate(${pressing ? 222 : 230}deg)`;
      tube.classList.toggle('squeezing', pressing);
      tube.style.zIndex = String(Math.round(ctx.toScreen(a.pos).y) + 5);
      tube.style.setProperty('--left', String(1 - progress));
      a.lift = pressing ? 0 : Math.abs(Math.sin(now / 180)) * 6;
      if (pressing) {
        progress = Math.min(1, progress + dt / DUR);
        bar.style.width = `${progress * 100}%`;
        // 핥기 8칸 (8fps). 그림이 없는 자세가 아니니 혀 · 눈 연출(코드)은 끈다
        a.setFx('none');
        a.act = { kind: 'hold', pose: LICK_POSES[Math.floor((now - pressAt) / 125) % 8] };
        if (now > lickAt) {
          lickAt = now + 260 + Math.random() * 80;
          sfx('nyangLick', { rate: 0.9 + Math.random() * 0.3 });
          if (Math.random() < 0.35) buzz(5);
          if (Math.random() < 0.25) floatAt(room, m.x + (Math.random() - 0.5) * 50, m.y - 20, '날름', 'float lick');
          if (Math.random() < 0.15) sfx('nyangSqueeze');
        }
        if (progress >= 1) return done();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  btn.disabled = true;
  a.lift = 0;
  // 2) 다 먹었다: 서버에 하나 쓰고 입맛 다시기 · 하트
  try {
    const r = await ctx.api.churu(v.slot, flavor);
    ctx.apply(r);
    ctx.rewards(r);
    tube.classList.add('empty');
    a.act = { kind: 'hold', pose: 'sit' };
    a.setFx('smack');
    a.say('쩝쩝…', 1200);
    sfx('nyangLick', { rate: 0.7 });
    await sleep(1500);
    tube.remove();
    a.setFx('none');
    a.act = { kind: 'hold', pose: 'blink' };
    sfx('nyangPurr');
    const m = a.mouthPoint();
    for (let i = 0; i < 7; i++) setTimeout(() => floatAt(room, m.x + (Math.random() - 0.5) * 90, m.y - 30 - Math.random() * 50, '♥', 'float heart'), i * 120);
    a.say(liked ? '최고야… 행복해옹♥' : '맛있었다옹♥', 2000);
    if (r.love > 0) setTimeout(() => floatAt(room, m.x, m.y - 90, `친밀도 +${r.love}`, 'float love'), 500);
    if (r.cured) setTimeout(() => toast('츄르를 먹고 기운이 났어요. 2시간 뒤면 다 나아요'), 600);
    buzz([10, 40, 10, 40, 10]);
    await sleep(2200);
    a.act = { kind: 'pose', pose: 'sit', until: performance.now() + 1500 };
  } catch (e) {
    toast(errorText(e));
    tube.remove();
    a.setFx('none');
    if (e instanceof Error && e.message === 'churu full') refuseChuru(v);
  }
  ctx.tray(null);
  room.classList.remove('scene-churu');
  v.scene = null;
  ctx.setBusy(false);
}

export async function brushCat(ctx: RoomCtx, v: CatView): Promise<void> {
  const a = v.actor;
  const room = ctx.room;
  ctx.setBusy(true);
  v.scene = 'brush';
  a.sink = 0;
  ctx.walkTo(v, { x: 0.5, y: 0.78 }, { kind: 'hold', pose: 'loaf' });
  const tray = ctx.tray(`<div class="brush-ctrl"><div class="comb-slot"><div class="comb">${combArt()}</div><small>빗</small></div>
    <div class="brush-info"><span>빗을 끌어서 등을 쓸어 주세요</span><div class="churu-bar"><i></i></div></div><div class="furball"><i>${artImg('objects-fur-ball', '')}</i><small>털 뭉치</small></div></div>`);
  while (a.act.kind === 'walk') await sleep(50);
  a.facing = 1;
  a.say('빗질이다옹?', 1200);
  ctx.saw(v, 'brush');
  const combEl = tray.querySelector<HTMLElement>('.comb')!;
  const bar = tray.querySelector<HTMLElement>('.churu-bar i')!;
  const ball = tray.querySelector<HTMLElement>('.furball i')!;
  const NEED = 1400; // 고양이 위에서 움직인 거리(px)
  let rubbed = 0;
  await new Promise<void>((done) => {
    combEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      combEl.setPointerCapture(e.pointerId);
      const ghost = document.createElement('div');
      ghost.className = 'drag-comb';
      ghost.innerHTML = combArt();
      document.body.append(ghost);
      combEl.classList.add('lifted');
      let lx = e.clientX;
      let ly = e.clientY;
      let fluffAt = 0;
      const place = (x: number, y: number) => (ghost.style.transform = `translate(${x - 30}px, ${y - 30}px) rotate(-20deg)`);
      place(lx, ly);
      const move = (ev: PointerEvent) => {
        const d = Math.hypot(ev.clientX - lx, ev.clientY - ly);
        lx = ev.clientX;
        ly = ev.clientY;
        place(lx, ly);
        const r = a.hit.getBoundingClientRect();
        const over = lx > r.left + r.width * 0.12 && lx < r.right - r.width * 0.12 && ly > r.top + r.height * 0.25 && ly < r.bottom - r.height * 0.05;
        if (!over || d < 1) return;
        rubbed += d;
        bar.style.width = `${Math.min(100, (rubbed / NEED) * 100)}%`;
        ball.style.setProperty('--k', String(Math.min(1, rubbed / NEED)));
        a.act = { kind: 'hold', pose: rubbed > NEED * 0.4 ? 'blink' : 'loaf' };
        const now = performance.now();
        if (now > fluffAt) {
          fluffAt = now + 90;
          const rr = room.getBoundingClientRect();
          floatAt(room, lx - rr.left + (Math.random() - 0.5) * 20, ly - rr.top, '', 'fluff');
          sfx('nyangBrush', { rate: 0.8 + Math.random() * 0.4 });
          if (Math.random() < 0.2) buzz(4);
          if (Math.random() < 0.06) a.say('골골…', 900);
        }
        if (rubbed >= NEED) {
          end();
          done();
        }
      };
      const end = () => {
        combEl.removeEventListener('pointermove', move);
        combEl.removeEventListener('pointerup', end);
        combEl.removeEventListener('pointercancel', end);
        combEl.classList.remove('lifted');
        ghost.remove();
      };
      combEl.addEventListener('pointermove', move);
      combEl.addEventListener('pointerup', end);
      combEl.addEventListener('pointercancel', end);
    });
  });
  try {
    const r = await ctx.api.brush(v.slot);
    ctx.apply(r);
    ctx.rewards(r);
    const m = a.mouthPoint();
    a.act = { kind: 'pose', pose: 'stretch', until: performance.now() + 1800 };
    a.say('보송보송해졌다옹', 1800);
    floatAt(room, m.x, m.y - 60, `털 뭉치 +${r.fur}`, 'float big');
    if (r.love > 0) setTimeout(() => floatAt(room, m.x, m.y - 20, `친밀도 +${r.love}`, 'float love'), 400);
    sfx('nyangHeart');
    buzz([10, 30, 10]);
    await sleep(1400);
  } catch (e) {
    toast(errorText(e));
  }
  ctx.tray(null);
  v.scene = null;
  ctx.setBusy(false);
}

/** 정보 창에서: 오늘 빗질했는지 · 츄르를 몇 개 먹었는지 (한국 날짜) */
export const brushedToday = (ctx: RoomCtx, slot: number, day: number) => ctx.cat(slot).brushDay === day;
export const churuToday = (ctx: RoomCtx, slot: number, day: number) => (ctx.cat(slot).churuDay === day ? ctx.cat(slot).churuN : 0);
export const CHURU_MAX = CONST.churu_day_max;

/**
 * 캣그라스 · 캣닢 주기 (4단계, 보관함에서): 고양이가 달려와 냠냠 (기분 크게 · 친밀도). 캣닢이면 그 뒤 10분 동안 신나서 우다다 (behavior.ts).
 */
export async function giveTreat(ctx: RoomCtx, v: CatView, kind: 'catgrass' | 'catnip'): Promise<void> {
  if (ctx.busy() || v.scene) return toast('잠시 뒤 다시 해 주세요');
  if (ctx.view() !== 'room') toast('방에서 고양이가 기다려요');
  const a = v.actor;
  const room = ctx.room;
  ctx.setBusy(true);
  v.scene = 'treat';
  a.sink = 0;
  a.perky = true;
  sfx('nyangMeow', { rate: 1.4 });
  a.say('!!', 700);
  const spot = { x: 0.5, y: 0.8 };
  ctx.walkTo(v, spot, { kind: 'hold', pose: 'beg' }, true);
  const dish = document.createElement('div');
  dish.className = 'treat-dish';
  dish.innerHTML = artImg(`plants-${kind}-3` as WorldArt, '🌿');
  room.append(dish);
  const s0 = ctx.toScreen({ x: spot.x + 0.13, y: spot.y + 0.02 });
  const w = Math.max(44, ctx.W() * 0.15);
  dish.style.cssText = `width:${w}px;height:${w * 1.55}px;transform:translate(${s0.x - w / 2}px, ${s0.y - w * 1.55}px);z-index:${Math.round(s0.y) + 2}`;
  while (a.act.kind === 'walk') await sleep(50);
  a.perky = false;
  a.facing = 1;
  try {
    const r = await ctx.api.treat(v.slot, kind);
    ctx.apply(r);
    ctx.rewards(r);
    a.act = { kind: 'hold', pose: 'eat' };
    a.say(kind === 'catnip' ? '킁킁… 냐아앙~!!' : '냠냠 아삭아삭', 1800);
    for (let i = 0; i < 6; i++) setTimeout(() => sfx('nyangLick', { rate: 1.1 + Math.random() * 0.3, volume: 0.6 }), i * 300);
    buzz([10, 30, 10]);
    await sleep(2200);
    dish.remove();
    const m = a.mouthPoint();
    for (let i = 0; i < 6; i++) setTimeout(() => floatAt(room, m.x + (Math.random() - 0.5) * 80, m.y - 30 - Math.random() * 40, '♥', 'float heart'), i * 140);
    if (r.love > 0) setTimeout(() => floatAt(room, m.x, m.y - 80, `친밀도 +${r.love}`, 'float love'), 400);
    if (kind === 'catnip') {
      a.say('신난다옹!!', 1500);
      sfx('nyangMeow', { rate: 1.7 });
      let act: import('./cat').Act | undefined;
      for (let i = 0; i < 5; i++) act = { kind: 'walk', to: { x: 0.06 + Math.random() * 0.88, y: 0.25 + Math.random() * 0.73 }, speed: 480, then: act };
      a.act = act!;
      toast('캣닢에 신이 났어요! 10분 동안 우다다해요', 2400);
    } else {
      a.act = { kind: 'pose', pose: 'blink', until: performance.now() + 1500 };
      toast(`${josa(SEED_NAME[kind], '을', '를')} 맛있게 먹었어요`);
    }
  } catch (e) {
    dish.remove();
    toast(errorText(e));
    a.act = { kind: 'pose', pose: 'sit', until: performance.now() + 1000 };
  }
  v.scene = null;
  ctx.setBusy(false);
}
