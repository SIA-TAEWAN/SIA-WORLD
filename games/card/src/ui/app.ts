/**
 * 시아카드배틀 화면 (HTML 메뉴 + Phaser 전투). 1단계: 처음 화면 → 전투 하나 → 결과.
 */
import Phaser from 'phaser';
import { apply, enemyDef, enterTestBattle, heroDef, newRun, type RunState } from '../game/rules';
import { DEV_FOES, DEV_KIND, DEV_RELICS, DEV_SEED, LOCAL_MODE } from '../net/local';
import { loadSound, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { BattleScene, H, W, type BattleHooks } from '../scenes/BattleScene';

interface Ctx {
  user: WorldUser | null;
  sound: SoundModule | null;
  run: RunState | null;
  game: Phaser.Game | null;
}
const ctx: Ctx = { user: null, sound: null, run: null, game: null };

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
export const heroImageUrl = (id: string) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;

export function boot(user: WorldUser | null) {
  ctx.user = user;
  void loadSound()
    .then((m) => (ctx.sound = m))
    .catch(() => null);
}

export function showFirst() {
  if (LOCAL_MODE && DEV_FOES.length) return startTest(DEV_FOES, DEV_KIND);
  showTitle();
}

function showTitle() {
  stopGame();
  const sets: [string, string[], 'battle' | 'boss'][] = [
    ['여우 한 마리', ['fox'], 'battle'],
    ['도토리 셋', ['acorn', 'acorn', 'acorn'], 'battle'],
    ['스라소니 + 도토리', ['lynx', 'acorn'], 'battle'],
    ['보스 구미호', ['gumiho'], 'boss'],
    ['보스 장산범', ['jangsanbeom'], 'boss'],
    ['보스 왕지네', ['centipede'], 'boss'],
  ];
  app().innerHTML = `<div class="screen">
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="nick">${esc(ctx.user?.nickname ?? '테스트 대원')}</span></div>
    <div class="title"><h1>시아카드배틀</h1><p>십이지 영웅으로 카드 덱을 키우며 요괴를 물리쳐요</p></div>
    <div class="card hero-pick">
      <img src="${heroImageUrl('tiger')}" alt="" onerror="this.style.visibility='hidden'">
      <div><b>${heroDef('tiger').name}</b><p class="soft">체력 ${heroDef('tiger').hp} · ${heroDef('tiger').passive}</p></div>
    </div>
    <div class="card"><h3>연습 전투 (1단계)</h3><div class="btns">
      ${sets.map(([label], i) => `<button class="btn" data-set="${i}">${label}</button>`).join('')}
    </div></div>
  </div>`;
  app().querySelectorAll<HTMLButtonElement>('[data-set]').forEach((el) =>
    el.addEventListener('click', () => {
      sfx('click');
      const [, foes, kind] = sets[Number(el.dataset.set)];
      startTest(foes, kind);
    }),
  );
}

function startTest(foes: string[], kind: 'battle' | 'elite' | 'boss') {
  for (const f of foes) enemyDef(f);
  const run = newRun({ seed: DEV_SEED ?? (Date.now() >>> 0), hero: 'tiger' });
  if (LOCAL_MODE) run.relics.push(...DEV_RELICS);
  enterTestBattle(run, foes, kind);
  ctx.run = run;
  showBattle(() => showResult());
}

/** 전투 화면 (Phaser) — 끝나면 onDone */
export function showBattle(onDone: () => void) {
  app().innerHTML = '';
  stopGame();
  gameEl().classList.remove('hidden');
  const hooks: BattleHooks = {
    run: () => ctx.run!,
    send: (i) => (ctx.run ? apply(ctx.run, i) : null),
    done: () => onDone(),
    heroUrl: ctx.run ? heroImageUrl(ctx.run.hero) : null,
    sfx,
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
  if (LOCAL_MODE) (window as unknown as { __cardGame?: Phaser.Game; __cardRun?: () => RunState | null }).__cardGame = ctx.game;
  if (LOCAL_MODE) (window as unknown as { __cardRun?: () => RunState | null }).__cardRun = () => ctx.run;
}

function stopGame() {
  if (ctx.game) {
    ctx.game.destroy(true);
    ctx.game = null;
  }
  gameEl().classList.add('hidden');
}

function showResult() {
  const run = ctx.run!;
  const win = run.battle?.over === 'win';
  stopGame();
  app().innerHTML = `<div class="screen">
    <div class="grow"></div>
    <div class="card big-panel center">
      <h2 class="${win ? 'win' : 'lose'}">${win ? '승리!' : '쓰러졌어요…'}</h2>
      <p>남은 체력 ${run.hp} / ${run.maxHp} · ${run.battle?.turn ?? 0}턴</p>
      <button class="btn primary big" id="again">처음 화면 ▶</button>
    </div>
    <div class="grow"></div>
  </div>`;
  app().querySelector('#again')!.addEventListener('click', () => showTitle());
}
