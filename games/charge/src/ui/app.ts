import Phaser from 'phaser';
import { zodiacFaceUrl } from '../assets';
import { LEADERS, leaderOf, type ZodiacId } from '../data/balance';
import { STAGES, nextStage, stageOf, type StageDef } from '../data/stages';
import { createRun, progressOf, starsFor, type RunState } from '../game/sim';
import { GameScene, H, W } from '../scenes/GameScene';
import { loadSound, worldHome, type SoundModule } from '../net/world';

/**
 * 메뉴·게임 화면·결과 (1단계: 로그인한 사람은 기록 없이 플레이, 진행도는 이 기기에만 저장).
 * 서버 저장·엽전·강화·랭킹은 4단계에서 붙인다 (PRD.md 14장).
 */

interface Progress {
  stars: Record<string, number>;
  leader: ZodiacId;
}

const KEY = 'sia-charge-progress-v1';

function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    const l = leaderOf(p?.leader ?? 'rat');
    // 아직 열리지 않은 대장이 저장돼 있으면 쥐로 (대장 해금은 4단계에서 서버 기록으로)
    return { stars: p?.stars ?? {}, leader: l.starter ? l.id : 'rat' };
  } catch {
    return { stars: {}, leader: 'rat' };
  }
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 저장 공간이 없으면 이번 판만 */
  }
}

const progress = loadProgress();
let sound: SoundModule | null = null;
void loadSound()
  .then((m) => (sound = m))
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);

const app = () => document.getElementById('app')!;

function screen(html: string): HTMLElement {
  const root = app();
  root.innerHTML = `<div class="screen">${html}</div>`;
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

const starsHtml = (n: number) => `<span class="stars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;

/** 스테이지가 열려 있는가: 첫 스테이지이거나 바로 앞 스테이지를 클리어했다 */
function isOpen(st: StageDef): boolean {
  const i = STAGES.indexOf(st);
  return i === 0 || (progress.stars[STAGES[i - 1].id] ?? 0) > 0;
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

export function showMain() {
  const total = Object.values(progress.stars).reduce((a, b) => a + b, 0);
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><span class="coins-pill">★ ${total}</span></div>
    <div class="title"><h1>시아돌격대</h1><p>숫자 문을 골라 대원을 불리고 요괴를 뚫어라!</p></div>
    <div class="card">
      <h3>대장 <small>대장과 같은 띠 대원들이 함께 달려요</small></h3>
      <div class="leaders">${LEADERS.map(
        (l) => `<button class="leader ${l.id === progress.leader ? 'on' : ''} ${l.starter ? '' : 'locked'}" data-id="${l.id}" ${l.starter ? '' : 'disabled'}>
            <img src="${zodiacFaceUrl(l.id)}" alt="${l.name}" /><b>${l.name}</b>${l.starter ? '' : `<em>🔒 ${l.unlockRegion}지역</em>`}
          </button>`,
      ).join('')}</div>
      <p class="soft center" id="trait">${leaderOf(progress.leader).trait}</p>
    </div>
    <div class="card">
      <h3>1지역 · 쥐의 들판</h3>
      <div class="stage-grid">${STAGES.map((st) => {
        const open = isOpen(st);
        return `<button class="btn stage ${open ? '' : 'locked'}" data-id="${st.id}" ${open ? '' : 'disabled'}>
            <b>${st.id}</b><span>${open ? st.name : '🔒'}</span>${starsHtml(progress.stars[st.id] ?? 0)}
          </button>`;
      }).join('')}</div>
    </div>
    <div class="grow"></div>
    <p class="soft center">지금은 1단계(시험판)라 기록은 이 기기에만 저장돼요</p>`);
  root.querySelectorAll<HTMLButtonElement>('.leader').forEach((b) =>
    b.addEventListener('click', () => {
      progress.leader = b.dataset.id as ZodiacId;
      saveProgress(progress);
      play('click');
      showMain();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('.stage').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const st = stageOf(b.dataset.id!);
      if (st) startGame(st);
    }),
  );
  soundButton(root);
}

let game: Phaser.Game | null = null;

export function startGame(stage: StageDef) {
  const run = createRun(stage, progress.leader);
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-mid"><b>${stage.id} ${stage.name}</b><div class="prog"><i id="prog"></i><span class="boss-mark">👹</span></div></div>
      <span class="troop-pill" id="troops">🪖 ${run.troops}</span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 좌우로 끌어 문을 고르세요</div>`;
  const prog = root.querySelector<HTMLElement>('#prog')!;
  const troops = root.querySelector<HTMLElement>('#troops')!;
  let hinted = false;
  const scene = new GameScene();
  game?.destroy(true);
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
  game.scene.add('game', scene, true, {
    run,
    hooks: {
      sound: play,
      onFrame: (s: RunState) => {
        prog.style.width = `${Math.round(progressOf(s) * 100)}%`;
        troops.textContent = `🪖 ${s.troops}`;
        if (!hinted && s.t > 3) {
          hinted = true;
          root.querySelector('#hint')?.remove();
        }
      },
      onEnd: (s: RunState) => showResult(s),
    },
  });
  root.querySelector('#pause')!.addEventListener('click', () => {
    play('click');
    scene.paused = true;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button></div>`;
    root.appendChild(box);
    box.querySelector('#resume')!.addEventListener('click', () => {
      scene.paused = false;
      box.remove();
    });
    box.querySelector('#quit')!.addEventListener('click', () => {
      game?.destroy(true);
      game = null;
      showMain();
    });
  });
}

function showResult(s: RunState) {
  const stars = starsFor(s);
  const st = s.stage;
  if (stars > (progress.stars[st.id] ?? 0)) {
    progress.stars[st.id] = stars;
    saveProgress(progress);
  }
  play(stars > 0 ? 'win' : 'lose');
  const next = nextStage(st.id);
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${stars > 0 ? 'win' : 'lose'}">
      <h2>${stars > 0 ? '클리어!' : '전멸했어요'}</h2>
      ${stars > 0 ? `<div class="big-stars">${starsHtml(stars)}</div>` : `<p class="soft center">${Math.round(progressOf(s) * 100)}% 까지 갔어요</p>`}
      <div class="rows">
        <div><span>남은 대원</span><b>${s.troops}</b></div>
        <div><span>가장 많았을 때</span><b>${s.peak}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${s.kills}</b></div>
      </div>
      ${stars > 0 && stars < 3 ? `<p class="soft center">별 ${stars + 1}개: 대원 ${st.stars[stars - 1]}명 이상 남기기</p>` : ''}
      <div class="btns">
        ${stars > 0 && next ? `<button class="btn primary big" id="next">다음 스테이지 ▶</button>` : ''}
        <button class="btn ${stars > 0 && next ? '' : 'primary big'}" id="again">다시하기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  const leave = () => {
    game?.destroy(true);
    game = null;
  };
  box.querySelector('#next')?.addEventListener('click', () => {
    play('click');
    leave();
    startGame(next!);
  });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    leave();
    startGame(st);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    leave();
    showMain();
  });
}
