import { VIEW_W, CHAR_IDS, type RunMode, type CharId } from '../data/balance';
import type { RunSummary } from '../game/sim';
import { characterOpen, defaultProfile, type FinishResult, type SurvivalProfile } from '../game/progress';
import type { SurvivalApi } from '../net/api';
import { loadOwned, loadProgress, type CatProgress } from '../net/characters';
import { CHARACTER_BY_ID } from '../data/characters';
import type { SurvivalLobby } from '../net/lobby';
import { music, type TrackName } from './music';
import { sfx, sound } from './sfx';

export const app = document.getElementById('app')!;
export const stage = document.getElementById('stage')!;

/** 판을 시작할 때 넘기는 것 */
export interface GameSetup {
  char: CharId;
  map: string;
  /** 모드 (없으면 4분 모드) */
  mode?: RunMode;
  /** 개발용: 강화 레벨 수(0~49)·시작 시각(초)·시드 */
  upg?: number;
  startAt?: number;
  seed?: number;
  /** 오늘의 도전 판이면 그 날짜 'YYYY-MM-DD' (맵·캐릭터·시드·강화 단계는 game/daily.ts 가 날짜에서 만든 값) */
  daily?: string;
}

/** 결과 화면에 넘기는 것 */
export interface GameResult extends RunSummary {
  /** 스스로 그만뒀나 */
  quit: boolean;
  setup: GameSetup;
  /** 판이 끝난 순간에 이 맵의 무한 모드·헬 모드가 이미 열려 있었나 (이 판으로 처음 열렸을 때 결과 화면이 알려 준다. 둘은 같은 조건으로 열린다) */
  endlessWasOpen: boolean;
  /**
   * 서버에 올린 결과: 받은 엽전·새 기록·새로 해금된 것.
   * 'unrecorded' 기록되지 않는 판(시작을 서버에 알리지 못함) · 'pending' 통신 실패로 기기에 보관함 · 'rejected' 서버가 받지 않음
   */
  saved: Promise<FinishResult | 'unrecorded' | 'pending' | 'rejected'>;
}

export const state = {
  /** 로그인한 사용자 (테스트 모드는 임시 사용자) */
  user: { id: '', name: '' },
  api: null as SurvivalApi | null,
  /** 엽전·영구 강화·해금·도감 (서버에 저장. 테스트 모드는 이 기기에) */
  profile: defaultProfile() as SurvivalProfile,
  /** 접속 인원 채널 */
  lobby: null as SurvivalLobby | null,
  /** 마지막으로 고른 캐릭터·맵·모드 */
  char: 'tiger' as CharId,
  map: 'field',
  mode: 'normal' as RunMode,
  /** 이 게임에서 연 추가 캐릭터 (시아코인으로 연 고양이 등. refreshOwned 가 채운다) */
  owned: [] as string[],
  /** 고양이 구매 조건 진행 (서버 character_progress. 못 읽었으면 null: 화면은 프로필의 clearedMaps 로 대신 센다) */
  catProgress: null as CatProgress | null,
};

/** 프로필이 바뀌면 부를 함수들 (지금 떠 있는 화면이 엽전·해금 표시를 다시 그린다) */
const profileWatchers = new Set<() => void>();
/** 서버가 준 새 프로필을 넣는다. 판 저장 답이 화면이 바뀐 뒤에 와도, 그때 떠 있는 화면이 새 값으로 다시 그려진다 */
export function setProfile(p: SurvivalProfile) {
  state.profile = p;
  for (const fn of [...profileWatchers]) fn();
}
/** 프로필이 바뀔 때마다 fn 을 부른다 → 그만 듣는 함수 (화면을 떠날 때 부른다) */
export function watchProfile(fn: () => void): () => void {
  profileWatchers.add(fn);
  return () => void profileWatchers.delete(fn);
}

/**
 * 이 게임에서 연 추가 캐릭터를 다시 읽고, 떠 있는 화면(선택 화면·도감)을 다시 그린다.
 * 서버를 못 읽으면(null) 가진 목록을 그대로 둔다 (처음이면 빈 목록 = 잠긴 것으로 시작. 서버도 판 시작 때 다시 검사한다).
 * 마지막으로 고른 캐릭터가 잠긴 고양이면 기본 캐릭터로
 */
export async function refreshOwned(force: boolean) {
  const owned = await loadOwned(force);
  if (owned) {
    const changed = owned.join() !== state.owned.join();
    state.owned = owned;
    if (changed) setProfile(state.profile);
  }
  if (CHARACTER_BY_ID[state.char].unlock.kind === 'sia' && !characterOpen(state.profile, state.char, state.owned)) state.char = 'tiger';
}

/** 고양이 구매 조건 진행을 다시 읽고 떠 있는 화면을 다시 그린다 (못 읽으면 가진 값 그대로) */
export async function refreshProgress() {
  const p = await loadProgress();
  if (!p) return;
  const changed = !state.catProgress || p.have !== state.catProgress.have || p.need !== state.catProgress.need;
  state.catProgress = p;
  if (changed) setProfile(state.profile);
}

/** 화면 이동 (모듈끼리 서로 import하지 않도록 여기에 등록) */
export const nav = {
  main: () => {},
  /** 출전 준비: 캐릭터 고르기 → 맵 고르기 */
  select: () => {},
  maps: () => {},
  /** 영구 강화 */
  upgrade: () => {},
  /** 도감 */
  codex: () => {},
  /** 오늘의 도전 */
  daily: () => {},
  game: (_setup: GameSetup) => {},
  result: (_result: GameResult) => {},
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 초 → 0:00 */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

let cleanupScreen: (() => void) | null = null;

/** 화면 바꾸기. bgm: 이 화면의 배경음 */
export function screen(html: string, cls: string, bgm: TrackName | null, cleanup?: () => void): HTMLElement {
  cleanupScreen?.();
  cleanupScreen = cleanup ?? null;
  // 앞 화면에서 띄운 창(일시정지·설정)이 새 화면 위에 남지 않게
  stage.querySelectorAll('.dim').forEach((d) => d.remove());
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

// ---------- 화면 단위: 기준 화면(가로 720)의 1px이 실제 몇 px인가 → CSS 변수 --u ----------
function fitUnit() {
  stage.style.setProperty('--u', `${stage.clientWidth / VIEW_W}px`);
}
fitUnit();
new ResizeObserver(fitUnit).observe(stage);

// ---------- 마지막으로 고른 캐릭터 (SIA WORLD 공용 저장 위치: shared/zodiac.js 와 같은 열쇠) ----------
const charKey = () => `sia-world:avatar:${state.user.id}`;
export function loadChar(): CharId {
  try {
    const v = localStorage.getItem(charKey()) as CharId | null;
    if (v && CHAR_IDS.includes(v)) return v;
  } catch {
    /* 기본값 */
  }
  return 'tiger';
}
export function saveChar(c: CharId) {
  state.char = c;
  try {
    localStorage.setItem(charKey(), c);
  } catch {
    /* 무시 */
  }
}

// ---------- 피해 숫자 보이기 (PRD 12장: 설정에서 끌 수 있다) ----------
const NUM_KEY = 'siasurvival:numbers';
let numbersOn = true;
try {
  numbersOn = localStorage.getItem(NUM_KEY) !== '0';
} catch {
  /* 기본값 */
}
export const showNumbers = () => numbersOn;
function setNumbers(on: boolean) {
  numbersOn = on;
  try {
    localStorage.setItem(NUM_KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}

// ---------- 설정: 배경음·효과음·피해 숫자를 따로 켜고 끈다 ----------
export function openSettings(onClose?: () => void) {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  const seg = (k: string, on: boolean) =>
    `<div class="seg" data-k="${k}"><button data-v="1" class="${on ? 'sel' : ''}">켜기</button><button data-v="0" class="${on ? '' : 'sel'}">끄기</button></div>`;
  const paint = () => {
    dim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="설정">
      <h3>⚙️ 설정</h3>
      <div class="row"><span>🎵 배경음</span>${seg('bgm', sound.bgmOn)}</div>
      <div class="row"><span>🔊 효과음</span>${seg('sfx', sound.sfxOn)}</div>
      <div class="row"><span>💥 피해 숫자</span>${seg('num', numbersOn)}</div>
      <div class="actions"><button class="btn primary" data-close>닫기</button></div>
    </div>`;
  };
  paint();
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) {
      sfx('click');
      dim.remove();
      onClose?.();
      return;
    }
    const b = el.closest('.seg button') as HTMLElement | null;
    if (!b) return;
    const on = b.dataset.v === '1';
    const k = (b.parentElement as HTMLElement).dataset.k;
    if (k === 'bgm') {
      sound.setBgm(on);
      music.refresh();
    } else if (k === 'sfx') sound.setSfx(on);
    else setNumbers(on);
    paint();
  });
  stage.append(dim);
}

/** 게임 엔진(Phaser)과 게임 화면을 미리 받아 둔다 */
let enginePromise: Promise<typeof import('./gameView')> | null = null;
export function loadEngine() {
  enginePromise ??= import('./gameView');
  enginePromise.catch(() => (enginePromise = null));
  return enginePromise;
}
