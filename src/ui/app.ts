import Phaser from 'phaser';
import { GameScene, type GameConfig } from '../scenes/GameScene';
import { TANK_IDS, type ItemId, type TankId } from '../game/data';
import type { MapId } from '../data/maps';
import type { Difficulty } from '../game/types';
import { load } from './storage';

export type Opponent = Difficulty | 'local';

export const app = document.getElementById('app')!;
const gameEl = document.getElementById('game')!;
const hudEl = document.getElementById('hud-layer')!;
export const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const saved = load();
export const state = {
  name: saved.name ?? '',
  tank: (TANK_IDS.includes(saved.tank as TankId) ? saved.tank : 'bolt') as TankId,
  oppTank: 'random' as TankId | 'random',
  opponent: (['easy', 'normal', 'hard', 'local'].includes(saved.opponent ?? '') ? saved.opponent : 'normal') as Opponent,
  map: ((saved.map as MapId | 'random') ?? 'valley') as MapId | 'random',
  /** 플레이어별 산 아이템 (매 판 초기화) */
  shop: [[], []] as ItemId[][],
  shopFor: 0,
  name2: '2P',
};

/** 화면 이동 (모듈끼리 서로 import하지 않도록 여기에 등록) */
export const nav = {
  entry: () => {},
  setup: () => {},
  lobby: () => {},
};

let cleanupScreen: (() => void) | null = null;

export function screen(html: string, cls: string, cleanup?: () => void) {
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

let game: Phaser.Game | null = null;

export function launchGame(cfg: Omit<GameConfig, 'touch' | 'hudParent'>) {
  cleanupScreen?.();
  cleanupScreen = null;
  app.classList.add('hidden');
  app.innerHTML = '';
  gameEl.classList.remove('hidden');
  hudEl.classList.remove('hidden');
  game?.destroy(true);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameEl,
    transparent: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true, roundPixels: false },
    input: { keyboard: false },
    banner: false,
  });
  game.scene.add('game', GameScene, true, { ...cfg, touch, hudParent: hudEl });
}

export function closeGame() {
  game?.destroy(true);
  game = null;
  hudEl.innerHTML = '';
  gameEl.classList.add('hidden');
  hudEl.classList.add('hidden');
}
