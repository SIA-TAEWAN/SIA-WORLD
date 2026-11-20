import Phaser from 'phaser';
import { LOCAL_MODE } from '../net/local';
import { loadSound, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import { buildConfig, createRun, resultOf, stageOf, type HeroId, type RunState } from '../sim';

/**
 * 판 밖 화면 (돌격대 app.ts 방식, HTML). 1단계: 메인 → 판 → 결과.
 */

let me: WorldUser | null = null;
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
  soundButton(el);
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

export function boot(user: WorldUser | null) {
  me = user;
}

/** 1단계: 반사형(쥐·호랑이) · 관통형(소) */
const PARTY: HeroId[] = ['rat', 'ox', 'tiger'];

export function showMain() {
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div></div>
    <div class="title"><h1>시아핑거</h1><p>당겼다 놓아 튕겨서 요괴를 부숴라!</p></div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">⚔️ 한 판 해 보기</button>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요</p>' : ''}
    ${me ? '' : ''}`);
  root.querySelector('#go')!.addEventListener('click', () => {
    play('click');
    startGame('1-1');
  });
}

let game: Phaser.Game | null = null;

function closeGame() {
  game?.destroy(true);
  game = null;
}

export function startGame(stageId: string, party: HeroId[] = PARTY) {
  const st = stageOf(stageId);
  if (!st) return;
  const run = createRun(buildConfig({ stage: st.id, party }));
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-mid"><b>${st.id} ${st.name}</b><span id="wave"></span></div>
      <span class="troop-pill" id="turns"></span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 당겼다 놓으세요</div>`;
  const waveEl = root.querySelector<HTMLElement>('#wave')!;
  const turnsEl = root.querySelector<HTMLElement>('#turns')!;
  const scene = new GameScene();
  closeGame();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root.querySelector<HTMLElement>('#game')!,
    width: W,
    height: H,
    backgroundColor: '#7cc08a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 },
    scene: [],
    banner: false,
  });
  let hinted = false;
  game.scene.add('game', scene, true, {
    run,
    hooks: {
      sound: play,
      onFrame: (s: RunState) => {
        waveEl.textContent = `웨이브 ${s.wave + 1}/${s.cfg.waves.length}`;
        turnsEl.textContent = `턴 ${s.turn}/${s.cfg.par}`;
        if (!hinted && s.turn > 0) {
          hinted = true;
          root.querySelector('#hint')?.remove();
        }
      },
      onEnd: (s: RunState) => showResult(s, party),
    },
  });
  root.querySelector('#pause')!.addEventListener('click', () => {
    if (scene.paused || run.phase === 'clear' || run.phase === 'fail') return;
    play('click');
    scene.paused = true;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button></div>`;
    root.appendChild(box);
    box.querySelector('#resume')!.addEventListener('click', () => {
      play('click');
      scene.paused = false;
      box.remove();
    });
    box.querySelector('#quit')!.addEventListener('click', () => {
      play('click');
      closeGame();
      showMain();
    });
  });
}

function showResult(s: RunState, party: HeroId[]) {
  const r = resultOf(s);
  play(r.cleared ? 'win' : 'lose');
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${r.cleared ? 'win' : 'lose'}">
      <h2>${r.cleared ? '클리어!' : '실패'}</h2>
      <div class="rows">
        <div><span>쓴 턴</span><b>${r.turns}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${r.kills}</b></div>
        <div><span>쓰러진 대원</span><b>${r.fallen}</b></div>
      </div>
      <div class="btns">
        <button class="btn primary big" id="again">다시하기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    closeGame();
    startGame(s.cfg.stage, party);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    showMain();
  });
}
