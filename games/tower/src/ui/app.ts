/**
 * 시아의탑 화면: 처음 화면 · 캐릭터 만들기 · 탑(게임 화면 + HUD + 조작) · 메뉴 · 상점 · 쓰러짐 · 10층 돌파.
 * 진행 상태(ctx.data)는 늘 '마지막으로 저장한 것'. 층 안의 변화는 run.data 에만 있다가 층을 깨거나 메뉴·상점·죽음에서 저장된다.
 */
import Phaser from 'phaser';
import { enemySheet, orbIcons, preloadOrbIcons, tileSheet } from '../art/load';
import { ITEMS, LAST_READY, ORBS, SHARDS_TO_AWAKEN, expNeed, floorReady, floorRule, itemDef, orbDef, priceOf, statsAt, zoneData, type ItemId } from '../data';
import { generateFloor } from '../game/floorgen';
import { awakenWithShards, buy, clearFloor, clone, die, equipOrb, isLook, sameLook, type Look, type TowerData } from '../game/progress';
import { canAwaken, createRun, equippedOrb, interactLabel, interactTarget, maxHp, maxMp, useItem, type RunState, type SimEvent } from '../game/sim';
import { ApiError, type TowerApi } from '../net/api';
import { DEV_AWAKEN, DEV_COINS, DEV_FLOOR, DEV_GOD, DEV_LEVEL, DEV_ORBS, DEV_RESET, DEV_SHARDS, LOCAL_MODE } from '../net/local';
import { loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, type SceneArt, type SceneHooks } from '../scenes/GameScene';
import { COLOR } from '../theme';
import { createControls, type Controls } from './controls';
import { lookLayers, makePreview, stillImage } from './preview';

interface Ctx {
  api: TowerApi;
  user: WorldUser | null;
  look: Look | null;
  data: TowerData;
  siaCoins: number;
  lookPrice: number;
  sound: SoundModule | null;
}
let ctx!: Ctx;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const app = () => document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nick = () => esc(ctx.user?.nickname ?? '테스트 대원');
const sfx = (name: string, opts?: { volume?: number; rate?: number }) => {
  try {
    ctx.sound?.play(name, opts);
  } catch {
    /* 소리는 없어도 된다 */
  }
};
const orbIcon = (id: string | null | undefined) => {
  const o = orbDef(id);
  if (!o) return '⚪';
  const url = orbIcons.get(o.id);
  return url ? `<img class="orb-img" src="${url}" alt="">` : o.icon;
};
const coinFmt = (n: number) => n.toLocaleString('ko-KR');

export function toast(text: string, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.getElementById('stage')!.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- 시작 ----------
export async function boot(api: TowerApi, user: WorldUser | null) {
  if (LOCAL_MODE && DEV_RESET) localStorage.removeItem('siatower:local');
  const st = await api.state();
  ctx = { api, user, look: st.look, data: st.data, siaCoins: st.siaCoins, lookPrice: st.lookPrice, sound: null };
  if (LOCAL_MODE) applyDev(ctx.data);
  void loadSound()
    .then((m) => (ctx.sound = m))
    .catch(() => null);
  void preloadOrbIcons(ORBS.map((o) => o.id));
}

/** 개발용 주소 값 (?local=1&floor=5&lv=10&orbs=rat,ox …) — 기기 기록에 그대로 들어간다 */
function applyDev(d: TowerData) {
  if (DEV_FLOOR) {
    d.floor = DEV_FLOOR;
    d.best = Math.max(d.best, DEV_FLOOR - 1);
    d.checkpoint = Math.floor((DEV_FLOOR - 1) / 10) * 10 + 1;
    if (!DEV_LEVEL) d.level = Math.max(d.level, DEV_FLOOR);
    if (!DEV_ORBS.length) {
      if (DEV_FLOOR > 2) d.orbs.rat ||= 1;
      if (DEV_FLOOR > 7) d.orbs.ox ||= 1;
      d.equipped ??= d.orbs.rat ? 'rat' : null;
    }
  }
  if (DEV_LEVEL) d.level = DEV_LEVEL;
  for (const id of DEV_ORBS) if (orbDef(id)) d.orbs[id] ||= 1;
  for (const id of DEV_AWAKEN) if (orbDef(id)) {
    d.orbs[id] ||= 1;
    if (!d.awakened.includes(id)) d.awakened.push(id);
  }
  if (DEV_ORBS.length || DEV_AWAKEN.length) d.equipped ??= DEV_ORBS[0] ?? DEV_AWAKEN[0];
  if (DEV_COINS) d.coins = DEV_COINS;
  if (DEV_SHARDS) d.shards = DEV_SHARDS;
  // 테스트 모드 기기 기록의 '깬 최고 층' 도 맞춘다 (서버처럼 층 건너뛰기를 막으므로)
  try {
    const row = JSON.parse(localStorage.getItem('siatower:local') ?? 'null');
    if (row && typeof row === 'object' && Number(row.best ?? 0) < d.best) localStorage.setItem('siatower:local', JSON.stringify({ ...row, best: d.best }));
  } catch {
    /* 기기 저장소가 없으면 그만 */
  }
}

export function showFirst() {
  if (!ctx.look) openCreator({ first: true, onDone: () => (LOCAL_MODE && DEV_FLOOR ? play() : title()) });
  else if (LOCAL_MODE && DEV_FLOOR) play();
  else title();
}

// ---------- 처음 화면 ----------
let titlePreview: { destroy(): void } | null = null;
function title() {
  titlePreview?.destroy();
  const d = ctx.data;
  const ready = floorReady(d.floor);
  const pending = ctx.api.pending();
  app().innerHTML = `
    <div class="screen title-screen">
      <div class="bar">
        <a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span>
        <div class="pills"><span class="coins-pill" title="시아코인">🪙 ${coinFmt(ctx.siaCoins)}</span></div>
      </div>
      <div class="title"><h1>시아의탑</h1><p>꼭대기 100층, 소원을 들어주는 구슬을 찾아서</p></div>
      <div class="tower-hero card">
        <canvas class="hero-cv" width="128" height="128"></canvas>
        <div class="me-info">
          <b>${nick()}</b>
          <small>Lv ${d.level} · 엽전 ${coinFmt(d.coins)}냥 · 구슬 조각 ${d.shards}</small>
          <small>최고 ${d.best}층 · 체크포인트 ${d.checkpoint}층</small>
          <div class="lv"><i style="width:${Math.round((d.exp / expNeed(d.level)) * 100)}%"></i></div>
        </div>
      </div>
      <div class="menu-btns">
        ${ready ? `<button class="btn primary big" id="go">${d.floor}층부터 오르기 ▶</button>` : `<div class="card soon-card"><b>${d.floor}층부터는 아직 준비 중이에요</b><p class="soft">${d.checkpoint}층 체크포인트가 저장되어 있어요. 곧 열려요!</p></div>
          <button class="btn big" id="replay">1층부터 다시 오르기 <small>경험치 절반</small></button>`}
        <div class="row2">
          <button class="btn" id="look">👕 외형 바꾸기</button>
          <button class="btn" id="rank">🏆 랭킹</button>
        </div>
        <div class="row2">
          <button class="btn" id="sound">${ctx.sound?.isMuted() ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}</button>
          <button class="btn" id="help">❓ 조작법</button>
        </div>
        ${pending ? `<p class="light center">보내지 못한 저장 ${pending}개 — 연결되면 다시 보내요</p>` : ''}
      </div>
    </div>`;
  if (ctx.look) titlePreview = makePreview($<HTMLCanvasElement>('.hero-cv'), ctx.look, 4);
  $('#go', app())?.addEventListener('click', () => {
    sfx('click');
    play();
  });
  document.getElementById('replay')?.addEventListener('click', () => {
    sfx('click');
    ctx.data.floor = 1;
    play();
  });
  $('#look').addEventListener('click', () => {
    sfx('click');
    openCreator({ first: false, onDone: title, onCancel: title });
  });
  $('#rank').addEventListener('click', () => openRanking());
  $('#sound').addEventListener('click', () => {
    if (!ctx.sound) return;
    ctx.sound.setMuted(!ctx.sound.isMuted());
    ctx.sound.setBgmOn?.(!ctx.sound.isMuted());
    sfx('toggle');
    title();
  });
  $('#help').addEventListener('click', () => helpBox());
  if (pending) void ctx.api.resend();
}

async function openRanking() {
  if (!ctx.user) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
  if (!(await openWorldRanking(ctx.user.userId))) toast('랭킹을 불러오지 못했어요');
}

function helpBox() {
  const ov = overlay(`
    <div class="card pop help">
      <h3>조작법</h3>
      <div class="rows">
        <div><span>이동</span><b><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span> · 방향키 · 왼쪽 조이스틱</b></div>
        <div><span>칼 3타 콤보</span><b><span class="key">J</span> · <span class="key">Space</span> · 🗡️ (누르고 있으면 계속)</b></div>
        <div><span>구슬 스킬</span><b><span class="key">K</span> · 🔮</b></div>
        <div><span>각성</span><b><span class="key">L</span> · ✨</b></div>
        <div><span>상자·계단·상점</span><b><span class="key">E</span> · ✋</b></div>
        <div><span>회복약</span><b><span class="key">Q</span> · 🧪</b></div>
        <div><span>메뉴</span><b><span class="key">I</span> · <span class="key">Esc</span> · ☰</b></div>
      </div>
      <p class="soft">전투방에 들어가면 문이 잠겨요. 적을 모두 물리치면 열려요. 기본 공격을 맞히면 혼력이 차올라요.</p>
      <button class="btn primary" data-close>알겠어요</button>
    </div>`);
  ov.querySelector('[data-close]')!.addEventListener('click', () => ov.remove());
}

function overlay(html: string, parent: HTMLElement = document.getElementById('stage')!) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = html;
  parent.appendChild(ov);
  return ov;
}

// ---------- 캐릭터 만들기 ----------
const HAIR_NAMES = { m: ['짧은 머리', '삐죽 머리', '상투', '바가지 머리'], f: ['긴 생머리', '양갈래', '올림 머리', '단발'] };
const FACE_NAMES = ['동글', '방긋', '초롱', '다부진'];
const OUTFIT_NAMES = ['파랑 도포', '분홍 저고리', '노랑 조끼', '초록 무복'];
const STEPS = ['성별', '머리', '얼굴', '옷'] as const;

function openCreator(opts: { first: boolean; onDone(): void; onCancel?(): void; inGame?: boolean }) {
  titlePreview?.destroy();
  titlePreview = null;
  let look: Look = ctx.look ? { ...ctx.look } : { sex: 'm', hair: 0, face: 0, outfit: 0 };
  let stepNo = 0;
  let busy = false;
  const host = opts.inGame ? overlay('<div class="creator-wrap"></div>') : app();
  const root = opts.inGame ? (host.querySelector('.creator-wrap') as HTMLElement) : host;
  root.innerHTML = `
    <div class="screen creator">
      <div class="bar">
        ${opts.first ? '<span class="back-space"></span>' : '<button class="back" id="cancel">← 돌아가기</button>'}
        <h2>${opts.first ? '캐릭터 만들기' : '외형 바꾸기'}</h2>
        <div class="pills">${opts.first ? '' : `<span class="coins-pill">🪙 ${coinFmt(ctx.siaCoins)}</span>`}</div>
      </div>
      <div class="steps">${STEPS.map((s, i) => `<button class="step" data-step="${i}"><i>${i + 1}</i>${s}</button>`).join('')}</div>
      <div class="stage-card card">
        <canvas class="big-cv" width="160" height="160"></canvas>
        <b class="who">${nick()}</b>
      </div>
      <div class="card opts-card"><h3 class="opt-title"></h3><div class="opts"></div></div>
      <div class="grow"></div>
      <p class="soft center price-line"></p>
      <div class="creator-nav row2">
        <button class="btn" id="prev">◀ 이전</button>
        <button class="btn primary" id="next">다음 ▶</button>
      </div>
    </div>`;
  const preview = makePreview($<HTMLCanvasElement>('.big-cv', root), look, 5);
  const optBox = $('.opts', root);

  const render = () => {
    root.querySelectorAll<HTMLElement>('.step').forEach((b, i) => {
      b.classList.toggle('on', i === stepNo);
      b.classList.toggle('done', i < stepNo);
    });
    $('.opt-title', root).textContent = ['성별을 골라요', '머리 모양을 골라요', '얼굴을 골라요', '옷을 골라요'][stepNo];
    const items: { label: string; look: Look; on: boolean }[] = [];
    if (stepNo === 0) for (const sex of ['m', 'f'] as const) items.push({ label: sex === 'm' ? '남자' : '여자', look: { ...look, sex }, on: look.sex === sex });
    else
      for (let i = 0; i < 4; i++) {
        const l = { ...look, [['', 'hair', 'face', 'outfit'][stepNo]]: i } as Look;
        const label = stepNo === 1 ? HAIR_NAMES[look.sex][i] : stepNo === 2 ? FACE_NAMES[i] : OUTFIT_NAMES[i];
        items.push({ label, look: l, on: sameLook(l, look) });
      }
    optBox.className = `opts n${items.length}`;
    optBox.innerHTML = items.map((it, i) => `<button class="opt ${it.on ? 'on' : ''}" data-i="${i}"><canvas width="64" height="64"></canvas><b>${it.label}</b></button>`).join('');
    optBox.querySelectorAll<HTMLButtonElement>('.opt').forEach((b, i) => {
      void stillImage(b.querySelector('canvas')!, items[i].look, 2, stepNo === 1 ? 0 : 0);
      b.addEventListener('click', () => {
        sfx('click');
        look = items[i].look;
        preview.setLook(look);
        render();
      });
    });
    const last = stepNo === STEPS.length - 1;
    $<HTMLButtonElement>('#prev', root).disabled = stepNo === 0;
    const next = $<HTMLButtonElement>('#next', root);
    const same = sameLook(look, ctx.look);
    const pay = !opts.first && !!ctx.look && !same;
    next.innerHTML = !last ? '다음 ▶' : opts.first ? '이대로 시작 ▶' : same ? '그대로 두기' : `바꾸기 <small>시아코인 ${ctx.lookPrice}</small>`;
    next.disabled = busy || (last && pay && ctx.siaCoins < ctx.lookPrice);
    $('.price-line', root).innerHTML = opts.first
      ? '처음 만들기는 무료예요. 나중에 메뉴에서 시아코인 30개로 바꿀 수 있어요'
      : pay
        ? ctx.siaCoins < ctx.lookPrice
          ? `<span class="warn">시아코인이 모자라요 (필요 ${ctx.lookPrice}개 · 가진 것 ${ctx.siaCoins}개)</span>`
          : `바꾸면 시아코인 ${ctx.lookPrice}개를 써요 · 가진 시아코인 ${ctx.siaCoins}개`
        : '지금 모습과 같아요';
  };
  const close = () => {
    preview.destroy();
    if (opts.inGame) host.remove();
  };
  root.querySelectorAll<HTMLElement>('.step').forEach((b, i) =>
    b.addEventListener('click', () => {
      if (i > stepNo && opts.first) return;
      stepNo = i;
      render();
    }),
  );
  $('#prev', root).addEventListener('click', () => {
    if (stepNo > 0) stepNo--;
    render();
  });
  $('#next', root).addEventListener('click', async () => {
    sfx('click');
    if (stepNo < STEPS.length - 1) {
      stepNo++;
      return render();
    }
    if (!opts.first && sameLook(look, ctx.look)) {
      close();
      return opts.onDone();
    }
    busy = true;
    render();
    try {
      const r = await ctx.api.setLook(look);
      ctx.look = isLook(r.look) ? r.look : look;
      ctx.siaCoins = r.siaCoins;
      if (r.paid) toast(`외형을 바꿨어요 (시아코인 ${ctx.lookPrice}개)`);
      close();
      opts.onDone();
    } catch (e) {
      busy = false;
      render();
      if (e instanceof ApiError && e.message === 'not enough sia coins') toast('시아코인이 모자라요');
      else toast('저장하지 못했어요. 연결을 확인하고 다시 눌러 주세요');
    }
  });
  document.getElementById('cancel')?.addEventListener('click', () => {
    close();
    (opts.onCancel ?? opts.onDone)();
  });
  render();
}

// ---------- 탑 ----------
interface Play {
  game: Phaser.Game;
  scene: GameScene | null;
  run: RunState;
  controls: Controls;
  art: SceneArt;
  paused: boolean;
  dirty: boolean;
  miniKey: string;
  ended: boolean;
}
let cur: Play | null = null;
let gameWatch: ResizeObserver | null = null;

async function loadArt(look: Look): Promise<SceneArt> {
  const zone = zoneData(1)!;
  const ids = [...zone.enemies, zone.elite, zone.boss].filter(Boolean);
  const [layers, tiles, ...enemies] = await Promise.all([lookLayers(look), tileSheet(), ...ids.map(enemySheet)]);
  return { layers, tiles, enemies: Object.fromEntries(ids.map((id, i) => [id, enemies[i]])) };
}

async function play() {
  titlePreview?.destroy();
  titlePreview = null;
  if (!ctx.look) return showFirst();
  app().innerHTML = `
    <div class="play">
      <div id="game"></div>
      <div class="hud">
        <canvas id="mini" width="96" height="72"></canvas>
        <div class="hud-tr">
          <span class="hud-pill floor-pill"></span>
          <span class="hud-pill coin-pill"></span>
          <button class="icon-btn" id="menu" aria-label="메뉴">☰</button>
        </div>
        <div class="boss-bar hidden"><b></b><div class="gauge"><i></i></div></div>
        <div class="hud-bl">
          <div class="hud-name"><b class="lv-b"></b><span>${nick()}</span></div>
          <div class="hud-row">
            <div class="orb-slot"><span></span><i class="cd"></i></div>
            <div class="hud-bars">
              <div class="gauge hp"><i></i><em></em></div>
              <div class="gauge mp"><i></i><em></em></div>
              <div class="gauge exp"><i></i></div>
            </div>
          </div>
          <div class="hud-status"></div>
        </div>
        <div class="hud-note hidden"></div>
      </div>
    </div>`;
  const art = await loadArt(ctx.look);
  const controls = createControls($('.play'), { onMenu: () => openMenu() });
  $('#menu').addEventListener('click', () => openMenu());
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    roundPixels: true,
    backgroundColor: COLOR.inkSoft,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    input: { keyboard: false, mouse: false, touch: false },
    banner: false,
    scene: [],
  });
  if (LOCAL_MODE) (window as unknown as { __towerGame?: Phaser.Game }).__towerGame = game;
  // 화면을 돌리거나 창 크기가 바뀌면 그림판을 다시 맞춘다 (Phaser 가 창 크기 바뀜을 놓칠 때가 있다 — 시아열두길과 같은 방법)
  if (typeof ResizeObserver !== 'undefined') {
    gameWatch?.disconnect();
    gameWatch = new ResizeObserver(() => {
      game.scale.getParentBounds();
      game.scale.refresh();
    });
    gameWatch.observe(document.getElementById('game')!);
  }
  const run = newRun();
  cur = { game, scene: null, run, controls, art, paused: false, dirty: false, miniKey: '', ended: false };
  game.scene.add('tower', GameScene, true, { run, hooks: hooks(), art });
  cur.scene = game.scene.getScene('tower') as GameScene;
  floorBanner(run.map.floor);
  // 가려진 탭에서는 멈춘다
  document.addEventListener('visibilitychange', onHidden);
}
const onHidden = () => {
  if (document.hidden && cur && !cur.paused && !cur.ended) openMenu();
};

function newRun(): RunState {
  const floor = ctx.data.floor;
  const map = generateFloor(ctx.data.seed, floor);
  if (ctx.data.mapped.includes(floor)) (map as { mapped?: boolean }).mapped = true;
  return createRun(map, ctx.data, { god: DEV_GOD });
}

function startFloor() {
  if (!cur) return;
  const run = newRun();
  cur.run = run;
  cur.ended = false;
  cur.miniKey = '';
  cur.controls.release();
  cur.scene!.scene.restart({ run, hooks: hooks(), art: cur.art });
  setPaused(false);
  floorBanner(run.map.floor);
}

function leavePlay(to: () => void) {
  document.removeEventListener('visibilitychange', onHidden);
  gameWatch?.disconnect();
  gameWatch = null;
  if (cur) {
    cur.controls.destroy();
    cur.game.destroy(true);
    cur = null;
  }
  document.querySelectorAll('#stage > .overlay').forEach((o) => o.remove());
  to();
}

function setPaused(p: boolean) {
  if (!cur) return;
  cur.paused = p;
  if (cur.scene) cur.scene.paused = p;
  if (p) cur.controls.release();
}

function floorBanner(floor: number) {
  const z = zoneData(floor);
  const kind = floorRule(floor).kind;
  const sub = kind === 'rest' ? '휴식층 · 상점과 샘' : kind === 'elite' ? '정예가 기다린다' : kind === 'boss' ? `보스 · ${floor === 10 ? '문지기 골렘' : '???'}` : (z?.name ?? '');
  const el = document.createElement('div');
  el.className = 'floor-banner';
  el.innerHTML = `<b>${floor}층</b><small>${esc(sub)}</small>`;
  $('.play')?.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

let noteTimer = 0;
function hudNote(text: string, ms = 2200) {
  const el = document.querySelector<HTMLElement>('.hud-note');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
}

function hooks(): SceneHooks {
  return {
    input: () => cur!.controls.input,
    consume: () => cur!.controls.consume(),
    onEvents: (evs, s) => {
      for (const ev of evs) onEvent(ev, s);
    },
    onFrame: (s) => drawHud(s),
  };
}

const lastSfx = new Map<string, number>();
const sfxGap = (name: string, gap: number, opts?: { volume?: number; rate?: number }) => {
  const now = performance.now();
  if (now - (lastSfx.get(name) ?? -1e9) < gap) return;
  lastSfx.set(name, now);
  sfx(name, opts);
};

function onEvent(ev: SimEvent, s: RunState) {
  switch (ev.t) {
    case 'swing':
      sfxGap('twelveSlash', 60, { volume: 0.6, rate: ev.combo === 3 ? 0.8 : 1 });
      break;
    case 'hit':
      sfxGap('survPop', 50, { volume: 0.5 });
      break;
    case 'hurt':
      if (ev.dmg > 0) {
        sfxGap('twelveHurt', 120);
        try {
          navigator.vibrate?.(25);
        } catch {
          /* 진동이 없는 기기 */
        }
      }
      break;
    case 'kill':
      sfxGap('survSlash', 60);
      break;
    case 'level':
      sfx('twelveLevel');
      toast(`레벨 업! Lv ${ev.level}`);
      break;
    case 'chest': {
      sfx('survChest');
      const items = ev.items.map((id) => itemDef(id)?.name ?? id);
      toast(`엽전 +${ev.coins}냥${items.length ? ` · ${items.join(' · ')}` : ''}${ev.shard ? ` · 구슬 조각 +${ev.shard}` : ''}`, 2400);
      break;
    }
    case 'orb':
      sfx('twelveRare');
      orbCutin(ev.id, ev.gain);
      break;
    case 'lock':
      sfx('tankBuild');
      hudNote('문이 잠겼다! 적을 모두 물리치자');
      break;
    case 'unlock':
      sfx('toggle');
      hudNote('문이 열렸어요');
      break;
    case 'gate':
      sfxGap('tankBuild', 300);
      hudNote('철문이 열렸어요!');
      break;
    case 'rock':
      sfxGap('tankBoom', 200);
      break;
    case 'note':
      hudNote(ev.text);
      break;
    case 'shop':
      openShop();
      break;
    case 'fountain':
      sfx('tankHeal');
      toast('샘물을 마셨어요. 체력·혼력이 가득 찼어요');
      break;
    case 'skill':
      sfx(ev.kind === 'rat' ? 'boost' : 'tankBoom', { volume: 0.6 });
      break;
    case 'awaken':
      sfx('cutin');
      hudNote(ev.kind === 'rat' ? '질풍! 이동·공격이 빨라졌어요' : '수호 거인이 나타났어요!');
      break;
    case 'boss':
      sfx('survBossWarn');
      if (ev.phase === 1) bossCutin(s);
      else hudNote('골렘이 화났다! 더 빨라졌어요');
      break;
    case 'bossDown':
      sfx('survBossDown');
      hudNote(`${s.boss?.def.name ?? '보스'}를 쓰러뜨렸다!`, 2500);
      break;
    case 'item':
      sfx('tankHeal', { volume: 0.7 });
      break;
    case 'revive':
      sfx('newRecord');
      toast('부활 부적이 타올랐어요! 다시 일어섰어요', 2400);
      break;
    case 'status':
      hudNote(ev.kind === 'poison' ? '독에 걸렸어요 (정화 부적으로 풀 수 있어요)' : '몸이 느려졌어요 (정화 부적으로 풀 수 있어요)');
      break;
    case 'clear':
      onClear(s);
      break;
    case 'dead':
      onDead(s);
      break;
  }
}

function orbCutin(id: string, gain: 'new' | 'awaken' | 'shard') {
  const o = orbDef(id);
  if (!o || !cur) return;
  setPaused(true);
  const ov = overlay(`
    <div class="card pop orb-pop">
      <div class="orb-big">${orbIcon(id)}</div>
      <h3>${gain === 'new' ? `${o.name}을 얻었어요!` : gain === 'awaken' ? `${o.name}이 각성했어요!` : '구슬 조각 +1'}</h3>
      ${gain === 'new' ? `<p><b>${o.basic.name}</b> <span class="key">K</span> 🔮<br><span class="soft">${esc(o.basic.desc)}</span></p>` : ''}
      ${gain === 'awaken' ? `<p><b>${o.awaken.name}</b> <span class="key">L</span> ✨<br><span class="soft">${esc(o.awaken.desc)} · ${esc(o.limit)}</span></p>` : ''}
      ${gain === 'shard' ? '<p class="soft">이미 각성한 구슬이라 조각으로 바뀌었어요</p>' : ''}
      ${cur.run.data.equipped === id && gain === 'new' ? '<p class="soft">바로 장착했어요. 메뉴에서 언제든 바꿀 수 있어요</p>' : ''}
      <button class="btn primary" data-close>좋아요</button>
    </div>`);
  ov.querySelector('[data-close]')!.addEventListener('click', () => {
    ov.remove();
    setPaused(false);
  });
}

function bossCutin(s: RunState) {
  const b = s.boss;
  if (!b) return;
  const el = document.createElement('div');
  el.className = 'cutin';
  el.innerHTML = `<b>${esc(b.def.name)}</b><small>Lv ${b.level}</small>`;
  $('.play')?.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------- HUD ----------
const hudCache = new Map<string, string>();
const hudSet = (key: string, v: string, apply: (v: string) => void) => {
  if (hudCache.get(key) === v) return;
  hudCache.set(key, v);
  apply(v);
};
function drawHud(s: RunState) {
  if (!cur) return;
  const p = s.p;
  const d = s.data;
  const pct = (a: number, b: number) => `${Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1)}%`;
  hudSet('floor', String(s.map.floor), (v) => ($('.floor-pill').textContent = `${v}층`));
  hudSet('coins', String(d.coins), (v) => ($('.coin-pill').innerHTML = `<b>${coinFmt(Number(v))}</b>냥`));
  hudSet('lv', String(d.level), (v) => ($('.lv-b').textContent = `Lv ${v}`));
  hudSet('hp', `${Math.ceil(p.hp)}/${maxHp(s)}`, (v) => {
    $('.gauge.hp i').style.width = pct(p.hp, maxHp(s));
    $('.gauge.hp em').textContent = v;
  });
  hudSet('mp', `${Math.floor(p.mp)}/${maxMp(s)}`, (v) => {
    $('.gauge.mp i').style.width = pct(p.mp, maxMp(s));
    $('.gauge.mp em').textContent = v;
  });
  hudSet('exp', pct(d.exp, expNeed(d.level)), (v) => ($('.gauge.exp i').style.width = v));
  const orb = equippedOrb(s);
  hudSet('orb', `${d.equipped}:${canAwaken(s)}`, () => {
    $('.orb-slot span').innerHTML = orb ? orbIcon(orb.id) : '';
    $('.orb-slot').classList.toggle('empty', !orb);
    $('.orb-slot').classList.toggle('awake', canAwaken(s));
  });
  const cd = orb ? Math.min(1, p.skillCd / orb.basic.cd) : 0;
  hudSet('orbcd', cd.toFixed(2), (v) => ($('.orb-slot .cd').style.height = `${Number(v) * 100}%`));
  const st = [p.poison > 0 ? '☠️ 독' : '', p.slow > 0 ? '🐌 둔화' : '', p.gale > 0 ? `💨 질풍 ${Math.ceil(p.gale)}` : '', p.giant ? `🛡️ 거인 ${Math.ceil(p.giant.t)}` : ''].filter(Boolean).join(' ');
  hudSet('status', st, (v) => ($('.hud-status').textContent = v));
  // 보스 체력
  const b = s.boss && s.boss.alive && s.boss.active ? s.boss : null;
  hudSet('boss', b ? `${b.def.name}:${Math.ceil(b.hp)}` : '', () => {
    const bar = $('.boss-bar');
    bar.classList.toggle('hidden', !b);
    if (b) {
      $('.boss-bar b').textContent = `${b.def.name} Lv ${b.level}`;
      $('.boss-bar i').style.width = pct(b.hp, b.max);
    }
  });
  // 조작 버튼
  const it = interactTarget(s);
  cur.controls.update({
    skillIcon: orb ? orb.icon : '🔮',
    skillOn: !!orb && orb.implemented,
    skillCd: p.skillCd,
    skillMp: !!orb && p.mp >= orb.basic.mp,
    awakenOn: canAwaken(s),
    awakenCd: p.awakenCd,
    awakenMp: !!orb && p.mp >= orb.awaken.mp,
    interact: it ? interactLabel(it) : null,
    potions: d.items.potionS + d.items.potionL,
  });
  drawMini(s);
}

/** 미니맵: 들어간 방 · 지금 방 · 계단 (지도 두루마리를 쓴 층은 모든 방과 보물방) */
function drawMini(s: RunState) {
  const mapped = !!(s.map as { mapped?: boolean }).mapped;
  const key = `${s.room}:${[...s.visited].join(',')}:${s.locked.size}:${s.stairsShown}`;
  if (cur!.miniKey === key) return;
  cur!.miniKey = key;
  const cv = document.getElementById('mini') as HTMLCanvasElement | null;
  if (!cv) return;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  const cols = Math.max(...s.map.rooms.map((r) => r.cx)) + 1;
  const rows = Math.max(...s.map.rooms.map((r) => r.cy)) + 1;
  const cw = Math.min(18, Math.floor((cv.width - 6) / cols));
  const ch = Math.min(14, Math.floor((cv.height - 6) / rows));
  const ox = Math.floor((cv.width - cw * cols) / 2);
  const oy = Math.floor((cv.height - ch * rows) / 2);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const near = new Set<number>();
  for (const r of s.map.rooms) if (s.visited.has(r.id)) for (const o of s.map.rooms) if (Math.abs(o.cx - r.cx) + Math.abs(o.cy - r.cy) === 1 && r.doors.some((dd) => o.doors.some((od) => Math.abs(od.x - dd.x) + Math.abs(od.y - dd.y) === 1))) near.add(o.id);
  for (const r of s.map.rooms) {
    const seen = s.visited.has(r.id);
    if (!seen && !mapped && !near.has(r.id)) continue;
    const x = ox + r.cx * cw;
    const y = oy + r.cy * ch;
    g.fillStyle = hex(COLOR.outline);
    g.fillRect(x, y, cw - 1, ch - 1);
    g.fillStyle = hex(r.id === s.room ? COLOR.primary : seen ? COLOR.panel : COLOR.emptyLine);
    g.fillRect(x + 1, y + 1, cw - 3, ch - 3);
    const mark = r.kind === 'stairs' || (r.kind === 'boss' && s.stairsShown) ? '▲' : mapped && (r.kind === 'treasure' || r.kind === 'puzzle') ? '◆' : r.kind === 'shop' ? '$' : '';
    if (mark && (seen || mapped)) {
      g.fillStyle = hex(r.kind === 'stairs' || r.kind === 'boss' ? COLOR.teamA : COLOR.pink);
      g.font = `${Math.max(7, ch - 5)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(mark, x + cw / 2 - 0.5, y + ch / 2);
    }
  }
}

// ---------- 저장 ----------
async function saveNow(data: TowerData, cleared: number | null = null) {
  try {
    const r = await ctx.api.save(data, cleared);
    if (!r) {
      toast('저장하지 못했어요. 연결되면 다시 보낼게요', 2400);
      return null;
    }
    ctx.siaCoins = r.siaCoins || ctx.siaCoins;
    if (r.gotCoin) toast('🪙 시아코인 +1 (처음 오른 층)', 2200);
    return r;
  } catch (e) {
    toast(e instanceof ApiError ? '저장이 거절됐어요' : '저장하지 못했어요', 2400);
    return null;
  }
}
/** 메뉴·상점에서 바꾼 것 저장 (층 안의 진행도 함께 — 층 번호는 그대로) */
function saveRunData() {
  if (!cur) return;
  ctx.data = clone(cur.run.data);
  void saveNow(ctx.data);
}

function onClear(s: RunState) {
  if (!cur || cur.ended) return;
  cur.ended = true;
  const floor = s.map.floor;
  const data = clone(s.data);
  clearFloor(data, floor);
  ctx.data = data;
  sfx('goal');
  const saving = saveNow(data, floor);
  if (floor >= LAST_READY) return void mvpEnd(floor, saving);
  const el = document.createElement('div');
  el.className = 'floor-clear';
  el.innerHTML = `<b>${floor}층 돌파!</b><small>계단을 올라요…</small>`;
  $('.play')?.appendChild(el);
  setPaused(true);
  setTimeout(() => {
    el.remove();
    if (cur) startFloor();
  }, 1300);
}

async function mvpEnd(floor: number, saving: Promise<unknown>) {
  setPaused(true);
  const ov = overlay(`
    <div class="card pop result win">
      <h2>${floor}층 돌파!</h2>
      <p class="center">${floor === 10 ? '문지기 골렘을 쓰러뜨렸어요!' : '보스를 쓰러뜨렸어요!'}</p>
      <div class="rows">
        <div><span>체크포인트 저장</span><b>${ctx.data.checkpoint}층</b></div>
        <div><span>레벨</span><b>Lv ${ctx.data.level}</b></div>
        <div><span>엽전</span><b class="coin">${coinFmt(ctx.data.coins)}냥</b></div>
        <div><span>구슬 조각</span><b>${ctx.data.shards}</b></div>
      </div>
      <p class="soft center save-line">저장하는 중…</p>
      <div class="loot-big"><b>🏯 ${ctx.data.checkpoint}층부터는 아직 준비 중이에요</b><small>다음 구역이 열리면 체크포인트에서 이어서 올라요</small></div>
      <button class="btn primary big" data-close>처음 화면으로</button>
    </div>`);
  ov.querySelector('[data-close]')!.addEventListener('click', () => {
    ov.remove();
    leavePlay(title);
  });
  const r = await saving;
  const line = ov.querySelector('.save-line');
  if (line) line.textContent = r ? '체크포인트를 저장했어요. 다른 기기에서도 이어서 할 수 있어요' : '저장하지 못했어요. 연결되면 다시 보낼게요';
}

function onDead(s: RunState) {
  if (!cur || cur.ended) return;
  cur.ended = true;
  sfx('lose');
  const data = clone(s.data);
  const floor = s.map.floor;
  die(data);
  ctx.data = data;
  void saveNow(data);
  setTimeout(() => {
    if (!cur) return;
    setPaused(true);
    const ov = overlay(`
      <div class="card pop result lose">
        <h2>쓰러졌어요…</h2>
        <p class="center">${floor}층에서 쓰러졌어요. 레벨·엽전·구슬은 그대로예요.</p>
        <div class="rows">
          <div><span>다시 시작</span><b>${data.checkpoint}층 (체크포인트)</b></div>
          <div><span>레벨</span><b>Lv ${data.level}</b></div>
          <div><span>엽전</span><b class="coin">${coinFmt(data.coins)}냥</b></div>
        </div>
        <p class="soft center">이미 깬 층은 경험치가 절반이에요</p>
        <div class="btns">
          <button class="btn primary big" id="again">${data.checkpoint}층부터 다시 ▶</button>
          <button class="btn" id="home">처음 화면</button>
        </div>
      </div>`);
    ov.querySelector('#again')!.addEventListener('click', () => {
      ov.remove();
      startFloor();
    });
    ov.querySelector('#home')!.addEventListener('click', () => {
      ov.remove();
      leavePlay(title);
    });
  }, 900);
}

// ---------- 메뉴 ----------
type Tab = 'orb' | 'bag' | 'stat' | 'set';
let menuTab: Tab = 'orb';
let menuOrb: string | null = null;
function openMenu() {
  if (!cur || cur.paused || cur.ended) return;
  setPaused(true);
  cur.dirty = false;
  const ov = overlay('<div class="card pop menu"></div>');
  const box = ov.querySelector<HTMLElement>('.menu')!;
  const close = () => {
    ov.remove();
    if (cur?.dirty) saveRunData();
    setPaused(false);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.code === 'Escape' || ev.code === 'KeyI') {
      ev.preventDefault();
      // 같은 키가 조작(controls 의 메뉴 키)까지 가서 닫자마자 다시 열리지 않게
      ev.stopImmediatePropagation();
      window.removeEventListener('keydown', onKey, true);
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) {
      window.removeEventListener('keydown', onKey, true);
      close();
    }
  });
  const render = () => {
    if (!cur) return;
    const s = cur.run;
    const d = s.data;
    const tabs: [Tab, string][] = [
      ['orb', '🔮 구슬'],
      ['bag', '🎒 소지품'],
      ['stat', '📜 능력치'],
      ['set', '⚙️ 설정'],
    ];
    let body = '';
    if (menuTab === 'orb') {
      const sel = orbDef(menuOrb ?? d.equipped ?? 'rat')!;
      const have = !!d.orbs[sel.id];
      const awake = d.awakened.includes(sel.id);
      body = `
        <div class="orb-grid">${ORBS.map((o) => `<button class="orb-cell ${d.orbs[o.id] ? 'have' : ''} ${o.id === sel.id ? 'on' : ''} ${d.equipped === o.id ? 'eq' : ''} ${o.legend ? 'legend' : ''}" data-orb="${o.id}">${d.orbs[o.id] ? orbIcon(o.id) : '❔'}<small>${d.orbs[o.id] ? o.name.replace(' 구슬', '') : `${o.floor}층`}</small>${d.awakened.includes(o.id) ? '<em>각성</em>' : ''}</button>`).join('')}</div>
        <div class="orb-info">
          <h4>${have ? orbIcon(sel.id) : '❔'} ${have ? sel.name : '아직 모르는 구슬'} <small>${sel.element}${sel.legend ? ' · 전설' : ''}</small></h4>
          ${have || sel.implemented ? `<p><b>${sel.basic.name}</b> <small>혼력 ${sel.basic.mp}</small><br><span class="soft">${esc(sel.basic.desc)}</span></p>
          <p><b>각성 · ${sel.awaken.name}</b> <small>혼력 ${sel.awaken.mp} · 재사용 ${sel.awaken.cd}초</small><br><span class="soft">${esc(sel.awaken.desc)} · 제약: ${esc(sel.limit)}</span></p>` : `<p class="soft">${sel.floor}층 근처에서 얻을 수 있어요</p>`}
          ${have && !sel.implemented ? '<p class="warn">이 구슬의 힘은 아직 준비 중이에요</p>' : ''}
          <div class="row2">
            ${have ? (d.equipped === sel.id ? '<button class="btn small" id="unequip">빼기</button>' : '<button class="btn small primary" id="equip">장착하기</button>') : '<span></span>'}
            ${have && !awake ? `<button class="btn small" id="awaken" ${d.shards < SHARDS_TO_AWAKEN ? 'disabled' : ''}>각성 <small>조각 ${d.shards}/${SHARDS_TO_AWAKEN}</small></button>` : have ? '<span class="tag">각성함</span>' : ''}
          </div>
        </div>`;
    } else if (menuTab === 'bag') {
      const use: ItemId[] = ['potionS', 'potionL', 'mana', 'cleanse', 'map'];
      body = `
        ${use.map((id) => {
          const it = itemDef(id)!;
          return `<div class="shop-row"><span class="ic">${it.icon}</span><span>${it.name} <b class="cnt">×${d.items[id as keyof typeof d.items]}</b><small>${esc(it.desc)}</small></span><button class="btn small" data-use="${id}" ${d.items[id as keyof typeof d.items] > 0 ? '' : 'disabled'}>쓰기</button></div>`;
        }).join('')}
        <div class="shop-row"><span class="ic">${itemDef('revive')!.icon}</span><span>${itemDef('revive')!.name} <b class="cnt">×${d.items.revive}</b><small>쓰러지면 저절로 타올라요</small></span></div>
        <div class="shop-row"><span class="ic">🔹</span><span>구슬 조각 <b class="cnt">×${d.shards}</b><small>${SHARDS_TO_AWAKEN}개로 장착한 구슬을 각성 (구슬 탭)</small></span></div>`;
    } else if (menuTab === 'stat') {
      const st = statsAt(d.level);
      body = `
        <div class="rows">
          <div><span>레벨</span><b>Lv ${d.level}</b></div>
          <div><span>경험치</span><b>${d.exp} / ${expNeed(d.level)}</b></div>
          <div><span>체력</span><b>${Math.ceil(s.p.hp)} / ${st.hp}</b></div>
          <div><span>공격력</span><b>${st.atk}</b></div>
          <div><span>방어력</span><b>${st.def}</b></div>
          <div><span>혼력</span><b>${Math.floor(s.p.mp)} / ${st.mp}</b></div>
          <div><span>엽전</span><b class="coin">${coinFmt(d.coins)}냥</b></div>
          <div><span>최고 층 · 체크포인트</span><b>${d.best}층 · ${d.checkpoint}층</b></div>
          <div><span>쓰러진 횟수</span><b>${d.deaths}</b></div>
        </div>
        <p class="soft">레벨이 오를 때마다 체력 +25 · 공격력 +3 · 방어력 +2 · 혼력 +2</p>`;
    } else {
      body = `
        <div class="btns">
          <button class="btn" id="look">👕 외형 바꾸기 <small>시아코인 ${ctx.lookPrice}</small></button>
          <button class="btn" id="rank">🏆 랭킹</button>
          <button class="btn" id="sound">${ctx.sound?.isMuted() ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}</button>
          <button class="btn" id="help">❓ 조작법</button>
          <button class="btn" id="exit">🌏 SIA WORLD로 나가기</button>
        </div>
        <p class="soft center">층 안에서 나가면 이 층은 다음에 처음부터예요 (구슬·소지품 바꾼 것은 저장돼요)</p>`;
    }
    box.innerHTML = `
      <div class="menu-head"><h3>${s.map.floor}층 · 메뉴</h3><button class="icon-btn" id="close" aria-label="닫기">✕</button></div>
      <div class="tabs4">${tabs.map(([k, n]) => `<button class="btn small ${k === menuTab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      <div class="menu-body">${body}</div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      sfx('click');
      menuTab = b.dataset.tab as Tab;
      render();
    }));
    $('#close', box).addEventListener('click', () => {
      window.removeEventListener('keydown', onKey, true);
      close();
    });
    box.querySelectorAll<HTMLButtonElement>('[data-orb]').forEach((b) => b.addEventListener('click', () => {
      menuOrb = b.dataset.orb!;
      render();
    }));
    box.querySelector('#equip')?.addEventListener('click', () => {
      const why = equipOrb(d, menuOrb ?? d.equipped);
      if (why) return toast(why);
      sfx('toggle');
      cur!.dirty = true;
      render();
    });
    box.querySelector('#unequip')?.addEventListener('click', () => {
      equipOrb(d, null);
      cur!.dirty = true;
      render();
    });
    box.querySelector('#awaken')?.addEventListener('click', () => {
      const id = menuOrb ?? d.equipped;
      if (!id) return;
      const why = awakenWithShards(d, id);
      if (why) return toast(why);
      sfx('twelveRare');
      toast(`${orbDef(id)!.name} 각성! (${orbDef(id)!.awaken.name} · L)`);
      cur!.dirty = true;
      render();
    });
    box.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((b) => b.addEventListener('click', () => {
      const why = useItem(s, b.dataset.use as ItemId);
      if (why) return toast(why);
      sfx('tankHeal');
      if (b.dataset.use === 'map') toast(`${s.map.floor + 1}층의 방 배치가 밝혀졌어요`);
      cur!.dirty = true;
      render();
    }));
    box.querySelector('#look')?.addEventListener('click', () => {
      openCreator({
        first: false,
        inGame: true,
        onDone: async () => {
          if (cur && ctx.look) {
            const layers = await lookLayers(ctx.look);
            cur.art.layers = layers;
            cur.scene?.setLayers(layers);
          }
          render();
        },
      });
    });
    box.querySelector('#rank')?.addEventListener('click', () => openRanking());
    box.querySelector('#sound')?.addEventListener('click', () => {
      if (!ctx.sound) return;
      ctx.sound.setMuted(!ctx.sound.isMuted());
      render();
    });
    box.querySelector('#help')?.addEventListener('click', () => helpBox());
    box.querySelector('#exit')?.addEventListener('click', () => {
      window.removeEventListener('keydown', onKey, true);
      const dirty = cur?.dirty;
      ov.remove();
      if (dirty && cur) {
        // 메뉴에서 바꾼 것만 남긴다: 저장한 뒤 나간다
        ctx.data = clone(cur.run.data);
        void saveNow(ctx.data).finally(() => (location.href = worldHome()));
      } else location.href = worldHome();
      leavePlay(() => app().innerHTML = '<div class="screen"><div class="connecting"><div class="spinner"></div><p>SIA WORLD로 가는 중…</p></div></div>');
    });
  };
  render();
}

// ---------- 상점 ----------
function openShop() {
  if (!cur) return;
  setPaused(true);
  let bought = false;
  const ov = overlay('<div class="card pop shop"></div>');
  const box = ov.querySelector<HTMLElement>('.shop')!;
  const close = () => {
    ov.remove();
    if (bought) saveRunData();
    setPaused(false);
  };
  const render = () => {
    const s = cur!.run;
    const d = s.data;
    const f = s.map.floor;
    box.innerHTML = `
      <div class="menu-head"><h3>🏮 휴식층 상점</h3><span class="coins-pill"><b>${coinFmt(d.coins)}</b>냥</span></div>
      <div class="shop-keeper"><canvas width="64" height="64"></canvas><p>어서 오시게. 탑을 오르려면 준비가 필요하지.</p></div>
      ${ITEMS.map((it) => {
        const price = priceOf(it.id, f);
        const owned = it.id === 'shard' ? d.shards : d.items[it.id as keyof typeof d.items];
        const limit = it.id === 'shard' && d.shopShard.includes(f) ? '이 층에서는 다 샀어요' : it.id === 'revive' && d.items.revive >= (it.max ?? 1) ? '1개만 지닐 수 있어요' : '';
        return `<div class="shop-row ${limit ? 'low' : ''}"><span class="ic">${it.icon}</span><span>${it.name} <b class="cnt">×${owned}</b><small>${limit || esc(it.desc)}</small></span><button class="btn small" data-buy="${it.id}" ${limit || d.coins < price ? 'disabled' : ''}><b class="price">${price}</b>냥</button></div>`;
      }).join('')}
      <button class="btn primary" id="bye">나가기</button>`;
    const kc = box.querySelector('canvas')!;
    void stillImage(kc, { sex: 'm', hair: 2, face: 1, outfit: 2 }, 2);
    box.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const why = buy(d, b.dataset.buy as ItemId, f);
      if (why) return toast(why);
      sfx('coin');
      bought = true;
      render();
    }));
    $('#bye', box).addEventListener('click', close);
  };
  render();
}

