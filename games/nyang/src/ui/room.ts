/**
 * 방 화면 (PRD 8장 1 · 2): 위 띠 · 방(벽 · 창 · 문 · 바닥 · 밥그릇 · 물그릇 · 화장실 · 방석 · 탁자 · 상자 · 선물) · 고양이 · 아래 도구 띠.
 * 돌보기: 사료 봉투 끌어다 기울이기 · 물그릇 누르기 · 화장실 누르기(확대 → 삽으로 퍼서 봉투에) · 고양이 문지르기(쓰다듬기) · 고양이 누르기(정보 창).
 * 3단계: 정보 창의 놀아 주기(play.ts) · 빗질 · 츄르(treats.ts), 선물 줍기, 문 앞 마중, 행동 여러 가지(behavior.ts), 바닥을 누르면 따라오기.
 * 4단계: 방을 옆으로 밀면 베란다 정원(veranda.ts), 상점 · 보관함(shop.ts), 사료 고르기(봉투를 누르면), 약 간식, SpriteCook 그림(art.ts — 실패하면 코드 그림).
 * 고양이는 여러 마리를 그릴 수 있게 CatView 로 둔다 (지금 입양은 한 마리 — 둘째부터는 5단계). 돌보기 물건은 첫 고양이 것.
 * 상태는 서버가 준 기록을 서버 시각으로 풀어서(game/rules.ts) 보여 준다. 돌보기는 모두 api 를 거친다.
 */
import {
  BEHAVIOR, BEHAVIORS, CHURU, CHURU_IDS, COLOR, CONST, FOOD, FOODS, FURNITURE_NAME, PERSONALITY, SEED_NAME, SPOT_NAME, TOYS, TOY_IDS, kstDay, kstHour, loveLevel,
  type ChuruId, type FoodId, type ToyId,
} from '../data/balance';
import { WINDOW_GLASS, type WorldArt } from '../data/world.gen';
import { errorText, type CareOut, type NyangApi } from '../net/api';
import { hasToy, itemCount, levelsOf, needs, potStage, spotKind, type Cat, type Levels, type NyangState, type Present } from '../game/rules';
import { artImg, bgLayer, preloadWorld, ratioOf, worldUrl } from './art';
import { follow, think } from './behavior';
import { CatActor, type Act, type Spot2 } from './cat';
import { preloadColor } from './catart';
import { buzz, esc, floatAt, getSound, josa, setVibe, sfx, toast, vibeOn } from './common';
import { clamp, type CatView, type Prop, type PropName, type RoomCtx, type TimeOfDay } from './ctx';
import { playGame } from './play';
import { blanket, boxFront, cup, cushion, foodBag, foodBowl, litterBox, presentIcon, scoop, sideTable, toyIcon, trashBag, waterBowl, waterJug } from './props';
import { openShop } from './shop';
import { brushCat, giveChuru, giveTreat, refuseChuru } from './treats';
import { mountVeranda } from './veranda';

/** 사료 봉투 그림 (상점 사료는 봉투 위에 표시) */
const bagArt = () => artImg('objects-food-bag', foodBag);
/** 밥그릇 · 물그릇 · 화장실 그림 (그림이 없으면 코드 그림) */
const foodArt = (level: number) => artImg(level > 0.02 ? 'objects-bowl-food-full' : 'objects-bowl-food-empty', foodBowl(level));
const waterArt = (level: number, spoiled: boolean) => artImg(level > 0.12 || spoiled ? 'objects-bowl-water-full' : 'objects-bowl-water-empty', waterBowl(level, spoiled));
const POOP_AT = [[30, 30], [56, 24], [43, 42], [68, 38]];
const litterArt = (poops: number) =>
  `<div class="litter-art">${artImg('objects-litter-box', litterBox(poops))}${POOP_AT.slice(0, poops).map(([x, y]) => `<img class="poop" src="${worldUrl('objects-poop')}" alt="" draggable="false" style="left:${x}%;top:${y}%">`).join('')}</div>`;
/** 선물 그림: 엽전은 큰 엽전 그림을 쓰지 않는다 (장식 글자) — 코드 그림의 주머니 */
const presentArt = (kind: string) =>
  kind === 'seed' ? artImg('objects-seed-packet', presentIcon(kind)) : kind === 'toy' ? artImg('objects-yarn', presentIcon(kind)) : presentIcon(kind);
/** 창밖 풍경 (시간대) */
const VIEW: Record<TimeOfDay, WorldArt> = { morning: 'view-morning', day: 'view-day', dusk: 'view-sunset', night: 'view-night' };

/** 들어올 때 요약 카드 · 문 앞 마중 (UI 기준 값) */
const SUMMARY_SEC = 3 * 3600;
const FOOD_KEY = 'siaNyang:food';
const GREET_SEC = 6 * 3600;

export interface RoomOpts {
  api: NyangApi;
  state: NyangState;
  away: number;
  worldHome: string;
  /** 처음 입양하고 바로 들어왔을 때 */
  fresh?: boolean;
}

export function showRoom(root: HTMLElement, o: RoomOpts) {
  const api = o.api;
  let state = o.state;
  const now = () => api.now();
  const catOf = (slot: number): Cat => state.cats.find((c) => c.slot === slot) ?? state.cats[0];
  const lvCache = new Map<number, Levels>();
  const levels = (slot: number) => lvCache.get(slot) ?? levelsOf(catOf(slot), Math.floor(now()));
  let sheet: HTMLElement | null = null;
  let sheetSlot = 1;
  let busy = false;
  let lastPetCall = 0;
  /** 봉투에 담긴 사료 (봉투를 누르면 바뀐다) */
  let food: FoodId = 'basic';

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <a class="back" href="${o.worldHome}">← SIA WORLD</a><span class="spacer"></span>
        <span class="pill" title="엽전"><i class="coin-ico"></i><b id="coins">0</b></span>
        <span class="pill" title="시아코인"><i class="sia-ico">S</i><b id="sia">0</b></span>
        <button class="btn iconbtn" id="setBtn" type="button" aria-label="설정">⚙️</button>
      </header>
      <main class="stage" id="stage">
      <div class="slide" id="slide">
      <div class="room" id="room">
        <div class="wall">
          <div class="wall-art" id="wallArt"></div>
          <div class="window" id="window"><div class="sky"></div><div class="view" id="view"></div><div class="sun"></div><i class="bird"></i><i class="bird b2"></i><div class="panes"></div><img class="frame" id="winFrame" alt="" draggable="false"></div>
          <div class="door" id="door"><i></i></div>
          <div class="baseboard"></div>
        </div>
        <div class="floor"><div class="floor-art" id="floorArt"></div></div>
        <div class="prop" id="pLitter" role="button" aria-label="화장실"><div class="pic">${litterArt(0)}</div><span class="alert">!</span><span class="flies"><i></i><i></i></span></div>
        <div class="prop" id="pCushion" aria-hidden="true"><div class="pic">${artImg('furniture-cushion', cushion)}</div></div>
        <div class="prop" id="pTable" aria-hidden="true"><div class="pic">${artImg('furniture-desk', sideTable)}</div><span class="cup">${cup}</span></div>
        <div class="prop hidden" id="pBox" aria-hidden="true"><div class="pic">${artImg('objects-box', boxFront)}</div></div>
        <div class="prop present hidden" id="pPresent" role="button" aria-label="선물"></div>
        <div class="prop" id="pFood" role="button" aria-label="밥그릇"><div class="pic">${foodArt(1)}</div><span class="alert">!</span></div>
        <div class="prop" id="pWater" role="button" aria-label="물그릇"><div class="pic">${waterArt(1, false)}</div><span class="alert">!</span><span class="flies"><i></i><i></i></span></div>
        <div class="blanket hidden" id="blanket">${blanket}</div>
        <div class="night" id="night"></div>
      </div>
      <div class="veranda" id="veranda"></div>
      </div>
      <div class="stage-ui">
        <button class="btn stagebtn" id="goBtn" type="button">🌱<small>베란다</small></button>
        <button class="btn stagebtn" id="shopBtn" type="button">🛒<small>상점</small></button>
      </div>
      </main>
      <footer class="tray" id="tray">
        <div class="tray-main" id="trayRoom">
          <div class="bagslot"><div class="bag" id="bag" aria-label="사료 봉투">${bagArt()}<b class="bag-tag hidden" id="bagTag"></b></div><small id="bagName">사료</small></div>
          <div class="hint" id="hint"></div>
          <button class="btn catbtn" id="catBtn" type="button"></button>
        </div>
        <div class="tray-main hidden" id="trayVeranda"></div>
        <div class="tray-scene hidden" id="trayScene"></div>
      </footer>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const room = $('#room');
  const props: Record<PropName, Prop> = {
    litter: { el: $('#pLitter'), at: { x: 0.77, y: 0.1 }, w: 0.32, ratio: ratioOf('objects-litter-box') },
    cushion: { el: $('#pCushion'), at: { x: 0.27, y: 0.88 }, w: 0.32, ratio: ratioOf('furniture-cushion') },
    food: { el: $('#pFood'), at: { x: 0.4, y: 0.42 }, w: 0.2, ratio: ratioOf('objects-bowl-food-full') },
    water: { el: $('#pWater'), at: { x: 0.78, y: 0.56 }, w: 0.2, ratio: ratioOf('objects-bowl-water-full') },
    table: { el: $('#pTable'), at: { x: 0.11, y: 0.3 }, w: 0.2, ratio: ratioOf('furniture-desk') },
    box: { el: $('#pBox'), at: { x: 0.74, y: 0.92 }, w: 0.27, ratio: ratioOf('objects-box') },
    present: { el: $('#pPresent'), at: { x: 0.2, y: 0.5 }, w: 0.13, ratio: 50 / 60 },
  };

  // ---------- 고양이들 ----------
  const views: CatView[] = state.cats.map((c, i) => ({
    slot: c.slot,
    actor: new CatActor(room, c.color, c.pattern, { x: 0.5 + i * 0.12, y: 0.7 - i * 0.1 }),
    nextMeow: 0,
    scene: null,
    behavior: null,
  }));
  for (const c of state.cats) void preloadColor(c.color, c.pattern);
  const main = views[0];
  const mainSlot = main.slot;
  const viewOf = (slot: number) => views.find((v) => v.slot === slot) ?? main;

  // ---------- 배치 ----------
  let W = 300;
  let H = 400;
  const floorRect = () => ({ left: W * 0.06, top: H * 0.47, width: W * 0.88, height: H * 0.46 });
  const toScreen = (p: Spot2) => {
    const f = floorRect();
    return { x: f.left + p.x * f.width, y: f.top + p.y * f.height };
  };
  const toFloor = (cx: number, cy: number): Spot2 => {
    const r = room.getBoundingClientRect();
    const f = floorRect();
    return { x: clamp((cx - r.left - f.left) / f.width, 0.03, 0.97), y: clamp((cy - r.top - f.top) / f.height, 0, 1.02) };
  };
  // 방 그림 (벽 · 바닥 · 창 — 못 불러오면 코드 그림 그대로)
  bgLayer($('#wallArt'), 'wall');
  bgLayer($('#floorArt'), 'floor');
  const winFrame = $<HTMLImageElement>('#winFrame');
  winFrame.onload = () => $('#window').classList.add('art');
  winFrame.onerror = () => winFrame.remove();
  winFrame.src = worldUrl('window');
  {
    const v = $('#view');
    const [gx, gy, gw, gh] = WINDOW_GLASS;
    v.style.cssText = `left:${gx * 100}%;top:${gy * 100}%;width:${gw * 100}%;height:${gh * 100}%`;
  }
  let shownView = '';
  function layout() {
    W = room.clientWidth;
    H = room.clientHeight;
    // 창: 벽 높이 안에 들어가게 (그림 비율 그대로)
    const wallH = H * 0.44;
    const winW = Math.min(W * 0.4, (wallH * 0.74) / ratioOf('window'));
    const win = $('#window');
    win.style.width = `${winW}px`;
    win.style.height = `${winW * ratioOf('window')}px`;
    win.style.left = `${W * 0.57 - winW / 2}px`;
    win.style.top = `${wallH * 0.1}px`;
    const f = floorRect();
    for (const v of views) v.actor.floor = { ...f, scale: Math.min(H * 0.27, W * 0.42) / 381 };
    for (const p of Object.values(props)) {
      const s = toScreen(p.at);
      const w = W * p.w * (0.9 + 0.2 * p.at.y);
      p.el.style.width = `${w}px`;
      p.el.style.height = `${w * p.ratio}px`;
      p.el.style.transform = `translate(${s.x - w / 2}px, ${s.y - w * p.ratio}px)`;
      // 상자는 그 안의 고양이보다 앞에
      p.el.style.zIndex = String(Math.round(s.y) + (p === props.box ? 3 : 0));
    }
  }
  new ResizeObserver(layout).observe(room);
  layout();

  // ---------- 화면 공용 (ctx) ----------
  const trayMain = root.querySelector<HTMLElement>('.tray-main')!;
  const trayScene = $('#trayScene');
  const pendingSeen = new Set<string>();
  const timeOfDay = (): TimeOfDay => {
    const h = kstHour(Math.floor(now()));
    return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
  };
  const walkTo = (v: CatView, to: Spot2, then?: Act, fast = false) => {
    v.actor.act = { kind: 'walk', to, speed: fast ? 330 : 150, then };
  };
  const ctx: RoomCtx = {
    api,
    room,
    state: () => state,
    cat: catOf,
    levels,
    level: (slot) => loveLevel(catOf(slot).love).level,
    apply,
    rewards,
    now,
    W: () => W,
    H: () => H,
    toScreen,
    toFloor,
    props,
    views,
    timeOfDay,
    saw(v, id) {
      const c = catOf(v.slot);
      const key = `${v.slot}:${id}`;
      if (!BEHAVIOR[id] || c.seen.includes(id) || pendingSeen.has(key)) return;
      if (loveLevel(c.love).level < BEHAVIOR[id].level) return;
      pendingSeen.add(key);
      void api
        .seen(v.slot, id)
        .then((r) => {
          apply(r);
          if (r.added) {
            sfx('nyangGift', { volume: 0.5 });
            toast(`📖 처음 본 행동: ${BEHAVIOR[id].name}`);
          }
        })
        .catch(() => pendingSeen.delete(key));
    },
    busy: () => busy,
    setBusy: (b) => (busy = b),
    tray(html) {
      trayMain.classList.toggle('hidden', html != null);
      trayScene.classList.toggle('hidden', html == null);
      trayScene.innerHTML = html ?? '';
      return trayScene;
    },
    walkTo,
    layoutProps: layout,
    openShop: (tab) => openShop(ctx, tab),
    giveTreat: (kind) => void giveTreat(ctx, main, kind),
    view: () => view,
  };

  // ---------- 방 ↔ 베란다 (옆으로 밀기 · 단추) ----------
  let view: 'room' | 'veranda' = 'room';
  const stage = $('#stage');
  const veranda = mountVeranda(ctx, $('#veranda'), $('#trayVeranda'));
  function go(to: 'room' | 'veranda') {
    if (to === view || busy) return;
    view = to;
    stage.classList.toggle('at-veranda', to === 'veranda');
    $('#trayRoom').classList.toggle('hidden', to !== 'room');
    $('#trayVeranda').classList.toggle('hidden', to !== 'veranda');
    $('#goBtn').innerHTML = to === 'room' ? '🌱<small>베란다</small>' : '🏠<small>방</small>';
    sfx('click');
    if (to === 'veranda') veranda.enter();
    else veranda.leave();
    paint();
  }
  $('#goBtn').addEventListener('click', () => go(view === 'room' ? 'veranda' : 'room'));
  $('#shopBtn').addEventListener('click', () => openShop(ctx));
  {
    // 옆으로 밀기: 고양이 · 물건을 누른 것이 아니면 (고양이 누르기는 stopPropagation)
    let sx = 0;
    let sy = 0;
    let st = 0;
    let on = false;
    stage.addEventListener('pointerdown', (e) => {
      const tg = e.target as HTMLElement;
      on = !tg.closest('.prop,.pot,.can,.stage-ui,.cat');
      sx = e.clientX;
      sy = e.clientY;
      st = performance.now();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!on) return;
      on = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.6 && performance.now() - st < 800) go(dx < 0 ? 'veranda' : 'room');
    });
  }
  preloadWorld(['veranda', 'plants-pot-empty', 'objects-watering-can']);

  // ---------- 상태 그리기 ----------
  let lastFood = -1;
  let lastWater = '';
  let lastPoops = -1;
  let lastPresent = '';
  function paint() {
    const t = Math.floor(now());
    lvCache.clear();
    for (const c of state.cats) lvCache.set(c.slot, levelsOf(c, t));
    const c = catOf(mainSlot);
    const lv = levels(mainSlot);
    const nd = needs(c, t);
    $('#coins').textContent = state.profile.coins.toLocaleString('ko-KR');
    $('#sia').textContent = state.profile.sia.toLocaleString('ko-KR');
    $('#catBtn').innerHTML = `<span class="heart">♥</span> ${esc(c.name)} <small>Lv${loveLevel(c.love).level}</small>`;
    const fl = Math.ceil((lv.full / CONST.max) * 3) / 3;
    if (fl !== lastFood) {
      lastFood = fl;
      props.food.el.querySelector('.pic')!.innerHTML = foodArt(lv.full / CONST.max);
    }
    const wk = `${Math.ceil((lv.water / CONST.max) * 4)}:${lv.spoiled}`;
    if (wk !== lastWater) {
      lastWater = wk;
      props.water.el.querySelector('.pic')!.innerHTML = waterArt(lv.water / CONST.max, lv.spoiled);
    }
    if (lv.poops !== lastPoops) {
      lastPoops = lv.poops;
      props.litter.el.querySelector('.pic')!.innerHTML = litterArt(lv.poops);
    }
    props.food.el.classList.toggle('need', nd.food);
    props.water.el.classList.toggle('need', nd.water);
    props.litter.el.classList.toggle('need', nd.litter);
    props.litter.el.classList.toggle('dirty', lv.poops >= 3);
    props.water.el.classList.toggle('spoiled', lv.spoiled);
    // 상자: 가지고 있으면 방에 둔다 (혼자 들어가 놀기도 한다)
    props.box.el.classList.toggle('hidden', !hasToy(state.profile, 'box'));
    // 선물: 고양이가 물어다 놓은 것 (마중 중에는 아직)
    const pc = state.cats.find((x) => x.present);
    const pk = pc?.present ? `${pc.slot}:${pc.present.kind}:${pc.present.id}` : '';
    if (pk !== lastPresent) {
      lastPresent = pk;
      props.present.el.innerHTML = pc?.present ? `<div class="pic">${presentArt(pc.present.kind)}</div><span class="sparkle">✦</span>` : '';
      props.present.el.dataset.slot = String(pc?.slot ?? '');
    }
    props.present.el.classList.toggle('hidden', !pk || greeting);
    for (const v of views) v.actor.sick = levels(v.slot).sick;
    $('#blanket').classList.toggle('hidden', !lv.curing);
    const hint = lv.sick && !lv.curing
      ? `${josa(c.name, '이', '가')} 감기 기운이 있어요. 모두 채우고 담요를 덮거나 츄르를 주세요`
      : lv.curing
        ? '담요를 덮고 쉬는 중이에요. 곧 나아요'
        : nd.food
          ? '밥그릇이 비었어요 — 사료 봉투를 끌어다 기울여요'
          : nd.water
            ? lv.spoiled ? '물이 상했어요 — 물그릇을 눌러 갈아 주세요' : '물이 부족해요 — 물그릇을 눌러요'
            : nd.litter
              ? '화장실이 지저분해요 — 화장실을 눌러요'
              : pk
                ? `${josa(catOf(pc!.slot).name, '이', '가')} 선물을 물어 왔어요 — 눌러서 받아요`
                : nd.mood
                  ? `${josa(c.name, '이', '가')} 심심해해요 — 고양이를 눌러 놀아 주세요`
                  : '고양이를 문지르면 쓰다듬어요 · 누르면 놀아 주기';
    const ready = state.pots.filter((p) => potStage(p, t) === 3).length;
    $('#hint').textContent = hint === '고양이를 문지르면 쓰다듬어요 · 누르면 놀아 주기' && ready ? `베란다에 다 자란 꽃이 ${ready}개 있어요 — 방을 옆으로 밀어요` : hint;
    $('#goBtn').classList.toggle('ready', ready > 0 && view === 'room');
    const tod = timeOfDay();
    room.dataset.time = tod;
    if (shownView !== tod) {
      shownView = tod;
      bgLayer($('#view'), VIEW[tod]);
    }
    paintBag();
    veranda.paint();
    if (sheet) paintSheet();
  }

  function apply(r: { state: NyangState }) {
    state = r.state;
    paint();
  }
  function rewards(r: CareOut) {
    if (r.bonus) setTimeout(() => toast(`하루 첫 돌보기 · 엽전 +${r.bonus}`), 300);
    if (r.sia) {
      const s = toScreen({ x: 0.5, y: 0.2 });
      floatAt(room, s.x, s.y, '<i class="sia-ico">S</i> +1', 'float big');
      sfx('coin');
    }
  }

  // ---------- 매 장면 ----------
  let last = performance.now();
  let paintAt = 0;
  let alive = true;
  function frame(t: number) {
    if (!alive) return;
    const dt = Math.min(100, t - last);
    last = t;
    for (const v of views) {
      const a = v.actor;
      if (!v.scene && ((a.act.kind === 'idle' && t >= a.act.until) || (a.act.kind === 'pose' && t >= a.act.until))) think(ctx, v, t);
      a.update(t, dt);
      // 상자 속 고양이: 상자가 늘 앞에
      if (a.sink > 0 && !v.scene) props.box.el.style.zIndex = String((Number(a.el.style.zIndex) || 0) + 5);
    }
    const lv = levels(mainSlot);
    if (lv.curing) {
      // 담요: 고양이 몸 위에
      const sc = main.actor.screen();
      const w = 400 * sc.s;
      const bl = $('#blanket');
      bl.style.width = `${w}px`;
      bl.style.height = `${w * 0.58}px`;
      bl.style.transform = `translate(${sc.x - w / 2}px, ${sc.y - w * 0.5}px)`;
      bl.style.zIndex = String(Math.round(sc.y) + 1);
    }
    if (t > paintAt) {
      paintAt = t + 500;
      paint();
    }
    requestAnimationFrame(frame);
  }
  let greeting = false;
  paint();

  // ---------- 밥 주기: 사료 봉투를 끌어다 밥그릇 위에서 기울인다 ----------
  const bag = $('#bag');
  bag.addEventListener('pointerdown', (e) => {
    if (busy) return;
    e.preventDefault();
    bag.setPointerCapture(e.pointerId);
    const ghost = document.createElement('div');
    ghost.className = 'drag-bag';
    ghost.innerHTML = bagArt();
    document.body.append(ghost);
    bag.classList.add('lifted');
    let pour = 0;
    let lastT = performance.now();
    let over = false;
    let done = false;
    let raf = 0;
    let px = e.clientX;
    let py = e.clientY;
    let moved = false;
    const downAt = performance.now();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const place = () => {
      ghost.style.transform = `translate(${px - 32}px, ${py - 60}px) rotate(${over ? -118 : -8}deg)`;
    };
    place();
    sfx('click');
    const bowlBox = () => props.food.el.getBoundingClientRect();
    const tick = (t: number) => {
      const dt = t - lastT;
      lastT = t;
      if (over && !done) {
        if (levels(mainSlot).full >= CONST.feed_full) {
          done = true;
          toast('밥그릇이 아직 가득해요');
        } else {
          pour += dt;
          if (Math.random() < 0.6) {
            const b = bowlBox();
            const r = room.getBoundingClientRect();
            const k = document.createElement('i');
            k.className = 'kibble';
            k.style.left = `${px - r.left - 26 + Math.random() * 10}px`;
            k.style.top = `${py - r.top - 10}px`;
            k.style.setProperty('--fall', `${Math.max(10, b.top + b.height * 0.35 - py + 10)}px`);
            room.append(k);
            setTimeout(() => k.remove(), 500);
          }
          if (Math.random() < 0.35) sfx('nyangPour', { rate: 0.8 + Math.random() * 0.5 });
          if (Math.random() < 0.12) buzz(8);
          props.food.el.style.setProperty('--fill', String(Math.min(1, pour / 900)));
          if (pour >= 900) {
            done = true;
            void doFeed();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      if (Math.hypot(px - x0, py - y0) > 10) moved = true;
      const b = bowlBox();
      const nowOver = px > b.left - 10 && px < b.right + 50 && py > b.top - 130 && py < b.bottom + 10;
      if (nowOver !== over) {
        over = nowOver;
        props.food.el.classList.toggle('target', over);
        if (over) buzz(12);
      }
      place();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      bag.removeEventListener('pointermove', move);
      bag.removeEventListener('pointerup', up);
      bag.removeEventListener('pointercancel', up);
      props.food.el.classList.remove('target');
      bag.classList.remove('lifted');
      ghost.classList.add('back');
      const r = bag.getBoundingClientRect();
      ghost.style.transform = `translate(${r.left}px, ${r.top}px) rotate(0deg)`;
      setTimeout(() => ghost.remove(), 250);
      if (!done && over && pour > 0) toast('조금 더 기울여 주세요');
      // 끌지 않고 누르기만 했으면: 사료 고르기
      if (!moved && performance.now() - downAt < 400) chooseFood();
    };
    bag.addEventListener('pointermove', move);
    bag.addEventListener('pointerup', up);
    bag.addEventListener('pointercancel', up);
  });
  // ---------- 사료 고르기: 기본 사료(공짜) · 상점 사료(보관함) ----------
  try {
    const f = localStorage.getItem(FOOD_KEY);
    if (f && f in FOOD) food = f as FoodId;
  } catch {
    /* 저장이 막힌 기기 */
  }
  function paintBag() {
    if (food !== 'basic' && itemCount(state.profile, `food:${food}`) < 1) food = 'basic';
    const n = food === 'basic' ? 0 : itemCount(state.profile, `food:${food}`);
    $('#bagName').textContent = food === 'basic' ? '사료' : FOOD[food].name;
    const tag = $('#bagTag');
    tag.classList.toggle('hidden', !n);
    tag.textContent = String(n);
  }
  function chooseFood() {
    const owned = FOODS.filter((f) => f.price === 0 || itemCount(state.profile, `food:${f.id}`) > 0);
    if (owned.length < 2) return toast('사료 봉투를 끌어다 밥그릇 위에서 기울여요 · 다른 사료는 상점에서');
    const i = owned.findIndex((f) => f.id === food);
    food = owned[(i + 1) % owned.length].id;
    try {
      localStorage.setItem(FOOD_KEY, food);
    } catch {
      /* 저장이 막힌 기기 */
    }
    sfx('toggle');
    paintBag();
    toast(`${FOOD[food].name}${food === 'basic' ? ' (공짜)' : ` · ${itemCount(state.profile, `food:${food}`)}번 남음`} — ${FOOD[food].desc}`);
  }
  const bowlSpot = (p: Prop): Spot2 => ({ x: Math.max(0.12, p.at.x - 0.24), y: p.at.y + 0.05 });
  async function doFeed() {
    busy = true;
    buzz([20, 30, 20]);
    try {
      const r = await api.feed(mainSlot, food);
      apply(r);
      rewards(r);
      sfx('nyangMeow', { rate: 1.2 });
      main.actor.say('냠냠!', 1500);
      main.actor.sink = 0;
      walkTo(main, bowlSpot(props.food), { kind: 'pose', pose: 'eat', until: 0, ms: 7000, face: 1 }, true);
      const a = main.actor.act;
      if (a.kind === 'walk') a.arrive = () => ctx.saw(main, 'eat');
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
      props.food.el.style.removeProperty('--fill');
    }
  }

  // ---------- 물 갈기: 물그릇을 누른다 ----------
  props.water.el.addEventListener('click', async () => {
    if (busy) return;
    const lv = levels(mainSlot);
    if (lv.water >= CONST.water_fresh && !lv.spoiled) return toast('물이 아직 깨끗해요');
    busy = true;
    const el = props.water.el;
    el.classList.add('dump');
    sfx('nyangWater', { rate: 0.7 });
    buzz(15);
    const jug = document.createElement('div');
    jug.className = 'jug';
    jug.innerHTML = waterJug;
    const b = el.getBoundingClientRect();
    const rr = room.getBoundingClientRect();
    jug.style.left = `${b.left - rr.left - b.width * 0.55}px`;
    jug.style.top = `${b.top - rr.top - b.width * 0.75}px`;
    jug.style.width = `${b.width * 0.9}px`;
    room.append(jug);
    try {
      const r = await api.water(mainSlot);
      await new Promise((ok) => setTimeout(ok, 450));
      el.classList.remove('dump');
      jug.classList.add('pour');
      sfx('nyangWater');
      buzz([10, 40, 10]);
      await new Promise((ok) => setTimeout(ok, 650));
      apply(r);
      rewards(r);
      main.actor.sink = 0;
      walkTo(main, bowlSpot(props.water), { kind: 'pose', pose: 'drink', until: 0, ms: 4500, face: 1 }, true);
    } catch (e) {
      el.classList.remove('dump');
      toast(errorText(e));
    } finally {
      jug.remove();
      busy = false;
    }
  });

  // ---------- 똥 치우기: 화장실을 누르면 확대 ----------
  props.litter.el.addEventListener('click', () => {
    if (busy) return;
    if (levels(mainSlot).poops === 0) return toast('화장실이 깨끗해요');
    openLitter();
  });
  function openLitter() {
    sfx('click');
    const dim = document.createElement('div');
    dim.className = 'dim';
    const n = levels(mainSlot).poops;
    const SPOTS = [[30, 38], [62, 30], [44, 62], [72, 60]];
    dim.innerHTML = `<div class="litter-zoom panel" role="dialog" aria-label="화장실 치우기">
      <button class="btn iconbtn close" type="button" aria-label="닫기">✕</button>
      <h3>화장실 치우기</h3>
      <div class="sandbox"><div class="sand">${SPOTS.slice(0, n).map(([x, y], i) => `<div class="lump" data-i="${i}" style="left:${x}%;top:${y}%">${artImg('objects-poop', '<i></i>')}</div>`).join('')}</div></div>
      <div class="tools"><div class="trash" aria-label="봉투">${trashBag}</div><p class="lhint">삽으로 덩어리를 떠서 봉투에 넣어요</p><div class="scoop" aria-label="모래 삽">${artImg('objects-scoop', scoop)}</div></div>
    </div>`;
    document.body.append(dim);
    const close = () => {
      dim.remove();
      paint();
    };
    dim.querySelector('.close')!.addEventListener('click', close);
    dim.addEventListener('click', (e) => e.target === dim && close());
    const tool = dim.querySelector<HTMLElement>('.scoop')!;
    const trash = dim.querySelector<HTMLElement>('.trash')!;
    let carry: HTMLElement | null = null;
    let left = n;
    let working = false;
    tool.addEventListener('pointerdown', (e) => {
      if (working) return;
      e.preventDefault();
      tool.setPointerCapture(e.pointerId);
      tool.classList.add('lifted');
      const start = tool.getBoundingClientRect();
      const ox = e.clientX - start.left;
      const oy = e.clientY - start.top;
      const move = (ev: PointerEvent) => {
        tool.style.transform = `translate(${ev.clientX - ox - start.left}px, ${ev.clientY - oy - start.top}px) rotate(-12deg)`;
        const head = { x: ev.clientX - ox + start.width * 0.28, y: ev.clientY - oy + start.height * 0.45 };
        if (!carry) {
          for (const l of dim.querySelectorAll<HTMLElement>('.lump:not(.gone)')) {
            const b = l.getBoundingClientRect();
            if (Math.hypot(head.x - (b.left + b.width / 2), head.y - (b.top + b.height / 2)) < Math.max(34, b.width * 0.8)) {
              carry = l;
              l.classList.add('gone');
              tool.classList.add('full');
              sfx('nyangScoop');
              buzz(18);
              const sb = dim.querySelector<HTMLElement>('.sand')!;
              const sr = sb.getBoundingClientRect();
              for (let k = 0; k < 6; k++) floatAt(sb, b.left - sr.left + b.width / 2 + (Math.random() - 0.5) * 30, b.top - sr.top + b.height / 2, '', 'grain');
              break;
            }
          }
        } else {
          const tb = trash.getBoundingClientRect();
          trash.classList.toggle('open', head.x > tb.left - 20 && head.x < tb.right + 20 && head.y > tb.top - 30 && head.y < tb.bottom);
        }
      };
      const up = async () => {
        tool.removeEventListener('pointermove', move);
        tool.removeEventListener('pointerup', up);
        tool.removeEventListener('pointercancel', up);
        tool.classList.remove('lifted');
        const into = trash.classList.contains('open');
        trash.classList.remove('open');
        tool.style.transform = '';
        if (!carry) return;
        const lump = carry;
        if (!into) {
          lump.classList.remove('gone');
          tool.classList.remove('full');
          carry = null;
          return;
        }
        carry = null;
        tool.classList.remove('full');
        working = true;
        sfx('nyangDrop');
        buzz(25);
        trash.classList.add('gulp');
        setTimeout(() => trash.classList.remove('gulp'), 300);
        try {
          const r = await api.clean(mainSlot);
          apply(r);
          rewards(r);
          left--;
          if (r.gift) {
            const sb = dim.querySelector<HTMLElement>('.sand')!;
            floatAt(sb, lump.offsetLeft, lump.offsetTop, `<i class="coin-ico"></i> 엽전 +${r.gift}`, 'float gift');
            sfx('coin');
            buzz([10, 30, 10]);
          }
          if (left <= 0 || r.poops === 0) {
            dim.querySelector('.lhint')!.textContent = '깨끗해졌어요!';
            setTimeout(close, 900);
          }
        } catch (e) {
          toast(errorText(e));
          if (e instanceof Error && e.message === 'no poop') setTimeout(close, 600);
        } finally {
          working = false;
        }
      };
      tool.addEventListener('pointermove', move);
      tool.addEventListener('pointerup', up);
      tool.addEventListener('pointercancel', up);
    });
  }

  // ---------- 선물 줍기 ----------
  props.present.el.addEventListener('click', async () => {
    if (busy) return;
    const slot = Number(props.present.el.dataset.slot) || mainSlot;
    busy = true;
    sfx('click');
    try {
      const r = await api.gift(slot);
      apply(r);
      showPresent(slot, r.present);
      const v = viewOf(slot);
      ctx.saw(v, 'present');
      v.actor.say('칭찬해 달라옹!', 1600);
      v.actor.act = { kind: 'pose', pose: 'beg', until: performance.now() + 1800 };
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
    }
  });
  function presentText(g: Present): string {
    if (g.kind === 'coin') return `엽전 +${g.n}`;
    if (g.kind === 'seed') return `${SEED_NAME[g.id as keyof typeof SEED_NAME] ?? g.id} 씨앗 ${g.n}개`;
    if (g.kind === 'toy') return `${TOYS[g.id as ToyId]?.name ?? g.id} (장난감)`;
    return `${FURNITURE_NAME[g.id] ?? g.id} (가구)`;
  }
  function showPresent(slot: number, g: Present) {
    sfx('nyangGift');
    buzz([10, 30, 10]);
    const dim = document.createElement('div');
    dim.className = 'dim';
    const extra = g.kind === 'toy' ? '<p class="away">놀아 주기에서 쓸 수 있어요</p>' : g.kind === 'seed' ? '<p class="away">베란다 화분에 심을 수 있어요</p>' : g.kind === 'furniture' ? '<p class="away">꾸미기가 열리면 방에 놓을 수 있어요</p>' : '';
    dim.innerHTML = `<div class="summary panel gift-card" role="dialog" aria-label="선물">
      <div class="gift-ico">${presentArt(g.kind)}</div>
      <h3>${esc(josa(catOf(slot).name, '이', '가'))} 선물을 물어 왔어요!</h3>
      <p class="gift-what">${esc(presentText(g))}</p>${extra}
      <p class="tapto">눌러서 닫기</p></div>`;
    dim.addEventListener('click', () => dim.remove());
    document.body.append(dim);
  }

  // ---------- 쓰다듬기 · 고양이 누르기 ----------
  for (const v of views) bindPet(v);
  function bindPet(v: CatView) {
    const cat = v.actor;
    cat.hit.addEventListener('pointerdown', (e) => {
      if (v.scene) return;
      e.preventDefault();
      e.stopPropagation();
      cat.hit.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const t0 = performance.now();
      let moved = 0;
      let lx = x0;
      let ly = y0;
      let rubMs = 0;
      let hateMs = 0;
      let lastT = t0;
      let heartAt = 0;
      let petting = false;
      let punched = false;
      const before = cat.act;
      const move = (ev: PointerEvent) => {
        const d = Math.hypot(ev.clientX - lx, ev.clientY - ly);
        moved += d;
        lx = ev.clientX;
        ly = ev.clientY;
        const t = performance.now();
        const dt = Math.min(80, t - lastT);
        lastT = t;
        if (moved < 12 || punched) return;
        if (!petting) {
          petting = true;
          cat.act = { kind: 'pet' };
        }
        if (d < 1) return;
        const spot = cat.spotAt(ev.clientX, ev.clientY);
        const kind = spotKind(catOf(v.slot), spot);
        const rr = room.getBoundingClientRect();
        if (kind === 'hate') {
          hateMs += dt;
          cat.act = { kind: 'hold', pose: 'sit' };
          cat.shake = t + 120;
          if (hateMs > 1400) {
            punched = true;
            cat.act = { kind: 'pose', pose: 'pounce', until: t + 900 };
            cat.say('냥!', 1300, t);
            sfx('nyangPunch');
            buzz([30, 40, 30]);
            room.classList.add('bump');
            setTimeout(() => room.classList.remove('bump'), 300);
            floatAt(room, ev.clientX - rr.left, ev.clientY - rr.top, '🐾', 'float paw');
            toast(`${SPOT_NAME[spot]}는 싫어해요!`);
          }
          return;
        }
        hateMs = Math.max(0, hateMs - dt);
        cat.act = { kind: 'pet' };
        rubMs += dt;
        if (t > heartAt) {
          heartAt = t + (kind === 'like' ? 220 : 380);
          floatAt(room, ev.clientX - rr.left + (Math.random() - 0.5) * 30, ev.clientY - rr.top - 20, '♥', kind === 'like' ? 'float heart' : 'float heart small');
          sfx('nyangPurr', { volume: 0.7 });
          if (Math.random() < 0.3) buzz(6);
        }
        if (rubMs > 1200 && now() - lastPetCall >= CONST.pet_gap_sec + 0.5) {
          lastPetCall = now();
          rubMs = 0;
          void api
            .pet(v.slot, spot)
            .then((r) => {
              apply(r);
              rewards(r);
              if (r.love > 0) floatAt(room, ev.clientX - rr.left, ev.clientY - rr.top - 50, `친밀도 +${r.love}`, 'float love');
              if (r.kind === 'like') sfx('nyangHeart');
            })
            .catch(() => {
              /* 너무 잦음 · 통신 — 하트만 보여 준다 */
            });
        }
      };
      const up = () => {
        cat.hit.removeEventListener('pointermove', move);
        cat.hit.removeEventListener('pointerup', up);
        cat.hit.removeEventListener('pointercancel', up);
        if (punched) return;
        if (!petting && moved < 12 && performance.now() - t0 < 500) {
          cat.act = before;
          openSheet(v.slot);
          return;
        }
        if (petting) {
          cat.act = { kind: 'pose', pose: 'blink', until: performance.now() + 1200 };
          if (Math.random() < 0.5) cat.say('골골…', 1300);
        }
      };
      cat.hit.addEventListener('pointermove', move);
      cat.hit.addEventListener('pointerup', up);
      cat.hit.addEventListener('pointercancel', up);
    });
  }
  $('#catBtn').addEventListener('click', () => openSheet(mainSlot));

  // ---------- 바닥을 누르면: 친밀도 4단계부터 따라온다 ----------
  room.addEventListener('pointerdown', (e) => {
    const tgt = e.target as HTMLElement;
    if (busy || view !== 'room' || !(tgt === room || tgt.classList.contains('floor') || tgt.classList.contains('floor-art'))) return;
    const rr = room.getBoundingClientRect();
    if (e.clientY - rr.top < floorRect().top - 10) return;
    const fl = toFloor(e.clientX, e.clientY);
    floatAt(room, e.clientX - rr.left, e.clientY - rr.top, '', 'tapdot');
    follow(ctx, main, fl);
  });

  // ---------- 고양이 정보 창 ----------
  function openSheet(slot: number) {
    if (sheet || busy) return;
    sheetSlot = slot;
    sfx('nyangMeow', { rate: 1.15 });
    sheet = document.createElement('div');
    sheet.className = 'dim sheet-dim';
    sheet.innerHTML = `<div class="sheet panel" role="dialog" aria-label="고양이 정보"><div class="sheet-body"></div></div>`;
    document.body.append(sheet);
    sheet.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === sheet || el.closest('[data-close]')) return closeSheet();
      if (el.closest('[data-back]')) return (sheetMode = 'main'), paintSheet();
      if (el.closest('[data-cure]')) return void doCure((el.closest('[data-cure]') as HTMLElement).dataset.cure ?? 'blanket');
      if (el.closest('[data-shop]')) {
        const tab = (el.closest('[data-shop]') as HTMLElement).dataset.shop as Parameters<typeof openShop>[1];
        closeSheet();
        return openShop(ctx, tab);
      }
      if (el.closest('[data-soon]')) return toast('사진은 다음 업데이트에서 열려요');
      const act = el.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'play') return (sheetMode = 'toys'), paintSheet();
      if (act === 'churu') return chooseChuru();
      if (act === 'brush') return startBrush();
      const toy = el.closest<HTMLElement>('[data-toy]')?.dataset.toy as ToyId | undefined;
      if (toy) return startPlay(toy);
      const fl = el.closest<HTMLElement>('[data-flavor]')?.dataset.flavor as ChuruId | undefined;
      if (fl) return startChuru(fl);
    });
    sheetMode = 'main';
    paintSheet();
  }
  let sheetMode: 'main' | 'toys' | 'churu' = 'main';
  function closeSheet() {
    sheet?.remove();
    sheet = null;
  }
  const today = () => kstDay(Math.floor(now()));
  function paintSheet() {
    if (!sheet) return;
    const c = catOf(sheetSlot);
    const lv = levels(sheetSlot);
    const p = PERSONALITY[c.personality];
    const l = loveLevel(c.love);
    const body = sheet.querySelector('.sheet-body')!;
    const head = `<button class="btn iconbtn close" type="button" data-close aria-label="닫기">✕</button><h3>${esc(c.name)}</h3>`;
    if (sheetMode === 'toys') {
      body.innerHTML = `${head}<p class="likes">어떤 장난감으로 놀아 줄까요? (30초)</p>
        <div class="choices">${TOY_IDS.map((id) => {
          const own = hasToy(state.profile, id);
          const fav = p.toy === id;
          return `<button class="btn choice ${own ? '' : 'locked'}" type="button" ${own ? `data-toy="${id}"` : 'disabled'}>
            <span class="cico">${toyIcon(id)}</span><b>${TOYS[id].name}</b><small>${own ? TOYS[id].desc : '상점에서 살 수 있어요'}</small>${fav ? '<em class="fav">♥ 좋아해요</em>' : ''}</button>`;
        }).join('')}</div>
        ${TOY_IDS.some((id) => !hasToy(state.profile, id)) ? '<button class="btn wide" type="button" data-shop="toy">🛒 상점에서 장난감 보기</button>' : ''}
        <button class="btn wide" type="button" data-back>뒤로</button>`;
      return;
    }
    if (sheetMode === 'churu') {
      const n = c.churuDay === today() ? c.churuN : 0;
      body.innerHTML = `${head}<p class="likes">어떤 맛을 줄까요? 오늘 ${n}/${CONST.churu_day_max}개 먹었어요</p>
        <div class="choices three">${CHURU_IDS.map((id) => {
          const have = itemCount(state.profile, `churu:${id}`);
          const fav = p.churu === id;
          return `<button class="btn choice ${have ? '' : 'locked'}" type="button" ${have ? `data-flavor="${id}"` : 'disabled'}>
            <span class="cico">${artImg(`objects-churu-${id}`, `<span class="churu-chip" style="--c:${CHURU[id].color}"></span>`, 'art churu-ico')}</span><b>${CHURU[id].name}</b><small>${have}개</small>${fav ? '<em class="fav">♥ 제일 좋아</em>' : ''}</button>`;
        }).join('')}</div>
        <button class="btn wide" type="button" data-shop="churu">🛒 츄르 사기 (시아코인 5개)</button>
        <button class="btn wide" type="button" data-back>뒤로</button>`;
      return;
    }
    const bar = (name: string, ico: string, v: number, extra = '') =>
      `<div class="stat"><span>${ico} ${name}</span><div class="track"><i style="width:${Math.round((v / CONST.max) * 100)}%" class="${v < CONST.half ? 'low' : ''}"></i></div><em>${Math.round((v / CONST.max) * 100)}%${extra}</em></div>`;
    const brushed = c.brushDay === today();
    const churuN = c.churuDay === today() ? c.churuN : 0;
    const churuHave = CHURU_IDS.reduce((s, id) => s + itemCount(state.profile, `churu:${id}`), 0);
    const seenN = c.seen.filter((id) => BEHAVIOR[id]).length;
    body.innerHTML = `${head}
      <div class="ai-head"><span class="tag">${COLOR[c.color].name}</span><span class="tag pink">${p.name}</span>${lv.sick ? `<span class="tag blue">${lv.curing ? '쉬는 중' : '감기 기운'}</span>` : ''}</div>
      <div class="love"><span>친밀도 <b>Lv${l.level}</b></span><div class="track"><i style="width:${l.need ? Math.round((l.have / l.need) * 100) : 100}%"></i></div><em>${l.need ? `${Math.floor((l.have / l.need) * 100)}%` : '최고'}</em></div>
      ${bar('배부름', '🍚', lv.full)}
      ${bar('목마름', '💧', lv.water, lv.spoiled ? ' · 상함' : '')}
      ${bar('청결', '🧹', lv.clean, lv.poops ? ` · 똥 ${lv.poops}` : '')}
      ${bar('기분', '😺', lv.mood)}
      <p class="likes">좋아하는 곳: ${p.likes.map((s) => SPOT_NAME[s]).join(' · ')} · 싫어하는 곳: ${p.dislikes.map((s) => SPOT_NAME[s]).join(' · ')}<br/>좋아하는 장난감: ${TOYS[p.toy].name} · 츄르: ${CHURU[p.churu].name} · 본 행동 ${seenN}/${BEHAVIORS.length}</p>
      ${lv.sick && !lv.curing ? `<button class="btn primary wide" data-cure="blanket" type="button">담요 덮어 주기</button>${itemCount(state.profile, 'medicine') ? `<button class="btn wide" data-cure="medicine" type="button">💊 약 간식 주기 (${itemCount(state.profile, 'medicine')}개)</button>` : ''}` : ''}
      <div class="acts">
        <button class="btn" data-act="play" type="button">🎣<small>놀아 주기</small></button>
        <button class="btn ${brushed ? 'done' : ''}" data-act="brush" type="button">🪮<small>${brushed ? '오늘 했어요' : '빗질'}</small></button>
        <button class="btn soon" data-soon type="button">📷<small>사진</small></button>
        <button class="btn ${churuN >= CONST.churu_day_max || !churuHave ? 'done' : ''}" data-act="churu" type="button">🍡<small>츄르 ${churuHave}</small></button>
      </div>`;
  }
  function startPlay(toy: ToyId) {
    const v = viewOf(sheetSlot);
    closeSheet();
    void playGame(ctx, v, toy);
  }
  function chooseChuru() {
    const c = catOf(sheetSlot);
    const n = c.churuDay === today() ? c.churuN : 0;
    if (n >= CONST.churu_day_max) {
      const v = viewOf(sheetSlot);
      closeSheet();
      refuseChuru(v);
      toast('츄르는 하루 2개까지만 먹어요');
      return;
    }
    if (!CHURU_IDS.some((id) => itemCount(state.profile, `churu:${id}`) > 0)) {
      closeSheet();
      toast('츄르가 없어요. 상점에서 시아코인으로 살 수 있어요');
      return openShop(ctx, 'churu');
    }
    sheetMode = 'churu';
    paintSheet();
  }
  function startChuru(flavor: ChuruId) {
    const v = viewOf(sheetSlot);
    closeSheet();
    void giveChuru(ctx, v, flavor);
  }
  function startBrush() {
    const c = catOf(sheetSlot);
    if (c.brushDay === today()) return toast('오늘은 벌써 빗질했어요. 내일 또 해 주세요');
    const v = viewOf(sheetSlot);
    closeSheet();
    void brushCat(ctx, v);
  }
  async function doCure(kind: string) {
    try {
      const r = await api.cure(sheetSlot, kind);
      apply(r);
      sfx('tankHeal');
      buzz(20);
      toast(kind === 'medicine' ? '약 간식을 먹었어요. 2시간 뒤면 나아요' : '담요를 덮어 주었어요. 2시간 뒤면 나아요');
      viewOf(sheetSlot).actor.act = { kind: 'pose', pose: 'sleep', until: performance.now() + 15000 };
    } catch (e) {
      toast(errorText(e));
    }
  }

  // ---------- 설정 (배경음 · 효과음 · 진동) ----------
  $('#setBtn').addEventListener('click', () => openSettings());
  function openSettings() {
    const snd = getSound();
    sfx('click');
    const dim = document.createElement('div');
    dim.className = 'dim';
    const seg = (k: string, on: boolean) =>
      `<div class="seg" data-k="${k}"><button type="button" data-v="1" class="${on ? 'sel' : ''}">켜기</button><button type="button" data-v="0" class="${on ? '' : 'sel'}">끄기</button></div>`;
    const paintSet = () => {
      dim.innerHTML = `<div class="settings panel" role="dialog" aria-label="설정"><h3>⚙️ 설정</h3>
        <div class="row"><span>🎵 배경음</span>${seg('bgm', snd?.isBgmOn() ?? true)}</div>
        <div class="row"><span>🔊 효과음</span>${seg('sfx', !(snd?.isMuted() ?? false))}</div>
        <div class="row"><span>📳 진동</span>${seg('vibe', vibeOn())}</div>
        <button class="btn wide" type="button" data-close>닫기</button></div>`;
    };
    paintSet();
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === dim || el.closest('[data-close]')) return dim.remove();
      const b = el.closest<HTMLElement>('.seg button');
      if (!b) return;
      const on = b.dataset.v === '1';
      const k = b.parentElement!.dataset.k;
      if (k === 'bgm') snd?.setBgmOn(on);
      else if (k === 'sfx') snd?.setMuted(!on);
      else {
        setVibe(on);
        if (on) buzz(30);
      }
      sfx('toggle');
      paintSet();
    });
    document.body.append(dim);
  }

  // ---------- 서버와 맞추기 ----------
  const refresh = async () => {
    try {
      apply(await api.state(false));
    } catch {
      /* 다음에 */
    }
  };
  const timer = setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  // ---------- 들어올 때 ----------
  const c0 = catOf(mainSlot);
  const lv0 = levels(mainSlot);
  if (o.fresh) {
    main.actor.say('냐앙!', 2000);
    toast(`${josa(c0.name, '이', '가')} 집에 왔어요!`);
    main.actor.act = { kind: 'pose', pose: 'beg', until: performance.now() + 2500 };
    if (itemCount(state.profile, `churu:${PERSONALITY[c0.personality].churu}`) > 0)
      setTimeout(() => toast(`입양 선물로 ${CHURU[PERSONALITY[c0.personality].churu].name} 츄르 ${CONST.start_churu}개를 받았어요`, 2600), 2400);
  } else if (o.away >= GREET_SEC && !lv0.sick) {
    void greet();
  }
  /** 오랜만이면 문이 열리고 고양이가 문 앞까지 달려와 맞이한다 (선물이 있으면 물어 와서 내려놓는다) */
  async function greet() {
    const v = main;
    const a = v.actor;
    greeting = true;
    v.scene = 'greet';
    a.pos = { x: 0.55, y: 0.85 };
    a.act = { kind: 'pose', pose: 'sleep', until: Infinity };
    const door = $('#door');
    await new Promise((r) => setTimeout(r, 500));
    door.classList.add('open');
    sfx('click');
    await new Promise((r) => setTimeout(r, 450));
    a.act = { kind: 'hold', pose: 'sit' };
    a.say('!', 600);
    sfx('nyangMeow', { rate: 1.3 });
    await new Promise((r) => setTimeout(r, 500));
    a.perky = true;
    walkTo(v, { x: 0.14, y: 0.05 }, { kind: 'hold', pose: 'beg' }, true);
    while ((a.act as Act).kind === 'walk') await new Promise((r) => setTimeout(r, 50));
    a.perky = false;
    a.facing = -1;
    a.setFx('sparkle');
    a.say('냐앙~! 왔다옹!', 2200);
    sfx('nyangMeow');
    ctx.saw(v, 'greet');
    const m = a.mouthPoint();
    for (let i = 0; i < 5; i++) setTimeout(() => floatAt(room, m.x + (Math.random() - 0.5) * 60, m.y - 30 - Math.random() * 30, '♥', 'float heart'), i * 180);
    buzz([10, 30, 10]);
    await new Promise((r) => setTimeout(r, 2300));
    a.setFx('none');
    door.classList.remove('open');
    greeting = false;
    if (state.cats.some((c) => c.present)) {
      // 물어 온 선물을 내려놓는다
      a.say('선물이다옹!', 1600);
      walkTo(v, { x: props.present.at.x + 0.12, y: props.present.at.y + 0.02 }, { kind: 'pose', pose: 'sit', until: 0, ms: 3000, face: -1 });
    } else a.act = { kind: 'pose', pose: 'sit', until: performance.now() + 1500 };
    paint();
    v.scene = null;
  }
  if (o.away >= SUMMARY_SEC || lv0.sick) showSummary(o.away);
  function showSummary(away: number) {
    const c = catOf(mainSlot);
    const lv = levels(mainSlot);
    const lines: string[] = [];
    if (lv.sick) lines.push(lv.curing ? '담요를 덮고 쉬는 중이에요' : '감기 기운이 있어요 (에취!)');
    if (lv.full < CONST.half) lines.push(lv.full === 0 ? '밥그릇이 텅 비었어요' : '밥이 얼마 안 남았어요');
    if (lv.spoiled) lines.push('물이 상했어요');
    else if (lv.water < CONST.half) lines.push('물이 거의 없어요');
    if (lv.poops) lines.push(`화장실에 똥 ${lv.poops}개`);
    if (lv.mood < CONST.half) lines.push('심심해하고 있어요');
    if (state.cats.some((x) => x.present)) lines.push('선물을 물어 왔어요!');
    const t = Math.floor(now());
    const ready = new Map<string, number>();
    for (const p of state.pots) if (potStage(p, t) === 3) ready.set(p.plant, (ready.get(p.plant) ?? 0) + 1);
    for (const [id, n] of ready) lines.push(`${SEED_NAME[id as keyof typeof SEED_NAME]} ${n}개 수확할 수 있어요`);
    if (!lines.length) lines.push('모두 괜찮아요. 쓰다듬어 줄까요?');
    const h = Math.floor(away / 3600);
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="summary panel" role="dialog" aria-label="요약">
      <h3>${esc(josa(c.name, '이', '가'))} 집사를 기다렸어요</h3>
      ${away > 0 ? `<p class="away">${h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : `${h}시간`} 만이에요</p>` : ''}
      <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="tapto">눌러서 닫기</p></div>`;
    dim.addEventListener('click', () => dim.remove());
    // 마중을 먼저 보고 나서 카드
    setTimeout(() => document.body.append(dim), greeting ? 4200 : 0);
  }

  // 배경음: 밤에는 편안한 곡 (파일이 없으면 소리 없이)
  const bgm = () => getSound()?.playBgm('nyang', room.dataset.time === 'night' ? 'boss' : 'main');
  bgm();
  const bgmTimer = setInterval(() => {
    const was = room.dataset.time;
    paint();
    if (room.dataset.time !== was) bgm();
  }, 60_000);

  requestAnimationFrame(frame);
  return () => {
    alive = false;
    clearInterval(timer);
    clearInterval(bgmTimer);
  };
}
