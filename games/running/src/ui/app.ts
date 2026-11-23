import { isCharId, type ZodiacId } from '../game/constants';
import type { RankedEntry } from '../game/ranking';
import type { RaceApi } from '../net/api';
import type { RaceLobby } from '../net/lobby';
import type { RaceRoom, StartMsg } from '../net/room';
import type { RaceGame } from '../race/game';
import { music, type TrackName } from './music';
import { sfx, sound } from './sfx';

export const app = document.getElementById('app')!;
export const stage = document.getElementById('stage')!;

export const state = {
  /** 로그인한 사용자 (테스트 모드는 탭마다 다른 임시 사용자) */
  user: { id: '', name: '' },
  api: null as RaceApi | null,
  room: null as RaceRoom | null,
  /** 대기실 채널 (방 목록) */
  lobby: null as RaceLobby | null,
  /** 마지막으로 고른 캐릭터 */
  char: 'tiger' as ZodiacId,
  /** 내 최고 기록 (ms) */
  best: null as number | null,
};

/** 화면 이동 (모듈끼리 서로 import하지 않도록 여기에 등록) */
export const nav = {
  lobby: () => {},
  room: (_code: string) => {},
  /** 방에 있는 채로 대기실 화면으로 */
  waiting: () => {},
  race: (_start: StartMsg) => {},
  result: (_race: RaceGame, _results: RankedEntry[]) => {},
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let cleanupScreen: (() => void) | null = null;

/** 화면 바꾸기. bgm: 이 화면의 배경음 */
export function screen(html: string, cls: string, bgm: TrackName | null, cleanup?: () => void): HTMLElement {
  cleanupScreen?.();
  cleanupScreen = cleanup ?? null;
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  music.play(bgm);
  return app.firstElementChild as HTMLElement;
}

export function toast(msg: string, ms = 2200) {
  stage.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  stage.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- 마지막으로 고른 캐릭터 (SIA WORLD 공용 저장 위치: shared/zodiac.js 와 같은 열쇠) ----------
const charKey = () => `sia-world:avatar:${state.user.id}`;
export function loadChar(): ZodiacId {
  try {
    const v = localStorage.getItem(charKey()) as ZodiacId | null;
    if (isCharId(v)) return v;
  } catch {
    /* 기본값 */
  }
  return 'tiger';
}
export function saveChar(c: ZodiacId) {
  state.char = c;
  try {
    localStorage.setItem(charKey(), c);
  } catch {
    /* 무시 */
  }
}

// ---------- 설정: 배경음·효과음을 따로 켜고 끈다 ----------
export function openSettings() {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  const paint = () => {
    dim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="설정">
      <h3>⚙️ 설정</h3>
      <div class="row"><span>🎵 배경음</span><div class="seg" data-k="bgm"><button data-v="1" class="${sound.bgmOn ? 'sel' : ''}">켜기</button><button data-v="0" class="${sound.bgmOn ? '' : 'sel'}">끄기</button></div></div>
      <div class="row"><span>🔊 효과음</span><div class="seg" data-k="sfx"><button data-v="1" class="${sound.sfxOn ? 'sel' : ''}">켜기</button><button data-v="0" class="${sound.sfxOn ? '' : 'sel'}">끄기</button></div></div>
      <div class="actions"><button class="btn primary" data-close>닫기</button></div>
    </div>`;
  };
  paint();
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) {
      sfx('click');
      dim.remove();
      return;
    }
    const b = el.closest('.seg button') as HTMLElement | null;
    if (!b) return;
    const on = b.dataset.v === '1';
    if ((b.parentElement as HTMLElement).dataset.k === 'bgm') {
      sound.setBgm(on);
      music.refresh();
    } else sound.setSfx(on);
    paint();
  });
  stage.append(dim);
}

/** 지금 방에서 나온다 (대기실 방 목록에서도 빠진다) */
export function leaveRoom() {
  void state.room?.leave();
  state.room = null;
  state.lobby?.setRoom(null);
}

/** 주소의 ?room=코드 를 바꾼다 (새로 고침·공유해도 같은 방) */
export function setRoomInUrl(code: string | null) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code);
  else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

/** 친구에게 보낼 방 주소 */
export function roomLink(code: string): string {
  const u = new URL(location.href);
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

/** 게임 엔진(Phaser)과 경주 화면을 미리 받아 둔다 */
let enginePromise: Promise<typeof import('./raceView')> | null = null;
export function loadEngine() {
  enginePromise ??= import('./raceView');
  enginePromise.catch(() => (enginePromise = null));
  return enginePromise;
}
