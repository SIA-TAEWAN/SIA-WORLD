/**
 * 방 화면 (PRD 8장 1 · 2): 위 띠 · 방(벽 · 창 · 문 · 바닥 · 밥그릇 · 물그릇 · 화장실 · 방석 · 탁자 · 상자 · 선물) · 고양이 · 아래 도구 띠.
 * 돌보기: 사료 봉투 끌어다 기울이기 · 물그릇 누르기 · 화장실 누르기(확대 → 삽으로 퍼서 봉투에) · 고양이 문지르기(쓰다듬기) · 고양이 누르기(정보 창).
 * 3단계: 정보 창의 놀아 주기(play.ts) · 빗질 · 츄르(treats.ts), 선물 줍기, 문 앞 마중, 행동 여러 가지(behavior.ts), 바닥을 누르면 따라오기.
 * 4단계: 방을 옆으로 밀면 베란다 정원(veranda.ts), 상점 · 보관함(shop.ts), 사료 고르기(봉투를 누르면), 약 간식, SpriteCook 그림(art.ts — 실패하면 코드 그림).
 * 5단계: 꾸미기(deco.ts — 가구 배치 · 벽지 · 바닥 · 창문), 가구를 쓰는 고양이(behavior.ts), 추가 입양(첫 고양이 친밀도 4 · 7 · 10),
 *   여러 마리: 밥그릇 · 물그릇은 고양이마다 '밥 자리'에 나란히(그릇 아래 털 색 점), 화장실은 하나에 모두의 똥을 합쳐 보이고 덩어리마다 주인이 있다.
 *   사진(album.ts — 아래 띠 📷 · 정보 창) · 앨범 · 행동 도감(위 띠 📖).
 * 상태는 서버가 준 기록을 서버 시각으로 풀어서(game/rules.ts) 보여 준다. 돌보기는 모두 api 를 거친다.
 */
import {
  BEHAVIOR, BEHAVIORS, CHURU, CHURU_IDS, COLOR, CONST, FOOD, FOODS, FURNITURE_NAME, PERSONALITY, SEED_NAME, SPOT_NAME, TOYS, TOY_IDS, kstDay, kstHour, loveLevel,
  type ChuruId, type FoodId, type ToyId,
} from '../data/balance';
import { WINDOW_GLASS, type WorldArt } from '../data/world.gen';
import { errorText, type CareOut, type NyangApi } from '../net/api';
import { catRoom, hasToy, itemCount, layoutItems, layoutStyle, levelsOf, needs, potStage, spotKind, type Cat, type Levels, type NyangState, type Present } from '../game/rules';
import { flash, openAlbum } from './album';
import { Furnishing, applyStyles, chooseVase, openDeco } from './deco';
import { artImg, bgLayer, preloadWorld, ratioOf, worldUrl } from './art';
import { devAct, follow, think } from './behavior';
import { CatActor, type Act, type Spot2 } from './cat';
import { preloadColor, roomArtScale, setArtScale } from './catart';
import { buzz, esc, floatAt, getSound, josa, setVibe, sfx, toast, vibeOn } from './common';
import { clamp, type CatView, type FurnView, type Prop, type PropName, type RoomCtx, type TimeOfDay } from './ctx';
import { playGame } from './play';
import { blanket, foodBag, foodBowl, litterBox, presentIcon, scoop, toyIcon, trashBag, waterBowl, waterJug } from './props';
import { openShop } from './shop';
import { brushCat, giveChuru, giveTreat, refuseChuru } from './treats';
import { mountVeranda } from './veranda';

/** 사료 봉투 그림 (상점 사료는 봉투 위에 표시) */
const bagArt = () => artImg('objects-food-bag', foodBag);
/** 밥그릇 · 물그릇 · 화장실 그림 (그림이 없으면 코드 그림) */
const foodArt = (level: number) => artImg(level > 0.02 ? 'objects-bowl-food-full' : 'objects-bowl-food-empty', foodBowl(level));
const waterArt = (level: number, spoiled: boolean) => artImg(level > 0.12 || spoiled ? 'objects-bowl-water-full' : 'objects-bowl-water-empty', waterBowl(level, spoiled));
const POOP_AT = [[30, 30], [56, 24], [43, 42], [68, 38]];
/** 화장실: 똥은 4개까지 그리고, 더 많으면 ×n 표 (여러 마리일 때 모두의 합) */
const litterArt = (poops: number) =>
  `<div class="litter-art">${artImg('objects-litter-box', litterBox(Math.min(4, poops)))}${POOP_AT.slice(0, Math.min(4, poops)).map(([x, y]) => `<img class="poop" src="${worldUrl('objects-poop')}" alt="" draggable="false" style="left:${x}%;top:${y}%">`).join('')}${poops > 4 ? `<b class="poop-n">×${poops}</b>` : ''}</div>`;
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
  /** 입양하고 바로 들어왔을 때: 새 고양이 자리 */
  fresh?: number;
  /** 5단계: 고양이를 더 입양하러 (방을 닫고 보호소로) */
  adoptMore?: (state: NyangState) => void;
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
        <button class="btn iconbtn" id="albumBtn" type="button" aria-label="앨범 · 도감">📖</button>
        <button class="btn iconbtn" id="setBtn" type="button" aria-label="설정">⚙️</button>
      </header>
      <main class="stage" id="stage">
      <div class="slide" id="slide">
      <div class="room" id="room">
        <div class="wall">
          <div class="wall-art" id="wallArt"></div>
          <div class="window" id="window"><div class="sky"></div><div class="view" id="view"></div><div class="sun"></div><i class="bird"></i><i class="bird b2"></i><div class="panes"></div><img class="frame" id="winFrame" alt="" draggable="false"><i class="curtain l"></i><i class="curtain r"></i><i class="rod"></i></div>
          <div class="door" id="door"><i></i></div>
          <div class="baseboard"></div>
        </div>
        <div class="floor"><div class="floor-art" id="floorArt"></div></div>
        <div class="prop" id="pLitter" role="button" aria-label="화장실"><div class="pic">${litterArt(0)}</div><span class="alert">!</span><span class="flies"><i></i><i></i></span></div>
        <div class="prop present hidden" id="pPresent" role="button" aria-label="선물"></div>
        <div class="night" id="night"></div>
      </div>
      <div class="veranda" id="veranda"></div>
      </div>
      <div class="stage-ui">
        <button class="btn stagebtn" id="goBtn" type="button">🌱<small>베란다</small></button>
        <button class="btn stagebtn" id="shopBtn" type="button">🛒<small>상점</small></button>
        <button class="btn stagebtn" id="decoBtn" type="button">🛋️<small>꾸미기</small></button>
        <button class="btn stagebtn adoptbtn hidden" id="adoptBtn" type="button">🐱<small>입양</small></button>
      </div>
      </main>
      <footer class="tray" id="tray">
        <div class="tray-main" id="trayRoom">
          <div class="bagslot"><div class="bag" id="bag" aria-label="사료 봉투">${bagArt()}<b class="bag-tag hidden" id="bagTag"></b></div><small id="bagName">사료</small></div>
          <div class="hint" id="hint"></div>
          <button class="btn iconbtn cambtn" id="camBtn" type="button" aria-label="사진 찍기">📷</button>
          <button class="btn catbtn" id="catBtn" type="button"></button>
        </div>
        <div class="tray-main hidden" id="trayVeranda"></div>
        <div class="tray-scene hidden" id="trayScene"></div>
      </footer>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const room = $('#room');
  // 화장실은 가운데 뒤 (격자 4 · 5 열, 0 줄 — 꾸미기에서 막힌 칸) · 선물은 빈 칸에
  const props: Record<PropName, Prop> = {
    litter: { el: $('#pLitter'), at: { x: 0.625, y: 0.17 }, w: 0.27, ratio: ratioOf('objects-litter-box') },
    present: { el: $('#pPresent'), at: { x: 0.45, y: 0.5 }, w: 0.13, ratio: 50 / 60 },
  };
  // ---------- 밥 자리: 고양이마다 밥그릇(뒤) · 물그릇(앞)을 나란히 (격자 0 ~ 2 열, 2 ~ 3 줄) ----------
  const bowls = new Map<number, { food: Prop; water: Prop; foodKey: number; waterKey: string }>();
  const BOWL_AREA = { x0: 0, x1: 3 / 8, food: 0.58, water: 0.79 };
  for (const c of state.cats) {
    const n = state.cats.length;
    const i = state.cats.indexOf(c);
    const x = BOWL_AREA.x0 + ((i + 0.5) * (BOWL_AREA.x1 - BOWL_AREA.x0)) / n;
    const w = Math.min(0.2, 0.42 / n);
    const dot = `<i class="bowl-dot" style="--dot:rgb(${COLOR[c.color].rgb.join(',')})"></i>`;
    const fEl = document.createElement('div');
    fEl.className = 'prop bowl';
    fEl.setAttribute('role', 'button');
    fEl.setAttribute('aria-label', `${c.name} 밥그릇`);
    fEl.dataset.slot = String(c.slot);
    fEl.innerHTML = `<div class="pic">${foodArt(1)}</div>${n > 1 ? dot : ''}<span class="alert">!</span>`;
    const wEl = document.createElement('div');
    wEl.className = 'prop bowl water';
    wEl.setAttribute('role', 'button');
    wEl.setAttribute('aria-label', `${c.name} 물그릇`);
    wEl.dataset.slot = String(c.slot);
    wEl.innerHTML = `<div class="pic">${waterArt(1, false)}</div>${n > 1 ? dot : ''}<span class="alert">!</span><span class="flies"><i></i><i></i></span>`;
    room.append(fEl, wEl);
    bowls.set(c.slot, {
      food: { el: fEl, at: { x, y: BOWL_AREA.food }, w, ratio: ratioOf('objects-bowl-food-full') },
      water: { el: wEl, at: { x, y: BOWL_AREA.water }, w, ratio: ratioOf('objects-bowl-water-full') },
      foodKey: -1,
      waterKey: '',
    });
  }
  const bowlOf = (slot: number) => bowls.get(slot) ?? bowls.values().next().value!;
  const furnish = new Furnishing(room);
  let decoOn = false;
  const furnOf = (id: string): FurnView | undefined => furnish.views.find((v) => v.id === id);

  // ---------- 고양이들 ----------
  const START = [{ x: 0.55, y: 0.7 }, { x: 0.72, y: 0.55 }, { x: 0.4, y: 0.9 }, { x: 0.85, y: 0.85 }];
  const views: CatView[] = state.cats.map((c, i) => ({
    slot: c.slot,
    actor: new CatActor(room, c.color, c.pattern, START[i % START.length]),
    nextMeow: 0,
    scene: null,
    behavior: null,
    mate: null,
  }));
  /** 감기 담요는 고양이마다 */
  const blankets = new Map<number, HTMLElement>();
  for (const v of views) {
    const b = document.createElement('div');
    b.className = 'blanket hidden';
    b.innerHTML = blanket;
    room.append(b);
    blankets.set(v.slot, b);
  }
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
  let artScaleWas = 0;
  const geo = () => ({ W, H, toScreen, floor: floorRect(), wallH: H * 0.44 });
  function placeProp(p: Prop) {
    const s = toScreen(p.at);
    const w = W * p.w * (0.9 + 0.2 * p.at.y);
    p.el.style.width = `${w}px`;
    p.el.style.height = `${w * p.ratio}px`;
    p.el.style.transform = `translate(${s.x - w / 2}px, ${s.y - w * p.ratio}px)`;
    p.el.style.zIndex = String(Math.round(s.y));
  }
  function layout() {
    if (!room.isConnected) return;
    W = room.clientWidth;
    H = room.clientHeight;
    // 창: 벽 가운데, 벽 높이 안에 들어가게 (그림 비율 그대로). 문은 오른쪽 (왼쪽 벽은 벽 가구 자리)
    const wallH = H * 0.44;
    const winW = Math.min(W * 0.4, (wallH * 0.74) / ratioOf('window'));
    const win = $('#window');
    win.style.width = `${winW}px`;
    win.style.height = `${winW * ratioOf('window')}px`;
    win.style.left = `${W * 0.5 - winW / 2}px`;
    win.style.top = `${wallH * 0.1}px`;
    const f = floorRect();
    const sc = Math.min(H * 0.27, W * 0.42) / 381;
    for (const v of views) v.actor.floor = { ...f, scale: sc };
    // 고양이 그림은 화면에 보이는 크기만큼만 (앞쪽은 1.08배 · 기기 픽셀 배율 · 여유 1.2)
    const k = sc * 1.08 * (window.devicePixelRatio || 1) * 1.2;
    if (Math.abs(k - artScaleWas) > 0.05) {
      artScaleWas = k;
      setArtScale(k);
      for (const c of state.cats) void preloadColor(c.color, c.pattern, roomArtScale());
    }
    for (const p of Object.values(props)) placeProp(p);
    for (const b of bowls.values()) {
      placeProp(b.food);
      placeProp(b.water);
    }
    furnish.layout(geo());
    // 상자 속 고양이보다 상자가 앞에
    const box = furnOf('box');
    if (box) box.el.style.zIndex = String(Number(box.el.style.zIndex) + 3);
  }
  const ro = new ResizeObserver(layout);
  ro.observe(room);
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
    bowl: (slot) => bowlOf(slot),
    furn: furnOf,
    furnUse: (use) => furnish.views.filter((v) => v.f.use === use),
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
    giveTreat: (kind) => void giveTreat(ctx, viewOf(sheetSlot), kind),
    view: () => view,
    photo: (v) => void takePhoto(v),
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
    $('#decoBtn').classList.toggle('hidden', to !== 'room');
    room.classList.remove('camera');
    sfx('click');
    if (to === 'veranda') veranda.enter();
    else veranda.leave();
    paint();
  }
  $('#goBtn').addEventListener('click', () => go(view === 'room' ? 'veranda' : 'room'));
  $('#shopBtn').addEventListener('click', () => openShop(ctx));
  $('#albumBtn').addEventListener('click', () => openAlbum(ctx));
  $('#decoBtn').addEventListener('click', () => startDeco());
  $('#adoptBtn').addEventListener('click', () => {
    if (busy || !o.adoptMore) return;
    sfx('nyangMeow', { rate: 1.3 });
    dispose();
    o.adoptMore(state);
  });
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
  let lastPoops = -1;
  let lastPresent = '';
  /** 방 배치 · 무늬를 state 대로 (꾸미기 중에는 꾸미기가 미리 보기를 그린다) */
  function paintLayout() {
    if (decoOn) return;
    const pr = state.profile;
    applyStyles(room, { wall: layoutStyle(pr, 'wall'), floor: layoutStyle(pr, 'floor'), window: layoutStyle(pr, 'window') });
    // 배치가 바뀔 때만 다시 자리를 잡는다 (매 0.5초 paint 에서 레이아웃을 건드리지 않게)
    if (!furnish.sync(layoutItems(pr), pr.layout.vase)) return;
    layout();
    // 선물은 빈 칸에 (가구와 겹치지 않게)
    const occ = new Set<string>();
    for (const it of layoutItems(pr)) occ.add(`${it.x}_${it.y}`), occ.add(`${it.x + 1}_${it.y}`);
    const spot = [[3, 2], [4, 3], [3, 3], [5, 2], [6, 3], [4, 4]].find(([x, y]) => !occ.has(`${x}_${y}`)) ?? [3, 2];
    props.present.at = { x: (spot[0] + 0.5) / 8, y: (spot[1] + 0.9) / 5 };
    placeProp(props.present);
  }
  function paint() {
    const t = Math.floor(now());
    lvCache.clear();
    for (const c of state.cats) lvCache.set(c.slot, levelsOf(c, t));
    paintLayout();
    const c = catOf(mainSlot);
    const lv = levels(mainSlot);
    const nd = needs(c, t);
    $('#coins').textContent = state.profile.coins.toLocaleString('ko-KR');
    $('#sia').textContent = state.profile.sia.toLocaleString('ko-KR');
    $('#catBtn').innerHTML = views.length > 1
      ? `<span class="heart">♥</span> 고양이 <small>${views.length}마리</small>`
      : `<span class="heart">♥</span> ${esc(c.name)} <small>Lv${loveLevel(c.love).level}</small>`;
    // 그릇: 고양이마다
    const nds = new Map(state.cats.map((x) => [x.slot, needs(x, t)]));
    for (const x of state.cats) {
      const b = bowls.get(x.slot);
      if (!b) continue;
      const l = levels(x.slot);
      const n = nds.get(x.slot)!;
      const fl = Math.ceil((l.full / CONST.max) * 3);
      if (fl !== b.foodKey) {
        b.foodKey = fl;
        b.food.el.querySelector('.pic')!.innerHTML = foodArt(l.full / CONST.max);
      }
      const wk = `${Math.ceil((l.water / CONST.max) * 4)}:${l.spoiled}`;
      if (wk !== b.waterKey) {
        b.waterKey = wk;
        b.water.el.querySelector('.pic')!.innerHTML = waterArt(l.water / CONST.max, l.spoiled);
      }
      b.food.el.classList.toggle('need', n.food);
      b.water.el.classList.toggle('need', n.water);
      b.water.el.classList.toggle('spoiled', l.spoiled);
    }
    // 화장실: 하나에 모두의 똥
    const poops = state.cats.reduce((a, x) => a + levels(x.slot).poops, 0);
    if (poops !== lastPoops) {
      lastPoops = poops;
      props.litter.el.querySelector('.pic')!.innerHTML = litterArt(poops);
    }
    const litterNeed = [...nds.values()].some((n) => n.litter);
    props.litter.el.classList.toggle('need', litterNeed);
    props.litter.el.classList.toggle('dirty', state.cats.some((x) => levels(x.slot).poops >= 3));
    // 입양: 첫 고양이 친밀도 4 · 7 · 10 단계
    $('#adoptBtn').classList.toggle('hidden', !(o.adoptMore && view === 'room' && state.cats.length < Math.min(4, catRoom(state))));
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
    for (const [slot, b] of blankets) b.classList.toggle('hidden', !levels(slot).curing);
    // 할 일 안내: 아픈 고양이 → 밥 → 물 → 화장실 → 선물 → 심심함 (여러 마리면 그 고양이 이름으로)
    const who = (k: 'food' | 'water' | 'mood') => state.cats.find((x) => nds.get(x.slot)![k]);
    const sickC = state.cats.find((x) => levels(x.slot).sick && !levels(x.slot).curing);
    const curingC = state.cats.find((x) => levels(x.slot).curing);
    const many = state.cats.length > 1;
    const fC = who('food');
    const wC = who('water');
    const mC = who('mood');
    const hint = sickC
      ? `${josa(sickC.name, '이', '가')} 감기 기운이 있어요. 모두 채우고 담요를 덮거나 츄르를 주세요`
      : curingC
        ? `${josa(curingC.name, '이', '가')} 담요를 덮고 쉬는 중이에요. 곧 나아요`
        : fC
          ? `${many ? `${fC.name} ` : ''}밥그릇이 비었어요 — 사료 봉투를 끌어다 기울여요`
          : wC
            ? levels(wC.slot).spoiled ? `${many ? `${wC.name} ` : ''}물이 상했어요 — 물그릇을 눌러 갈아 주세요` : `${many ? `${wC.name} ` : ''}물이 부족해요 — 물그릇을 눌러요`
            : litterNeed
              ? '화장실이 지저분해요 — 화장실을 눌러요'
              : pk
                ? `${josa(catOf(pc!.slot).name, '이', '가')} 선물을 물어 왔어요 — 눌러서 받아요`
                : mC
                  ? `${josa(mC.name, '이', '가')} 심심해해요 — 고양이를 눌러 놀아 주세요`
                  : '고양이를 문지르면 쓰다듬어요 · 누르면 놀아 주기';
    void nd;
    void lv;
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
      const box = a.sink > 0 && !v.scene ? furnOf('box') : undefined;
      if (box) box.el.style.zIndex = String((Number(a.el.style.zIndex) || 0) + 5);
    }
    for (const v of views) {
      if (!levels(v.slot).curing) continue;
      // 담요: 고양이 몸 위에
      const sc = v.actor.screen();
      const w = 400 * sc.s;
      const bl = blankets.get(v.slot)!;
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
    /** 지금 봉투 아래의 밥그릇 (여러 마리면 가장 가까운 것) */
    let tgt = bowlOf(mainSlot);
    let tgtSlot = mainSlot;
    const bowlBox = () => tgt.food.el.getBoundingClientRect();
    const tick = (t: number) => {
      const dt = t - lastT;
      lastT = t;
      if (over && !done) {
        if (levels(tgtSlot).full >= CONST.feed_full) {
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
          tgt.food.el.style.setProperty('--fill', String(Math.min(1, pour / 900)));
          if (pour >= 900) {
            done = true;
            void doFeed(tgtSlot);
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
      // 봉투 주둥이(손가락 왼쪽 아래)에서 가장 가까운 밥그릇
      if (!over || !done) {
        let best = Infinity;
        for (const [slot, bw] of bowls) {
          const r = bw.food.el.getBoundingClientRect();
          const d = Math.hypot(px - 26 - (r.left + r.width / 2), py - (r.top - 40));
          if (d < best) {
            best = d;
            if (bw !== tgt && pour === 0) {
              tgt.food.el.classList.remove('target');
              tgt = bw;
              tgtSlot = slot;
              over = false;
            }
          }
        }
      }
      const b = bowlBox();
      const nowOver = px > b.left - 10 && px < b.right + 50 && py > b.top - 130 && py < b.bottom + 10;
      if (nowOver !== over) {
        over = nowOver;
        tgt.food.el.classList.toggle('target', over);
        if (over) buzz(12);
      }
      place();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      bag.removeEventListener('pointermove', move);
      bag.removeEventListener('pointerup', up);
      bag.removeEventListener('pointercancel', up);
      tgt.food.el.classList.remove('target');
      tgt.food.el.style.removeProperty('--fill');
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
  /** 그릇 앞 (그릇 오른쪽에서 왼쪽을 보고 — 밥 자리는 방 왼쪽이라 고양이가 방 쪽에 선다) */
  const bowlSpot = (p: Prop): Spot2 => ({ x: p.at.x + 0.13, y: p.at.y + 0.03 });
  /** 연출 중이던 고양이를 놓아준다 (그루밍 · 숨기 등) */
  const freeCat = (v: CatView) => {
    v.actor.sink = 0;
    v.actor.lift = 0;
    v.actor.vanish = false;
    v.actor.forcePose = null;
    if (v.scene === 'social' || v.scene === 'furn') v.scene = null;
  };
  async function doFeed(slot: number) {
    busy = true;
    buzz([20, 30, 20]);
    const v = viewOf(slot);
    try {
      const r = await api.feed(slot, food);
      apply(r);
      rewards(r);
      sfx('nyangMeow', { rate: 1.2 });
      freeCat(v);
      v.actor.say('냠냠!', 1500);
      walkTo(v, bowlSpot(bowlOf(slot).food), { kind: 'pose', pose: 'eat', until: 0, ms: 7000, face: -1 }, true);
      const a = v.actor.act;
      if (a.kind === 'walk') a.arrive = () => ((v.behavior = 'eat'), ctx.saw(v, 'eat'));
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
      bowlOf(slot).food.el.style.removeProperty('--fill');
    }
  }

  // ---------- 물 갈기: 물그릇을 누른다 ----------
  for (const [slot, bw] of bowls) bw.water.el.addEventListener('click', () => void doWater(slot));
  for (const bw of bowls.values()) bw.food.el.addEventListener('click', () => !busy && toast('사료 봉투를 끌어다 밥그릇 위에서 기울여요'));
  async function doWater(slot: number) {
    if (busy) return;
    const lv = levels(slot);
    if (lv.water >= CONST.water_fresh && !lv.spoiled) return toast('물이 아직 깨끗해요');
    busy = true;
    const v = viewOf(slot);
    const el = bowlOf(slot).water.el;
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
      const r = await api.water(slot);
      await new Promise((ok) => setTimeout(ok, 450));
      el.classList.remove('dump');
      jug.classList.add('pour');
      sfx('nyangWater');
      buzz([10, 40, 10]);
      await new Promise((ok) => setTimeout(ok, 650));
      apply(r);
      rewards(r);
      freeCat(v);
      walkTo(v, bowlSpot(bowlOf(slot).water), { kind: 'pose', pose: 'drink', until: 0, ms: 4500, face: -1 }, true);
    } catch (e) {
      el.classList.remove('dump');
      toast(errorText(e));
    } finally {
      jug.remove();
      busy = false;
    }
  }

  // ---------- 똥 치우기: 화장실을 누르면 확대 ----------
  props.litter.el.addEventListener('click', () => {
    if (busy) return;
    if (!state.cats.some((c) => levels(c.slot).poops > 0)) return toast('화장실이 깨끗해요');
    openLitter();
  });
  function openLitter() {
    sfx('click');
    const dim = document.createElement('div');
    dim.className = 'dim';
    // 덩어리마다 주인 고양이 (퍼내면 그 고양이의 청결이 돌아온다)
    const owners: number[] = [];
    for (const c of state.cats) for (let i = 0; i < levels(c.slot).poops; i++) owners.push(c.slot);
    const n = owners.length;
    const SPOTS = [[30, 38], [62, 30], [44, 62], [72, 60], [20, 60], [54, 46], [80, 40], [36, 24], [66, 70], [24, 28], [48, 30], [78, 64], [14, 44], [58, 60], [40, 48], [86, 54]];
    dim.innerHTML = `<div class="litter-zoom panel" role="dialog" aria-label="화장실 치우기">
      <button class="btn iconbtn close" type="button" aria-label="닫기">✕</button>
      <h3>화장실 치우기</h3>
      <div class="sandbox"><div class="sand">${SPOTS.slice(0, n).map(([x, y], i) => `<div class="lump" data-i="${i}" data-slot="${owners[i]}" style="left:${x}%;top:${y}%">${artImg('objects-poop', '<i></i>')}</div>`).join('')}</div></div>
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
          const r = await api.clean(Number(lump.dataset.slot) || mainSlot);
          apply(r);
          rewards(r);
          left--;
          if (r.gift) {
            const sb = dim.querySelector<HTMLElement>('.sand')!;
            floatAt(sb, lump.offsetLeft, lump.offsetTop, `<i class="coin-ico"></i> 엽전 +${r.gift}`, 'float gift');
            sfx('coin');
            buzz([10, 30, 10]);
          }
          if (left <= 0) {
            dim.querySelector('.lhint')!.textContent = '깨끗해졌어요!';
            setTimeout(close, 900);
          }
        } catch (e) {
          toast(errorText(e));
          if (e instanceof Error && e.message === 'no poop') lump.remove();
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
      if (room.classList.contains('camera')) {
        e.preventDefault();
        e.stopPropagation();
        room.classList.remove('camera');
        return void takePhoto(v);
      }
      if (v.scene && v.scene !== 'social' && v.scene !== 'furn') return;
      e.preventDefault();
      e.stopPropagation();
      if (v.scene) freeCat(v);
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
  $('#catBtn').addEventListener('click', () => openSheet(sheetSlot));

  // ---------- 바닥을 누르면: 친밀도 4단계부터 따라온다 ----------
  room.addEventListener('pointerdown', (e) => {
    const tgt = e.target as HTMLElement;
    if (busy || view !== 'room' || !(tgt === room || tgt.classList.contains('floor') || tgt.classList.contains('floor-art'))) return;
    const rr = room.getBoundingClientRect();
    if (e.clientY - rr.top < floorRect().top - 10) return;
    const fl = toFloor(e.clientX, e.clientY);
    floatAt(room, e.clientX - rr.left, e.clientY - rr.top, '', 'tapdot');
    views.forEach((v, i) => {
      if (v.scene === 'social' || v.scene === 'furn' || v.actor.vanish) return;
      follow(ctx, v, i ? { x: clamp(fl.x + (i % 2 ? 0.1 : -0.1) * Math.ceil(i / 2), 0.03, 0.97), y: clamp(fl.y + 0.04 * i, 0, 1) } : fl);
    });
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
      const chip = el.closest<HTMLElement>('[data-chip]');
      if (chip) {
        sheetSlot = Number(chip.dataset.chip);
        sheetMode = 'main';
        sfx('nyangMeow', { rate: 1.1 + Math.random() * 0.3 });
        return paintSheet();
      }
      if (el.closest('[data-photo]')) {
        const v = viewOf(sheetSlot);
        closeSheet();
        return void takePhoto(v);
      }
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
    const chips = state.cats.length > 1
      ? `<div class="cat-chips">${state.cats.map((x) => `<button type="button" class="chip ${x.slot === sheetSlot ? 'sel' : ''}" data-chip="${x.slot}"><i style="--dot:rgb(${COLOR[x.color].rgb.join(',')})"></i>${esc(x.name)}</button>`).join('')}</div>`
      : '';
    const head = `<button class="btn iconbtn close" type="button" data-close aria-label="닫기">✕</button>${chips}<h3>${esc(c.name)}</h3>`;
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
        <button class="btn" data-photo type="button">📷<small>사진</small></button>
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

  // ---------- 사진 (5단계): 지금 하는 행동 · 자세 · 방향을 앨범에 (그림은 저장하지 않는다) ----------
  let shooting = false;
  async function takePhoto(v: CatView) {
    if (shooting) return;
    const a = v.actor;
    if (a.vanish) return toast('숨숨집 속이라 보이지 않아요');
    const still = a.pose === 'sleep' ? 'sleep' : a.pose === 'loaf' ? 'loaf' : 'sit';
    const behavior = v.behavior === 'walk' ? (a.act.kind === 'walk' ? 'walk' : still) : v.behavior ?? (a.act.kind === 'walk' ? 'walk' : still);
    const mv = v.mate != null ? views.find((x) => x.slot === v.mate) : undefined;
    shooting = true;
    flash(room);
    sfx('click', { rate: 0.7 });
    buzz(20);
    try {
      const r = await api.photo(v.slot, behavior, a.pose, a.facing, mv ? mv.slot : 0, mv ? mv.actor.pose : '');
      apply(r);
      toast(`📷 앨범에 넣었어요 (${state.album.length}/${CONST.album_max})${r.added ? ` · 📖 처음 본 행동: ${BEHAVIOR[behavior]?.name ?? ''}` : ''}`, 2400);
      if (r.added) sfx('nyangGift', { volume: 0.5 });
    } catch (e) {
      toast(errorText(e));
      if (e instanceof Error && e.message === 'album full') openAlbum(ctx);
    } finally {
      shooting = false;
    }
  }
  /** 아래 띠 📷: 한 마리면 바로, 여러 마리면 찍을 고양이를 누른다 */
  $('#camBtn').addEventListener('click', () => {
    if (busy || view !== 'room') return;
    if (views.length === 1) return void takePhoto(main);
    room.classList.toggle('camera');
    if (room.classList.contains('camera')) {
      toast('찍을 고양이를 눌러요');
      sfx('click');
    }
  });

  // ---------- 꾸미기 (5단계) ----------
  function startDeco() {
    if (busy || decoOn) return;
    if (view !== 'room') go('room');
    decoOn = true;
    room.classList.remove('camera');
    $('.stage-ui').classList.add('hidden');
    openDeco({
      ctx, room, stage, furnish, geo,
      preview(items, st) {
        furnish.sync(items, state.profile.layout.vase);
        applyStyles(room, st);
        layout();
      },
      done() {
        decoOn = false;
        $('.stage-ui').classList.remove('hidden');
        paint();
        // 가구가 옮겨졌으니 연출 중인 고양이는 놓아준다
        for (const v of views) if (v.scene === 'furn' || v.scene === 'social') freeCat(v), (v.actor.act = { kind: 'idle', until: 0 });
      },
    });
  }
  // 꽃병 누르기 (꾸미기 밖): 꽃 꽂기
  room.addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('.furn');
    if (!f || decoOn || busy) return;
    if (f.dataset.furn === 'vase') chooseVase(ctx);
  });

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
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---------- 들어올 때 ----------
  const c0 = catOf(mainSlot);
  if (o.fresh) {
    const nv = viewOf(o.fresh);
    const nc = catOf(o.fresh);
    nv.actor.say('냐앙!', 2000);
    toast(`${josa(nc.name, '이', '가')} 집에 왔어요!`);
    nv.actor.act = { kind: 'pose', pose: 'beg', until: performance.now() + 2500 };
    if (o.fresh === 1 && itemCount(state.profile, `churu:${PERSONALITY[c0.personality].churu}`) > 0)
      setTimeout(() => toast(`입양 선물로 ${CHURU[PERSONALITY[c0.personality].churu].name} 츄르 ${CONST.start_churu}개를 받았어요`, 2600), 2400);
    if (o.fresh > 1) {
      // 먼저 살던 고양이가 다가와 인사 (킁킁)
      const old = views.find((x) => x.slot !== o.fresh)!;
      nv.actor.pos = { x: 0.62, y: 0.6 };
      walkTo(old, { x: 0.78, y: 0.62 }, { kind: 'pose', pose: 'sit', until: 0, ms: 2500, face: -1 });
      setTimeout(() => old.actor.say('킁킁… 새 친구냥?', 2000), 1500);
    }
  } else if (o.away >= GREET_SEC && !state.cats.every((c) => levels(c.slot).sick)) {
    void greet();
  }
  /** 오랜만이면 문이 열리고 고양이가 문 앞까지 달려와 맞이한다 (선물이 있으면 물어 와서 내려놓는다) */
  async function greet() {
    // 아프지 않은 고양이 모두가 문 앞(오른쪽)으로 달려온다 — 첫 고양이가 앞장
    const vs = views.filter((x) => !levels(x.slot).sick);
    const DOOR = [{ x: 0.86, y: 0.06 }, { x: 0.74, y: 0.14 }, { x: 0.94, y: 0.2 }, { x: 0.66, y: 0.24 }];
    greeting = true;
    vs.forEach((v, i) => {
      v.scene = 'greet';
      v.actor.pos = { x: 0.3 + i * 0.15, y: 0.85 - (i % 2) * 0.15 };
      v.actor.act = { kind: 'pose', pose: 'sleep', until: Infinity };
    });
    const door = $('#door');
    await new Promise((r) => setTimeout(r, 500));
    door.classList.add('open');
    sfx('click');
    await new Promise((r) => setTimeout(r, 450));
    for (const v of vs) {
      v.actor.act = { kind: 'hold', pose: 'sit' };
      v.actor.say('!', 600);
    }
    sfx('nyangMeow', { rate: 1.3 });
    await new Promise((r) => setTimeout(r, 500));
    vs.forEach((v, i) => {
      v.actor.perky = true;
      setTimeout(() => walkTo(v, DOOR[i % DOOR.length], { kind: 'hold', pose: 'beg' }, true), i * 220);
    });
    while (vs.some((v) => (v.actor.act as Act).kind !== 'hold' || (v.actor.act as { pose?: string }).pose !== 'beg')) await new Promise((r) => setTimeout(r, 50));
    for (const v of vs) {
      const a = v.actor;
      a.perky = false;
      a.facing = 1;
      a.setFx('sparkle');
      ctx.saw(v, 'greet');
      const m = a.mouthPoint();
      for (let i = 0; i < 4; i++) setTimeout(() => floatAt(room, m.x + (Math.random() - 0.5) * 60, m.y - 30 - Math.random() * 30, '♥', 'float heart'), i * 180);
    }
    vs[0]?.actor.say('냐앙~! 왔다옹!', 2200);
    if (vs[1]) setTimeout(() => vs[1].actor.say('냥냥!', 1600), 500);
    sfx('nyangMeow');
    buzz([10, 30, 10]);
    await new Promise((r) => setTimeout(r, 2300));
    for (const v of vs) v.actor.setFx('none');
    door.classList.remove('open');
    greeting = false;
    for (const v of vs) {
      v.scene = null;
      v.actor.act = { kind: 'pose', pose: 'sit', until: performance.now() + 1000 + Math.random() * 1500 };
    }
    const pc = state.cats.find((c) => c.present);
    if (pc) {
      // 물어 온 선물을 내려놓는다
      const v = viewOf(pc.slot);
      v.actor.say('선물이다옹!', 1600);
      walkTo(v, { x: props.present.at.x + 0.12, y: props.present.at.y + 0.02 }, { kind: 'pose', pose: 'sit', until: 0, ms: 3000, face: -1 });
    }
    paint();
  }
  if (o.away >= SUMMARY_SEC || state.cats.some((c) => levels(c.slot).sick)) showSummary(o.away);
  function showSummary(away: number) {
    const c = catOf(mainSlot);
    const lines: string[] = [];
    const many = state.cats.length > 1;
    let poops = 0;
    for (const x of state.cats) {
      const lv = levels(x.slot);
      const nm = many ? `${x.name}: ` : '';
      if (lv.sick) lines.push(`${nm}${lv.curing ? '담요를 덮고 쉬는 중이에요' : '감기 기운이 있어요 (에취!)'}`);
      if (lv.full < CONST.half) lines.push(`${nm}${lv.full === 0 ? '밥그릇이 텅 비었어요' : '밥이 얼마 안 남았어요'}`);
      if (lv.spoiled) lines.push(`${nm}물이 상했어요`);
      else if (lv.water < CONST.half) lines.push(`${nm}물이 거의 없어요`);
      if (lv.mood < CONST.half) lines.push(`${nm}심심해하고 있어요`);
      poops += lv.poops;
    }
    if (poops) lines.push(`화장실에 똥 ${poops}개`);
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
      <h3>${many ? '고양이들이' : esc(josa(c.name, '이', '가'))} 집사를 기다렸어요</h3>
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

  // 개발용 (?local=1): 콘솔에서 행동 시키기 · 장면 시간 재기
  if (api.kind === 'local') (window as unknown as { __nyang: unknown }).__nyang = { ctx, views, act: (slot: number, id: string) => devAct(ctx, viewOf(slot), id) };
  requestAnimationFrame(frame);
  function dispose() {
    alive = false;
    ro.disconnect();
    clearInterval(timer);
    clearInterval(bgmTimer);
    document.removeEventListener('visibilitychange', onVisible);
  }
  return dispose;
}
