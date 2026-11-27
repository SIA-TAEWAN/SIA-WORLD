// 시아에이스 M1 프로토타입: 청룡호 1종 · 드래그 이동 · 자동 사격 · P/B · 임시 도형 적.
// 로그인·랭킹·시아코인은 M5 에서 붙인다. 지금은 바로 시작해서 조작감만 본다.
import './style.css';
import Phaser from 'phaser';
import { H, W } from './game/sim';
import { PROTO } from './data/waves';
import { StageScene, shared, type HudState } from './scenes/StageScene';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const app = $('app');
app.innerHTML = `
  <div class="hud hidden" id="hud">
    <div class="hud-top">
      <button class="btn iconbtn" id="pauseBtn" type="button" aria-label="멈춤">II</button>
      <span class="chip">M1 시험 비행</span>
      <span class="sp"></span>
      <span class="chip score" id="score">0</span>
    </div>
    <div class="hud-bot">
      <span class="chip"><img id="lifeFace" alt="">×<b id="lives">3</b></span>
      <span class="chip"><i class="mini p">P</i><b id="power">1</b></span>
      <span class="chip fps hidden" id="fps"></span>
    </div>
    <button class="bombbtn" id="bombBtn" type="button" aria-label="폭탄">💣<em id="bombs">2</em></button>
  </div>
  <div class="overlay" id="overlay"><div class="panel pop" id="pop"></div></div>
  <div class="toast" id="toast"></div>`;
$<HTMLImageElement>('lifeFace').src = shared('images/zodiac/face/dragon.png');

const intro = `<div class="intro">
  <div><span class="key">끌기</span>화면 어디든 드래그해서 움직여요</div>
  <div><span class="key">자동</span>기본 사격은 저절로 나가요</div>
  <div><span class="key">💣</span>오른쪽 아래 버튼 · 적 탄을 모두 지우고 1.5초 무적</div>
  <div><span class="key">PC</span>방향키·WASD 이동 · Space 폭탄 · Esc 멈춤</div>
</div>`;

let scene: StageScene;
let started = false;
let stress = params.get('stress') === '1';
let showFps = params.get('fps') === '1';

function popup(html: string, bind?: (el: HTMLElement) => void) {
  $('pop').innerHTML = html;
  $('overlay').classList.remove('hidden');
  bind?.($('pop'));
}
function closePop() { $('overlay').classList.add('hidden'); }
function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => t.classList.remove('on'), 1800);
}

function showStart() {
  popup(`<div class="logo">시아에이스</div>
    <div class="chap">M1 시험 비행 · 청룡호 (조종사 여의룡)</div>${intro}
    <div class="col"><button class="btn primary" id="go" type="button">출격 ▶</button></div>`, el => {
    el.querySelector('#go')!.addEventListener('click', () => { started = true; closePop(); $('hud').classList.remove('hidden'); scene.setPaused(false); });
  });
}

function pause() {
  if (!started || scene.paused || scene.sim.state !== 'play') return;
  scene.setPaused(true);
  const s = scene.hudState();
  popup(`<h3>잠깐 멈춤</h3>
    <div class="chap">${mmss(s.seconds)} · ${s.score.toLocaleString()}점 · 격추 ${s.kills}</div>${intro}
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

function over(s: HudState) {
  popup(`<h3>격추당했어요</h3>
    <div class="chap">${mmss(s.seconds)} 버팀 · 격추 ${s.kills}</div>
    <div class="total">${s.score.toLocaleString()}</div>
    <div class="note">M1 은 같은 적 등장표를 반복하며 점점 탄이 빨라져요</div>
    <div class="col"><button class="btn primary" id="again" type="button">다시 출격 ▶</button></div>`, el => {
    el.querySelector('#again')!.addEventListener('click', () => { closePop(); scene.newRun({ stress }); scene.setPaused(false); });
  });
}

function mmss(sec: number) { const t = Math.floor(sec); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

function hud(s: HudState) {
  $('score').textContent = s.score.toLocaleString();
  $('lives').textContent = String(Math.max(0, s.lives));
  $('power').textContent = s.power >= 4 ? 'MAX' : String(s.power);
  $('bombs').textContent = String(s.bombs);
  $('bombBtn').classList.toggle('empty', s.bombs <= 0);
}

async function boot() {
  // 캔버스 글자(P·B·떠오르는 점수)가 Jua 로 나오게 글꼴을 먼저 읽는다 (못 읽어도 시작)
  try { await Promise.race([document.fonts.load('28px Jua'), new Promise(r => setTimeout(r, 1500))]); } catch { /* 기본 글꼴 */ }
  scene = new StageScene({ hud, over, event: e => { if (e.t === 'extend') toast('목숨 +1!'); } }, { seed: 1, ship: 'dragon', waves: PROTO, stress });
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
  game.events.once('ready', () => {});
  showStart();
  // 폭탄 버튼: 누르는 순간 (드래그하는 손가락과 따로)
  $('bombBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); scene.bomb(); });
  $('pauseBtn').addEventListener('click', pause);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (scene.paused && started && !$('overlay').classList.contains('hidden') && scene.sim.state === 'play') resume(); else pause(); }
    if (e.key === ' ') e.preventDefault();
  });
  // 앱이 뒤로 가면 자동으로 멈춤
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  setInterval(() => { if (showFps) $('fps').textContent = `${Math.round(game.loop.actualFps)}fps · 탄 ${scene.sim?.ebCount ?? 0}`; }, 500);
  $('fps').classList.toggle('hidden', !showFps);
}

void boot();
