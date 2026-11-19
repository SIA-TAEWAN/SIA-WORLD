import { SQUAD_SIZE, VIEW_W, type ZodiacId } from '../data/balance';
import { STARTERS, towerOf } from '../data/characters';
import type { RunSummary } from '../game/sim';
import { defaultProfile, type DefenseProfile, type FinishResult } from '../game/progress';
import type { DefenseApi } from '../net/api';
import { music } from './music';
import { sfx, sound } from './sfx';

export const app = document.getElementById('app')!;
export const stage = document.getElementById('stage')!;

/** 판을 시작할 때 넘기는 것 */
export interface GameSetup {
  stage: string;
  squad: ZodiacId[];
  /** 끝없는 모드인가 (stage 는 'endless') */
  endless?: boolean;
  /** 개발용: 같은 판 다시 보기 · 모든 캐릭터 레벨 · 모든 공통 강화 레벨 · 저장하지 않는 판 (잠금을 건너뛰고 시작한 판) */
  seed?: number;
  lv?: number;
  upg?: number;
  offline?: boolean;
}

/** 결과 화면에 넘기는 것 */
export interface GameResult extends RunSummary {
  /** 스스로 그만뒀나 */
  quit: boolean;
  setup: GameSetup;
  /**
   * 서버에 올린 결과: 받은 엽전·별·새로 열린 스테이지·해금.
   * 'unrecorded' 기록되지 않는 판(시작을 서버에 알리지 못함) · 'pending' 통신 실패로 기기에 보관함 · 'rejected' 서버가 받지 않음
   */
  saved: Promise<FinishResult | 'unrecorded' | 'pending' | 'rejected'>;
}

export const state = {
  /** 로그인한 사용자 (테스트 모드는 임시 사용자) */
  user: { id: '', name: '' },
  api: null as DefenseApi | null,
  /** 엽전·스테이지별 별·캐릭터 레벨·공통 강화·해금 */
  profile: defaultProfile() as DefenseProfile,
  /** 마지막으로 본 지역 · 고른 출전 캐릭터 */
  region: 1,
  squad: [...STARTERS] as ZodiacId[],
};

/** 진행 상황이 바뀌면 부를 함수들 (지금 떠 있는 화면이 엽전·별 표시를 다시 그린다) */
const profileWatchers = new Set<() => void>();
export function setProfile(p: DefenseProfile) {
  state.profile = p;
  for (const fn of [...profileWatchers]) fn();
}
/** 진행 상황이 바뀔 때마다 fn 을 부른다 → 그만 듣는 함수 (화면을 떠날 때 부른다) */
export function watchProfile(fn: () => void): () => void {
  profileWatchers.add(fn);
  return () => void profileWatchers.delete(fn);
}

/** 화면 이동 (모듈끼리 서로 import하지 않도록 여기에 등록) */
export const nav = {
  main: () => {},
  /** 지역 지도 (12지역) */
  regions: () => {},
  /** 그 지역의 스테이지 고르기 */
  stages: (_region: number) => {},
  /** 캐릭터 레벨업 · 공통 강화 */
  chars: () => {},
  /** 도감 */
  codex: () => {},
  /** 출전 준비: 캐릭터 5종 고르기 + 요괴 미리 보기 */
  prepare: (_stage: string) => {},
  game: (_setup: GameSetup) => {},
  result: (_result: GameResult) => {},
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 받침에 맞는 조사를 붙인다: josa('들판', '을', '를') → '들판을' */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  return word + (final ? withFinal : withoutFinal);
}

/** 서버(또는 기기 저장)가 거절한 까닭 → 화면 글 */
export function whyText(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (/not enough coins/.test(m)) return '엽전이 모자라요';
  if (/max level/.test(m)) return '이미 가장 높은 레벨이에요';
  if (/character locked/.test(m)) return '아직 함께할 수 없는 캐릭터예요';
  if (/stage locked/.test(m)) return '아직 열리지 않은 스테이지예요';
  if (/need login/.test(m)) return '로그인이 필요해요';
  return '서버에 연결하지 못했어요. 잠시 후 다시 해 주세요';
}

/** 초 → 0:00 */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 별 n개 (최대 3개 가운데): 딴 별은 노랗게, 못 딴 별은 빈 별 */
export const starsHtml = (n: number) => `<span class="stars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;

let cleanupScreen: (() => void) | null = null;

/** 화면 바꾸기 */
export function screen(html: string, cls: string, cleanup?: () => void): HTMLElement {
  cleanupScreen?.();
  cleanupScreen = cleanup ?? null;
  // 판 밖의 화면에서는 메인 곡 (판 안에서는 gameView 가 배경·보스 곡을 고른다)
  music.play(cls.split(' ')[0] === 'game' ? null : 'main');
  // 앞 화면에서 띄운 창(일시정지·설정)이 새 화면 위에 남지 않게
  stage.querySelectorAll('.dim').forEach((d) => d.remove());
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
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

// ---------- 마지막으로 고른 출전 캐릭터 (기기에 기억) ----------
const squadKey = () => `siadefense:squad:${state.user.id}`;
export function loadSquad(): ZodiacId[] {
  try {
    const v = JSON.parse(localStorage.getItem(squadKey()) ?? 'null') as unknown;
    if (Array.isArray(v)) {
      const list = v.filter((c): c is ZodiacId => typeof c === 'string' && !!towerOf(c) && state.profile.unlocked.includes(c as ZodiacId)).slice(0, SQUAD_SIZE);
      if (list.length) return [...new Set(list)];
    }
  } catch {
    /* 기본값 */
  }
  return [...STARTERS];
}
export function saveSquad(list: ZodiacId[]) {
  state.squad = list;
  try {
    localStorage.setItem(squadKey(), JSON.stringify(list));
  } catch {
    /* 무시 */
  }
}

// ---------- 소리 켜기/끄기: 오른쪽 아래 원형 버튼 (DESIGN.md 5장, 다른 게임과 같은 위치·같은 설정) ----------
export function soundButton(): HTMLButtonElement {
  music.refresh();
  const b = document.createElement('button');
  b.className = 'icon-btn sound-btn';
  const paint = () => {
    b.textContent = sound.on ? '🔊' : '🔇';
    b.setAttribute('aria-label', sound.on ? '소리 끄기' : '소리 켜기');
  };
  paint();
  b.addEventListener('click', () => {
    sound.set(!sound.on);
    paint();
    sfx('toggle');
  });
  // 공용 소리 모듈을 받기 전에 그려졌을 수 있다: 조금 뒤에 한 번 더 맞춘다
  setTimeout(paint, 600);
  return b;
}

/** 게임 엔진(Phaser)과 게임 화면을 미리 받아 둔다 */
let enginePromise: Promise<typeof import('./gameView')> | null = null;
export function loadEngine() {
  enginePromise ??= import('./gameView');
  enginePromise.catch(() => (enginePromise = null));
  return enginePromise;
}
