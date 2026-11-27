import Phaser from 'phaser';
import { artUrl, cardUrl, zodiacFaceUrl } from '../assets';
import { hasArt, type OptionalArt } from '../artlist';
import { TABLE, css } from '../theme';
import { COMBO_LEVELS, TOWER_BOSS_COINS, TOWER_FLOOR_COINS, UPGRADES, levelCost, levelOf, upgradeCost, upgradeLv } from '../data/growth';
import { REGIONS, REGION_NAMES, groundOf } from '../data/regions';
import {
  emptyProfile,
  heroesOf,
  loadParty,
  partyOf,
  regionOpen,
  regionStars,
  regionStarsOf,
  saveParty,
  stageOpen,
  totalStars,
  towerOpen,
  whyText,
  UNLOCK_LABEL,
  UNLOCK_CONFIRM,
  unlockText,
  catReady,
  catConditionText,
  CAT_CONDITION_SHORT,
  extraOpen,
  type FingerProfile,
  type FinishResult,
} from '../game/progress';
import { HINT_USES, hintMode } from '../game/hint';
import { dailyChallenge, dailyDetailText, dailyLevels, dailySeed, dayLabel, localDay, type DailyChallenge, type DailyRanking } from '../game/daily';
import { ApiError, type FingerApi, type StageBests } from '../net/api';
import { DEV_ALL, DEV_AUTO, LOCAL_MODE } from '../net/local';
import { loadDaily, loadOwnedCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import {
  BOSSES,
  BOSS_IDS,
  ENEMIES,
  HEROES,
  ALL_HERO_IDS,
  EXTRA_HERO_IDS,
  isExtraHero,
  HERO_IDS,
  MAX_LEVEL,
  STAGES,
  buildConfig,
  chiefDef,
  createRun,
  heroStats,
  resultOf,
  stageOf,
  stagesOf,
  towerFloor,
  TOWER_TURNS,
  type HeroId,
  type RunResult,
  type RunState,
  type StageDef,
  type UpgradeKey,
  FINGER_RULES,
} from '../sim';

/**
 * 판 밖 화면 (돌격대 app.ts 방식, HTML): 메인 → 십이지 지도 → 스테이지 목록 → 파티 고르기 → 판 → 결과, 대원(레벨) · 강화.
 * 기록은 서버(067_finger.sql 의 RPC + Edge Function finger-finish)로만 바뀐다. 테스트 모드(?local=1)는 기기에만 저장한다.
 */

let api!: FingerApi;
let me: WorldUser | null = null;
let profile: FingerProfile = emptyProfile();
/** 마지막 파티 (쏘는 순서, 기기에만 기억) */
let lastParty: HeroId[] = [];
const userKey = () => me?.userId ?? 'local';

let sound: SoundModule | null = null;
/** 지금 틀려는 배경음 장면 (공용 소리 모듈이 늦게 읽혀도 읽히자마자 이 곡을 튼다) */
type BgmScene = 'main' | 'boss' | 'win' | 'lose';
let bgmScene: BgmScene = 'main';
void loadSound()
  .then((m) => {
    sound = m;
    bgm(bgmScene);
  })
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);
/** 배경음 (shared/audio/bgm/finger/): 메뉴·판 = main, 보스가 있는 웨이브·층 = boss, 판 결과 = win/lose. 소리 모듈이 없으면(로컬·오프라인) 아무 일도 없다 */
function bgm(scene: BgmScene) {
  bgmScene = scene;
  try {
    sound?.playBgm('finger', scene);
  } catch {
    /* 옛 shared/sound.js (playBgm 없음) */
  }
}

const app = () => document.getElementById('app')!;

/** 화면 배경 그림(bg-*)이 있으면 위쪽에 깔 그림 주소 (CSS 변수 --bg-art). 못 읽으면 지금처럼 단색 배경 */
const bgStyle = (bg: string) => (bg.startsWith('bg-') && hasArt(bg as OptionalArt) ? ` has-art" style="--bg-art: url('${artUrl(bg)}')` : '');

/** 메뉴 버튼 아이콘: 그림(ui-*)이 있으면 그림, 없거나 못 읽으면 이모지 */
const menuIcon = (name: OptionalArt, emoji: string) =>
  hasArt(name) ? `<img class="mi" src="${artUrl(name)}" alt="" onerror="this.outerHTML='${emoji}'" />` : emoji;

/** 화면 머리 그림 (스테이지 목록·끝없는 탑): 지역 그림을 액자처럼. 못 읽으면 빠진다 */
const sceneArt = (bg: string) => (hasArt(bg as OptionalArt) ? `<img class="scene-art" src="${artUrl(bg)}" alt="" onerror="this.remove()" />` : '');

/** bg = 배경 class (bg-<지역> · bg-tower). backdrop 이면 그 그림을 화면 위쪽에 깐다 (머리 그림을 따로 넣는 화면은 false) */
/** 파티 칸 구슬: 구슬 그림(h-<id>)이 있으면 그것 (판 아래 대원 줄과 같은 그림), 없거나 못 읽으면 얼굴 + 타입 색 테두리 */
const ballImg = (id: HeroId) =>
  hasArt(`h-${id}`)
    ? `<img src="${artUrl(`h-${id}`)}" alt="" class="ball-art" onerror="this.onerror=null;this.src='${zodiacFaceUrl(id)}';this.className='ball ${HEROES[id].type}'" />`
    : `<img src="${zodiacFaceUrl(id)}" alt="" class="ball ${HEROES[id].type}" />`;

/** 연 추가 대원이 바뀌었을 때 지금 화면을 다시 그린다 (파티 고르기 화면만 — 다른 화면은 다음에 열 때 반영) */
let onOwnedChange: (() => void) | null = null;

function screen(html: string, bg = '', backdrop = true): HTMLElement {
  onOwnedChange = null;
  const root = app();
  root.innerHTML = `<div class="screen ${bg}${backdrop ? bgStyle(bg) : ''}">${html}</div>`;
  const el = root.firstElementChild as HTMLElement;
  soundButton(el);
  // 메뉴 화면은 모두 main (판 결과 창에서 메뉴·다시하기로 돌아오면 여기서 다시 main)
  bgm('main');
  return el;
}

export function toast(text: string, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.getElementById('stage')!.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const starsHtml = (n: number) => `<span class="stars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;
const starPill = () => `<span class="coins-pill star-pill">★ ${totalStars(profile)}</span>`;
const coinsPill = () => `<span class="coins-pill">🪙 ${profile.coins.toLocaleString()}</span>`;
/** 아직 합류하지 않은 십이지 대원의 안내 (추가 대원 고양이는 지역이 아니라 '시아코인으로 열기' 버튼) */

// ---------- 스테이지 최소 턴 · 1등 (080 finger_stage_bests) ----------

/** 마지막으로 받은 표 (스테이지 목록 · 결과 화면이 같이 쓴다). 테스트 모드 · 받지 못한 때는 비어 있어 아무것도 안 보인다 */
let bests: StageBests = {};
/** 표를 한 번이라도 받았는가 (받은 적이 없으면 방금 기록을 미리 넣지 않는다 — 내 기록 하나만으로 '내가 1등' 이라 그리지 않게) */
let bestsLoaded = false;
const escHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** "내 최소 12턴 · 1등 ○○ 10턴" (기록이 없으면 빈 글) */
function bestText(id: string): string {
  const b = LOCAL_MODE ? undefined : bests[id];
  if (!b) return '';
  const top = b.me ? '내가 1등' : `1등 ${escHtml(b.name)} ${b.top}턴`;
  return b.mine != null ? `내 최소 ${b.mine}턴 · ${top}` : top;
}
/** 서버에서 다시 받는다 → 받았으면 true (실패하면 조용히 그대로) */
async function refreshBests(): Promise<boolean> {
  if (LOCAL_MODE) return false;
  try {
    bests = await api.stageBests();
    bestsLoaded = true;
    return true;
  } catch {
    return false;
  }
}
/** 방금 기록된 클리어를 서버 답을 기다리지 않고 표에 먼저 넣는다 (동점이면 먼저 달성한 사람이 1등이라 그대로) */
function noteBest(id: string, turns: number) {
  if (LOCAL_MODE || !bestsLoaded || !(turns > 0)) return;
  const b = bests[id];
  const mine = b?.mine != null ? Math.min(b.mine, turns) : turns;
  if (!b || turns < b.top) bests[id] = { mine, top: turns, name: me?.nickname ?? '', me: true };
  else bests[id] = { ...b, mine };
}

const lockHint = (id: HeroId, long: boolean) => (long ? `${HEROES[id].unlockRegion}지역 보스를 깨면 합류` : `${HEROES[id].unlockRegion}지역`);

let unlocking = false;
/**
 * 고양이 '시아코인 100개로 열기': 첫 번째 누름은 글을 "한 번 더 누르기" 로 4초간 바꾸고, 그 안에 한 번 더 누르면 산다.
 * 사는 동안 버튼을 막아 두 번 사지 않게. 열렸으면(이미 연 경우 포함) 새 프로필을 받고 opened(true).
 */
async function askUnlock(btn: HTMLButtonElement, label: HTMLElement, id: HeroId, opened: (ok: boolean) => void) {
  if (unlocking) return;
  const until = Number(btn.dataset.confirm ?? 0);
  if (until < Date.now()) {
    play('click');
    btn.dataset.confirm = String(Date.now() + 4000);
    label.textContent = UNLOCK_CONFIRM;
    btn.classList.add('confirm');
    setTimeout(() => {
      if (!btn.isConnected || unlocking || Number(btn.dataset.confirm ?? 0) > Date.now()) return;
      delete btn.dataset.confirm;
      label.textContent = `🔒 ${UNLOCK_LABEL}`;
      btn.classList.remove('confirm');
    }, 4050);
    return;
  }
  unlocking = true;
  btn.disabled = true;
  delete btn.dataset.confirm;
  label.textContent = '여는 중…';
  try {
    const { answer, profile: p } = await api.unlock(id);
    if (p) setProfile(p);
    const ok = !!p && extraOpen(profile, id);
    if (ok) play('coin');
    toast(unlockText(answer));
    opened(ok);
  } finally {
    unlocking = false;
  }
}
const typeName = (id: HeroId) => (HEROES[id].type === 'pierce' ? '관통형' : '반사형');
const typeTag = (id: HeroId) => `<em class="tag ${HEROES[id].type}">${typeName(id)}</em>`;
const errText = (e: unknown) => (e instanceof ApiError ? whyText(e.message) : '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요');

function soundButton(root: HTMLElement) {
  const b = document.createElement('button');
  b.className = 'icon-btn sound-btn';
  // ⚙️ 소리 설정 창: 배경음·효과음을 따로 켜고 끈다 (시아레이스와 같은 공용 창)
  b.textContent = '⚙️';
  b.setAttribute('aria-label', '소리 설정');
  b.title = '소리 설정';
  b.addEventListener('click', () => sound?.openSoundSettings());
  // 위 줄(.bar)이 있으면 그 끝에 둔다: 떠 있는 버튼이 아래쪽 큰 버튼·목록 마지막 줄을 가리지 않게 (작은 아이폰 포함)
  const bar = root.querySelector('.bar');
  if (bar) {
    b.classList.remove('sound-btn');
    bar.appendChild(b);
  } else root.appendChild(b);
}

/** 처음 한 번: 기록을 불러오고, 못 보낸 결과가 있으면 다시 보낸다 */
export async function boot(a: FingerApi, user: WorldUser | null) {
  api = a;
  me = user;
  profile = await api.loadProfile();
  lastParty = loadParty(userKey());
  watchOwned();
  if (DEV_ALL) {
    // 개발용 ?local=1&all=1: 모든 스테이지·대원을 연 상태로 본다 (기록하지 않음)
    profile = { ...profile, coins: Math.max(profile.coins, 99999), stages: Object.fromEntries(STAGES.map((s) => [s.id, 3])) };
    for (let r = 1; r <= REGIONS; r++) profile.stages[`${r}-5`] = 3;
  }
  void api
    .resend()
    .then(async (n) => {
      if (n > 0) {
        setProfile(await api.loadProfile());
        toast(`못 보낸 기록 ${n}판을 올렸어요`);
      }
    })
    .catch(() => null);
}

/**
 * 다른 기기(다른 탭)에서 시아핑거의 고양이를 열고 돌아오면 새로고침 없이 쓸 수 있게: 화면이 다시 보일 때 연 캐릭터를 다시 묻는다.
 * 잠김 → 열림만 반영한다 (통신 실패 null 이면 그대로 두고, 열린 것을 닫지는 않는다 — 서버가 시작 때 다시 검사).
 * (처음 값은 서버 프로필의 owned. 테스트 모드는 ?cat=0 이 아니면 연 것으로 본다)
 */
function watchOwned() {
  if (LOCAL_MODE) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void loadOwnedCharacters(true).then((list) => {
      if (!list) return;
      const owned = EXTRA_HERO_IDS.filter((id) => list.includes(id) || profile.owned.includes(id));
      if (owned.length === profile.owned.length) return;
      profile = { ...profile, owned };
      onOwnedChange?.();
    });
  });
}

/** 서버가 준 새 프로필 (개발용 ?all=1 은 기기에서 연 상태를 그대로 두고 엽전·레벨·강화만) */
function setProfile(p: FingerProfile) {
  profile = DEV_ALL ? { ...p, coins: Math.max(p.coins, 99999), stages: profile.stages } : p;
}

// ---------- 메인 ----------

export function showMain() {
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${starPill()}${coinsPill()}</div><button class="icon-btn" id="help" aria-label="하는 법">❓</button></div>
    <div class="title"><h1>시아핑거</h1><p>당겼다 놓아 튕겨서 요괴를 부숴라!</p></div>
    <img class="hero thumb" src="${hasArt('main') ? artUrl('main') : cardUrl()}" alt="" ${hasArt('main') ? `onerror="this.onerror=null;this.src='${cardUrl()}'"` : ''} />
    <div class="card">
      <h3>파티 <small>쏘는 순서</small></h3>
      <div class="party-mini">${partyOf(profile, lastParty)
        .map((id, i) => `<span><img src="${zodiacFaceUrl(id)}" alt="" /><b>${i + 1}</b>${HEROES[id].name} Lv${levelOf(profile.levels, id)}</span>`)
        .join('')}</div>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">${menuIcon('ui-go', '⚔️')} 모험 떠나기</button>
      <div class="row2 row3">
        <button class="btn" id="heroes">${menuIcon('ui-heroes', '🐭')} 대원</button>
        <button class="btn" id="up">${menuIcon('ui-up', '💪')} 강화</button>
        <button class="btn" id="rank">${menuIcon('ui-rank', '🏆')} 랭킹</button>
      </div>
      <div class="row2">
        <button class="btn ${towerOpen(profile) ? '' : 'soon'}" id="tower">${menuIcon('ui-tower', '🏯')} 끝없는 탑 ${towerOpen(profile) ? (profile.tower ? `<small>${profile.tower.floor}층</small>` : '') : '🔒'}</button>
        <button class="btn" id="daily">📅 오늘의 도전</button>
      </div>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요</p>' : ''}`);
  // 짧은 화면(아이폰 SE 가로 375 × 세로 553 등)에서 한 화면에 들어오게 줄이는 규칙을 메인에만 건다 (style.css .screen.home)
  root.classList.add('home');
  const on = (sel: string, fn: () => void) =>
    root.querySelector(sel)!.addEventListener('click', () => {
      play('click');
      fn();
    });
  on('#go', showRegions);
  on('#heroes', showHeroes);
  on('#up', showUpgrades);
  on('#tower', () => (towerOpen(profile) ? showTower() : toast('끝없는 탑은 1-5 를 깨면 열려요')));
  on('#help', showHelp);
  on('#daily', () => void showDaily());
  root.querySelector('#rank')!.addEventListener('click', async () => {
    play('click');
    if (LOCAL_MODE || !me) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(me.userId))) toast('랭킹을 불러오지 못했어요');
  });
}

function showHelp() {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop help">
    <h3>하는 법</h3>
    <ul>
      <li>화면 <b>아무 곳이나 누른 채 당기면</b> 반대쪽으로 점선이 보여요. 놓으면 대원이 날아가요. 많이 당길수록 세게 날아가요.</li>
      <li>당기다가 <b>처음 누른 자리로 돌아와 놓으면</b> 취소돼요.</li>
      <li><b class="blue">반사형</b>은 요괴에서 튕겨 나오고, <b>관통형</b>은 요괴를 뚫고 지나가요.</li>
      <li>날아가다 <b>가만히 있는 아군을 스치면</b> 그 아군이 우정 콤보를 쏴요.</li>
      <li>요괴 머리 위 숫자가 0이 되면 공격해요. <b class="red">빨간 원</b>은 다음에 공격이 떨어질 곳이에요.</li>
      <li>필살기 게이지가 차면 그 대원 차례에 <b>필살기 버튼</b>(PC는 스페이스)을 누르고 쏘세요.</li>
      <li>보스는 <b>노란 점(등 뒤)</b>을 맞히면 피해가 3배예요. 날아가는 동안 화면을 누르고 있으면 2배속.</li>
      <li>엽전으로 <b>대원 레벨</b>을 올리고 <b>강화</b>하면 더 강해져요. 지역 보스를 깨면 새 대원이 합류해요.</li>
    </ul>
    <button class="btn primary" id="ok">알겠어요</button></div>`;
  app().appendChild(box);
  box.querySelector('#ok')!.addEventListener('click', () => {
    play('click');
    box.remove();
  });
}

// ---------- 대원 (레벨 올리기) ----------

/** 우정 콤보 단계: 1단계 + 레벨 10 · 20 · 30 에 한 단계씩 */
const tiersHtml = (lv: number) =>
  `<span class="tiers">우정 콤보 ${1 + Math.floor(lv / 10)}단계 ${COMBO_LEVELS.map((l) => `<i class="${lv >= l ? 'on' : ''}">Lv${l}</i>`).join('')}</span>`;

function heroCard(id: HeroId, open: boolean) {
  const d = HEROES[id];
  const lv = levelOf(profile.levels, id);
  const st = heroStats(id, lv, profile.upgrades);
  const max = lv >= MAX_LEVEL;
  const cost = max ? 0 : levelCost(lv);
  return `<div class="card hero-row ${open ? '' : 'locked'}">
      <img src="${zodiacFaceUrl(id)}" alt="" class="ball ${d.type}" />
      <div class="hero-info hero-head"><b>${d.name} ${typeTag(id)} <span class="soft">Lv ${lv}</span></b>
        <span class="soft">체력 ${st.hp} · 공격 ${st.atk}</span></div>
      <div class="hero-info hero-more">
        <span>우정 콤보: ${d.comboName}</span>
        ${tiersHtml(lv)}
        <span>필살기: ${d.specialName} <span class="soft">(${d.charge}턴)</span></span>
        ${open ? '' : isExtraHero(id) ? (catReady(profile) ? '' : `<span class="soft">🔒 ${catConditionText(profile)}</span>`) : `<span class="soft">🔒 ${lockHint(id, true)}</span>`}</div>
      ${
        open
          ? `<button class="btn ${max ? '' : 'primary'} small" data-up="${id}" ${max || profile.coins < cost ? 'disabled' : ''}>${max ? '최대' : `Lv↑ 🪙 ${cost}`}</button>`
          : isExtraHero(id) && catReady(profile)
            ? `<button class="btn primary small unlock" data-unlock="${id}"><span>🔒 ${UNLOCK_LABEL}</span></button>`
            : ''
      }
    </div>`;
}

function showHeroes(scrollTop = 0) {
  const open = heroesOf(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>대원</h2><div class="pills">${coinsPill()}</div></div>
    <div class="up-list">${ALL_HERO_IDS.map((id) => heroCard(id, open.includes(id))).join('')}</div>
    <p class="soft center light">레벨마다 체력·공격 +4%, 레벨 10·20·30에 우정 콤보가 한 단계씩 강해져요</p>`);
  root.scrollTop = scrollTop;
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-unlock]').forEach((b) =>
    b.addEventListener('click', () => void askUnlock(b, b.querySelector('span')!, b.dataset.unlock as HeroId, () => showHeroes(root.scrollTop))),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const y = root.scrollTop;
      try {
        setProfile(await api.levelUp(b.dataset.up as HeroId));
        play('coin');
      } catch (e) {
        toast(errText(e));
      }
      showHeroes(y);
    }),
  );
}

// ---------- 강화 (돌격대 강화 화면과 같은 모양) ----------

function showUpgrades() {
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>강화</h2><div class="pills">${coinsPill()}</div></div>
    <div class="up-list">${UPGRADES.map((u) => {
      const lv = upgradeLv(profile.upgrades, u.key);
      const max = lv >= u.max;
      const cost = upgradeCost(u, lv);
      return `<div class="card up-row">
          <div class="up-info"><b>${u.name}</b><span class="soft">한 단계 ${u.per}</span>
            <div class="lv"><i style="width:${(lv / u.max) * 100}%"></i></div><span class="soft">${lv} / ${u.max}</span></div>
          <button class="btn ${max ? '' : 'primary'} small" data-k="${u.key}" ${max || profile.coins < cost ? 'disabled' : ''}>${max ? '최대' : `🪙 ${cost}`}</button>
        </div>`;
    }).join('')}</div>
    <p class="soft center light">강화는 모든 대원에게 함께 적용돼요. 엽전은 스테이지를 깨면 모여요</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        setProfile(await api.buyUpgrade(b.dataset.k as UpgradeKey));
        play('coin');
      } catch (e) {
        toast(errText(e));
      }
      showUpgrades();
    }),
  );
}

// ---------- 지역 지도 · 스테이지 ----------

function showRegions() {
  const ts = totalStars(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도</h2><div class="pills">${starPill()}</div></div>
    <div class="region-grid">${Array.from({ length: REGIONS }, (_, i) => {
      const r = i + 1;
      const ready = stagesOf(r).length > 0;
      const open = ready && regionOpen(profile, r);
      const need = regionStars(r);
      const sub = !ready ? '준비 중' : open ? `★ ${regionStarsOf(profile, r)}/15` : ts < need ? `🔒 ★${need}` : `🔒 ${r - 1}-5`;
      return `<button class="region bg-${groundOf(r)} ${open ? '' : 'locked'}${bgStyle(`bg-${groundOf(r)}`)}" data-r="${r}">
          <img src="${zodiacFaceUrl(HERO_IDS[r - 1])}" alt="" />
          <b>${r}</b><span>${REGION_NAMES[r - 1]}</span><em>${sub}</em>
        </button>`;
    }).join('')}</div>
    <p class="soft center light">앞 지역 보스를 깨고, 별을 모으면 다음 지역이 열려요</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('.region').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const r = Number(b.dataset.r);
      if (!stagesOf(r).length) return toast(`${REGION_NAMES[r - 1]}은 준비 중이에요`);
      if (!regionOpen(profile, r)) {
        const need = regionStars(r);
        return toast(totalStars(profile) < need ? `별 ${need}개가 있어야 열려요 (지금 ${totalStars(profile)}개)` : `${r - 1}-5 보스를 깨야 열려요`);
      }
      showStages(r);
    }),
  );
}

/** 스테이지에 나오는 요괴 그림 (중복 없이, 보스·대장 먼저) */
function foeArts(st: StageDef): string[] {
  const out: string[] = [];
  for (const w of [...st.waves].reverse())
    for (const f of w) {
      const art = f.k === 'boss' ? BOSSES[BOSS_IDS[(st.region - 1) % BOSS_IDS.length]].art : f.k === 'chief' ? chiefDef(st.region).art : ENEMIES[f.k].art;
      if (!out.includes(art)) out.push(art);
    }
  return out;
}

/** 스테이지 목록 한 줄 설명: 장애물 · 보스 특성 */
function stageNote(st: StageDef): string {
  const out: string[] = [];
  if (st.no === 5) out.push(BOSSES[BOSS_IDS[(st.region - 1) % BOSS_IDS.length]].trait ?? '');
  const obs: string[] = [];
  if (st.blocks?.length || st.pillars?.length) obs.push('돌기둥');
  if (st.zones?.some((z) => z.k === 'thorn')) obs.push('가시밭');
  if (st.zones?.some((z) => z.k === 'board')) obs.push('빨래판');
  if (st.portals?.length) obs.push('순간이동');
  if (obs.length) out.push(obs.join('·'));
  return out.filter(Boolean).join(' · ');
}

function showStages(region: number) {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${REGION_NAMES[region - 1]}</h2><div class="pills">${coinsPill()}</div></div>
    ${sceneArt(`bg-${groundOf(region)}`)}
    <div class="stage-list">${stagesOf(region)
      .map((st) => {
        const open = stageOpen(profile, st.id);
        return `<button class="btn stage-row ${open ? '' : 'locked'} ${st.no === 5 ? 'boss' : ''}" data-id="${st.id}">
            <b>${st.id}</b>
            <span class="st-mid"><span>${open ? st.name : '🔒 앞 스테이지를 깨면 열려요'}</span>${open && stageNote(st) ? `<small class="st-note">${stageNote(st)}</small>` : ''}${open ? `<small class="st-best" data-best="${st.id}">${bestText(st.id)}</small>` : ''}
              <span class="foes">${foeArts(st)
                .slice(0, 4)
                .map((a) => `<img src="${artUrl(a)}" alt="" />`)
                .join('')}<em class="tag ${st.tip}">${st.tip === 'pierce' ? '관통형' : '반사형'} 유리</em></span></span>
            ${starsHtml(profile.stages[st.id] ?? 0)}
          </button>`;
      })
      .join('')}</div>
    <div class="grow"></div>`,
    `bg-${groundOf(region)}`,
    false,
  );
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showRegions();
  });
  // 최소 턴 · 1등: 먼저 가진 표로 그리고, 새로 받으면 고친다 (다른 화면으로 넘어갔으면 그만둔다)
  void refreshBests().then((ok) => {
    if (!ok || !root.isConnected) return;
    root.querySelectorAll<HTMLElement>('.st-best').forEach((el) => (el.innerHTML = bestText(el.dataset.best!)));
  });
  root.querySelectorAll<HTMLButtonElement>('.stage-row').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const st = stageOf(b.dataset.id!);
      if (!st) return;
      if (!stageOpen(profile, st.id)) return toast('앞 스테이지를 먼저 깨 주세요');
      showParty(st);
    }),
  );
}

// ---------- 파티 고르기 ----------

/** 파티 고르기: 스테이지 st, 또는 null 이면 끝없는 탑 */
function showParty(st: StageDef | null) {
  let open = heroesOf(profile);
  let party = partyOf(profile, lastParty);
  let focus: HeroId = party[0] ?? open[0];
  const root = screen(
    `<div class="bar"><button class="back" id="back">← ${st ? st.id : '끝없는 탑'}</button><h2>파티 고르기</h2><div class="spacer"></div></div>
    <div class="card"><h3>쏘는 순서 <small>칸을 누르면 빠져요</small></h3><div class="party-slots" id="slots"></div></div>
    <div class="card"><h3>대원 <small>누르면 빈 칸에 들어가요</small></h3><div class="pick-grid" id="pick"></div><div id="info" class="hero-info pick-info"></div></div>
    <div class="grow"></div>
    <button class="btn primary big" id="start">${st ? `⚔️ ${st.id} 출발!` : '🏯 탑 오르기!'}</button>`,
    st ? `bg-${groundOf(st.region)}` : 'bg-tower',
  );
  const paint = () => {
    open = heroesOf(profile);
    // 잠긴 대원(열지 않은 고양이 등)은 파티에서 뺀다
    party = party.filter((id) => open.includes(id));
    if (!open.includes(focus)) focus = party[0] ?? open[0];
    root.querySelector('#slots')!.innerHTML = [0, 1, 2, 3]
      .map((i) => {
        const id = party[i];
        return id
          ? `<button class="slot" data-i="${i}"><i>${i + 1}</i>${ballImg(id)}<b>${HEROES[id].name}</b></button>`
          : `<button class="slot empty" data-i="${i}"><i>${i + 1}</i><span>빈 칸</span></button>`;
      })
      .join('');
    root.querySelector('#pick')!.innerHTML = ALL_HERO_IDS.map((id) => {
      const ok = open.includes(id);
      const at = party.indexOf(id);
      return `<button class="leader ${at >= 0 ? 'on' : ''} ${ok ? '' : 'locked'} ${isExtraHero(id) ? 'extra' : ''} ${id === focus ? 'focus' : ''}" data-id="${id}" ${ok || isExtraHero(id) ? '' : 'disabled'}>
          <img src="${zodiacFaceUrl(id)}" alt="${HEROES[id].name}" /><b>${HEROES[id].name}</b>${ok ? (at >= 0 ? `<em>${at + 1}번</em>` : '') : `<em>🔒 ${isExtraHero(id) ? (catReady(profile) ? UNLOCK_LABEL : CAT_CONDITION_SHORT) : lockHint(id, false)}</em>`}
        </button>`;
    }).join('');
    const d = HEROES[focus];
    root.querySelector('#info')!.innerHTML = `<b>${d.name} ${typeTag(focus)} <span class="soft">Lv ${levelOf(profile.levels, focus)}</span></b><span>우정 콤보: ${d.comboName}</span><span>필살기: ${d.specialName} <span class="soft">(${d.charge}턴)</span></span>`;
    (root.querySelector('#start') as HTMLButtonElement).disabled = party.length === 0;
    root.querySelectorAll<HTMLButtonElement>('.slot').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (!party[i]) return;
        play('click');
        party = party.filter((_, k) => k !== i);
        paint();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('#pick .leader').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id as HeroId;
        // 안 연 고양이: 이 칸이 '시아코인 100개로 열기' 버튼 (두 번 눌러 산다). 열리면 골라 둔다
        // 구매 조건(3-5 클리어)을 아직 못 넘었으면 조건과 지금 값만 알린다
        if (!open.includes(id) && !catReady(profile)) {
          play('click');
          return toast(catConditionText(profile));
        }
        if (!open.includes(id))
          return void askUnlock(b, b.querySelector('em')!, id, (ok) => {
            if (ok) {
              focus = id;
              if (!party.includes(id) && party.length < 4) party = [...party, id];
            }
            paint();
          });
        play('click');
        focus = id;
        if (!party.includes(id)) {
          if (party.length >= 4) toast('4칸이 다 찼어요. 위 칸을 눌러 빼 주세요');
          else party = [...party, id];
        }
        paint();
      }),
    );
  };
  paint();
  onOwnedChange = paint;
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    if (st) showStages(st.region);
    else showTower();
  });
  root.querySelector('#start')!.addEventListener('click', () => {
    if (!party.length) return;
    play('click');
    lastParty = party;
    saveParty(userKey(), party);
    void startGame(st ? st.id : TOWER, party);
  });
}

// ---------- 오늘의 도전 (086_finger_daily.sql · game/daily.ts · shared/daily.js) ----------

/** 그날 순위 (실패 · 테스트 모드면 null → 순위 칸을 숨긴다) */
async function dailyRanking(day: string): Promise<DailyRanking | null> {
  if (LOCAL_MODE) return null;
  try {
    const mod = await loadDaily();
    const r = (await mod?.loadDailyRanking('finger', day)) as DailyRanking | null | undefined;
    return r && Array.isArray(r.top) ? r : null;
  } catch {
    return null;
  }
}

/** 순위 칸 안쪽: 위에서부터 + 내 기록 한 줄 */
function dailyRankHtml(rk: DailyRanking): string {
  if (!rk.top.length) return '<p class="soft center">아직 기록이 없어요. 첫 기록을 남겨 보세요!</p>';
  const rows = rk.top
    .map((t) => `<li class="${t.me ? 'me' : ''}"><i>${t.place}</i><span>${escHtml(String(t.nickname ?? ''))}</span><b>${dailyDetailText(t.score, t.detail)}</b></li>`)
    .join('');
  const mine = rk.mine ? `<p class="daily-mine">내 기록 <b>${dailyDetailText(rk.mine.score, rk.mine.detail)}</b> · ${rk.mine.place}위 <span class="soft">(${rk.total}명 중)</span></p>` : '<p class="soft center">아직 내 기록이 없어요</p>';
  return `<ol class="daily-rank">${rows}</ol>${mine}`;
}

const NO_DAY = '오늘 날짜를 받지 못했어요. 잠시 뒤 다시 해 주세요';
const NO_PROFILE = '내 기록을 받지 못했어요. 잠시 뒤 다시 해 주세요';
let dailyChecking = false;
/**
 * 도전하기 · 다시 도전: 누를 때 날짜를 다시 받아, 화면에 그린 날짜와 다르면 새 날짜의 판을 다시 보여 준다 (그 판은 시작하지 않는다).
 * 날짜를 못 받으면 시작하지 않는다. 테스트 모드는 기기 시계. before 는 시작 · 다시 그리기 직전에 할 일 (결과 창 닫기)
 */
async function startDaily(c: DailyChallenge, before?: () => void) {
  if (dailyChecking || busy) return;
  dailyChecking = true;
  let day: string | null;
  try {
    day = LOCAL_MODE ? localDay() : ((await (await loadDaily())?.dailyTodayStrict()) ?? null);
  } finally {
    dailyChecking = false;
  }
  if (!day) return toast(NO_DAY);
  before?.();
  if (day !== c.day) {
    toast('날짜가 바뀌었어요. 새 오늘의 판을 보여 드려요');
    return void showDaily();
  }
  void startGame(c.stage, c.party, c);
}

/** 오늘의 도전: 오늘 조건 설명 + 오늘 순위 + 도전하기 */
async function showDaily() {
  const head = `<div class="bar daily-bar"><button class="back" id="back">← 뒤로</button><h2>오늘의 도전</h2><div class="spacer"></div></div>`;
  const wait = screen(`${head}<div class="connecting"><div class="spinner"></div><p>오늘의 판을 불러오는 중…</p></div>`);
  const back = (root: HTMLElement) =>
    root.querySelector('#back')!.addEventListener('click', () => {
      play('click');
      showMain();
    });
  back(wait);
  // 날짜는 서버(한국 시간)에서, 조건은 날짜 글자에서 (모든 기기에서 같다). 테스트 모드는 기기 시계로
  const mod = LOCAL_MODE ? null : await loadDaily();
  if (!wait.isConnected) return;
  if (!LOCAL_MODE && !mod) {
    toast('오늘의 도전을 불러오지 못했어요');
    return showMain();
  }
  // 기록이 서버로 가는 판이라 기기 시계로 돌아가지 않는다 (못 받으면 시작을 막는다)
  const day = mod ? await mod.dailyTodayStrict() : localDay();
  if (!wait.isConnected) return;
  if (!day) {
    toast(NO_DAY);
    return showMain();
  }
  const c = dailyChallenge(day, mod?.dailySeed ?? dailySeed);
  const st = stageOf(c.stage);
  if (!st) return showMain();
  const note = stageNote(st);
  const root = screen(
    `${head}
    <div class="card daily-card">
      <h3>📅 ${dayLabel(day)}의 판 <small>모두 같은 조건</small></h3>
      <div class="daily-stage"><b>${st.id}</b><span class="st-mid"><span>${st.name}</span>${note ? `<small class="st-note">${note}</small>` : ''}
        <span class="foes">${foeArts(st)
          .slice(0, 4)
          .map((a) => `<img src="${artUrl(a)}" alt="" />`)
          .join('')}<em class="tag ${st.tip}">${st.tip === 'pierce' ? '관통형' : '반사형'} 유리</em></span></span></div>
      <div class="party-mini">${c.party.map((id, i) => `<span><img src="${zodiacFaceUrl(id)}" alt="" /><b>${i + 1}</b>${HEROES[id].name}</span>`).join('')}</div>
      <p class="soft center">정해진 대원 4명 · 모두 Lv ${c.level} · 강화 없음<br/>깬 판 가운데 <b>턴이 가장 적은 기록</b>으로 겨뤄요 (엽전·별은 없어요)</p>
    </div>
    <div class="card daily-rank-card hidden" id="rank-card"><h3>🏆 오늘 순위</h3><div id="rank-body"></div></div>
    <div class="grow"></div>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 순위는 기록되지 않아요</p>' : ''}
    <button class="btn primary big" id="start">⚔️ 도전하기!</button>`,
    `bg-${groundOf(st.region)}`,
  );
  back(root);
  root.querySelector('#start')!.addEventListener('click', () => {
    play('click');
    void startDaily(c);
  });
  void dailyRanking(day).then((rk) => {
    if (!rk || !root.isConnected) return;
    root.querySelector('#rank-body')!.innerHTML = dailyRankHtml(rk);
    root.querySelector('#rank-card')!.classList.remove('hidden');
  });
}

/** 오늘의 도전 결과: 쓴 턴 · 오늘 N위 */
function showDailyResult(s: RunState, st: StageDef, c: DailyChallenge, out: Sent) {
  const r = out.replay ?? resultOf(s);
  const d = out.result?.daily;
  play(r.cleared ? (d?.improved ? 'newRecord' : 'win') : 'lose');
  bgm(r.cleared ? 'win' : 'lose');
  const best = d?.best != null ? Math.abs(d.best) : 0;
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${r.cleared ? 'win' : 'lose'}">
      <h2>${r.cleared ? '클리어!' : '실패'}</h2>
      <p class="soft center">📅 오늘의 도전 · ${st.id} ${st.name}</p>
      ${
        r.cleared
          ? `<p class="big-num">${r.turns}턴</p>`
          : `<p class="soft center">웨이브 ${r.wave + 1}/${r.waves} 까지 갔어요${r.turns >= s.cfg.maxTurns ? ` (${s.cfg.maxTurns}턴을 다 썼어요)` : ''} · 깨야 기록돼요</p>`
      }
      <p class="center daily-line">${d?.recorded ? (d.improved ? (d.first ? '오늘 첫 기록!' : '오늘 내 기록을 줄였어요!') : `오늘 내 최고는 ${best}턴`) : ''}</p>
      <div class="rows">
        ${r.cleared ? '' : `<div><span>쓴 턴</span><b>${r.turns}</b></div>`}
        <div><span>쓰러뜨린 요괴</span><b>${r.kills}</b></div>
        <div><span>쓰러진 대원</span><b>${r.fallen}</b></div>
        ${out.result?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      ${out.offline ? '<p class="soft center">서버에 연결하지 못해 기록을 보관했어요. 다음 판을 시작할 때 다시 보내요</p>' : ''}
      ${out.unrecorded ? '<p class="soft center">서버에 연결하지 못한 판이라 기록되지 않았어요</p>' : ''}
      ${out.error ? `<p class="soft center">${out.error}</p>` : ''}
      <div class="btns">
        <button class="btn primary big" id="again">다시 도전</button>
        <button class="btn" id="menu">오늘 순위 보기</button>
      </div></div>`;
  app().appendChild(box);
  // "오늘 N위": 순위에 들어간 판이면 그날 순위를 받아 고친다 (실패하면 위 글 그대로)
  if (d?.recorded)
    void dailyRanking(d.day).then((rk) => {
      const el = box.querySelector<HTMLElement>('.daily-line');
      if (!rk?.mine || !el || !box.isConnected) return;
      const mineTurns = Math.abs(rk.mine.score);
      // 자정을 넘겨 끝난 판은 '오늘' 이 아니라 기록된 날짜로 적는다
      const when = rk.today && rk.today !== d.day ? dayLabel(d.day) : '오늘';
      el.innerHTML = `<b>${when} ${rk.mine.place}위</b> <span class="soft">(${rk.total}명 중)</span>${d.improved ? (d.first ? ' · 첫 기록!' : ' · 기록을 줄였어요!') : ` · 내 최고 ${mineTurns}턴`}`;
    });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    void startDaily(c, closeGame);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    void showDaily();
  });
}

// ---------- 끝없는 탑 ----------

/** startGame 에 넘기는 끝없는 탑 id */
const TOWER = 'tower';

function showTower() {
  const rec = profile.tower;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 뒤로</button><h2>끝없는 탑</h2><div class="pills">${coinsPill()}</div></div>
    ${sceneArt('bg-tower')}
    <div class="card tower-card">
      <h3>🏯 내 최고 기록</h3>
      <p class="tower-best">${rec ? `<b>${rec.floor}층</b> <span class="soft">${rec.turns}턴</span>` : '<span class="soft">아직 기록이 없어요</span>'}</p>
    </div>
    <div class="card help">
      <h3>규칙</h3>
      <ul>
        <li>한 층에 요괴 한 무리. 다 쓰러뜨리면 다음 층으로 올라가요. <b>5층마다 지역 보스</b>가 나와요.</li>
        <li>대원 체력과 쓰러진 대원은 <b>층을 올라가도 그대로</b>예요. 회복 구슬과 토끼 필살기를 아껴 쓰세요.</li>
        <li>층마다 방과 요괴가 바뀌고, 위로 갈수록 요괴가 세져요 (5층마다 다음 지역).</li>
        <li>모두 쓰러지거나 <b>${TOWER_TURNS}턴</b>을 다 쓰면 끝. 올라간 층이 기록이고, 같은 층이면 턴을 적게 쓴 쪽이 위예요.</li>
        <li>엽전: 층마다 ${TOWER_FLOOR_COINS} + 보스 층을 넘길 때마다 ${TOWER_BOSS_COINS} (+ 주운 엽전)</li>
      </ul>
    </div>
    <div class="grow"></div>
    <button class="btn primary big" id="go">🏯 파티 고르기</button>`,
    'bg-tower',
    false,
  );
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelector('#go')!.addEventListener('click', () => {
    play('click');
    showParty(null);
  });
}

// ---------- 판 ----------

let game: Phaser.Game | null = null;
let busy = false;

function closeGame() {
  if (game) {
    // WebGL 컨텍스트도 놓는다 (Phaser destroy 는 loseContext 를 부르지 않는다 — 아이폰은 컨텍스트 수 · GPU 메모리가 빠듯하다)
    const r = game.renderer;
    const gl = r instanceof Phaser.Renderer.WebGL.WebGLRenderer ? r.gl : null;
    if (gl) game.events.once(Phaser.Core.Events.DESTROY, () => setTimeout(() => { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* 이미 잃음 */ } }, 0));
    game.destroy(true);
  }
  game = null;
}

/** 판 결과를 서버로 보낸 뒤의 상태 */
interface Sent {
  result: FinishResult | null;
  /** 서버가 다시 돌린 결과 (화면 결과와 다르면 이쪽을 보여 준다) */
  replay: RunResult | null;
  /** 통신 실패로 기기에 보관했다 */
  offline: boolean;
  /** 서버가 받지 않은 까닭 (화면 글) */
  error: string | null;
  /** 시작을 서버에 알리지 못해 기록되지 않는 판 */
  unrecorded: boolean;
}

/** 판 시작: 스테이지 id, 또는 TOWER(끝없는 탑). daily 를 주면 오늘의 도전 (정해진 파티 · 레벨, 강화 없음) */
export async function startGame(stageId: string, party: HeroId[] = partyOf(profile, lastParty), daily?: DailyChallenge) {
  const tower = stageId === TOWER;
  const st = tower ? null : (stageOf(stageId) ?? null);
  if ((!tower && !st) || busy) return;
  const id = st ? st.id : TOWER;
  const mode = tower ? 'tower' : 'normal';
  busy = true;
  let runId = '';
  try {
    // 개발용 ?all=1 은 기기에만 연 상태라 기록하지 않는다
    if (!DEV_ALL) {
      // 보관해 둔(못 보낸) 판을 먼저 보낸다 (늦게 도착해도 서버는 먼저 시작한 판의 최소 판 시간으로만 겹침을 본다: 070).
      // 통신이 느리면 판마다 기다리느라 출발이 오래 멈추므로 여기서는 8초까지만 기다린다 (남은 것은 다음에)
      const slow = setTimeout(() => toast('출발 준비 중…', 9000), 600);
      await Promise.race([api.resend().catch(() => 0), new Promise((ok) => setTimeout(ok, 8000))]);
      // 서버가 시작 때 남기는 레벨·강화 스냅숏과 같은 값으로 판을 만들려고 프로필을 다시 읽는다 (다른 기기에서 레벨을 올렸을 수 있다)
      // 못 읽으면 옛 레벨·강화로 판을 만들게 되어 서버 스냅숏과 어긋난다 → 시작하지 않는다 (오늘의 도전은 정해진 레벨이라 그대로 간다)
      const fresh = await api.loadProfile().catch(() => null);
      if (fresh) setProfile(fresh);
      else if (!daily) {
        clearTimeout(slow);
        document.querySelector('.toast')?.remove();
        busy = false;
        toast(NO_PROFILE);
        return;
      }
      runId = await (daily ? api.startDaily(daily) : api.start(id, party, mode)).finally(() => {
        clearTimeout(slow);
        document.querySelector('.toast')?.remove();
      });
      if (!runId) toast('서버에 연결하지 못했어요. 이번 판은 기록되지 않아요');
    }
  } catch (e) {
    busy = false;
    toast(errText(e));
    // 오늘의 도전: 그사이 날짜가 바뀌었으면 새 날짜의 판을 다시 보여 준다
    if (daily && e instanceof ApiError && e.message === 'bad day') void showDaily();
    return;
  }
  busy = false;
  // 서버가 시작 때 남긴 스냅숏(레벨·강화)과 같은 값으로 판을 만든다
  // (오늘의 도전은 내 레벨·강화 대신 정해진 레벨 · 강화 없음 — finger_daily_start 가 남기는 스냅숏과 같다)
  const run = createRun(buildConfig({ stage: id, mode, party, levels: daily ? dailyLevels(daily) : profile.levels, upgrades: daily ? {} : profile.upgrades }));
  const root = app();
  // 힌트 한 수 (game/hint.ts): 스테이지 2회 · 끝없는 탑 1회 · 오늘의 도전은 없음. 자동 조종 중(?auto=1)에는 버튼을 두지 않는다
  let hintsLeft = DEV_AUTO ? 0 : HINT_USES[hintMode(tower, !!daily)];
  const hintBtn = hintsLeft ? `<button class="icon-btn hint-btn" id="hint-btn" aria-label="힌트">💡<i id="hint-n">${hintsLeft}</i></button>` : '';
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-mid"><b>${st ? `${daily ? '📅 ' : ''}${st.id} ${st.name}` : '🏯 끝없는 탑'}</b><span id="wave"></span></div>
      ${hintBtn}
      <span class="troop-pill" id="turns"></span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 당겼다 놓으세요</div>`;
  const waveEl = root.querySelector<HTMLElement>('#wave')!;
  const turnsEl = root.querySelector<HTMLElement>('#turns')!;
  const scene = new GameScene();
  const hintEl = root.querySelector<HTMLButtonElement>('#hint-btn');
  let hintKey = '';
  /** 힌트를 청했고 아직 길이 보이지 않았다 (계산 중) */
  let hintAsked = false;
  /** 힌트 버튼 모습: 남은 횟수 · 계산 중 · 지금 못 누름 (바뀔 때만 고친다) */
  const paintHint = () => {
    if (!hintEl) return;
    const st8 = scene.hintState;
    // 횟수는 힌트가 실제로 보였을 때 줄인다: 계산이 끝나기 전에 쏴 버리면(길이 안 보였다) 쓰지 않은 것으로 친다
    if (hintAsked && st8 !== 'thinking') {
      hintAsked = false;
      if (st8 === 'shown') {
        hintsLeft--;
        toast(hintsLeft ? `파란 선에 맞춰 당겨 보세요 · 힌트 ${hintsLeft}번 남음` : '파란 선에 맞춰 당겨 보세요 · 마지막 힌트');
      }
    }
    const key = `${hintsLeft}:${st8}`;
    if (key === hintKey) return;
    hintKey = key;
    hintEl.querySelector('#hint-n')!.textContent = String(hintsLeft);
    hintEl.classList.toggle('thinking', st8 === 'thinking');
    hintEl.classList.toggle('shown', st8 === 'shown');
    hintEl.disabled = st8 === 'off' || (st8 === 'ready' && hintsLeft <= 0);
  };
  hintEl?.addEventListener('click', () => {
    if (scene.hintState !== 'ready') return;
    if (hintsLeft <= 0) return void toast('이번 판의 힌트를 다 썼어요');
    if (!scene.requestHint()) return;
    hintAsked = true;
    play('click');
    paintHint();
  });
  closeGame();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root.querySelector<HTMLElement>('#game')!,
    width: W,
    height: H,
    backgroundColor: css(TABLE.matgo),
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 },
    // 소리는 공용 shared/sound.js 로만 낸다: Phaser 가 판마다 AudioContext 를 또 만들지 않게 (아이폰은 개수 제한이 있다)
    audio: { noAudio: true },
    scene: [],
    banner: false,
  });
  let hinted = false;
  // 손가락을 대자마자 안내 글을 치운다 (조준선 위에 남지 않게). 발사 뒤 onFrame 에서도 한 번 더 치운다
  const dropHint = () => {
    hinted = true;
    root.querySelector('#hint')?.remove();
  };
  root.addEventListener('pointerdown', dropHint, { once: true });
  root.addEventListener('touchstart', dropHint, { once: true, passive: true });
  let ended = false;
  let sent: Promise<Sent> | null = null;
  /** 조작 목록을 서버로 (한 판에 한 번) */
  const finish = (s: RunState, inputs = s.log.slice()): Promise<Sent> => {
    sent ??= (async (): Promise<Sent> => {
      const out: Sent = { result: null, replay: null, offline: false, error: null, unrecorded: !runId && !DEV_ALL };
      if (DEV_ALL || !runId) return out;
      try {
        const r = await api.finish({ run: runId, stage: id, inputs, rules: FINGER_RULES });
        if (!r) return { ...out, offline: true };
        setProfile(r.profile);
        return { ...out, result: r.result, replay: r.replay };
      } catch (e) {
        return { ...out, error: errText(e) };
      }
    })();
    return sent;
  };
  /** 서버가 조작을 다시 돌려 보는 동안(최대 15초) 기다림 표시를 띄워 두고 보낸다. 실패·시간 초과에도 표시는 꼭 지운다 */
  const finishWithWait = async (s: RunState, inputs?: RunState['log']): Promise<Sent> => {
    const wait = document.createElement('div');
    wait.className = 'overlay';
    wait.innerHTML = '<div class="connecting"><div class="spinner"></div><p>기록을 저장하는 중…</p></div>';
    root.appendChild(wait);
    try {
      return await finish(s, inputs);
    } finally {
      wait.remove();
    }
  };
  game.scene.add('game', scene, true, {
    run,
    ground: groundOf(st ? st.region : 1),
    region: st ? st.region : undefined,
    grounds: tower ? (['field', 'bamboo', 'palace', 'underworld'] as const).slice() : undefined,
    hooks: {
      sound: play,
      onFrame: (s: RunState) => {
        paintHint();
        // 지역 보스(rank 2)가 있는 웨이브·탑 층이면 boss, 아니면 main. 판이 끝난 뒤에는 결과 화면이 win/lose 를 튼다.
        // 매 프레임 부르지 않고 바뀔 때만 (같은 곡을 계속 부르면 페이드 인이 매번 처음부터 다시 걸린다)
        if (!ended && s.phase !== 'clear' && s.phase !== 'fail') {
          const want: BgmScene = s.cfg.waves[s.wave]?.some((f) => f.rank === 2) ? 'boss' : 'main';
          if (want !== bgmScene) bgm(want);
        }
        if (tower) {
          const tf = towerFloor(s.wave + 1);
          waveEl.textContent = `${s.wave + 1}층${tf.boss ? ' · 보스' : tf.chief ? ' · 작은 대장' : ''} · ${REGION_NAMES[tf.region - 1]}`;
          turnsEl.textContent = `턴 ${s.turn}/${s.cfg.maxTurns}`;
          turnsEl.classList.toggle('over', s.cfg.maxTurns - s.turn <= 10);
        } else {
          waveEl.textContent = `웨이브 ${s.wave + 1}/${s.cfg.waves.length}`;
          turnsEl.textContent = `턴 ${s.turn}/${s.cfg.par}`;
          turnsEl.classList.toggle('over', s.turn > s.cfg.par);
        }
        if (!hinted && s.phase !== 'aim') {
          hinted = true;
          root.querySelector('#hint')?.remove();
        }
      },
      onEnd: async (s: RunState) => {
        if (ended) return;
        ended = true;
        const out = await finishWithWait(s);
        if (st && daily) showDailyResult(s, st, daily, out);
        else if (st) showResult(s, st, party, out);
        else showTowerResult(s, party, out);
      },
    },
  });
  root.querySelector('#pause')!.addEventListener('click', () => {
    if (scene.paused || ended || run.phase === 'clear' || run.phase === 'fail') return;
    play('click');
    scene.paused = true;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="mute"></button>
      <button class="btn" id="quit">그만하기</button>
      <p class="soft center">${daily ? '그만하면 이번 도전은 기록되지 않아요' : tower ? '그만하면 지금까지 올라간 층이 기록돼요' : '그만하면 이번 판은 실패로 기록돼요 (간 만큼 엽전은 받아요)'}</p></div>`;
    root.appendChild(box);
    // 판 안에서는 여기서 소리 설정 창을 연다 (다른 화면의 ⚙️ 버튼과 같은 창: 배경음·효과음 따로)
    const mute = box.querySelector<HTMLButtonElement>('#mute')!;
    mute.textContent = '⚙️ 소리 설정';
    mute.addEventListener('click', () => sound?.openSoundSettings());
    box.querySelector('#resume')!.addEventListener('click', () => {
      play('click');
      scene.paused = false;
      box.remove();
    });
    box.querySelector('#quit')!.addEventListener('click', async () => {
      play('click');
      box.remove();
      // 창이 떠 있는 사이 판이 끝났으면 그 결과(클리어 등)를 그대로 둔다
      if (ended || run.phase === 'clear' || run.phase === 'fail') {
        scene.paused = false;
        return;
      }
      ended = true;
      // 지금까지 끝난 턴의 조작만 보낸다: 서버가 다시 돌리면 판이 끝나지 않은 실패 판이 된다.
      // 날아가는 중(조준이 아닌 때)이면 그 발사는 이미 s.log 에 있으니 빼야 한다 — 넣으면 서버가 그 발사를 끝까지 돌려 클리어로 남길 수 있다
      const out = await finishWithWait(run, run.phase === 'aim' ? run.log.slice() : run.log.slice(0, run.turn));
      closeGame();
      if (out.error) toast(out.error);
      else if (out.result?.coins) toast(tower ? `${out.replay?.floors ?? run.wave}층까지 기록했어요 · 엽전 +${out.result.coins}` : `실패로 기록했어요 · 엽전 +${out.result.coins}`);
      else if (out.offline) toast('서버에 연결하지 못해 기록을 보관했어요');
      if (daily) void showDaily();
      else if (st) showStages(st.region);
      else showTower();
    });
  });
}

/** 끝없는 탑 결과: 올라간 층 · 쓴 턴 · 엽전 · 시아코인 · 최고 기록 */
function showTowerResult(s: RunState, party: HeroId[], out: Sent) {
  const r = out.replay ?? resultOf(s);
  const res = out.result;
  const best = !!res?.best;
  play(best ? 'newRecord' : r.floors > 0 ? 'win' : 'lose');
  bgm(r.floors > 0 ? 'win' : 'lose');
  const why = r.turns >= s.cfg.maxTurns ? `${s.cfg.maxTurns}턴을 다 썼어요` : r.cleared ? '탑 꼭대기까지 올랐어요!' : '모두 쓰러졌어요';
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${r.floors > 0 ? 'win' : 'lose'}">
      <h2>${r.floors}층</h2>
      <p class="soft center">${why}${best ? ' · <b>새 기록!</b>' : profile.tower ? ` · 최고 ${profile.tower.floor}층` : ''}</p>
      <div class="rows">
        <div><span>올라간 층</span><b>${r.floors}층</b></div>
        <div><span>쓴 턴</span><b>${r.turns}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${r.kills}</b></div>
        ${res ? `<div><span>엽전</span><b class="coin">🪙 +${res.coins}</b></div>` : `<div><span>주운 엽전</span><b class="coin">🪙 ${r.coins}</b></div>`}
        ${res?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      <div class="party-mini">${party.map((id) => `<span><img src="${zodiacFaceUrl(id)}" alt="" />${HEROES[id].name}</span>`).join('')}</div>
      ${out.offline ? '<p class="soft center">서버에 연결하지 못해 기록을 보관했어요. 다음 판을 시작할 때 다시 보내요</p>' : ''}
      ${out.unrecorded ? '<p class="soft center">서버에 연결하지 못한 판이라 기록되지 않았어요</p>' : ''}
      ${out.error ? `<p class="soft center">${out.error}</p>` : ''}
      <div class="btns">
        <button class="btn primary big" id="again">다시 오르기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    closeGame();
    void startGame(TOWER, party);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    showTower();
  });
}

function nextStageOf(st: StageDef): StageDef | null {
  const i = STAGES.findIndex((s) => s.id === st.id);
  return STAGES[i + 1] ?? null;
}

function showResult(s: RunState, st: StageDef, party: HeroId[], out: Sent) {
  // 서버가 다시 돌린 결과가 있으면 그것이 기록이다
  const r = out.replay ?? resultOf(s);
  const res = out.result;
  play(r.cleared ? 'win' : 'lose');
  bgm(r.cleared ? 'win' : 'lose');
  const next = r.cleared ? nextStageOf(st) : null;
  const nextOk = !!next && stageOpen(profile, next.id);
  const [, inPar, noFall] = r.starFlags;
  // 서버에 기록된 클리어면 내 최소 턴 · 1등에 먼저 반영하고, 아래에서 서버 값으로 다시 맞춘다
  if (r.cleared && res) noteBest(st.id, r.turns);
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${r.cleared ? 'win' : 'lose'}">
      <h2>${r.cleared ? '클리어!' : '실패'}</h2>
      ${
        r.cleared
          ? `<div class="big-stars">${starsHtml(r.stars)}</div>
            <ul class="star-why"><li class="on">★ 클리어</li><li class="${inPar ? 'on' : ''}">★ ${st.par}턴 안에 클리어</li><li class="${noFall ? 'on' : ''}">★ 아무도 안 쓰러짐</li></ul>`
          : `<p class="soft center">웨이브 ${r.wave + 1}/${r.waves} 까지 갔어요${r.turns >= s.cfg.maxTurns ? ` (${s.cfg.maxTurns}턴을 다 썼어요)` : ''}</p>`
      }
      <div class="rows">
        <div><span>쓴 턴</span><b>${r.turns}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${r.kills}</b></div>
        ${res ? `<div><span>엽전</span><b class="coin">🪙 +${res.coins}${res.first ? ' (첫 클리어)' : ''}</b></div>` : `<div><span>주운 엽전</span><b class="coin">🪙 ${r.coins}</b></div>`}
        ${res?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      <p class="soft center best-line">${bestText(st.id)}</p>
      ${res && res.newHeroes.length ? `<div class="new-leaders">${res.newHeroes.map((id) => `<span><img src="${zodiacFaceUrl(id)}" alt="" />${HEROES[id].name}이(가) 합류했어요!</span>`).join('')}</div>` : ''}
      ${out.offline ? '<p class="soft center">서버에 연결하지 못해 기록을 보관했어요. 다음 판을 시작할 때 다시 보내요</p>' : ''}
      ${out.unrecorded ? '<p class="soft center">서버에 연결하지 못한 판이라 기록되지 않았어요</p>' : ''}
      ${out.error ? `<p class="soft center">${out.error}</p>` : ''}
      ${!r.cleared ? '<p class="soft center">💪 대원 레벨을 올리거나 강화해 보세요</p>' : ''}
      <div class="btns">
        ${nextOk ? `<button class="btn primary big" id="next">다음 스테이지 ▶</button>` : ''}
        <button class="btn ${nextOk ? '' : 'primary big'}" id="again">다시하기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  void refreshBests().then((ok) => {
    const el = box.querySelector<HTMLElement>('.best-line');
    if (ok && el && box.isConnected) el.innerHTML = bestText(st.id);
  });
  if (res?.newHeroes.length) play('newRecord');
  box.querySelector('#next')?.addEventListener('click', () => {
    play('click');
    closeGame();
    showParty(next!);
  });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    closeGame();
    void startGame(st.id, party);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    showStages(st.region);
  });
}
