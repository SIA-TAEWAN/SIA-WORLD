import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl } from '../assets';
import { hasArt } from '../scenes/art';
import { LEADERS, ZODIAC_IDS, leaderOf, type LeaderId } from '../data/balance';
import { REGIONS, REGION_NAMES, UPGRADES, groundOf, modsOf, regionStars, upgradeCost, type UpgradeKey } from '../data/growth';
import { DAILY_ID, STAGES, dailyStage, endlessStage, nextStage, stageOf, stagesOf, type StageDef } from '../data/stages';
import { CODEX, codexEntry, createCodex, firstStageOf, seenOf, stageFoeIds, type Codex, type CodexEntry, type CodexId } from '../game/codex';
import { DAILY_GAME, dailyCourse, dayLabel, isDay, isPastDay, localDay, normalizeDaily, placeText, type DailyCourse, type DailyRanking } from '../game/daily';
import {
  emptyProfile,
  endlessOpen,
  CAT_PRICE,
  UNLOCK_LABEL,
  catConditionText,
  catReady,
  leadersOf,
  regionOpen,
  setOwnedExtras,
  regionStarsOf,
  stageOpen,
  totalStars,
  whyText,
  type ChargeProfile,
  type FinishResult,
  type RunReport,
} from '../game/progress';
import { createRun, metersOf, progressOf, starsFor, type RunState, type SimEvent } from '../game/sim';
import { ApiError, type ChargeApi, type StageTop, type StageTops } from '../net/api';
import { DEV_ALL, DEV_CAT_READY, DEV_OWNED, LOCAL_MODE } from '../net/local';
import { buyCharacter, loadDaily, loadOwnedCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import { TABLE } from '../theme';

/**
 * 메뉴·지역 지도·강화·게임 화면·결과 (PRD 10장).
 * 기록은 서버 RPC(061_charge.sql)로만 바뀐다. 테스트 모드(?local=1)는 기기에만 저장한다.
 */

let api!: ChargeApi;
let me: WorldUser | null = null;
let profile: ChargeProfile = emptyProfile();
/** 요괴 도감: 만난 것은 이 기기에만 저장한다 (계정마다 따로) */
let codex: Codex = createCodex(null, 'local');
const LEADER_KEY = 'siacharge:leader';
let leader: LeaderId = 'rat';

let sound: SoundModule | null = null;
void loadSound()
  .then((m) => (sound = m))
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);

const app = () => document.getElementById('app')!;

function screen(html: string, bg = ''): HTMLElement {
  const root = app();
  root.innerHTML = `<div class="screen ${bg}">${html}</div>`;
  const el = root.firstElementChild as HTMLElement;
  soundButton(root); // .screen 밖(#app)에 붙여, 화면이 스크롤돼도 오른쪽 아래 제자리에 둔다
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
const coinsPill = () => `<span class="coins-pill">🪙 ${profile.coins.toLocaleString()}</span>`;
const starPill = () => `<span class="coins-pill star-pill">★ ${totalStars(profile)}</span>`;

// ---------- 스테이지별 친구 기록 (079 charge_stage_tops) ----------

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MEDALS = ['🥇', '🥈', '🥉'];
/** 지역별로 받아 둔 기록 (스테이지 화면을 다시 열 때 바로 그리고, 오래됐으면 다시 받는다) */
const topsCache = new Map<number, { at: number; data: StageTops }>();
const TOPS_FRESH_MS = 30_000;

/** 한 지역의 기록. 테스트 모드·실패는 null (화면은 아무것도 그리지 않는다) */
async function loadTops(region: number): Promise<StageTops | null> {
  if (LOCAL_MODE || DEV_ALL) return null;
  try {
    const data = await api.stageTops(region);
    topsCache.set(region, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/**
 * 🥇 닉네임 123 · 🥈 … · 🥉 … (chips) 와, 내가 3위 밖일 때의 "나 5위 77" (mine).
 * 메달과 대원 수는 줄어들지 않고 닉네임만 줄인다 (메달이 닉네임과 함께 잘려 숫자와 겹치지 않게 메달은 따로 둔다).
 */
function topsParts(t: StageTop): { chips: string; mine: string } {
  const chips = t.top
    .map((x) => `<em class="${x.me ? 'me' : ''}"><i>${MEDALS[x.place - 1]}</i><u>${esc(x.me ? '나' : x.nickname)}</u><var>${x.troops.toLocaleString()}</var></em>`)
    .join('');
  const mine = t.mine && t.mine.place > 3 ? `<strong>나 ${t.mine.place}위 ${t.mine.troops.toLocaleString()}</strong>` : '';
  return { chips: `<bdi class="tc">${chips}</bdi>`, mine };
}

/** 스테이지 줄: 한 줄에 chips + 오른쪽에 내 순위 (좁은 화면에서는 내 순위가 아랫줄로 내려간다, style.css) */
function topsHtml(t: StageTop): string {
  const p = topsParts(t);
  return p.chips + p.mine;
}

/** 결과 창 상자: 내 순위는 제목 줄 오른쪽에 (기록 줄은 늘 한 줄이라 받아 온 뒤에도 버튼이 밀리지 않는다) */
function topsBoxHtml(t: StageTop): string {
  const p = topsParts(t);
  return `<span class="soft tops-head"><span>🏅 최다 생존 대원 · ${t.total.toLocaleString()}명 기록</span>${p.mine}</span><small class="tops">${p.chips}</small>`;
}

function soundButton(root: HTMLElement) {
  const b = document.createElement('button');
  b.className = 'icon-btn sound-btn';
  const paint = () => (b.textContent = sound?.isMuted() ? '🔇' : '🔊');
  paint();
  b.addEventListener('click', () => {
    sound?.setMuted(!sound.isMuted());
    paint();
    play('click');
  });
  root.appendChild(b);
}

/** 화면 위에 덮는 기다림 창 (스피너 + 글) — 끝나면 .remove() */
function waitBox(text: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="connecting"><div class="spinner"></div><p>${text}</p></div>`;
  app().appendChild(box);
  return box;
}

/** 못 보낸 기록이 올라갔으면 프로필을 다시 읽고 알린다 (다시 읽기 실패는 무시) */
async function noteResent(n: number) {
  if (n <= 0) return;
  profile = await api.loadProfile().catch(() => profile);
  toast(`못 보낸 기록 ${n}판을 올렸어요`);
}

function errText(e: unknown) {
  return e instanceof ApiError ? whyText(e.message) : '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요';
}

/** 처음 한 번: 기록을 불러오고 메인으로 */
export async function boot(a: ChargeApi, user: WorldUser | null) {
  api = a;
  me = user;
  let store: Storage | null = null;
  try {
    store = localStorage;
  } catch {
    /* 저장 공간 없음: 이번 실행 동안만 기억 */
  }
  codex = createCodex(store, user?.userId ?? 'local');
  profile = await api.loadProfile();
  if (DEV_ALL) {
    // 개발용 ?local=1&all=1: 모든 스테이지·대장을 연 상태로 본다 (저장하지 않음)
    profile = { ...profile, coins: Math.max(profile.coins, 99999), stages: Object.fromEntries(STAGES.map((s) => [s.id, 3])) };
  }
  // 고양이(이 게임에서 시아코인으로 여는 대장): 들어올 때 한 번 (못 읽으면 잠긴 것으로 시작),
  // 다른 기기에서 열었을 수 있으니 화면이 다시 보이면 또 묻는다 (못 읽으면 가진 목록을 그대로 둔다)
  applyOwned(LOCAL_MODE ? DEV_OWNED : ((await loadOwnedCharacters()) ?? []));
  if (!LOCAL_MODE) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void loadOwnedCharacters(true).then((ids) => {
        const was = leadersOf(profile).join();
        const wasLeader = leader;
        applyOwned(ids);
        // 기기에 저장한 대장(예: 다른 기기에서 연 고양이)을 이제 고를 수 있으면 되돌린다
        restoreSavedLeader();
        // 메인(대장 고르기)을 보고 있으면 바로 다시 그린다
        if ((leadersOf(profile).join() !== was || leader !== wasLeader) && document.querySelector('.leaders')) showMain();
      });
    });
  }
  restoreSavedLeader();
  void api
    .resend()
    .then(noteResent)
    .catch(() => null);
}

/** 기기에 저장한 대장을 고를 수 있으면 그 대장으로 */
function restoreSavedLeader() {
  try {
    const saved = localStorage.getItem(LEADER_KEY) as LeaderId | null;
    if (saved && leadersOf(profile).includes(saved)) leader = saved;
  } catch {
    /* 저장 공간 없음 */
  }
}

/** 이 게임에서 연 추가 캐릭터 */
let owned: string[] = [];
/** 연 캐릭터 목록 반영 (null = 못 읽음 → 그대로). 고른 대장이 잠기면 이번에는 첫 대장으로
 *  (기기에 저장한 대장은 지우지 않는다: 다시 열리면 restoreSavedLeader 가 되돌린다) */
function applyOwned(ids: string[] | null) {
  if (!ids) return;
  owned = [...ids];
  setOwnedExtras(owned);
  const open = leadersOf(profile);
  if (!open.includes(leader)) leader = open[0] ?? 'rat';
}

let buying = false;
/** 고양이 열기 (시아코인). 테스트 모드는 서버 없이 바로 연다 */
async function unlockCat(btn: HTMLButtonElement) {
  if (buying) return;
  buying = true;
  btn.disabled = true;
  btn.textContent = '여는 중…';
  try {
    if (LOCAL_MODE) {
      applyOwned([...owned, 'cat']);
      toast('열었어요! (테스트 모드)');
    } else {
      const { r, text } = await buyCharacter('cat');
      if (r.ok || r.reason === 'owned') applyOwned((await loadOwnedCharacters(true)) ?? [...owned, 'cat']);
      // 조건 미달로 거절되면 기록을 다시 읽어 조건 글을 고친다
      if (r.reason === 'condition') profile = await api.loadProfile().catch(() => profile);
      toast(text);
    }
    if (leadersOf(profile).includes('cat')) {
      setLeader('cat');
      play('boost');
    }
  } finally {
    buying = false;
  }
  // 사는 동안 다른 화면으로 갔으면 그 화면을 그대로 둔다
  if (btn.isConnected) showMain();
}

function setLeader(id: LeaderId) {
  leader = id;
  try {
    localStorage.setItem(LEADER_KEY, id);
  } catch {
    /* 이번만 */
  }
}

// ---------- 메인 ----------

export function showMain() {
  const open = leadersOf(profile);
  if (!open.includes(leader)) leader = open[0] ?? 'rat';
  const eOpen = endlessOpen(profile);
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${starPill()}${coinsPill()}</div></div>
    ${hasArt('main') ? `<img class="hero" src="${artUrl('main')}" alt="" />` : ''}
    <div class="title"><h1>시아돌격대</h1><p>숫자 문을 골라 대원을 불리고 요괴를 뚫어라!</p></div>
    <div class="card">
      <h3>대장 <small>대장과 같은 동물 대원들이 함께 달려요</small></h3>
      <div class="leaders">${LEADERS.map((l) => {
        const ok = open.includes(l.id);
        // 고를 수 있는지는 leadersOf(profile) 한 곳에서 정한다 (고양이 잠금은 progress.ts 의 extraOpen)
        // 잠긴 고양이는 눌러서 특성을 볼 수 있게 disabled 로 두지 않고, 옆에 "시아코인으로 열기" 버튼을 둔다 (게임마다 따로 연다)
        const tile = `<button class="leader ${l.id === leader ? 'on' : ''} ${ok ? '' : 'locked'} ${l.extra ? 'extra' : ''}" data-id="${l.id}" ${ok || l.extra ? '' : 'disabled'}>
            <img src="${zodiacFaceUrl(l.id)}" alt="${l.nick}" /><b>${l.nick}</b>${ok ? '' : `<em>🔒${l.extra ? '' : ` ${l.unlockRegion}지역`}</em>`}
          </button>`;
        if (ok || !l.extra) return tile;
        // 구매 조건(3-5 클리어)을 넘었으면 열기 버튼, 아니면 남은 조건 글
        const ready = DEV_CAT_READY ?? catReady(profile);
        return ready
          ? `${tile}<button class="btn primary unlock" data-unlock="${l.id}">🔒 ${UNLOCK_LABEL}</button>`
          : `${tile}<p class="unlock cond">🔒 ${catConditionText(profile)}</p>`;
      }).join('')}</div>
      <p class="soft center" id="trait">${leaderOf(leader).trait}</p>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">⚔️ 모험 떠나기</button>
      <button class="btn" id="daily">📅 오늘의 도전</button>
      <div class="row2">
        <button class="btn" id="up">💪 강화</button>
        <button class="btn ${eOpen ? '' : 'soon'}" id="endless">♾️ 끝없는 길${eOpen ? '' : ' 🔒'}</button>
      </div>
      <div class="row2 row3">
        <button class="btn" id="codex">📖 도감</button>
        <button class="btn" id="rank">🏆 랭킹</button>
        <button class="btn" id="help">❓ 하는 법</button>
      </div>
    </div>
    ${profile.endless ? `<p class="soft center light">끝없는 길 최고 기록 ${profile.endless.meters.toLocaleString()}m</p>` : ''}
    <div class="grow"></div>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요</p>' : ''}`);
  // 메인은 내용이 길어 스크롤된다: 떠 있는 소리 버튼이 아래 '끝없는 길' 버튼을 덮지 않게, 위 그림 오른쪽 모서리에 붙여 내용과 함께 움직이게 한다
  const sb = app().querySelector<HTMLElement>(':scope > .sound-btn');
  if (sb) { sb.classList.add('on-hero'); root.appendChild(sb); }
  root.querySelectorAll<HTMLButtonElement>('.leader').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id as LeaderId;
      if (!open.includes(id)) {
        play('click');
        return toast(`🔒 ${leaderOf(id).nick} — ${leaderOf(id).trait}`, 3200);
      }
      setLeader(id);
      play('click');
      showMain();
    }),
  );
  // 열기 버튼: 한 번 누르면 확인 글로 바뀌고, 4초 안에 한 번 더 누르면 연다
  root.querySelectorAll<HTMLButtonElement>('[data-unlock]').forEach((b) => {
    let armed = 0;
    b.addEventListener('click', () => {
      play('click');
      if (buying) return;
      if (!armed) {
        b.textContent = `${CAT_PRICE}코인을 쓸까요? 한 번 더 누르기`;
        b.classList.add('armed');
        armed = window.setTimeout(() => {
          armed = 0;
          b.textContent = `🔒 ${UNLOCK_LABEL}`;
          b.classList.remove('armed');
        }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      void unlockCat(b);
    });
  });
  root.querySelector('#go')!.addEventListener('click', () => {
    play('click');
    showRegions();
  });
  root.querySelector('#up')!.addEventListener('click', () => {
    play('click');
    showUpgrades();
  });
  root.querySelector('#daily')!.addEventListener('click', () => {
    play('click');
    showDaily();
  });
  root.querySelector('#endless')!.addEventListener('click', () => {
    play('click');
    if (!eOpen) return toast('끝없는 길은 1-5를 깨면 열려요');
    startGame(endlessStage(), true);
  });
  root.querySelector('#rank')!.addEventListener('click', async () => {
    play('click');
    if (LOCAL_MODE || !me) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(me.userId))) toast('랭킹을 불러오지 못했어요');
  });
  root.querySelector('#help')!.addEventListener('click', () => {
    play('click');
    showHelp();
  });
  root.querySelector('#codex')!.addEventListener('click', () => {
    play('click');
    showCodex();
  });
}

// ---------- 요괴 도감 ----------

/** 도감 그림: 만난 것은 그대로, 안 만난 것은 실루엣 (.unseen, style.css) */
const foeImg = (c: CodexEntry, seen: boolean) => `<img class="${seen ? '' : 'unseen'}" src="${artUrl(c.art)}" alt="${seen ? c.name : '???'}" />`;

/** 스테이지 줄의 "이번에 나오는 요괴": 작은 그림 줄 (보스는 테두리로 구분, 안 만난 것은 실루엣) */
function foesHtml(st: StageDef): string {
  const ids = stageFoeIds(st);
  if (!ids.length) return '';
  return `<small class="foes"><span>나오는 요괴</span>${ids
    .map((id) => {
      const c = codexEntry(id);
      return `<i class="${c.group === 'boss' ? 'boss' : ''}">${foeImg(c, codex.has(id))}</i>`;
    })
    .join('')}</small>`;
}

function showCodex() {
  const tile = (c: CodexEntry) => {
    const seen = codex.has(c.id);
    return `<button class="foe ${seen ? '' : 'unseen'}" data-id="${c.id}">${foeImg(c, seen)}<b>${seen ? c.name : '???'}</b></button>`;
  };
  const group = (g: CodexEntry['group'], title: string) => {
    const list = CODEX.filter((c) => c.group === g);
    return `<div class="card"><h3>${title} <small>${list.filter((c) => codex.has(c.id)).length} / ${list.length}</small></h3><div class="foe-grid">${list.map(tile).join('')}</div></div>`;
  };
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>요괴 도감</h2><div class="pills"><span class="coins-pill">📖 ${codex.count()}/${CODEX.length}</span></div></div>
    ${group('enemy', '요괴')}
    ${group('boss', '지역 보스')}
    <p class="soft center light">판에서 만난 요괴와 보스가 여기에 적혀요 (이 기기에만 저장)</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('.foe').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      showFoe(b.dataset.id as CodexId);
    }),
  );
}

/** 도감 한 장: 만난 것은 설명과 수치, 안 만난 것은 실루엣과 어디서 나오는지만 */
function showFoe(id: CodexId) {
  const c = codexEntry(id);
  const seen = codex.has(id);
  const first = firstStageOf(id);
  const where = c.group === 'boss' ? `${first} 스테이지의 보스예요` : `${first} 스테이지부터 나와요`;
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop foe-card">
    <div class="foe-pic ${c.group}">${foeImg(c, seen)}</div>
    <h3>${seen ? c.name : '???'} <em class="tag ${c.group === 'boss' ? '' : 'role'}">${c.group === 'boss' ? '보스' : '요괴'}</em></h3>
    ${
      seen
        ? `<p class="foe-desc">${c.desc}</p>
    <div class="rows">${c.facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}${first ? `<div><span>처음 나오는 곳</span><b>${first}</b></div>` : ''}</div>`
        : `<p class="foe-desc soft">아직 만나지 못했어요.${first ? `<br/>${where}` : ''}</p>`
    }
    <button class="btn primary" id="ok">닫기</button></div>`;
  app().appendChild(box);
  box.addEventListener('click', (e) => {
    if (e.target !== box && !(e.target as HTMLElement).closest('#ok')) return;
    play('click');
    box.remove();
  });
}

function showHelp() {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop help">
    <h3>하는 법</h3>
    <ul>
      <li>화면을 누른 채 <b>좌우로 끌면</b> 무리가 따라 움직여요. 앞으로는 저절로 달려요.</li>
      <li><b class="blue">파란 문(+ ×)</b>은 대원이 늘고, <b class="red">빨간 문(− ÷)</b>은 줄어요.</li>
      <li>대원들은 앞을 향해 계속 쏴요. <b>+문과 −문은 쏠수록 숫자가 올라요</b> (−문은 0을 넘으면 +문이 돼요).</li>
      <li>요괴 무리와 부딪히면 그 수만큼 대원이 줄어요. 멀리서 먼저 쏘아 줄이세요.</li>
      <li>통나무·칼날·구덩이는 피하고, 상자는 쏴서 열어요.</li>
      <li>끝에서 보스가 기다려요. <b class="red">빨갛게 깜빡이는 곳</b>은 공격이 떨어지니 피하세요.</li>
      <li>남은 대원 수로 별 1~3개. 엽전으로 강화하면 더 강해져요.</li>
    </ul>
    <button class="btn primary" id="ok">알겠어요</button></div>`;
  app().appendChild(box);
  box.querySelector('#ok')!.addEventListener('click', () => {
    play('click');
    box.remove();
  });
}

// ---------- 오늘의 도전: 오늘의 길 ----------

const NO_DAY_TEXT = '오늘 날짜를 받지 못했어요. 잠시 후 다시 시도해 주세요';

/**
 * 오늘(한국 시간)의 코스. 기록이 서버로 가는 판이라 날짜는 서버에서만 받는다 (dailyTodayStrict):
 * 못 받으면 null → 시작하지 않는다 (기기 시계로 만든 길은 서버의 오늘과 다를 수 있다).
 * 기록이 남지 않는 테스트 모드(?local=1 · ?all=1)만 기기 시계로.
 */
async function todayCourse(): Promise<DailyCourse | null> {
  if (LOCAL_MODE || DEV_ALL) return dailyCourse(localDay());
  const mod = await loadDaily();
  if (!mod) return null;
  const day = await mod.dailyTodayStrict().catch(() => null);
  return isDay(day) ? dailyCourse(day, mod.dailySeed) : null;
}

/** 그날 순위 (테스트 모드·실패는 null → 화면은 숨긴다) */
async function loadDailyRank(day: string): Promise<DailyRanking | null> {
  if (LOCAL_MODE || DEV_ALL) return null;
  try {
    const mod = await loadDaily();
    return mod ? normalizeDaily(await mod.loadDailyRanking(DAILY_GAME, day)) : null;
  } catch {
    return null;
  }
}

const DAILY_TOP = 10;
const dailyRowHtml = (place: number, name: string, meters: number, kills: number, isMe: boolean) =>
  `<li class="${isMe ? 'me' : ''}"><i>${MEDALS[place - 1] ?? place}</i><u>${esc(name)}</u><var>${meters.toLocaleString()}m</var><small>처치 ${kills.toLocaleString()}</small></li>`;

function dailyRankHtml(r: DailyRanking): string {
  if (!r.top.length) return '<p class="soft center">아직 기록이 없어요. 첫 기록을 남겨 보세요!</p>';
  const shown = r.top.slice(0, DAILY_TOP);
  const rows = shown.map((t) => dailyRowHtml(t.place, t.me ? '나' : t.nickname, t.meters, t.kills, t.me));
  // 내가 보이는 줄 밖이면 맨 아래에 내 줄을 따로
  const mine = r.mine && !shown.some((t) => t.me) ? `<li class="gap">…</li>${dailyRowHtml(r.mine.place, '나', r.mine.meters, r.mine.kills, true)}` : '';
  return `<ol class="daily-list">${rows.join('')}${mine}</ol>${r.mine ? '' : '<p class="soft center">아직 오늘 내 기록이 없어요</p>'}`;
}

let dailyBusy = false;
/** 방금 시작한 오늘의 길의 날짜 (결과 창의 "다시하기" 가 날짜가 바뀌었는지 볼 때 쓴다) */
let runDay = '';
/**
 * 오늘의 길 시작: 판마다 날짜를 다시 받는다.
 * shownDay = 화면에 그려 둔 날짜. 그 사이 자정을 넘겨 날짜가 달라졌으면 그 판은 시작하지 않고
 * 새 날짜로 오늘의 도전 화면을 다시 그린다. 날짜를 못 받으면 시작하지 않는다.
 */
async function startDaily(shownDay: string) {
  if (dailyBusy || busy) return;
  dailyBusy = true;
  const wait = waitBox('오늘의 길을 불러오는 중…');
  try {
    const c = await todayCourse();
    // 기다리는 사이 다른 화면으로 갔으면 시작하지 않는다
    if (!wait.isConnected) return;
    wait.remove();
    if (!c) return toast(NO_DAY_TEXT, 3200);
    if (shownDay && c.day !== shownDay) {
      closeGame();
      showDaily(c);
      return toast('날짜가 바뀌었어요. 새 길을 준비했어요', 3200);
    }
    closeGame();
    runDay = c.day;
    await startGame(dailyStage(c.seed), true);
  } finally {
    wait.remove();
    dailyBusy = false;
  }
}

/** known = 이미 받아 둔 오늘의 코스 (없으면 받아서 그린다) */
function showDaily(known?: DailyCourse) {
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>오늘의 도전</h2><div class="spacer"></div></div>
    <div class="card daily-card">
      <h3>📅 오늘의 길 <small id="d-day"></small></h3>
      <p class="daily-rule">오늘 하루, 모두가 <b>똑같은 길</b>을 달려요.<br/>가장 멀리 간 <b>거리(m)</b>가 오늘 기록이에요.</p>
      <div class="daily-boss" id="d-boss" hidden></div>
      <p class="soft center">대장·강화는 내 것 그대로 · 끝없는 길 기록과는 따로 · 자정에 새 길</p>
      <button class="btn primary big" id="d-go" disabled>🏃 오늘의 길 달리기</button>
    </div>
    <div class="card daily-rank" id="d-rank" hidden></div>
    <div class="grow"></div>
    <p class="soft center light">대장: ${leaderOf(leader).nick} · ${leaderOf(leader).trait}</p>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 오늘의 도전 기록은 남지 않아요</p>' : ''}`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  const go = root.querySelector<HTMLButtonElement>('#d-go')!;
  /** 화면에 그린 날짜 ('' = 아직 못 받음 → 버튼은 다시 불러오기) */
  let shown = '';
  go.addEventListener('click', () => {
    play('click');
    if (shown) void startDaily(shown);
    else showDaily();
  });
  void (known ? Promise.resolve(known) : todayCourse()).then((c) => {
    if (!root.isConnected) return;
    if (!c) {
      root.querySelector('#d-day')!.textContent = '오늘 날짜를 받지 못했어요';
      go.textContent = '🔄 다시 불러오기';
      go.disabled = false;
      return;
    }
    shown = c.day;
    root.querySelector('#d-day')!.textContent = dayLabel(c.day);
    const boss = root.querySelector<HTMLElement>('#d-boss')!;
    boss.innerHTML = `<span>오늘의 보스</span>${c.bosses.map((b) => `<em><var>${b.meters.toLocaleString()}m</var> ${b.name}</em>`).join('')}`;
    boss.hidden = false;
    go.disabled = false;
    void loadDailyRank(c.day).then((r) => {
      const box = root.querySelector<HTMLElement>('#d-rank');
      if (!r || !box || !root.isConnected) return;
      box.innerHTML = `<h3>🏆 오늘 순위 <small>${r.total.toLocaleString()}명${r.mine ? ` · 나 ${r.mine.place}위 (${r.mine.plays}판)` : ''}</small></h3>${dailyRankHtml(r)}`;
      box.hidden = false;
    });
  });
}

// ---------- 지역 지도 · 스테이지 ----------

function showRegions() {
  const ts = totalStars(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도</h2><div class="pills">${starPill()}</div></div>
    <div class="region-grid">${Array.from({ length: REGIONS }, (_, i) => {
      const r = i + 1;
      const open = regionOpen(profile, r);
      const need = regionStars(r);
      const sub = open ? `★ ${regionStarsOf(profile, r)}/15` : ts < need ? `🔒 ★${need}` : `🔒 ${r - 1}-5`;
      return `<button class="region bg-${groundOf(r)} ${open ? '' : 'locked'}" data-r="${r}">
          <img src="${zodiacFaceUrl(ZODIAC_IDS[r - 1])}" alt="" />
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
      if (!regionOpen(profile, r)) {
        const need = regionStars(r);
        return toast(totalStars(profile) < need ? `별 ${need}개가 있어야 열려요 (지금 ${totalStars(profile)}개)` : `${r - 1}-5 보스를 깨야 열려요`);
      }
      showStages(r);
    }),
  );
}

function showStages(region: number) {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${REGION_NAMES[region - 1]}</h2><div class="pills">${coinsPill()}</div></div>
    <div class="stage-list">${stagesOf(region)
      .map((st) => {
        const open = stageOpen(profile, st.id);
        const boss = st.no === 5;
        return `<button class="btn stage-row ${open ? '' : 'locked'} ${boss ? 'boss' : ''}" data-id="${st.id}">
            <b>${st.id}</b><span>${open ? st.name : '🔒 앞 스테이지를 깨면 열려요'}</span>${starsHtml(profile.stages[st.id] ?? 0)}${open ? `${foesHtml(st)}<small class="tops" data-tops="${st.id}"></small>` : ''}
          </button>`;
      })
      .join('')}</div>
    <p class="soft center light" id="tops-note" hidden>🏅 스테이지마다 대원을 가장 많이 남긴 친구들</p>
    <div class="grow"></div>
    <p class="soft center light">대장: ${leaderOf(leader).nick} · ${leaderOf(leader).trait}</p>`,
    `bg-${groundOf(region)}`,
  );
  // 친구 기록: 받아 둔 것이 있으면 바로, 없거나 오래됐으면 받아서 그린다 (실패·테스트 모드는 그대로 숨김)
  const paintTops = (tops: StageTops) => {
    let any = false;
    root.querySelectorAll<HTMLElement>('[data-tops]').forEach((el) => {
      const t = tops[el.dataset.tops!];
      el.innerHTML = t ? topsHtml(t) : '';
      any ||= !!t;
    });
    root.querySelector<HTMLElement>('#tops-note')!.hidden = !any;
  };
  const cached = topsCache.get(region);
  if (cached && !LOCAL_MODE && !DEV_ALL) paintTops(cached.data);
  if (!cached || Date.now() - cached.at > TOPS_FRESH_MS) {
    void loadTops(region).then((tops) => {
      if (tops && root.isConnected) paintTops(tops);
    });
  }
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showRegions();
  });
  root.querySelectorAll<HTMLButtonElement>('.stage-row').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const st = stageOf(b.dataset.id!);
      if (!st) return;
      if (!stageOpen(profile, st.id)) return toast('앞 스테이지를 먼저 깨 주세요');
      startGame(st, false);
    }),
  );
}

// ---------- 강화 ----------

function showUpgrades() {
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>강화</h2><div class="pills">${coinsPill()}</div></div>
    <div class="up-list">${UPGRADES.map((u) => {
      const lv = profile.upgrades[u.key] ?? 0;
      const max = lv >= u.max;
      const cost = upgradeCost(u, lv);
      return `<div class="card up-row">
          <div class="up-info"><b>${u.name}</b><span class="soft">한 단계 ${u.per}</span>
            <div class="lv"><i style="width:${(lv / u.max) * 100}%"></i></div><span class="soft">${lv} / ${u.max}</span></div>
          <button class="btn ${max ? '' : 'primary'} small" data-k="${u.key}" ${max || profile.coins < cost ? 'disabled' : ''}>${max ? '최대' : `🪙 ${cost}`}</button>
        </div>`;
    }).join('')}</div>
    <p class="soft center light">엽전은 스테이지를 깨거나 끝없는 길을 달리면 모여요</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        profile = await api.buyUpgrade(b.dataset.k as UpgradeKey);
        play('coin');
      } catch (e) {
        toast(errText(e));
      }
      showUpgrades();
    }),
  );
}

// ---------- 게임 ----------

let game: Phaser.Game | null = null;
let busy = false;
/** 판을 시작하기 전 못 보낸 기록을 기다리는 최대 시간: 넘으면 보내기는 뒤에서 계속하고 판을 시작한다 */
const RESEND_WAIT_MS = 4000;

function closeGame() {
  game?.destroy(true);
  game = null;
}

export async function startGame(stage: StageDef, endless: boolean) {
  if (busy) return;
  busy = true;
  let runId = '';
  const daily = stage.id === DAILY_ID;
  // 처음 불러오는 화면(main.ts 의 .connecting)에서 바로 시작한 경우: 실패하면 메인으로
  const fromBoot = !!app().querySelector('.connecting');
  // 개발용 ?all=1 은 기기에만 연 상태라 기록하지 않는다
  const wait = DEV_ALL ? null : waitBox('연결 중…');
  try {
    if (!DEV_ALL) {
      // 보관해 둔(못 보낸) 판을 먼저 보낸다: 새 판이 끝난 뒤에 보내면 서버가 시간이 겹친다(overlap)며 버린다.
      // 오래 걸리면 RESEND_WAIT_MS 만 기다리고, 남은 보내기는 뒤에서 마저 한다
      const resending = api.resend().catch(() => 0);
      const n = await Promise.race([resending, new Promise<null>((ok) => setTimeout(() => ok(null), RESEND_WAIT_MS))]);
      if (n === null) void resending.then(noteResent);
      else await noteResent(n);
      // 오늘의 길은 코스를 만든 날짜(runDay)를 함께 보낸다: 서버가 그 날짜로 기록하고, 자정을 넘겨 닿으면 거절한다 (bad day)
      runId = await api.start(stage.id, leader, daily ? 'daily' : endless ? 'endless' : 'normal', daily ? runDay : undefined);
    }
  } catch (e) {
    busy = false;
    wait?.remove();
    // 오늘의 길: 날짜가 바뀌었으면(자정) 새 날짜로 오늘의 도전 화면을 다시 그린다
    if (daily && e instanceof ApiError && e.message === 'bad day') showDaily();
    else if (fromBoot) showMain();
    toast(errText(e), 3200);
    return;
  }
  busy = false;
  // 기다리는 사이 다른 화면으로 갔으면(기다림 창이 화면과 함께 사라짐) 시작하지 않는다
  if (wait && !wait.isConnected) return;
  wait?.remove();
  if (!DEV_ALL && !runId) toast('서버에 연결하지 못했어요. 이번 판은 기록되지 않아요');
  const run = createRun(stage, leader, modsOf(profile.upgrades));
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-mid"><b>${endless ? stage.name : `${stage.id} ${stage.name}`}</b>
        ${endless ? '<span id="meters">0m · 보스 0</span>' : '<div class="prog"><i id="prog"></i><span class="boss-mark">👹</span></div>'}</div>
      <span class="troop-pill" id="troops">🪖 ${run.troops}</span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 좌우로 끌어 문을 고르세요</div>`;
  const prog = root.querySelector<HTMLElement>('#prog');
  const meters = root.querySelector<HTMLElement>('#meters');
  const troops = root.querySelector<HTMLElement>('#troops')!;
  let hinted = false;
  let sent = false;
  /** 이번 판에서 도감에 새로 적힌 것 (결과 창에 알린다). 개발용 ?all=1 은 기록하지 않는다 */
  const newFoes: CodexId[] = [];
  const scene = new GameScene();
  closeGame();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root.querySelector<HTMLElement>('#game')!,
    width: W,
    height: H,
    backgroundColor: TABLE.matgo,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 },
    scene: [],
    banner: false,
  });
  const finish = async (s: RunState) => {
    if (sent) return null;
    sent = true;
    if (DEV_ALL) return { result: null, note: null };
    const report: RunReport = {
      run: runId,
      stage: stage.id,
      leader,
      mode: daily ? 'daily' : endless ? 'endless' : 'normal',
      time: Math.floor(s.t),
      cleared: s.phase === 'clear',
      troops: s.troops,
      kills: s.kills,
      progress: progressOf(s),
      meters: metersOf(s),
      bosses: s.bosses,
      crate: s.crateCoins,
    };
    try {
      const r = await api.finish(report);
      // 시작을 서버에 알리지 못한 판(runId 없음)은 보관되지 않으므로 "보관했어요" 안내를 하지 않는다
      if (!r) return { result: null, note: runId ? 'kept' : 'unrecorded' } as const;
      if (!DEV_ALL) profile = r.profile;
      return { result: r.result, note: null };
    } catch (e) {
      toast(errText(e));
      return { result: null, note: null };
    }
  };
  game.scene.add('game', scene, true, {
    run,
    hooks: {
      sound: play,
      onEvent: (e: SimEvent, s: RunState) => {
        if (DEV_ALL) return;
        const id = seenOf(s, e);
        if (id && codex.add(id)) newFoes.push(id);
      },
      onFrame: (s: RunState) => {
        if (prog) prog.style.width = `${Math.round(progressOf(s) * 100)}%`;
        if (meters) meters.textContent = `${metersOf(s).toLocaleString()}m · 보스 ${s.bosses}`;
        troops.textContent = `🪖 ${s.troops.toLocaleString()}`;
        if (!hinted && s.t > 3) {
          hinted = true;
          root.querySelector('#hint')?.remove();
        }
      },
      onEnd: async (s: RunState) => {
        const out = await finish(s);
        showResult(s, endless, out?.result ?? null, out?.note ?? null, newFoes);
      },
    },
  });
  root.querySelector('#pause')!.addEventListener('click', () => {
    // 판이 끝난 뒤(클리어·전멸 연출 1~1.4초 동안)에는 멈추지 않는다: 그만하기가 클리어를 실패로 덮어쓰지 않게
    if (scene.paused || sent || run.phase === 'clear' || run.phase === 'fail') return;
    play('click');
    scene.paused = true;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button>
      <p class="soft center">그만하면 실패로 기록돼요${daily ? ' (오늘의 길은 여기까지 기록)' : endless ? ' (끝없는 길은 여기까지 기록)' : ''}</p></div>`;
    root.appendChild(box);
    box.querySelector('#resume')!.addEventListener('click', () => {
      play('click');
      scene.paused = false;
      box.remove();
    });
    box.querySelector('#quit')!.addEventListener('click', async () => {
      play('click');
      box.remove();
      // 창이 떠 있는 사이 판이 끝났으면 그 결과(클리어 등)를 그대로 둔다
      if (sent || run.phase === 'clear' || run.phase === 'fail') {
        scene.paused = false;
        return;
      }
      run.phase = 'fail';
      const wait = waitBox('기록 보내는 중…');
      const out = await finish(run);
      wait.remove();
      if (endless) return showResult(run, true, out?.result ?? null, out?.note ?? null, newFoes);
      closeGame();
      showMain();
    });
  });
}

/** note: 'kept' = 서버에 못 보내 기기에 보관, 'unrecorded' = 시작을 알리지 못해 기록되지 않는 판 */
type RecordNote = 'kept' | 'unrecorded' | null;

function showResult(s: RunState, endless: boolean, r: FinishResult | null, note: RecordNote, newFoes: CodexId[] = []) {
  const st = s.stage;
  const daily = st.id === DAILY_ID;
  const win = !endless && s.phase === 'clear';
  const stars = win ? starsFor(s) : 0;
  play(win || (endless && r?.best) ? 'win' : 'lose');
  const next = win ? nextStage(st.id) : null;
  const nextOk = !!next && stageOpen(profile, next.id);
  const title = daily ? (r?.best ? '오늘 새 기록!' : '오늘의 길 끝') : endless ? (r?.best ? '새 기록!' : '끝없는 길 끝') : win ? '클리어!' : '전멸했어요';
  // 친구 기록 상자: 받아 오는 동안 버튼이 밀리지 않게 자리를 미리 잡아 둔다 (.wait = 보이지 않음).
  // 끝없는 길·테스트 모드, 그리고 서버에 닿지 않아 보관한 판('kept': 받아 올 수도 없다)에는 넣지 않는다
  const wantTops = !endless && !LOCAL_MODE && !DEV_ALL && note !== 'kept';
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${win || endless ? 'win' : 'lose'}">
      <h2>${title}</h2>
      ${win ? `<div class="big-stars">${starsHtml(stars)}</div>` : endless ? `<p class="big-num">${metersOf(s).toLocaleString()}m</p>` : `<p class="soft center">${Math.round(progressOf(s) * 100)}% 까지 갔어요</p>`}
      <div class="rows">
        ${endless ? `<div><span>쓰러뜨린 보스</span><b>${s.bosses}</b></div>` : `<div><span>남은 대원</span><b>${s.troops}</b></div>`}
        <div><span>가장 많았을 때</span><b>${s.peak.toLocaleString()}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${s.kills.toLocaleString()}</b></div>
        ${r ? `<div><span>엽전</span><b class="coin">+${r.coins}${r.first ? ' (첫 클리어)' : ''}</b></div>` : ''}
        ${r?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      ${r && r.newLeaders.length ? `<div class="new-leaders">${r.newLeaders.map((id) => `<span><img src="${zodiacFaceUrl(id)}" alt="" />${leaderOf(id).nick} 대장이 합류했어요!</span>`).join('')}</div>` : ''}
      ${newFoes.length ? `<p class="new-foes"><span>📖 도감에 새로 적었어요</span>${newFoes.map((id) => `<i>${foeImg(codexEntry(id), true)}</i>`).join('')}</p>` : ''}
      ${daily ? '<p class="daily-place" hidden></p>' : ''}
      ${wantTops ? '<div class="tops-box wait"><span class="soft">🏅 최다 생존 대원</span><small class="tops"><em><u>&nbsp;</u></em></small></div>' : ''}
      ${note === 'kept' ? '<p class="soft center">서버에 연결하지 못해 기록을 보관했어요. 다음에 들어오면 다시 보내요</p>' : ''}
      ${note === 'unrecorded' ? '<p class="soft center">이번 판은 기록되지 않았어요</p>' : ''}
      ${win && stars < 3 ? `<p class="soft center">별 ${stars + 1}개: 대원 ${st.stars[stars - 1]}명 이상 남기기</p>` : ''}
      ${!endless && !win ? '<p class="soft center">💪 강화하거나 다른 길을 골라 보세요</p>' : ''}
      <div class="btns">
        ${nextOk ? `<button class="btn primary big" id="next">다음 스테이지 ▶</button>` : ''}
        <button class="btn ${nextOk ? '' : 'primary big'}" id="again">다시하기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  if (r?.newLeaders.length) play('newRecord');
  // 이 스테이지 친구 기록: 방금 판이 반영되게 새로 받는다 (불러오기 실패는 자리만 둔 채 보이지 않게)
  const topsBox = box.querySelector<HTMLElement>('.tops-box');
  if (topsBox) {
    void loadTops(st.region).then((tops) => {
      if (!tops || !box.isConnected) return;
      const t = tops[st.id];
      topsBox.innerHTML = t
        ? topsBoxHtml(t)
        : '<span class="soft">🏅 최다 생존 대원</span><small class="tops"><em><u>아직 클리어한 친구가 없어요</u></em></small>';
      topsBox.classList.remove('wait');
    });
  }
  // 오늘의 도전: 방금 판이 반영된 오늘 순위에서 내 자리 (기록되지 않았거나 실패하면 숨긴 채로)
  const placeEl = box.querySelector<HTMLElement>('.daily-place');
  if (placeEl && r?.daily && isDay(r.daily.day)) {
    void loadDailyRank(r.daily.day).then((rank) => {
      if (!rank?.mine || !box.isConnected) return;
      // 기록된 날이 서버의 오늘이 아니면(자정을 넘겨 끝난 판) "오늘" 대신 날짜로 (placeText)
      const below = rank.mine.meters > metersOf(s) ? ` · ${isPastDay(rank) ? '그날' : '오늘'} 최고 ${rank.mine.meters.toLocaleString()}m` : '';
      placeEl.textContent = `🏅 ${placeText(rank)}${below}`;
      placeEl.hidden = false;
    });
  }
  box.querySelector('#next')?.addEventListener('click', () => {
    play('click');
    closeGame();
    void startGame(next!, false);
  });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    // 오늘의 길: 날짜를 다시 받아 보고 나서 판을 닫는다 (못 받으면 결과 창에 그대로 머문다)
    if (daily) return void startDaily(runDay);
    closeGame();
    void startGame(endless ? endlessStage() : st, endless);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    if (daily) showDaily();
    else if (endless) showMain();
    else showStages(st.region);
  });
}
