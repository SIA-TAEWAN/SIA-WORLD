/**
 * 베란다 정원 (PRD 6장): 방을 옆으로 밀면 나온다. 선반 두 단에 화분 칸(처음 4, 엽전으로 12까지).
 *   빈 화분 누르기 → 씨앗 고르기 · 물뿌리개를 끌어다 화분 위에서 기울이기 → 물 (물을 준 뒤 정해진 시간만 자란다, 말라도 시들지 않음)
 *   씨앗 → 새싹 → 봉오리 → 꽃 4단계 그림, 다 자라면 반짝 → 눌러서 수확 (보관함으로)
 *   고양이가 가끔 따라와 화분 냄새를 맡거나 나비를 쫓는다 (식물에는 아무 일도 없다)
 * 모든 변화는 서버(nyang_plant · nyang_water_pot · nyang_harvest · nyang_expand_pots)가 서버 시각으로 계산한다.
 */
import { PLANT, POT_MAX, POT_PRICES, POT_START, SEED_IDS, SEED_NAME, type PlantId } from '../data/balance';
import { VERANDA, type WorldArt } from '../data/world.gen';
import { potGrown, potReadyAt, potStage, potWet, topLevel, type Pot } from '../game/rules';
import { errorText } from '../net/api';
import { artImg, bgLayer } from './art';
import { CatActor } from './cat';
import { buzz, floatAt, josa, sfx, toast } from './common';
import { clamp, sleep, type RoomCtx } from './ctx';

/** 코드로 그린 화분 (그림을 못 불러올 때) */
const potSvg = (stage: number) => `<svg viewBox="0 0 60 93" aria-hidden="true">
  ${stage > 0 ? `<path d="M30 60 V${60 - stage * 14}" stroke="#5FA772" stroke-width="4" stroke-linecap="round"/><path d="M30 ${64 - stage * 10} q-12 -8 -16 2 q8 6 16 -2 z M30 ${60 - stage * 10} q12 -8 16 2 q-8 6 -16 -2 z" fill="#7CC08A" stroke="var(--outline)" stroke-width="2"/>` : ''}
  ${stage === 3 ? '<circle cx="30" cy="16" r="9" fill="var(--pink)" stroke="var(--outline)" stroke-width="3"/><circle cx="30" cy="16" r="3.5" fill="var(--primary)"/>' : ''}
  <path d="M10 60 H50 L45 90 H15 Z" fill="#E07A4F" stroke="var(--outline)" stroke-width="3.5" stroke-linejoin="round"/>
  <rect x="7" y="56" width="46" height="9" rx="3" fill="#EE8A5C" stroke="var(--outline)" stroke-width="3.5"/>
</svg>`;
const plantArt = (plant: PlantId | null, stage: number): string =>
  artImg((plant ? `plants-${plant}-${stage}` : 'plants-pot-empty') as WorldArt, potSvg(plant ? stage : -1), 'art pot-img');
const canSvg = `<svg viewBox="0 0 80 60" aria-hidden="true"><path d="M14 22 H50 L54 54 H10 Z" fill="var(--nyang-water)" stroke="var(--outline)" stroke-width="4" stroke-linejoin="round"/>
  <path d="M50 30 L74 14" stroke="var(--outline)" stroke-width="8" stroke-linecap="round"/><path d="M50 30 L74 14" stroke="var(--nyang-water)" stroke-width="4" stroke-linecap="round"/>
  <path d="M16 22 Q32 0 48 22" fill="none" stroke="var(--outline)" stroke-width="4"/></svg>`;
const canArt = () => artImg('objects-watering-can', canSvg);
const butterflySvg = `<svg viewBox="0 0 40 30" aria-hidden="true"><g stroke="var(--outline)" stroke-width="2.5" stroke-linejoin="round">
  <path class="wl" d="M20 15 Q6 -2 3 8 Q2 20 20 15 Z" fill="var(--pink)"/><path class="wr" d="M20 15 Q34 -2 37 8 Q38 20 20 15 Z" fill="var(--pink)"/></g>
  <ellipse cx="20" cy="16" rx="2.5" ry="7" fill="var(--outline)"/></svg>`;

const fmtLeft = (sec: number) => {
  const m = Math.max(1, Math.ceil(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
};

export interface VerandaView {
  paint(): void;
  enter(): void;
  leave(): void;
}

export function mountVeranda(ctx: RoomCtx, el: HTMLElement, tray: HTMLElement): VerandaView {
  el.innerHTML = `<div class="v-sky"></div><div class="v-bg" id="vBg"></div><div class="v-shelf top"></div><div class="v-shelf bottom"></div>
    <div class="pots" id="vPots"></div><div class="butterfly hidden" id="vFly">${butterflySvg}</div>`;
  bgLayer(el.querySelector<HTMLElement>('#vBg')!, 'veranda');
  tray.innerHTML = `<div class="canslot"><div class="can" id="vCan" aria-label="물뿌리개">${canArt()}</div><small>물뿌리개</small></div>
    <div class="hint" id="vHint"></div>
    <button class="btn catbtn" id="vBag" type="button">🎒 보관함</button>`;
  const potsEl = el.querySelector<HTMLElement>('#vPots')!;
  const hintEl = tray.querySelector<HTMLElement>('#vHint')!;
  tray.querySelector('#vBag')!.addEventListener('click', () => ctx.openShop('bag'));
  let shown = false;
  let W = 300;
  let H = 400;
  /** 선반 자리 (그림이 화면을 덮도록 늘리고 아래에 맞춘다: background cover · bottom) */
  const geo = () => {
    const k = Math.max(W / VERANDA.w, H / VERANDA.h);
    const dh = VERANDA.h * k;
    const offY = H - dh;
    return { top: offY + VERANDA.top * dh, bottom: offY + VERANDA.bottom * dh, floor: offY + VERANDA.floor * dh };
  };
  function slotRect(slot: number) {
    const g = geo();
    const row = slot <= 6 ? 0 : 1;
    const col = (slot - 1) % 6;
    const w = Math.min(W / 6, (g.bottom - g.top) * 0.68);
    const h = w * 1.55;
    // 오른쪽 위 무대 단추(방 · 상점)와 겹치지 않게 왼쪽으로 모은다 (6번째 열 = 0.735W)
    const x = W * (0.085 + col * 0.13);
    const y = row ? g.bottom : g.top;
    return { x, y, w, h };
  }
  let lastKey = '';
  function paint(force = false) {
    if (!shown && !force) return;
    W = el.clientWidth || W;
    H = el.clientHeight || H;
    const s = ctx.state();
    const t = Math.floor(ctx.now());
    const n = s.profile.pots;
    const key = [W, H, n, ...s.pots.map((p) => `${p.slot}:${p.plant}:${potStage(p, t)}:${potWet(p, t) ? 1 : 0}:${Math.floor((potGrown(p, t) / PLANT[p.plant].grow_sec) * 20)}`)].join('|');
    if (key !== lastKey) {
      lastKey = key;
      const cells: string[] = [];
      for (let slot = 1; slot <= Math.min(POT_MAX, n + 1); slot++) {
        const r = slotRect(slot);
        const st = `left:${r.x - r.w / 2}px;top:${r.y - r.h}px;width:${r.w}px;height:${r.h}px;z-index:${Math.round(r.y)}`;
        if (slot > n) {
          cells.push(`<button class="pot add" type="button" data-add style="${st}" aria-label="화분 늘리기"><span>＋</span><small><i class="coin-ico"></i>${POT_PRICES[n - POT_START]}</small></button>`);
          continue;
        }
        const p = s.pots.find((x) => x.slot === slot);
        if (!p) {
          cells.push(`<button class="pot empty" type="button" data-pot="${slot}" style="${st}" aria-label="빈 화분">${plantArt(null, 0)}</button>`);
          continue;
        }
        const stage = potStage(p, t);
        const wet = potWet(p, t);
        const pct = Math.round((potGrown(p, t) / PLANT[p.plant].grow_sec) * 100);
        cells.push(`<button class="pot ${stage === 3 ? 'ready' : wet ? 'wet' : 'dry'}" type="button" data-pot="${slot}" style="${st}" aria-label="${SEED_NAME[p.plant]}">
          ${plantArt(p.plant, stage)}${stage === 3 ? '<span class="sparkle">✦</span><span class="sparkle s2">✦</span>' : `<span class="pbar"><i style="width:${pct}%"></i></span>${wet ? '' : '<span class="drop">💧</span>'}`}</button>`);
      }
      potsEl.innerHTML = cells.join('');
    }
    const ready = s.pots.filter((p) => potStage(p, t) === 3).length;
    const dry = s.pots.filter((p) => potStage(p, t) < 3 && !potWet(p, t)).length;
    const empty = n - s.pots.length;
    hintEl.textContent = ready
      ? `다 자란 꽃이 ${ready}개 — 눌러서 수확해요`
      : dry
        ? `물이 마른 화분이 ${dry}개 — 물뿌리개를 끌어다 기울여요`
        : empty
          ? '빈 화분을 눌러 씨앗을 심어요'
          : '쑥쑥 자라는 중이에요 · 방으로 가려면 옆으로 밀어요';
  }

  // ---------- 화분 누르기: 심기 · 수확 · 상태 보기 · 칸 늘리기 ----------
  potsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.pot');
    if (!b || ctx.busy()) return;
    if (b.dataset.add != null) return void expand();
    const slot = Number(b.dataset.pot);
    const s = ctx.state();
    const p = s.pots.find((x) => x.slot === slot);
    if (!p) return chooseSeed(slot);
    const t = Math.floor(ctx.now());
    if (potStage(p, t) === 3) return void doHarvest(p, b);
    const ready = potReadyAt(p, t);
    const pl = PLANT[p.plant];
    if (ready != null) toast(`${SEED_NAME[p.plant]} · 약 ${fmtLeft(ready - t)} 뒤에 꽃이 펴요`);
    else if (potWet(p, t)) toast(`${SEED_NAME[p.plant]} · 물이 ${fmtLeft(p.waterAt! + pl.water_sec - t)} 남았어요 (그 뒤에 물을 한 번 더)`);
    else toast(`${SEED_NAME[p.plant]} · 물이 말라서 쉬고 있어요 — 물을 주면 다시 자라요`);
    b.classList.remove('tap');
    void b.offsetWidth;
    b.classList.add('tap');
  });

  async function doHarvest(p: Pot, b: HTMLElement) {
    ctx.setBusy(true);
    try {
      const r = await ctx.api.harvest(p.slot);
      ctx.apply(r);
      ctx.rewards(r);
      const rr = el.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      floatAt(el, bb.left - rr.left + bb.width / 2, bb.top - rr.top + 10, `${SEED_NAME[p.plant]} +1`, 'float big');
      sfx('nyangGift');
      buzz([10, 30, 10]);
      if (p.plant === 'catgrass' || p.plant === 'catnip') setTimeout(() => toast('보관함에서 고양이에게 줄 수 있어요'), 900);
      else if (p.plant === 'moonflower') setTimeout(() => toast('보름달꽃 3송이를 모으면 보관함에서 보름달 등과 바꿔요'), 900);
    } catch (e) {
      toast(errorText(e));
    } finally {
      ctx.setBusy(false);
    }
  }

  function chooseSeed(slot: number) {
    const s = ctx.state();
    const lv = topLevel(s);
    const dim = document.createElement('div');
    dim.className = 'dim sheet-dim';
    const rows = SEED_IDS.map((id) => {
      const pl = PLANT[id];
      const have = s.profile.items[`seed:${id}`] ?? 0;
      const open = lv >= pl.level;
      return `<button class="btn choice ${have ? '' : 'locked'}" type="button" ${have ? `data-seed="${id}"` : 'data-noseed'}>
        <span class="cico">${artImg(`plants-${id}-3` as WorldArt, '🌱', 'art seed-ico')}</span><b>${SEED_NAME[id]}</b>
        <small>${have ? `${have}개 · ${pl.grow_sec / 3600}시간` : open ? '상점에서 사요' : `친밀도 Lv${pl.level}`}</small></button>`;
    }).join('');
    dim.innerHTML = `<div class="sheet panel" role="dialog" aria-label="씨앗 고르기"><button class="btn iconbtn close" type="button" data-close aria-label="닫기">✕</button>
      <h3>무엇을 심을까요?</h3><p class="likes">물을 주면 정해진 시간 동안 자라요. 말라도 시들지 않아요</p>
      <div class="choices three">${rows}</div><button class="btn wide" type="button" data-shop>🛒 씨앗 사러 가기</button></div>`;
    document.body.append(dim);
    sfx('click');
    dim.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === dim || t.closest('[data-close]')) return dim.remove();
      if (t.closest('[data-shop]') || t.closest('[data-noseed]')) {
        dim.remove();
        return ctx.openShop('seed');
      }
      const id = t.closest<HTMLElement>('[data-seed]')?.dataset.seed as PlantId | undefined;
      if (!id) return;
      dim.remove();
      ctx.setBusy(true);
      try {
        const r = await ctx.api.plant(slot, id);
        ctx.apply(r);
        ctx.rewards(r);
        sfx('nyangScoop');
        buzz(15);
        toast(`${josa(SEED_NAME[id], '을', '를')} 심었어요 — 물뿌리개로 물을 주세요`);
      } catch (err) {
        toast(errorText(err));
      } finally {
        ctx.setBusy(false);
      }
    });
  }

  async function expand() {
    const s = ctx.state();
    const n = s.profile.pots;
    if (n >= POT_MAX) return;
    const price = POT_PRICES[n - POT_START];
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="summary panel" role="dialog" aria-label="화분 늘리기"><h3>화분을 하나 더 놓을까요?</h3>
      <p class="away">${n + 1}번째 칸 · 엽전 ${price} (가진 엽전 ${s.profile.coins.toLocaleString('ko-KR')})</p>
      <div class="row2"><button class="btn" type="button" data-close>그만두기</button><button class="btn primary" type="button" data-ok ${s.profile.coins < price ? 'disabled' : ''}>늘리기</button></div></div>`;
    document.body.append(dim);
    dim.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === dim || t.closest('[data-close]')) return dim.remove();
      if (!t.closest('[data-ok]')) return;
      dim.remove();
      try {
        const r = await ctx.api.expandPots();
        ctx.apply(r);
        sfx('coin');
        buzz(20);
        toast(`화분이 ${r.state.profile.pots}칸이 되었어요`);
      } catch (err) {
        toast(errorText(err));
      }
    });
  }

  // ---------- 물뿌리개: 끌어다 화분 위에서 기울이기 ----------
  const can = tray.querySelector<HTMLElement>('#vCan')!;
  can.addEventListener('pointerdown', (e) => {
    if (ctx.busy()) return;
    e.preventDefault();
    can.setPointerCapture(e.pointerId);
    const ghost = document.createElement('div');
    ghost.className = 'drag-can';
    ghost.innerHTML = canArt();
    document.body.append(ghost);
    can.classList.add('lifted');
    let px = e.clientX;
    let py = e.clientY;
    let over: HTMLElement | null = null;
    let pour = 0;
    let lastT = performance.now();
    let raf = 0;
    const sent = new Set<number>();
    const place = () => (ghost.style.transform = `translate(${px - 40}px, ${py - 60}px) rotate(${over ? -34 : 0}deg)`);
    place();
    sfx('click');
    const tick = (now: number) => {
      const dt = now - lastT;
      lastT = now;
      if (over) {
        pour += dt;
        if (Math.random() < 0.5) {
          const rr = el.getBoundingClientRect();
          const d = document.createElement('i');
          d.className = 'waterdrop';
          d.style.left = `${px - rr.left - 52 + Math.random() * 14}px`;
          d.style.top = `${py - rr.top - 30}px`;
          el.append(d);
          setTimeout(() => d.remove(), 500);
        }
        if (Math.random() < 0.08) sfx('nyangWater', { rate: 1.3, volume: 0.5 });
        const slot = Number(over.dataset.pot);
        if (pour > 650 && !sent.has(slot)) {
          sent.add(slot);
          void waterOne(slot, over);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      // 물뿌리개 주둥이(왼쪽 위)가 화분 위에 있을 때
      const hx = px - 45;
      const hy = py;
      let hit: HTMLElement | null = null;
      for (const b of potsEl.querySelectorAll<HTMLElement>('.pot[data-pot]:not(.empty)')) {
        const r = b.getBoundingClientRect();
        if (hx > r.left - 6 && hx < r.right + 6 && hy > r.top - 50 && hy < r.bottom - r.height * 0.3) hit = b;
      }
      if (hit !== over) {
        over?.classList.remove('target');
        over = hit;
        over?.classList.add('target');
        pour = 0;
        if (over) buzz(10);
      }
      place();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      can.removeEventListener('pointermove', move);
      can.removeEventListener('pointerup', up);
      can.removeEventListener('pointercancel', up);
      over?.classList.remove('target');
      can.classList.remove('lifted');
      ghost.classList.add('back');
      const r = can.getBoundingClientRect();
      ghost.style.transform = `translate(${r.left}px, ${r.top}px) rotate(0deg)`;
      setTimeout(() => ghost.remove(), 250);
    };
    can.addEventListener('pointermove', move);
    can.addEventListener('pointerup', up);
    can.addEventListener('pointercancel', up);
  });
  async function waterOne(slot: number, b: HTMLElement) {
    const p = ctx.state().pots.find((x) => x.slot === slot);
    const t = Math.floor(ctx.now());
    if (!p) return;
    if (potStage(p, t) === 3) return toast('다 자랐어요. 눌러서 수확해요');
    if (potWet(p, t)) return toast('아직 흙이 촉촉해요');
    try {
      const r = await ctx.api.waterPot(slot);
      ctx.apply(r);
      ctx.rewards(r);
      sfx('nyangWater');
      buzz([8, 30, 8]);
      const rr = el.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      floatAt(el, bb.left - rr.left + bb.width / 2, bb.top - rr.top + 20, '촉촉 💧', 'float love');
    } catch (e) {
      toast(errorText(e));
    }
  }

  // ---------- 고양이가 가끔 따라온다: 화분 냄새 맡기 · 나비 쫓기 ----------
  let visitor: CatActor | null = null;
  let visitTimer = 0;
  let alive = false;
  let raf = 0;
  const fly = el.querySelector<HTMLElement>('#vFly')!;
  const floorRect = () => {
    const g = geo();
    const top = Math.max(g.floor + 4, H * 0.55);
    return { left: W * 0.06, top, width: W * 0.88, height: Math.max(40, H - top - 14) };
  };
  function loop(t: number) {
    if (!alive) return;
    if (visitor) visitor.update(t, 16);
    raf = requestAnimationFrame(loop);
  }
  async function catVisit() {
    if (!alive || visitor) return;
    const c = ctx.cat(ctx.views[0].slot);
    const lv = ctx.levels(c.slot);
    if (lv.sick || ctx.views[0].scene) return;
    const a = new CatActor(el, c.color, c.pattern, { x: -0.15, y: 0.6 });
    visitor = a;
    const f = floorRect();
    a.floor = { ...f, scale: Math.min(H * 0.27, W * 0.42) / 381 };
    const walk = async (to: { x: number; y: number }, speed = 150) => {
      a.act = { kind: 'walk', to, speed };
      while (alive && a.act.kind === 'walk') await sleep(60);
    };
    try {
      a.perky = true;
      a.say('냥?', 900);
      await walk({ x: 0.25 + Math.random() * 0.5, y: 0.25 });
      a.perky = false;
      if (Math.random() < 0.55 && ctx.state().pots.length) {
        // 화분 냄새 맡기
        a.facing = Math.random() < 0.5 ? 1 : -1;
        a.act = { kind: 'hold', pose: 'loaf' };
        a.say('킁킁…', 1600);
        await sleep(2200);
        a.act = { kind: 'hold', pose: 'sit' };
        a.say(['좋은 냄새다옹', '이건 뭐냥', '풀 냄새~'][Math.floor(Math.random() * 3)], 1600);
        await sleep(2400);
      } else {
        // 나비 쫓기
        fly.classList.remove('hidden');
        a.say('!', 700);
        for (let i = 0; i < 4 && alive; i++) {
          const to = { x: 0.1 + Math.random() * 0.8, y: Math.random() * 0.7 };
          const sp = { x: f.left + to.x * f.width, y: f.top + to.y * f.height - 70 - Math.random() * 40 };
          fly.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
          a.wiggle = true;
          await sleep(500);
          a.wiggle = false;
          await walk(to, 330);
          a.act = { kind: 'pose', pose: 'jump', until: performance.now() + 500 };
          sfx('nyangMeow', { rate: 1.5, volume: 0.4 });
          await sleep(650);
        }
        fly.style.transform = `translate(${W + 40}px, ${-40}px)`;
        a.act = { kind: 'hold', pose: 'sit' };
        a.say('놓쳤다옹…', 1500);
        await sleep(1800);
        fly.classList.add('hidden');
      }
      await walk({ x: -0.2, y: 0.5 }, 170);
    } finally {
      a.el.remove();
      if (visitor === a) visitor = null;
    }
  }

  return {
    paint: () => paint(),
    enter() {
      shown = true;
      alive = true;
      lastKey = '';
      paint(true);
      raf = requestAnimationFrame(loop);
      clearTimeout(visitTimer);
      // 들어오고 조금 뒤 · 그 뒤로도 가끔 고양이가 따라온다
      const plan = (ms: number) =>
        (visitTimer = window.setTimeout(() => {
          if (!alive) return;
          if (Math.random() < 0.6) void catVisit();
          plan(clamp(20000 + Math.random() * 25000, 15000, 45000));
        }, ms));
      plan(2500 + Math.random() * 3000);
    },
    leave() {
      shown = false;
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(visitTimer);
      fly.classList.add('hidden');
      if (visitor) {
        visitor.el.remove();
        visitor = null;
      }
    },
  };
}
