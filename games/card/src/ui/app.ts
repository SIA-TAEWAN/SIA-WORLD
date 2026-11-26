/**
 * 시아카드배틀 화면 (HTML 메뉴 + Phaser 전투).
 * 처음 → 영웅 고르기 → 지도 ↔ 칸(전투·보상·상점·쉼터·보물·이야기) → 막 보스 → 결과.
 * 판 상태는 규칙 코드(apply)만 바꾼다. 칸에 들어갈 때마다(전투 밖의 입력마다) 기기에 자동 저장 — 전투 중에 끄면 그 전투 처음부터.
 */
import Phaser from 'phaser';
import {
  CARDS,
  ENEMIES,
  FINAL_ELITES,
  HEROES,
  MASTERY,
  MASTERY_OPEN,
  MAX_POTIONS,
  MIN_DECK,
  RELICS,
  RULES_VERSION,
  apply,
  canChoose,
  canUpgrade,
  cardDef,
  choices,
  dailyRun,
  enemyDef,
  enterTestBattle,
  eventDef,
  finalOpen,
  genMap,
  heroDef,
  newRun,
  potionDef,
  regionDef,
  relicDef,
  removePrice,
  replay,
  restHeal,
  restUpgrades,
  runScore,
  upgradable,
  type DeckCard,
  type Input,
  type NodeType,
  type RunMode,
  type RunState,
} from '../game/rules';
import { DEV_ACT, DEV_ELITES, DEV_ENDING, DEV_FOES, DEV_GOLD, DEV_HERO, DEV_KIND, DEV_RELICS, DEV_RESET, DEV_SEED, LOCAL_MODE } from '../net/local';
import { ApiError, createApi, friendly, type CardApi, type CardState, type FinishResult, type ServerRun } from '../net/api';
import { loadCharacters, loadSound, openWorldRanking, worldHome, worldSupabase, type SoundModule, type WorldUser } from '../net/world';
import { BattleScene, H, W, type BattleHooks } from '../scenes/BattleScene';
import { MAP_NODE_FRAME, artState, artUrl, hasArt } from '../art';
import { artImg, cardHtml, potionHtml, potionIcon, relicHtml, relicIcon } from './cards';
import { addToCodex, loadCodex, saveCodex } from './codex';
import { shrinkOverflow } from './fit';
import { pickResume, startedRun, type Saved } from './resume';

interface Ctx {
  user: WorldUser | null;
  sound: SoundModule | null;
  run: RunState | null;
  /** 지금 판의 서버 판 번호 (테스트 모드 · 연습 전투는 null) */
  runId: string | null;
  game: Phaser.Game | null;
  /** 서버 (테스트 모드는 null) */
  api: CardApi | null;
  /** 서버에서 받은 내 상태 (못 받았으면 null) */
  state: CardState | null;
  /** 이 게임에서 연 추가 캐릭터 (못 읽었으면 null) */
  owned: string[] | null;
  /** 서버 연결 준비 (boot) */
  ready: Promise<void>;
  /** 마지막 업로드 결과 (결과 화면이 기다린다) */
  lastResult: Promise<FinishResult | null> | null;
  /** 지금 보이는 화면 (처음 화면을 서버 상태로 다시 그릴 때) */
  view: string;
}
const ctx: Ctx = { user: null, sound: null, run: null, runId: null, game: null, api: null, state: null, owned: null, ready: Promise.resolve(), lastResult: null, view: '' };

const app = () => document.getElementById('app')!;
const gameEl = () => document.getElementById('game')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const sfx = (name: string) => {
  try {
    ctx.sound?.play(name);
  } catch {
    /* 소리는 없어도 된다 */
  }
};
const worldRoot = () => new URL('../../', document.baseURI);
const heroImg = (id: string) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
const heroFace = (id: string) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;

export function toast(text: string, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.getElementById('stage')!.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- 저장 (localStorage 는 막혀 있을 수 있어 늘 try/catch) ----------

/** 모드마다 따로 저장 (계정당 모드별 진행 중인 판 1개) — { runId, run } */
const SAVE_PREFIX = LOCAL_MODE ? 'siacard:local:run:' : 'siacard:run:';
const CODEX_KEY = LOCAL_MODE ? 'siacard:local:codex' : 'siacard:codex';
function saveRun() {
  const r = ctx.run;
  if (!r || r.practice) return;
  try {
    if (r.phase === 'dead' || r.phase === 'won') localStorage.removeItem(SAVE_PREFIX + r.mode);
    else localStorage.setItem(SAVE_PREFIX + r.mode, JSON.stringify({ runId: ctx.runId, run: r } satisfies Saved));
  } catch {
    /* 저장 못 해도 판은 이어진다 */
  }
}
function loadSaved(mode: RunMode): Saved | null {
  try {
    const s = localStorage.getItem(SAVE_PREFIX + mode);
    if (!s) return null;
    const v = JSON.parse(s) as Saved;
    const r = v?.run;
    // 규칙이 바뀐 판(RULES_VERSION)은 이어 할 수 없다 — 같은 입력이 다른 결과가 된다
    return r && r.v === 1 && r.rules === RULES_VERSION && r.mode === mode && Array.isArray(r.log) ? { runId: typeof v.runId === 'string' ? v.runId : null, run: r } : null;
  } catch {
    return null;
  }
}
function clearRun(mode: RunMode) {
  try {
    localStorage.removeItem(SAVE_PREFIX + mode);
  } catch {
    /* 무시 */
  }
}

/**
 * 이어 할 판: 이 기기의 저장이 서버 판과 같은 판이면 기기 것(더 많이 감), 서버에만 있으면(다른 기기) 서버 기록을 다시 돌린 것
 * = 마지막으로 깬 막 다음부터. 서버에서 끝났거나 버린 판의 기기 저장은 지운다.
 */
function resumable(mode: RunMode): { saved?: Saved; server?: ServerRun } | null {
  const saved = loadSaved(mode);
  if (LOCAL_MODE || !ctx.state) return saved ? { saved } : null;
  const pick = pickResume(saved, ctx.state.runs[mode], (id) => !!ctx.api?.pending(id));
  if (pick && 'clear' in pick) {
    clearRun(mode);
    return null;
  }
  return pick;
}
function resume(mode: RunMode): boolean {
  const r = resumable(mode);
  if (r?.saved) {
    ctx.run = r.saved.run;
    ctx.runId = r.saved.runId;
    return true;
  }
  if (r?.server) {
    const s = r.server;
    const again = replay(s.seed, s.hero, s.log, { mode: s.mode, mastery: s.mastery, gold: s.startGold ?? null });
    if (again.bad >= 0) {
      toast('이 판은 이어 할 수 없어요');
      return false;
    }
    ctx.run = again.run;
    ctx.runId = s.runId;
    saveRun();
    toast(`다른 기기의 판을 ${again.run.act}막 처음부터 이어 해요`, 2400);
    return true;
  }
  return false;
}
const resumeText = (mode: RunMode) => {
  const r = resumable(mode);
  const run = r?.saved?.run;
  if (run) return `${run.act === 4 && run.mode !== 'endless' ? '숨은 4막' : `${run.act}막 ${Math.max(0, run.row + 1)}칸`} · ${heroDef(run.hero).name}`;
  if (r?.server) return `${r.server.acts + 1}막부터 · ${heroDef(r.server.hero).name}`;
  return null;
};

// ---------- 서버 ----------

async function initServer() {
  if (LOCAL_MODE || !ctx.user) return;
  try {
    ctx.api = createApi(await worldSupabase(), ctx.user.userId, localStorage);
  } catch {
    return;
  }
  await Promise.all([refreshState(), refreshOwned()]);
  // 못 보낸 막 기록이 있으면 다시 보낸다 → 상태도 다시
  void ctx.api.flush().then((n) => (n ? refreshState() : null));
}
async function refreshState() {
  if (!ctx.api) return;
  try {
    ctx.state = await ctx.api.state();
  } catch {
    /* 못 받으면 기기 것만 */
  }
}
async function refreshOwned(force = false) {
  if (LOCAL_MODE) return;
  try {
    const list = await (await loadCharacters()).loadOwnedCharacters('card', force);
    if (list) ctx.owned = list;
  } catch {
    /* 못 읽으면 잠긴 것으로 */
  }
}

/** 막이 끝났거나 판이 끝났으면 서버에 입력 기록을 보낸다 (실패하면 보관했다 다음에 다시) */
function uploadRun() {
  const run = ctx.run;
  if (!run || !ctx.api || !ctx.runId) return;
  const p = ctx.api
    .upload(ctx.runId, run.log)
    .then((res) => {
      if (res?.newCoins) toast(`시아코인 +${res.newCoins}`, 2200);
      return res;
    })
    .catch((e) => {
      if (e instanceof ApiError && e.message === 'old rules') toast(friendly(e), 2600);
      return null;
    });
  ctx.lastResult = p;
  void p.then(() => refreshState());
}

/** 도감: 이 기기에만 (오늘의 도전·연습 전투는 넣지 않는다) */
let codex = loadCodex(CODEX_KEY);
function noteCodex(run: RunState) {
  if (run.practice || run.mode === 'daily') return;
  if (addToCodex(codex, run)) saveCodex(CODEX_KEY, codex);
}

/** 입력 하나 — 받아들여지면 저장 (전투 중 입력은 저장하지 않음: 전투에 들어간 순간이 저장점) */
function send(i: Input) {
  const run = ctx.run;
  if (!run) return null;
  const acts = run.actStart.length;
  const r = apply(run, i);
  if (r.ok) {
    if (i.t === 'go' || run.phase !== 'battle') saveRun();
    noteCodex(run);
    // 막을 넘겼거나(다음 막 시작) 판이 끝났으면 서버로
    if (!run.practice && (run.actStart.length !== acts || run.phase === 'dead' || run.phase === 'won')) uploadRun();
  }
  return r;
}

// ---------- 시작 ----------

export function boot(user: WorldUser | null) {
  ctx.user = user;
  if (DEV_RESET) for (const m of ['normal', 'endless', 'daily'] as const) clearRun(m);
  ctx.ready = initServer().then(() => {
    // 서버 상태가 늦게 왔으면 처음 화면을 다시 그린다 (이어하기 · 숙련 · 오늘의 도전)
    if (ctx.view === 'title') showTitle();
  });
  void loadSound()
    .then((m) => (ctx.sound = m))
    .catch(() => null);
}

export function showFirst() {
  if (LOCAL_MODE && DEV_FOES.length) return startPractice(DEV_FOES, DEV_KIND);
  if (LOCAL_MODE && DEV_ENDING) {
    ctx.run = newRun({ seed: DEV_SEED ?? 1, hero: DEV_HERO ?? 'tiger' });
    Object.assign(ctx.run, { phase: 'won', ending: DEV_ENDING, act: DEV_ENDING === 'true' ? 4 : 3 });
    ctx.run.stats = { floors: 37, elites: DEV_ENDING === 'true' ? 4 : 1, bosses: DEV_ENDING === 'true' ? 4 : 3, battles: 20 };
    ctx.run.map = genMap(1, ctx.run.act);
    ctx.runId = null;
    return showResult();
  }
  showTitle();
}

function stopGame() {
  if (ctx.game) {
    // WebGL 컨텍스트도 놓는다 (Phaser destroy 는 loseContext 를 부르지 않는다 — 아이폰은 컨텍스트 수 · GPU 메모리가 빠듯하다)
    const g = ctx.game;
    const r = g.renderer;
    const gl = r instanceof Phaser.Renderer.WebGL.WebGLRenderer ? r.gl : null;
    if (gl)
      g.events.once(Phaser.Core.Events.DESTROY, () =>
        setTimeout(() => {
          try {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
          } catch {
            /* 이미 잃음 */
          }
        }, 0),
      );
    g.destroy(true);
    ctx.game = null;
  }
  gameEl().classList.add('hidden');
}

function screen(html: string, cls = '', view = '') {
  ctx.view = view;
  stopGame();
  app().innerHTML = `<div class="screen ${cls}">${html}</div>`;
  app().querySelector('.screen')!.scrollTop = 0;
  requestAnimationFrame(() => shrinkOverflow(app()));
  return app().querySelector<HTMLElement>('.screen')!;
}

function on(root: ParentNode, sel: string, fn: (el: HTMLElement) => void) {
  root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
    el.addEventListener('click', () => {
      sfx('click');
      fn(el);
    }),
  );
}

/** 한국 날짜 (테스트 모드 · 서버를 못 부를 때) */
const localDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const todayOf = () => (LOCAL_MODE ? localDay() : ctx.state?.today || null);

function showTitle() {
  const cont = resumeText('normal');
  const endless = resumeText('endless');
  const daily = resumeText('daily');
  const day = todayOf();
  const dailyHero = day ? heroDef(dailyRun(day).hero).name : null;
  const best = ctx.state?.endless;
  const s = screen(
    `
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="nick">${esc(ctx.user?.nickname ?? '테스트 대원')}</span></div>
    <div class="title"><h1>시아카드배틀</h1><p>십이지 영웅으로 카드 덱을 키우며 요괴를 물리쳐요</p></div>
    <div class="title-art"><img src="${heroImg('tiger')}" alt="" onerror="this.remove()"></div>
    <div class="btns">
      ${cont ? `<button class="btn primary big" id="cont">이어하기 <small>${esc(cont)}</small></button>` : ''}
      <button class="btn ${cont ? '' : 'primary big'}" id="new">새 판 ▶</button>
      <div class="row2">
        <button class="btn" id="daily">오늘의 도전 <small>${daily ? '이어하기' : ctx.state?.dailyPlayed ? '오늘 도전함' : dailyHero ? esc(dailyHero) : ''}</small></button>
        <button class="btn" id="endless">끝없는 모드 <small>${endless ? '이어하기' : best ? `최고 ${best.floors}칸` : ''}</small></button>
      </div>
      <div class="row2">
        <button class="btn" id="codex">도감</button>
        <button class="btn" id="rank">랭킹</button>
      </div>
      ${LOCAL_MODE ? '<button class="btn small" id="practice">개발: 연습 전투</button>' : ''}
    </div>
  `,
    '',
    'title',
  );
  on(s, '#cont', () => {
    if (resume('normal')) showRun();
  });
  on(s, '#new', () => {
    if (cont && !confirm('진행 중인 판이 사라져요. 새로 시작할까요?')) return;
    firstTime(() => showHeroes('normal'));
  });
  on(s, '#daily', () => firstTime(() => void showDailyIntro()));
  on(s, '#endless', () => {
    if (!endless) return firstTime(() => showHeroes('endless'));
    modal(
      `<h3>끝없는 모드</h3><p class="soft center">진행 중인 판: ${esc(endless)}</p>
      <div class="btns"><button class="btn primary" id="go">이어하기 ▶</button><button class="btn" id="fresh">새로 시작 (진행 중인 판은 사라져요)</button><button class="btn" data-close>닫기</button></div>`,
      (m, close) => {
        on(m, '#go', () => {
          close();
          if (resume('endless')) showRun();
        });
        on(m, '#fresh', () => {
          close();
          showHeroes('endless');
        });
      },
    );
  });
  on(s, '#codex', () => showCodex());
  on(s, '#rank', () => {
    if (LOCAL_MODE || !ctx.user) return toast('테스트 모드에서는 랭킹이 없어요');
    void openWorldRanking(ctx.user.userId).then((ok) => ok || toast('랭킹을 불러오지 못했어요'));
  });
  on(s, '#practice', () => showPracticeMenu());
}

/** 오늘의 도전: 그날 모두 같은 영웅 · 지도 · 보상 (시아코인 · 숙련 · 도감 없음, 하루 첫 판만 기록) */
async function showDailyIntro() {
  if (!LOCAL_MODE && !ctx.state) {
    await ctx.ready;
    if (!ctx.state) await refreshState();
  }
  const day = todayOf();
  if (!day) return toast('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요');
  const d = dailyRun(day);
  const h = heroDef(d.hero);
  const cont = resumeText('daily');
  const played = !!ctx.state?.dailyPlayed;
  const s = screen(`
    <div class="bar"><button class="back" id="back">← 처음</button><h2>오늘의 도전</h2><span class="back-space"></span></div>
    <div class="card hero-info">
      <p class="soft center">${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 · 모두 같은 영웅 · 같은 지도 · 같은 보상</p>
      <div class="hero-top">${artImg(`cut-${h.id}`, `<img src="${heroImg(h.id)}" alt="">`, 'hero-cut')}
        <div><b>${esc(h.name)}</b> <span class="soft">${h.animal} · 체력 ${h.hp}</span><p class="passive"><em>패시브</em> ${esc(h.passive)}</p></div></div>
    </div>
    <div class="card"><h3>점수</h3><p>올라간 칸×10 + 정예×30 + 보스×100 + 남은 체력</p>
      <p class="soft">판이 끝나면(쓰러지거나 엔딩) 기록돼요. <b>하루 첫 판만</b> 순위에 들어가요. 시아코인 · 숙련 · 도감은 없어요.</p>
      ${played && !cont ? '<p class="warn">오늘은 이미 도전했어요. 다시 해도 순위에는 첫 판만 남아요.</p>' : ''}</div>
    <div class="grow"></div>
    ${cont ? `<button class="btn primary big" id="cont">이어하기 <small>${esc(cont)}</small></button>` : ''}
    <button class="btn ${cont ? '' : 'primary big'}" id="go">${cont ? '새로 시작' : '도전 시작 ▶'}</button>`);
  on(s, '#back', () => showTitle());
  on(s, '#cont', () => {
    if (resume('daily')) showRun();
  });
  on(s, '#go', () => {
    if (cont && !confirm('진행 중인 오늘의 도전 판이 사라져요. 새로 시작할까요?')) return;
    void startRun('daily', d.hero, 0, { day, seed: d.seed });
  });
}

/** 도감: 얻은 카드 · 부적, 만난 요괴 (이 기기에만, 게임 영향 없음) */
function showCodex(tab: 'cards' | 'relics' | 'foes' = 'cards') {
  codex = loadCodex(CODEX_KEY);
  const cards = CARDS.filter((c) => c.rarity !== 'curse' && c.kind !== 'curse');
  const foes = ENEMIES.filter((e) => !e.minion);
  const count = { cards: cards.filter((c) => codex.cards.includes(c.id)).length, relics: RELICS.filter((r) => codex.relics.includes(r.id)).length, foes: foes.filter((f) => codex.foes.includes(f.id)).length };
  const total = { cards: cards.length, relics: RELICS.length, foes: foes.length };
  const body =
    tab === 'cards'
      ? `<div class="card-grid">${cards.map((c) => (codex.cards.includes(c.id) ? cardHtml(c.id) : '<div class="codex-unknown">?</div>')).join('')}</div>`
      : tab === 'relics'
        ? `<div class="btns">${RELICS.map((r) => (codex.relics.includes(r.id) ? relicHtml(r.id) : '<div class="item codex-unknown row">? ? ?</div>')).join('')}</div>`
        : `<div class="codex-foes">${foes
            .map((f) =>
              codex.foes.includes(f.id)
                ? `<div class="codex-foe">${artImg(f.art, '👹', 'codex-foe-art')}<span>${esc(f.name)}</span></div>`
                : '<div class="codex-foe off"><span class="codex-unknown">?</span><span>???</span></div>',
            )
            .join('')}</div>`;
  const s = screen(`
    <div class="bar"><button class="back" id="back">← 처음</button><h2>도감</h2><span class="back-space"></span></div>
    <div class="codex-tabs">
      ${(['cards', 'relics', 'foes'] as const).map((t) => `<button class="btn small${t === tab ? ' on' : ''}" data-tab="${t}">${{ cards: '카드', relics: '부적', foes: '요괴' }[t]} <small>${count[t]}/${total[t]}</small></button>`).join('')}
    </div>
    <p class="soft center light">보통 판 · 끝없는 모드에서 얻은 카드 · 부적과 만난 요괴가 모여요 (이 기기에만)</p>
    <div class="card">${body}</div>
    <button class="btn" id="tutorial">연습 전투 다시 보기</button>`);
  on(s, '#back', () => showTitle());
  on(s, '#tutorial', () => startTutorial(() => showCodex(tab)));
  on(s, '[data-tab]', (el) => showCodex(el.dataset.tab as 'cards' | 'relics' | 'foes'));
}

function showPracticeMenu() {
  const sets: [string, string[], 'battle' | 'elite' | 'boss'][] = [
    ['대나무숲: 여우 한 마리', ['fox'], 'battle'],
    ['대나무숲: 스라소니 + 도토리', ['lynx', 'acorn'], 'battle'],
    ['들판: 불수레 + 꼬마 도깨비', ['firecart', 'imp'], 'battle'],
    ['궁궐: 수문병 + 원혼', ['guard', 'spirit'], 'battle'],
    ['저승: 해골 + 불폭탄', ['skeleton', 'bomber'], 'battle'],
    ['정예: 천년 여우', ['foxElite'], 'elite'],
    ...(['gumiho', 'jangsanbeom', 'centipede', 'bigDokkaebi', 'bulgasal', 'gangcheori', 'guardCaptain', 'dueoksini', 'imugi', 'reaper', 'yagwanggwi', 'yeomra', 'final'] as const).map(
      (id) => [`보스 ${enemyDef(id).name}`, [id], 'boss'] as [string, string[], 'boss'],
    ),
  ];
  const s = screen(`<div class="bar"><button class="back" id="back">← 처음</button><h2>연습 전투</h2><span class="back-space"></span></div>
    <div class="btns">${sets.map(([label], i) => `<button class="btn small" data-set="${i}">${label}</button>`).join('')}</div>`);
  on(s, '#back', () => showTitle());
  on(s, '[data-set]', (el) => {
    const [, foes, kind] = sets[Number(el.dataset.set)];
    startPractice(foes, kind);
  });
}

// ---------- 연습 전투 (처음 하는 사람: 첫 판 전 1번, 도감에서 다시 보기) ----------

const TUTORIAL_KEY = LOCAL_MODE ? 'siacard:local:tutorial' : 'siacard:tutorial';
const SEEN_KEY = LOCAL_MODE ? 'siacard:local:seen' : 'siacard:seen';
const tutorialDone = () => {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return true;
  }
};
const markTutorial = () => {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* 저장 못 하면 다음에 또 보인다 */
  }
};
/** 처음 만난 의도·상태이상 (말풍선 한 번) — 기기 저장 */
const seenTips = (() => {
  let set: Set<string> | null = null;
  const load = () => {
    if (set) return set;
    try {
      const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
      set = new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    } catch {
      set = new Set();
    }
    return set;
  };
  return {
    has: (k: string) => load().has(k),
    add: (k: string) => {
      load().add(k);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...load()]));
      } catch {
        /* 무시 */
      }
    },
  };
})();

/** 연습 전투가 끝나면 갈 곳 (null = 연습 전투 아님) */
let tutorialNext: (() => void) | null = null;

/** 첫 판 전에 연습 전투 1번 (이미 했거나 건너뛰었으면 바로) */
function firstTime(next: () => void) {
  if (tutorialDone() || (LOCAL_MODE && DEV_FOES.length)) return next();
  startTutorial(next);
}

/**
 * 연습 전투: 어흥이 vs 여우 1마리(체력 24), 정해진 손패 — 1턴 베기3·막기2, 2턴 베기2·막기2·호랑이 발톱.
 * 기록·서버·도감과 상관없는 연습 판(run.practice). 화살표 안내는 BattleScene(hooks.tutorial).
 */
function startTutorial(next: () => void) {
  const run = newRun({ seed: 7, hero: 'tiger' });
  enterTestBattle(run, ['fox'], 'battle');
  const b = run.battle!;
  const all = [...b.hand, ...b.draw];
  const take = (id: string) => all.splice(all.findIndex((c) => c.id === id), 1)[0];
  b.hand = [take('slash'), take('guard'), take('slash'), take('guard'), take('slash')];
  // 뽑을 더미는 뒤에서부터 뽑는다
  b.draw = [take('guard'), take('slash'), take('guard'), take('slash'), take('tigerClaw')];
  b.t.drawn = b.hand.length;
  const f = b.foes[0];
  f.hp = f.maxHp = 24;
  ctx.run = run;
  ctx.runId = null;
  tutorialNext = next;
  showRun();
}

function endTutorial(win: boolean | null) {
  markTutorial();
  const next = tutorialNext ?? (() => showTitle());
  tutorialNext = null;
  ctx.run = null;
  if (win === null) return next();
  const s = screen(`<div class="grow"></div>
    <div class="card big-panel center">
      <img class="result-hero${win ? '' : ' down'}" src="${heroImg('tiger')}" alt="" onerror="this.remove()">
      <h2 class="${win ? 'win' : 'lose'}">${win ? '연습 끝!' : '아쉬워요!'}</h2>
      <p>카드는 끌어 놓거나 두 번 눌러서 써요. 요괴 머리 위 의도를 보고 공격할지 막을지 정해요.</p>
      <p class="soft">체력은 전투가 끝나도 이어져요. 쉼터 · 물약으로 아껴 가며 3막 보스까지 올라가요.<br>연습 전투는 도감에서 다시 볼 수 있어요.</p>
      <button class="btn primary big" id="go">좋아요 ▶</button>
    </div>
    <div class="grow"></div>`);
  sfx(win ? 'win' : 'click');
  on(s, '#go', () => next());
}

function startPractice(foes: string[], kind: 'battle' | 'elite' | 'boss') {
  for (const f of foes) enemyDef(f);
  const run = newRun({ seed: DEV_SEED ?? Date.now() >>> 0, hero: DEV_HERO ?? 'tiger' });
  run.relics.push(...DEV_RELICS);
  enterTestBattle(run, foes, kind);
  ctx.run = run;
  ctx.runId = null;
  showRun();
}

// ---------- 영웅 고르기 ----------

/** 고를 수 있는 영웅: 고양이는 이 게임에서 시아코인으로 연 사람만 (테스트 모드는 모두) */
const canPickHero = (id: string) => {
  const h = heroDef(id);
  return h.ready && (!h.locked || LOCAL_MODE || !!ctx.owned?.includes(id));
};
/** 이 영웅의 연 숙련 단계 (0 = 기본) */
const masteryOpen = (hero: string) => (LOCAL_MODE ? MASTERY_OPEN : Math.min(MASTERY_OPEN, ctx.state?.heroes[hero]?.mastery ?? 0));

function showHeroes(mode: 'normal' | 'endless' = 'normal') {
  let pick = HEROES.find((h) => canPickHero(h.id))!.id;
  let lv = masteryOpen(pick);
  if (!LOCAL_MODE && !ctx.state) void ctx.ready.then(() => ctx.view === 'heroes' && draw());
  const draw = () => {
    const h = heroDef(pick);
    const c1 = cardDef(h.cards[0]);
    const c2 = cardDef(h.cards[1]);
    const ok = canPickHero(h.id);
    const open = masteryOpen(h.id);
    lv = Math.min(lv, open);
    const prog = ctx.state?.heroes[h.id];
    const clears = ctx.state?.clears ?? 0;
    const mastery =
      mode === 'normal' && ok
        ? `<div class="card mastery"><h3>숙련 단계 <small class="soft">${prog ? `클리어 ${prog.clears}번` : '한 판을 깨면 다음 단계가 열려요'}</small></h3>
          <div class="mastery-row">${[0, ...MASTERY.map((m) => m.lv)]
            .map((n) => {
              const cls = n === lv ? ' sel' : n > open ? ' off' : '';
              const label = n === 0 ? '기본' : n > MASTERY_OPEN ? `${n}` : n > open ? `🔒${n}` : `${n}`;
              return `<button class="m-lv${cls}" data-lv="${n}" ${n > open ? 'disabled' : ''} title="${n > MASTERY_OPEN ? '준비 중' : ''}">${label}</button>`;
            })
            .join('')}</div>
          <p class="soft">${lv === 0 ? '기본 규칙' : MASTERY.slice(0, lv).map((m) => `${m.lv} ${m.text}`).join(' · ')}${open < MASTERY_OPEN ? '' : ' · 6~10단계는 준비 중'}</p></div>`
        : '';
    const lockLine = h.locked && !ok ? `보통 판을 한 번 깨면 시아코인 100으로 열 수 있어요 · 지금 클리어 ${clears}번` : '';
    const s = screen(
      `
      <div class="bar"><button class="back" id="back">← 처음</button><h2>${mode === 'endless' ? '끝없는 모드 · 영웅' : '영웅 고르기'}</h2><span class="back-space"></span></div>
      <div class="hero-grid">
        ${HEROES.map(
          (x) => `<button class="hero-cell${x.id === pick ? ' sel' : ''}${canPickHero(x.id) ? '' : ' off'}" data-h="${x.id}">
            <img src="${heroFace(x.id)}" alt="" onerror="this.style.visibility='hidden'">
            <span>${esc(x.name)}</span>${x.locked && !canPickHero(x.id) ? '<i class="lock">🔒</i>' : !x.ready ? '<i class="soon">준비 중</i>' : ''}
          </button>`,
        ).join('')}
      </div>
      <div class="card hero-info">
        <div class="hero-top">${artImg(`cut-${h.id}`, `<img src="${heroImg(h.id)}" alt="">`, 'hero-cut')}
          <div><b>${esc(h.name)}</b> <span class="soft">${h.animal} · 체력 ${h.hp}</span><p class="passive"><em>패시브</em> ${esc(h.passive)}</p></div></div>
        <div class="hero-cards">
          <div class="hc"><small>전용 1 · 시작 덱</small>${cardHtml(c1.id)}</div>
          <div class="hc"><small>전용 2 · 보상에서만</small>${cardHtml(c2.id)}</div>
        </div>
        <p class="soft center">시작 덱: 베기 5 · 막기 4 · ${esc(c1.name)} 1${lockLine ? ` · ${esc(lockLine)}` : ''}</p>
      </div>
      ${mastery}
      ${mode === 'endless' ? '<p class="soft center light">3막 뒤에도 대나무숲 → 들판 → 궁궐 → 저승을 되풀이해요. 막마다 요괴 체력 · 피해 +15%</p>' : ''}
      ${
        ok
          ? '<button class="btn primary big" id="go">이 영웅으로 출발 ▶</button>'
          : h.locked
            ? `<button class="btn big" id="buy">🔒 시아코인 100으로 열기</button>`
            : '<button class="btn big" disabled>준비 중</button>'
      }
    `,
      '',
      'heroes',
    );
    on(s, '#back', () => showTitle());
    on(s, '[data-h]', (el) => {
      pick = el.dataset.h!;
      lv = masteryOpen(pick);
      draw();
    });
    on(s, '[data-lv]', (el) => {
      lv = Number(el.dataset.lv);
      draw();
    });
    on(s, '#buy', () => void buyCat(draw));
    on(s, '#go', () => void startRun(mode, pick, mode === 'normal' ? lv : 0));
  };
  draw();
}

/** 고양이 열기 (shared/characters.js buyCharacter → 071 buy_character, 조건은 _cat_progress_card) */
async function buyCat(redraw: () => void) {
  try {
    const m = await loadCharacters();
    const r = await m.buyCharacter('card', 'cat');
    toast(m.buyMessage(r, 'cat'), 2600);
    if (r?.ok || r?.reason === 'owned') {
      await refreshOwned(true);
      sfx('win');
    }
  } catch {
    toast('열지 못했어요. 잠시 후 다시 시도해 주세요');
  }
  redraw();
}

/** 새 판 시작: 서버가 판 번호·씨앗을 정한다 (오늘의 도전 씨앗은 날짜로). 테스트 모드는 기기에서만 */
let starting = false;
async function startRun(mode: RunMode, hero: string, mastery: number, daily?: { day: string; seed: number }) {
  if (starting) return;
  starting = true;
  try {
    let runId: string | null = null;
    let started: ServerRun | null = null;
    let seed: number;
    // 시작 엽전: 서버가 정한 값 (관리자 시험 판 1만, 보통·끝없는 모드만 — card_start). 없으면 기본
    let gold: number | null = null;
    if (LOCAL_MODE) {
      seed = daily?.seed ?? DEV_SEED ?? Math.floor(Math.random() * 2 ** 32) >>> 0;
    } else {
      await ctx.ready;
      if (!ctx.api) return toast('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요');
      try {
        const r = await ctx.api.start(mode, hero, mastery, daily?.day ?? null, daily?.seed ?? null);
        started = r;
        runId = r.runId;
        seed = r.seed;
        gold = r.startGold ?? null;
        if (r.startGold != null) toast(`관리자 시험 판: 엽전 ${r.startGold.toLocaleString()} 으로 시작해요`, 2400);
        if (r.paidCoins) toast(`지난 판에서 못 받은 시아코인 +${r.paidCoins}`, 2400);
      } catch (e) {
        if (e instanceof ApiError && e.message === 'bad day') void refreshState();
        return toast(friendly(e), 2600);
      }
    }
    clearRun(mode);
    ctx.run = newRun({ seed, hero, mode, mastery, gold });
    ctx.runId = runId;
    ctx.lastResult = null;
    if (LOCAL_MODE && mode !== 'daily') {
      for (const r of DEV_RELICS) if (relicDef(r)) ctx.run.relics.push(r);
      if (DEV_GOLD !== null) ctx.run.gold = DEV_GOLD;
      if (DEV_ELITES !== null) ctx.run.stats.elites = DEV_ELITES;
      if (DEV_ACT !== null && DEV_ACT > 1) {
        // 그 막의 처음부터 (막 보스까지 가려면 &act=3&elites=3 → 3막 → 숨은 4막)
        ctx.run.act = DEV_ACT;
        ctx.run.map = genMap(ctx.run.seed, DEV_ACT, 0, mode);
      }
    }
    if (ctx.state && started) {
      // 처음 화면의 '이어하기'가 버린 판 대신 이 판을 가리키게 (기록 없는 서버 판 → 같은 판 번호의 기기 저장이 이긴다).
      // 비워 두면 '← 처음' 에서 기기 저장이 '서버에서 버린 판' 으로 보여 지워졌다
      ctx.state.runs[mode] = startedRun(started);
      if (mode === 'daily') ctx.state.dailyPlayed = true;
    }
    saveRun();
    showRun();
  } finally {
    starting = false;
  }
}

// ---------- 판 화면 고르기 ----------

function showRun() {
  const run = ctx.run!;
  switch (run.phase) {
    case 'map':
      return showMap();
    case 'battle':
      return showBattle();
    case 'reward':
      return showReward();
    case 'shop':
      return showShop();
    case 'rest':
      return showRest();
    case 'treasure':
      return showTreasure();
    case 'event':
      return showEvent();
    default:
      return showResult();
  }
}

/** 위 줄: 체력·엽전·물약·부적·덱 */
function runBar(title: string) {
  const run = ctx.run!;
  return `<div class="bar"><button class="back" id="home">← 처음</button><h2>${title}</h2><button class="icon-btn" id="deck" title="덱">🂠</button></div>
    <div class="run-pills">
      <span class="pill hp">❤ ${run.hp}/${run.maxHp}</span>
      <span class="pill gold">엽전 <b>${run.gold}</b></span>
      <span class="pill">덱 ${run.deck.length}</span>
      ${[0, 1, 2].map((i) => `<button class="pot${run.potions[i] ? '' : ' empty'}" data-pot="${i}">${run.potions[i] ? potionIcon(run.potions[i], 'pot-ic') : ''}</button>`).join('')}
    </div>
    ${run.relics.length ? `<div class="relic-row">${run.relics.map((id) => `<button class="relic-btn" data-relic="${id}">${relicIcon(id)}</button>`).join('')}</div>` : ''}`;
}

function bindBar(s: HTMLElement, redraw: () => void) {
  const run = ctx.run!;
  on(s, '#home', () => showTitle());
  on(s, '#deck', () => showDeck('내 덱', run.deck));
  on(s, '[data-relic]', (el) => {
    const r = relicDef(el.dataset.relic!);
    toast(`${r.name}: ${r.text}`, 2400);
  });
  on(s, '[data-pot]', (el) => {
    const i = Number(el.dataset.pot);
    const id = run.potions[i];
    if (!id) return;
    const p = potionDef(id);
    modal(`<h3>${p.name}</h3><p>${p.text}</p><p class="soft">물약은 전투 중에 써요.</p>
      <div class="row2"><button class="btn" data-close>닫기</button><button class="btn" id="drop">버리기</button></div>`, (m, close) => {
      on(m, '#drop', () => {
        send({ t: 'dropPotion', slot: i });
        close();
        redraw();
      });
    });
  });
}

function modal(html: string, bind?: (m: HTMLElement, close: () => void) => void) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card modal-box">${html}</div>`;
  document.getElementById('stage')!.appendChild(m);
  requestAnimationFrame(() => shrinkOverflow(m));
  const close = () => m.remove();
  m.addEventListener('click', (e) => {
    if (e.target === m) close();
  });
  m.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  bind?.(m, close);
  return close;
}

function showDeck(title: string, cards: DeckCard[]) {
  const sorted = [...cards].sort((a, b) => cardDef(a.id).kind.localeCompare(cardDef(b.id).kind) || a.id.localeCompare(b.id));
  modal(`<h3>${title} · ${cards.length}장</h3><div class="card-grid">${sorted.map((c) => cardHtml(c.id, c.up)).join('')}</div><button class="btn" data-close>닫기</button>`);
}

/** 덱에서 카드 고르기 (강화·없애기·복사) */
function pickCards(title: string, cards: DeckCard[], n: number, preview: 'up' | 'none', done: (uids: number[]) => void, cancel?: () => void) {
  const chosen: number[] = [];
  const close = modal(
    `<h3>${title}</h3><p class="soft center">${n > 1 ? `${n}장 고르세요` : '한 장 고르세요'}</p>
    <div class="card-grid">${cards.map((c) => `<div class="pick" data-uid="${c.uid}">${cardHtml(c.id, preview === 'up' ? true : c.up)}</div>`).join('')}</div>
    <div class="row2">${cancel ? '<button class="btn" id="cancel">그만두기</button>' : '<span></span>'}<button class="btn primary" id="ok" disabled>확인</button></div>`,
    (m, close) => {
      on(m, '[data-uid]', (el) => {
        const u = Number(el.dataset.uid);
        const k = chosen.indexOf(u);
        if (k >= 0) chosen.splice(k, 1);
        else {
          if (chosen.length >= n) chosen.shift();
          chosen.push(u);
        }
        m.querySelectorAll<HTMLElement>('[data-uid]').forEach((x) => x.classList.toggle('sel', chosen.includes(Number(x.dataset.uid))));
        (m.querySelector('#ok') as HTMLButtonElement).disabled = chosen.length !== n;
      });
      on(m, '#ok', () => {
        close();
        done([...chosen]);
      });
      on(m, '#cancel', () => {
        close();
        cancel?.();
      });
    },
  );
  return close;
}

// ---------- 지도 ----------

const NODE_ICON: Record<NodeType, string> = { battle: '⚔️', elite: '👹', shop: '🏮', rest: '🔥', treasure: '🎁', event: '❓', boss: '' };
/** 지도 칸 그림 (새 그림 map-nodes 시트의 그 칸 · 못 읽었으면 글자 그림) */
function nodeIcon(t: NodeType, cls = 'node-ic'): string {
  if (!artState.nodes || !(t in MAP_NODE_FRAME)) return NODE_ICON[t];
  return `<span class="${cls}" style="background-image:url('${artUrl('map-nodes')}');background-position:${MAP_NODE_FRAME[t] * 20}% 0"></span>`;
}
const NODE_NAME: Record<NodeType, string> = { battle: '전투', elite: '정예', shop: '상점', rest: '쉼터', treasure: '보물', event: '이야기', boss: '보스' };
const ROW_H = 76;

function showMap() {
  const run = ctx.run!;
  const m = run.map;
  if (regionDef(m.region).hidden) return showAbyss();
  if (run.row < 0 && run.act > 1) toast(`${run.act}막 · ${regionDef(m.region).name}`, 2200);
  const reg = regionDef(m.region);
  const can = new Set(choices(run));
  const total = m.rows.length;
  const height = total * ROW_H + 40;
  const yOf = (row: number) => height - 50 - row * ROW_H;
  const xOf = (x: number) => 12 + x * 76; // %
  const lines: string[] = [];
  m.rows.forEach((row, y) =>
    row.forEach((n) =>
      n.next.forEach((j) => {
        const to = m.rows[y + 1][j];
        const walked = run.path[y] === n.col && run.path[y + 1] === j;
        lines.push(`<line x1="${xOf(n.x)}" y1="${yOf(y)}" x2="${xOf(to.x)}" y2="${yOf(y + 1)}" class="${walked ? 'walked' : ''}"/>`);
      }),
    ),
  );
  const nodes = m.rows
    .map((row, y) =>
      row
        .map((n) => {
          const here = y === run.row && n.col === run.col;
          const passed = run.path[y] === n.col && y <= run.row;
          const next = y === run.row + 1 && can.has(n.col);
          const cls = ['node', `t-${n.type}`, here ? 'here' : '', passed ? 'passed' : '', next ? 'next' : '', y <= run.row && !passed ? 'gone' : ''].join(' ');
          if (n.type === 'boss')
            return `<button class="${cls} boss-node" style="left:${xOf(n.x)}%;top:${yOf(y)}px" data-col="${n.col}" data-row="${y}">${artImg(enemyDef(m.boss).art, '👺', 'boss-face')}<b>${esc(enemyDef(m.boss).name)}</b></button>`;
          return `<button class="${cls}" style="left:${xOf(n.x)}%;top:${yOf(y)}px" data-col="${n.col}" data-row="${y}" title="${NODE_NAME[n.type]}">${nodeIcon(n.type)}</button>`;
        })
        .join(''),
    )
    .join('');
  const s = screen(
    `${runBar(`${run.mode === 'endless' ? '∞ ' : run.mode === 'daily' ? '오늘 · ' : ''}${run.act}막 · ${esc(reg.name)}`)}
    <div class="map-wrap"><div class="map t-${reg.id}" style="height:${height}px${hasArt(reg.tile) ? `;--tile:url('${artUrl(reg.tile)}')` : ''}">
      <svg class="map-lines" viewBox="0 0 100 ${height}" preserveAspectRatio="none" style="height:${height}px">${lines.join('')}</svg>
      ${nodes}
    </div></div>
    <p class="map-legend">${(['battle', 'elite', 'shop', 'rest', 'treasure', 'event'] as NodeType[]).map((t) => `<span>${nodeIcon(t, 'node-ic small')} ${NODE_NAME[t]}</span>`).join('')}</p>`,
    'map-screen',
  );
  bindBar(s, showMap);
  on(s, '.node.next', (el) => {
    const r = send({ t: 'go', col: Number(el.dataset.col) });
    if (r?.ok) showRun();
  });
  on(s, '.node:not(.next)', (el) => {
    const row = Number(el.dataset.row);
    const n = m.rows[row][Number(el.dataset.col)];
    toast(n.type === 'boss' ? `막 보스: ${enemyDef(m.boss).name}` : NODE_NAME[n.type]);
  });
  // 지금 줄이 보이게
  const wrap = s.querySelector<HTMLElement>('.map-wrap')!;
  requestAnimationFrame(() => {
    wrap.scrollTop = Math.max(0, yOf(run.row + 1) - wrap.clientHeight * 0.6);
  });
}

/** 숨은 4막: 지도 대신 어둑시니 앞 (보스 한 칸) */
function showAbyss() {
  const run = ctx.run!;
  const s = screen(
    `${runBar('숨은 4막 · 어둠의 끝')}
    <div class="card scene-card">${artImg('ending-4', '', 'scene-art')}
      <p class="scene-say">정예 ${run.stats.elites}마리를 물리친 기운에 봉인이 흔들렸다! 땅이 갈라지고, 모든 어둠의 뿌리 <b>어둑시니</b>가 깨어났다.</p></div>
    <div class="card center abyss-boss">${artImg('b-final', '👺', 'boss-face big')}<p><b>어둑시니</b> · 체력 450</p>
      <p class="soft">내가 공격카드를 쓸 때마다 힘이 세지고, 체력이 줄면 점점 커져요. 보스와 한 번만 싸워요.</p></div>
    <div class="grow"></div>
    <button class="btn primary big" id="fight">맞서 싸우기 ▶</button>`,
    'abyss-screen',
  );
  bindBar(s, showAbyss);
  on(s, '#fight', () => {
    const r = send({ t: 'go', col: 0 });
    if (r?.ok) showRun();
  });
}

// ---------- 전투 ----------

function showBattle() {
  app().innerHTML = '';
  stopGame();
  gameEl().classList.remove('hidden');
  const hooks: BattleHooks = {
    run: () => ctx.run!,
    send: (i) => send(i),
    done: () => {
      if (tutorialNext) return endTutorial(ctx.run?.phase === 'won');
      if (ctx.run?.practice) return showResult();
      showRun();
    },
    heroUrl: ctx.run ? heroImg(ctx.run.hero) : null,
    sfx,
    ...(tutorialNext ? { tutorial: { skip: () => endTutorial(null) } } : { seen: seenTips }),
  };
  ctx.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameEl(),
    width: W,
    height: H,
    backgroundColor: '#9fd6ff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
    banner: false,
    input: { activePointers: 2 },
  });
  ctx.game.scene.add('battle', BattleScene, true, { hooks });
  if (LOCAL_MODE) {
    const w = window as unknown as { __cardGame?: Phaser.Game; __cardRun?: () => RunState | null; __cardFit?: () => string[] };
    w.__cardGame = ctx.game;
    // 카드 설명이 칸을 넘치는 카드 목록 (비어 있으면 통과)
    w.__cardFit = () => (ctx.game?.scene.getScene('battle') as BattleScene | null)?.fitReport() ?? ['전투 화면이 아님'];
    w.__cardRun = () => ctx.run;
  }
}

// ---------- 보상 ----------

function showReward() {
  const run = ctx.run!;
  const rw = run.reward!;
  const rows = rw.items
    .map((it, i) => {
      if (it.taken) return '';
      switch (it.k) {
        case 'gold':
          return `<button class="item btn-item" data-take="${i}"><span class="coin-dot has-art">${artImg('ic-coin', '엽')}</span><span class="item-main"><b>엽전 ${it.n}</b></span></button>`;
        case 'card':
          return `<button class="item btn-item" data-card="${i}"><span class="relic-dot card-dot has-art">${artImg('back', '🂠')}</span><span class="item-main"><b>${rw.boss ? '전설 카드' : '카드'} 고르기</b><small>${it.options.length}장 중 1장</small></span></button>`;
        case 'relic':
          return `<button class="btn-item" data-take="${i}">${relicHtml(it.id)}</button>`;
        case 'potion':
          return `<button class="btn-item" data-take="${i}">${potionHtml(it.id)}</button>`;
        case 'bossRelic':
          return `<button class="item btn-item" data-boss="${i}"><span class="relic-dot has-art">${artImg('ic-star', '✦')}</span><span class="item-main"><b>보스 부적 고르기</b><small>${it.options.length}개 중 1개</small></span></button>`;
      }
    })
    .join('');
  // 넘어가면 남은 보상을 받는다 (카드·보스 부적은 무작위 1개, 물약은 자리가 있으면 — run.ts autoTake)
  const choiceLeft = rw.items.some((it) => !it.taken && (it.k === 'card' || it.k === 'bossRelic'));
  const anyLeft = rw.items.some((it) => !it.taken && (it.k !== 'potion' || run.potions.length < MAX_POTIONS));
  const s = screen(`${runBar(rw.boss ? '막 보스 승리!' : '승리!')}
    ${rw.boss ? `<div class="card center"><b>체력을 절반 회복했어요</b></div>` : ''}
    <div class="card"><h3>보상</h3><div class="btns">${rows || '<p class="soft center">다 받았어요</p>'}</div></div>
    <div class="grow"></div>
    ${anyLeft ? `<p class="soft center" id="autoHint">${choiceLeft ? '안 고르면 무작위로 받아요' : '넘어가면 남은 보상을 받아요'}</p>` : ''}
    <button class="btn primary big" id="leave">${rw.boss ? (run.act >= 3 && run.mode !== 'endless' ? (finalOpen(run) ? '봉인이 흔들린다… ▶' : '엔딩 보기 ▶') : `${run.act + 1}막으로 ▶`) : '지도로 ▶'}</button>`);
  bindBar(s, showReward);
  on(s, '[data-take]', (el) => {
    const r = send({ t: 'take', i: Number(el.dataset.take) });
    if (!r?.ok) toast('물약은 3개까지예요. 위에서 하나 버리고 받으세요');
    else sfx('coin');
    showReward();
  });
  on(s, '[data-card]', (el) => {
    const i = Number(el.dataset.card);
    const it = rw.items[i];
    if (it.k !== 'card') return;
    modal(
      `<h3>카드 한 장 고르기</h3><div class="card-grid choose">${it.options.map((c, k) => `<div class="pick" data-pick="${k}">${cardHtml(c.id, c.up)}</div>`).join('')}</div>
      <button class="btn" data-close>나중에 (안 고르면 무작위로 받아요)</button>`,
      (m, close) =>
        on(m, '[data-pick]', (p) => {
          send({ t: 'take', i, pick: Number(p.dataset.pick) });
          close();
          showReward();
        }),
    );
  });
  on(s, '[data-boss]', (el) => {
    const i = Number(el.dataset.boss);
    const it = rw.items[i];
    if (it.k !== 'bossRelic') return;
    modal(
      `<h3>보스 부적 한 개</h3><div class="btns">${it.options.map((id, k) => `<button class="btn-item" data-pick="${k}">${relicHtml(id)}</button>`).join('')}</div><button class="btn" data-close>나중에</button>`,
      (m, close) =>
        on(m, '[data-pick]', (p) => {
          send({ t: 'take', i, pick: Number(p.dataset.pick) });
          close();
          showReward();
        }),
    );
  });
  on(s, '#leave', () => {
    // 남은 보상은 규칙 쪽(leave)이 받는다 — 무엇을 받았는지 알림
    const before = { deck: run.deck.length, relics: run.relics.length, potions: run.potions.length };
    const r = send({ t: 'leave' });
    const got: string[] = [];
    const after = ctx.run!;
    if (r?.ok) {
      for (const c of after.deck.slice(before.deck)) got.push(cardDef(c.id).name);
      for (const id of after.relics.slice(before.relics)) got.push(relicDef(id).name);
      for (const id of after.potions.slice(before.potions)) got.push(potionDef(id).name);
      if (got.length) toast(`받았어요: ${got.join(' · ')}`);
      if (anyLeft) sfx('coin');
    }
    showRun();
  });
}

// ---------- 상점 ----------

function showShop() {
  const run = ctx.run!;
  const sh = run.shop!;
  const price = (p: number, sold?: boolean) => (sold ? '<em class="sold">팔림</em>' : `<b class="price${run.gold < p ? ' short' : ''}">${p}</b>`);
  const s = screen(`${runBar('상점')}
    <div class="card scene-card">${artImg('shop', '<span class="keeper-face">🏮</span>', 'scene-art')}<p class="scene-say">어서 오시오! 좋은 물건 많소.</p></div>
    <div class="card"><h3>카드</h3><div class="shop-cards">
      ${sh.cards.map((c, i) => `<button class="shop-card${c.sold ? ' sold' : ''}" data-buy="card" data-i="${i}" ${c.sold ? 'disabled' : ''}>${cardHtml(c.id, c.up)}${price(c.price, c.sold)}</button>`).join('')}
    </div></div>
    <div class="card"><h3>부적 · 물약</h3><div class="btns">
      ${sh.relics.map((r, i) => `<button class="btn-item shop-row" data-buy="relic" data-i="${i}" ${r.sold ? 'disabled' : ''}>${relicHtml(r.id)}${price(r.price, r.sold)}</button>`).join('')}
      ${sh.potions.map((p, i) => `<button class="btn-item shop-row" data-buy="potion" data-i="${i}" ${p.sold ? 'disabled' : ''}>${potionHtml(p.id)}${price(p.price, p.sold)}</button>`).join('')}
      <button class="item btn-item shop-row" id="remove" ${sh.removed || run.deck.length <= MIN_DECK ? 'disabled' : ''}><span class="relic-dot">✂</span><span class="item-main"><b>카드 없애기</b><small>덱에서 한 장 (덱 최소 ${MIN_DECK}장)</small></span>${price(removePrice(run), sh.removed)}</button>
    </div></div>
    <button class="btn primary big" id="leave">지도로 ▶</button>`);
  bindBar(s, showShop);
  on(s, '[data-buy]', (el) => {
    const kind = el.dataset.buy as 'card' | 'relic' | 'potion';
    const r = send({ t: 'buy', kind, i: Number(el.dataset.i) });
    if (r?.ok) sfx('coin');
    else toast(kind === 'potion' && run.potions.length >= 3 ? '물약은 3개까지예요' : '엽전이 모자라요');
    showShop();
  });
  on(s, '#remove', () => {
    if (run.gold < removePrice(run)) return toast('엽전이 모자라요');
    pickCards('없앨 카드', run.deck, 1, 'none', ([uid]) => {
      send({ t: 'remove', uid });
      showShop();
    }, () => null);
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 쉼터 ----------

function showRest() {
  const run = ctx.run!;
  const rs = run.rest!;
  const healN = restHeal(run);
  const can = upgradable(run);
  const s = screen(`${runBar('쉼터')}
    <div class="card scene-card">${artImg('forge', '<span class="fire">🔥</span>', 'scene-art')}
      <p class="scene-say">모닥불 앞에서 잠시 쉬어 가요. 쉬거나, 대장간에서 카드를 강화해요.</p></div>
    ${
      rs.done
        ? '<div class="card center"><b>푹 쉬었어요!</b></div>'
        : `<div class="btns">
      <button class="btn big" id="heal" ${healN > 0 ? '' : 'disabled'}>쉬기 <small>체력 +${Math.min(healN, run.maxHp - run.hp)}${healN === 0 ? ' (여의주 조각: 회복 불가)' : ''}</small></button>
      <button class="btn big" id="up" ${can.length ? '' : 'disabled'}>카드 강화 <small>${restUpgrades(run)}장</small></button>
    </div>`
    }
    <div class="grow"></div>
    <button class="btn primary big" id="leave">지도로 ▶</button>`);
  bindBar(s, showRest);
  on(s, '#heal', () => {
    send({ t: 'heal' });
    sfx('win');
    showRest();
  });
  on(s, '#up', () => {
    const n = Math.min(restUpgrades(run), can.length);
    pickCards('강화할 카드 (강화 후 모습)', can, n, 'up', (uids) => {
      send({ t: 'upgrade', uids });
      showRest();
    }, () => null);
  });
  on(s, '#leave', () => {
    if (!rs.done && !confirm('쉬지 않고 떠날까요?')) return;
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 보물 ----------

function showTreasure() {
  const run = ctx.run!;
  const t = run.treasure!;
  const s = screen(`${runBar('보물')}
    <div class="card center treasure"><span class="chest${t.opened ? ' open' : ''}">${t.opened ? artImg('fx-pop', '✨', 'chest-art') : artImg('chest', '🎁', 'chest-art')}</span>
    ${t.opened ? (t.relic ? relicHtml(t.relic) : '<p>엽전 50이 들어 있었어요</p>') : '<p>낡은 상자가 있어요</p>'}</div>
    <div class="grow"></div>
    ${t.opened ? '<button class="btn primary big" id="leave">지도로 ▶</button>' : '<button class="btn primary big" id="open">상자 열기 ▶</button>'}`);
  bindBar(s, showTreasure);
  on(s, '#open', () => {
    send({ t: 'open' });
    sfx('coin');
    showTreasure();
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 이야기 ----------

function showEvent() {
  const run = ctx.run!;
  const e = run.event!;
  const def = eventDef(e.id);
  const s = screen(`${runBar(esc(def.name))}
    <div class="card scene-card">${artImg(def.art, '', 'scene-art')}<img class="scene-hero" src="${heroImg(run.hero)}" alt="" onerror="this.remove()"><p class="scene-say">${esc(def.text)}</p></div>
    ${
      e.chosen < 0
        ? `<div class="btns">${def.choices
            .map((c, i) => `<button class="btn choice" data-ch="${i}" ${canChoose(run, c.ops, c.needGold) ? '' : 'disabled'}>${esc(c.label)}</button>`)
            .join('')}</div>`
        : `<div class="card center"><p>${esc(e.text ?? '그렇게 했다.')}</p>${e.gotRelic ? relicHtml(e.gotRelic) : ''}${e.gotCard ? cardHtml(e.gotCard) : ''}</div>
           <div class="grow"></div><button class="btn primary big" id="leave">지도로 ▶</button>`
    }`);
  bindBar(s, showEvent);
  on(s, '[data-ch]', (el) => {
    const r = send({ t: 'choose', i: Number(el.dataset.ch) });
    if (!r?.ok) return;
    if (ctx.run!.phase !== 'event') return showRun();
    needCards();
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
  if (e.chosen >= 0 && e.need) needCards();
}

function needCards() {
  const run = ctx.run!;
  const need = run.event?.need;
  if (!need) return showEvent();
  const list = need.kind === 'upgrade' ? run.deck.filter((c) => canUpgrade(c.id, c.up)) : run.deck;
  const title = need.kind === 'upgrade' ? '강화할 카드' : need.kind === 'remove' ? '없앨 카드' : '복사할 카드';
  pickCards(title, list, 1, need.kind === 'upgrade' ? 'up' : 'none', ([uid]) => {
    send({ t: 'pickCard', uid });
    if (ctx.run!.event?.need) needCards();
    else showEvent();
  });
}

// ---------- 결과 ----------

/** 엔딩 장면 (그림 + 말) — 누르면 다음 장면, 마지막 장면 뒤에 결과 */
const ENDINGS: Record<'normal' | 'true', { art: string; title: string; text: string }[]> = {
  normal: [
    { art: 'ending-2', title: '3막 클리어!', text: '염라대왕까지 물리치고 십이지 친구들이 들판으로 돌아왔어요. 요괴들의 소란이 멎었어요.' },
    { art: 'ending-3', title: '그런데…', text: '봉인의 틈으로 아직 검은 연기가 새어 나와요. 더 많은 정예를 물리치면 숨은 무언가를 만날지도 몰라요.' },
  ],
  true: [
    { art: 'finale-1', title: '어둑시니를 물리쳤다!', text: '모든 어둠의 뿌리, 어둑시니가 빛 속으로 흩어졌어요.' },
    { art: 'finale-2', title: '다시 봉인!', text: '흔들리던 봉인에 마지막 열쇠가 채워지고, 문이 단단히 잠겼어요.' },
    { art: 'finale-4', title: '진짜 엔딩', text: '십이지 영웅들이 세상을 지켰어요. 오늘은 모두 함께 잔치예요!' },
  ],
};

function showResult(step = 0) {
  const run = ctx.run!;
  const win = run.phase === 'won';
  if (!run.practice) clearRun(run.mode);
  const st = run.stats;
  const scenes = win && !run.practice && run.ending ? ENDINGS[run.ending] : [];
  if (step < scenes.length) {
    const sc = scenes[step];
    const last = step === scenes.length - 1;
    const s = screen(`<div class="grow"></div>
      <div class="card big-panel center ending ${run.ending === 'true' ? 'true-end' : ''}">
        ${artImg(sc.art, '', 'result-scene')}
        <h2 class="win">${sc.title}</h2>
        <p>${sc.text}</p>
        <p class="dots">${scenes.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</p>
        <button class="btn primary big" id="next">${last ? '결과 보기 ▶' : '다음 ▶'}</button>
      </div>
      <div class="grow"></div>`);
    if (step === 0) sfx('win');
    on(s, '#next', () => showResult(step + 1));
    return;
  }
  const title = run.practice ? (win ? '승리!' : '쓰러졌어요…') : win ? (run.ending === 'true' ? '진짜 엔딩!' : '3막 클리어!') : '쓰러졌어요…';
  const where = run.act === 4 && run.mode !== 'endless' ? '숨은 4막 어둑시니' : `${run.act}막 ${regionDef(run.map.region).name}`;
  const hint =
    run.mode === 'endless'
      ? `끝없는 모드 · ${st.bosses}막 돌파 · ${st.floors}칸 올라감`
      : run.mode === 'daily'
        ? `오늘의 도전 점수 <b>${runScore(run).toLocaleString()}</b> (칸×10 + 정예×30 + 보스×100 + 남은 체력)`
        : win && run.ending === 'normal'
          ? `정예를 ${FINAL_ELITES}마리 이상 물리치고 3막을 깨면 숨은 4막이 열려요 (이번 판 정예 ${st.elites})`
          : win
            ? '숨은 최종보스까지 물리쳤어요!'
            : '처음부터 다시 도전해요';
  const s = screen(`<div class="grow"></div>
    <div class="card big-panel center">
      ${!win && !run.practice && run.act === 4 ? artImg('finale-1', '', 'result-scene') : ''}
      <img class="result-hero${win ? '' : ' down'}" src="${heroImg(run.hero)}" alt="" onerror="this.remove()">
      <h2 class="${win ? 'win' : 'lose'}">${title}</h2>
      ${run.practice ? `<p>남은 체력 ${run.hp} / ${run.maxHp}</p>` : `<p>${where} · ${st.floors}칸 · 정예 ${st.elites} · 보스 ${st.bosses}</p><p class="soft">${hint}</p>`}
      ${!run.practice && ctx.runId ? '<p class="srv soft">기록을 보내는 중…</p>' : ''}
      <button class="btn primary big" id="again">처음 화면 ▶</button>
    </div>
    <div class="grow"></div>`);
  on(s, '#again', () => {
    ctx.run = null;
    ctx.runId = null;
    showTitle();
  });
  if (!run.practice && ctx.runId && ctx.lastResult) {
    const mastery = run.mastery;
    void ctx.lastResult.then((r) => {
      const el = s.querySelector<HTMLElement>('.srv');
      if (el?.isConnected) el.innerHTML = serverLine(r, mastery);
    });
  } else s.querySelector('.srv')?.remove();
}

/** 결과 화면의 서버 기록 한 줄 */
function serverLine(r: FinishResult | null, mastery: number): string {
  if (!r) return '기록을 아직 보내지 못했어요. 다음에 들어올 때 다시 보내요';
  const out: string[] = [];
  if (r.mode !== 'daily') out.push(`시아코인 ${r.coins}개 받음`);
  if (r.cleared && r.mastery > mastery) out.push(`숙련 ${r.mastery}단계가 열렸어요!`);
  if (r.endless) out.push(r.endless.improved ? `최고 기록 ${r.endless.best}칸!` : `최고 기록 ${r.endless.best}칸`);
  if (r.daily) out.push(r.daily.recorded ? `오늘의 도전 ${r.daily.score.toLocaleString()}점 기록` : '오늘 첫 판이 아니라 순위에는 들어가지 않아요');
  return out.map(esc).join(' · ');
}
