// 시아에이스 M2: 스테이지 1 (해안 마을) — 청룡호 · 차지샷(관통 레이저) · 중간 보스 · 스테이지 보스 · 금화 연속 · 정산.
// 로그인·랭킹·시아코인은 M5 에서 붙인다. 지금은 바로 시작해서 한 스테이지를 끝까지 해 본다.
// 개발용: ?proto=1 (M1 시험 비행 반복), ?fps=1, ?stress=1, ?canvas=1
import './style.css';
import Phaser from 'phaser';
import { BONUS, H, W, type Sim } from './game/sim';
import { PROTO, type StageDef } from './data/waves';
import STAGE1 from './data/stages/stage1.json';
import { StageScene, shared, type HudState } from './scenes/StageScene';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const PROTO_MODE = params.get('proto') === '1';
const STAGE = STAGE1 as StageDef;
const stageLabel = PROTO_MODE ? 'M1 시험 비행' : `${STAGE.id}. ${STAGE.name}`;

const app = $('app');
app.innerHTML = `
  <div class="hud hidden" id="hud">
    <div class="hud-top">
      <button class="btn iconbtn" id="pauseBtn" type="button" aria-label="멈춤">II</button>
      <span class="chip">${stageLabel}</span>
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
  <div class="overlay" id="overlay"><div class="panel pop" id="pop"></div></div>
  <div class="toast" id="toast"></div>`;
$<HTMLImageElement>('lifeFace').src = shared('images/zodiac/face/dragon.png');

const intro = `<div class="intro">
  <div><span class="key">끌기</span>화면 어디든 드래그해서 움직여요 · 사격은 자동</div>
  <div><span class="key">꾹</span>손가락을 대고 있으면 아래 게이지가 차요. 1칸 이상에서 떼면 관통 레이저</div>
  <div><span class="key">💣</span>오른쪽 아래 버튼 · 적 탄을 모두 지우고 1.5초 무적</div>
  <div><span class="key">🪙</span>금화를 놓치지 않고 이어 먹으면 100 → 2,000점</div>
  <div><span class="key">PC</span>방향키·WASD 이동 · Shift 눌렀다 떼기 차지 · Space 폭탄 · Esc 멈춤</div>
</div>`;

let scene: StageScene;
let started = false;
let stress = params.get('stress') === '1';
let showFps = params.get('fps') === '1';

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

function go() {
  started = true; closePop(); $('hud').classList.remove('hidden');
  // 개발용: ?at=초 (등장표 건너뛰기), ?power=4
  const at = Number(params.get('at')), pw = Number(params.get('power'));
  if (at > 0) scene.sim.skipTo(at);
  if (pw >= 1 && pw <= 4) scene.sim.power = pw;
  scene.setPaused(false);
}

function showStart() {
  popup(`<div class="logo">시아에이스</div>
    <div class="chap">${PROTO_MODE ? 'M1 시험 비행' : `스테이지 ${STAGE.id} · ${STAGE.name}`} · 청룡호 (조종사 여의룡)</div>${intro}
    <div class="col"><button class="btn primary" id="go" type="button">출격 ▶</button></div>`, el => {
    el.querySelector('#go')!.addEventListener('click', () => { go(); if (!PROTO_MODE) cutin(`<b>스테이지 ${STAGE.id}</b><small>${STAGE.name}</small>`, 'stage', 2200); });
  });
}

function pause() {
  if (!started || scene.paused || scene.sim.state !== 'play') return;
  scene.setPaused(true);
  const s = scene.hudState();
  popup(`<h3>잠깐 멈춤</h3>
    <div class="chap">${stageLabel} · ${mmss(s.seconds)} · ${s.score.toLocaleString()}점</div>${intro}
    <div class="tools">
      <div class="lbl">이동 감도</div>
      <div class="seg" id="sens">${[0.8, 1, 1.25, 1.5].map(v => `<button type="button" data-v="${v}" class="${v === scene.sens ? 'on' : ''}">${v}×</button>`).join('')}</div>
      <div class="seg two"><button type="button" id="fpsBtn" class="${showFps ? 'on' : ''}">성능 보기</button><button type="button" id="stressBtn" class="${stress ? 'on' : ''}">탄 400발 시험</button></div>
    </div>
    <div class="col">
      <button class="btn primary" id="resume" type="button">계속하기 ▶</button>
      <button class="btn" id="restart" type="button">처음부터</button>
    </div>`, el => {
    el.querySelector('#resume')!.addEventListener('click', resume);
    el.querySelector('#restart')!.addEventListener('click', () => { scene.newRun({ stress }); resume(); });
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

function again() { closePop(); $('bossbar').classList.add('hidden'); scene.newRun({ stress }); scene.setPaused(false); }

function over(s: HudState) {
  popup(`<h3>격추당했어요</h3>
    <div class="chap">${stageLabel} · ${mmss(s.seconds)} · 격추 ${s.kills}</div>
    <div class="total">${s.score.toLocaleString()}</div>
    <div class="note">이어하기·랭킹은 M4·M5 에서 붙어요</div>
    <div class="col"><button class="btn primary" id="again" type="button">다시 출격 ▶</button></div>`, el => {
    el.querySelector('#again')!.addEventListener('click', again);
  });
}

/** 스테이지 정산: 줄이 하나씩 찍히고 합계가 올라간다 */
function clear(sim: Sim) {
  const t = sim.tally!;
  const rows: [string, string, boolean][] = [
    [`격추 <small>${t.kills}기</small>`, '', true],
    ['보스 격파', t.bossScore ? t.bossScore.toLocaleString() : '도망감', t.bossScore > 0],
    ['부위 파괴', t.partScore.toLocaleString(), t.partScore > 0],
    [`금화 최고 연속 <small>×${t.coinBest}</small>`, '', true],
    [`남은 폭탄 ${t.bombs} × ${BONUS.bomb.toLocaleString()}`, t.bombBonus.toLocaleString(), t.bombBonus > 0],
    ['노미스 보너스', t.noMiss ? t.noMissBonus.toLocaleString() : '—', t.noMiss],
  ];
  popup(`<h3>스테이지 클리어!</h3>
    <div class="chap">${STAGE.id}. ${STAGE.name} · ${mmss(sim.frame / 60)}</div>
    <div class="tally">${rows.map(([a, b, ok], i) => `<div class="${ok ? '' : 'miss'}" style="animation-delay:${0.15 + i * 0.18}s"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <div class="total" id="total">0</div>
    <div class="note">시아코인 · 다음 스테이지 · 기체 해금은 M3~M5 에서 붙어요</div>
    <div class="col"><button class="btn primary" id="again" type="button">다시 하기 ▶</button></div>`, el => {
    el.querySelector('#again')!.addEventListener('click', again);
    const total = el.querySelector('#total')!, start = performance.now(), dur = 1400, delay = 0.15 + rows.length * 0.18;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1000 - delay) / (dur / 1000));
      total.textContent = Math.round(t.total * (1 - (1 - k) ** 3)).toLocaleString();
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function mmss(sec: number) { const t = Math.floor(sec); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

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
    ph.querySelectorAll('i').forEach((i, n) => i.classList.toggle('off', n < b.phase));
  }
}

function onEvent(e: import('./game/sim').SimEvent) {
  switch (e.t) {
    case 'extend': toast('목숨 +1!'); break;
    case 'bossIn': cutin(`<small>${e.mid ? '중간 보스' : '경고!'}</small><b>${e.name}</b>`, e.mid ? '' : 'warn', 2200); break;
    case 'flee': cutin(`<b>${e.mid ? '도망갔어요' : '보스가 도망갔어요'}</b><small>제한 시간이 지났어요</small>`); break;
    case 'bossDown': if (!e.mid) cutin('<b>격파!</b>', 'win', 1600); break;
    case 'coinLost': $('coinChip').classList.remove('lost'); void $('coinChip').offsetWidth; $('coinChip').classList.add('lost'); break;
  }
}

async function boot() {
  // 캔버스 글자(P·B·떠오르는 점수)가 Jua 로 나오게 글꼴을 먼저 읽는다 (못 읽어도 시작)
  try { await Promise.race([document.fonts.load('28px Jua'), new Promise(r => setTimeout(r, 1500))]); } catch { /* 기본 글꼴 */ }
  scene = new StageScene({ hud, over, clear, event: onEvent }, { seed: 1, ship: 'dragon', waves: PROTO_MODE ? PROTO : STAGE, stage: PROTO_MODE ? 1 : STAGE.id, stress });
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
  showStart();
  // 폭탄 버튼: 누르는 순간 (드래그하는 손가락과 따로)
  $('bombBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); scene.bomb(); });
  $('pauseBtn').addEventListener('click', pause);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (scene.paused && started && !$('overlay').classList.contains('hidden') && scene.sim.state === 'play') resume(); else pause(); }
    if (e.key === ' ' || e.key === 'Shift') e.preventDefault();
  });
  // 앱이 뒤로 가면 자동으로 멈춤
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  setInterval(() => { if (showFps) $('fps').textContent = `${Math.round(game.loop.actualFps)}fps · 탄 ${scene.sim?.ebCount ?? 0}`; }, 500);
  $('fps').classList.toggle('hidden', !showFps);
}

void boot();
