import Phaser from 'phaser';
import { artUrl, heroFaceUrl, heroFullUrl } from '../assets';
import { skillLevelMul } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { BAG, MAX_PLUS, POTION, POTION_NAME, bagPrice, enhanceCost } from '../data/economy';
import { expNeed, playerStats } from '../data/growth';
import { HEROES, STAT_KEYS, STAT_NAME, heroOf, isHero, type HeroId } from '../data/heroes';
import { ACC_TEXT, FX_DESC, FX_NAME, ITEMS, SLOTS, SLOT_NAME, canEnhance, itemDef, itemLevel, itemNote, itemStats, normalWeapon, regionRares, type Item, type Slot } from '../data/items';
import { MAPS, mapOf, mapsOf, nextMap, type MapDef } from '../data/maps';
import { ENV_ICON, ENV_NAME, MAPS_PER_REGION, MODE_NAME, REGIONS, REGION_TABLE, mapLevel, regionOf } from '../data/regions';
import { TOWER, floorKind, towerFloor, towerRegion } from '../data/tower';
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
  hasKey,
  heroesOf,
  isEquipped,
  itemOf,
  joinText,
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
import { ApiError, type TwelveApi } from '../net/api';
import { DEV_ALL, DEV_GOD, DEV_HERO, DEV_LEVEL, DEV_MAP, DEV_WEAPON, LOCAL_MODE } from '../net/local';
import { buyCharacter, loadOwnedCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W, dropIcon, dropName } from '../scenes/GameScene';
import { groundOf, hasArt } from '../scenes/art';
import { COLOR, css } from '../theme';
import { createControls, type Controls } from './controls';

/**
 * 메인 → 십이지 지도 → 지형(쉼터 + 맵 8개) → 맵(전투) → 결과 (PRD '화면 구성').
 * 기록은 net/api.ts 로만 바뀐다 (지금은 기기 저장, 5단계에서 서버).
 */

let api!: TwelveApi;
let profile: TwelveProfile = emptyProfile();
/** 로그인한 사람 (테스트 모드는 null) */
let me: WorldUser | null = null;
/** 고양이를 이 게임에서 샀는지 (shared/characters.js — 게임마다 따로 산다). 테스트 모드에서는 늘 false */
let cat = false;
/** 지금 고를 수 있는 대원 */
const myHeroes = () => heroesOf(profile, cat);
/** 개발 옵션(?map= · lv= · god= · all= · hero= · weapon=)으로 하는 판은 기록하지 않는다 */
const DEV_PLAY = DEV_ALL || DEV_GOD || DEV_LEVEL > 0 || !!DEV_HERO || !!DEV_WEAPON || !!DEV_MAP;

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
  return root.firstElementChild as HTMLElement;
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
const coinsPill = () => `<span class="coins-pill">🪙 ${profile.coins.toLocaleString()}</span>`;
const levelPill = () => `<span class="coins-pill lv-pill">Lv ${profile.level}</span>`;
const STAR_LABEL: [number, string][] = [[STAR_TIME, '시간 안에'], [STAR_NO_DEATH, '안 쓰러지고'], [STAR_CHEST, '숨은 상자']];
const starsHtml = (bits: number) => `<span class="stars">${STAR_LABEL.map(([b]) => `<i class="${bits & b ? 'on' : ''}">★</i>`).join('')}</span>`;
const face = (id: HeroId) => (heroOf(id).hidden ? `<span class="face emoji">${heroOf(id).unique.icon}</span>` : `<img class="face" src="${heroFaceUrl(id)}" alt="${heroOf(id).name}" />`);
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
  if (DEV_ALL) for (const m of MAPS) v.maps.normal[m.id] ??= { stars: 0, clears: 1, best: 0 };
  if (isHero(DEV_HERO)) v.hero = DEV_HERO;
  // ?weapon=bow: 가방에 있는 그 종류의 무기를 든다 (없으면 나무 칼)
  if ((WEAPON_KINDS as readonly string[]).includes(DEV_WEAPON)) {
    const it = v.items.find((x) => !x.box && itemDef(x.base)?.kind === DEV_WEAPON) ?? v.items.find((x) => x.base === normalWeapon('sword', 0));
    if (it) v.eq.weapon = it.id;
  }
  return v;
}

/** 처음 한 번: 기록을 불러온다 */
export async function boot(a: TwelveApi, user: WorldUser | null) {
  api = a;
  me = user;
  loadSettings();
  profile = view(await api.loadProfile());
  if (!LOCAL_MODE) {
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
  let seen = true;
  try {
    seen = !!localStorage.getItem(INTRO_KEY);
  } catch {
    /* 못 읽으면 건너뛴다 */
  }
  if (!seen && !DEV_PLAY && !Object.keys(profile.maps.normal).length) return showIntro(showMain);
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

function showIntro(done: () => void) {
  let i = 0;
  const end = () => {
    mark(INTRO_KEY, '1');
    done();
  };
  const paint = () => {
    const sc = STORY[i];
    const name = `story-${i + 1}` as 'story-1';
    const root = screen(`
      <div class="bar"><div class="spacer"></div><button class="btn small" id="skip">건너뛰기 ▶▶</button></div>
      <div class="grow"></div>
      <div class="story-art ${sc.bg}">${hasArt(name) ? `<img class="story-img" src="${artUrl(name)}" alt="" />` : sc.art()}</div>
      <div class="card story-text"><p>${sc.text}</p><div class="story-dots">${STORY.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div></div>
      <button class="btn primary big" id="next">${i === STORY.length - 1 ? '출발!' : '다음 ▶'}</button>
      <div class="grow"></div>`);
    on(root, '#skip', end);
    on(root, '#next', () => (++i < STORY.length ? paint() : end()));
  };
  paint();
}

// ---------- 메인 ----------

export function showMain() {
  const hero = heroOf(profile.hero);
  const next = continueMap(profile);
  const nm = next ? mapOf(next) : null;
  const need = expNeed(profile.level);
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${levelPill()}${coinsPill()}</div></div>
    <div class="title"><h1>시아열두길</h1><p>열두 지형의 요괴를 베고 열쇠를 모아라!</p></div>
    <div class="card me">
      ${face(hero.id)}
      <div class="me-info"><b>${hero.name} <small>${hero.animal} · ${WEAPONS[weaponOf(profile)].icon} ${equipName('weapon')}</small></b>
        <div class="lv"><i style="width:${need ? Math.min(100, (profile.exp / need) * 100) : 100}%"></i></div>
        <span class="soft">Lv ${profile.level}${need ? ` · 경험치 ${profile.exp.toLocaleString()} / ${need.toLocaleString()}` : ' (최고 레벨)'} · ${MODE_NAME[profile.mode]} 모드</span></div>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">▶ 이어하기${nm ? ` <small>${nm.id} ${nm.name}</small>` : ''}</button>
      <button class="btn big" id="world">🗺️ 십이지 지도</button>
      <div class="row2"><button class="btn" id="heroes">🐾 대원</button><button class="btn" id="bag">🎒 가방${boxItems(profile).length ? ` <em class="tag">보관함 ${boxItems(profile).length}</em>` : ''}</button></div>
      <div class="row2"><button class="btn" id="tower">🗼 끝없는 탑${profile.tower ? ` <small>최고 ${profile.tower.floor}층</small>` : ''}</button><button class="btn" id="rank">🏆 랭킹</button></div>
      <button class="btn" id="settings">⚙️ 설정</button>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? `<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요${DEV_PLAY ? ' (개발 옵션으로 하는 판은 저장하지 않아요)' : ''}</p>` : ''}`);
  on(root, '#go', () => (nm ? showRegion(nm.region) : showWorld()));
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

function showSettings() {
  const row = (k: string, name: string, value: boolean) => `<label class="set-row"><span>${name}</span><button class="btn small toggle ${value ? 'on' : ''}" data-k="${k}">${value ? '켬' : '끔'}</button></label>`;
  const box = overlay(`<div class="card pop">
    <h3>설정</h3>
    ${row('sound', '소리', !(sound?.isMuted() ?? false))}
    ${row('vibrate', '진동', settings.vibrate)}
    ${row('lefty', '왼손잡이 (조이스틱과 버튼 좌우 바꾸기)', settings.lefty)}
    ${row('numbers', '피해 숫자', settings.numbers)}
    <button class="btn" id="story">📖 이야기 다시 보기</button>
    <button class="btn primary" id="ok">닫기</button></div>`);
  on(box, '#story', () => showIntro(showMain));
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
    <div class="card"><h3>${WEAPONS[weapon].icon} ${equipName('weapon')} <small>무기는 가방에서 바꿔요</small></h3><div id="wdetail"></div></div>
    <button class="btn primary big" id="save">이 대원으로</button>`);
  const paint = () => {
    const h = heroOf(pick);
    const ok = mine.includes(pick);
    const st = playerStats(loadoutOf(profile, pick), region);
    root.querySelectorAll<HTMLElement>('.hero-btn').forEach((b) => b.classList.toggle('on', b.dataset.id === pick));
    root.querySelector('#detail')!.innerHTML = `
      <h3>${h.name} <small>${h.animal} · 고향 ${h.home ? `${h.home}지형 ${regionOf(h.home).name}` : '없음'} · 잘 다루는 무기 ${WEAPONS[h.weapon].icon}${WEAPONS[h.weapon].name}</small></h3>
      <div class="stat-grid">${STAT_KEYS.map((k) => `<div class="stat"><span>${STAT_NAME[k]}</span><div class="lv"><i style="width:${Math.round(((h.stats[k] - 0.9) / 0.2) * 100)}%"></i></div><b>${k === 'crit' ? `${Math.round(st.crit * 100)}%` : Math.round(st[k])}</b></div>`).join('')}</div>
      ${profile.level >= 10 ? `<p class="soft">⭐ 스킬 강화 ${Math.floor(profile.level / 10)}단계: 스킬 피해 +${Math.round((skillLevelMul(profile.level) - 1) * 100)}% (10레벨마다 한 단계)</p>` : '<p class="soft">⭐ 10레벨마다 스킬이 한 단계 강해져요</p>'}
      <p class="skill-line"><span class="key">U</span> <b>${h.unique.icon} ${h.unique.name}</b> ${h.unique.desc} <small>마력 ${h.unique.mp} · ${h.unique.cd}초</small></p>
      ${st.home ? '<p class="soft">🏠 고향 지형: 공격·방어 +10%</p>' : ''}${region && regionOf(region).env !== 'none' && regionOf(region).counter === pick ? `<p class="soft">${ENV_ICON[regionOf(region).env]} 이 지형의 ${ENV_NAME[regionOf(region).env]}에 걸리지 않아요</p>` : ''}${st.affinity ? '<p class="soft">✨ 잘 다루는 무기: 공격 +5%</p>' : ''}
      ${ok ? '' : h.hidden ? `<p class="soft">🐱 경주에 늦어 빠진 13번째 대원이에요. 이 게임에서 따로 열어요</p><button class="btn primary" id="buycat">시아코인 ${h.price}개로 열기</button>` : `<p class="soft">🔒 ${h.join}지형 보스를 처음 잡으면 합류해요</p>`}`;
    root.querySelector('#buycat')?.addEventListener('click', async () => {
      play('click');
      const { r, text } = await buyCharacter('cat');
      toast(text, 3000);
      if (r.ok || r.reason === 'owned') {
        cat = (await loadOwnedCharacters(true))?.includes('cat') ?? true;
        showHeroes(back, region);
      }
    });
    const wd = WEAPONS[weapon];
    root.querySelector('#wdetail')!.innerHTML = `<p class="soft">${wd.desc}</p>${wd.skills.map((sk, i) => `<p class="skill-line"><span class="key">${'KL'[i]}</span> <b>${sk.icon} ${sk.name}</b> ${sk.desc} <small>마력 ${sk.mp} · ${sk.cd}초</small></p>`).join('')}`;
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
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도</h2><div class="pills">${levelPill()}</div></div>
    <div class="region-grid">${REGION_TABLE.map((r) => {
      const ready = regionReady(r.region);
      const open = ready && regionOpen(profile, r.region);
      const sub = !ready ? '준비 중' : open ? `${hasKey(profile, r.region) ? '🗝️ ' : ''}★ ${regionStarCount(profile, r.region)}/${MAPS_PER_REGION * 3}` : `🔒 ${r.region - 1}지형 보스`;
      return `<button class="region bg-${r.ground} ${open ? '' : 'locked'}" data-r="${r.region}">
          ${face(r.home)}${ready && recommended(r.region).length > 1 ? `<i class="counter">${face(r.counter)}</i>` : ''}<b>${r.region}</b><span>${r.name}</span><em>${sub}</em>
        </button>`;
    }).join('')}</div>
    <button class="btn soon final" data-soon="열쇠 12개를 모으면 열려요 (준비 중)">🗝️ 최종보스 <small>열쇠 ${profile.keys[profile.mode].length} / ${REGIONS}</small></button>
    <p class="soft center light">큰 얼굴 = 고향 대원(공격·방어 +10%) · 작은 얼굴 = 지형 환경을 막는 대원<br/>지형 보스를 잡으면 다음 지형이 열리고 대원이 합류해요</p>`);
  on(root, '#back', showMain);
  on(root, '[data-soon]', (el) => toast(el.dataset.soon!));
  on(root, '.region', (el) => {
    const r = Number(el.dataset.r);
    if (!regionReady(r)) return toast(`${regionOf(r).name}은(는) 준비 중이에요`);
    if (!regionOpen(profile, r)) return toast(`${r - 1}지형 보스를 잡아야 열려요`);
    showRegion(r);
  });
}

function showRegion(region: number) {
  const r = regionOf(region);
  const boss = BOSSES[r.boss];
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${r.name}</h2><div class="pills">${coinsPill()}</div></div>
    <div class="card rest">
      <h3>🏕️ 쉼터 <small>${r.envText}</small></h3>
      <div class="rest-row">
        <button class="btn small" id="heroes">${face(profile.hero)} 대원 바꾸기</button>
        <button class="btn small" id="shop">🛒 상점</button>
        <button class="btn small" id="smith">⚒️ 대장간</button>
        <button class="btn small" id="bag">🎒 가방${boxItems(profile).length ? ` <em class="tag">${boxItems(profile).length}</em>` : ''}</button>
      </div>
      <p class="soft rec">추천 대원 ${recommended(region).map((h) => `${face(h)} ${heroOf(h).name} <small>${[h === r.home ? '고향 +10%' : '', h === r.counter && r.env !== 'none' ? `${ENV_NAME[r.env]} 막음` : ''].filter(Boolean).join(' · ')}</small>`).join(' ')}</p>
    </div>
    <div class="stage-list">${mapsOf(region)
      .map((m) => {
        const open = mapOpen(profile, m.id);
        const lv = mapLevel(m.region, m.no, profile.mode);
        const low = profile.level < lv;
        return `<button class="btn stage-row ${m.boss ? 'boss' : ''} ${open ? '' : 'locked'}" data-id="${m.id}">
          <b>${m.id}</b><span>${m.boss ? `👹 ${boss.name}` : m.name}<small class="${low && open ? 'warn' : ''}">권장 Lv ${lv}${low && open ? ' ⚠️' : ''} · ⏱ ${time(m.par)}</small></span>
          ${open ? starsHtml(starsOfMap(profile, m.id)) : '<span>🔒</span>'}
        </button>`;
      })
      .join('')}</div>
    <div class="card">
      <h3>이 지형의 레어 <small>정예·보스가 떨어뜨려요 · ${hasKey(profile, region) ? '🗝️ 열쇠를 얻었어요' : '🗝️ 열쇠는 보스가 가끔 떨어뜨려요'}</small></h3>
      <div class="rare-list">${regionRares(region, profile.mode).map((b) => `<span class="${profile.codex.includes(b) ? 'on' : ''}">${itemDef(b)!.icon} ${itemDef(b)!.name}</span>`).join('')}</div>
      <p class="soft">★ ${regionStarCount(profile, region)} / ${MAPS_PER_REGION * 3} — 별을 모두 모으면 장신구를 하나 받아요</p>
    </div>
    <p class="soft center light">★ 시간 안에 · 안 쓰러지고 · 숨은 상자 — 따로따로 모아도 돼요<br/>${joinText(region)}</p>`,
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
}

// ---------- 맵 (전투) ----------

let game: Phaser.Game | null = null;
let controls: Controls | null = null;
let busy = false;

function closeGame() {
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
    if (!DEV_PLAY) ({ run: runId, seed } = await api.start(map.id, profile.mode, profile.hero));
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
    title: `${map.id} ${map.name}`,
    exp: true,
    time: (s) => {
      const left = map.par - s.t;
      return { text: left >= 0 ? `⏱ ${time(left)}` : `⏱ +${time(-left)}`, late: left < 0 };
    },
    quitNote: '그만하면 쓰러진 것과 같아요: 이 맵에서 얻은 엽전은 잃고 경험치는 남아요',
    locked: () => sent,
    onQuit: async (s) => {
      await finish(s);
      showRegion(map.region);
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
  const region = regionOf(map.region);
  const bossDef = map.boss ? BOSSES[region.boss] : null;
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
        run.env.id === 'mud' || run.env.id === 'wind' ? `<span class="hud-pill env ${run.env.f < 1 ? 'ok' : ''}">${ENV_ICON[run.env.id]} ${ENV_NAME[run.env.id]}${run.env.f === 0 ? ' 막음' : run.env.f < 1 ? ' 절반' : ''}</span>` : ''
      }</div>
      <canvas id="mini" width="64" height="144"></canvas>
    </div>
    ${bossDef ? `<div class="boss-bar hidden" id="boss"><b>👹 ${bossDef.name}</b><div class="gauge"><i id="bossHp"></i></div></div><div class="boss-say hidden" id="say"></div>` : ''}
    <div class="note hidden" id="note"></div>`;
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
      await o.onQuit(run);
    });
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
    height: H,
    backgroundColor: look.wall,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { keyboard: false, mouse: false, touch: false },
    scene: [],
    banner: false,
  });
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
      onEnd: (s: RunState) => void o.onEnd(s),
    },
  });
}

/** 결과 화면의 얻은 것: 레어·열쇠는 크게 (PRD '화면 구성' 5) */
function lootHtml(r: FinishResult): string {
  const big: string[] = [];
  const small: string[] = [];
  if (r.key) big.push(`<div class="loot-big key">🗝️ <b>지형 열쇠</b>를 얻었어요!</div>`);
  for (const it of r.items) {
    const d = itemDef(it.base);
    if (!d) continue;
    const where = it.box ? ' <small>(가방이 꽉 차서 보관함으로)</small>' : '';
    if (d.rare) big.push(`<div class="loot-big"><span class="ic">${d.icon}</span> <b>${d.name}</b>${it.base === r.starItem ? ' <small>별 24개 보상</small>' : ' <em class="tag">레어</em>'}${where}<small>${itemNote(d)}</small></div>`);
    else small.push(`<span>${d.icon} ${d.name}${where}</span>`);
  }
  if (r.stones) small.push(`<span>💎 강화석 ${r.stones}</span>`);
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
  const stars = r?.stars ?? 0;
  const box = overlay(`<div class="card pop result ${win ? 'win' : 'lose'}">
      <h2>${win ? '클리어!' : '쓰러졌어요'}</h2>
      ${
        win
          ? `<div class="big-stars">${starsHtml(stars)}</div>
             <div class="star-rows">${STAR_LABEL.map(([b, name]) => `<span class="${stars & b ? 'on' : ''}">${stars & b ? '★' : '☆'} ${name}${b === STAR_TIME ? ` (${time(s.t)} / ${time(map.par)})` : ''}</span>`).join('')}</div>`
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
      ${r?.joined ? `<div class="new-hero">${face(r.joined)}<span>${heroOf(r.joined).name}(${heroOf(r.joined).animal})가 합류했어요!${heroOf(r.joined).hello ? `<small>“${heroOf(r.joined).hello}”</small>` : ''}</span></div>` : ''}
      ${DEV_PLAY ? '<p class="soft center">개발 옵션으로 한 판이라 저장하지 않았어요</p>' : r ? '' : '<p class="soft center">기록을 저장하지 못했어요</p>'}
      <div class="btns">
        ${nextOk ? `<button class="btn primary big" id="next">다음 맵 ▶</button>` : ''}
        <button class="btn ${nextOk ? '' : 'primary big'}" id="again">${win ? '다시 하기' : '다시 도전'}</button>
        <button class="btn" id="rest">쉼터로</button>
      </div></div>`);
  if (r?.ups) play('survLevel');
  on(box, '#next', () => void startMap(next!, 0));
  on(box, '#again', () => void startMap(map, win ? 0 : deaths + 1));
  on(box, '#rest', () => showRegion(map.region));
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
      `<div class="bar"><button class="back" id="back">← 뒤로</button><h2>🗼 끝없는 탑</h2><div class="pills">${levelPill()}${coinsPill()}</div></div>
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
        <p class="soft rec">${face(profile.hero)} ${heroOf(profile.hero).name} · ${WEAPONS[weaponOf(profile)].icon} ${equipName('weapon')}</p>
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
  const run = createRun(map, profile.mode, loadoutOf(profile), { seed: (Math.random() * 0xffffffff) >>> 0, stock, god: DEV_GOD, carry: carry ?? undefined });
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
  const total = t.played + s.t;
  const used = s.used.map((r) => [...r]);
  let res: TowerFloorResult | null = null;
  let why = '';
  if (t.dev) res = applyTowerFloor(structuredClone(profile), t.dev, t.floor, Math.floor(total), used, Date.now());
  else {
    try {
      const r = await api.towerFloor(t.run, t.floor, Math.floor(total), used);
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
    t.floor++;
    void endTowerPlay(t, [], '', true);
  });
  // 보스 층이 아니면 잠깐 보여 주고 바로 다음 층으로
  if (!boss) setTimeout(next, 1800);
}

const lootOf = (items: Item[], stones: number): FinishResult =>
  ({ exp: 0, coins: 0, ups: 0, level: profile.level, stars: 0, newStars: 0, first: false, joined: null, siaCoin: false, items, stones, potions: [[0, 0, 0], [0, 0, 0]], key: false, starItem: null });

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

const stonesPill = () => `<span class="coins-pill stone-pill">💎 ${profile.stones.toLocaleString()}</span>`;
const plusText = (it: Item) => (it.plus ? ` +${it.plus}` : '');

/** 장비 한 칸 (가방 격자) */
function cell(it: Item): string {
  const d = itemDef(it.base)!;
  const low = profile.level < itemLevel(d);
  return `<button class="item-cell ${d.rare ? 'rare' : ''} ${isEquipped(profile, it.id) ? 'on' : ''} ${low ? 'low' : ''}" data-id="${it.id}">
    <span class="ic">${d.icon}</span><small>Lv ${itemLevel(d)}</small>${it.plus ? `<b>+${it.plus}</b>` : ''}${it.lock ? '<i>🔒</i>' : ''}${isEquipped(profile, it.id) ? '<em>착용</em>' : ''}
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
  if (cd) rows.push(`<div class="cmp"><span>지금 착용</span><b>${cd.icon} ${cd.name}${plusText(cur!)}${cd.stat || cd.fx ? ` · ${itemNote(cd)}` : ''}</b></div>`);
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
  if (ctx === 'sell') btns.push(`<button class="btn primary" data-a="sell" ${worn || it.lock ? 'disabled' : ''}>팔기 🪙 ${d.sell.toLocaleString()}</button>`);
  if (ctx === 'smith') {
    if (cost) btns.push(`<button class="btn primary" data-a="enhance" ${profile.coins < cost.coins || profile.stones < cost.stones ? 'disabled' : ''}>강화 +${it.plus + 1} <small>🪙 ${cost.coins.toLocaleString()} · 💎 ${cost.stones}</small></button>`);
    else if (canEnhance(d)) btns.push(`<button class="btn" disabled>최고 단계예요</button>`);
    btns.push(`<button class="btn" data-a="scrap" ${worn || it.lock ? 'disabled' : ''}>분해 💎 +${scrapOf(d, it.plus)}</button>`);
  }
  btns.push(`<button class="btn" data-a="lock">${it.lock ? '🔓 잠금 풀기' : '🔒 잠그기'}</button>`);
  const box = overlay(`<div class="card pop item-pop ${d.rare ? 'rare' : ''}">
    <h3><span class="ic">${d.icon}</span> ${d.name}${plusText(it)} ${d.rare ? '<em class="tag">레어</em>' : ''}</h3>
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
    return `<button class="eq-slot ${d?.rare ? 'rare' : ''}" ${it ? `data-id="${it.id}"` : 'disabled'}><span class="ic">${d?.icon ?? '➕'}</span><b>${d ? `${d.name}${plusText(it!)}` : `${SLOT_NAME[s]} 없음`}</b><small>${d ? (d.slot === 'acc' || d.fx ? itemNote(d) : `Lv ${itemLevel(d)}`) : ''}</small></button>`;
  };
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>가방</h2><div class="pills">${stonesPill()}${coinsPill()}</div></div>
    <div class="card"><h3>착용 중 <small>공격 ${Math.round(st.atk)} · 체력 ${st.hp} · 방어 ${Math.round(st.def)}</small></h3><div class="eq-row">${SLOTS.map(slot).join('')}</div></div>
    <div class="card"><h3>가방 <small>${mine.length} / ${profile.bag}칸 · 눌러서 비교·착용·잠금</small></h3>${grid(mine, '가방이 비었어요')}</div>
    ${boxed.length ? `<div class="card"><h3>보관함 <small>${boxed.length}개 · 가방이 꽉 차서 여기로 왔어요</small></h3>${grid(boxed, '')}<button class="btn primary" id="claim">모두 가방으로</button></div>` : ''}
    <div class="card"><h3>물약</h3><div class="potion-row">${[0, 1].map((s) => POTION_NAME.map((n, z) => `<span>${s ? '💧' : '❤️'}${n} <b>${profile.potions[s][z]}</b></span>`).join('')).join('')}</div>
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
    <p class="soft center">${kind === 'sell' ? `🪙 엽전 ${gain.toLocaleString()}` : `💎 강화석 ${gain}`}을(를) 받아요.<br/>착용 중인 것, 🔒 잠근 것, 레어, 장신구, 강화한 장비와<br/>종류마다 가장 좋은 무기 하나씩은 그대로 둬요</p>
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
  const back = () => showRegion(region);
  const redraw = () => showShop(region, tab);
  let body: string;
  if (tab === 'buy') {
    const potions = [0, 1]
      .map((s) =>
        POTION_NAME.map((n, z) => {
          const have = profile.potions[s][z];
          const price = POTION.price[s][z];
          return `<div class="shop-row"><span class="ic">${s ? '💧' : '❤️'}</span><span>${s ? '마력' : '체력'} 물약(${n}) <small>${Math.round(POTION.heal[s][z] * 100)}% 회복 · 가진 수 ${have}/${POTION.max}</small></span>
            <button class="btn small" data-buy="potion:${s}:${z}" data-n="1" ${have >= POTION.max || profile.coins < price ? 'disabled' : ''}>🪙 ${price}</button>
            <button class="btn small" data-buy="potion:${s}:${z}" data-n="5" ${have + 5 > POTION.max || profile.coins < price * 5 ? 'disabled' : ''}>×5</button></div>`;
        }).join(''),
      )
      .join('');
    const gear = ITEMS.filter((d) => forSale(profile, d))
      .sort((a, b) => b.tier - a.tier)
      .map((d) => {
        const stt = itemStats(d, 0);
        return `<div class="shop-row ${profile.level < itemLevel(d) ? 'low' : ''}"><span class="ic">${d.icon}</span><span>${d.name} <small>Lv ${itemLevel(d)} · ${d.slot === 'weapon' ? `공격 ${stt.atk}` : `체력 ${stt.hp} · 방어 ${stt.def}`}</small></span>
          <button class="btn small" data-buy="${d.id}" data-n="1" ${profile.coins < d.buy ? 'disabled' : ''}>🪙 ${d.buy.toLocaleString()}</button></div>`;
      })
      .join('');
    const bagRow =
      profile.bag >= BAG.max
        ? `<div class="shop-row"><span class="ic">🎒</span><span>가방 <small>${profile.bag}칸 (더 늘릴 수 없어요)</small></span></div>`
        : `<div class="shop-row"><span class="ic">🎒</span><span>가방 늘리기 <small>${profile.bag}칸 → ${profile.bag + BAG.step}칸</small></span>
          <button class="btn small" data-buy="bag" data-n="1" ${profile.coins < bagPrice(profile.bag) ? 'disabled' : ''}>🪙 ${bagPrice(profile.bag).toLocaleString()}</button></div>`;
    body = `<div class="card"><h3>물약</h3>${potions}</div>
      <div class="card"><h3>일반 장비 <small>열린 지형까지의 등급 (착용 Lv ${TIER_LEVELS[top]}까지) · 가방 ${bagCount(profile)}/${profile.bag}</small></h3>${gear}</div>
      <div class="card"><h3>가방</h3>${bagRow}</div>`;
  } else {
    const list = profile.items.filter((it) => !isEquipped(profile, it.id));
    const spare = spareItems();
    body = `<div class="card"><h3>팔 장비 고르기 <small>착용 중인 것과 🔒 잠근 것은 팔 수 없어요</small></h3>${grid(list, '팔 장비가 없어요')}
      <button class="btn small bulk" id="bulk" ${spare.length ? '' : 'disabled'}>🧹 일반 장비 모두 팔기${spare.length ? ` (${spare.length}개 · 🪙 ${spare.reduce((n, it) => n + itemDef(it.base)!.sell, 0).toLocaleString()})` : ''}</button></div>`;
  }
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 쉼터</button><h2>🛒 상점</h2><div class="pills">${coinsPill()}</div></div>
    <div class="tabs"><button class="btn small ${tab === 'buy' ? 'on' : ''}" data-tab="buy">사기</button><button class="btn small ${tab === 'sell' ? 'on' : ''}" data-tab="sell">팔기</button></div>
    ${body}`,
    `bg-${regionOf(region).ground}`,
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
    <div class="card"><h3>장비 고르기 <small>강화는 엽전 + 강화석, 항상 성공해요</small></h3>${grid(profile.items, '장비가 없어요')}
      <p class="soft">+${MAX_PLUS}까지 올리면 다음 등급 일반 장비와 비슷해져요. 안 쓰는 장비는 분해해서 강화석으로 바꿔요 (강화한 단계마다 +1)</p>
      <button class="btn small bulk" id="bulk" ${spareItems().length ? '' : 'disabled'}>🧹 일반 장비 모두 분해${spareItems().length ? ` (${spareItems().length}개 · 💎 ${spareItems().reduce((n, it) => n + scrapOf(itemDef(it.base)!, it.plus), 0)})` : ''}</button></div>`,
    `bg-${regionOf(region).ground}`,
  );
  on(root, '#back', () => showRegion(region));
  on(root, '[data-id]', (el) => itemPopup(el.dataset.id!, 'smith', redraw));
  on(root, '#bulk', () => bulk('scrap', redraw));
}
