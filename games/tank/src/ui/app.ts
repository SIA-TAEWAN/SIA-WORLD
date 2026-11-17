import type { GameConfig } from '../scenes/GameScene';
import { TANK_IDS, type ItemId, type TankChoice, type TankId } from '../game/data';
import type { MapId } from '../data/maps';
import type { Difficulty } from '../game/types';
import { load } from './storage';
import { music } from './music';
import { sfx } from './sfx';

export type Opponent = Difficulty | 'local';

export const app = document.getElementById('app')!;
const gameEl = document.getElementById('game')!;
const hudEl = document.getElementById('hud-layer')!;
export const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const saved = load();
export const state = {
  name: saved.name ?? '',
  /** 로그인 토큰 (온라인) */
  token: saved.token ?? '',
  tank: (TANK_IDS.includes(saved.tank as TankId) || saved.tank === 'random' ? saved.tank : 'tiger') as TankChoice,
  oppTank: 'random' as TankId | 'random',
  opponent: (['easy', 'normal', 'hard', 'local'].includes(saved.opponent ?? '') ? saved.opponent : 'normal') as Opponent,
  map: ((saved.map as MapId | 'random') ?? 'valley') as MapId | 'random',
  /** 플레이어별 산 아이템 (매 판 초기화) */
  shop: [[], []] as ItemId[][],
  shopFor: 0,
  name2: '2P',
  /** 내 ID의 포인트 (온라인에서 이기면 +100, 지면 -100, 최저 1000) */
  points: 1000,
  /** 게임 속도·바람 빠르기 (AI 1:1) */
  speed: 1.5,
  wind: 'slow' as 'slow' | 'normal' | 'fast',
  /** 게임 모드 (초보: 내 탄이 적 쪽으로 휜다) */
  mode: 'normal' as 'easy' | 'normal',
};

/** 화면 이동 (모듈끼리 서로 import하지 않도록 여기에 등록) */
export const nav = {
  entry: () => {},
  setup: () => {},
  lobby: () => {},
};

let cleanupScreen: (() => void) | null = null;

// 메뉴 화면용 소리 버튼 (게임 중에는 HUD의 버튼을 쓴다)
const soundBtn = document.createElement('button');
soundBtn.className = 'sound-fab';
const paintSound = () => {
  soundBtn.textContent = sfx.muted ? '🔇' : '🔊';
  soundBtn.title = sfx.muted ? '소리 켜기' : '소리 끄기';
};
paintSound();
soundBtn.onclick = () => sfx.toggleMute();
sfx.onMute(paintSound);
document.body.append(soundBtn);

export function screen(html: string, cls: string, cleanup?: () => void) {
  document.body.classList.remove('in-game');
  music.play('menu');
  cleanupScreen?.();
  cleanupScreen = cleanup ?? null;
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  app.classList.remove('hidden');
  return app.firstElementChild as HTMLElement;
}

export function setScreenCleanup(fn: (() => void) | null) {
  cleanupScreen = fn;
}

export function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'page-toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, s: string) => root.querySelector<T>(s)!;

type PhaserGame = import('phaser').Game;
let game: PhaserGame | null = null;
/** 게임 엔진(Phaser)은 처음 화면에 필요 없으므로 따로 불러온다 */
let engine: Promise<[typeof import('phaser'), typeof import('../scenes/GameScene')]> | null = null;
let launchToken = 0;

export function loadEngine() {
  engine ??= Promise.all([import('phaser'), import('../scenes/GameScene')]);
  engine.catch(() => (engine = null));
  return engine;
}

/** 첫 화면이 뜬 뒤 쉬는 시간에 미리 받아 둔다 */
export function prefetchEngine() {
  const go = () => void loadEngine().catch(() => undefined);
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 1200);
}

export function launchGame(cfg: Omit<GameConfig, 'touch' | 'hudParent'>) {
  cleanupScreen?.();
  cleanupScreen = null;
  const token = ++launchToken;
  app.innerHTML = '<div class="screen center"><div class="connecting"><div class="spinner"></div>게임을 불러오는 중…</div></div>';
  app.classList.remove('hidden');
  loadEngine().then(
    ([PhaserMod, { GameScene }]) => {
      if (token !== launchToken) return;
      const Phaser = ((PhaserMod as unknown as { default?: typeof PhaserMod }).default ?? PhaserMod) as typeof PhaserMod;
      app.classList.add('hidden');
      app.innerHTML = '';
      document.body.classList.add('in-game');
      music.play('battle');
      gameEl.classList.remove('hidden');
      hudEl.classList.remove('hidden');
      game?.destroy(true);
      const g = new Phaser.Game({
        type: Phaser.AUTO,
        parent: gameEl,
        transparent: true,
        scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
        render: { antialias: true, roundPixels: false },
        input: { keyboard: false },
        banner: false,
      });
      g.scene.add('game', GameScene, true, { ...cfg, touch, hudParent: hudEl });
      game = g;
    },
    () => {
      if (token !== launchToken) return;
      app.innerHTML = '<div class="screen center"><div class="connecting">게임을 불러오지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/><button class="btn primary" id="reload">새로고침</button></div></div>';
      app.querySelector('#reload')?.addEventListener('click', () => location.reload());
    },
  );
}

export function closeGame() {
  launchToken++;
  game?.destroy(true);
  game = null;
  hudEl.innerHTML = '';
  gameEl.classList.add('hidden');
  hudEl.classList.add('hidden');
}
