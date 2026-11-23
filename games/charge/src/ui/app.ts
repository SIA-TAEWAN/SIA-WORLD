import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl } from '../assets';
import { hasArt } from '../scenes/art';
import { LEADERS, ZODIAC_IDS, leaderOf, type LeaderId } from '../data/balance';
import { REGIONS, REGION_NAMES, UPGRADES, groundOf, modsOf, regionStars, upgradeCost, type UpgradeKey } from '../data/growth';
import { ENDLESS_ID, STAGES, endlessStage, nextStage, stageOf, stagesOf, type StageDef } from '../data/stages';
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
import { createRun, metersOf, progressOf, starsFor, type RunState } from '../game/sim';
import { ApiError, type ChargeApi } from '../net/api';
import { DEV_ALL, DEV_CAT_READY, DEV_OWNED, LOCAL_MODE } from '../net/local';
import { buyCharacter, loadOwnedCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import { TABLE } from '../theme';

/**
 * 메뉴·지역 지도·강화·게임 화면·결과 (PRD 10장).
 * 기록은 서버 RPC(061_charge.sql)로만 바뀐다. 테스트 모드(?local=1)는 기기에만 저장한다.
 */

let api!: ChargeApi;
let me: WorldUser | null = null;
let profile: ChargeProfile = emptyProfile();
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
        applyOwned(ids);
        // 메인(대장 고르기)을 보고 있으면 바로 다시 그린다
        if (leadersOf(profile).join() !== was && document.querySelector('.leaders')) showMain();
      });
    });
  }
  try {
    const saved = localStorage.getItem(LEADER_KEY) as LeaderId | null;
    if (saved && leadersOf(profile).includes(saved)) leader = saved;
  } catch {
    /* 저장 공간 없음 */
  }
  void api
    .resend()
    .then(noteResent)
    .catch(() => null);
}

/** 이 게임에서 연 추가 캐릭터 */
let owned: string[] = [];
/** 연 캐릭터 목록 반영 (null = 못 읽음 → 그대로). 고른 대장이 잠기면 첫 대장으로 */
function applyOwned(ids: string[] | null) {
  if (!ids) return;
  owned = [...ids];
  setOwnedExtras(owned);
  const open = leadersOf(profile);
  if (!open.includes(leader)) setLeader(open[0] ?? 'rat');
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
  showMain();
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
            <img src="${zodiacFaceUrl(l.id)}" alt="${l.name}" /><b>${l.name}</b>${ok ? '' : `<em>🔒${l.extra ? '' : ` ${l.unlockRegion}지역`}</em>`}
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
      <div class="row2">
        <button class="btn" id="up">💪 강화</button>
        <button class="btn ${eOpen ? '' : 'soon'}" id="endless">♾️ 끝없는 길${eOpen ? '' : ' 🔒'}</button>
      </div>
      <div class="row2">
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
        return toast(`🔒 ${leaderOf(id).name} — ${leaderOf(id).trait}`, 3200);
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
            <b>${st.id}</b><span>${open ? st.name : '🔒 앞 스테이지를 깨면 열려요'}</span>${starsHtml(profile.stages[st.id] ?? 0)}
          </button>`;
      })
      .join('')}</div>
    <div class="grow"></div>
    <p class="soft center light">대장: ${leaderOf(leader).name} · ${leaderOf(leader).trait}</p>`,
    `bg-${groundOf(region)}`,
  );
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
      runId = await api.start(endless ? ENDLESS_ID : stage.id, leader, endless ? 'endless' : 'normal');
    }
  } catch (e) {
    busy = false;
    wait?.remove();
    if (fromBoot) showMain();
    toast(errText(e));
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
      <div class="hud-mid"><b>${endless ? '끝없는 길' : `${stage.id} ${stage.name}`}</b>
        ${endless ? '<span id="meters">0m · 보스 0</span>' : '<div class="prog"><i id="prog"></i><span class="boss-mark">👹</span></div>'}</div>
      <span class="troop-pill" id="troops">🪖 ${run.troops}</span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 좌우로 끌어 문을 고르세요</div>`;
  const prog = root.querySelector<HTMLElement>('#prog');
  const meters = root.querySelector<HTMLElement>('#meters');
  const troops = root.querySelector<HTMLElement>('#troops')!;
  let hinted = false;
  let sent = false;
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
      stage: endless ? ENDLESS_ID : stage.id,
      leader,
      mode: endless ? 'endless' : 'normal',
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
        showResult(s, endless, out?.result ?? null, out?.note ?? null);
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
      <p class="soft center">그만하면 실패로 기록돼요${endless ? ' (끝없는 길은 여기까지 기록)' : ''}</p></div>`;
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
      if (endless) return showResult(run, true, out?.result ?? null, out?.note ?? null);
      closeGame();
      showMain();
    });
  });
}

/** note: 'kept' = 서버에 못 보내 기기에 보관, 'unrecorded' = 시작을 알리지 못해 기록되지 않는 판 */
type RecordNote = 'kept' | 'unrecorded' | null;

function showResult(s: RunState, endless: boolean, r: FinishResult | null, note: RecordNote) {
  const st = s.stage;
  const win = !endless && s.phase === 'clear';
  const stars = win ? starsFor(s) : 0;
  play(win || (endless && r?.best) ? 'win' : 'lose');
  const next = win ? nextStage(st.id) : null;
  const nextOk = !!next && stageOpen(profile, next.id);
  const title = endless ? (r?.best ? '새 기록!' : '끝없는 길 끝') : win ? '클리어!' : '전멸했어요';
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
      ${r && r.newLeaders.length ? `<div class="new-leaders">${r.newLeaders.map((id) => `<span><img src="${zodiacFaceUrl(id)}" alt="" />${leaderOf(id).name} 대장이 합류했어요!</span>`).join('')}</div>` : ''}
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
  box.querySelector('#next')?.addEventListener('click', () => {
    play('click');
    closeGame();
    void startGame(next!, false);
  });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    closeGame();
    void startGame(endless ? endlessStage() : st, endless);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    if (endless) showMain();
    else showStages(st.region);
  });
}
