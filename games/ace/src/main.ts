// 시아에이스: 타이틀 → 기체·난이도 고르기 → 스테이지 → 정산 → (다음 스테이지 | 타이틀).
// M3: 기체 13종 · 스테이지 1~6 · 난이도 3단계 · 스테이지 연습. 진행은 이 기기에 저장 (M5 에서 서버 · 로그인 · 랭킹 · 시아코인).
// 개발용: ?all=1 (모두 열림), ?stage=n (아케이드 n 스테이지부터), ?at=초, ?power=4, ?fps=1, ?stress=1, ?canvas=1, ?proto=1
import './style.css';
import './menu.css';
import Phaser from 'phaser';
import { BONUS, DIFFICULTY, H, W, type Difficulty, type Sim, type SimEvent } from './game/sim';
import { PROTO, type StageDef } from './data/waves';
import { SHIPS, SHIP_ORDER, type ShipId } from './data/ships';
import { LAST_STAGE, MODES, loadProgress, recordClear, saveProgress, shipOpen } from './game/progress';
import { StageScene, shared, type HudState } from './scenes/StageScene';
import S1 from './data/stages/stage1.json';
import S2 from './data/stages/stage2.json';
import S3 from './data/stages/stage3.json';
import S4 from './data/stages/stage4.json';
import S5 from './data/stages/stage5.json';
import S6 from './data/stages/stage6.json';

const STAGES = [S1, S2, S3, S4, S5, S6] as unknown as StageDef[];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const ALL = params.get('all') === '1';
const PROTO_MODE = params.get('proto') === '1';
const progress = loadProgress();

type Mode = 'arcade' | 'practice';
const run = { mode: 'arcade' as Mode, stage: 1 };

const LOCK = '<svg class="lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
const face = (id: string) => shared(`images/zodiac/face/${id}.png`);
const full = (id: string) => shared(`images/zodiac/full/${id}.png`);
const shipArt = (id: string) => new URL(`art/ship-${id}.png`, location.href).href;
const floorArt = (f: string) => new URL(`art/${f}.png`, location.href).href;

const app = $('app');
app.innerHTML = `
  <div class="hud hidden" id="hud">
    <div class="hud-top">
      <button class="btn iconbtn" id="pauseBtn" type="button" aria-label="멈춤">II</button>
      <span class="chip" id="stageChip"></span>
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
  <div class="fog hidden" id="fog"></div>
  <div class="menu" id="menu"></div>
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
  (toast as unknown as { h: number }).h = window.setTimeout(() => t.classList.remove('on'), 1800);
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

// ---------------- 타이틀 ----------------
function showTitle() {
  inGame = false;
  closePop();
  $('hud').classList.add('hidden');
  $('fog').classList.add('hidden');
  scene?.setPaused(true);
  const open = SHIP_ORDER.filter(id => shipOpen(progress, id, ALL)).length;
  const mode = (ic: string, name: string, sub: string, right: string, ok: boolean, id: string, need: string) => ok
    ? `<button class="mode" type="button" data-mode="${id}"><span class="ic">${ic}</span><span class="tx">${name}<small>${sub}</small></span><span class="rt">${right}</span></button>`
    : `<button class="mode locked" type="button" data-need="${need}"><span class="ic">${LOCK}</span><span class="tx">${name}<small>${need}</small></span></button>`;
  $('menu').className = 'menu title';
  $('menu').innerHTML = `
    <div class="topbar"><a class="back" href="../../index.html">← SIA WORLD</a><span class="sp"></span><button class="btn sm" id="rankBtn" type="button">🏆 랭킹</button></div>
    <div class="logo">시아에이스</div>
    <div class="sub">요괴 비행단을 막아라!</div>
    <div class="hero">
      <i class="cloud" style="left:4%;top:58%;width:24%;height:9%"></i><i class="cloud" style="right:2%;top:20%;width:20%;height:8%"></i>
      <img class="h-ship" src="${shipArt(progress.ship)}" alt="">
      <img class="h-foe a" src="${new URL('art/enemy-small.png', location.href).href}" alt=""><img class="h-foe b" src="${new URL('art/enemy-medium.png', location.href).href}" alt="">
    </div>
    <div class="modes">
      <button class="mode arcade" type="button" data-mode="arcade"><span class="ic">✈️</span><span class="tx">아케이드<small>스테이지 1~${LAST_STAGE} · 목숨 ${DIFFICULTY[progress.difficulty].lives}</small></span><span class="rt">최고<b>${progress.best[progress.difficulty].toLocaleString()}</b></span></button>
      ${mode('🎯', '스테이지 연습', '깬 스테이지를 파워 최대로', `${progress.cleared}개 열림`, ALL || MODES.practice(progress), 'practice', '스테이지 1을 깨면 열려요')}
      ${mode('👹', '보스 러시', '', '', false, 'rush', ALL || MODES.bossRush(progress) ? 'M4 에서 열려요' : '아케이드를 한 번 끝까지 깨면 열려요')}
      ${mode('♾️', '끝없는 모드', '', '', false, 'endless', ALL || MODES.endless(progress) ? 'M4 에서 열려요' : '스테이지 6을 깨면 열려요')}
    </div>
    <div class="pills"><span class="pill">✈️ 기체 ${open} / 13</span></div>`;
  $('menu').querySelectorAll<HTMLButtonElement>('.mode').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.need) { toast(b.dataset.need); return; }
    run.mode = b.dataset.mode as Mode;
    showSelect();
  }));
  $('rankBtn').addEventListener('click', () => toast('랭킹은 M5 에서 열려요'));
}

// ---------------- 기체 · 난이도 고르기 ----------------
function showSelect() {
  $('menu').className = 'menu select';
  let pick: ShipId = shipOpen(progress, progress.ship, ALL) ? progress.ship : 'dragon';
  let diff: Difficulty = progress.difficulty;
  const render = () => {
    const s = SHIPS[pick];
    $('menu').innerHTML = `
      <div class="topbar"><button class="back" id="backBtn" type="button">← 뒤로</button><span class="sp"></span><span class="ttl">${run.mode === 'practice' ? '연습 기체' : '기체 고르기'}</span><span class="sp"></span></div>
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
        toast(u === 'buy' ? (progress.cleared >= 5 ? '시아코인 100개로 열어요 (M5 에서 구매)' : '스테이지 5를 깨면 시아코인 100개로 살 수 있어요') : `아케이드 스테이지 ${u}을(를) 처음 깨면 열려요`);
        return;
      }
      pick = id; render();
    }));
    $('menu').querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => b.addEventListener('click', () => { diff = b.dataset.d as Difficulty; render(); }));
    $('goBtn').addEventListener('click', () => {
      progress.ship = pick; progress.difficulty = diff; saveProgress(progress);
      if (run.mode === 'practice') showPractice(); else startStage(Number(params.get('stage')) || 1, true);
    });
  };
  render();
}

// ---------------- 스테이지 연습 지도 ----------------
function showPractice() {
  $('menu').className = 'menu practice';
  const open = ALL ? LAST_STAGE : progress.cleared;
  $('menu').innerHTML = `
    <div class="topbar"><button class="back" id="backBtn" type="button">← 뒤로</button><span class="sp"></span><span class="ttl">스테이지 연습</span><span class="sp"></span></div>
    <div class="pills"><span class="pill">파워 최대로 시작</span><span class="pill">기록만 남아요</span></div>
    <div class="stgrid">${STAGES.map((st, i) => {
      const n = i + 1, ok = n <= open, best = progress.practice[n];
      const bg = st.sea === 'full' ? '' : st.sky ? '' : `style="background-image:url(${floorArt(st.floor)})"`;
      return `<button type="button" class="st ${ok ? 'done' : 'lk'}${st.sea === 'full' ? ' sea' : ''}${st.sky ? ' sky' : ''}" data-n="${n}" ${bg}><span class="nm"><b>${n}</b>${st.name}</span><span class="rec">${ok ? (best ? '최고 ' + best.toLocaleString() : '기록 없음') : '아케이드에서 깨면 열려요'}</span></button>`;
    }).join('')}</div>`;
  $('backBtn').addEventListener('click', showSelect);
  $('menu').querySelectorAll<HTMLButtonElement>('.st').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.n!;
    if (n > open) { toast('아케이드에서 이 스테이지를 깨면 열려요'); return; }
    startStage(n, true);
  }));
}

// ---------------- 게임 ----------------
/** fresh = 새 판 (아케이드 처음 · 연습). 아니면 앞 스테이지에서 이어 간다 */
function startStage(n: number, fresh: boolean, carry?: ReturnType<Sim['carry']>) {
  run.stage = n;
  const st = STAGES[n - 1];
  closePop();
  $('menu').className = 'menu hidden';
  $('hud').classList.remove('hidden');
  $('bossbar').classList.add('hidden');
  $('fog').classList.toggle('hidden', !st.fog);
  $('stageChip').textContent = stageName(n);
  $<HTMLImageElement>('lifeFace').src = face(progress.ship);
  inGame = true;
  scene.restartWith({
    ship: progress.ship, difficulty: progress.difficulty, waves: PROTO_MODE ? PROTO : st, stage: n,
    carry: fresh ? undefined : carry, stress,
  }, false);
  readyThen = () => {
    if (run.mode === 'practice' && fresh) scene.sim.power = 4;
    const at = Number(params.get('at')), pw = Number(params.get('power'));
    if (at > 0) scene.sim.skipTo(at);
    if (pw >= 1 && pw <= 4) scene.sim.power = pw;
    scene.setPaused(false);
    cutin(`<b>스테이지 ${n}</b><small>${st.name}</small>`, 'stage', 2200);
  };
}
let readyThen: (() => void) | null = null;

function pause() {
  if (!inGame || scene.paused || scene.sim.state !== 'play') return;
  scene.setPaused(true);
  const s = scene.hudState();
  popup(`<h3>잠깐 멈춤</h3>
    <div class="chap">${stageName(run.stage)} · ${mmss(s.seconds)} · ${s.score.toLocaleString()}점</div>${intro}
    <div class="tools">
      <div class="lbl">이동 감도</div>
      <div class="seg four" id="sens">${[0.8, 1, 1.25, 1.5].map(v => `<button type="button" data-v="${v}" class="${v === scene.sens ? 'on' : ''}">${v}×</button>`).join('')}</div>
      <div class="seg two"><button type="button" id="fpsBtn" class="${showFps ? 'on' : ''}">성능 보기</button><button type="button" id="stressBtn" class="${stress ? 'on' : ''}">탄 400발 시험</button></div>
    </div>
    <div class="col">
      <button class="btn primary" id="resume" type="button">계속하기 ▶</button>
      <div class="row"><button class="btn" id="restart" type="button">이 스테이지 처음부터</button><button class="btn" id="quit" type="button">그만하기</button></div>
    </div>`, el => {
    el.querySelector('#resume')!.addEventListener('click', resume);
    el.querySelector('#restart')!.addEventListener('click', () => { closePop(); scene.newRun({ stress }); if (run.mode === 'practice') scene.sim.power = 4; scene.setPaused(false); });
    el.querySelector('#quit')!.addEventListener('click', showTitle);
    el.querySelectorAll<HTMLButtonElement>('#sens button').forEach(b => b.addEventListener('click', () => {
      scene.sens = +b.dataset.v!;
      try { localStorage.setItem('ace:sens', b.dataset.v!); } catch { /* 저장 못 해도 이번 판은 그대로 */ }
      el.querySelectorAll('#sens button').forEach(o => o.classList.toggle('on', o === b));
    }));
    el.querySelector('#fpsBtn')!.addEventListener('click', e => { showFps = !showFps; (e.currentTarget as HTMLElement).classList.toggle('on', showFps); $('fps').classList.toggle('hidden', !showFps); });
    el.querySelector('#stressBtn')!.addEventListener('click', e => {
      stress = !stress; (e.currentTarget as HTMLElement).classList.toggle('on', stress);
      scene.sim.opt.stress = stress;
      if (stress) scene.sim.lives = Math.max(scene.sim.lives, 99);
    });
  });
}
function resume() { closePop(); scene.setPaused(false); }

function recordBest(score: number) {
  if (run.mode === 'arcade') progress.best[progress.difficulty] = Math.max(progress.best[progress.difficulty], score);
  else progress.practice[run.stage] = Math.max(progress.practice[run.stage] ?? 0, score);
  saveProgress(progress);
}

function over(s: HudState) {
  recordBest(s.score);
  popup(`<h3>격추당했어요</h3>
    <div class="chap">${stageName(run.stage)} · ${mmss(s.seconds)} · 격추 ${s.kills}</div>
    <div class="total">${s.score.toLocaleString()}</div>
    <div class="note">${run.mode === 'arcade' ? `${DIFFICULTY[progress.difficulty].label} 최고 ${progress.best[progress.difficulty].toLocaleString()} · 이어하기는 M4 에서 붙어요` : '연습 기록이 남았어요'}</div>
    <div class="col"><button class="btn primary" id="again" type="button">${run.mode === 'arcade' ? '처음부터 다시 ▶' : '다시 하기 ▶'}</button><button class="btn" id="toTitle" type="button">타이틀로</button></div>`, el => {
    el.querySelector('#again')!.addEventListener('click', () => startStage(run.mode === 'arcade' ? 1 : run.stage, true));
    el.querySelector('#toTitle')!.addEventListener('click', showTitle);
  });
}

/** 스테이지 정산: 줄이 하나씩 찍히고 합계가 올라간다 */
function clear(sim: Sim) {
  const t = sim.tally!;
  const n = run.stage, arcade = run.mode === 'arcade';
  const unlocked = arcade && !ALL ? recordClear(progress, n) : null;
  const last = n >= LAST_STAGE;
  if (!arcade || last) recordBest(t.total); else saveProgress(progress);
  const rows: [string, string, boolean][] = [
    [`격추 <small>${t.kills}기</small>`, '', true],
    ['보스 격파', t.bossScore ? t.bossScore.toLocaleString() : '도망감', t.bossScore > 0],
    ['부위 파괴', t.partScore.toLocaleString(), t.partScore > 0],
    [`금화 최고 연속 <small>×${t.coinBest}</small>`, '', true],
    [`남은 폭탄 ${t.bombs} × ${BONUS.bomb.toLocaleString()}`, t.bombBonus.toLocaleString(), t.bombBonus > 0],
    ['노미스 보너스', t.noMiss ? t.noMissBonus.toLocaleString() : '—', t.noMiss],
  ];
  const u = unlocked ? SHIPS[unlocked] : null;
  popup(`<h3>${arcade && last ? '모두 깼어요!' : '스테이지 클리어!'}</h3>
    <div class="chap">${stageName(n)} · ${mmss(t.frames / 60)}</div>
    <div class="tally">${rows.map(([a, b, ok], i) => `<div class="${ok ? '' : 'miss'}" style="animation-delay:${0.15 + i * 0.18}s"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <div class="total" id="total">0</div>
    ${u ? `<div class="unlock"><img src="${face(u.id)}" alt=""><div>${u.name}가 열렸어요!<small>조종사 ${u.pilot} · ${u.shotText}</small></div><span class="tag">NEW</span></div>` : ''}
    ${arcade && last ? `<div class="note">스테이지 7~12 · 이어하기 · 보스 러시 · 끝없는 모드는 M4 에서 붙어요</div>` : ''}
    <div class="col">${arcade && !last
      ? `<button class="btn primary" id="next" type="button">다음 스테이지 ▶</button><button class="btn" id="toTitle" type="button">그만하기</button>`
      : `<button class="btn primary" id="again" type="button">${arcade ? '타이틀로 ▶' : '다시 하기 ▶'}</button>${arcade ? '' : '<button class="btn" id="toTitle" type="button">연습 지도로</button>'}`}</div>`, el => {
    el.querySelector('#next')?.addEventListener('click', () => startStage(n + 1, false, sim.carry()));
    el.querySelector('#again')?.addEventListener('click', () => (arcade ? showTitle() : startStage(n, true)));
    el.querySelector('#toTitle')?.addEventListener('click', () => (arcade ? showTitle() : (showTitle(), run.mode = 'practice', showPractice())));
    const total = el.querySelector('#total')!, start = performance.now(), dur = 1400, delay = 0.15 + rows.length * 0.18;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1000 - delay) / (dur / 1000));
      total.textContent = Math.round(t.total * (1 - (1 - k) ** 3)).toLocaleString();
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
    case 'extend': toast('목숨 +1!'); break;
    case 'bossIn': cutin(`<small>${e.mid ? '중간 보스' : '경고!'}</small><b>${e.name}</b>`, e.mid ? '' : 'warn', 2200); break;
    case 'flee': cutin(`<b>${e.mid ? '도망갔어요' : '보스가 도망갔어요'}</b><small>제한 시간이 지났어요</small>`); break;
    case 'bossDown': if (!e.mid) cutin('<b>격파!</b>', 'win', 1600); break;
    case 'bomb': if (e.kind === 'freeze') cutin('<b>정지!</b>', 'stage', 1200); break;
    case 'coinLost': $('coinChip').classList.remove('lost'); void $('coinChip').offsetWidth; $('coinChip').classList.add('lost'); break;
  }
}

async function boot() {
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
  setInterval(() => { if (showFps) $('fps').textContent = `${Math.round(game.loop.actualFps)}fps · 탄 ${scene.sim?.ebCount ?? 0}`; }, 500);
  $('fps').classList.toggle('hidden', !showFps);
}

void boot();
