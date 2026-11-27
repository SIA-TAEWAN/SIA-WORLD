// 시아에이스: 타이틀 → 기체·난이도 고르기 → 스테이지 → 정산 → (다음 스테이지 | 타이틀).
// 모드 4개: 아케이드(1~12 · 이어하기 1회) · 스테이지 연습 · 보스 러시 · 끝없는 모드.
// SIA WORLD 연동 (121_ace.sql): 통합 로그인 · 진행(해금)과 최고 기록은 서버 · 판마다 시아코인 +1 · 고양이호는 시아코인 100개 · 랭킹은 공용 랭킹 창.
// 개발용: ?local=1 (로그인 없이 이 기기에만), &all=1 (모두 열림), ?stage=n, ?at=초, ?power=4, ?fps=1, ?stress=1, ?canvas=1, ?proto=1
// 시험 페이지(아티팩트)는 window.ACE_ALL = true: 로그인 없이 이 기기에만, 모두 열림.
import './style.css';
import './menu.css';
import Phaser from 'phaser';
import { BONUS, DIFFICULTY, H, W, type Difficulty, type Sim, type SimEvent } from './game/sim';
import { PROTO, type StageDef } from './data/waves';
import { ENDLESS_STAGE, RUSH_STAGE, STAGES } from './data/stages';
import { SHIPS, SHIP_ORDER, type ShipId } from './data/ships';
import { RUSH } from './data/bosses';
import { LAST_STAGE, MODES, loadProgress, recordClear, saveProgress, shipOpen } from './game/progress';
import { StageScene, shared, type HudState } from './scenes/StageScene';
import { ApiError, LIMITS, getApi, type AceApi, type ServerMode } from './net/api';
import { LOCAL_MODE } from './net/local';
import { enterLobby, loadAuth, loadCharacters, loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from './net/world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const TEST_PAGE = (window as unknown as { ACE_ALL?: boolean }).ACE_ALL === true;
const OFFLINE = LOCAL_MODE || TEST_PAGE;
let ALL = TEST_PAGE || (LOCAL_MODE && params.get('all') === '1');
const PROTO_MODE = params.get('proto') === '1';
const progress = loadProgress();
let api: AceApi;
let me: WorldUser | null = null;
let siaCoins = 0;

type Mode = 'arcade' | 'practice' | 'rush' | 'endless';
/** 이번 판. rankScore = 랭킹에 올릴 점수 (아케이드 이어하기 전 점수). id = 서버 판 번호 (연습은 없음) */
const run = { mode: 'arcade' as Mode, stage: 1, rankScore: 0, continued: false, id: '' as string, kills: 0, frames: 0 };

const LOCK = '<svg class="lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
const face = (id: string) => shared(`images/zodiac/face/${id}.png`);
const full = (id: string) => shared(`images/zodiac/full/${id}.png`);
const shipArt = (id: string) => new URL(`art/ship-${id}.png`, location.href).href;
const floorArt = (f: string) => new URL(`art/${f}.png`, location.href).href;
const REASON: Record<string, string> = {
  'locked mode': '아직 열리지 않은 모드예요', 'locked ship': '아직 열리지 않은 기체예요', 'locked character': '고양이호는 시아코인으로 먼저 열어야 해요',
  'bad ship': '탈 수 없는 기체예요', 'bad stage': '그 스테이지는 할 수 없어요', 'too fast': '기록이 너무 빨라서 받지 않았어요',
  'bad score': '기록이 이상해서 받지 않았어요', 'bad run': '이 판은 이미 끝났어요', 'need login': '로그인이 필요해요',
};
const reasonText = (e: unknown) => (e instanceof ApiError ? REASON[e.message] ?? e.message : '서버에 연결하지 못했어요');

const app = $('app');
app.innerHTML = `
  <div class="hud hidden" id="hud">
    <div class="hud-top">
      <button class="btn iconbtn" id="pauseBtn" type="button" aria-label="멈춤">II</button>
      <span class="chip" id="stageChip"></span>
      <span class="chip wind hidden" id="windChip"></span>
      <span class="sp"></span>
      <span class="chip score" id="score">0</span>
    </div>
    <div class="panel bossbar hidden" id="bossbar">
      <div class="nm"><span id="bossName"></span><em id="bossTime"></em></div>
      <div class="gauge"><i id="bossHp"></i></div>
      <div class="ph" id="bossPh"></div>
    </div>
    <div class="cutin hidden" id="cutin"></div>
    <div class="hud-bot">
      <span class="chip"><img id="lifeFace" alt="">×<b id="lives">3</b></span>
      <span class="chip"><i class="mini p">P</i><b id="power">1</b></span>
      <span class="chip coin" id="coinChip"><i class="mini c"></i>×<b id="coin">0</b><small id="coinNext"></small></span>
      <span class="chip fps hidden" id="fps"></span>
    </div>
    <button class="bombbtn" id="bombBtn" type="button" aria-label="폭탄">💣<em id="bombs">2</em></button>
  </div>
  <div class="weather hidden" id="weather"></div>
  <div class="menu" id="menu"><div class="loading">불러오는 중…</div></div>
  <div class="overlay hidden" id="overlay"><div class="panel pop" id="pop"></div></div>
  <div class="toast" id="toast"></div>`;

const intro = `<div class="intro">
  <div><span class="key">끌기</span>화면 어디든 드래그해서 움직여요 · 사격은 자동</div>
  <div><span class="key">꾹</span>손가락을 대고 있으면 아래 게이지가 차요. 1칸 이상에서 떼면 차지샷</div>
  <div><span class="key">💣</span>오른쪽 아래 버튼 · 적 탄을 모두 지우고 잠깐 무적</div>
  <div><span class="key">🪙</span>금화를 놓치지 않고 이어 먹으면 100 → 2,000점</div>
  <div><span class="key">PC</span>방향키·WASD 이동 · Shift 눌렀다 떼기 차지 · Space 폭탄 · Esc 멈춤</div>
</div>`;

let scene: StageScene;
let inGame = false;

// ---------------- 소리 (공용 shared/sound.js: 효과음 · 배경음 따로 켜고 끔. 못 불러오면 소리 없이) ----------------
let snd: SoundModule | null = null;
let bgmScene = 'main';
function sfx(name: string, o?: { volume?: number; rate?: number }) { try { snd?.play(name, o); } catch { /* 소리는 실패해도 게임은 계속 */ } }
/** 배경음: 타이틀·스테이지 main, 스테이지 보스 boss, 끝나면 win · lose (같은 곡이면 그대로) */
function bgm(scene: string) { bgmScene = scene; try { snd?.playBgm('ace', scene); } catch { /* 배경음은 없어도 게임은 계속 */ } }
function openSound() { try { snd?.openSoundSettings(); } catch { toast('소리 설정을 열지 못했어요'); } }
void loadSound().then(m => { snd = m; bgm(bgmScene); }).catch(() => {});
// 첫 터치 전에는 소리가 나지 않으니, 첫 터치 때 배경음을 다시 건다
window.addEventListener('pointerdown', () => bgm(bgmScene), { once: true });
let stress = params.get('stress') === '1';
let showFps = params.get('fps') === '1';

// ---------------- 공통 ----------------
function popup(html: string, bind?: (el: HTMLElement) => void) {
  $('pop').innerHTML = html;
  $('overlay').classList.remove('hidden');
  bind?.($('pop'));
  $('pop').querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true });
}
function closePop() { $('overlay').classList.add('hidden'); }
function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => t.classList.remove('on'), 2200);
}
let cutinTimer = 0;
function cutin(html: string, cls = '', ms = 1800) {
  const c = $('cutin');
  c.innerHTML = html; c.className = 'cutin ' + cls;
  void c.offsetWidth; c.classList.add('on');
  clearTimeout(cutinTimer);
  cutinTimer = window.setTimeout(() => c.classList.add('hidden'), ms);
}
function mmss(sec: number) { const t = Math.floor(sec); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function stageName(n: number) { return `${n}. ${STAGES[n - 1].name}`; }
function runLabel() {
  if (run.mode === 'rush') return `보스 러시 ${Math.max(1, scene?.sim?.rushIdx ?? 1)} / ${RUSH.length}`;
  if (run.mode === 'endless') return `끝없는 모드 ${mmss((scene?.sim?.frame ?? 0) / 60)}`;
  return stageName(run.stage);
}

// ---------------- 서버 기록 ----------------
/** 서버 상태를 화면 진행에 맞춘다 (해금 · 최고 기록은 서버가 기준) */
async function syncState() {
  const s = await api.state();
  progress.cleared = s.cleared;
  progress.allClear = s.allClear;
  progress.best = { ...s.best };
  progress.rushBest = s.rushBest;
  progress.endlessBest = s.endlessBest;
  siaCoins = s.siaCoins;
  if (s.admin) ALL = true;
  if (!OFFLINE) {
    try { const owned = await (await loadCharacters()).loadOwnedCharacters('ace', true); if (owned) progress.catOwned = owned.includes('cat'); } catch { /* 못 읽으면 그대로 */ }
  }
  saveProgress(progress);
}

/** 이 판의 격추 · 시간을 모은다 (아케이드는 스테이지마다 Sim 을 새로 만들어서) */
function addRunTotals(sim: Sim) { run.kills += sim.kills; run.frames += sim.frame; }

/** 판 끝을 서버에 보낸다 (연습은 보내지 않음). 시아코인 +1 · 최고 기록 */
async function sendFinish(sim: Sim, done: boolean) {
  if (!run.id || run.mode === 'practice') return;
  const id = run.id;
  run.id = '';
  addRunTotals(sim);
  try {
    const r = await api.finish(id, {
      score: Math.floor(sim.score), rankScore: Math.floor(run.continued ? run.rankScore : sim.score), kills: run.kills,
      seconds: Math.floor(run.frames / 60), stage: run.mode === 'arcade' ? run.stage : 0, done,
    });
    siaCoins = r.siaCoins;
    if (r.gotCoin) toast(`시아코인 +1 (모두 ${r.siaCoins.toLocaleString()}개)`);
    await syncState().catch(() => {});
  } catch (e) {
    toast('기록을 보내지 못했어요 · ' + reasonText(e));
  }
}

// ---------------- 타이틀 ----------------
function showTitle() {
  inGame = false;
  closePop();
  $('hud').classList.add('hidden');
  $('weather').className = 'weather hidden';
  scene?.setPaused(true);
  const open = SHIP_ORDER.filter(id => shipOpen(progress, id, ALL)).length;
  const mode = (ic: string, name: string, sub: string, right: string, ok: boolean, id: string, need: string) => ok
    ? `<button class="mode" type="button" data-mode="${id}"><span class="ic">${ic}</span><span class="tx">${name}<small>${sub}</small></span><span class="rt">${right}</span></button>`
    : `<button class="mode locked" type="button" data-need="${need}"><span class="ic">${LOCK}</span><span class="tx">${name}<small>${need}</small></span></button>`;
  $('menu').className = 'menu title';
  $('menu').innerHTML = `
    <div class="topbar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="sp"></span><span class="pill coinpill">🪙 ${siaCoins.toLocaleString()}</span><button class="btn sm" id="rankBtn" type="button">🏆 랭킹</button></div>
    <div class="logo">시아에이스</div>
    <div class="sub">요괴 비행단을 막아라!</div>
    <div class="hero">
      <i class="cloud" style="left:4%;top:58%;width:24%;height:9%"></i><i class="cloud" style="right:2%;top:20%;width:20%;height:8%"></i>
      <img class="h-ship" src="${shipArt(progress.ship)}" alt="">
      <img class="h-foe a" src="${new URL('art/enemy-small.png', location.href).href}" alt=""><img class="h-foe b" src="${new URL('art/enemy-medium.png', location.href).href}" alt="">
    </div>
    <div class="modes">
      <button class="mode arcade" type="button" data-mode="arcade"><span class="ic">✈️</span><span class="tx">아케이드<small>스테이지 1~${LAST_STAGE} · 이어하기 1회</small></span><span class="rt">최고<b>${progress.best[progress.difficulty].toLocaleString()}</b></span></button>
      ${mode('🎯', '스테이지 연습', '깬 스테이지를 파워 최대로', `${ALL ? LAST_STAGE : progress.cleared}개 열림`, ALL || MODES.practice(progress), 'practice', '스테이지 1을 깨면 열려요')}
      ${mode('👹', '보스 러시', `보스 ${RUSH.length}마리 연속 · 목숨 3`, progress.rushBest ? `최단<b>${mmss(progress.rushBest)}</b>` : '', ALL || MODES.bossRush(progress), 'rush', '아케이드를 한 번 끝까지 깨면 열려요')}
      ${mode('♾️', '끝없는 모드', '점점 빨라지는 적 · 목숨 1', progress.endlessBest ? `최장<b>${mmss(progress.endlessBest)}</b>` : '', ALL || MODES.endless(progress), 'endless', '스테이지 6을 깨면 열려요')}
    </div>
    <div class="pills"><span class="pill">✈️ 기체 ${open} / 13</span><button class="pill soundpill" id="soundBtn" type="button" aria-label="소리 설정">⚙️</button></div>`;
  bgm('main');
  $('soundBtn').addEventListener('click', openSound);
  $('menu').querySelectorAll<HTMLButtonElement>('.mode').forEach(b => b.addEventListener('click', () => {
    sfx('click');
    if (b.dataset.need) { toast(b.dataset.need); return; }
    run.mode = b.dataset.mode as Mode;
    showSelect();
  }));
  $('rankBtn').addEventListener('click', async () => {
    if (!me) { toast(OFFLINE ? '시험 판에서는 랭킹을 볼 수 없어요' : '로그인이 필요해요'); return; }
    if (!(await openWorldRanking(me.userId))) toast('랭킹을 불러오지 못했어요');
  });
}

// ---------------- 기체 · 난이도 고르기 ----------------
function showSelect() {
  $('menu').className = 'menu select';
  let pick: ShipId = shipOpen(progress, progress.ship, ALL) ? progress.ship : 'dragon';
  let diff: Difficulty = progress.difficulty;
  const title = { arcade: '기체 고르기', practice: '연습 기체', rush: '보스 러시', endless: '끝없는 모드' }[run.mode];
  const render = () => {
    const s = SHIPS[pick];
    $('menu').innerHTML = `
      <div class="topbar"><button class="back" id="backBtn" type="button">← 뒤로</button><span class="sp"></span><span class="ttl">${title}</span><span class="sp"></span><span class="pill coinpill">🪙 ${siaCoins.toLocaleString()}</span></div>
      <div class="panel detail">
        <div class="top"><i class="cloud" style="left:5%;top:62%;width:22%;height:14%"></i><img class="d-ship" src="${shipArt(pick)}" alt=""><img class="d-pilot" src="${full(pick)}" alt=""></div>
        <div class="info">
          <h4>${s.name} <small>조종사 ${s.pilot} · ${s.animal}</small></h4>
          <div class="stats"><span>속도</span><div class="gauge"><i style="width:${s.speedLv * 25}%"></i></div><span>화력</span><div class="gauge"><i style="width:${s.power * 100}%"></i></div><span>범위</span><div class="gauge"><i style="width:${s.range * 100}%"></i></div></div>
          <div class="weap"><div>기본샷<small>${s.shotText}</small></div><div>차지샷<small>${s.chargeText}</small></div><div>폭탄<small>${s.bombText}</small></div></div>
        </div>
      </div>
      <div class="grid13">${SHIP_ORDER.map(id => {
        const ok = shipOpen(progress, id, ALL), u = SHIPS[id].unlock;
        return `<button type="button" class="cell${id === pick ? ' sel' : ''}${ok ? '' : ' lk'}" data-id="${id}" aria-label="${SHIPS[id].name}"><img src="${face(id)}" alt="">${!ok && u === 'buy' ? '<span class="cost">🪙100</span>' : ''}</button>`;
      }).join('')}</div>
      <div class="seg">${(['easy', 'normal', 'hard'] as Difficulty[]).map(d => `<button type="button" data-d="${d}" class="${d === diff ? 'on' : ''}">${DIFFICULTY[d].label}<small>${d === 'easy' ? '탄 느림 · 목숨 5' : d === 'normal' ? '기본' : '되받아치기탄'}</small></button>`).join('')}</div>
      <button class="btn primary go" id="goBtn" type="button">${run.mode === 'practice' ? '스테이지 고르기 ▶' : '출격 ▶'}</button>`;
    $('backBtn').addEventListener('click', showTitle);
    $('menu').querySelectorAll<HTMLButtonElement>('.cell').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id as ShipId, u = SHIPS[id].unlock;
      if (!shipOpen(progress, id, ALL)) {
        if (u === 'buy') askBuyCat(() => { pick = 'cat'; render(); });
        else toast(`아케이드 스테이지 ${u}을(를) 처음 깨면 열려요`);
        return;
      }
      pick = id; render();
    }));
    $('menu').querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => b.addEventListener('click', () => { diff = b.dataset.d as Difficulty; render(); }));
    $('goBtn').addEventListener('click', () => {
      progress.ship = pick; progress.difficulty = diff; saveProgress(progress);
      if (run.mode === 'practice') showPractice();
      else if (run.mode === 'rush') void startServerRun('rush', () => startScript(RUSH_STAGE, 3));
      else if (run.mode === 'endless') void startServerRun('endless', () => startScript(ENDLESS_STAGE, 1));
      else {
        const first = ALL ? Number(params.get('stage')) || 1 : 1;
        run.rankScore = 0; run.continued = false;
        void startServerRun('arcade', () => startStage(first, true), first);
      }
    });
  };
  render();
}

/** 고양이호 구매 (071 의 buy_character: 스테이지 5 클리어 + 시아코인 100개) */
function askBuyCat(done: () => void) {
  const ready = progress.cleared >= LIMITS.catNeed;
  popup(`<h3>고양이호</h3>
    <div class="chap">조종사 야옹이 · 반사되는 발톱탄 · 탄 흡수 후 반격 · 화면 정지 폭탄</div>
    <div class="unlock"><img src="${face('cat')}" alt=""><div>${ready ? '시아코인 100개로 열 수 있어요' : `아케이드 스테이지 ${LIMITS.catNeed}를 깨면 살 수 있어요`}<small>가진 시아코인 ${siaCoins.toLocaleString()}개 · 지금 깬 스테이지 ${progress.cleared}</small></div></div>
    <div class="col">${ready ? '<button class="btn primary" id="buy" type="button">🪙 100개로 열기</button>' : ''}<button class="btn" id="close" type="button">닫기</button></div>`, el => {
    el.querySelector('#close')!.addEventListener('click', closePop);
    el.querySelector('#buy')?.addEventListener('click', async e => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      if (OFFLINE) {
        if (siaCoins < 100) { toast('시아코인이 모자라요'); closePop(); return; }
        siaCoins -= 100; progress.catOwned = true; saveProgress(progress); closePop(); toast('고양이호를 열었어요!'); done(); return;
      }
      try {
        const m = await loadCharacters();
        const r = await m.buyCharacter('ace', 'cat');
        toast(m.buyMessage(r, 'cat'));
        if (r.ok || r.reason === 'owned') { progress.catOwned = true; saveProgress(progress); if (typeof r.siaCoins === 'number') siaCoins = r.siaCoins; closePop(); done(); }
        else closePop();
      } catch { toast('열지 못했어요. 잠시 후 다시 시도해 주세요'); closePop(); }
    });
  });
}

// ---------------- 스테이지 연습 지도 ----------------
function showPractice() {
  $('menu').className = 'menu practice';
  const open = ALL ? LAST_STAGE : progress.cleared;
  $('menu').innerHTML = `
    <div class="topbar"><button class="back" id="backBtn" type="button">← 뒤로</button><span class="sp"></span><span class="ttl">스테이지 연습</span><span class="sp"></span></div>
    <div class="pills"><span class="pill">파워 최대로 시작</span><span class="pill">시아코인 · 랭킹 없음</span></div>
    <div class="stgrid">${STAGES.map((st, i) => {
      const n = i + 1, ok = n <= open, best = progress.practice[n];
      const bg = st.sea === 'full' || st.sky ? '' : `style="background-image:url(${floorArt(st.floor)})"`;
      return `<button type="button" class="st ${ok ? 'done' : 'lk'}${st.sea === 'full' ? ' sea' : ''}${st.sky ? ' sky' : ''}" data-n="${n}" ${bg}><span class="nm"><b>${n}</b>${st.name}</span><span class="rec">${ok ? (best ? '최고 ' + best.toLocaleString() : '기록 없음') : '아케이드에서 깨면 열려요'}</span></button>`;
    }).join('')}</div>`;
  $('backBtn').addEventListener('click', showSelect);
  $('menu').querySelectorAll<HTMLButtonElement>('.st').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.n!;
    if (n > open) { toast('아케이드에서 이 스테이지를 깨면 열려요'); return; }
    run.id = ''; run.kills = 0; run.frames = 0;
    startStage(n, true);
  }));
}

// ---------------- 게임 ----------------
/** 서버에 판 시작을 알리고 (기체·모드 열림 확인) 시작 */
async function startServerRun(mode: ServerMode, go: () => void, stage = 1) {
  const btn = document.getElementById('goBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    run.id = await api.start(mode, progress.difficulty, progress.ship, stage);
    run.kills = 0; run.frames = 0;
    go();
  } catch (e) {
    toast(reasonText(e));
    if (btn) btn.disabled = false;
  }
}

function enterGame(st: StageDef) {
  closePop();
  $('menu').className = 'menu hidden';
  $('hud').classList.remove('hidden');
  $('bossbar').classList.add('hidden');
  $('weather').className = 'weather' + (st.fog ? ' fog' : st.snow ? ' snow' : st.lava ? ' lava' : ' hidden');
  $('windChip').classList.toggle('hidden', !st.wind);
  $<HTMLImageElement>('lifeFace').src = face(progress.ship);
  inGame = true;
  slowTicks = 0;
  bgm('main');
}

/** 아케이드 · 연습 스테이지. fresh = 새 판, 아니면 앞 스테이지에서 이어 간다 */
function startStage(n: number, fresh: boolean, carry?: ReturnType<Sim['carry']>) {
  run.stage = n;
  const st = STAGES[n - 1];
  enterGame(st);
  $('stageChip').textContent = stageName(n);
  scene.restartWith({
    ship: progress.ship, difficulty: progress.difficulty, waves: PROTO_MODE ? PROTO : st, stage: n,
    carry: fresh ? undefined : carry, lives: undefined, stress,
  }, false);
  readyThen = () => {
    if (run.mode === 'practice' && fresh) scene.sim.power = 4;
    if (run.continued) scene.sim.continued = true;
    const at = Number(params.get('at')), pw = Number(params.get('power'));
    if (ALL && at > 0) scene.sim.skipTo(at);
    if (ALL && pw >= 1 && pw <= 4) scene.sim.power = pw;
    scene.setPaused(false);
    cutin(`<b>스테이지 ${n}</b><small>${st.name}</small>`, 'stage', 2200);
  };
}

/** 보스 러시 · 끝없는 모드 */
function startScript(st: StageDef, lives: number) {
  enterGame(st);
  $('stageChip').textContent = runLabel();
  scene.restartWith({ ship: progress.ship, difficulty: progress.difficulty, waves: st, stage: 1, carry: undefined, lives, stress }, false);
  readyThen = () => {
    const pw = Number(params.get('power'));
    if (ALL && pw >= 1 && pw <= 4) scene.sim.power = pw;
    scene.setPaused(false);
    cutin(`<b>${st.name}</b><small>${run.mode === 'rush' ? `보스 ${RUSH.length}마리를 가장 빨리` : '얼마나 버틸 수 있을까?'}</small>`, 'stage', 2200);
  };
}
let readyThen: (() => void) | null = null;
let slowTicks = 0;
function setLite(on: boolean) {
  scene.lite = on;
  try { localStorage.setItem('ace:lite', on ? '1' : '0'); } catch { /* 이번 판만 */ }
}

function pause() {
  if (!inGame || scene.paused || scene.sim.state !== 'play') return;
  scene.setPaused(true);
  const s = scene.hudState();
  popup(`<h3>잠깐 멈춤</h3>
    <div class="chap">${runLabel()} · ${mmss(s.seconds)} · ${s.score.toLocaleString()}점</div>${intro}
    <div class="tools">
      <div class="lbl">이동 감도</div>
      <div class="seg four" id="sens">${[0.8, 1, 1.25, 1.5].map(v => `<button type="button" data-v="${v}" class="${v === scene.sens ? 'on' : ''}">${v}×</button>`).join('')}</div>
      <div class="seg two"><button type="button" id="soundSet">⚙️ 소리</button><button type="button" id="liteBtn" class="${scene.lite ? 'on' : ''}">가벼운 화면</button></div>
      <div class="seg two"><button type="button" id="fpsBtn" class="${showFps ? 'on' : ''}">성능 보기</button>${ALL ? `<button type="button" id="stressBtn" class="${stress ? 'on' : ''}">탄 400발 시험</button>` : ''}</div>
    </div>
    <div class="col">
      <button class="btn primary" id="resume" type="button">계속하기 ▶</button>
      <div class="row">${run.mode === 'practice' ? '<button class="btn" id="restart" type="button">처음부터</button>' : ''}<button class="btn" id="quit" type="button">그만하기</button></div>
    </div>
    ${run.mode !== 'practice' ? '<div class="note">그만두면 이 판은 기록·시아코인 없이 끝나요</div>' : ''}`, el => {
    el.querySelector('#resume')!.addEventListener('click', resume);
    el.querySelector('#restart')?.addEventListener('click', () => { closePop(); scene.newRun({ stress }); scene.sim.power = 4; scene.setPaused(false); });
    el.querySelector('#quit')!.addEventListener('click', () => { run.id = ''; showTitle(); });
    el.querySelectorAll<HTMLButtonElement>('#sens button').forEach(b => b.addEventListener('click', () => {
      scene.sens = +b.dataset.v!;
      try { localStorage.setItem('ace:sens', b.dataset.v!); } catch { /* 저장 못 해도 이번 판은 그대로 */ }
      el.querySelectorAll('#sens button').forEach(o => o.classList.toggle('on', o === b));
    }));
    el.querySelector('#soundSet')!.addEventListener('click', openSound);
    el.querySelector('#liteBtn')!.addEventListener('click', e => { setLite(!scene.lite); (e.currentTarget as HTMLElement).classList.toggle('on', scene.lite); });
    el.querySelector('#fpsBtn')!.addEventListener('click', e => { showFps = !showFps; (e.currentTarget as HTMLElement).classList.toggle('on', showFps); $('fps').classList.toggle('hidden', !showFps); });
    el.querySelector('#stressBtn')?.addEventListener('click', e => {
      stress = !stress; (e.currentTarget as HTMLElement).classList.toggle('on', stress);
      scene.sim.opt.stress = stress;
      if (stress) scene.sim.lives = Math.max(scene.sim.lives, 99);
    });
  });
}
function resume() { closePop(); scene.setPaused(false); }

function over(s: HudState) {
  const sim = scene.sim;
  bgm('lose');
  sfx('lose');
  if (run.mode === 'endless') {
    const sec = Math.floor(sim.frame / 60), best = sec > progress.endlessBest;
    void sendFinish(sim, false);
    popup(`<h3>${best ? '새 기록!' : '끝났어요'}</h3>
      <div class="chap">끝없는 모드 · 격추 ${s.kills} · ${s.score.toLocaleString()}점</div>
      <div class="total">${mmss(sec)}</div>
      <div class="note">최장 ${mmss(Math.max(sec, progress.endlessBest))} 버팀</div>
      <div class="col"><button class="btn primary" id="again" type="button">다시 하기 ▶</button><button class="btn" id="toTitle" type="button">타이틀로</button></div>`, el => {
      el.querySelector('#again')!.addEventListener('click', () => void startServerRun('endless', () => startScript(ENDLESS_STAGE, 1)));
      el.querySelector('#toTitle')!.addEventListener('click', showTitle);
    });
    return;
  }
  if (run.mode === 'rush') {
    void sendFinish(sim, false);
    popup(`<h3>격추당했어요</h3>
      <div class="chap">보스 러시 · ${Math.max(0, sim.rushIdx - 1)} / ${RUSH.length} 격파 · ${mmss(s.seconds)}</div>
      <div class="total">${s.score.toLocaleString()}</div>
      <div class="note">보스 러시 기록은 끝까지 깼을 때 시간으로 남아요</div>
      <div class="col"><button class="btn primary" id="again" type="button">다시 하기 ▶</button><button class="btn" id="toTitle" type="button">타이틀로</button></div>`, el => {
      el.querySelector('#again')!.addEventListener('click', () => void startServerRun('rush', () => startScript(RUSH_STAGE, 3)));
      el.querySelector('#toTitle')!.addEventListener('click', showTitle);
    });
    return;
  }
  if (run.mode === 'practice') {
    progress.practice[run.stage] = Math.max(progress.practice[run.stage] ?? 0, s.score);
    saveProgress(progress);
  }
  // 아케이드: 이어하기 1회 (점수는 0부터, 랭킹에는 이어하기 전 점수만)
  const canContinue = run.mode === 'arcade' && !run.continued;
  if (run.mode === 'arcade' && !canContinue) void sendFinish(sim, false);
  popup(`<h3>격추당했어요</h3>
    <div class="chap">${stageName(run.stage)} · ${mmss(s.seconds)} · 격추 ${s.kills}</div>
    <div class="total">${s.score.toLocaleString()}</div>
    <div class="note">${canContinue ? '이어하면 이 자리에서 다시 시작해요. 점수는 0부터, 랭킹에는 지금 점수가 남아요' : run.mode === 'arcade' ? `${DIFFICULTY[progress.difficulty].label} 최고 ${Math.max(progress.best[progress.difficulty], run.rankScore).toLocaleString()}` : '연습 기록이 남았어요'}</div>
    <div class="col">${canContinue ? '<button class="btn primary" id="cont" type="button">이어하기 (1회) ▶</button><button class="btn" id="giveUp" type="button">그만하기</button>'
      : `<button class="btn primary" id="again" type="button">${run.mode === 'arcade' ? '처음부터 다시 ▶' : '다시 하기 ▶'}</button><button class="btn" id="toTitle" type="button">타이틀로</button>`}</div>`, el => {
    el.querySelector('#cont')?.addEventListener('click', () => {
      run.rankScore = s.score; run.continued = true;
      closePop();
      scene.continueRun();
      bgm(scene.sim.boss && scene.sim.boss.def.kind === 'stage' ? 'boss' : 'main');
      toast('이어하기! 점수는 0부터');
    });
    el.querySelector('#giveUp')?.addEventListener('click', () => { void sendFinish(sim, false); showTitle(); });
    el.querySelector('#again')?.addEventListener('click', () => {
      if (run.mode === 'arcade') { run.rankScore = 0; run.continued = false; void startServerRun('arcade', () => startStage(1, true)); }
      else startStage(run.stage, true);
    });
    el.querySelector('#toTitle')?.addEventListener('click', showTitle);
  });
}

/** 정산: 줄이 하나씩 찍히고 합계가 올라간다 */
function clear(sim: Sim) {
  const t = sim.tally!;
  bgm('win');
  sfx('win');
  const rows: [string, string, boolean][] = [
    [`격추 <small>${t.kills}기</small>`, '', true],
    ['보스 격파', t.bossScore ? t.bossScore.toLocaleString() : '도망감', t.bossScore > 0],
    ['부위 파괴', t.partScore.toLocaleString(), t.partScore > 0],
    [`금화 최고 연속 <small>×${t.coinBest}</small>`, '', true],
    [`남은 폭탄 ${t.bombs} × ${BONUS.bomb.toLocaleString()}`, t.bombBonus.toLocaleString(), t.bombBonus > 0],
    ['노미스 보너스', t.noMiss ? t.noMissBonus.toLocaleString() : '—', t.noMiss],
  ];
  const tally = `<div class="tally">${rows.map(([a, b, ok], i) => `<div class="${ok ? '' : 'miss'}" style="animation-delay:${0.15 + i * 0.18}s"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`;
  const countUp = (el: HTMLElement, value: number, fmt: (v: number) => string) => {
    const total = el.querySelector('#total')!, start = performance.now(), delay = 0.15 + rows.length * 0.18;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1000 - delay) / 1.4);
      total.textContent = fmt(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (run.mode === 'rush') {
    const sec = Math.round(t.frames / 60), best = !progress.rushBest || sec < progress.rushBest;
    void sendFinish(sim, true);
    popup(`<h3>보스 러시 완주!</h3>
      <div class="chap">보스 ${RUSH.length}마리 · ${t.total.toLocaleString()}점</div>${tally}
      <div class="total" id="total">0:00</div>
      <div class="note">${best ? '새 최단 기록!' : '최단 ' + mmss(progress.rushBest)}</div>
      <div class="col"><button class="btn primary" id="toTitle" type="button">타이틀로 ▶</button></div>`, el => {
      el.querySelector('#toTitle')!.addEventListener('click', showTitle);
      countUp(el, sec, mmss);
    });
    return;
  }

  const n = run.stage, arcade = run.mode === 'arcade';
  const last = n >= LAST_STAGE;
  // 화면은 바로 (이 기기 진행으로 계산), 서버에는 스테이지 클리어를 알린다 (기체 해금은 서버 기준)
  const unlocked = arcade && !ALL ? recordClear(progress, n) : null;
  if (!arcade) progress.practice[n] = Math.max(progress.practice[n] ?? 0, t.total);
  saveProgress(progress);
  if (arcade && run.id) {
    const id = run.id;
    void api.clear(id, n).then(r => { progress.cleared = Math.max(progress.cleared, r.cleared); if (r.cleared >= LAST_STAGE) progress.allClear = true; saveProgress(progress); })
      .catch(e => toast('스테이지 기록을 보내지 못했어요 · ' + reasonText(e)))
      .then(() => { if (last) void sendFinish(sim, true); });
    if (!last) addRunTotals(sim);
  }
  const u = unlocked ? SHIPS[unlocked] : null;
  popup(`<h3>${arcade && last ? '요괴왕을 물리쳤어요!' : '스테이지 클리어!'}</h3>
    <div class="chap">${stageName(n)} · ${mmss(t.frames / 60)}</div>${tally}
    <div class="total" id="total">0</div>
    ${u ? `<div class="unlock"><img src="${face(u.id)}" alt=""><div>${u.name}가 열렸어요!<small>조종사 ${u.pilot} · ${u.shotText}</small></div><span class="tag">NEW</span></div>` : ''}
    ${arcade && n === LIMITS.catNeed && !progress.catOwned ? '<div class="note">고양이호를 시아코인 100개로 살 수 있어요 (기체 고르기에서)</div>' : ''}
    ${arcade && last ? `<div class="note">${run.continued ? `이어하기 전 점수 ${run.rankScore.toLocaleString()}점이 기록돼요` : '보스 러시가 열렸어요!'}</div>` : ''}
    <div class="col">${arcade && !last
      ? `<button class="btn primary" id="next" type="button">다음 스테이지 ▶</button><button class="btn" id="toTitle" type="button">여기서 끝내기</button>`
      : `<button class="btn primary" id="again" type="button">${arcade ? '타이틀로 ▶' : '다시 하기 ▶'}</button>${arcade ? '' : '<button class="btn" id="toMap" type="button">연습 지도로</button>'}`}</div>`, el => {
    el.querySelector('#next')?.addEventListener('click', () => startStage(n + 1, false, sim.carry()));
    el.querySelector('#again')?.addEventListener('click', () => (arcade ? showTitle() : startStage(n, true)));
    // 스테이지를 깬 뒤 끝내면 그 점수로 판을 마친다 (이미 더한 이 스테이지 격추·시간은 빼고 보냄)
    el.querySelector('#toTitle')?.addEventListener('click', () => { run.kills -= sim.kills; run.frames -= sim.frame; void sendFinish(sim, false); showTitle(); });
    el.querySelector('#toMap')?.addEventListener('click', () => { showTitle(); run.mode = 'practice'; showPractice(); });
    countUp(el, t.total, v => v.toLocaleString());
  });
}

function hud(s: HudState) {
  $('score').textContent = s.score.toLocaleString();
  $('lives').textContent = String(Math.max(0, s.lives));
  $('power').textContent = s.power >= 4 ? 'MAX' : String(s.power);
  $('bombs').textContent = String(s.bombs);
  $('bombBtn').classList.toggle('empty', s.bombs <= 0);
  $('coin').textContent = String(s.coinChain);
  $('coinNext').textContent = s.coinChain ? ' 다음 ' + s.nextCoin.toLocaleString() : '';
  const b = s.boss, bar = $('bossbar');
  bar.classList.toggle('hidden', !b);
  if (b) {
    $('bossName').textContent = (b.mid ? '중간 보스 · ' : '') + b.name;
    $('bossTime').textContent = '⏱ ' + mmss(b.left);
    $('bossTime').classList.toggle('low', b.left <= 15);
    $<HTMLElement>('bossHp').style.width = (b.hp * 100).toFixed(1) + '%';
    const ph = $('bossPh');
    if (ph.childElementCount !== b.phases) ph.innerHTML = '<i></i>'.repeat(b.phases);
    ph.querySelectorAll('i').forEach((i, k) => i.classList.toggle('off', k < b.phase));
  }
}

function onEvent(e: SimEvent) {
  switch (e.t) {
    case 'kill': sfx(e.kind === 'small' ? 'survPop' : 'tankBoom', e.kind === 'small' ? { volume: 0.6 } : undefined); break;
    case 'hit': sfx('survHurt'); break;
    case 'shield': sfx('tankHeal'); break;
    case 'bomb': sfx('tankBigBoom'); break;
    case 'boom': sfx('tankBoom', { volume: 0.6 }); break;
    case 'charge': sfx(e.kind === 'laser' ? 'tankLaser' : 'tankBoom', { rate: 1 + e.cells * 0.1 }); break;
    case 'pick': sfx(e.kind === 'C' ? 'coin' : 'survLevel'); break;
    case 'partDown': sfx('tankBoom'); break;
    case 'phase': sfx('survBossWarn', { volume: 0.6 }); break;
    case 'extend': toast('목숨 +1!'); sfx('survLevel'); break;
    case 'bossIn':
      sfx('survBossWarn');
      if (!e.mid) bgm('boss');
      if (run.mode === 'rush') $('stageChip').textContent = runLabel();
      cutin(`<small>${e.mid ? '중간 보스' : run.mode === 'rush' ? `보스 ${scene.sim.rushIdx} / ${RUSH.length}` : '경고!'}</small><b>${e.name}</b>`, e.mid ? '' : 'warn', 2200);
      break;
    case 'flee': if (!e.mid) bgm('main'); cutin(`<b>${e.mid ? '도망갔어요' : '보스가 도망갔어요'}</b><small>제한 시간이 지났어요</small>`); break;
    case 'bossDown': sfx('survBossDown'); if (!e.mid) { cutin('<b>격파!</b>', 'win', 1600); if (run.mode !== 'rush' && run.mode !== 'endless') bgm('main'); } break;
    case 'bomb': if (e.kind === 'freeze') cutin('<b>정지!</b>', 'stage', 1200); break;
    case 'coinLost': $('coinChip').classList.remove('lost'); void $('coinChip').offsetWidth; $('coinChip').classList.add('lost'); break;
  }
}

function fail(html: string) {
  $('menu').className = 'menu title';
  $('menu').innerHTML = `<div class="loading">${html}</div>`;
}

async function boot() {
  // 로그인 (시험 판 · ?local=1 은 로그인 없이 이 기기에만)
  try {
    if (!OFFLINE) {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      me = await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
      // 접속 인원 (로비에 보인다). 정원이 차면 들어가지 않는다
      const lobby = await enterLobby(me);
      if (lobby?.full) {
        void lobby.leave();
        fail(`지금은 시아에이스에 사람이 너무 많아요.<br/>잠시 뒤 다시 와 주세요.<br/><br/><a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
        return;
      }
    }
    api = await getApi(OFFLINE, ALL);
    await syncState();
  } catch {
    fail(`SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
      <button class="btn primary" id="retry" type="button">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
    return;
  }
  // 캔버스 글자(P·B·떠오르는 점수)가 Jua 로 나오게 글꼴을 먼저 읽는다 (못 읽어도 시작)
  try { await Promise.race([document.fonts.load('28px Jua'), new Promise(r => setTimeout(r, 1500))]); } catch { /* 기본 글꼴 */ }
  scene = new StageScene({
    hud, over, clear, event: onEvent,
    ready: () => { const f = readyThen; readyThen = null; f?.(); },
  }, { seed: 1, ship: progress.ship, difficulty: progress.difficulty, waves: STAGES[0], stage: 1, stress });
  try { const v = Number(localStorage.getItem('ace:sens')); if (v > 0) scene.sens = v; } catch { /* 기본 감도 */ }
  const game = new Phaser.Game({
    type: params.get('canvas') === '1' ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'game',
    width: W, height: H,
    backgroundColor: '#9fd6ff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60 },
    input: { activePointers: 3 },
    render: { antialias: true, powerPreference: 'high-performance' },
    scene: [scene],
  });
  showTitle();
  // 폭탄 버튼: 누르는 순간 (드래그하는 손가락과 따로)
  $('bombBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); scene.bomb(); });
  $('pauseBtn').addEventListener('click', pause);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && inGame) { if (scene.paused && !$('overlay').classList.contains('hidden') && scene.sim.state === 'play') resume(); else pause(); }
    if (inGame && (e.key === ' ' || e.key === 'Shift')) e.preventDefault();
  });
  // 앱이 뒤로 가면 자동으로 멈춤
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  try { if (localStorage.getItem('ace:lite') === '1') scene.lite = true; } catch { /* 기본 */ }
  setInterval(() => {
    if (showFps) $('fps').textContent = `${Math.round(game.loop.actualFps)}fps · 탄 ${scene.sim?.ebCount ?? 0}`;
    if (!inGame || !scene.sim) return;
    // 느린 폰: 판 중에 4초 넘게 45fps 아래면 가벼운 화면으로 (멈춤 화면에서 다시 끌 수 있다)
    if (!scene.paused && !scene.lite) {
      slowTicks = game.loop.actualFps < 45 ? slowTicks + 1 : 0;
      if (slowTicks >= 8) { setLite(true); toast('화면이 느려서 가벼운 화면으로 바꿨어요'); }
    }
    if (run.mode === 'endless') $('stageChip').textContent = runLabel();
    // 바람 고원: 지금 바람 방향
    const w = scene.sim.wind;
    if (scene.stage.wind) $('windChip').textContent = Math.abs(w) < 0.4 ? '🍃 잔잔' : w > 0 ? '🍃 바람 →' : '← 바람 🍃';
  }, 500);
  $('fps').classList.toggle('hidden', !showFps);
}

void boot();
