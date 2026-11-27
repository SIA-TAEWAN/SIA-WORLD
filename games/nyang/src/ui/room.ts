/**
 * 방 화면 (PRD 8장 1 · 2): 위 띠 · 방(벽 · 창 · 문 · 바닥 · 밥그릇 · 물그릇 · 화장실 · 방석) · 고양이 · 아래 도구 띠.
 * 돌보기: 사료 봉투 끌어다 기울이기 · 물그릇 누르기 · 화장실 누르기(확대 → 삽으로 퍼서 봉투에) · 고양이 문지르기(쓰다듬기) · 고양이 누르기(정보 창).
 * 상태는 서버가 준 기록을 서버 시각으로 풀어서(game/rules.ts) 보여 준다. 돌보기는 모두 api 를 거친다.
 */
import { COLOR, CONST, PERSONALITY, SPOT_NAME, kstHour, loveLevel } from '../data/balance';
import { errorText, type CareOut, type NyangApi } from '../net/api';
import { levelsOf, needs, spotKind, type Cat, type Levels, type NyangState } from '../game/rules';
import { CatActor, type Act, type Spot2 } from './cat';
import { preloadColor } from './catart';
import { buzz, esc, floatAt, getSound, josa, setVibe, sfx, toast, vibeOn } from './common';
import { blanket, cushion, foodBag, foodBowl, litterBox, scoop, trashBag, waterBowl, waterJug } from './props';

/** 들어올 때 요약 카드 · 문 앞 마중 (UI 기준 값) */
const SUMMARY_SEC = 3 * 3600;
const GREET_SEC = 6 * 3600;

interface Prop {
  el: HTMLElement;
  at: Spot2;
  /** 방 너비에 대한 그림 너비 비율 · 그림 세로/가로 */
  w: number;
  ratio: number;
}

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
  const slot = state.cats[0]?.slot ?? 1;
  const catOf = (): Cat => state.cats.find((c) => c.slot === slot)!;
  const now = () => api.now();
  let lv: Levels = levelsOf(catOf(), Math.floor(now()));
  let sheet: HTMLElement | null = null;
  let busy = false;
  let lastPetCall = 0;

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <a class="back" href="${o.worldHome}">← SIA WORLD</a><span class="spacer"></span>
        <span class="pill" title="엽전"><i class="coin-ico"></i><b id="coins">0</b></span>
        <span class="pill" title="시아코인"><i class="sia-ico">S</i><b id="sia">0</b></span>
        <button class="btn iconbtn" id="setBtn" type="button" aria-label="설정">⚙️</button>
      </header>
      <main class="room" id="room">
        <div class="wall">
          <div class="window" id="window"><div class="sky"></div><div class="sun"></div><div class="panes"></div></div>
          <div class="door"><i></i></div>
          <div class="baseboard"></div>
        </div>
        <div class="floor"></div>
        <div class="prop" id="pLitter" role="button" aria-label="화장실">${litterBox(0)}<span class="alert">!</span><span class="flies"><i></i><i></i></span></div>
        <div class="prop" id="pCushion" aria-hidden="true">${cushion}</div>
        <div class="prop" id="pFood" role="button" aria-label="밥그릇">${foodBowl(1)}<span class="alert">!</span></div>
        <div class="prop" id="pWater" role="button" aria-label="물그릇">${waterBowl(1, false)}<span class="alert">!</span></div>
        <div class="blanket hidden" id="blanket">${blanket}</div>
        <div class="night" id="night"></div>
      </main>
      <footer class="tray">
        <div class="bagslot"><div class="bag" id="bag" aria-label="사료 봉투">${foodBag}</div><small>사료</small></div>
        <div class="hint" id="hint"></div>
        <button class="btn catbtn" id="catBtn" type="button"></button>
      </footer>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const room = $('#room');
  const props: Record<'food' | 'water' | 'litter' | 'cushion', Prop> = {
    litter: { el: $('#pLitter'), at: { x: 0.8, y: 0.08 }, w: 0.3, ratio: 52 / 100 },
    cushion: { el: $('#pCushion'), at: { x: 0.27, y: 0.86 }, w: 0.3, ratio: 50 / 120 },
    food: { el: $('#pFood'), at: { x: 0.4, y: 0.42 }, w: 0.23, ratio: 58 / 100 },
    water: { el: $('#pWater'), at: { x: 0.78, y: 0.56 }, w: 0.23, ratio: 58 / 100 },
  };
  const cat = new CatActor(room, catOf().color, catOf().pattern, { x: 0.5, y: 0.7 });
  void preloadColor(catOf().color, catOf().pattern);

  // ---------- 배치 ----------
  let W = 300;
  let H = 400;
  const floorRect = () => ({ left: W * 0.06, top: H * 0.47, width: W * 0.88, height: H * 0.46 });
  const toScreen = (p: Spot2) => {
    const f = floorRect();
    return { x: f.left + p.x * f.width, y: f.top + p.y * f.height };
  };
  function layout() {
    W = room.clientWidth;
    H = room.clientHeight;
    const f = floorRect();
    cat.floor = { ...f, scale: Math.min(H * 0.27, W * 0.42) / 381 };
    for (const p of Object.values(props)) {
      const s = toScreen(p.at);
      const w = W * p.w * (0.9 + 0.2 * p.at.y);
      p.el.style.width = `${w}px`;
      p.el.style.height = `${w * p.ratio}px`;
      p.el.style.transform = `translate(${s.x - w / 2}px, ${s.y - w * p.ratio}px)`;
      p.el.style.zIndex = String(Math.round(s.y));
    }
  }
  new ResizeObserver(layout).observe(room);
  layout();

  // ---------- 상태 그리기 ----------
  let lastFood = -1;
  let lastWater = '';
  let lastPoops = -1;
  function paint() {
    const t = Math.floor(now());
    const c = catOf();
    lv = levelsOf(c, t);
    const nd = needs(c, t);
    $('#coins').textContent = state.profile.coins.toLocaleString('ko-KR');
    $('#sia').textContent = state.profile.sia.toLocaleString('ko-KR');
    $('#catBtn').innerHTML = `<span class="heart">♥</span> ${esc(c.name)} <small>Lv${loveLevel(c.love).level}</small>`;
    const fl = Math.ceil((lv.full / CONST.max) * 3) / 3;
    if (fl !== lastFood) {
      lastFood = fl;
      props.food.el.firstElementChild!.outerHTML = foodBowl(lv.full / CONST.max);
    }
    const wk = `${Math.ceil((lv.water / CONST.max) * 4)}:${lv.spoiled}`;
    if (wk !== lastWater) {
      lastWater = wk;
      props.water.el.firstElementChild!.outerHTML = waterBowl(lv.water / CONST.max, lv.spoiled);
    }
    if (lv.poops !== lastPoops) {
      lastPoops = lv.poops;
      props.litter.el.firstElementChild!.outerHTML = litterBox(lv.poops);
    }
    props.food.el.classList.toggle('need', nd.food);
    props.water.el.classList.toggle('need', nd.water);
    props.litter.el.classList.toggle('need', nd.litter);
    props.litter.el.classList.toggle('dirty', lv.poops >= 3);
    props.water.el.classList.toggle('spoiled', lv.spoiled);
    cat.sick = lv.sick;
    $('#blanket').classList.toggle('hidden', !lv.curing);
    const hint = lv.sick && !lv.curing
      ? `${josa(c.name, '이', '가')} 감기 기운이 있어요. 모두 채우고 담요를 덮어 주세요`
      : lv.curing
        ? '담요를 덮고 쉬는 중이에요. 곧 나아요'
        : nd.food
          ? '밥그릇이 비었어요 — 사료 봉투를 끌어다 기울여요'
          : nd.water
            ? lv.spoiled ? '물이 상했어요 — 물그릇을 눌러 갈아 주세요' : '물이 부족해요 — 물그릇을 눌러요'
            : nd.litter
              ? '화장실이 지저분해요 — 화장실을 눌러요'
              : nd.mood
                ? `${josa(c.name, '이', '가')} 심심해해요 — 문질러서 쓰다듬어 주세요`
                : '고양이를 문지르면 쓰다듬어요';
    $('#hint').textContent = hint;
    // 시간대: 창밖과 밤 어둠
    const h = kstHour(t);
    const part = h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
    room.dataset.time = part;
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

  // ---------- 고양이 머리 ----------
  const bowlSpot = (p: Prop): Spot2 => ({ x: Math.max(0.12, p.at.x - 0.24), y: p.at.y + 0.05 });
  const walkTo = (to: Spot2, then?: Act, fast = false) => {
    cat.act = { kind: 'walk', to, speed: fast ? 330 : 150, then };
  };
  let nextMeow = 0;
  function think(t: number) {
    const c = catOf();
    const nd = needs(c, Math.floor(now()));
    const night = room.dataset.time === 'night';
    const r = Math.random();
    if (lv.sick) {
      if (r < 0.4) cat.say('에취!', 1400, t), sfx('nyangMeow', { rate: 1.6, volume: 0.5 });
      cat.act = { kind: 'pose', pose: 'loaf', until: t + 5000 + Math.random() * 5000 };
      return;
    }
    if (nd.food || nd.water || nd.litter) {
      const target = nd.food ? props.food : nd.water ? props.water : props.litter;
      const spot = target === props.litter ? { x: 0.58, y: 0.28 } : bowlSpot(target);
      const near = Math.hypot(cat.pos.x - spot.x, cat.pos.y - spot.y) < 0.05;
      if (!near) return walkTo(spot);
      cat.facing = 1;
      const words = nd.food ? '배고파옹…' : nd.water ? (lv.spoiled ? '물이 이상해옹' : '목말라옹…') : '화장실이…';
      if (t > nextMeow) {
        cat.say(words, 2200, t);
        sfx('nyangMeow', { rate: 0.9 + Math.random() * 0.2 });
        nextMeow = t + 9000;
      }
      if (nd.water) target.el.classList.add('tap'), setTimeout(() => target.el.classList.remove('tap'), 700);
      cat.act = { kind: 'pose', pose: 'sit', until: t + 3500 };
      return;
    }
    if (nd.mood) {
      cat.facing = -1;
      if (r < 0.3) cat.say('…', 1500, t);
      cat.act = { kind: 'pose', pose: 'loaf', until: t + 6000 };
      return;
    }
    if (night && r < 0.75) {
      const bed = { x: props.cushion.at.x, y: props.cushion.at.y - 0.06 };
      if (Math.hypot(cat.pos.x - bed.x, cat.pos.y - bed.y) > 0.04) return walkTo(bed);
      cat.act = { kind: 'pose', pose: 'sleep', until: t + 20000 + Math.random() * 20000 };
      if (Math.random() < 0.5) cat.say('zZ', 2500, t);
      return;
    }
    if (r < 0.5) return walkTo({ x: 0.08 + Math.random() * 0.84, y: 0.3 + Math.random() * 0.65 });
    if (r < 0.65) return void (cat.act = { kind: 'pose', pose: 'loaf', until: t + 7000 + Math.random() * 8000 });
    if (r < 0.73) return void (cat.act = { kind: 'pose', pose: 'stretch', until: t + 1800 });
    if (r < 0.8) {
      const bed = { x: props.cushion.at.x, y: props.cushion.at.y - 0.06 };
      return walkTo(bed, { kind: 'pose', pose: 'knead', until: 0, ms: 6000 });
    }
    if (r < 0.86) return void (cat.act = { kind: 'pose', pose: 'jump', until: t + 600 });
    if (r < 0.9) return void (cat.act = { kind: 'pose', pose: 'sleep', until: t + 12000 });
    cat.act = { kind: 'idle', until: t + 3000 + Math.random() * 3000 };
  }

  // ---------- 매 장면 ----------
  let last = performance.now();
  let paintAt = 0;
  let alive = true;
  function frame(t: number) {
    if (!alive) return;
    const dt = Math.min(100, t - last);
    last = t;
    if (cat.act.kind === 'idle' && t >= cat.act.until) think(t);
    else if (cat.act.kind === 'pose' && t >= cat.act.until) think(t);
    cat.update(t, dt);
    if (lv.curing) {
      // 담요: 고양이 몸 위에
      const sc = cat.screen();
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
  paint();

  // ---------- 밥 주기: 사료 봉투를 끌어다 밥그릇 위에서 기울인다 ----------
  const bag = $('#bag');
  bag.addEventListener('pointerdown', (e) => {
    if (busy) return;
    e.preventDefault();
    bag.setPointerCapture(e.pointerId);
    const ghost = document.createElement('div');
    ghost.className = 'drag-bag';
    ghost.innerHTML = foodBag;
    document.body.append(ghost);
    bag.classList.add('lifted');
    let pour = 0;
    let lastT = performance.now();
    let over = false;
    let done = false;
    let raf = 0;
    let px = e.clientX;
    let py = e.clientY;
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
        if (lv.full >= CONST.feed_full) {
          done = true;
          toast('밥그릇이 아직 가득해요');
        } else {
          pour += dt;
          // 사료 알갱이
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
      const b = bowlBox();
      // 봉투 입구(손가락 왼쪽 위)가 밥그릇 위에 오면 기울인다
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
    };
    bag.addEventListener('pointermove', move);
    bag.addEventListener('pointerup', up);
    bag.addEventListener('pointercancel', up);
  });
  async function doFeed() {
    busy = true;
    buzz([20, 30, 20]);
    try {
      const r = await api.feed(slot, 'basic');
      apply(r);
      rewards(r);
      sfx('nyangMeow', { rate: 1.2 });
      // 고양이가 달려와서 먹는다
      cat.say('냠냠!', 1500);
      walkTo(bowlSpot(props.food), { kind: 'pose', pose: 'eat', until: 0, ms: 7000, face: 1 }, true);
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
      const r = await api.water(slot);
      await new Promise((ok) => setTimeout(ok, 450));
      el.classList.remove('dump');
      jug.classList.add('pour');
      sfx('nyangWater');
      buzz([10, 40, 10]);
      await new Promise((ok) => setTimeout(ok, 650));
      apply(r);
      rewards(r);
      walkTo(bowlSpot(props.water), { kind: 'pose', pose: 'drink', until: 0, ms: 4500, face: 1 }, true);
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
    if (lv.poops === 0) return toast('화장실이 깨끗해요');
    openLitter();
  });
  function openLitter() {
    sfx('click');
    const dim = document.createElement('div');
    dim.className = 'dim';
    const n = lv.poops;
    // 덩어리 자리 (모래 판 안 %, 정해진 자리)
    const SPOTS = [[30, 38], [62, 30], [44, 62], [72, 60]];
    dim.innerHTML = `<div class="litter-zoom panel" role="dialog" aria-label="화장실 치우기">
      <button class="btn iconbtn close" type="button" aria-label="닫기">✕</button>
      <h3>화장실 치우기</h3>
      <div class="sandbox"><div class="sand">${SPOTS.slice(0, n).map(([x, y], i) => `<div class="lump" data-i="${i}" style="left:${x}%;top:${y}%"><i></i></div>`).join('')}</div></div>
      <div class="tools"><div class="trash" aria-label="봉투">${trashBag}</div><p class="lhint">삽으로 덩어리를 떠서 봉투에 넣어요</p><div class="scoop" aria-label="모래 삽">${scoop}</div></div>
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
              // 모래 튀김
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
          // 봉투에 넣지 않았으면 덩어리를 제자리로
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
          const r = await api.clean(slot);
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

  // ---------- 쓰다듬기 · 고양이 누르기 ----------
  cat.hit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
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
      const kind = spotKind(catOf(), spot);
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
      // 1.2초 넘게 문지르면 서버에 쓰다듬기 한 번 (같은 고양이는 8초에 한 번까지)
      if (rubMs > 1200 && now() - lastPetCall >= CONST.pet_gap_sec + 0.5) {
        lastPetCall = now();
        rubMs = 0;
        void api
          .pet(slot, spot)
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
        openSheet();
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
  $('#catBtn').addEventListener('click', () => openSheet());

  // ---------- 고양이 정보 창 ----------
  function openSheet() {
    if (sheet) return;
    sfx('nyangMeow', { rate: 1.15 });
    sheet = document.createElement('div');
    sheet.className = 'dim sheet-dim';
    sheet.innerHTML = `<div class="sheet panel" role="dialog" aria-label="고양이 정보"><div class="sheet-body"></div></div>`;
    document.body.append(sheet);
    sheet.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === sheet || el.closest('[data-close]')) return closeSheet();
      if (el.closest('[data-cure]')) void doCure();
      if (el.closest('[data-soon]')) toast('다음 업데이트에서 열려요');
    });
    paintSheet();
  }
  function closeSheet() {
    sheet?.remove();
    sheet = null;
  }
  function paintSheet() {
    if (!sheet) return;
    const c = catOf();
    const p = PERSONALITY[c.personality];
    const l = loveLevel(c.love);
    const bar = (name: string, ico: string, v: number, extra = '') =>
      `<div class="stat"><span>${ico} ${name}</span><div class="track"><i style="width:${Math.round((v / CONST.max) * 100)}%" class="${v < CONST.half ? 'low' : ''}"></i></div><em>${Math.round((v / CONST.max) * 100)}%${extra}</em></div>`;
    sheet.querySelector('.sheet-body')!.innerHTML = `
      <button class="btn iconbtn close" type="button" data-close aria-label="닫기">✕</button>
      <h3>${esc(c.name)}</h3>
      <div class="ai-head"><span class="tag">${COLOR[c.color].name}</span><span class="tag pink">${p.name}</span>${lv.sick ? `<span class="tag blue">${lv.curing ? '쉬는 중' : '감기 기운'}</span>` : ''}</div>
      <div class="love"><span>친밀도 <b>Lv${l.level}</b></span><div class="track"><i style="width:${l.need ? Math.round((l.have / l.need) * 100) : 100}%"></i></div><em>${l.need ? `${Math.floor((l.have / l.need) * 100)}%` : '최고'}</em></div>
      ${bar('배부름', '🍚', lv.full)}
      ${bar('목마름', '💧', lv.water, lv.spoiled ? ' · 상함' : '')}
      ${bar('청결', '🧹', lv.clean, lv.poops ? ` · 똥 ${lv.poops}` : '')}
      ${bar('기분', '😺', lv.mood)}
      <p class="likes">좋아하는 곳: ${p.likes.map((s) => SPOT_NAME[s]).join(' · ')} · 싫어하는 곳: ${p.dislikes.map((s) => SPOT_NAME[s]).join(' · ')}</p>
      ${lv.sick && !lv.curing ? `<button class="btn primary wide" data-cure type="button">담요 덮어 주기</button>` : ''}
      <div class="acts">
        <button class="btn" data-soon type="button">🎣<small>놀아 주기</small></button>
        <button class="btn" data-soon type="button">🪮<small>빗질</small></button>
        <button class="btn" data-soon type="button">📷<small>사진</small></button>
        <button class="btn" data-soon type="button">🍡<small>츄르</small></button>
      </div>`;
  }
  async function doCure() {
    try {
      const r = await api.cure(slot, 'blanket');
      apply(r);
      sfx('tankHeal');
      buzz(20);
      toast('담요를 덮어 주었어요. 2시간 뒤면 나아요');
      cat.act = { kind: 'pose', pose: 'sleep', until: performance.now() + 15000 };
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
  const c0 = catOf();
  if (o.fresh) {
    cat.say('냐앙!', 2000);
    toast(`${josa(c0.name, '이', '가')} 집에 왔어요!`);
    cat.act = { kind: 'pose', pose: 'beg', until: performance.now() + 2500 };
  } else if (o.away >= GREET_SEC) {
    // 오랜만이면 문 앞으로 달려와 맞이한다
    cat.pos = { x: 0.04, y: 0.02 };
    walkTo({ x: 0.45, y: 0.75 }, { kind: 'pose', pose: 'beg', until: 0, ms: 4000 }, true);
    setTimeout(() => (cat.say('냐앙~!', 2200), sfx('nyangMeow')), 900);
  }
  if (o.away >= SUMMARY_SEC || lv.sick) showSummary(o.away);
  function showSummary(away: number) {
    const c = catOf();
    const lines: string[] = [];
    if (lv.sick) lines.push(lv.curing ? '담요를 덮고 쉬는 중이에요' : '감기 기운이 있어요 (에취!)');
    if (lv.full < CONST.half) lines.push(lv.full === 0 ? '밥그릇이 텅 비었어요' : '밥이 얼마 안 남았어요');
    if (lv.spoiled) lines.push('물이 상했어요');
    else if (lv.water < CONST.half) lines.push('물이 거의 없어요');
    if (lv.poops) lines.push(`화장실에 똥 ${lv.poops}개`);
    if (lv.mood < CONST.half) lines.push('심심해하고 있어요');
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
    document.body.append(dim);
  }

  // 배경음: 밤에는 편안한 곡 (파일이 없으면 소리 없이)
  const bgm = () => getSound()?.playBgm('nyang', room.dataset.time === 'night' ? 'boss' : 'main');
  bgm();
  setInterval(() => {
    const was = room.dataset.time;
    paint();
    if (room.dataset.time !== was) bgm();
  }, 60_000);

  requestAnimationFrame(frame);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
