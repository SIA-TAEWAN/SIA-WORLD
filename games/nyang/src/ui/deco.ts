/**
 * 5단계 꾸미기 (PRD 7 · 8장): 방에 놓인 가구 그리기 · 벽지 · 바닥 · 창문(커튼) 무늬 · 꾸미기 모드.
 * 가구 그림은 4단계 SpriteCook 그림(public/art/world/furniture-*) — 선물 가구(발바닥 러그 · 털실 바구니)는 코드 그림.
 * 벽지 · 바닥 · 커튼은 그림을 새로 그리지 않고 CSS 색 · 무늬로 (style.css 의 [data-wall] · [data-floor] · [data-window]).
 * 꾸미기 모드: 방이 격자로 바뀌고, 아래 띠의 가구를 끌어다 놓기 · 놓인 가구를 끌어 옮기기 · 아래 띠로 끌어 치우기,
 * 벽지 · 바닥 · 창문 고르기(없는 것은 그 자리에서 엽전으로 사기) → [저장] 을 누르면 서버 nyang_place 가 확인하고 저장한다.
 */
import { BLOCKED, CONST, FURNITURE_NAME, FURNITURE_OF, SEED_NAME, SHOP_ITEM, STYLES, VASE_FLOWERS, type Furniture, type RoomStyle } from '../data/balance';
import type { WorldArt } from '../data/world.gen';
import { itemCount, layoutItems, layoutStyle, ownsFurniture, ownsStyle, type Placed } from '../game/rules';
import { errorText } from '../net/api';
import { artImg, ratioOf } from './art';
import type { Spot2 } from './cat';
import { buzz, esc, sfx, toast } from './common';
import type { FurnView, RoomCtx } from './ctx';
import { boxFront, cup, cushion, sideTable } from './props';

// ---------- 가구 그림 ----------

const rugSvg = `<svg viewBox="0 0 120 50" aria-hidden="true"><ellipse cx="60" cy="25" rx="56" ry="21" fill="#F7C1A8" stroke="var(--outline)" stroke-width="4"/>
  <ellipse cx="60" cy="25" rx="44" ry="14" fill="none" stroke="#FFF8E8" stroke-width="3" stroke-dasharray="6 5"/>
  <g fill="var(--pink)" stroke="var(--outline)" stroke-width="2"><ellipse cx="60" cy="29" rx="9" ry="6"/><circle cx="48" cy="20" r="3.6"/><circle cx="55" cy="16" r="3.6"/><circle cx="65" cy="16" r="3.6"/><circle cx="72" cy="20" r="3.6"/></g></svg>`;
const basketSvg = `<svg viewBox="0 0 100 80" aria-hidden="true"><g stroke="var(--outline)" stroke-width="4" stroke-linejoin="round">
  <circle cx="38" cy="30" r="15" fill="var(--pink)"/><circle cx="62" cy="28" r="14" fill="#9CC7F2"/><circle cx="50" cy="22" r="13" fill="var(--primary)"/>
  <path d="M8 34 H92 L82 76 H18 Z" fill="#D9A05B"/></g>
  <path d="M14 46 H86 M17 58 H83 M20 68 H80" stroke="#9A6A3A" stroke-width="3"/><path d="M8 34 H92" stroke="var(--outline)" stroke-width="5"/></svg>`;
const pillowSvg = `<svg viewBox="0 0 100 60" aria-hidden="true"><path d="M10 30 Q30 6 66 14 L90 4 L84 30 L90 56 L66 46 Q30 54 10 30 Z" fill="#9CC7F2" stroke="var(--outline)" stroke-width="4" stroke-linejoin="round"/><circle cx="28" cy="26" r="4" fill="var(--outline)"/></svg>`;

/** 가구 → 그림 (없으면 코드 그림) · 방 너비에 대한 그림 너비 */
const ART: Record<string, { art: WorldArt | null; svg: string; w: number; ratio?: number }> = {
  desk: { art: 'furniture-desk', svg: sideTable, w: 0.22 },
  cushion: { art: 'furniture-cushion', svg: cushion, w: 0.27 },
  box: { art: 'objects-box', svg: boxFront, w: 0.24 },
  vase: { art: 'furniture-vase', svg: '🏺', w: 0.11 },
  scratcher: { art: 'furniture-scratcher', svg: '🪵', w: 0.15 },
  hideaway: { art: 'furniture-hideaway', svg: '🏠', w: 0.28 },
  cat_tower: { art: 'furniture-cat-tower', svg: '🗼', w: 0.32 },
  moon_lamp: { art: 'furniture-moon-lamp', svg: '🌕', w: 0.15 },
  paw_rug: { art: null, svg: rugSvg, w: 0.3, ratio: 50 / 120 },
  fish_pillow: { art: 'objects-fish-toy', svg: pillowSvg, w: 0.15 },
  yarn_basket: { art: null, svg: basketSvg, w: 0.15, ratio: 0.8 },
  zodiac_shelf: { art: 'furniture-zodiac-shelf', svg: '🧸', w: 0.26 },
};
export const furnRatio = (id: string) => ART[id]?.ratio ?? (ART[id]?.art ? ratioOf(ART[id].art!) : 1);
export const furnArt = (id: string, cls = 'art') => (ART[id]?.art ? artImg(ART[id].art!, ART[id].svg, cls) : ART[id]?.svg ?? '🎁');

/** 꽃병의 꽃 (수확한 꽃 그림의 윗부분만) */
const vaseFlower = (flower: string | undefined) =>
  flower ? `<span class="vase-flower">${artImg(`plants-${flower}-3` as WorldArt, '', 'art')}</span>` : '';

/** 바닥 격자 칸 → 가구의 발 자리 (가운데 아래) */
export const cellAt = (f: Furniture, x: number, y: number): Spot2 => ({
  x: (x + f.w / 2) / CONST.grid_cols,
  y: (y + f.h) / CONST.grid_rows - 0.05,
});

export interface Geo {
  W: number;
  H: number;
  toScreen(p: Spot2): { x: number; y: number };
  floor: { left: number; top: number; width: number; height: number };
  wallH: number;
}
/** 벽 격자: 벽 높이의 6% ~ 90% 를 두 줄로 */
const wallCell = (g: Geo, x: number, y: number) => ({
  left: (x * g.W) / CONST.wall_cols,
  top: g.wallH * (0.06 + y * 0.42),
  width: g.W / CONST.wall_cols,
  height: g.wallH * 0.42,
});
const floorCell = (g: Geo, x: number, y: number) => ({
  left: g.floor.left + (x / CONST.grid_cols) * g.floor.width,
  top: g.floor.top + (y / CONST.grid_rows) * g.floor.height,
  width: g.floor.width / CONST.grid_cols,
  height: g.floor.height / CONST.grid_rows,
});

/** 방에 놓인 가구 (el 을 만들고 자리를 잡는다) */
export class Furnishing {
  views: FurnView[] = [];
  private key = '';
  constructor(private room: HTMLElement) {}

  /** 배치가 바뀌었으면 그림을 다시 만든다 */
  sync(items: Placed[], vase: string | undefined, force = false): boolean {
    const key = JSON.stringify([items, vase]);
    if (key === this.key && !force) return false;
    this.key = key;
    const old = new Map(this.views.map((v) => [v.id, v]));
    this.views = [];
    for (const it of items) {
      const f = FURNITURE_OF[it.id];
      if (!f) continue;
      let v = old.get(it.id);
      old.delete(it.id);
      if (!v) {
        const el = document.createElement('div');
        el.className = `prop furn furn-${f.id} use-${f.use}`;
        el.dataset.furn = f.id;
        el.innerHTML = `<div class="pic">${furnArt(f.id)}</div>${f.id === 'desk' ? `<span class="cup">${cup}</span>` : ''}${f.id === 'hideaway' ? '<span class="peek"><i></i><i></i></span>' : ''}`;
        this.room.append(el);
        v = { id: f.id, f, el, at: { x: 0, y: 0 } };
      }
      v.at = f.kind === 'floor' ? cellAt(f, it.x, it.y) : { x: it.x, y: it.y };
      (v as FurnView & { cell?: Placed }).el.dataset.x = String(it.x);
      v.el.dataset.y = String(it.y);
      if (f.id === 'vase') {
        const cur = v.el.querySelector('.vase-flower');
        if (cur?.getAttribute('data-f') !== (vase ?? '')) {
          cur?.remove();
          v.el.insertAdjacentHTML('beforeend', vaseFlower(vase));
          v.el.querySelector('.vase-flower')?.setAttribute('data-f', vase ?? '');
        }
      }
      this.views.push(v);
    }
    for (const v of old.values()) v.el.remove();
    return true;
  }

  layout(g: Geo) {
    for (const v of this.views) {
      const a = ART[v.id];
      const ratio = furnRatio(v.id);
      const x = Number(v.el.dataset.x);
      const y = Number(v.el.dataset.y);
      if (v.f.kind === 'wall') {
        const c0 = wallCell(g, x, y);
        const w = c0.width * v.f.w * 0.96;
        const bottom = c0.top + c0.height * v.f.h;
        v.el.style.width = `${w}px`;
        v.el.style.height = `${w * ratio}px`;
        v.el.style.transform = `translate(${c0.left + (c0.width * v.f.w - w) / 2}px, ${bottom - w * ratio}px)`;
        v.el.style.zIndex = '3';
        continue;
      }
      const s = g.toScreen(v.at);
      const w = g.W * a.w * (0.9 + 0.2 * v.at.y);
      v.el.style.width = `${w}px`;
      v.el.style.height = `${w * ratio}px`;
      v.el.style.transform = `translate(${s.x - w / 2}px, ${s.y - w * ratio}px)`;
      // 러그는 늘 바닥에 깔린다 (고양이 · 물건 아래)
      v.el.style.zIndex = v.f.use === 'rug' ? '2' : String(Math.round(s.y));
    }
  }
}

// ---------- 벽지 · 바닥 · 창문 ----------

export function applyStyles(room: HTMLElement, l: { wall?: string; floor?: string; window?: string }) {
  room.dataset.wall = l.wall ?? 'wall_cream';
  room.dataset.floor = l.floor ?? 'floor_wood';
  room.dataset.window = l.window ?? 'window_basic';
}
/** 무늬 견본 (꾸미기 띠) */
const swatch = (st: RoomStyle) => `<span class="swatch sw-${st.id}"></span>`;

// ---------- 꽃병 ----------

/** 꽃병 누르기: 해바라기 · 장미 꽂기 / 빼기 (꾸미기 밖에서도) */
export function chooseVase(ctx: RoomCtx) {
  const s = ctx.state();
  const cur = s.profile.layout.vase;
  const dim = document.createElement('div');
  dim.className = 'dim';
  dim.innerHTML = `<div class="summary panel vase-pick" role="dialog" aria-label="꽃병">
    <h3>🏺 꽃병에 꽃 꽂기</h3><p class="away">수확한 꽃을 하나 꽂아요. 시들지 않아요</p>
    <div class="choices three">${VASE_FLOWERS.map((f) => {
      const n = itemCount(s.profile, `plant:${f}`);
      return `<button class="btn choice ${n ? '' : 'locked'}" type="button" ${n ? `data-flower="${f}"` : 'disabled'}><span class="cico">${artImg(`plants-${f}-3` as WorldArt, '🌼', 'art')}</span><b>${SEED_NAME[f]}</b><small>${n}송이</small></button>`;
    }).join('')}
    ${cur ? '<button class="btn choice" type="button" data-flower=""><span class="cico">🫗</span><b>빼기</b><small>꽃은 사라져요</small></button>' : ''}</div>
    <button class="btn wide" type="button" data-close>닫기</button></div>`;
  document.body.append(dim);
  dim.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) return dim.remove();
    const b = el.closest<HTMLElement>('[data-flower]');
    if (!b) return;
    dim.remove();
    try {
      ctx.apply(await ctx.api.vase(b.dataset.flower ?? ''));
      sfx(b.dataset.flower ? 'nyangGift' : 'click');
      buzz(15);
      if (b.dataset.flower) toast(`꽃병에 ${SEED_NAME[b.dataset.flower as 'rose']}를 꽂았어요`);
    } catch (er) {
      toast(errorText(er));
    }
  });
}

// ---------- 꾸미기 모드 ----------

export interface DecoHost {
  ctx: RoomCtx;
  room: HTMLElement;
  stage: HTMLElement;
  furnish: Furnishing;
  geo(): Geo;
  /** 꾸미기 중 (가구 · 무늬를 미리 보여 준다) / 끝 (state 대로 다시 그린다) */
  preview(items: Placed[], styles: { wall: string; floor: string; window: string }): void;
  done(): void;
}

type Tab = 'furn' | 'wall' | 'floor' | 'window';

export function openDeco(h: DecoHost) {
  const { ctx, room } = h;
  const s0 = ctx.state();
  let items: Placed[] = layoutItems(s0.profile).map((i) => ({ ...i }));
  const styles = { wall: layoutStyle(s0.profile, 'wall'), floor: layoutStyle(s0.profile, 'floor'), window: layoutStyle(s0.profile, 'window') };
  let tab: Tab = 'furn';
  let armed = '';
  let saving = false;
  let offRoom = () => {};
  ctx.setBusy(true);
  room.classList.add('deco');
  sfx('click');
  const grid = document.createElement('div');
  grid.className = 'deco-grid';
  room.append(grid);
  const bar = document.createElement('div');
  bar.className = 'deco-bar';
  bar.innerHTML = `<button class="btn small" type="button" data-cancel>✕ 취소</button><b>🛋️ 꾸미기</b><button class="btn small primary" type="button" data-save>✓ 저장</button>`;
  h.stage.append(bar);
  const tray = ctx.tray(`<div class="deco-tray"><div class="deco-tabs">
      <button type="button" data-tab="furn">가구</button><button type="button" data-tab="wall">벽지</button><button type="button" data-tab="floor">바닥</button><button type="button" data-tab="window">창문</button></div>
    <div class="deco-list"></div><p class="deco-hint"></p></div>`);
  const list = tray.querySelector<HTMLElement>('.deco-list')!;
  const hint = tray.querySelector<HTMLElement>('.deco-hint')!;

  const owned = () => {
    const p = ctx.state().profile;
    return Object.keys(FURNITURE_OF).filter((id) => ownsFurniture(p, id));
  };
  function paintGrid() {
    const g = h.geo();
    const used = new Set<string>();
    for (const it of items) {
      const f = FURNITURE_OF[it.id];
      for (let dx = 0; dx < f.w; dx++) for (let dy = 0; dy < f.h; dy++) used.add(`${f.kind === 'wall' ? 'w' : 'f'}${it.x + dx}_${it.y + dy}`);
    }
    const cells: string[] = [];
    for (let y = 0; y < CONST.grid_rows; y++)
      for (let x = 0; x < CONST.grid_cols; x++) {
        const c = floorCell(g, x, y);
        const k = `f${x}_${y}`;
        cells.push(`<i class="${BLOCKED.includes(k) ? 'blk' : used.has(k) ? 'use' : ''}" data-c="${k}" style="left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px"></i>`);
      }
    for (let y = 0; y < CONST.wall_rows; y++)
      for (let x = 0; x < CONST.wall_cols; x++) {
        const k = `w${x}_${y}`;
        if (BLOCKED.includes(k)) continue;
        const c = wallCell(g, x, y);
        cells.push(`<i class="wall ${used.has(k) ? 'use' : ''}" data-c="${k}" style="left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px"></i>`);
      }
    grid.innerHTML = cells.join('');
  }
  function paintTray() {
    for (const b of tray.querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    const p = ctx.state().profile;
    if (tab === 'furn') {
      const mine = owned();
      list.innerHTML = mine
        .map((id) => {
          const on = items.some((i) => i.id === id);
          return `<div class="dcard ${on ? 'on' : ''}" data-f="${id}"><div class="dico">${furnArt(id)}</div><small>${esc(FURNITURE_NAME[id] ?? (id === 'box' ? '상자' : id))}</small>${on ? '<em>놓음</em>' : ''}</div>`;
        })
        .join('') + (mine.length < Object.keys(FURNITURE_OF).length ? '<div class="dcard shopcard" data-shop="furniture"><div class="dico">🛒</div><small>가구 사기</small></div>' : '');
      hint.textContent = '가구를 방으로 끌어다 놓아요 · 놓인 가구를 아래로 끌어 오면 치워요';
    } else {
      list.innerHTML = STYLES.filter((x) => x.kind === tab)
        .map((st) => {
          const own = ownsStyle(p, st.id);
          const sel = styles[st.kind] === st.id;
          return `<div class="dcard style ${sel ? 'sel' : ''} ${own ? '' : 'lock'}" data-style="${st.id}">${swatch(st)}<small>${esc(st.name)}</small>${
            own ? (sel ? '<em>고름</em>' : '') : `<em class="price">${armed === st.id ? '한 번 더!' : `<i class="coin-ico"></i>${st.price.toLocaleString('ko-KR')}`}</em>`
          }</div>`;
        })
        .join('');
      hint.textContent = '눌러서 바꿔 봐요 · 없는 것은 두 번 눌러 엽전으로 사요';
    }
  }
  const refresh = () => {
    h.preview(items, styles);
    paintGrid();
    paintTray();
  };
  refresh();
  const ro = new ResizeObserver(() => paintGrid());
  ro.observe(room);

  function close(save: boolean) {
    if (saving) return;
    if (!save) return finish();
    saving = true;
    void ctx.api
      .place({ items, ...styles })
      .then((r) => {
        ctx.apply(r);
        sfx('nyangGift');
        buzz([10, 30, 10]);
        toast('방을 꾸몄어요!');
        finish();
      })
      .catch((e) => {
        toast(errorText(e));
        saving = false;
      });
  }
  function finish() {
    offRoom();
    ro.disconnect();
    grid.remove();
    bar.remove();
    room.classList.remove('deco');
    ctx.tray(null);
    ctx.setBusy(false);
    h.done();
  }
  bar.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-cancel]')) close(false);
    else if (t.closest('[data-save]')) close(true);
  });

  tray.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const tb = t.closest<HTMLElement>('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab as Tab;
      armed = '';
      sfx('toggle');
      return paintTray();
    }
    if (t.closest('[data-shop]')) return ctx.openShop('furniture');
    const sc = t.closest<HTMLElement>('[data-style]');
    if (sc) {
      const st = STYLES.find((x) => x.id === sc.dataset.style)!;
      const p = ctx.state().profile;
      if (!ownsStyle(p, st.id)) {
        if (p.coins < st.price) return toast(`엽전이 모자라요 (${st.price.toLocaleString('ko-KR')}냥) — 꽃을 키워 팔아 보세요`);
        if (armed !== st.id) {
          armed = st.id;
          sfx('click');
          return paintTray();
        }
        armed = '';
        try {
          const it = SHOP_ITEM[`style:${st.id}`];
          ctx.apply(await ctx.api.buy(it.id, 1));
          sfx('nyangCoin');
          toast(`${st.name}을(를) 샀어요`);
        } catch (er) {
          toast(errorText(er));
          return paintTray();
        }
      }
      styles[st.kind] = st.id;
      sfx('toggle');
      return refresh();
    }
    const fc = t.closest<HTMLElement>('.dcard.on[data-f]');
    if (fc) toast('방에 놓여 있어요 — 끌어서 옮기거나 아래 띠로 끌어 와 치워요');
  });

  // ---------- 끌기: 띠의 가구 → 방 · 방의 가구 → 옮기기 / 띠로 치우기 ----------
  function drag(id: string, e: PointerEvent, from: HTMLElement) {
    const f = FURNITURE_OF[id];
    e.preventDefault();
    from.setPointerCapture(e.pointerId);
    const ghost = document.createElement('div');
    ghost.className = 'deco-ghost';
    const g = h.geo();
    const fw = f.kind === 'wall' ? ((g.W / CONST.wall_cols) * f.w * 0.96) : g.W * ART[id].w;
    ghost.style.width = `${fw}px`;
    ghost.style.height = `${fw * furnRatio(id)}px`;
    ghost.innerHTML = furnArt(id);
    document.body.append(ghost);
    const was = items.find((i) => i.id === id);
    const elOld = h.furnish.views.find((v) => v.id === id)?.el;
    elOld?.classList.add('lifting');
    let target: { x: number; y: number } | null = null;
    let toTray = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const free = (x: number, y: number) => {
      const cols = f.kind === 'wall' ? CONST.wall_cols : CONST.grid_cols;
      const rows = f.kind === 'wall' ? CONST.wall_rows : CONST.grid_rows;
      if (x < 0 || y < 0 || x + f.w > cols || y + f.h > rows) return false;
      const k = f.kind === 'wall' ? 'w' : 'f';
      const used = new Set<string>(BLOCKED);
      for (const it of items) {
        if (it.id === id) continue;
        const o = FURNITURE_OF[it.id];
        for (let dx = 0; dx < o.w; dx++) for (let dy = 0; dy < o.h; dy++) used.add(`${o.kind === 'wall' ? 'w' : 'f'}${it.x + dx}_${it.y + dy}`);
      }
      for (let dx = 0; dx < f.w; dx++) for (let dy = 0; dy < f.h; dy++) if (used.has(`${k}${x + dx}_${y + dy}`)) return false;
      return true;
    };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) moved = true;
      const gw = parseFloat(ghost.style.width);
      const gh = parseFloat(ghost.style.height);
      // 손가락이 가구 아래 가운데 (가구가 손가락에 가리지 않게 조금 위로)
      ghost.style.transform = `translate(${ev.clientX - gw / 2}px, ${ev.clientY - gh - 18}px)`;
      const r = room.getBoundingClientRect();
      const gg = h.geo();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top - 18;
      toTray = ev.clientY > r.bottom + 4;
      target = null;
      if (!toTray && px >= 0 && px <= r.width) {
        if (f.kind === 'floor') {
          const fx = (px - gg.floor.left) / gg.floor.width;
          const fy = (py - gg.floor.top) / gg.floor.height;
          if (fy > -0.1 && fy < 1.15) {
            const cx = Math.round(fx * CONST.grid_cols - f.w / 2);
            const cy = Math.min(CONST.grid_rows - f.h, Math.max(0, Math.floor(fy * CONST.grid_rows) - (f.h - 1)));
            target = { x: cx, y: cy };
          }
        } else {
          const cx = Math.round((px / gg.W) * CONST.wall_cols - f.w / 2);
          const cy = Math.floor((py / gg.wallH - 0.06) / 0.42) - (f.h - 1);
          if (py < gg.wallH) target = { x: cx, y: Math.max(0, Math.min(CONST.wall_rows - f.h, cy)) };
        }
      }
      const ok = target != null && free(target.x, target.y);
      ghost.classList.toggle('bad', !toTray && !ok);
      ghost.classList.toggle('away', toTray);
      for (const c of grid.querySelectorAll<HTMLElement>('i')) c.classList.remove('hot', 'no');
      if (target) {
        const k = f.kind === 'wall' ? 'w' : 'f';
        for (let dx = 0; dx < f.w; dx++)
          for (let dy = 0; dy < f.h; dy++) grid.querySelector(`[data-c="${k}${target.x + dx}_${target.y + dy}"]`)?.classList.add(ok ? 'hot' : 'no');
      }
    };
    const up = () => {
      from.removeEventListener('pointermove', move);
      from.removeEventListener('pointerup', up);
      from.removeEventListener('pointercancel', up);
      ghost.remove();
      elOld?.classList.remove('lifting');
      if (!moved) {
        if (id === 'vase' && was) chooseVase(ctx);
        return refresh();
      }
      if (toTray && was) {
        items = items.filter((i) => i.id !== id);
        sfx('nyangDrop');
        buzz(10);
      } else if (target && free(target.x, target.y)) {
        const t = target;
        if (was) Object.assign(was, t);
        else items.push({ id, x: t.x, y: t.y });
        sfx('nyangDrop', { rate: 1.3 });
        buzz(12);
      } else if (!toTray) toast(f.kind === 'wall' ? '벽 가구는 창 왼쪽 벽에 걸어요' : '빈 칸에 놓아요 (밥 자리 · 화장실 자리는 비워 둬요)');
      refresh();
    };
    from.addEventListener('pointermove', move);
    from.addEventListener('pointerup', up);
    from.addEventListener('pointercancel', up);
    move(e);
  }
  list.addEventListener('pointerdown', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.dcard[data-f]');
    if (!c || c.classList.contains('on')) return;
    drag(c.dataset.f!, e, c);
  });
  const onRoom = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.furn');
    if (!el || !room.classList.contains('deco')) return;
    e.stopPropagation();
    drag(el.dataset.furn!, e, el);
  };
  room.addEventListener('pointerdown', onRoom, true);
  offRoom = () => room.removeEventListener('pointerdown', onRoom, true);
}
