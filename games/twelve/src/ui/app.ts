import Phaser from 'phaser';
import { artUrl, heroFaceUrl, heroFullUrl } from '../assets';
import { skillLevelMul } from '../data/balance';
import { BOSSES, FINAL_BOSS } from '../data/bosses';
import { BAG, MAX_PLUS, POTION, POTION_NAME, bagPrice, enhanceCost, regionTier } from '../data/economy';
import { expNeed, playerStats } from '../data/growth';
import { HEROES, STAT_KEYS, STAT_NAME, heroOf, isHero, type HeroId } from '../data/heroes';
import { ACC_TEXT, FX_DESC, FX_NAME, ITEMS, SLOTS, SLOT_NAME, canEnhance, itemDef, itemLevel, itemNote, itemStats, normalWeapon, regionRares, type Item, type Slot } from '../data/items';
import { FINAL, MAPS, bossIdOf, mapOf, mapPar, mapsOf, nextMap, type MapDef } from '../data/maps';
import { ENV_ICON, ENV_NAME, MAPS_PER_REGION, MODE_NAME, REGIONS, REGION_TABLE, mapLevel, regionOf, type Mode } from '../data/regions';
import { TOWER, floorKind, floorMinTime, towerFloor, towerRegion } from '../data/tower';
import { TIER_LEVELS, WEAPONS, WEAPON_KINDS } from '../data/weapons';
import {
  applyReport,
  bagCount,
  boxItems,
  continueMap,
  dropCtx,
  emptyProfile,
  equipped,
  exitNeed,
  finalOpen,
  hardDone,
  hasKey,
  cleared,
  heroesOf,
  iGa,
  isEquipped,
  itemOf,
  joinText,
  keyCount,
  loadoutOf,
  normalDone,
  mapOpen,
  recommended,
  regionOpen,
  regionReady,
  regionStarCount,
  starsOfMap,
  weaponOf,
  whyText,
  type FinishResult,
  type RunReport,
  type TwelveProfile,
} from '../game/progress';
import { forSale, scrapOf, shopTier } from '../game/rules';
import { STAR_CHEST, STAR_NO_DEATH, STAR_TIME, createRun, type RunState } from '../game/sim';
import { applyTowerFloor, beginTower, startFloors, type TowerFloorResult, type TowerRun } from '../game/tower';
import { ApiError, buyLocalCat, localCatOwned, type TwelveApi } from '../net/api';
import { DEV_ALL, DEV_MODE, DEV_GOD, DEV_HERO, DEV_LEVEL, DEV_MAP, DEV_WEAPON, LOCAL_MODE } from '../net/local';
import { buyCharacter, loadCharacterProgress, loadOwnedCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, W, dropIcon, dropName, viewHeight } from '../scenes/GameScene';
import { groundOf, hasArt } from '../scenes/art';
import { COLOR, css } from '../theme';
import { createControls, type Controls } from './controls';
import { IC, icon, itemIcon } from './icons';

/**
 * 메인 → 십이지 지도 → 지형(쉼터 + 맵 8개) → 맵(전투) → 결과 (PRD '화면 구성').
 * 기록은 net/api.ts 로만 바뀐다 (지금은 기기 저장, 5단계에서 서버).
 */

let api!: TwelveApi;
let profile: TwelveProfile = emptyProfile();
/** 로그인한 사람 (테스트 모드는 null) */
let me: WorldUser | null = null;
/** 고양이를 이 게임에서 샀는지 (shared/characters.js — 게임마다 따로 산다). 테스트 모드에서는 이 기기에 적어 둔 흉내 구매 */
let cat = false;
/** 지금 고를 수 있는 대원 */
const myHeroes = () => heroesOf(profile, cat);
/** 개발 옵션(?map= · lv= · god= · all= · hero= · weapon= · mode=)으로 하는 판은 기록하지 않는다 */
const DEV_PLAY = DEV_ALL || DEV_MODE || DEV_GOD || DEV_LEVEL > 0 || !!DEV_HERO || !!DEV_WEAPON || !!DEV_MAP;

let sound: SoundModule | null = null;
void loadSound()
  .then((m) => (sound = m))
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);

// ---------- 설정 (기기마다) ----------

interface Settings {
  vibrate: boolean;
  lefty: boolean;
  numbers: boolean;
}
const SETTINGS_KEY = 'siatwelve:settings';
const RUN_KEY = 'siatwelve:inrun';
const INTRO_KEY = 'siatwelve:intro';
/** 고양이 등장 장면을 봤는지 (기기마다 한 번. 대원 화면에서는 언제든 열 수 있다) */
const CAT_KEY = 'siatwelve:cat-scene';
const seen = (key: string) => {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return true;
  }
};
const settings: Settings = { vibrate: true, lefty: false, numbers: true };
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    for (const k of ['vibrate', 'lefty', 'numbers'] as const) if (typeof v[k] === 'boolean') settings[k] = v[k];
  } catch {
    /* 기본값 */
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 이번만 */
  }
}
const mark = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
};

// ---------- 공통 ----------

const app = () => document.getElementById('app')!;

function screen(html: string, bg = ''): HTMLElement {
  closeGame();
  const root = app();
  root.innerHTML = `<div class="screen ${bg}">${html}</div>`;
  fitTitle(root);
  return root.firstElementChild as HTMLElement;
}

/** 윗줄 제목이 자리보다 길면 글자를 줄인다 ('12. 돼지의 염라전 🔥' 처럼 긴 지형 이름이 '…'로 잘리지 않게. 그래도 넘치면 말줄임) */
function fitTitle(root: ParentNode) {
  const h = root.querySelector<HTMLElement>('.bar h2');
  if (!h || !h.clientWidth) return;
  let size = parseFloat(getComputedStyle(h).fontSize) || 0;
  while (size > 16 && h.scrollWidth > h.clientWidth) h.style.fontSize = `${(size -= 1)}px`;
}

export function toast(text: string, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.getElementById('stage')!.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function overlay(html: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = html;
  app().appendChild(box);
  return box;
}

const on = (root: ParentNode, sel: string, fn: (el: HTMLElement) => void) =>
  root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
    el.addEventListener('click', () => {
      play('click');
      fn(el);
    }),
  );

const errText = (e: unknown) => whyText(e instanceof ApiError ? e.message : '');
const coinsPill = () => `<span class="coins-pill">${IC.coin} ${profile.coins.toLocaleString()}</span>`;
const levelPill = () => `<span class="coins-pill lv-pill">Lv ${profile.level}</span>`;
const STAR_LABEL: [number, string][] = [[STAR_TIME, '시간 안에'], [STAR_NO_DEATH, '안 쓰러지고'], [STAR_CHEST, '숨은 상자']];
const starsText = (bits: number) => STAR_LABEL.map(([b]) => (bits & b ? '★' : '☆')).join('');
const starsHtml = (bits: number) => `<span class="stars">${STAR_LABEL.map(([b]) => `<i class="${bits & b ? 'on' : ''}">★</i>`).join('')}</span>`;
const face = (id: HeroId) => `<img class="face" src="${heroFaceUrl(id)}" alt="${heroOf(id).name}" />`;
/** 맵에서 나와 돌아갈 쉼터 (최종보스맵은 봉인의 문 앞, 그 밖에는 그 지형) */
const restOf = (map: MapDef) => (map.final ? showFinal() : showRegion(map.region));
/** 착용한 장비 이름 (+강화) */
const equipName = (slot: Slot) => {
  const it = equipped(profile, slot);
  const d = it && itemDef(it.base);
  return d ? `${d.name}${it!.plus ? ` +${it!.plus}` : ''}` : `${SLOT_NAME[slot]} 없음`;
};
const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 개발 옵션을 입힌 프로필 (저장되지 않는다) */
function view(p: TwelveProfile): TwelveProfile {
  if (!DEV_PLAY) return p;
  const v: TwelveProfile = { ...p, eq: { ...p.eq }, maps: { normal: { ...p.maps.normal }, hard: { ...p.maps.hard } } };
  if (DEV_LEVEL) v.level = DEV_LEVEL;
  if (DEV_MODE) {
    // 어려움 모드로 본다: 보통 모드를 끝낸 것으로 친다
    v.maps.normal[FINAL.id] ??= { stars: 0, clears: 1, best: 0 };
    v.mode = 'hard';
  }
  if (DEV_ALL) {
    for (const m of MAPS) v.maps[v.mode][m.id] ??= { stars: 0, clears: 1, best: 0 };
    // 최종보스맵도 열린다 (열쇠 12개)
    v.keys = { ...v.keys, [v.mode]: Array.from({ length: REGIONS }, (_, i) => i + 1) };
  }
  if (isHero(DEV_HERO)) v.hero = DEV_HERO;
  // ?weapon=bow: 가방에 있는 그 종류의 무기를 든다 (없으면 나무 칼)
  if ((WEAPON_KINDS as readonly string[]).includes(DEV_WEAPON)) {
    const it = v.items.find((x) => !x.box && itemDef(x.base)?.kind === DEV_WEAPON) ?? v.items.find((x) => x.base === normalWeapon('sword', 0));
    if (it) v.eq.weapon = it.id;
  }
  return v;
}

/**
 * 쉼터·지도에 들어올 때: 못 보낸 판 결과가 남아 있으면 다시 보내고 기록을 새로 읽는다.
 * 서버에 들어간 판이 있으면(이미 받아 둔 판 포함) 그 화면이 아직 떠 있을 때만 새 기록으로 다시 그린다.
 * - 읽는 사이 다른 곳(상점·판 시작 결과 등)이 프로필을 바꿨으면 늦게 온 답은 버린다 (더 새 기록을 덮지 않게)
 * - 창(고양이 등장·구매 확인 등)이 떠 있으면 닫힐 때까지 미루고, 다시 그려도 스크롤 자리는 지킨다
 */
function syncPending(root: HTMLElement, redraw: () => void) {
  if (LOCAL_MODE || !api.pending()) return;
  void api
    .resend()
    .then(async (n) => {
      if (n <= 0) return;
      const before = profile;
      const p = view(await api.loadProfile());
      if (profile !== before) return;
      profile = p;
      if (root.isConnected) redrawKeep(root, redraw);
    })
    .catch(() => {
      /* 통신 실패: 보관한 채로 다음에 다시 */
    });
}

/** 열린 창이 없을 때 다시 그리고, 화면의 스크롤 자리를 되돌린다 */
function redrawKeep(root: HTMLElement, redraw: () => void) {
  const box = app();
  if (box.querySelector('.overlay')) {
    const watch = new MutationObserver(() => {
      if (!root.isConnected) return watch.disconnect();
      if (box.querySelector('.overlay')) return;
      watch.disconnect();
      redrawKeep(root, redraw);
    });
    watch.observe(box, { childList: true });
    return;
  }
  const top = root.scrollTop;
  redraw();
  const next = box.querySelector<HTMLElement>('.screen');
  if (next && top) next.scrollTop = top;
}

/** 처음 한 번: 기록을 불러온다 */
export async function boot(a: TwelveApi, user: WorldUser | null) {
  api = a;
  me = user;
  loadSettings();
  profile = view(await api.loadProfile());
  if (LOCAL_MODE) cat = localCatOwned();
  else {
    cat = !!(await loadOwnedCharacters())?.includes('cat');
    // 지난번에 못 보낸 판 결과가 있으면 다시 보내고 기록을 새로 읽는다
    if ((await api.resend().catch(() => 0)) > 0) profile = view(await api.loadProfile());
  }
  if (!myHeroes().includes(profile.hero) && !DEV_PLAY) profile.hero = myHeroes()[0];
}

/** 처음 화면: 개발용 ?map= 이면 바로 그 맵, 아니면 메인 */
export function showFirst() {
  const m = mapOf(DEV_MAP);
  if (m) return void startMap(m, 0);
  // 처음 온 사람에게는 시작 장면부터 (PRD '이야기'. 건너뛸 수 있고, 설정에서 다시 볼 수 있다)
  if (!seen(INTRO_KEY) && !DEV_PLAY && !Object.keys(profile.maps.normal).length) return showIntro(showMain);
  showMain();
  // 맵 도중에 앱을 닫았다: 중간 저장이 없으므로 쓰러진 것과 같다 (PRD '죽으면')
  let left: string | null = null;
  try {
    left = localStorage.getItem(RUN_KEY);
  } catch {
    /* 무시 */
  }
  if (left && mapOf(left)) {
    mark(RUN_KEY, null);
    toast(`${left} ${mapOf(left)!.name}: 도중에 나가서 그 맵을 다시 시작해요`, 3200);
  }
}

// ---------- 시작 장면 ----------

/** 그림 4장 + 자막. 전용 그림(public/art/story-N.png)이 생기기 전에는 기존 그림을 모아 장면을 만든다 */
const STORY: { bg: string; text: string; art: () => string }[] = [
  {
    bg: 'bg-underworld',
    text: '아주 먼 옛날, 십이지 대원들은 요괴를 열두 지형에 가두고 봉인했어요.',
    art: () => `<div class="story-ring">${HEROES.filter((h) => !h.hidden).map((h, i) => `<img style="--a:${i * 30}deg" src="${heroFaceUrl(h.id)}" alt="" />`).join('')}<span>🔒</span></div>`,
  },
  {
    bg: 'bg-bamboo',
    text: '그런데 어느 밤, 봉인이 풀려 버렸어요. 요괴들이 들판과 고개로 쏟아져 나왔죠.',
    art: () => `<div class="story-row">${['e-imp', 'e-wisp', 'b-bigDokkaebi', 'e-fox', 'e-club'].map((n, i) => `<img class="${i === 2 ? 'big' : ''}" src="${artUrl(n)}" alt="" />`).join('')}</div><span class="story-mark">🔓</span>`,
  },
  {
    bg: 'bg-palace',
    text: '지형마다 우두머리 요괴가 봉인의 열쇠를 하나씩 차지했어요. 열쇠는 모두 열두 개예요.',
    art: () => `<div class="story-row">${['b-bigDokkaebi', 'b-dueoksini', 'b-bulgasal'].map((n) => `<figure><em>🗝️</em><img class="big" src="${artUrl(n)}" alt="" /></figure>`).join('')}</div>`,
  },
  {
    bg: 'bg-field',
    text: '찍찍이·우직이·어흥이가 먼저 길을 나서요. 열쇠를 모아 다시 봉인하러, 열두 길로 출발!',
    art: () => `<div class="story-row">${(['rat', 'ox', 'tiger'] as const).map((id) => `<img class="hero" src="${heroFullUrl(id)}" alt="${heroOf(id).name}" />`).join('')}</div>`,
  },
];

/**
 * 보통 모드 엔딩 (PRD '이야기': 봉인이 다시 흔들리며 어려움 모드로 이어진다). 그림 4장 + 자막, 건너뛰기.
 * 전용 그림(public/art/ending-N.png)이 생기기 전에는 기존 그림을 모아 장면을 만든다
 */
const ENDING: typeof STORY = [
  {
    bg: 'bg-underworld',
    text: '어둑시니가 연기처럼 흩어졌어요. 열두 열쇠가 봉인의 문에 하나씩 꽂혔죠.',
    art: () => `<div class="story-row"><img class="big fade" src="${artUrl(BOSSES[FINAL_BOSS].art)}" alt="" /></div><div class="story-keys">${'🗝️'.repeat(6)}<br/>${'🗝️'.repeat(6)}</div>`,
  },
  {
    bg: 'bg-field',
    text: '문이 닫히고, 열두 지형에 다시 아침이 왔어요. 열두 대원은 서로를 보며 활짝 웃었어요.',
    art: () => `<div class="story-ring">${HEROES.filter((h) => !h.hidden).map((h, i) => `<img style="--a:${i * 30}deg" src="${heroFaceUrl(h.id)}" alt="" />`).join('')}<span>🔒</span></div><span class="story-mark">☀️</span>`,
  },
  {
    bg: 'bg-bamboo',
    text: '그런데… 봉인이 다시 흔들려요. 어둑시니의 마지막 말이 떠올랐어요. “나는 그림자일 뿐이다.”',
    art: () => `<div class="story-ring"><span class="shake">🔒</span></div><span class="story-mark">⚡</span>`,
  },
  {
    bg: 'bg-underworld',
    text: '봉인 아래에서 더 깊은 어둠이 깨어나고 있어요. 더 험해진 열두 길이 대원들을 기다려요 — 어려움 모드가 열렸어요!',
    art: () => `<div class="story-row">${(['b-yeomra', BOSSES[FINAL_BOSS].art, 'b-gangcheori'] as const).map((n, i) => `<img class="${i === 1 ? 'big' : ''} dark" src="${artUrl(n)}" alt="" />`).join('')}</div><span class="story-mark">🔥</span>`,
  },
];

/**
 * 진짜 엔딩 (PRD '이야기': 어려움 모드의 최종보스를 잡으면). 그림 4장 + 자막, 건너뛰기.
 * 전용 그림(public/art/finale-N.png)이 생기기 전에는 기존 그림을 모아 장면을 만든다
 */
const TRUE_ENDING: typeof STORY = [
  {
    bg: 'bg-underworld',
    text: '봉인 아래의 깊은 어둠, 진짜 어둑시니가 마침내 무릎을 꿇었어요. 이번에는 그림자가 아니에요.',
    art: () => `<div class="story-row"><img class="big dark fade" src="${artUrl(BOSSES[FINAL_BOSS].art)}" alt="" /></div><span class="story-mark">✨</span>`,
  },
  {
    bg: 'bg-palace',
    text: '열두 열쇠가 하나로 모여 봉인의 문을 다시 잠갔어요. 이제 다시는 흔들리지 않아요.',
    art: () => `<div class="story-ring"><span>🔒</span></div><div class="story-keys">${'🗝️'.repeat(6)}<br/>${'🗝️'.repeat(6)}</div>`,
  },
  {
    bg: 'bg-bamboo',
    text: '요괴들은 저마다의 자리로 돌아갔어요. 논밭에는 벼가 익고, 고개에는 바람이 불고, 연못에는 달이 떴어요.',
    art: () => `<div class="story-row">${['e-imp', 'e-wisp', 'e-fox', 'e-club'].map((n) => `<img src="${artUrl(n)}" alt="" />`).join('')}</div><span class="story-mark">🌕</span>`,
  },
  {
    bg: 'bg-field',
    text: '열두 길을 두 번 걸은 대원들이 손을 흔들어요. “끝까지 함께해 줘서 고마워요!” — 끝없는 탑은 언제나 열려 있어요.',
    art: () => `<div class="story-ring">${HEROES.filter((h) => !h.hidden).map((h, i) => `<img style="--a:${i * 30}deg" src="${heroFaceUrl(h.id)}" alt="" />`).join('')}<span>👑</span></div><span class="story-mark">🎉</span>`,
  },
];

const showIntro = (done: () => void) => showStory(STORY, 'story', '출발!', () => (mark(INTRO_KEY, '1'), done()));
const showEnding = (done: () => void) => showStory(ENDING, 'ending', '계속 ▶', done);
const showTrueEnding = (done: () => void) => showStory(TRUE_ENDING, 'finale', '끝 ▶', done);

function showStory(scenes: typeof STORY, art: 'story' | 'ending' | 'finale', lastLabel: string, end: () => void) {
  let i = 0;
  const paint = () => {
    const sc = scenes[i];
    const name = `${art}-${i + 1}` as `${typeof art}-1`;
    const root = screen(`
      <div class="bar"><div class="spacer"></div><button class="btn small" id="skip">건너뛰기 ▶▶</button></div>
      <div class="grow"></div>
      <div class="story-art ${sc.bg}">${hasArt(name) ? `<img class="story-img" src="${artUrl(name)}" alt="" />` : sc.art()}</div>
      <div class="card story-text"><p>${sc.text}</p><div class="story-dots">${scenes.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div></div>
      <button class="btn primary big" id="next">${i === scenes.length - 1 ? lastLabel : '다음 ▶'}</button>
      <div class="grow"></div>`);
    on(root, '#skip', end);
    on(root, '#next', () => (++i < scenes.length ? paint() : end()));
  };
  paint();
}

// ---------- 메인 ----------

export function showMain() {
  const hero = heroOf(profile.hero);
  const next = continueMap(profile);
  const nm = next ? mapOf(next) : null;
  const need = expNeed(profile.level);
  const done = normalDone(profile);
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${levelPill()}${coinsPill()}</div></div>
    <div class="title">${hasArt('main') ? `<img class="main-art" src="${artUrl('main')}" alt="" />` : ''}<h1>시아열두길</h1><p>열두 지형의 요괴를 베고 열쇠를 모아라!</p></div>
    <div class="card me">
      ${face(hero.id)}
      <div class="me-info"><b>${hero.name} <small>${hero.animal} · ${icon(WEAPONS[weaponOf(profile)].icon)} ${equipName('weapon')}</small></b>
        <div class="lv"><i style="width:${need ? Math.min(100, (profile.exp / need) * 100) : 100}%"></i></div>
        <span class="soft">Lv ${profile.level}${need ? ` · 경험치 ${profile.exp.toLocaleString()} / ${need.toLocaleString()}` : ' (최고 레벨)'} · ${MODE_NAME[profile.mode]} 모드${cleared(profile, FINAL.id) ? ' 클리어 ✔' : ''}${hardDone(profile) ? ' 👑' : ''}</span></div>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">▶ 이어하기${nm ? ` <small>${nm.final ? '최종보스' : nm.id} ${nm.name}</small>` : ''}</button>
      <button class="btn big" id="world">🗺️ 십이지 지도</button>
      ${done ? (profile.mode === 'hard' ? `<button class="btn big hard" id="hard">🌿 보통 모드로 <small>지금: 어려움 모드${hardDone(profile) ? ' 👑' : ''}</small></button>` : `<button class="btn big hard" id="hard">🔥 어려움 모드 <small>권장 Lv ${mapLevel(1, 1, 'hard')}~${mapLevel(REGIONS, MAPS_PER_REGION, 'hard')}${hardDone(profile) ? ' · 클리어 👑' : ''}</small></button>`) : ''}
      <div class="row2"><button class="btn" id="heroes">🐾 대원${done && !cat ? ' <em class="tag">🐱 새 대원</em>' : ''}</button><button class="btn" id="bag">🎒 가방${boxItems(profile).length ? ` <em class="tag">보관함 ${boxItems(profile).length}</em>` : ''}</button></div>
      <div class="row2"><button class="btn" id="tower">🗼 끝없는 탑${profile.tower?.floor ? ` <small>${profile.tower.floor}층</small>` : ''}</button><button class="btn" id="rank">🏆 랭킹</button></div>
      <button class="btn" id="settings">⚙️ 설정</button>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? `<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요${DEV_PLAY ? ' (개발 옵션으로 하는 판은 저장하지 않아요)' : ''}</p>` : ''}`);
  on(root, '#go', () => (nm ? restOf(nm) : showWorld()));
  // 어려움 모드: 보통 모드를 끝내면 버튼이 나타난다. 보통 ↔ 어려움을 오갈 수 있다
  on(root, '#hard', () => askMode(profile.mode === 'hard' ? 'normal' : 'hard'));
  on(root, '#world', showWorld);
  on(root, '#heroes', () => showHeroes(showMain));
  on(root, '#bag', () => showBag(showMain));
  on(root, '#settings', showSettings);
  on(root, '#tower', showTower);
  on(root, '#rank', async () => {
    if (LOCAL_MODE || !me) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(me.userId))) toast('랭킹을 불러오지 못했어요');
  });
}

/** 모드 바꾸기 확인 창 (PRD '전체 구조': 레벨·장비는 그대로, 맵 진행·열쇠·별은 모드마다 따로) */
function askMode(to: Mode) {
  const hard = to === 'hard';
  const box = overlay(`<div class="card pop">
    <h3>${hard ? '🔥 어려움 모드' : '🌿 보통 모드'}로 갈까요?</h3>
    ${
      hard
        ? `<p class="soft">같은 열두 길을 다시 걸어요. 요괴가 더 세고 많아지고, 보스마다 공격이 하나씩 늘어요.</p>
    <div class="rows"><div><span>권장 레벨</span><b>Lv ${mapLevel(1, 1, 'hard')} ~ ${mapLevel(REGIONS, MAPS_PER_REGION, 'hard')}</b></div><div><span>장비</span><b>Lv ${TIER_LEVELS[regionTier(1, 'hard')]}~${TIER_LEVELS[regionTier(REGIONS, 'hard')]} · 어려움 전용 레어</b></div><div><span>모은 열쇠</span><b>${IC.key} ${keyCount(profile, 'hard')} / ${REGIONS}${hardDone(profile) ? ' · 클리어 👑' : ''}</b></div></div>
    <p class="soft center">레벨·장비·엽전은 그대로 이어가요. 맵 진행·열쇠·별은 어려움 모드에서 따로 모아요.</p>`
        : `<p class="soft center">보통 모드의 맵 진행·열쇠·별로 돌아가요. 레벨·장비는 그대로예요. 어려움 모드의 진행은 남아 있어요.</p>`
    }
    <button class="btn primary big" id="yes">${hard ? '어려움 모드로 ▶' : '보통 모드로 ▶'}</button>
    <button class="btn" id="no">취소</button></div>`);
  on(box, '#no', () => box.remove());
  on(box, '#yes', async () => {
    if (busy) return;
    if (DEV_PLAY) {
      box.remove();
      return toast('개발 옵션으로 볼 때는 모드를 바꿀 수 없어요 (&mode=hard 를 쓰세요)', 3000);
    }
    busy = true;
    try {
      profile = view(await api.setMode(to));
      box.remove();
      toast(hard ? '어려움 모드예요. 더 험해진 열두 길이 기다려요' : '보통 모드로 돌아왔어요', 2500);
      showMain();
    } catch (e) {
      box.remove();
      toast(errText(e), 2500);
    } finally {
      busy = false;
    }
  });
}

function showSettings() {
  const row = (k: string, name: string, value: boolean) => `<label class="set-row"><span>${name}</span><button class="btn small toggle ${value ? 'on' : ''}" data-k="${k}">${value ? '켬' : '끔'}</button></label>`;
  const box = overlay(`<div class="card pop">
    <h3>설정</h3>
    ${row('sound', '소리', !(sound?.isMuted() ?? false))}
    ${row('vibrate', '진동', settings.vibrate)}
    ${row('lefty', '왼손잡이 (조이스틱과 버튼 좌우 바꾸기)', settings.lefty)}
    ${row('numbers', '피해 숫자', settings.numbers)}
    <button class="btn" id="story">📖 이야기 다시 보기</button>
    ${normalDone(profile) ? '<button class="btn" id="ending">🎬 엔딩 다시 보기</button>' : ''}
    ${hardDone(profile) ? '<button class="btn" id="finale">👑 진짜 엔딩 다시 보기</button>' : ''}
    <button class="btn primary" id="ok">닫기</button></div>`);
  on(box, '#story', () => showIntro(showMain));
  on(box, '#ending', () => showEnding(showMain));
  on(box, '#finale', () => showTrueEnding(showMain));
  on(box, '.toggle', (el) => {
    const k = el.dataset.k!;
    let v: boolean;
    if (k === 'sound') {
      v = sound?.isMuted() ?? false;
      sound?.setMuted(!v);
    } else {
      v = settings[k as keyof Settings] = !settings[k as keyof Settings];
      saveSettings();
    }
    el.classList.toggle('on', v);
    el.textContent = v ? '켬' : '끔';
  });
  on(box, '#ok', () => box.remove());
}

// ---------- 대원 · 무기 ----------

function showHeroes(back: () => void, region = 0) {
  const mine = myHeroes();
  const rec = region ? recommended(region) : [];
  // 고양이: 보통 모드를 끝낸 뒤에만 보인다 (그 전에는 숨김). 시아코인 100개로 이 게임에서 따로 산다
  const catShown = (h: { hidden?: boolean }) => !h.hidden || cat || normalDone(profile);
  let pick: HeroId = profile.hero;
  const weapon = weaponOf(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>대원</h2><div class="pills">${levelPill()}</div></div>
    <div class="card"><div class="heroes">${HEROES.filter(catShown)
      .map((h) => {
        const ok = mine.includes(h.id);
        return `<button class="hero-btn ${ok ? '' : 'locked'}" data-id="${h.id}">${face(h.id)}<b>${h.name}</b>${ok ? (rec.includes(h.id) ? '<em class="tag">추천</em>' : '') : `<em>🔒 ${h.hidden ? `시아코인 ${h.price}` : `${h.join}지형`}</em>`}</button>`;
      })
      .join('')}</div></div>
    <div class="card" id="detail"></div>
    <div class="card"><h3>${icon(WEAPONS[weapon].icon)} ${equipName('weapon')} <small>무기는 가방에서 바꿔요</small></h3><div id="wdetail"></div></div>
    <button class="btn primary big" id="save">이 대원으로</button>`);
  const paint = () => {
    const h = heroOf(pick);
    const ok = mine.includes(pick);
    const st = playerStats(loadoutOf(profile, pick), region);
    root.querySelectorAll<HTMLElement>('.hero-btn').forEach((b) => b.classList.toggle('on', b.dataset.id === pick));
    root.querySelector('#detail')!.innerHTML = `
      <h3>${h.name} <small>${h.animal} · 고향 ${h.home ? `${h.home}지형 ${regionOf(h.home).name}` : '없음'} · 잘 다루는 무기 ${icon(WEAPONS[h.weapon].icon)}${WEAPONS[h.weapon].name}</small></h3>
      <div class="stat-grid">${STAT_KEYS.map((k) => `<div class="stat"><span>${STAT_NAME[k]}</span><div class="lv"><i style="width:${Math.round(((h.stats[k] - 0.9) / 0.2) * 100)}%"></i></div><b>${k === 'crit' ? `${Math.round(st.crit * 100)}%` : Math.round(st[k])}</b></div>`).join('')}</div>
      ${profile.level >= 10 ? `<p class="soft">⭐ 스킬 강화 ${Math.floor(profile.level / 10)}단계: 스킬 피해 +${Math.round((skillLevelMul(profile.level) - 1) * 100)}% (10레벨마다 한 단계)</p>` : '<p class="soft">⭐ 10레벨마다 스킬이 한 단계 강해져요</p>'}
      <p class="skill-line"><span class="key">U</span> <b>${icon(h.unique.icon)} ${h.unique.name}</b> ${h.unique.desc} <small>마력 ${h.unique.mp} · ${h.unique.cd}초</small></p>
      ${st.home ? '<p class="soft">🏠 고향 지형: 공격·방어 +10%</p>' : ''}${region && regionOf(region).env !== 'none' && regionOf(region).counter === pick ? `<p class="soft">${ENV_ICON[regionOf(region).env]} 이 지형의 ${ENV_NAME[regionOf(region).env]}에 걸리지 않아요</p>` : ''}${st.affinity ? '<p class="soft">✨ 잘 다루는 무기: 공격 +5%</p>' : ''}
      ${ok ? '' : h.hidden ? `<p class="soft">🐱 경주에 늦어 빠진 13번째 대원이에요. 이 게임에서 따로 열어요</p><button class="btn primary" id="buycat">시아코인 ${h.price}개로 열기</button>` : `<p class="soft">🔒 ${h.join}지형 보스를 처음 잡으면 합류해요</p>`}`;
    root.querySelector('#buycat')?.addEventListener('click', () => {
      play('click');
      buyCat(() => showHeroes(back, region));
    });
    const wd = WEAPONS[weapon];
    root.querySelector('#wdetail')!.innerHTML = `<p class="soft">${wd.desc}</p>${wd.skills.map((sk, i) => `<p class="skill-line"><span class="key">${'KL'[i]}</span> <b>${icon(sk.icon)} ${sk.name}</b> ${sk.desc} <small>마력 ${sk.mp} · ${sk.cd}초</small></p>`).join('')}`;
    (root.querySelector('#save') as HTMLButtonElement).disabled = !ok;
  };
  paint();
  on(root, '#back', back);
  on(root, '.hero-btn', (el) => {
    pick = el.dataset.id as HeroId;
    paint();
  });
  on(root, '#save', async () => {
    try {
      profile = view(await api.setHero(pick));
      back();
    } catch (e) {
      toast(errText(e));
    }
  });
}

// ---------- 십이지 지도 · 지형 ----------

function showWorld() {
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도${profile.mode === 'hard' ? ' <small class="mode-tag">🔥 어려움</small>' : ''}</h2><div class="pills">${levelPill()}</div></div>
    <div class="region-grid">${REGION_TABLE.map((r) => {
      const ready = regionReady(r.region);
      const open = ready && regionOpen(profile, r.region);
      const sub = !ready ? '준비 중' : open ? `${hasKey(profile, r.region) ? `${IC.key} ` : ''}★ ${regionStarCount(profile, r.region)}/${MAPS_PER_REGION * 3}` : `🔒 ${r.region - 1}지형 보스`;
      return `<button class="region bg-${r.ground} ${open ? '' : 'locked'}" data-r="${r.region}">
          ${face(r.home)}${ready && recommended(r.region).length > 1 ? `<i class="counter">${face(r.counter)}</i>` : ''}<b>${r.region}</b><span>${r.name}</span><em>${sub}</em>
        </button>`;
    }).join('')}</div>
    <button class="btn big final ${finalOpen(profile) ? 'primary' : 'soon'}" id="final">${cleared(profile, FINAL.id) ? '✔' : finalOpen(profile) ? '👹' : '🔒'} 최종보스 · ${FINAL.name} <small>${IC.key} 열쇠 ${keyCount(profile)} / ${REGIONS}${cleared(profile, FINAL.id) ? ` · ${starsText(starsOfMap(profile, FINAL.id))}` : ''}</small></button>
    <p class="soft center light">큰 얼굴 = 고향 대원(공격·방어 +10%) · 작은 얼굴 = 지형 환경을 막는 대원<br/>지형 보스를 잡으면 다음 지형이 열리고 대원이 합류해요</p>`);
  on(root, '#back', showMain);
  on(root, '#final', () => {
    if (finalOpen(profile)) return showFinal();
    const left = REGIONS - keyCount(profile);
    toast(left > 0 ? `열쇠 12개를 모두 모으면 열려요 (${left}개 남았어요 — 열쇠는 지형 보스가 떨어뜨려요)` : `${REGIONS}지형 보스를 잡아야 열려요`, 3000);
  });
  on(root, '.region', (el) => {
    const r = Number(el.dataset.r);
    if (!regionReady(r)) return toast(`${regionOf(r).name}은(는) 준비 중이에요`);
    if (!regionOpen(profile, r)) return toast(`${r - 1}지형 보스를 잡아야 열려요`);
    showRegion(r);
  });
  syncPending(root, showWorld);
}

/** 쉼터의 고양이 줄 (보통 모드를 끝냈고 아직 열지 않았을 때) */
const catRow = () => (normalDone(profile) && !cat ? `<button class="btn small cat-row" id="cat">${face('cat')} 야옹이가 기다려요 <em class="tag">시아코인 ${heroOf('cat').price}</em></button>` : '');
/** 쉼터에 들어왔을 때: 보통 모드를 끝낸 뒤 처음이면 고양이 등장 장면 */
function restCat(root: HTMLElement, redraw: () => void) {
  on(root, '#cat', () => showCatScene(redraw));
  if (normalDone(profile) && !cat && !seen(CAT_KEY)) showCatScene(redraw);
}

/**
 * 고양이 등장 장면 (PRD '이야기': 보통 모드 클리어 뒤 '경주에 늦어 빠진 13번째 대원'으로 쉼터에 나타난다).
 * 시아코인 100개로 이 게임에서 따로 연다 (shared/characters.js 의 buyCharacter('twelve', 'cat'))
 */
function showCatScene(after: () => void) {
  mark(CAT_KEY, '1');
  const h = heroOf('cat');
  const box = overlay(`<div class="card pop cat-scene">
    <h3>🏕️ 쉼터에 누가 와 있어요</h3>
    <div class="story-art bg-field">${hasArt('cat-scene') ? `<img class="story-img" src="${artUrl('cat-scene')}" alt="" />` : `<div class="story-row"><img class="hero" src="${heroFullUrl('cat')}" alt="${h.name}" /></div><span class="story-mark">💤</span>`}</div>
    <p class="cat-say">“헉, 헉… 경주는… 벌써 끝났다고? 늦잠을 자 버렸지 뭐야.”</p>
    <p class="soft center">십이지 경주에 늦어 빠진 <b>13번째 대원 ${h.name}</b>예요. 금관을 비뚤게 쓰고 이제야 달려왔어요.<br/>“봉인이 또 흔들린다며? 이번엔 나도 끼워 줘!”</p>
    <button class="btn primary big" id="buy">시아코인 ${h.price}개로 함께하기</button>
    <button class="btn" id="later">나중에 <small>(대원 화면에서 열 수 있어요)</small></button></div>`);
  on(box, '#later', () => box.remove());
  on(box, '#buy', () => {
    box.remove();
    buyCat(after);
  });
}

/** 고양이 열기: 조건(보통 모드 최종보스 처치)과 값을 보여 주고 산다. 테스트 모드는 구매를 흉내만 낸다 */
let buying = false;
async function buyCat(after: () => void) {
  if (buying) return;
  const h = heroOf('cat');
  const joined = () => {
    play('survLevel');
    const box = overlay(`<div class="card pop"><h3>🎉 13번째 대원</h3>
      <div class="new-hero">${face('cat')}<span>${h.name}(${h.animal})${iGa(h.name)} 합류했어요!${h.hello ? `<small>“${h.hello}”</small>` : ''}</span></div>
      <button class="btn primary" id="ok">좋아요</button></div>`);
    on(box, '#ok', () => {
      box.remove();
      after();
    });
  };
  if (LOCAL_MODE) {
    if (!normalDone(profile)) return toast('아직 열 수 없어요 (조건 0 / 1)');
    buyLocalCat();
    cat = true;
    toast('테스트 모드: 구매를 흉내 냈어요 (시아코인은 줄지 않아요)', 3000);
    return joined();
  }
  buying = true;
  const pr = await loadCharacterProgress();
  buying = false;
  const ok = !pr || pr.have >= pr.need;
  const box = overlay(`<div class="card pop"><h3>${face('cat')} ${h.name} 열기</h3>
    <div class="rows"><div><span>조건: 보통 모드 최종보스 처치</span><b>${pr ? `${Math.min(pr.have, pr.need)} / ${pr.need}` : '확인 중'}</b></div><div><span>값</span><b class="coin">시아코인 ${h.price}개</b></div></div>
    <p class="soft center">이 게임에서만 열려요 (다른 게임의 고양이와는 따로예요)</p>
    <button class="btn primary big" id="yes" ${ok ? '' : 'disabled'}>시아코인 ${h.price}개로 열기</button>
    <button class="btn" id="no">취소</button></div>`);
  on(box, '#no', () => box.remove());
  on(box, '#yes', async () => {
    if (buying) return;
    buying = true;
    const { r, text } = await buyCharacter('cat');
    buying = false;
    box.remove();
    toast(text, 3000);
    if (!r.ok && r.reason !== 'owned') return;
    cat = (await loadOwnedCharacters(true))?.includes('cat') ?? true;
    if (r.ok) joined();
    else after();
  });
}

/** 봉인의 문 앞 (최종보스맵의 쉼터): 열쇠 12개를 모으면 지도 가운데에서 들어온다 */
function showFinal() {
  const m = FINAL;
  const boss = BOSSES[bossIdOf(m)];
  const lv = mapLevel(m.region, m.no, profile.mode);
  const low = profile.level < lv;
  const win = cleared(profile, m.id);
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${m.name}</h2><div class="pills">${coinsPill()}</div></div>
    <div class="card rest">
      <h3>🏕️ 쉼터 <small>환경 효과 없음 · 고향 보너스 없음</small></h3>
      <div class="rest-row">
        <button class="btn small" id="heroes">${face(profile.hero)} 대원 바꾸기</button>
        <button class="btn small" id="shop">🛒 상점</button>
        <button class="btn small" id="smith">⚒️ 대장간</button>
        <button class="btn small" id="bag">🎒 가방${boxItems(profile).length ? ` <em class="tag">${boxItems(profile).length}</em>` : ''}</button>
        ${catRow()}
      </div>
    </div>
    <div class="card final-card">
      <img class="final-boss" src="${artUrl(boss.art)}" alt="${boss.name}" />
      <h3>👹 ${boss.name} <small class="${low ? 'warn' : ''}">권장 Lv ${lv}${low ? ' ⚠️' : ''} · ⏱ ${time(mapPar(m, profile.mode))}</small></h3>
      <p class="soft">열두 길의 봉인 뒤에 갇혀 있던 어둠이에요. <b>세 단계</b>로 싸워요 — 체력이 줄 때마다 몸이 커지고, 앞에서 만난 보스들의 공격을 섞어 써요.</p>
      <p class="soft">🕛 <b>열두 시</b>: 둘레의 줄이 차례로 쳐요. 도는 쪽을 따라 돌거나 굴러서 넘어요<br/>🧱 <b>무너지는 봉인</b>: 바둑판 칸이 번갈아 터져요. 안 터진 칸으로 옮겨 서요</p>
      ${profile.mode === 'hard' ? '<p class="soft">🔥 <b>어려움</b>: 무너지는 봉인이 더 넓게 한 번 더 와요. 이번에 쓰러뜨리면 진짜 끝이에요</p>' : ''}
      <div class="final-keys">${'🗝️'.repeat(REGIONS)}</div>
      ${win ? `<p class="soft center">${starsHtml(starsOfMap(profile, m.id))} ${MODE_NAME[profile.mode]} 모드 클리어!</p>` : ''}
    </div>
    <button class="btn primary big" id="start">${win ? '다시 도전' : '봉인의 문으로 ▶'}</button>
    <p class="soft center light">★ 시간 안에 · 안 쓰러지고 · 숨은 상자<br/>처음 잡으면 강화석 꾸러미를 받고, ${MODE_NAME[profile.mode]} 모드가 끝나요</p>`,
    'bg-underworld',
  );
  on(root, '#back', showWorld);
  on(root, '#heroes', () => showHeroes(showFinal));
  on(root, '#shop', () => showShop(0));
  on(root, '#smith', () => showSmith(0));
  on(root, '#bag', () => showBag(showFinal));
  on(root, '#start', () => void startMap(m, 0));
  restCat(root, showFinal);
  syncPending(root, showFinal);
}

function showRegion(region: number) {
  if (!region) return showFinal();
  const r = regionOf(region);
  const boss = BOSSES[r.boss];
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${r.name}${profile.mode === 'hard' ? ' <small class="mode-tag">🔥</small>' : ''}</h2><div class="pills">${coinsPill()}</div></div>
    <div class="card rest">
      <h3>🏕️ 쉼터 <small>${r.envText}</small></h3>
      <div class="rest-row">
        <button class="btn small" id="heroes">${face(profile.hero)} 대원 바꾸기</button>
        <button class="btn small" id="shop">🛒 상점</button>
        <button class="btn small" id="smith">⚒️ 대장간</button>
        <button class="btn small" id="bag">🎒 가방${boxItems(profile).length ? ` <em class="tag">${boxItems(profile).length}</em>` : ''}</button>
        ${catRow()}
      </div>
      <p class="soft rec">추천 대원 ${recommended(region).map((h) => `${face(h)} ${heroOf(h).name} <small>${[h === r.home ? '고향 +10%' : '', h === r.counter && r.env !== 'none' ? `${ENV_NAME[r.env]} 막음` : ''].filter(Boolean).join(' · ')}</small>`).join(' ')}</p>
    </div>
    <div class="stage-list">${mapsOf(region)
      .map((m) => {
        const open = mapOpen(profile, m.id);
        const lv = mapLevel(m.region, m.no, profile.mode);
        const low = profile.level < lv;
        return `<button class="btn stage-row ${m.boss ? 'boss' : ''} ${open ? '' : 'locked'}" data-id="${m.id}">
          <b>${m.id}</b><span>${m.boss ? `👹 ${boss.name}` : m.name}<small class="${low && open ? 'warn' : ''}">권장 Lv ${lv}${low && open ? ' ⚠️' : ''} · ⏱ ${time(mapPar(m, profile.mode))}</small></span>
          ${open ? starsHtml(starsOfMap(profile, m.id)) : '<span>🔒</span>'}
        </button>`;
      })
      .join('')}</div>
    <div class="card">
      <h3>이 지형의 레어 <small>정예·보스가 떨어뜨려요 · ${hasKey(profile, region) ? `${IC.key} 열쇠를 얻었어요` : `${IC.key} 열쇠는 보스가 가끔 떨어뜨려요`}</small></h3>
      <div class="rare-list">${regionRares(region, profile.mode).map((b) => `<span class="${profile.codex.includes(b) ? 'on' : ''}">${itemIcon(itemDef(b)!)} ${itemDef(b)!.name}</span>`).join('')}</div>
      <p class="soft">★ ${regionStarCount(profile, region)} / ${MAPS_PER_REGION * 3} — 별을 모두 모으면 장신구를 하나 받아요</p>
    </div>
    <p class="soft center light">★ 시간 안에 · 안 쓰러지고 · 숨은 상자 — 따로따로 모아도 돼요<br/>${profile.mode === 'hard' ? `🔥 어려움: 요괴가 더 많고, ${boss.name}의 공격이 하나 늘어요` : joinText(region)}</p>`,
    `bg-${r.ground}`,
  );
  on(root, '#back', showWorld);
  on(root, '#heroes', () => showHeroes(() => showRegion(region), region));
  on(root, '#shop', () => showShop(region));
  on(root, '#smith', () => showSmith(region));
  on(root, '#bag', () => showBag(() => showRegion(region)));
  on(root, '.stage-row', (el) => {
    const m = mapOf(el.dataset.id!)!;
    if (!mapOpen(profile, m.id)) return toast('앞 맵을 깨야 열려요');
    void startMap(m, 0);
  });
  restCat(root, () => showRegion(region));
  syncPending(root, () => showRegion(region));
}

// ---------- 맵 (전투) ----------

let game: Phaser.Game | null = null;
let controls: Controls | null = null;
let busy = false;
/** 전투 화면 자리의 크기가 바뀌면 그림판을 다시 맞춘다 (Phaser 는 창 크기 변화만 믿을 만하게 따라온다) */
let gameWatch: ResizeObserver | null = null;
/** 탭을 가리면 멈추는 리스너 떼기 (판이 끝날 때 · closeGame) */
let hideWatch: (() => void) | null = null;

function closeGame() {
  hideWatch?.();
  gameWatch?.disconnect();
  gameWatch = null;
  controls?.destroy();
  controls = null;
  game?.destroy(true);
  game = null;
}

/** deaths = 이 맵에서 이번 도전 동안 쓰러진 횟수 ('다시 도전'으로 이어 올 때 늘어난다 → '안 쓰러지고' 별) */
async function startMap(map: MapDef, deaths: number) {
  if (busy) return;
  busy = true;
  let runId = '';
  let seed = (Math.random() * 0x7fffffff) >>> 0;
  try {
    if (!DEV_PLAY) {
      const st = await api.start(map.id, profile.mode, profile.hero);
      ({ run: runId, seed } = st);
      // 시작 전에 못 보낸 결과를 먼저 보냈다: 그 결과가 반영된 프로필로 판을 연다 (장비·물약·결과 화면의 '다음 맵')
      if (st.profile) profile = view(st.profile);
    }
    // 숫자 그림(피해 숫자)을 그리기 전에 글꼴이 있어야 한다
    await Promise.race([document.fonts.load("34px 'Jua'"), new Promise((ok) => setTimeout(ok, 1500))]).catch(() => null);
  } catch (e) {
    busy = false;
    toast(errText(e));
    if (!app().querySelector('.screen')) showMain();
    return;
  }
  busy = false;
  closeGame();
  const mode = profile.mode;
  // 전투 무작위(치명타 등)는 기기 씨앗, 드랍은 서버가 준 씨앗 (서버가 같은 규칙으로 다시 판정한다)
  const run = createRun(map, mode, loadoutOf(profile), { seed: (Math.random() * 0xffffffff) >>> 0, stock: profile.potions, drops: dropCtx(profile, map.id, mode, seed), god: DEV_GOD });
  if (!DEV_PLAY) mark(RUN_KEY, map.id);
  // 개발용: 콘솔에서 판 상태를 들여다보거나 고칠 수 있게 (테스트 모드에서만)
  if (LOCAL_MODE) (window as unknown as { __twelve?: RunState }).__twelve = run;

  let sent = false;
  const finish = async (s: RunState): Promise<FinishResult | null> => {
    if (sent) return null;
    sent = true;
    mark(RUN_KEY, null);
    const report: RunReport = {
      run: runId,
      map: map.id,
      mode,
      hero: s.hero.id,
      time: Math.floor(s.t),
      cleared: s.phase === 'clear',
      kills: { ...s.kills },
      elites: s.eliteKills,
      boss: s.bossDead,
      chest: s.chest,
      deaths,
      potions: s.used.map((r) => [...r]),
    };
    // 개발 판: 같은 규칙으로 계산만 하고 저장하지 않는다
    if (DEV_PLAY) return applyReport(structuredClone(profile), report, seed);
    try {
      const r = await api.finish(report);
      if (!r) return null;
      profile = view(r.profile);
      return r.result;
    } catch (e) {
      toast(errText(e));
      return null;
    }
  };
  playRun(run, {
    title: map.final ? `최종보스 · ${map.name}` : `${map.id} ${map.name}`,
    exp: true,
    time: (s) => {
      const left = mapPar(map, s.mode) - s.t;
      return { text: left >= 0 ? `⏱ ${time(left)}` : `⏱ +${time(-left)}`, late: left < 0 };
    },
    quitNote: '그만하면 쓰러진 것과 같아요: 이 맵에서 얻은 엽전은 잃고 경험치는 남아요',
    locked: () => sent,
    onQuit: async (s) => {
      await finish(s);
      restOf(map);
    },
    onEnd: async (s) => showResult(s, await finish(s), deaths),
  });
}

/** 전투 화면 하나 (맵 한 판 · 끝없는 탑의 한 층이 같이 쓴다) */
interface PlayOpts {
  /** HUD 의 이름 */
  title: string;
  /** 경험치 막대가 이 판에서 얻은 만큼 차는지 (탑은 경험치가 없다) */
  exp: boolean;
  /** 시간 알약 */
  time: (s: RunState) => { text: string; late: boolean };
  /** 일시정지 창의 '그만하기' 설명 */
  quitNote: string;
  /** 결과를 이미 보내는 중인지 (그 뒤에는 멈추거나 그만둘 수 없다) */
  locked: () => boolean;
  onQuit: (s: RunState) => Promise<void> | void;
  onEnd: (s: RunState) => Promise<void> | void;
}

function playRun(run: RunState, o: PlayOpts) {
  const map = run.map;
  const bossDef = map.boss ? BOSSES[bossIdOf(map)] : null;
  const need = exitNeed(run.total);
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-bars">
        <div class="hud-name">${face(run.hero.id)}<b>Lv ${run.loadout.level}</b><span>${o.title}</span></div>
        <div class="gauge hp"><i id="hp"></i><em id="hpT"></em></div>
        <div class="gauge mp"><i id="mp"></i></div>
        <div class="gauge exp"><i id="exp"></i></div>
      </div>
      <div class="hud-side"><span class="hud-pill" id="time"></span><span class="hud-pill" id="kills"></span>${
        run.env.id !== 'none' ? `<span class="hud-pill env ${run.env.f < 1 ? 'ok' : ''}">${ENV_ICON[run.env.id]} ${ENV_NAME[run.env.id]}${run.env.f === 0 ? ' 막음' : run.env.f < 1 ? ' 절반' : ''}</span>` : ''
      }</div>
      <canvas id="mini" width="64" height="144"></canvas>
    </div>
    ${bossDef ? `<div class="boss-bar hidden" id="boss"><b>👹 ${bossDef.name}</b><div class="gauge"><i id="bossHp"></i>${(bossDef.phases ?? []).map((ph) => `<u style="left:${Math.round(ph.at * 100)}%"></u>`).join('')}</div></div><div class="boss-say hidden" id="say"></div>` : ''}
    <div class="hud-note hidden" id="note"></div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const pause = () => {
    // 판이 끝난 뒤에는 멈추지 않는다 (그만하기가 클리어를 덮어쓰지 않게)
    if (scene.paused || o.locked() || run.phase !== 'play') return;
    scene.paused = true;
    const box = overlay(`<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button>
      <p class="soft center">${o.quitNote}</p></div>`);
    on(box, '#resume', () => {
      scene.paused = false;
      box.remove();
    });
    on(box, '#quit', async () => {
      box.remove();
      if (o.locked() || run.phase !== 'play') return void (scene.paused = false);
      run.phase = 'dead';
      unwatch();
      await o.onQuit(run);
    });
  };
  // 탭을 가리거나 창을 닫으면 멈춘다 (가려진 사이에 쓰러지지 않게)
  const onHide = () => {
    if (document.hidden) pause();
  };
  const unwatch = () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', pause);
    if (hideWatch === unwatch) hideWatch = null;
  };
  const ctl = createControls(root, run, { lefty: settings.lefty, onPause: pause });
  controls = ctl;
  on(root, '#pause', pause);

  // HUD: 값이 바뀔 때만 DOM 을 건드린다
  const shown = new Map<string, string>();
  const set = (key: string, value: string, apply: (v: string) => void) => {
    if (shown.get(key) === value) return;
    shown.set(key, value);
    apply(value);
  };
  const hp = $('hp');
  const hpT = $('hpT');
  const mp = $('mp');
  const exp = $('exp');
  const timeEl = $('time');
  const kills = $('kills');
  const note = $('note');
  const bossBox = bossDef ? $('boss') : null;
  const bossHp = bossDef ? $('bossHp') : null;
  // 보스 대사: 보스가 깨어나면 한 줄씩, 쓰러지면 마지막 한마디 (PRD '이야기')
  const sayEl = bossDef ? $('say') : null;
  let sayFrom = -1;
  let downAt = 0;
  const mini = $<HTMLCanvasElement>('mini').getContext('2d')!;
  const look = groundOf(map.region);
  const needExp = expNeed(profile.level);
  let noteT = 0;
  let frame = 0;
  const drawMini = (s: RunState) => {
    // 대원 둘레 36줄만 보여 준다 (한 칸 4px)
    const top = Math.max(0, Math.min(s.rows - 36, Math.floor(s.p.y / 60) - 22));
    mini.fillStyle = css(look.floor);
    mini.fillRect(0, 0, 64, 144);
    for (let y = 0; y < 36 && top + y < s.rows; y++) {
      for (let x = 0; x < 16; x++) {
        const t = s.grid[(top + y) * 16 + x];
        if (!t) continue;
        mini.fillStyle = css(t === 1 ? COLOR.outline : look.slow);
        mini.fillRect(x * 4, y * 4, 4, 4);
      }
    }
    const dot = (wx: number, wy: number, col: number, r: number) => {
      const y = (wy / 60 - top) * 4;
      if (y < -2 || y > 146) return;
      mini.fillStyle = css(col);
      mini.beginPath();
      mini.arc((wx / 60) * 4, y, r, 0, Math.PI * 2);
      mini.fill();
    };
    for (const e of s.enemies) if (!e.dead) dot(e.x, e.y, COLOR.pink, e.bossDef ? 4 : e.elite ? 3 : 2);
    dot(s.exitX, s.exitY, s.exitOpen ? COLOR.primary : COLOR.white, 4);
    dot(s.p.x, s.p.y, COLOR.teamA, 3.5);
  };

  const scene = new GameScene();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: $('game'),
    width: W,
    // #stage 와 같은 계산 (높이 = 창 높이, 폭 = 9:16 까지). 창 크기로 재야 화면이 아직 자리 잡기 전에도 맞다
    height: viewHeight(Math.min(window.innerWidth, (window.innerHeight * 9) / 16), window.innerHeight),
    backgroundColor: look.wall,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { keyboard: false, mouse: false, touch: false },
    scene: [],
    banner: false,
  });
  if (typeof ResizeObserver !== 'undefined') {
    // refresh() 만 부르면 안 된다: 그 안의 가운데 맞추기가 새 자리 크기를 읽어 가 버려서(옛 크기로 그린 채), 그 뒤로는 Phaser 가 '바뀐 것 없음'으로 본다.
    // 자리 크기를 먼저 읽히고 나서 맞춘다 (느린 기기에서 그림판이 화면보다 작게 굳던 문제)
    gameWatch = new ResizeObserver(() => {
      if (!game) return;
      game.scale.getParentBounds();
      game.scale.refresh();
    });
    gameWatch.observe($('game'));
  }
  // 개발용: 콘솔·확인 도구가 그림 메모리(game.textures)를 잴 수 있게 (테스트 모드에서만)
  if (LOCAL_MODE) (window as unknown as { __twelveGame?: Phaser.Game }).__twelveGame = game;
  game.scene.add('game', scene, true, {
    run,
    hooks: {
      input: () => ctl.input,
      consume: () => ctl.consume(),
      sound: play,
      numbers: () => settings.numbers,
      hurt: () => {
        if (settings.vibrate) navigator.vibrate?.(30);
      },
      rare: () => {
        if (settings.vibrate) navigator.vibrate?.([40, 40, 80]);
      },
      note: (text: string) => {
        note.textContent = text;
        note.classList.remove('hidden');
        noteT = performance.now() + 1800;
      },
      onFrame: (s: RunState) => {
        ctl.update(s);
        const p = s.p;
        set('hp', String(Math.round((p.hp / s.stats.hp) * 100)), (v) => (hp.style.width = `${v}%`));
        set('hpT', `${Math.ceil(p.hp)} / ${s.stats.hp}`, (v) => (hpT.textContent = v));
        set('mp', String(Math.round((p.mp / s.stats.mp) * 100)), (v) => (mp.style.width = `${v}%`));
        set('exp', String(needExp ? Math.min(100, Math.round(((profile.exp + (o.exp ? s.exp : 0)) / needExp) * 100)) : 100), (v) => (exp.style.width = `${v}%`));
        const tm = o.time(s);
        set('time', tm.text, (v) => {
          timeEl.textContent = v;
          timeEl.classList.toggle('late', tm.late);
        });
        set('kills', s.map.boss ? (s.bossDead ? '🚪 출구로!' : '👹 보스') : s.exitOpen ? '🚪 출구로!' : `👹 ${s.killed}/${need}`, (v) => (kills.textContent = v));
        if (bossBox && bossHp && s.boss) {
          set('bossOn', String(s.boss.awake && !s.boss.dead), (v) => bossBox.classList.toggle('hidden', v !== 'true'));
          set('bossHp', String(Math.round((s.boss.hp / s.boss.maxHp) * 100)), (v) => (bossHp.style.width = `${v}%`));
          if (s.boss.awake && sayFrom < 0) sayFrom = s.t;
          if (s.bossDead && !downAt) downAt = performance.now();
          const line = s.bossDead ? (performance.now() - downAt < 3200 ? bossDef!.last : '') : sayFrom >= 0 ? (bossDef!.lines[Math.floor((s.t - sayFrom) / 2.6)] ?? '') : '';
          set('say', line, (v) => {
            sayEl!.textContent = v ? `“${v}”` : '';
            sayEl!.classList.toggle('hidden', !v);
          });
        }
        if (noteT && performance.now() > noteT) {
          noteT = 0;
          note.classList.add('hidden');
        }
        if (frame++ % 12 === 0) drawMini(s);
      },
      onEnd: (s: RunState) => {
        unwatch();
        void o.onEnd(s);
      },
    },
  });
  hideWatch?.();
  hideWatch = unwatch;
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', pause);
  // 가려진 탭에서 시작한 판 (탑 다음 층은 1.8초 뒤에 저절로 시작한다): 가려지는 순간은 이미 지나갔으니 처음부터 멈춰 둔다
  if (document.hidden) pause();
}

/** 결과 화면의 얻은 것: 레어·열쇠는 크게 (PRD '화면 구성' 5) */
function lootHtml(r: FinishResult): string {
  const big: string[] = [];
  const small: string[] = [];
  if (r.key) big.push(`<div class="loot-big key">${IC.key} <b>지형 열쇠</b>를 얻었어요!</div>`);
  for (const it of r.items) {
    const d = itemDef(it.base);
    if (!d) continue;
    const where = it.box ? ' <small>(가방이 꽉 차서 보관함으로)</small>' : '';
    if (d.rare) big.push(`<div class="loot-big"><span class="ic">${itemIcon(d)}</span> <b>${d.name}</b>${it.base === r.starItem ? ' <small>별 24개 보상</small>' : ' <em class="tag">레어</em>'}${where}<small>${itemNote(d)}</small></div>`);
    else small.push(`<span>${itemIcon(d)} ${d.name}${where}</span>`);
  }
  if (r.stones) small.push(`<span>${IC.stone} 강화석 ${r.stones}</span>`);
  r.potions.forEach((row, s) => row.forEach((n, z) => n && small.push(`<span>${dropIcon({ t: 'potion', slot: s, size: z })} ${dropName({ t: 'potion', slot: s, size: z })} ${n}</span>`)));
  if (!big.length && !small.length) return '';
  return `${big.join('')}${small.length ? `<div class="loot">${small.join('')}</div>` : ''}`;
}

function showResult(s: RunState, r: FinishResult | null, deaths: number) {
  const map = s.map;
  const win = s.phase === 'clear';
  play(win ? 'win' : 'lose');
  const next = win ? nextMap(map.id) : null;
  const nextOk = !!next && mapOpen(profile, next.id);
  // 최종보스를 처음 잡았다: 결과 다음에 엔딩 (PRD '이야기')
  const ending = win && !!map.final && !!r?.first;
  const stars = r?.stars ?? 0;
  const box = overlay(`<div class="card pop result ${win ? 'win' : 'lose'}">
      <h2>${win ? (map.final ? (s.mode === 'hard' ? '진짜 봉인 완료! 👑' : '봉인 완료!') : '클리어!') : '쓰러졌어요'}</h2>
      ${
        win
          ? `<div class="big-stars">${starsHtml(stars)}</div>
             <div class="star-rows">${STAR_LABEL.map(([b, name]) => `<span class="${stars & b ? 'on' : ''}">${stars & b ? '★' : '☆'} ${name}${b === STAR_TIME ? ` (${time(s.t)} / ${time(mapPar(map, s.mode))})` : ''}</span>`).join('')}</div>`
          : `<p class="soft center">이 맵을 처음부터 다시 해요. 이 맵에서 얻은 엽전은 잃고, 경험치는 남아요</p>`
      }
      <div class="rows">
        <div><span>쓰러뜨린 요괴</span><b>${s.killed} / ${s.total}${s.bossDead ? ' + 보스' : ''}</b></div>
        ${r ? `<div><span>경험치</span><b>+${r.exp.toLocaleString()}${r.ups ? ` · 레벨 업! Lv ${r.level}` : ''}</b></div>` : ''}
        ${r && r.ups && Math.floor(r.level / 10) > Math.floor((r.level - r.ups) / 10) ? `<div><span>스킬 강화</span><b>${Math.floor(r.level / 10)}단계 (피해 +${Math.round((skillLevelMul(r.level) - 1) * 100)}%)</b></div>` : ''}
        ${r && win ? `<div><span>엽전</span><b class="coin">+${r.coins.toLocaleString()}</b></div>` : ''}
        ${r?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      ${r && win ? lootHtml(r) : ''}
      ${r?.joined ? `<div class="new-hero">${face(r.joined)}<span>${heroOf(r.joined).name}(${heroOf(r.joined).animal})${iGa(heroOf(r.joined).name)} 합류했어요!${heroOf(r.joined).hello ? `<small>“${heroOf(r.joined).hello}”</small>` : ''}</span></div>` : ''}
      ${r?.gift ? `<div class="new-hero"><span class="ic">🎁</span><span>보스의 선물! 강화석 꾸러미 ${r.gift}개를 받았어요<small>${map.final ? `${MODE_NAME[s.mode]} 모드의 열두 길을 끝까지 걸었어요` : '열두 대원이 모두 모여서, 이제 보스는 선물을 남겨요'}</small></span></div>` : ''}
      ${DEV_PLAY ? '<p class="soft center">개발 옵션으로 한 판이라 저장하지 않았어요</p>' : r ? '' : '<p class="soft center">기록을 저장하지 못했어요</p>'}
      <div class="btns">
        ${ending ? `<button class="btn primary big" id="ending">이야기 계속 ▶</button>` : nextOk ? `<button class="btn primary big" id="next">${next!.final ? '최종보스로 ▶' : '다음 맵 ▶'}</button>` : ''}
        ${ending ? '' : `<button class="btn ${nextOk ? '' : 'primary big'}" id="again">${win ? '다시 하기' : '다시 도전'}</button><button class="btn" id="rest">쉼터로</button>`}
      </div></div>`);
  if (r?.ups) play('twelveLevel');
  on(box, '#ending', () => (s.mode === 'hard' ? showTrueEnding(showMain) : showEnding(showMain)));
  on(box, '#next', () => (next!.final ? showFinal() : void startMap(next!, 0)));
  on(box, '#again', () => void startMap(map, win ? 0 : deaths + 1));
  on(box, '#rest', () => restOf(map));
}

// ---------- 끝없는 탑 ----------

/** 탑 한 판 (화면 쪽 상태). 기록은 층을 깰 때마다 api.towerFloor 로 남는다 */
interface TowerPlay {
  /** 판 번호 ('' = 개발 옵션으로 하는, 기록하지 않는 판) */
  run: string;
  /** 개발 판의 계산용 (저장하지 않는다) */
  dev: TowerRun | null;
  first: number;
  /** 지금 하는 층 */
  floor: number;
  /** 체크포인트에서 시작했을 때 더하는 시간 · 이 판에서 깬 층들에 쓴 시간 (초) */
  base: number;
  played: number;
  /** 결과를 보내는 중 (멈추거나 그만둘 수 없다) */
  sending: boolean;
  /** 이 판에서 받은 것 */
  coins: number;
  stones: number;
  items: Item[];
  sia: number;
  best: boolean;
}

function showTower() {
  const rec = profile.tower;
  const floors = startFloors(profile);
  let pick = floors[floors.length - 1];
  const paint = () => {
    const r = regionOf(towerRegion(pick));
    const root = screen(
      `<div class="bar"><button class="back" id="back">← 뒤로</button><h2>끝없는 탑</h2><div class="pills">${levelPill()}${coinsPill()}</div></div>
      <div class="card">
        <h3>내 기록 <small>${rec ? '가장 높이 오른 층' : '아직 올라 본 적이 없어요'}</small></h3>
        ${rec ? `<div class="rows"><div><span>최고 층</span><b>${rec.floor}층</b></div><div><span>걸린 시간</span><b>${time(rec.time)}</b></div><div><span>그때</span><b>Lv ${rec.level} · ${heroOf(rec.hero).name}</b></div></div>` : ''}
        <p class="soft">층마다 방 하나, ${TOWER.cp}층마다 보스가 있어요. 올라갈수록 요괴가 세지고 엽전·강화석·레어가 늘어나요.<br/>
        쓰러지면 그 판은 끝나고, 그때까지 받은 것은 그대로예요. 보스 층을 넘으면 다음에는 그 위에서 시작할 수 있어요.<br/>
        장비는 지금까지 연 지형의 등급까지 나와요. ${TOWER.cp}층마다 시아코인 1개. 경험치는 오르지 않아요.</p>
      </div>
      <div class="card">
        <h3>시작할 층 <small>${pick}층 · ${r.name}</small></h3>
        <div class="weapons">${floors.map((f) => `<button class="btn small ${f === pick ? 'primary' : ''}" data-f="${f}">${f}층</button>`).join('')}</div>
        <p class="soft rec">${face(profile.hero)} ${heroOf(profile.hero).name} · ${icon(WEAPONS[weaponOf(profile)].icon)} ${equipName('weapon')}</p>
      </div>
      <button class="btn primary big" id="go">▶ ${pick}층부터 오르기</button>
      <div class="row2"><button class="btn" id="heroes">🐾 대원 바꾸기</button><button class="btn" id="bag">🎒 가방</button></div>
      <div class="grow"></div>`,
      `bg-${r.ground}`,
    );
    on(root, '#back', showMain);
    on(root, '#heroes', () => showHeroes(showTower));
    on(root, '#bag', () => showBag(showTower));
    on(root, '[data-f]', (el) => {
      pick = Number(el.dataset.f);
      paint();
    });
    on(root, '#go', () => void startTower(pick));
  };
  paint();
}

async function startTower(floor: number) {
  if (busy) return;
  busy = true;
  const t: TowerPlay = { run: '', dev: null, first: floor, floor, base: 0, played: 0, sending: false, coins: 0, stones: 0, items: [], sia: 0, best: false };
  try {
    if (DEV_PLAY) t.dev = beginTower(structuredClone(profile), floor, profile.hero, 'dev', (Math.random() * 0x7fffffff) >>> 0, Date.now());
    else {
      const st = await api.towerStart(floor, profile.hero);
      t.run = st.run;
      t.base = st.base;
    }
    await Promise.race([document.fonts.load("34px 'Jua'"), new Promise((ok) => setTimeout(ok, 1500))]).catch(() => null);
  } catch (e) {
    busy = false;
    return toast(errText(e));
  }
  busy = false;
  playFloor(t, profile.potions, null);
}

/** 탑의 한 층. stock = 들고 있는 물약, carry = 앞 층에서 이어 온 체력·마력 */
function playFloor(t: TowerPlay, stock: number[][], carry: { hp: number; mp: number } | null) {
  closeGame();
  t.sending = false;
  const map = towerFloor(t.floor);
  const run = createRun(map, 'normal', loadoutOf(profile), { seed: (Math.random() * 0xffffffff) >>> 0, stock, god: DEV_GOD, carry: carry ?? undefined });
  if (LOCAL_MODE) (window as unknown as { __twelve?: RunState }).__twelve = run;
  const kind = floorKind(t.floor);
  playRun(run, {
    title: `🗼 ${t.floor}층${kind === 'boss' ? ' 보스' : kind === 'elite' ? ' 정예' : ''}`,
    exp: false,
    time: (s) => ({ text: `⏱ ${time(t.base + t.played + s.t)}`, late: false }),
    quitNote: '그만하면 이 판은 여기서 끝나요. 지금까지 받은 것은 그대로예요',
    locked: () => t.sending,
    onQuit: (s) => endTowerPlay(t, s.used, ''),
    onEnd: (s) => (s.phase === 'clear' ? floorCleared(t, s) : endTowerPlay(t, s.used, '')),
  });
}

async function floorCleared(t: TowerPlay, s: RunState) {
  if (t.sending) return;
  t.sending = true;
  // 보내는 시간: 서버는 정수 초만 받고 층마다 최소 시간을 본다 — 빠른 층이 내림 때문에 걸리지 않게 앞에 보낸 시간 + 최소 시간까지 올린다
  // (올리는 폭은 서버의 경과 시간 여유 LIMITS.timeSlack 3초 안이다)
  const total = Math.max(Math.floor(t.played + s.t), t.played + floorMinTime(t.floor));
  const used = s.used.map((r) => [...r]);
  let res: TowerFloorResult | null = null;
  let why = '';
  if (t.dev) res = applyTowerFloor(structuredClone(profile), t.dev, t.floor, total, used, Date.now());
  else {
    try {
      const r = await api.towerFloor(t.run, t.floor, total, used);
      if (r) {
        profile = view(r.profile);
        res = r.result;
      } else why = '서버에 연결하지 못해 여기까지만 기록됐어요';
    } catch (e) {
      why = errText(e);
    }
  }
  // 기록하지 못한 층에서 판을 끝낸다 (그 층에서 쓴 물약은 이미 못 보냈다)
  if (!res) return void endTowerPlay(t, [], why, true);
  t.played = total;
  t.coins += res.coins;
  t.stones += res.stones;
  t.items.push(...res.items);
  if (res.siaCoin) t.sia++;
  t.best ||= res.best;
  const boss = floorKind(t.floor) === 'boss';
  play(boss ? 'win' : 'goal');
  const box = overlay(`<div class="card pop result win">
      <h2>${t.floor}층 클리어!</h2>
      <div class="rows">
        <div><span>엽전</span><b class="coin">+${res.coins.toLocaleString()}</b></div>
        ${res.stones ? `<div><span>강화석</span><b>+${res.stones}</b></div>` : ''}
        ${res.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
        <div><span>걸린 시간</span><b>${time(res.time)}${res.best ? ' · 최고 기록!' : ''}</b></div>
      </div>
      ${lootHtml(lootOf(res.items, 0))}
      ${boss ? `<p class="soft center">보스 층을 넘었어요! 다음에는 ${t.floor + 1}층에서 시작할 수 있어요. 체력·마력이 가득 찼어요</p>` : ''}
      ${t.dev ? '<p class="soft center">개발 옵션으로 한 판이라 저장하지 않았어요</p>' : ''}
      <div class="btns">
        <button class="btn primary big" id="next">${t.floor + 1}층으로 ▶</button>
        ${boss ? '<button class="btn" id="stop">여기서 그만하기</button>' : ''}
      </div></div>`);
  let gone = false;
  const next = () => {
    if (gone) return;
    gone = true;
    const st = s.stats;
    const heal = boss ? 1 : TOWER.heal;
    t.floor++;
    playFloor(t, s.stock.map((r) => [...r]), { hp: Math.min(st.hp, s.p.hp + st.hp * heal), mp: Math.min(st.mp, s.p.mp + st.mp * heal) });
  };
  on(box, '#next', next);
  on(box, '#stop', () => {
    if (gone) return;
    gone = true;
    box.remove();
    t.floor++;
    void endTowerPlay(t, [], '', true);
  });
  // 보스 층이 아니면 잠깐 보여 주고 바로 다음 층으로
  if (!boss) setTimeout(next, 1800);
}

const lootOf = (items: Item[], stones: number): FinishResult =>
  ({ exp: 0, coins: 0, ups: 0, level: profile.level, stars: 0, newStars: 0, first: false, joined: null, gift: 0, siaCoin: false, items, stones, potions: [[0, 0, 0], [0, 0, 0]], key: false, starItem: null });

/**
 * 탑 판 끝 (쓰러졌거나 · 그만뒀거나 · 기록하지 못했다). used = 마지막 층에서 쓴 물약, note = 덧붙일 말.
 * t.floor = 끝난 층 (그 아래 층까지 깼다)
 */
async function endTowerPlay(t: TowerPlay, used: number[][], note: string, force = false) {
  if (t.sending && !force) return;
  t.sending = true;
  if (t.run) {
    try {
      const p = await api.towerEnd(t.run, used.length ? used.map((r) => [...r]) : [[0, 0, 0], [0, 0, 0]]);
      if (p) profile = view(p);
    } catch {
      /* 이미 끝난 판이면 그대로 둔다 */
    }
  }
  const reached = t.floor - 1;
  const rec = profile.tower;
  play(reached >= t.first ? 'win' : 'lose');
  const box = overlay(`<div class="card pop result ${reached >= t.first ? 'win' : 'lose'}">
      <h2>${reached >= t.first ? `${reached}층까지 올랐어요` : `${t.floor}층에서 끝났어요`}</h2>
      <div class="rows">
        <div><span>이번 판</span><b>${t.first}층 → ${reached >= t.first ? `${reached}층` : '-'}${reached >= t.first ? ` · ${time(t.base + t.played)}` : ''}</b></div>
        ${rec ? `<div><span>내 최고 기록</span><b>${rec.floor}층 · ${time(rec.time)}${t.best ? ' · 새 기록!' : ''}</b></div>` : ''}
        <div><span>엽전</span><b class="coin">+${t.coins.toLocaleString()}</b></div>
        ${t.sia ? `<div><span>시아코인</span><b class="coin">+${t.sia}</b></div>` : ''}
      </div>
      ${lootHtml(lootOf(t.items, t.stones))}
      ${note ? `<p class="soft center">${note}</p>` : ''}
      ${t.dev ? '<p class="soft center">개발 옵션으로 한 판이라 저장하지 않았어요</p>' : ''}
      <div class="btns">
        <button class="btn primary big" id="again">다시 오르기</button>
        <button class="btn" id="home">메인으로</button>
      </div></div>`);
  on(box, '#again', showTower);
  on(box, '#home', showMain);
}

// ---------- 가방 · 상점 · 대장간 ----------

/** 서버(기기)에 한 가지를 시키고, 되면 새 기록으로 화면을 다시 그린다 */
async function act(fn: () => Promise<TwelveProfile>, after: () => void, sfx = 'click') {
  if (busy) return;
  busy = true;
  try {
    profile = view(await fn());
    play(sfx);
    after();
  } catch (e) {
    toast(errText(e));
  } finally {
    busy = false;
  }
}

const stonesPill = () => `<span class="coins-pill stone-pill">${IC.stone} ${profile.stones.toLocaleString()}</span>`;
const plusText = (it: Item) => (it.plus ? ` +${it.plus}` : '');

/** 장비 한 칸 (가방 격자) */
function cell(it: Item): string {
  const d = itemDef(it.base)!;
  const low = profile.level < itemLevel(d);
  return `<button class="item-cell ${d.rare ? 'rare' : ''} ${isEquipped(profile, it.id) ? 'on' : ''} ${low ? 'low' : ''}" data-id="${it.id}">
    <span class="ic">${itemIcon(d)}</span><small>Lv ${itemLevel(d)}</small>${it.plus ? `<b>+${it.plus}</b>` : ''}${it.lock ? '<i>🔒</i>' : ''}${isEquipped(profile, it.id) ? '<em>착용</em>' : ''}
  </button>`;
}
const SLOT_ORDER: Record<Slot, number> = { weapon: 0, armor: 1, acc: 2 };
/** 가방 정렬: 종류 → 등급 높은 순 → 레어 먼저 → 강화 높은 순 */
function sorted(list: Item[]): Item[] {
  return [...list].sort((a, b) => {
    const da = itemDef(a.base)!;
    const db = itemDef(b.base)!;
    return SLOT_ORDER[da.slot] - SLOT_ORDER[db.slot] || db.tier - da.tier || Number(db.rare) - Number(da.rare) || b.plus - a.plus || Number(a.id) - Number(b.id);
  });
}
const grid = (list: Item[], empty: string) => (list.length ? `<div class="item-grid">${sorted(list).map(cell).join('')}</div>` : `<p class="soft center">${empty}</p>`);

/** 능력치 줄: 지금 착용한 것과의 차이를 초록(오름)·빨강(내림)으로 (PRD '가방') */
function statRows(it: Item): string {
  const d = itemDef(it.base)!;
  const cur = equipped(profile, d.slot);
  const cd = cur && cur.id !== it.id ? itemDef(cur.base)! : null;
  const a = itemStats(d, it.plus);
  const b = cd ? itemStats(cd, cur!.plus) : null;
  const rows: string[] = [];
  for (const [k, name] of [['atk', '공격'], ['hp', '체력'], ['def', '방어']] as const) {
    if (!a[k] && !b?.[k]) continue;
    const diff = b ? a[k] - b[k] : 0;
    rows.push(`<div><span>${name}</span><b>${a[k]}${diff ? ` <em class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}</em>` : ''}</b></div>`);
  }
  if (d.stat) {
    const same = cd?.stat === d.stat ? (d.value ?? 0) - (cd.value ?? 0) : 0;
    rows.push(`<div><span>${ACC_TEXT[d.stat]}</span><b>+${d.value}${d.stat === 'crit' ? '%p' : '%'}${same ? ` <em class="${same > 0 ? 'up' : 'down'}">${same > 0 ? '▲' : '▼'}${Math.abs(same)}</em>` : ''}</b></div>`);
  }
  if (d.fx) rows.push(`<div class="fx"><span>✨ ${FX_NAME[d.fx]}</span><b>${FX_DESC[d.fx]}</b></div>`);
  if (cd) rows.push(`<div class="cmp"><span>지금 착용</span><b>${itemIcon(cd)} ${cd.name}${plusText(cur!)}${cd.stat || cd.fx ? ` · ${itemNote(cd)}` : ''}</b></div>`);
  return rows.join('');
}

type ItemCtx = 'bag' | 'sell' | 'smith';
/** 장비 하나를 눌렀을 때: 비교 + 할 수 있는 일 (가방: 착용·잠금 / 상점: 팔기 / 대장간: 강화·분해) */
function itemPopup(id: string, ctx: ItemCtx, redraw: () => void) {
  const it = itemOf(profile, id);
  const d = it && itemDef(it.base);
  if (!it || !d) return;
  const worn = isEquipped(profile, it.id);
  const low = profile.level < itemLevel(d);
  const cost = canEnhance(d) && it.plus < MAX_PLUS ? enhanceCost(d.tier, it.plus + 1) : null;
  const btns: string[] = [];
  if (it.box) btns.push(`<button class="btn primary" data-a="claim">가방으로 꺼내기</button>`);
  else if (ctx === 'bag') {
    if (!worn) btns.push(`<button class="btn primary" data-a="equip" ${low ? 'disabled' : ''}>${low ? `Lv ${itemLevel(d)}부터 착용` : '착용'}</button>`);
    else if (d.slot !== 'weapon') btns.push(`<button class="btn" data-a="unequip">벗기</button>`);
  }
  if (ctx === 'sell') btns.push(`<button class="btn primary" data-a="sell" ${worn || it.lock ? 'disabled' : ''}>팔기 ${IC.coin} ${d.sell.toLocaleString()}</button>`);
  if (ctx === 'smith') {
    if (cost) btns.push(`<button class="btn primary" data-a="enhance" ${profile.coins < cost.coins || profile.stones < cost.stones ? 'disabled' : ''}>강화 +${it.plus + 1} <small>${IC.coin} ${cost.coins.toLocaleString()} · ${IC.stone} ${cost.stones}</small></button>`);
    else if (canEnhance(d)) btns.push(`<button class="btn" disabled>최고 단계예요</button>`);
    btns.push(`<button class="btn" data-a="scrap" ${worn || it.lock ? 'disabled' : ''}>분해 ${IC.stone} +${scrapOf(d, it.plus)}</button>`);
  }
  btns.push(`<button class="btn" data-a="lock">${it.lock ? '🔓 잠금 풀기' : '🔒 잠그기'}</button>`);
  const box = overlay(`<div class="card pop item-pop ${d.rare ? 'rare' : ''}">
    <h3><span class="ic">${itemIcon(d)}</span> ${d.name}${plusText(it)} ${d.rare ? '<em class="tag">레어</em>' : ''}</h3>
    <p class="soft">${SLOT_NAME[d.slot]} · 착용 Lv ${itemLevel(d)}${low ? ' <b class="warn">(레벨이 모자라요)</b>' : ''}${worn ? ' · 착용 중' : ''}${it.lock ? ' · 🔒 잠금' : ''}${it.box ? ' · 보관함' : ''}</p>
    <div class="rows">${statRows(it)}</div>
    ${cost && ctx === 'smith' ? `<p class="soft">강화하면 ${d.slot === 'weapon' ? `공격 ${itemStats(d, it.plus).atk} → ${itemStats(d, it.plus + 1).atk}` : `체력 ${itemStats(d, it.plus).hp} → ${itemStats(d, it.plus + 1).hp} · 방어 ${itemStats(d, it.plus).def} → ${itemStats(d, it.plus + 1).def}`} (항상 성공)</p>` : ''}
    ${(ctx === 'sell' || ctx === 'smith') && (worn || it.lock) ? `<p class="soft">${worn ? '착용 중인' : '잠근'} 장비는 팔거나 분해할 수 없어요</p>` : ''}
    <div class="btns">${btns.join('')}<button class="btn" data-a="close">닫기</button></div></div>`);
  const again = () => {
    box.remove();
    redraw();
    if (itemOf(profile, id)) itemPopup(id, ctx, redraw);
  };
  const done = () => {
    box.remove();
    redraw();
  };
  on(box, '[data-a]', (el) => {
    switch (el.dataset.a) {
      case 'equip': return void act(() => api.equip(id), done, 'tankBuild');
      case 'unequip': return void act(() => api.unequip(d.slot), done);
      case 'claim': return void act(() => api.claim([id]), again);
      case 'lock': return void act(() => api.lock(id, !it.lock), again);
      case 'sell': return void act(() => api.sell([id]), done, 'coin');
      case 'scrap': return void act(() => api.scrap([id]), done, 'tankBuild');
      case 'enhance': return void act(() => api.enhance(id), again, 'survLevel');
      default: box.remove();
    }
  });
}

/** 가방: 착용 중 3칸 + 가방 격자 + 보관함 (PRD '화면 구성' 6) */
function showBag(back: () => void) {
  const mine = profile.items.filter((it) => !it.box);
  const boxed = boxItems(profile);
  const st = playerStats(loadoutOf(profile), 0);
  const slot = (s: Slot) => {
    const it = equipped(profile, s);
    const d = it && itemDef(it.base);
    return `<button class="eq-slot ${d?.rare ? 'rare' : ''}" ${it ? `data-id="${it.id}"` : 'disabled'}><span class="ic">${d ? itemIcon(d) : '➕'}</span><b>${d ? `${d.name}${plusText(it!)}` : `${SLOT_NAME[s]} 없음`}</b><small>${d ? (d.slot === 'acc' || d.fx ? itemNote(d) : `Lv ${itemLevel(d)}`) : ''}</small></button>`;
  };
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>가방</h2><div class="pills">${stonesPill()}${coinsPill()}</div></div>
    <div class="card"><h3>착용 중 <small>공격 ${Math.round(st.atk)} · 체력 ${st.hp} · 방어 ${Math.round(st.def)}</small></h3><div class="eq-row">${SLOTS.map(slot).join('')}</div></div>
    <div class="card"><h3>가방 <small>${mine.length} / ${profile.bag}칸 · 눌러서 비교·착용·잠금</small></h3>${grid(mine, '가방이 비었어요')}</div>
    ${boxed.length ? `<div class="card"><h3>보관함 <small>${boxed.length}개 · 가방이 꽉 차서 여기로 왔어요</small></h3>${grid(boxed, '')}<button class="btn primary" id="claim">모두 가방으로</button></div>` : ''}
    <div class="card"><h3>물약</h3><div class="potion-row">${[0, 1].map((s) => POTION_NAME.map((n, z) => `<span>${s ? IC.mp : IC.hp}${n} <b>${profile.potions[s][z]}</b></span>`).join('')).join('')}</div>
      <p class="soft">전투에서는 모자란 만큼을 채우는 가장 작은 물약부터 써요. 팔기는 상점, 강화·분해는 대장간에서 해요</p></div>`);
  const redraw = () => showBag(back);
  on(root, '#back', back);
  on(root, '[data-id]', (el) => itemPopup(el.dataset.id!, 'bag', redraw));
  on(root, '#claim', () => void act(() => api.claim(), redraw));
}

/** 상점: 물약 · 일반 장비 · 가방 늘리기 / 팔기 (PRD '마을·상점·대장간') */
/**
 * 한꺼번에 정리할 장비: 일반 무기·방어구만 (가방이 금방 차지 않게).
 * 착용·잠금·레어·장신구·강화한 것은 두고, 무기는 종류마다 가장 좋은 것 하나씩도 남긴다 (다른 무기를 써 볼 수 있게).
 */
function spareItems(): Item[] {
  const keep = new Set<string>();
  for (const k of WEAPON_KINDS) {
    const best = profile.items.filter((it) => itemDef(it.base)?.kind === k).sort((a, b) => itemStats(itemDef(b.base)!, b.plus).atk - itemStats(itemDef(a.base)!, a.plus).atk)[0];
    if (best) keep.add(best.id);
  }
  return profile.items.filter((it) => {
    const d = itemDef(it.base);
    return !!d && !d.rare && d.slot !== 'acc' && !it.plus && !it.lock && !isEquipped(profile, it.id) && !keep.has(it.id);
  });
}
/** 한꺼번에 팔기·분해: 한 번 더 묻고 한다 */
function bulk(kind: 'sell' | 'scrap', after: () => void) {
  const list = spareItems();
  if (!list.length) return;
  const gain = list.reduce((n, it) => n + (kind === 'sell' ? itemDef(it.base)!.sell : scrapOf(itemDef(it.base)!, it.plus)), 0);
  const box = overlay(`<div class="card pop"><h3>일반 장비 ${list.length}개를 모두 ${kind === 'sell' ? '팔까요' : '분해할까요'}?</h3>
    <p class="soft center">${kind === 'sell' ? `${IC.coin} 엽전 ${gain.toLocaleString()}` : `${IC.stone} 강화석 ${gain}`} 받아요.<br/>착용 중인 것, 🔒 잠근 것, 레어, 장신구, 강화한 장비와<br/>종류마다 가장 좋은 무기 하나씩은 그대로 둬요</p>
    <button class="btn primary" id="yes">모두 ${kind === 'sell' ? '팔기' : '분해'}</button><button class="btn" id="no">그만두기</button></div>`);
  on(box, '#no', () => box.remove());
  on(box, '#yes', () => {
    box.remove();
    const ids = list.map((it) => it.id);
    void act(() => (kind === 'sell' ? api.sell(ids) : api.scrap(ids)), after, 'coin');
  });
}

function showShop(region: number, tab: 'buy' | 'sell' = 'buy') {
  const top = shopTier(profile);
  // region 0 = 봉인의 문 앞 쉼터 (showRegion 이 그쪽으로 보낸다)
  const back = () => showRegion(region);
  const redraw = () => showShop(region, tab);
  let body: string;
  if (tab === 'buy') {
    const potions = [0, 1]
      .map((s) =>
        POTION_NAME.map((n, z) => {
          const have = profile.potions[s][z];
          const price = POTION.price[s][z];
          return `<div class="shop-row"><span class="ic">${s ? IC.mp : IC.hp}</span><span>${s ? '마력' : '체력'} 물약(${n}) <small>${Math.round(POTION.heal[s][z] * 100)}% 회복 · 가진 수 ${have}/${POTION.max}</small></span>
            <button class="btn small" data-buy="potion:${s}:${z}" data-n="1" ${have >= POTION.max || profile.coins < price ? 'disabled' : ''}>${IC.coin} ${price}</button>
            <button class="btn small" data-buy="potion:${s}:${z}" data-n="5" ${have + 5 > POTION.max || profile.coins < price * 5 ? 'disabled' : ''}>×5</button></div>`;
        }).join(''),
      )
      .join('');
    const gear = ITEMS.filter((d) => forSale(profile, d))
      .sort((a, b) => b.tier - a.tier)
      .map((d) => {
        const stt = itemStats(d, 0);
        return `<div class="shop-row ${profile.level < itemLevel(d) ? 'low' : ''}"><span class="ic">${itemIcon(d)}</span><span>${d.name} <small>Lv ${itemLevel(d)} · ${d.slot === 'weapon' ? `공격 ${stt.atk}` : `체력 ${stt.hp} · 방어 ${stt.def}`}</small></span>
          <button class="btn small" data-buy="${d.id}" data-n="1" ${profile.coins < d.buy ? 'disabled' : ''}>${IC.coin} ${d.buy.toLocaleString()}</button></div>`;
      })
      .join('');
    const bagRow =
      profile.bag >= BAG.max
        ? `<div class="shop-row"><span class="ic">🎒</span><span>가방 <small>${profile.bag}칸 (더 늘릴 수 없어요)</small></span></div>`
        : `<div class="shop-row"><span class="ic">🎒</span><span>가방 늘리기 <small>${profile.bag}칸 → ${profile.bag + BAG.step}칸</small></span>
          <button class="btn small" data-buy="bag" data-n="1" ${profile.coins < bagPrice(profile.bag) ? 'disabled' : ''}>${IC.coin} ${bagPrice(profile.bag).toLocaleString()}</button></div>`;
    body = `<div class="card"><h3>물약</h3>${potions}</div>
      <div class="card"><h3>일반 장비 <small>열린 지형까지의 등급 (착용 Lv ${TIER_LEVELS[top]}까지) · 가방 ${bagCount(profile)}/${profile.bag}</small></h3>${gear}</div>
      <div class="card"><h3>가방</h3>${bagRow}</div>`;
  } else {
    const list = profile.items.filter((it) => !isEquipped(profile, it.id));
    const spare = spareItems();
    body = `<div class="card"><h3>팔 장비 고르기 <small>착용 중인 것과 🔒 잠근 것은 팔 수 없어요</small></h3>${grid(list, '팔 장비가 없어요')}
      <button class="btn small bulk" id="bulk" ${spare.length ? '' : 'disabled'}>🧹 일반 장비 모두 팔기${spare.length ? ` (${spare.length}개 · ${IC.coin} ${spare.reduce((n, it) => n + itemDef(it.base)!.sell, 0).toLocaleString()})` : ''}</button></div>`;
  }
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 쉼터</button><h2>🛒 상점</h2><div class="pills">${coinsPill()}</div></div>
    ${hasArt('shop') ? `<img class="rest-art" src="${artUrl('shop')}" alt="" />` : ''}
    <div class="tabs"><button class="btn small ${tab === 'buy' ? 'on' : ''}" data-tab="buy">사기</button><button class="btn small ${tab === 'sell' ? 'on' : ''}" data-tab="sell">팔기</button></div>
    ${body}`,
    `bg-${regionOf(region || REGIONS).ground}`,
  );
  on(root, '#back', back);
  on(root, '[data-tab]', (el) => showShop(region, el.dataset.tab as 'buy' | 'sell'));
  on(root, '[data-buy]', (el) => void act(() => api.buy(el.dataset.buy!, Number(el.dataset.n)), redraw, 'coin'));
  on(root, '[data-id]', (el) => itemPopup(el.dataset.id!, 'sell', redraw));
  on(root, '#bulk', () => bulk('sell', redraw));
}

/** 대장간: 강화(+1~+9, 항상 성공) · 분해(→ 강화석) */
function showSmith(region: number) {
  const redraw = () => showSmith(region);
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 쉼터</button><h2>⚒️ 대장간</h2><div class="pills">${stonesPill()}${coinsPill()}</div></div>
    ${hasArt('forge') ? `<img class="rest-art" src="${artUrl('forge')}" alt="" />` : ''}
    <div class="card"><h3>장비 고르기 <small>강화는 엽전 + 강화석, 항상 성공해요</small></h3>${grid(profile.items, '장비가 없어요')}
      <p class="soft">+${MAX_PLUS}까지 올리면 다음 등급 일반 장비와 비슷해져요. 안 쓰는 장비는 분해해서 강화석으로 바꿔요 (강화한 단계마다 +1)</p>
      <button class="btn small bulk" id="bulk" ${spareItems().length ? '' : 'disabled'}>🧹 일반 장비 모두 분해${spareItems().length ? ` (${spareItems().length}개 · ${IC.stone} ${spareItems().reduce((n, it) => n + scrapOf(itemDef(it.base)!, it.plus), 0)})` : ''}</button></div>`,
    `bg-${regionOf(region || REGIONS).ground}`,
  );
  on(root, '#back', () => showRegion(region));
  on(root, '[data-id]', (el) => itemPopup(el.dataset.id!, 'smith', redraw));
  on(root, '#bulk', () => bulk('scrap', redraw));
}
