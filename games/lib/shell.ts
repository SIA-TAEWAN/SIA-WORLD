/**
 * 맞고 · 포커 · 블랙잭 공용 화면 틀.
 *   로그인 확인 → 방 목록(만들기/입장) → 방 화면(자리 · 레디 · 게임 테이블 · 조작 · 결과 · 컷인)
 * 게임마다 다른 부분(테이블 그림, 조작 버튼, 결과 요약, 컷인 문구)은 GameUI로 받는다.
 */
import type PhaserNS from 'phaser';
import './style.css';
import { setTheme } from './cards.ts';
import {
  linkThemeCss,
  world,
  worldHome,
  worldRoot,
  type GameId,
  type PrivateRow,
  type RoomModule,
  type RoomRow,
  type SeatRow,
  type StateRow,
  type Wallet,
  type WalletModule,
  type WorldUser,
  type ZodiacModule, type PresenceHandle } from './world.ts';
import { isRulesChanged, type LocalHost, type LocalPlay } from './solo-play.ts';
import { EMOTES, EMOTE_GAP_MS, EMOTE_SHOW_MS, emoteReady, emoteSpread, parseEmote } from './emote.ts';

export interface GameEventLite {
  id: number;
  t: string;
  seat?: number;
  [k: string]: unknown;
}

export interface TableCtx<P = any, Q = any> {
  scene: PhaserNS.Scene;
  Phaser: typeof PhaserNS;
  room: RoomRow;
  seats: SeatRow[];
  me: WorldUser;
  /** 내 자리 (관전 중이면 null) */
  mySeat: number | null;
  /** 지금 보이는 판에서 내가 앉았던 자리 (결과 화면용, 그 판에 없었으면 null) */
  resultSeat: number | null;
  pub: P | null;
  priv: Q | null;
  /**
   * 이번 판의 내 패(비공개 상태)가 아직 안 왔다 (공개 상태가 먼저 도착한 잠깐 동안).
   * 이때 내 카드를 뒷면으로 먼저 그리면, 패가 온 뒤 다시 받거나 얇게 뒤집히는 연출이 한 번 더 나온다 → 올 때까지 내 카드를 그리지 않는다.
   */
  privWait: boolean;
  /**
   * 연출 재생 중에 먼저 도착해 미뤄 둔 이번 판의 내 패 (없으면 null). 한 동작씩 보여 주는 게임(rewind)이 중간 화면에서
   * 내 카드를 맞게 그릴 때 쓴다. 지금 화면보다 앞선 내용일 수 있으니 공개 상태에 맞는 만큼만 그려야 한다
   */
  privNext: Q | null;
  /**
   * 연출 재생 중이면 재생해 가는 새 공개 상태 (한 동작씩 보여 주는 중간 화면에서는 pub 이 되돌린 상태라 결과가 비어 있다).
   * 재생 중이 아니면 pub 과 같다. 사건 하나가 무엇이었는지 판 결과(누가 진짜 이겼나)로 가를 때 쓴다
   */
  pubNext: P | null;
  pending: number[];
  /** 내가 지금 조작할 수 있다: 내 차례이고 앞선 연출(카드·칩·말풍선)이 다 끝났다. 조작 버튼은 이 값으로 켠다 */
  myTurn: boolean;
  /** 서버로 행동 보내기 (실패하면 알림) → 서버가 받았으면 true */
  act(payload: unknown): Promise<boolean>;
  busy: boolean;
  fmt(n: number): string;
  /** 지금 아는 내 지갑 잔액 (이 방 화폐, 아직 못 읽었으면 null). 결과 직후에는 잠깐 낡았을 수 있다 */
  money(): number | null;
  avatarUrl(id: string): string;
  seatName(seat: number): string;
  seatAvatar(seat: number): string;
  /** 다시 그리기 요청 (테이블 + 아래 버튼) */
  redraw(): void;
  /** 테이블만 다시 그리기 (아래 버튼은 그대로: 누르던 버튼·포커스가 끊기지 않게) */
  redrawTable(): void;
  /**
   * 연출 기준점 등록 (그릴 때마다): 'pot', 'dealer', 'seat:<번호>' 등 → 말풍선·칩 이동 위치.
   * 'seat:<번호>' 는 한마디(이모티콘) 말풍선 자리로도 쓴다 (그 점 위에 뜬다). 화면 위쪽에 붙은 자리라 위에 띄울 틈이 없으면
   * 'seat-below:<번호>' 를 등록한다 (그 점 아래에 뜬다). 둘 다 없으면 자리 줄의 그 사람 칸 아래에 뜬다
   */
  anchor(name: string, x: number, y: number): void;
  /** 효과음 (shared/sound.js) */
  sound(name: SoundName, opts?: { delay?: number; volume?: number; rate?: number }): void;
  /**
   * 카드 나눠 주기 연출: 이번 판에 처음 보는 자리(key)의 카드는 from에서 날아오고,
   * 같은 자리인데 면(face)이 바뀌면(뒷면 → 앞면) 뒤집는다. 이미 본 카드는 그대로 둔다.
   */
  deal(obj: PhaserNS.GameObjects.Container, key: string, face: string | null, from: { x: number; y: number }): number;
  /**
   * 카드 이동 연출: 같은 key(카드 id)가 지난번과 다른 자리에 그려지면 그 사이를 날아간다.
   * 처음 보는 카드는 from이 있으면 거기서 날아온다. order가 클수록 늦게 (낸 패 0 → 뒤집은 패 1 → 가져가기 2)
   */
  track(obj: PhaserNS.GameObjects.Container, key: string, opts?: TrackOpts): void;
  /** 이번 그림 직전에 그 카드가 있던 자리 (처음 보는 카드면 null) */
  lastPos(key: string): { x: number; y: number } | null;
  /** 기기 픽셀 배율 (효과용 글자를 선명하게) */
  dpr: number;
  /** 지금 떠 있거나 곧 뜰 컷인이 모두 끝날 때까지 남은 시간 (ms, 없으면 0 이하) */
  cutinLeft(): number;
}

interface MoveRec {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  via: { x: number; y: number } | null;
  s1: number;
  s2: number;
  flip: boolean;
  scale0: number;
  viaScale: number;
  /** 첫 구간(출발 → 목표 또는 경유점)에 걸리는 시간 (ms) */
  dur: number;
}

export interface TrackOpts {
  /** 처음 보는 카드가 날아올 출발점 */
  from?: { x: number; y: number };
  /** 순서 (클수록 늦게: 낸 패 0 → 뒤집은 패 1 → 가져가기 2) */
  order?: number;
  /** 추가로 늦출 시간(ms): 판 시작 때 한 장씩 나눠 주기 */
  delay?: number;
  /** 출발할 때 크기 배율 (손패 크기에서 바닥 크기로 자연스럽게) */
  fromScale?: number;
  /** 출발할 때 소리 (예: 'deal', 'flip') */
  sound?: SoundName;
  /** 먹는 패: 먼저 이 자리(바닥)에 내려앉았다가 '가져가기' 차례에 목표로 */
  via?: { x: number; y: number };
  /** 경유점에서 떠나는 시각 (지금부터 ms, 기본: 가져가기 차례) */
  viaLeave?: number;
  /** 경유점에서의 크기 배율 (바닥 패 크기 ÷ 목표 크기) */
  viaScale?: number;
  /** 뒤집으며 출발 (더미에서 뒤집은 패) */
  flip?: boolean;
  /** 첫 구간(출발 → 목표 또는 경유점)에 걸리는 시간 (ms, 기본 560). 내가 낸 패처럼 빨리 내려앉아야 하는 카드에 쓴다 */
  dur?: number;
  /** 움직이는 동안 다른 움직이는 카드보다 얼마나 위에 그릴지 (0~1 사이 작은 값: 늦게 내려앉는 카드일수록 크게) */
  over?: number;
  /** 날아가서 내려앉는 순간 한 번 (찰싹 효과 등). 경유점이 있으면 경유점에 내려앉을 때 */
  onLand?: () => void;
  /** 카드의 제자리 (deal을 먼저 부른 뒤 track을 부를 때: deal 전에 잰 자리를 넘긴다. 없으면 지금 obj 자리) */
  at?: { x: number; y: number };
  /** 자리만 기록하고 움직이지 않는다 (아직 나눠 주는 중인 카드: 받기 연출과 겹치지 않게) */
  still?: boolean;
  /** 겹치는 순서를 고정 (없으면 움직이는 동안 11, 멈추면 10). 그린 순서대로 겹쳐야 하는 패(블랙잭 핸드)는 0 */
  depth?: number;
}

/** 효과음 이름 (shared/sound.js의 SOUNDS) */
export type SoundName = string;

/** 연출 재생 한 걸음: 말풍선 · 칩 이동 · 소리 */
export interface ReplayStep {
  /** 말풍선 글자 (seat 자리 위, 없으면 안 띄움) */
  text?: string;
  /** 말풍선을 띄울 곳 (자리 번호 또는 anchor 이름) */
  at?: number | string;
  /** 칩 이동: from → to (anchor 이름 'pot' · 'dealer' 또는 자리 번호), 금액은 칩 개수 정할 때만 */
  chips?: { from: number | string; to: number | string; amount: number };
  sound?: SoundName;
  /** 다음 걸음까지 (ms). 없으면 AI 0.8초, 사람 0.35초 */
  gap?: number;
  /** 새 상태(카드)를 그리고 카드 연출이 끝난 뒤에 보여 줄 걸음 (승패·정산·버스트 등: 결과가 카드보다 먼저 보이지 않게) */
  after?: boolean;
}

export interface GameUI<P = any, Q = any> {
  game: GameId;
  title: string;
  icon: string;
  /** 방 목록에서 '← 뒤로' 갈 곳 (SIA WORLD 최상위 기준 상대 경로) */
  back: string;
  backLabel: string;
  /** Phaser 바탕색 (테마에서) */
  felt: () => number;
  /** Phaser 테이블 그리기 (매번 지우고 새로 그린다) */
  draw(t: TableCtx<P, Q>): void;
  /** 게임 중 조작 버튼 (el을 채운다) */
  controls(t: TableCtx<P, Q>, el: HTMLElement): void;
  /** 판 결과 요약 HTML (pub.result가 있을 때) */
  resultHtml(t: TableCtx<P, Q>): string;
  /** 컷인 문구 (없으면 null) */
  cutin?(ev: GameEventLite, t: TableCtx<P, Q>): string | null;
  /**
   * 그 컷인을 지금부터 몇 ms 뒤에 띄울지 (그 사건의 연출이 보이는 순간). null·없으면 진행 중인 카드 연출이 모두 끝난 뒤.
   * 한 번에 여러 차례가 들어온 상태에서 내 차례의 컷인이 상대 차례 연출 뒤에 뜨지 않게 한다 (맞고).
   */
  cutinDelay?(ev: GameEventLite, t: TableCtx<P, Q>): number | null;
  /**
   * 참이면 그 사건의 컷인을 그 사건의 화면(카드 연출)이 끝난 바로 뒤에 띄우고, 컷인이 다 보인 뒤에 다음 걸음으로 넘어간다.
   * (블랙잭: '딜러 블랙잭' 이펙트가 끝난 뒤에 칩 지급·회수. 없으면 컷인은 새 상태를 다 그린 뒤 맨 끝에 뜬다)
   */
  cutinHold?(ev: GameEventLite, t: TableCtx<P, Q>): boolean;
  /**
   * 판 정리 연출 (결과 창을 닫은 뒤): 카드를 더미로 모으는 등 게임에 맞게 테이블을 치우고, 걸리는 시간(ms)을 돌려준다.
   * 연출이 끝나면 테이블을 비우고 그제서야 레디 버튼을 켠다. 없으면 예전처럼 결과 창을 닫자마자 레디.
   */
  cleanup?(t: TableCtx<P, Q>): number;
  /** 판 도중에도 지갑이 바뀌는 게임 (룰렛: 확정 때 빠지고 결과 때 들어온다) → 상태가 올 때마다 금액을 다시 읽는다 */
  liveWallet?: boolean | ((pub: any) => number);
  /** AI가 없는 게임 (룰렛): 빈자리는 자리 줄·방 목록에 보이지 않는다 */
  noAi?: boolean;
  /** false면 조작부 높이를 고정하지 않는다 (룰렛: 조작부가 베팅판이라 화면마다 크기가 다르다). 기본은 고정 */
  stableControls?: boolean;
  /** 조작부를 처음에 잡아 둘 높이(px, 화면 너비를 받는다). 없으면 기본값 (휴대폰 210 · PC 150, 화면 높이의 1/4까지) */
  controlsMin?(w: number): number;
  /** 카드를 한 장씩 나눠 줄 때 간격(ms). 기본 110 */
  dealGap?: number;
  /**
   * 사건 하나를 연출 한 걸음으로 (말풍선·칩·소리). 서버가 여러 행동을 한꺼번에 보내도 화면은 이 걸음들을 차례로 보여 준 뒤
   * 새 상태를 그린다. null이면 그 사건은 건너뛴다.
   */
  replay?(ev: GameEventLite, t: TableCtx<P, Q>): ReplayStep | null;
  /**
   * 한 동작씩 보여 주기: 새 상태(next)에서 새 사건들(events)을 뒤에서부터 하나씩 되돌린 중간 상태들.
   * out[i] = events[i]가 일어나기 직전의 화면 (길이는 events와 같다). 화면은 out[0] → … → next 순서로 하나씩 그리고,
   * 그릴 때마다 카드 연출이 끝나기를 기다린다. 되돌릴 수 없으면 예외를 던지거나 null (그러면 말풍선 → 새 상태 순서로 보여 준다)
   */
  rewind?(next: P, events: GameEventLite[]): P[] | null;
  /** 방 화면 전체에 붙일 클래스 (예: 룰렛 '베팅 중' / '구경 중' → 휴대폰 배치를 바꾼다) */
  pageClass?(t: TableCtx<P, Q>): string;
  /** 대기방 '게임 방법' 창 내용 (HTML). 없으면 버튼을 숨긴다 */
  manual?: string;
  /** Phaser에 미리 불러올 그림 (key → url) */
  preload?(scene: PhaserNS.Scene, avatarUrl: (id: string) => string): void;
  /**
   * 기기에서 진행하는 판 (혼자 하는 맞고: lib/solo-play.ts). 있으면 셸이 방에 들어갈 때 만들어, 내 행동을 먼저 여기에 묻고
   * (기기에서 처리했으면 서버로 보내지 않는다) 서버에서 온 상태도 먼저 여기를 거친다 (기기 진행보다 낡은 것은 버린다).
   * 없는 게임, 기기 진행 중이 아닌 판(사람이 둘인 방 등)은 예전 그대로 서버가 진행한다.
   */
  local?(host: LocalHost): LocalPlay;
  /**
   * 지금 화면에 '차례'로 보여 줄 자리. 새 상태에서는 이미 다음 사람 차례여도, 방금 둔 사람의 연출(낸 패 → 뒤집기 → 먹기 → 컷인)이
   * 끝나기 전에는 그 사람 차례로 보여 준다 (맞고). 없으면(undefined) 상태의 차례 그대로. 자리 줄의 '차례' 표시와 타이머 막대에 쓴다
   */
  turnSeat?(t: TableCtx<P, Q>): number | null | undefined;
  /**
   * '자동 시작' 스위치를 둔다 (상단 바). 켜 두면 결과 창이 3초 뒤 저절로 닫히고 → 판 정리 → 내가 자동으로 레디한다.
   * 사람마다(기기에) 게임별로 기억한다. 칩이 최소 입장 금액보다 모자라면 스위치를 끄고 알린다. 구경·예약 중에는 동작하지 않는다.
   * (모두 레디하면 판이 시작되는 흐름은 그대로다. 방에 막 들어왔을 때는 저절로 레디하지 않는다: 한 판을 마쳤거나 스위치를 켠 뒤부터)
   */
  autoStart?: boolean;
  /** 방 화면을 떠날 때 (나가기 · 방이 사라짐): 게임이 따로 걸어 둔 타이머 등을 치운다 (모듈 상태는 방을 옮겨도 남는다) */
  leave?(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, s: string) => root.querySelector<T>(s)!;
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const app = () => document.getElementById('app')!;

export function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

/**
 * 서버의 규칙 판이 이 탭에 실린 엔진과 다르다 (탭을 연 뒤 새 규칙이 배포됐다): 새로고침 안내 창 (한 번만 띄운다).
 * 닫기 버튼은 두지 않는다 — 이 탭으로는 판을 맞게 이어 갈 수 없다
 */
let outdatedShown = false;

/** 게임 중 나가기 안내: 나간 자리를 어떻게 두는지 (runner 의 leftAction·leftUsesTimeout 과 맞춘다) */
const BUSY_NOTE = '이번 판이 끝날 때까지 다른 카드 방에는 들어갈 수 없어요.';
const LEAVE_NOTE: Partial<Record<GameId, string>> = {
  poker: `나가면 이번 판은 자동으로 체크하고, 콜해야 하면 다이해요. 이미 낸 칩은 판 결과대로 정산되고, ${BUSY_NOTE}`,
  holdem: `나가면 이번 판은 자동으로 체크하고, 콜해야 하면 폴드해요. 이미 낸 칩은 판 결과대로 정산되고, ${BUSY_NOTE}`,
  blackjack: `나가면 아직 걸지 않았으면 이번 판은 쉬고, 이미 걸었으면 스탠드해요. 결과는 내 지갑에 반영되고, ${BUSY_NOTE}`,
  matgo: `나가면 이번 판은 AI가 대신하고 결과는 내 지갑에 반영돼요. ${BUSY_NOTE}`,
  // 룰렛: 나가면 자리는 바로 비고, 확정한 베팅은 이미 빠져 결과대로 지급된다 (다른 방 입장도 막지 않는다)
  roulette: '나가도 이미 확정한 베팅은 결과대로 내 지갑에 반영돼요.',
};
export function showOutdated() {
  if (outdatedShown) return;
  outdatedShown = true;
  const d = document.createElement('div');
  d.className = 'modal';
  d.setAttribute('role', 'alertdialog');
  d.innerHTML = `<div class="box"><h3>게임이 새 버전으로 바뀌었어요</h3><p class="note">새로고침해 주세요 (방금 바뀌었다면 잠시 뒤에 다시 새로고침해 주세요)</p>
    <div class="row"><button type="button" class="btn primary" data-reload>새로고침</button></div></div>`;
  document.body.append(d);
  const b = $<HTMLButtonElement>(d, '[data-reload]');
  // 캐시에 남은 예전 화면 파일을 다시 받지 않게 주소에 시각을 붙여 새로 연다
  b.addEventListener('click', () => {
    const u = new URL(location.href);
    u.searchParams.set('v', String(Date.now()));
    location.replace(u.href);
  });
  b.focus();
}

/** 확인 창 대신 쓰는 간단한 입력 창 */
function promptBox(title: string, placeholder: string, type = 'text'): Promise<string | null> {
  return new Promise((done) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<form class="box"><h3>${esc(title)}</h3><input type="${type}" maxlength="20" placeholder="${esc(placeholder)}" autocomplete="off"/>
      <div class="row"><button type="button" class="btn ghost" data-x>취소</button><button class="btn primary">확인</button></div></form>`;
    document.body.append(d);
    const input = $<HTMLInputElement>(d, 'input');
    input.focus();
    const close = (v: string | null) => (d.remove(), done(v));
    $(d, '[data-x]').addEventListener('click', () => close(null));
    $(d, 'form').addEventListener('submit', (e) => (e.preventDefault(), close(input.value)));
  });
}

/** 십이지신 아바타 고르기 (taken: 다른 사람이 쓰는 동물) */
function pickAvatar(z: ZodiacModule, current: string, taken: string[] = []): Promise<string | null> {
  return new Promise((done) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="box"><h3>내 동물 고르기</h3><div class="avatars">${z.ZODIAC.map(
      (a) => `<button class="av ${a.id === current ? 'sel' : ''}" data-id="${a.id}" ${taken.includes(a.id) ? 'disabled' : ''}>
        <img src="${z.avatarUrl(a.id)}" alt=""/><span>${a.nick}</span></button>`,
    ).join('')}</div><div class="row"><button class="btn ghost" data-x>취소</button></div></div>`;
    document.body.append(d);
    const close = (v: string | null) => (d.remove(), done(v));
    $(d, '[data-x]').addEventListener('click', () => close(null));
    d.querySelectorAll<HTMLButtonElement>('.av').forEach((b) => b.addEventListener('click', () => close(b.dataset.id!)));
  });
}

interface Mods {
  room: RoomModule;
  wallet: WalletModule;
  z: ZodiacModule;
}

interface SoundModule {
  play(name: string, opts?: { delay?: number; volume?: number; rate?: number }): void;
  playMany(name: string, count: number, gapMs?: number, opts?: { delay?: number }): void;
  mountSoundButton(parent?: HTMLElement): HTMLElement;
}
let snd: SoundModule | null = null;
/** 효과음 (모듈을 아직 못 불러왔으면 조용히) */
export const sfx = (name: SoundName, opts?: { delay?: number; volume?: number; rate?: number }) => snd?.play(name, opts);
export const sfxMany = (name: SoundName, count: number, gapMs?: number, opts?: { delay?: number }) => snd?.playMany(name, count, gapMs, opts);
function loadSound() {
  void import(/* @vite-ignore */ new URL('shared/sound.js', worldRoot()).href).then(
    (m: SoundModule) => {
      snd = m;
      m.mountSoundButton();
      // 버튼 누르는 소리 (모든 화면)
      document.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement | null)?.closest('button, .unit, label.btn');
        if (b && !(b as HTMLButtonElement).disabled && b.id !== 'sia-sound-btn') sfx('click');
      });
    },
    () => undefined,
  );
}

/** 이 게임에 지금 들어와 있는 사람 수 (shared/presence.js). 실시간 연결을 못 했으면 null */
let here: PresenceHandle | null = null;
let hereMax = 30;

export async function bootGame(ui: GameUI) {
  document.title = ui.title;
  linkThemeCss();
  loadSound();
  app().innerHTML = '<div class="center">불러오는 중…</div>';
  let me: WorldUser;
  let mods: Mods;
  try {
    setTheme(await world.theme());
    const auth = await world.auth();
    me = await auth.requireLogin();
    auth.onSignedOut(() => location.replace(auth.loginUrl()));
    const [room, wallet, z] = await Promise.all([world.room(), world.wallet(), world.zodiac()]);
    mods = { room, wallet, z };
  } catch {
    app().innerHTML = `<div class="center">SIA WORLD에 연결하지 못했어요.<br/><br/><button class="btn primary" onclick="location.reload()">다시 시도</button></div>`;
    return;
  }
  // 접속 인원: 게임마다 30명까지 (시아탱크 대기실과 같은 방식). 연결을 못 하면 막지 않는다
  try {
    const pres = await world.presence();
    hereMax = pres.GAME_MAX;
    here = await pres.enterGame(pres.cardChannel(ui.game), me);
  } catch {
    here = null;
  }
  if (here?.full) {
    app().innerHTML = `<div class="center">지금은 사람이 가득 찼어요 (최대 ${hereMax}명).<br/>잠시 후 다시 들어와 주세요.<br/><br/>
      <button class="btn primary" onclick="location.reload()">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`;
    return;
  }
  const roomId = new URLSearchParams(location.search).get('room');
  if (roomId) await enterRoom(ui, mods, me, roomId);
  else await showLobby(ui, mods, me);
}

// ---------- 방 목록 ----------

async function showLobby(ui: GameUI, m: Mods, me: WorldUser) {
  const cur = m.room.CURRENCY[ui.game];
  const unit = cur === 'nyang' ? '냥' : '칩';
  let wallet: Wallet | null = null;
  let avatar = m.z.lastAvatar(me.userId);
  let baseUnit = 100;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);

  app().innerHTML = `<div class="lobby">
    <header class="bar"><a class="btn ghost" href="${new URL(ui.back, new URL('index.html', worldHome())).href}">← ${esc(ui.backLabel)}</a>
      <h1>${ui.icon} ${esc(ui.title)}</h1><span class="money" id="money">-</span></header>
    <section class="card create">
      <div class="me-card">
        <button class="me-face" id="c-av" aria-label="내 동물 바꾸기"></button>
        <div class="me-info">
          <b class="me-name">${esc(me.nickname)}</b>
          <small id="me-animal"></small>
          <span class="me-money" id="me-money">-</span>
          <span id="refill-box"></span>
        </div>
      </div>
      <div class="create-form">
        <h2>방 만들기</h2>
        <div class="grid2">
          <label>방 이름<input id="c-name" maxlength="20" placeholder="${esc(me.nickname)}의 방"/></label>
          <label>비밀번호 (선택)<input id="c-pw" maxlength="20" type="password" autocomplete="new-password" placeholder="없으면 공개방"/></label>
        </div>
        <div class="units" id="units"></div>
        <button class="btn primary big" id="c-go">방 만들기 ▶</button>
        <p class="hint" id="c-hint"></p>
      </div>
    </section>
    <section class="card"><h2>방 목록 <small class="here" id="here"></small></h2><div id="rooms" class="rooms"><p class="empty">불러오는 중…</p></div></section>
  </div>`;
  const root = app();
  // 지금 이 게임에 들어와 있는 사람 수 (방에 있는 사람 포함)
  const hereEl = $(root, '#here');
  const paintHere = () => {
    if (!hereEl.isConnected) return void offHere?.();
    hereEl.textContent = here && here.count() > 0 ? `· 지금 ${here.count()}/${hereMax}명` : '';
  };
  const offHere = here?.onChange(paintHere);
  paintHere();

  const paintAvatar = () => {
    const a = m.z.ZODIAC.find((x) => x.id === avatar)!;
    $(root, '#c-av').innerHTML = `<img src="${m.z.fullUrl(avatar)}" alt=""/><span>🐾 바꾸기</span>`;
    $(root, '#me-animal').textContent = `${a.name} · ${a.nick}`;
  };
  let alive = true;
  const paintMoney = () => {
    if (!alive) return;
    $(root, '#money').textContent = wallet ? `${cur === 'nyang' ? '💰' : '🪙'} ${m.wallet.formatAmount(wallet[cur])}${unit}` : '-';
    $(root, '#me-money').textContent = wallet ? `${cur === 'nyang' ? '💰' : '🪙'} ${m.wallet.formatAmount(wallet[cur])}${unit}` : '-';
    $(root, '#units').innerHTML = m.wallet.BASE_UNITS.map((u) => {
      const ok = !!wallet && wallet[cur] >= m.wallet.minEntry(u);
      return `<button class="unit ${u === baseUnit ? 'sel' : ''}" data-u="${u}">기본 ${m.wallet.formatAmount(u)}<small>입장 ${m.wallet.formatAmount(m.wallet.minEntry(u))}${unit}${ok ? '' : ' ⚠'}</small></button>`;
    }).join('');
    root.querySelectorAll<HTMLButtonElement>('.unit').forEach((b) =>
      b.addEventListener('click', () => {
        baseUnit = Number(b.dataset.u);
        paintMoney();
      }),
    );
    const box = $(root, '#refill-box');
    box.innerHTML = m.wallet.canRefill(wallet, cur, 100)
      ? `<button class="btn small" id="refill">무료 충전 (${wallet!.refillUnlimited ? '관리자 · 제한 없음' : `오늘 ${wallet![`${cur}RefillsLeft`]}번 남음`})</button>`
      : '';
    box.querySelector('#refill')?.addEventListener('click', async () => {
      try {
        const r = await m.wallet.refill(cur, 100);
        wallet = r;
        toast(r.ok ? `10,000${unit}을 충전했어요` : r.reason === 'limit' ? '오늘 무료 충전을 모두 썼어요' : '아직 충분해요');
      } catch (e) {
        toast(m.room.friendly(e));
      }
      paintMoney();
    });
  };
  const loadWallet = async () => {
    try {
      wallet = await m.wallet.ensureWallet();
    } catch {
      wallet = null;
    }
    paintMoney();
  };

  const paintRooms = async () => {
    let rooms: RoomRow[];
    try {
      rooms = await m.room.listRooms(ui.game);
      if (!alive) return;
    } catch (e) {
      if (!alive) return;
      $(root, '#rooms').innerHTML = `<p class="empty">${esc(m.room.friendly(e))}</p>`;
      return;
    }
    $(root, '#rooms').innerHTML = rooms.length
      ? rooms
          .map((r) => {
            const seats = r.seats ?? [];
            const humans = seats.filter((s) => s.user_id && !s.left_game);
            const ais = seats.filter((s) => !s.user_id || s.left_game).length;
            const open = r.status === 'playing' ? seats.filter((s) => (!s.user_id || s.left_game) && !s.pending_user_id).length : ais;
            // 내가 아직 앉아 있는 방 (판 도중 다른 화면으로 나왔을 때): 가득 차 보여도 돌아갈 수 있다
            const mine = seats.some((s) => s.user_id === me.userId && !s.left_game);
            const full = open === 0 && !mine;
            const playing = r.status === 'playing';
            return `<div class="room-row ${playing ? 'playing' : ''} ${mine ? 'mine' : ''}">
              <div class="rn">${r.has_password ? '🔒 ' : ''}${esc(r.name)}
                <small>기본 ${m.wallet.formatAmount(r.base_unit)} · ${humans.map((h) => esc(h.nickname)).join(', ')}${ui.noAi ? ` · ${humans.length}/${seats.length}명` : ais ? ` · AI ${ais}` : ''}</small></div>
              <span class="st">${playing ? '게임 중' : '대기'}</span>
              <button class="btn ${full ? '' : 'primary'}" data-id="${r.id}" data-pw="${mine ? 0 : r.has_password ? 1 : 0}" ${full ? 'disabled' : ''}>${mine ? '돌아가기' : full ? '가득 참' : playing && !ui.noAi ? '관전·예약' : '입장'}</button>
            </div>`;
          })
          .join('')
      : '<p class="empty">아직 방이 없어요. 방을 만들어 보세요! (AI가 함께해요)</p>';
    root.querySelectorAll<HTMLButtonElement>('.room-row button[data-id]').forEach((b) =>
      b.addEventListener('click', async () => {
        let pw = '';
        if (b.dataset.pw === '1') {
          const v = await promptBox('비밀번호', '방 비밀번호', 'password');
          if (v === null) return;
          pw = v;
        }
        stop();
        await enterRoom(ui, m, me, b.dataset.id!, pw);
      }),
    );
  };

  paintAvatar();
  $(root, '#c-av').addEventListener('click', async () => {
    const v = await pickAvatar(m.z, avatar);
    if (v) {
      avatar = v;
      m.z.saveAvatar(me.userId, v);
      paintAvatar();
    }
  });
  $(root, '#c-go').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#c-go');
    btn.disabled = true;
    $(root, '#c-hint').textContent = '';
    try {
      const id = await m.room.createRoom({
        game: ui.game,
        name: $<HTMLInputElement>(root, '#c-name').value,
        password: $<HTMLInputElement>(root, '#c-pw').value,
        baseUnit,
        avatar,
      });
      stop();
      await enterRoom(ui, m, me, id);
    } catch (e) {
      $(root, '#c-hint').textContent = m.room.friendly(e);
      btn.disabled = false;
    }
  });

  const unwatch = m.room.watchRooms(ui.game, () => void paintRooms());
  const onFocus = () => void loadWallet();
  window.addEventListener('focus', onFocus);
  const stop = () => {
    alive = false;
    unwatch();
    window.removeEventListener('focus', onFocus);
  };
  await Promise.all([loadWallet(), paintRooms()]);
}

// ---------- 방 ----------

async function enterRoom(ui: GameUI, m: Mods, me: WorldUser, roomId: string, password = '') {
  app().innerHTML = '<div class="center">방에 들어가는 중…</div>';
  let avatar = m.z.lastAvatar(me.userId);
  let joined = false;
  for (let tries = 0; tries < 4 && !joined; tries++) {
    try {
      const r = await m.room.joinRoom(roomId, password, avatar);
      if (r.pending) toast('게임이 진행 중이에요. 이번 판은 구경하고 다음 판부터 참여해요');
      joined = true;
    } catch (e) {
      const msg = m.room.friendly(e);
      if (msg.includes('동물')) {
        const seats = await m.room.getSeats(roomId).catch(() => [] as SeatRow[]);
        const taken = seats.flatMap((s) => [s.user_id && !s.left_game ? s.avatar : '', s.pending_avatar ?? '']).filter(Boolean);
        const v = await pickAvatar(m.z, m.z.pickFree(avatar, taken) ?? avatar, taken);
        if (!v) return showLobby(ui, m, me);
        avatar = v;
        m.z.saveAvatar(me.userId, v);
        continue;
      }
      if (msg.includes('비밀번호')) {
        const v = await promptBox('비밀번호', msg, 'password');
        if (v === null) return showLobby(ui, m, me);
        password = v;
        continue;
      }
      toast(msg);
      return showLobby(ui, m, me);
    }
  }
  if (!joined) {
    toast('방에 들어가지 못했어요');
    return showLobby(ui, m, me);
  }
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  history.replaceState(null, '', url);
  await roomScreen(ui, m, me, roomId);
}

async function roomScreen(ui: GameUI, m: Mods, me: WorldUser, roomId: string) {
  const cur = m.room.CURRENCY[ui.game];
  const unit = cur === 'nyang' ? '냥' : '칩';
  let room = await m.room.getRoom(roomId);
  if (!room) {
    toast('방이 사라졌어요');
    return showLobby(ui, m, me);
  }
  let seats: SeatRow[] = [];
  let st: StateRow | null = null;
  let priv: PrivateRow | null = null;
  let wallet: Wallet | null = null;
  let busy = false;
  /** 행동을 보낸 시점의 상태 시각 (이보다 새 상태가 오면 버튼을 다시 켠다) */
  let busySince: string | null = null;
  let busyTimer: ReturnType<typeof setTimeout> | null = null;
  /** 기기에서 진행하는 판 (ui.local 이 있는 게임만. 아래에서 만든다) */
  let local: LocalPlay | null = null;
  const unbusy = () => {
    busy = false;
    busySince = null;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = null;
  };
  let closed = false;
  let lastEvent = -1;
  let resultShownFor = -1;
  /** 결과 창을 띄우기로 했지만 (컷인이 끝나기를 기다리는 중) 아직 뜨지 않은 판 */
  let resultDue = -1;
  let firstLoad = true;
  // 카드 연출 상태: 판마다 key → 면. 처음 화면을 그릴 때(새로고침 등)는 연출 없이 기록만
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dealRound = -1;
  let dealReady = false;
  /** key → 면, 그리고 진행 중인 연출(시작 시각·종류·출발점) */
  const dealt = new Map<string, { face: string | null; start: number; kind: 'slide' | 'flip' | null; from: { x: number; y: number } }>();
  let dealSeq = 0;
  /** 다음 카드가 출발할 수 있는 시각: 여러 번 나눠 온 상태도 한 장씩 차례로 보이게 */
  let dealQueueAt = 0;
  const queueDeal = (now: number, gap: number) => {
    if (!dealReady || reduceMotion) return now;
    const start = Math.max(now, dealQueueAt);
    dealQueueAt = start + gap;
    dealSeq++;
    return start;
  };
  // 모션 속도 (너무 빠르지 않게): 받기 0.42초 · 뒤집기 0.36초 · 패 이동 0.56초 · 낸 패→뒤집은 패→가져가기 사이 0.5초
  const SLIDE_MS = 420;
  const FLIP_MS = 360;
  /** 카드 이동 연출: key → 목표 위치와 진행 중인 이동 (경유점이 있으면 출발 → 경유점 → 목표) */
  const moves = new Map<string, MoveRec>();
  /** 이번에 그리기 직전의 위치들 (같은 그림 안에서 먼저 옮겨진 카드의 '원래 자리'를 알려고) */
  let movesSnap = new Map<string, MoveRec>();
  let moveRound = -1;
  /** 순서별 출발 시각: 낸 패 0 → 뒤집은 패 0.76초 → 가져가기 1.65초 */
  const ORDER_AT = [0, 650, 1400];
  const MOVE_MS = 560;
  const moveEnd = (r: MoveRec) => (r.via ? r.s2 + MOVE_MS : r.s1 + r.dur);
  /** 시각 t의 위치·기울기·크기 */
  const posAt = (r: MoveRec, t: number) => {
    const leg = (fx: number, fy: number, tx2: number, ty2: number, p: number) => {
      const e = easeInOut(p);
      const dist = Math.hypot(tx2 - fx, ty2 - fy);
      const cx = (fx + tx2) / 2;
      const cy = (fy + ty2) / 2 - Math.min(90, dist * 0.18);
      const u = 1 - e;
      return { x: u * u * fx + 2 * u * e * cx + e * e * tx2, y: u * u * fy + 2 * u * e * cy + e * e * ty2, e, tilt: (tx2 >= fx ? 1 : -1) * Math.min(9, dist * 0.03) };
    };
    const target = r.via ?? { x: r.x, y: r.y };
    const endScale1 = r.via ? r.viaScale : 1;
    if (t <= r.s1) return { x: r.fromX, y: r.fromY, angle: 0, sx: r.scale0 * (r.flip ? 0.02 : 1), sy: r.scale0 };
    const p1 = Math.min(1, (t - r.s1) / r.dur);
    if (p1 < 1 || !r.via) {
      const a = leg(r.fromX, r.fromY, target.x, target.y, p1);
      const base = r.scale0 + (endScale1 - r.scale0) * a.e;
      const pop = r.scale0 === endScale1 ? 1 + 0.08 * Math.sin(Math.PI * a.e) : 1;
      // 뒤집기: 처음 40% 동안 가로로 펴진다
      const fl = r.flip ? Math.max(0.02, Math.min(1, p1 / 0.4)) : 1;
      return { x: a.x, y: a.y, angle: Math.sin(Math.PI * a.e) * a.tilt, sx: base * pop * fl, sy: base * pop };
    }
    // 경유점(바닥)에서 잠깐 머문 뒤 목표(먹은 패 자리)로
    if (t <= r.s2) return { x: r.via.x, y: r.via.y, angle: 0, sx: r.viaScale, sy: r.viaScale };
    const p2 = Math.min(1, (t - r.s2) / MOVE_MS);
    const b = leg(r.via.x, r.via.y, r.x, r.y, p2);
    const sc = r.viaScale + (1 - r.viaScale) * b.e;
    return { x: b.x, y: b.y, angle: Math.sin(Math.PI * b.e) * b.tilt, sx: sc, sy: sc };
  };
  /** 연출 기준점 (그릴 때마다 다시 등록) */
  const anchors = new Map<string, { x: number; y: number }>();
  /** 진행 중인 카드 연출이 끝나는 시각 (컷인·결과 창은 그 뒤에) */
  let animEnd = 0;
  // 연출 재생기 상태 (아래 paint·paintControls가 먼저 쓰므로 위에 둔다)
  /**
   * 판 정리 (ui.cleanup이 있는 게임): wait 결과 창을 보는 중 → run 정리 연출 중 → done 테이블을 비웠다 (레디 가능).
   * tidyRound의 판에만 해당한다 (새 판이 오면 저절로 무시된다).
   */
  let tidy: 'none' | 'wait' | 'run' | 'done' = 'none';
  let tidyRound = -1;
  const tidying = () => (tidy === 'wait' || tidy === 'run') && tidyRound === st?.round_no && room?.status === 'waiting';
  // 정리한 판의 상태가 남아 있는 동안은 계속 빈 테이블 (레디 뒤 방이 '진행 중'으로 먼저 바뀌어도 지난 판 화면이 다시 나오지 않게)
  const tidied = () => tidy === 'done' && tidyRound === st?.round_no;
  /**
   * 판이 끝나 방은 '대기'로 바뀌었는데 그 판의 결과가 든 상태가 아직 오지 않았다 (방 정보가 먼저 도착했거나 상태를 놓쳤다).
   * 이때 테이블을 비우고 레디 버튼을 켜면 '스톱 → 결과 창 → 확인 → 판 정리' 순서가 뒤집혀 보인다 (빈 테이블이 먼저 나왔다가 결과가 뜬다)
   * → 잠깐(최대 5초)은 마지막 화면을 그대로 두고 결과를 기다린다. 1.5초가 지나도 안 오면 한 번 다시 읽는다.
   */
  let liveRound = -1;
  let endWaitRound = -1;
  let endWaitAt = 0;
  const awaitingResult = () => {
    if (!room || room.status !== 'waiting' || !st || !st.public_state || st.public_state.result) return false;
    if (st.round_no !== liveRound || st.round_no !== room.round_no) return false;
    const now = performance.now();
    if (endWaitRound !== st.round_no) {
      endWaitRound = st.round_no;
      endWaitAt = now;
      const round = st.round_no;
      const still = () => !closed && endWaitRound === round && st?.round_no === round && !st.public_state?.result;
      setTimeout(() => still() && void reloadAll(), 1500);
      setTimeout(() => still() && paint(), 5100);
    }
    return now - endWaitAt < 5000;
  };
  /**
   * 끝난 판의 결과 창이 아직 뜨지 않았다 (스톱 등 마지막 컷인을 보여 주는 중이거나, 곧 띄울 참).
   * 이 사이에 레디 버튼이 먼저 나오면 결과를 보기도 전에 다음 판으로 넘어간 것처럼 보인다 → 결과 창이 뜬 뒤에 (확인 → 판 정리 →) 레디
   */
  const resultPending = () =>
    !!st?.public_state?.result && room?.status === 'waiting' && !closed && (resultDue === st.round_no || resultShownFor !== st.round_no);
  let replaying = false;
  /** 재생 중인 항목의 새 공개 상태 (ctx.pubNext) */
  let playingNext: unknown = null;
  let inApply = false;
  /** 다시 불러올 때마다 늘린다: 그 전에 꺼내 둔 재생 항목은 적용하지 않는다 */
  let epoch = 0;
  /** 결과 걸음을 보여 주는 동안 결과 창·레디 버튼을 미룬다 */
  let holdResult = false;
  let pendingPriv: PrivateRow | null | undefined;
  /** 연출이 끝날 때까지 내 조작 버튼을 미룬다 (ctx.myTurn이 꺼진다) */
  let ctlHold = false;
  /** 재생 중인 항목의 새 상태를 이미 그렸다 (그 뒤에 온 비공개 패는 바로 반영) */
  let itemApplied = false;
  const queue: { s: StateRow; events: GameEventLite[]; exact: boolean; newRound: boolean }[] = [];
  /** 컷인 하나가 보이는 시간 (style.css의 cutin 애니메이션 1.2초 + 여유), 지금 예정된 컷인이 모두 끝나는 시각 */
  const CUTIN_MS = 1300;
  let cutinUntil = 0;
  const afterAnim = (fn: () => void) => {
    const wait = animEnd - performance.now();
    if (wait <= 0) fn();
    else setTimeout(() => !closed && fn(), wait + 150);
  };

  app().innerHTML = `<div class="table-page" data-game="${ui.game}">
    <header class="bar"><button class="btn ghost" id="leave">← 나가기</button>
      <h1>${esc(room.name)} <small>${ui.icon} 기본 ${m.wallet.formatAmount(room.base_unit)}</small></h1>
      <span class="money" id="money">-</span>${ui.autoStart ? '<button class="btn small auto-sw" id="auto" role="switch" aria-checked="false" title="결과 창을 3초 뒤 닫고 다음 판에 자동으로 레디해요">자동 시작<i></i></button>' : ''}<button class="btn small emote-btn" id="emote" aria-label="한마디 보내기" aria-haspopup="true" aria-expanded="false" title="한마디 보내기" hidden>💬</button><button class="btn small" id="invite">🔗 초대</button></header>
    <div class="seats" id="seats"></div>
    <div class="stage" id="stage"></div>
    <div class="timer"><i id="timer"></i></div>
    <div class="controls" id="controls"></div>
    <div class="cutin" id="cutin"></div>
    <div class="emote-pop" id="emote-pop" role="menu" aria-label="한마디" hidden>${EMOTES.map((e, i) => `<button type="button" class="btn small" role="menuitem" data-emote="${i}">${esc(e)}</button>`).join('')}</div>
  </div>`;
  const root = app();

  // ----- 자동 시작 스위치 (ui.autoStart 인 게임만) -----
  const AUTO_KEY = `sia-auto-start:${ui.game}:${me.userId}`;
  const AUTO_CLOSE_MS = 3000;
  let auto = false;
  /** 이 방에서 한 판을 마쳤거나 스위치를 켰다 (그 뒤부터 자동으로 레디한다. 방에 막 들어왔을 때는 하지 않는다) */
  let autoArmed = false;
  /** 자동 레디를 이미 해 본 판 (레디를 취소했거나 서버가 풀었으면 그 판에는 다시 하지 않는다) */
  let autoReadyRound = -1;
  if (ui.autoStart) {
    try {
      auto = localStorage.getItem(AUTO_KEY) === '1';
    } catch {
      /* 기억하지 못해도 스위치는 쓴다 */
    }
  }
  const paintAuto = () => {
    const b = root.querySelector('#auto');
    if (!b) return;
    b.classList.toggle('on', auto);
    b.setAttribute('aria-checked', String(auto));
  };
  const setAuto = (on: boolean) => {
    auto = on;
    if (on) autoArmed = true;
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0');
    } catch {
      /* 무시 */
    }
    paintAuto();
  };
  paintAuto();
  root.querySelector('#auto')?.addEventListener('click', () => {
    setAuto(!auto);
    toast(auto ? '자동 시작을 켰어요. 결과를 3초 보여 주고 다음 판에 레디해요' : '자동 시작을 껐어요');
    if (!closed) paintControls();
  });

  // ----- Phaser 테이블 -----
  const PhaserMod = await import('phaser');
  const Phaser = ((PhaserMod as unknown as { default?: typeof PhaserNS }).default ?? PhaserMod) as typeof PhaserNS;
  let scene: PhaserNS.Scene | null = null;
  const stage = $(root, '#stage');
  // 고해상도 화면(휴대폰 등): 캔버스는 기기 픽셀만큼 크게 만들고 CSS로 줄여 보여 준다.
  // 게임 코드는 그대로 CSS 픽셀 좌표로 그리고, 카메라 확대(DPR)로 맞춘다 (viewSize 참고)
  const DPR = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const stageW = () => Math.max(1, Math.round(stage.clientWidth || 800));
  const stageH = () => Math.max(1, Math.round(stage.clientHeight || 400));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: stage,
    backgroundColor: ui.felt(),
    scale: { mode: Phaser.Scale.NONE, width: stageW() * DPR, height: stageH() * DPR, zoom: 1 / DPR },
    banner: false,
    scene: {
      key: 'table',
      preload(this: PhaserNS.Scene) {
        // av-: 얼굴(원형 아바타·칩·카드 뒷면), full-: 전신(트럼프 그림 카드·화투)
        for (const z of m.z.ZODIAC_IDS) {
          this.load.image(`av-${z}`, m.z.avatarUrl(z));
          this.load.image(`full-${z}`, m.z.fullUrl(z));
        }
        // 트럼프 뒷면 그림 (못 불러오면 cards.ts가 코드로 그린다)
        this.load.image('back-casino', new URL('shared/images/cards/back.png?v=simple1', worldRoot()).href);
        ui.preload?.(this, m.z.avatarUrl);
      },
      create(this: PhaserNS.Scene) {
        scene = this;
        this.cameras.main.setOrigin(0, 0).setZoom(DPR);
        makeRoundAvatars(this, m.z.ZODIAC_IDS);
        // 크기가 바뀌면 테이블만 다시 그린다 (조작부까지 다시 만들면 크기가 또 바뀌어 반복될 수 있다)
        this.scale.on('resize', () => {
          this.cameras.main.setSize(this.scale.width, this.scale.height);
          drawTableOnly();
        });
        paint();
      },
    },
  });
  // Phaser 는 시작할 때 document 에 visibilitychange 리스너를 걸고 (VisibilityHandler) 게임을 없애도 떼지 않는다
  // → 방에 들어올 때마다 하나씩 쌓인다 (끝난 게임도 붙들고 있다). 시작하는 동안 건 것을 적어 두었다가 나갈 때 뗀다
  const phaserDocListeners: { type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions }[] = [];
  let phaserBlur: typeof window.onblur = null;
  let phaserFocus: typeof window.onfocus = null;
  {
    const g = game as unknown as { start(): void };
    const start0 = g.start;
    g.start = function (this: unknown) {
      const add0 = document.addEventListener;
      document.addEventListener = function (this: Document, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
        if (/visibilitychange$/.test(type)) phaserDocListeners.push({ type, fn, opts });
        return add0.call(this, type, fn, opts);
      } as typeof document.addEventListener;
      try {
        start0.call(this);
      } finally {
        document.addEventListener = add0;
        phaserBlur = window.onblur;
        phaserFocus = window.onfocus;
      }
    };
  }
  // 테이블 칸 크기가 바뀌면(아래 조작부 줄 수가 바뀌는 등) 캔버스도 맞춘다 — Phaser는 창 크기만 따라가므로
  const ro = new ResizeObserver(() => {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (w > 0 && h > 0 && (w * DPR !== game.scale.width || h * DPR !== game.scale.height)) {
      game.scale.resize(w * DPR, h * DPR);
      game.scale.setZoom(1 / DPR);
    }
  });
  ro.observe(stage);

  const mySeatRow = () => seats.find((s) => s.user_id === me.userId && !s.left_game) ?? null;
  const ctx = (): TableCtx | null => {
    if (!scene || !room) return null;
    const mine = mySeatRow();
    const pending = st?.pending_seats ?? [];
    // 먼저 계산한다: 미뤄 둔 내 패를 여기서 꺼내 쓸 수 있다 (아래 priv보다 앞서야 한다)
    const privWait = privWaiting(!!mine);
    // 판이 끝났어도 그 판의 연출을 재생하는 중이면 마지막 상태까지 그대로 보여 준다
    // 판 정리를 마친 뒤에는 빈 테이블 (다음 판을 기다린다)
    const pub = (room.status === 'playing' || st?.public_state?.result || replaying || queue.length || awaitingResult()) && st?.round_no && !tidied() ? st.public_state : null;
    return {
      scene,
      Phaser,
      room,
      seats,
      me,
      mySeat: mine?.seat_no ?? null,
      resultSeat: priv && st && priv.round_no === st.round_no ? priv.seat_no : null,
      pub,
      priv: priv && st && priv.round_no === st.round_no ? priv.hand : null,
      privWait,
      privNext: pendingPriv && st && pendingPriv.round_no === st.round_no ? pendingPriv.hand : null,
      pubNext: playingNext ?? pub,
      pending,
      // (기기에서 진행할 판의 전체 상태를 받아 오는 중이면 잠깐 막는다: 지금 보이는 것은 서버에 저장된 옛 상태다)
      myTurn: !!mine && room.status === 'playing' && pending.includes(mine.seat_no) && !ctlHold && !local?.waiting(),
      act: async (payload) => {
        if (busy) return false;
        busy = true;
        busySince = st?.updated_at ?? null;
        if (local) {
          // 기기에서 진행 중인 판이면 서버에 보내지 않고 바로 적용한다 (새 상태는 실시간으로 받은 것과 같은 길로 들어온다)
          let done: boolean | null = null;
          try {
            done = local.act(payload);
          } catch (e) {
            console.warn('local', e);
            done = false;
          }
          if (done !== null) {
            if (!done) unbusy();
            else {
              // 그 상태가 화면에 그려질 때 풀린다 (applyState). 혹시 안 그려지면 연출이 끝난 뒤에 푼다
              const release = () => {
                if (replaying || queue.length) {
                  busyTimer = setTimeout(release, 300);
                  return;
                }
                unbusy();
                paintControls();
              };
              busyTimer = setTimeout(release, 1500);
            }
            paintControls();
            return done;
          }
        }
        paintControls();
        try {
          await m.room.act(roomId, payload);
          // 새 상태(실시간)가 도착하면 풀린다. 혹시 안 오면 3초 뒤에 푼다
          if (busy && st?.updated_at === busySince) {
            // 3초 안에 새 상태가 안 오면 다시 누를 수 있게 (연출 재생 중이면 끝날 때까지 기다린다)
            const release = () => {
              if (replaying || queue.length) {
                busyTimer = setTimeout(release, 500);
                return;
              }
              unbusy();
              paintControls();
            };
            busyTimer = setTimeout(release, 3000);
            return true;
          }
          unbusy();
        } catch (e) {
          if (isRulesChanged(e)) showOutdated();
          else toast(m.room.friendly(e));
          unbusy();
          paintControls();
          return false;
        }
        paintControls();
        return true;
      },
      busy,
      fmt: (n) => m.wallet.formatAmount(n),
      money: () => (wallet ? wallet[cur] : null),
      avatarUrl: m.z.avatarUrl,
      seatName: (n) => seats.find((s) => s.seat_no === n)?.nickname ?? `자리 ${n + 1}`,
      seatAvatar: (n) => seats.find((s) => s.seat_no === n)?.avatar ?? 'tiger',
      redraw: () => paint(),
      redrawTable: () => drawTableOnly(),
      anchor: (name, x, y) => void anchors.set(name, { x, y }),
      sound: (name, opts) => sfx(name, opts),
      dpr: DPR,
      cutinLeft: () => cutinUntil - performance.now(),
      track: (obj, key, opts = {}) => {
        const round = st?.round_no ?? 0;
        if (round !== moveRound) {
          moveRound = round;
          moves.clear();
          movesSnap.clear();
        }
        const now = performance.now();
        // 제자리: 받기 연출(deal)이 이미 카드를 덱 쪽으로 옮겨 놓았을 수 있으니, 넘겨받은 자리가 있으면 그것을 쓴다
        const tx = opts.at?.x ?? obj.x;
        const ty = opts.at?.y ?? obj.y;
        const prev = moves.get(key);
        let rec = prev;
        const moved = prev && Math.abs(prev.x - tx) + Math.abs(prev.y - ty) > 3;
        if (!prev || moved) {
          // 지금 보이는 자리(이동 중이면 그 중간)에서 출발
          let fx = opts.from?.x ?? tx;
          let fy = opts.from?.y ?? ty;
          if (prev) {
            const at = posAt(prev, now);
            fx = at.x;
            fy = at.y;
          }
          const animate = !opts.still && dealReady && !reduceMotion && (prev ? true : !!opts.from);
          const s1 = now + ORDER_AT[Math.min(2, opts.order ?? 0)] + (animate ? (opts.delay ?? 0) : 0);
          const via = animate && opts.via ? opts.via : null;
          const dur = Math.max(120, opts.dur ?? MOVE_MS);
          rec = {
            dur,
            x: tx,
            y: ty,
            fromX: animate ? fx : tx,
            fromY: animate ? fy : ty,
            via,
            s1,
            // 경유점(바닥)에 내려앉은 뒤 '가져가기' 차례에 떠난다
            s2: via ? Math.max(s1 + dur + 120, now + (opts.viaLeave ?? ORDER_AT[2])) : s1,
            flip: animate && !!opts.flip,
            scale0: animate && opts.fromScale && Math.abs(opts.fromScale - 1) > 0.05 ? opts.fromScale : 1,
            viaScale: via ? (opts.viaScale ?? 1) : 1,
          };
          moves.set(key, rec);
          if (animate && opts.sound) sfx(opts.sound, { delay: Math.max(0, rec.s1 - now) });
          if (animate && opts.onLand && scene) {
            const land = opts.onLand;
            scene.time.delayedCall(Math.max(0, rec.s1 + dur - now), () => !closed && land());
          }
        }
        if (!scene || reduceMotion) return;
        const r = rec!;
        if (r.fromX === r.x && r.fromY === r.y && !r.via) return;
        const end = moveEnd(r);
        if (now >= end) return;
        animEnd = Math.max(animEnd, end);
        const apply = () => {
          const t = performance.now();
          const at = posAt(r, t);
          obj.setPosition(at.x, at.y).setAngle(at.angle).setScale(at.sx, at.sy);
          // 움직이는 동안은 위로. over: 같은 때 움직이는 카드끼리의 위아래 (늦게 내려앉는 카드가 위)
          obj.setDepth(opts.depth ?? (t >= r.s1 && t < end ? 11 + (opts.over ?? 0) : 10));
        };
        apply();
        scene.tweens.addCounter({ from: 0, to: 1, duration: end - now, onUpdate: apply, onComplete: apply });
      },
      lastPos: (key) => {
        const r = movesSnap.get(key);
        return r ? { x: r.x, y: r.y } : null;
      },
      deal: (obj, key, face, from) => {
        const round = st?.round_no ?? 0;
        if (round !== dealRound) {
          dealRound = round;
          dealt.clear();
        }
        const now = performance.now();
        const prev = dealt.get(key);
        let rec = prev;
        if (!prev) {
          // 처음 보는 카드: 출발점에서 날아온다 (여러 장이면 차례로)
          rec = { face, start: queueDeal(now, ui.dealGap ?? 200), kind: dealReady && !reduceMotion ? 'slide' : null, from };
        } else if (prev.face !== face) {
          // 같은 자리인데 면이 바뀜: 뒤집기
          rec = { face, start: queueDeal(now, Math.round((ui.dealGap ?? 200) * 0.8)), kind: dealReady && !reduceMotion ? 'flip' : null, from };
        }
        dealt.set(key, rec!);
        if (!scene || !rec!.kind) return 0;
        // 다시 그려도(실시간 이벤트마다) 하던 연출을 이어서 한다
        const dur = rec!.kind === 'slide' ? SLIDE_MS : FLIP_MS;
        animEnd = Math.max(animEnd, rec!.start + dur);
        const p = Math.max(0, Math.min(1, (now - rec!.start) / dur));
        if (p >= 1) return 0;
        const delay = Math.max(0, rec!.start - now);
        const rest = dur * (1 - p);
        if (p === 0) sfx(rec!.kind === 'slide' ? 'deal' : 'flip', { delay });
        if (rec!.kind === 'slide') {
          // 받기: 더미에서 미끄러지듯 날아와 (감속) 살짝 돌았다가 반듯하게 놓인다
          const tx = obj.x;
          const ty = obj.y;
          const f = rec!.from;
          const spin = (tx >= f.x ? -1 : 1) * 12;
          const place = (t: number) => {
            const e = 1 - Math.pow(1 - t, 3);
            obj.setPosition(f.x + (tx - f.x) * e, f.y + (ty - f.y) * e - Math.sin(Math.PI * e) * 14);
            obj.setScale(0.7 + 0.3 * e).setAlpha(Math.min(1, t * 4)).setAngle(spin * (1 - e));
          };
          place(p);
          scene.tweens.addCounter({ from: p, to: 1, duration: rest, delay, onUpdate: (tw) => place(tw.getValue() ?? 1) });
        } else {
          // 뒤집기: 가로로 납작해졌다가 펴지면서 살짝 들렸다 내려온다
          const y0 = obj.y;
          const place = (t: number) => {
            const e = easeInOut(t);
            obj.setScale(Math.max(0.02, e), 1 + 0.06 * Math.sin(Math.PI * e));
            obj.setY(y0 - Math.sin(Math.PI * e) * 6);
          };
          place(p);
          scene.tweens.addCounter({ from: p, to: 1, duration: rest, delay, onUpdate: (tw) => place(tw.getValue() ?? 1) });
        }
        // 이 카드가 자리에 놓이는 시각까지 남은 시간 (점수 글자 등을 그때 보여 주려고)
        return delay + rest;
      },
    };
  };

  /** 지갑 다시 읽기 (잠깐 사이 여러 번 불려도 한 번만) */
  let walletTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshWallet = (delay = 400) => {
    if (walletTimer) clearTimeout(walletTimer);
    walletTimer = setTimeout(() => {
      walletTimer = null;
      void m.wallet.ensureWallet().then((w) => {
        if (closed) return;
        wallet = w;
        paintMoney();
      }, () => undefined);
    }, delay);
  };
  const paintMoney = () => {
    if (closed) return;
    $(root, '#money').textContent = wallet ? `${cur === 'nyang' ? '💰' : '🪙'} ${m.wallet.formatAmount(wallet[cur])}${unit}` : '-';
  };

  /** 화면에 '차례'로 보여 줄 자리 (게임이 정한다: GameUI.turnSeat). 따로 없으면 undefined → 상태의 차례 그대로 */
  const shownTurn = (): number | null | undefined => {
    if (!ui.turnSeat || room?.status !== 'playing') return undefined;
    try {
      const c = ctx();
      return c && c.pub ? ui.turnSeat(c) : undefined;
    } catch {
      return undefined;
    }
  };
  const paintSeats = () => {
    const shown = shownTurn();
    const pending = room?.status === 'playing' ? (shown === undefined ? (st?.pending_seats ?? []) : shown === null ? [] : [shown]) : [];
    $(root, '#seats').innerHTML = seats
      .filter((s) => !ui.noAi || (s.user_id && !s.left_game) || s.pending_user_id)
      .map((s) => {
        const human = !!s.user_id && !s.left_game;
        const meHere = s.user_id === me.userId && !s.left_game;
        const tag = room?.status === 'playing'
          ? pending.includes(s.seat_no) && !(meHere && ctlHold) ? '<b class="turn">차례</b>' : s.left_game ? '<em>AI 대신</em>' : ''
          : human ? (s.ready ? '<b class="ready">레디</b>' : '<em>대기</em>') : '<em>AI</em>';
        return `<div class="seat ${meHere ? 'me' : ''} ${human ? '' : 'ai'}" data-seat="${s.seat_no}">
          <img src="${m.z.avatarUrl(s.avatar)}" alt=""/><span class="nm">${esc(s.nickname)}${meHere ? ' (나)' : ''}${room?.host_id && s.user_id === room.host_id ? ' 👑' : ''}</span>${tag}
          ${s.pending_user_id ? `<small>다음 판: ${esc(s.pending_nickname ?? '')}</small>` : ''}</div>`;
      })
      .join('');
    // 한마디 버튼은 자리에 앉은 사람만 (구경·예약 중에는 보기만 한다)
    const eb = root.querySelector<HTMLButtonElement>('#emote');
    if (eb) {
      const seated = !!mySeatRow();
      if (eb.hidden === seated) eb.hidden = !seated;
      if (!seated) closeEmotePop();
    }
  };

  let wasMyTurn = false;
  /**
   * 조작부 높이 고정: 버튼 줄 수가 바뀔 때마다 테이블(바닥판) 크기가 달라져 카드 크기·배치가 움직이지 않게,
   * 방에 있는 동안 가장 컸던 높이를 유지한다 (화면 너비가 바뀌면 다시 잰다).
   */
  let ctlLockH = 0;
  let ctlLockW = 0;
  const lockControls = () => {
    if (ui.stableControls === false) return;
    const el = root.querySelector<HTMLElement>('#controls');
    if (!el) return;
    // 낮은 화면(가로로 든 휴대폰)은 고정하지 않는다: 테이블이 너무 작아진다
    if (window.innerHeight <= 520) {
      el.style.minHeight = '';
      ctlLockW = 0;
      return;
    }
    if (ctlLockW !== window.innerWidth) {
      ctlLockW = window.innerWidth;
      // 처음부터 넉넉히 잡아 둔다 (대기 → 베팅 → 진행으로 넘어가도 테이블 크기가 그대로이게). 화면 높이의 1/4까지만
      ctlLockH = ui.controlsMin ? ui.controlsMin(window.innerWidth) : Math.min(window.innerWidth < 700 ? 210 : 150, Math.round(window.innerHeight * 0.25));
    }
    el.style.minHeight = '';
    ctlLockH = Math.max(ctlLockH, el.offsetHeight);
    el.style.minHeight = `${ctlLockH}px`;
  };
  const paintControls = () => {
    paintControlsInner();
    if (!closed) lockControls();
  };
  const paintControlsInner = () => {
    if (closed) return;
    {
      const mine = mySeatRow();
      // 차례 소리는 버튼이 실제로 켜질 때 (앞선 연출이 끝난 뒤)
      const now = !!mine && room?.status === 'playing' && (st?.pending_seats ?? []).includes(mine.seat_no) && !ctlHold;
      if (now && !wasMyTurn) sfx('turn');
      wasMyTurn = now;
      const page = root.querySelector('.table-page');
      if (page) {
        const c0 = ctx();
        const cls = c0 && ui.pageClass ? ui.pageClass(c0) : '';
        if (page.getAttribute('data-mode') !== cls) page.setAttribute('data-mode', cls);
      }
    }
    const el = $(root, '#controls');
    const c = ctx();
    const mine = mySeatRow();
    const spectator = !mine;
    if (!room) return;
    if (room.status === 'playing') {
      if (spectator) {
        el.innerHTML = '<p class="msg">구경하는 중이에요. 다음 판부터 참여해요</p>';
        return;
      }
      if (c) {
        // 판은 시작됐는데 새 판의 상태가 아직 안 왔다 (지난 판 화면이 남아 있다): 지난 판의 '○○ 차례' 대신 안내
        if (!c.pub || (c.pub as { result?: unknown }).result) {
          // '판 정리'는 결과를 확인한 뒤의 일이다: 끝난 판의 결과를 띄우기 전에는 그렇게 말하지 않는다
          el.innerHTML = `<p class="msg">${c.pub && st?.round_no === room.round_no ? '판이 끝났어요. 결과를 확인하는 중…' : '새 판을 준비하는 중…'}</p>`;
          return;
        }
        // 기기에서 진행한 판이 끝나 서버에 결과를 보내는 중
        const note = local?.notice();
        if (note) {
          el.innerHTML = `<p class="msg">${esc(note)}</p>`;
          return;
        }
        c.busy = busy;
        el.innerHTML = '';
        ui.controls(c, el);
      }
      return;
    }
    // 대기 중 (방금 끝난 판의 연출·결과를 다 보여 준 뒤에 레디 버튼)
    if (replaying || queue.length || holdResult || awaitingResult() || resultPending()) {
      el.innerHTML = '';
      // 아직 결과 전 화면을 보여 주는 중이면 (AI·딜러 차례 연출) 게임의 안내 문구 ('○○ 차례…')
      if (c && c.pub && !(c.pub as { result?: unknown }).result && ui.replay && !spectator) {
        c.busy = false;
        ui.controls(c, el);
      }
      // 아직 마지막 연출·결과 창 전이다 ('판 정리'는 결과를 확인한 뒤)
      if (!el.textContent?.trim()) el.innerHTML = '<p class="msg">판이 끝났어요. 결과를 확인하는 중…</p>';
      return;
    }
    if (spectator) {
      el.innerHTML = '<p class="msg">자리를 기다리는 중이에요…</p>';
      return;
    }
    // 결과를 확인하고 판 정리가 끝난 뒤에 레디
    if (tidying()) {
      el.innerHTML = `<p class="msg">${tidy === 'wait' ? '결과를 확인하면 판을 정리해요' : '판 정리 중이에요…'}</p>`;
      return;
    }
    const enough = !!wallet && wallet[cur] >= m.wallet.minEntry(room.base_unit);
    const allHumansReady = seats.filter((x) => x.user_id && !x.left_game).every((x) => x.ready);
    // 자동 시작: 칩이 모자라면 스위치를 끄고 알린다. 넉넉하면 (이번 판에 한 번) 저절로 레디한다
    if (ui.autoStart && auto && autoArmed) {
      if (wallet && !enough) {
        setAuto(false);
        toast(`${unit}이 모자라 자동 시작을 껐어요`);
      } else if (enough && !mine.ready && autoReadyRound !== room.round_no) {
        const round = room.round_no;
        autoReadyRound = round;
        setTimeout(() => {
          if (closed || !auto || room?.status !== 'waiting' || room.round_no !== round) return;
          const now = mySeatRow();
          if (!now || now.ready) return;
          void m.room.setReady(roomId, true, (res) => local?.onStart(res)).catch((e) => toast(m.room.friendly(e)));
        }, 500);
      }
    }
    el.innerHTML = `<div class="row">
      <button class="btn" id="av">🐾 동물 바꾸기</button>
      ${ui.manual ? '<button class="btn" id="manual">📖 게임 방법</button>' : ''}
      ${!enough && m.wallet.canRefill(wallet, cur, room.base_unit) ? `<button class="btn" id="refill">무료 충전</button>` : ''}
      <button class="btn big ${mine.ready ? '' : 'primary'}" id="ready" ${enough ? '' : 'disabled'}>${mine.ready ? '레디 취소' : '레디 ▶'}</button>
    </div>
    <p class="msg">${!enough ? `${m.wallet.formatAmount(m.wallet.minEntry(room.base_unit))}${unit} 이상 있어야 해요` : !mine.ready ? '레디를 누르면 시작해요' : allHumansReady ? '모두 레디! 곧 시작해요…' : '다른 사람을 기다리는 중… 사람이 모두 레디하면 시작해요'}</p>`;
    el.querySelector('#ready')?.addEventListener('click', async () => {
      try {
        await m.room.setReady(roomId, !mine.ready, (res) => local?.onStart(res));
      } catch (e) {
        toast(m.room.friendly(e));
      }
    });
    el.querySelector('#manual')?.addEventListener('click', () => showManual());
    el.querySelector('#av')?.addEventListener('click', async () => {
      const taken = seats.filter((s) => s.user_id && s.user_id !== me.userId && !s.left_game).map((s) => s.avatar);
      const v = await pickAvatar(m.z, mine.avatar, taken);
      if (!v) return;
      m.z.saveAvatar(me.userId, v);
      await m.room.setAvatar(roomId, v).catch((e) => toast(m.room.friendly(e)));
    });
    el.querySelector('#refill')?.addEventListener('click', async () => {
      try {
        const r = await m.wallet.refill(cur, room!.base_unit);
        wallet = r;
        toast(r.ok ? `10,000${unit}을 충전했어요` : '충전할 수 없어요');
      } catch (e) {
        toast(m.room.friendly(e));
      }
      paintMoney();
      paintControls();
    });
  };

  const showManual = () => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="box manual"><h3>📖 ${esc(ui.title)} 게임 방법</h3><div class="manual-body">${ui.manual ?? ''}</div><div class="row"><button class="btn primary" data-x>닫기</button></div></div>`;
    document.body.append(d);
    $(d, '[data-x]').addEventListener('click', () => d.remove());
    d.addEventListener('click', (e) => e.target === d && d.remove());
  };

  const paintResult = () => {
    if (closed) return;
    const c = ctx();
    const res = st?.public_state?.result;
    if (holdResult || !c || !res || room?.status !== 'waiting' || !st || resultShownFor === st.round_no) return;
    resultShownFor = st.round_no;
    resultDue = st.round_no;
    // 결과 창이 뜰 때까지는 레디 버튼 대신 안내 (스톱 → 결과 창 → 확인 → 판 정리 → 레디)
    paintControls();
    // 카드 연출이 끝나고, 컷인('스톱!' 등)이 다 보인 뒤에 결과 창
    afterAnim(() => {
      const wait = cutinUntil - performance.now();
      if (wait <= 0) showResultBox(c);
      else setTimeout(() => !closed && showResultBox(c), wait);
    });
  };
  /** 판 정리 연출을 돌리고, 끝나면 테이블을 비운 뒤 레디 버튼을 켠다 */
  const runTidy = (round: number) => {
    const finish = () => {
      if (closed || tidyRound !== round) return;
      tidy = 'done';
      paint();
    };
    const c = tidying() ? ctx() : null;
    if (!c || !ui.cleanup || reduceMotion || !c.pub) return finish();
    tidy = 'run';
    paintControls();
    let ms = 0;
    try {
      ms = ui.cleanup(c);
    } catch (e) {
      console.warn('cleanup', e);
    }
    setTimeout(finish, Math.max(0, Math.min(4000, ms)));
  };
  const showResultBox = (c: TableCtx) => {
    resultDue = -1;
    const d = document.createElement('div');
    d.className = 'modal';
    // 내가 이긴 판이면 별·색종이
    const deltas = (st?.public_state?.deltas ?? null) as Record<string, number> | null;
    const won = c.resultSeat !== null && (deltas?.[String(c.resultSeat)] ?? 0) > 0;
    const sparkles = won
      ? Array.from({ length: 10 }, (_, i) => `<span class="sparkle" style="left:${4 + ((i * 37) % 90)}%;top:${-4 + ((i * 53) % 100)}%;animation-delay:${(i * 0.15).toFixed(2)}s">${i % 2 ? '★' : '✦'}</span>`).join('')
      : '';
    const lost = c.resultSeat !== null && (deltas?.[String(c.resultSeat)] ?? 0) < 0;
    if (won) sfx('win');
    else if (lost) sfx('lose');
    d.innerHTML = `<div class="box result ${won ? 'win' : ''}">${sparkles}${ui.resultHtml(c)}<div class="row">${
      mySeatRow() ? '<button type="button" class="btn small emote-btn" data-emote-open aria-label="한마디 보내기" title="한마디 보내기">💬</button>' : ''
    }<button class="btn primary" data-x>확인</button></div></div>`;
    document.body.append(d);
    // 결과 창이 상단 바의 💬 를 가린다 → 결과 창 안에서도 한마디를 보낼 수 있게
    const eo = d.querySelector<HTMLButtonElement>('[data-emote-open]');
    eo?.addEventListener('click', () => toggleEmotePop(eo));
    // 결과를 확인하면 판을 정리하고 (게임에 맞는 연출) 그 뒤에 레디 버튼
    const round = st?.round_no ?? -1;
    if (ui.cleanup && room?.status === 'waiting') {
      tidy = 'wait';
      tidyRound = round;
      paintControls();
    }
    // 결과 창이 떴다: 정리 연출이 없는 게임(룰렛)은 여기서 바로 레디 버튼 (지갑을 다시 읽지 못해도 버튼은 나와야 한다)
    else paintControls();
    const okBtn = $<HTMLButtonElement>(d, '[data-x]');
    okBtn.addEventListener('click', () => {
      closeEmotePop();
      d.remove();
      if (tidy === 'wait' && tidyRound === round) runTidy(round);
      else paintControls();
    });
    // 자동 시작: 3초 보여 주고 저절로 닫는다 (남은 초를 버튼에 적는다. 직접 눌러도 된다. 스위치를 끄면 멈춘다)
    if (ui.autoStart) {
      autoArmed = true;
      let since = 0;
      const iv = setInterval(() => {
        if (closed || !d.isConnected) return clearInterval(iv);
        if (!auto || !mySeatRow()) {
          since = 0;
          if (okBtn.textContent !== '확인') okBtn.textContent = '확인';
          return;
        }
        const now = performance.now();
        if (!since) since = now;
        const left = AUTO_CLOSE_MS - (now - since);
        const label = `확인 (${Math.max(1, Math.ceil(left / 1000))})`;
        if (okBtn.textContent !== label) okBtn.textContent = label;
        if (left <= 0) {
          clearInterval(iv);
          okBtn.click();
        }
      }, 100);
    }
    void m.wallet.ensureWallet().then(
      (w) => {
        if (closed) return;
        wallet = w;
        paintMoney();
        paintControls();
      },
      () => undefined,
    );
  };

  /** 컷인 하나 띄우기 */
  const showCutin = (c: TableCtx, e: GameEventLite, text: string) => {
    if (closed) return;
    cutinUntil = Math.max(cutinUntil, performance.now() + CUTIN_MS);
    const av = typeof e.seat === 'number' ? c.seatAvatar(e.seat) : null;
    const el = $(root, '#cutin');
    el.innerHTML = `<div>${av ? `<img src="${m.z.fullUrl(av)}" alt=""/>` : ''}<span>${esc(text)}</span></div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    sfx('cutin');
  };
  /** 연출 재생기가 제때 이미 띄운(띄울) 컷인 ('판:사건 번호'): 새 상태를 그릴 때 한 번 더 띄우지 않는다 */
  const heldCutins = new Set<string>();
  /** 마지막으로 컷인을 살핀 판 */
  let cutinRound = -1;
  const showCutins = () => {
    if (closed) return;
    const c = ctx();
    const events = (st?.public_state?.events as GameEventLite[] | undefined) ?? [];
    const maxId = events.reduce((a, e) => Math.max(a, e.id), 0);
    if (lastEvent < 0 || !c) {
      lastEvent = maxId;
      if (st) cutinRound = st.round_no;
      return;
    }
    // 새 판 (사건 번호가 처음부터 다시 시작했거나, 판 번호가 바뀌었다: 판마다 사건이 하나뿐인 판 — 맞고 총통 — 이 이어져도 컷인이 뜨게)
    if (maxId < lastEvent || (st && cutinRound !== -1 && st.round_no !== cutinRound)) lastEvent = 0;
    if (st) cutinRound = st.round_no;
    const fresh = events.filter((e) => e.id > lastEvent && !heldCutins.has(`${st?.round_no}:${e.id}`));
    lastEvent = maxId;
    const hits = fresh.map((e) => ({ e, text: ui.cutin?.(e, c) })).filter((x): x is { e: GameEventLite; text: string } => !!x.text);
    if (!hits.length) return;
    const show = (e: GameEventLite, text: string) => showCutin(c, e, text);
    // 띄울 때가 정해진 컷인은 그 순간에 (각각), 나머지는 마지막 것 하나를 카드 연출이 모두 끝난 뒤에
    const untimed: typeof hits = [];
    for (const h of hits) {
      let delay: number | null = null;
      try {
        delay = ui.cutinDelay?.(h.e, c) ?? null;
      } catch {
        delay = null;
      }
      if (delay === null || reduceMotion) untimed.push(h);
      else {
        const d = Math.max(0, delay);
        cutinUntil = Math.max(cutinUntil, performance.now() + d + CUTIN_MS);
        setTimeout(() => show(h.e, h.text), d);
      }
    }
    // 나머지는 카드 연출이 끝난 뒤에 차례로 하나씩 (마지막 3개까지: '스톱!' → '광박!' …)
    const tail = untimed.slice(-3);
    if (tail.length && !reduceMotion) cutinUntil = Math.max(cutinUntil, Math.max(animEnd, performance.now()) + 150 + tail.length * CUTIN_MS);
    tail.forEach((h, i) => afterAnim(() => (i ? setTimeout(() => show(h.e, h.text), i * CUTIN_MS) : show(h.e, h.text))));
  };

  /** 대기 중인데 사람이 모두 레디면 판을 시작한다 (서버가 다시 확인하므로 여러 명이 불러도 안전) */
  let autoStartKey = '';
  const maybeStart = () => {
    if (closed || !room || room.status !== 'waiting') return;
    const humans = seats.filter((s) => s.user_id && !s.left_game);
    const mine = mySeatRow();
    if (!mine?.ready || !humans.length || !humans.every((s) => s.ready)) return;
    const key = `${room.round_no}:${humans.map((s) => s.user_id).join(',')}`;
    if (key === autoStartKey) return;
    autoStartKey = key;
    // 레디 버튼이 이미 시작을 불렀을 수 있으니, 1.5초 뒤에도 아직 대기 중일 때만 (예: 마지막 사람이 레디 대신 나간 경우)
    setTimeout(() => {
      if (closed || room?.status !== 'waiting') return;
      // 그 사이 레디가 풀렸으면 (판이 막 끝나 자리 정보가 늦게 온 경우 등) 부르지 않는다
      const now = seats.filter((s) => s.user_id && !s.left_game);
      if (!mySeatRow()?.ready || !now.length || !now.every((s) => s.ready)) {
        autoStartKey = '';
        return;
      }
      void m.room.startRound(roomId).then((res) => !closed && local?.onStart(res), () => undefined);
    }, 1500);
  };

  /** 글자는 따로 그린 그림이라 기기 해상도로 다시 굽는다 (안 하면 휴대폰에서 흐리다) */
  const sharpenText = (list: PhaserNS.GameObjects.GameObject[]) => {
    for (const o of list) {
      if (o instanceof Phaser.GameObjects.Text) {
        if (o.style.resolution !== DPR) o.setResolution(DPR);
      } else if (o instanceof Phaser.GameObjects.Container) sharpenText(o.list);
    }
  };

  /**
   * 테이블 비우기: 그려 둔 것을 모두 없앤다 (다음 줄에서 새로 그린다).
   * children.removeAll(true) 는 화면 목록에서 빼기만 하고 없애지는 않는다 (인자는 '없애기'가 아니라 '콜백 건너뛰기'다)
   * → 누를 수 있게 그렸던 패·버튼이 보이지 않는 채로 입력 목록에 남아, 내 차례가 아닐 때도 예전 자리를 누르면 눌렸다.
   */
  const clearScene = (sc: PhaserNS.Scene) => {
    for (const o of [...sc.children.list]) o.destroy();
  };

  function drawTableOnly() {
    if (closed) return;
    const c = ctx();
    if (!c) return;
    clearScene(c.scene);
    c.scene.tweens.killAll();
    dealSeq = 0;
    movesSnap = new Map(moves);
    anchors.clear();
    ui.draw(c);
    sharpenText(c.scene.children.list);
  }

  function paint() {
    if (closed) return;
    maybeStart();
    paintSeats();
    if ((replaying || queue.length) && !inApply) {
      // 연출 재생 중: 테이블은 재생이 끝난 뒤 새 상태로 그린다 (판이 끝나며 자리·방 정보가 먼저 와도 테이블이 비지 않게)
      paintControls();
      return;
    }
    if (tidy === 'run' && tidying()) {
      // 판 정리 연출 중: 다시 그리면 모으던 카드가 제자리로 돌아간다 → 끝난 뒤에 그린다
      paintControls();
      return;
    }
    const c = ctx();
    if (c) {
      clearScene(c.scene);
      c.scene.tweens.killAll();
      dealSeq = 0;
      movesSnap = new Map(moves);
      anchors.clear();
      ui.draw(c);
      sharpenText(c.scene.children.list);
      // 처음 그린 뒤부터 연출 (들어오자마자 모든 카드가 날아오지 않게)
      // 대기실에서 시작을 본 경우도 (첫 판 나눠 주기 연출)
      if (st?.public_state || room?.status === 'waiting') dealReady = true;
    }
    paintControls();
  }

  // 차례 타이머: 막대는 이 마감이 걸린 단계의 처음 길이를 100% 로 (게임·단계마다 길이가 다르다: 룰렛 베팅 20초·회전 30초 등)
  let barDeadline = '';
  let barSpan = 0;
  const timer = setInterval(() => {
    const bar = $(root, '#timer');
    if (!st?.turn_deadline || room?.status !== 'playing') {
      bar.style.width = '0';
      return;
    }
    // 앞 사람의 연출이 아직 끝나지 않았으면 (화면의 차례가 상태의 차례와 다르면) 다음 사람의 시간 막대는 아직 보이지 않는다
    const shown = shownTurn();
    if (shown !== undefined && (shown === null || !st.pending_seats.includes(shown))) {
      bar.style.width = '0';
      return;
    }
    const end = new Date(st.turn_deadline).getTime();
    const left = Math.max(0, end - Date.now());
    if (st.turn_deadline !== barDeadline) {
      // 새 마감: 서버가 이 마감을 찍은 시각(updated_at, 서버 시계라 마감과 같은 기준)부터의 길이. 중간에 들어왔어도 맞게 줄어 있다.
      // 같은 마감으로 여러 번 공개되는 게임(룰렛: 확정할 때마다)도 처음 본 마감 그대로 둔다. 기기에서 만든 상태는 updated_at 이 순번이라 쓰지 않는다
      barDeadline = st.turn_deadline;
      const from = st.local ? NaN : Date.parse(st.updated_at);
      barSpan = Math.max(left, Number.isFinite(from) && from < end ? end - from : 0, 1);
    }
    bar.style.width = `${Math.min(100, (left / barSpan) * 100)}%`;
    bar.classList.toggle('mine', !!mySeatRow() && st.pending_seats.includes(mySeatRow()!.seat_no));
  }, 200);

  const reloadAll = async () => {
    const [r, s, gs, p, w] = await Promise.all([
      m.room.getRoom(roomId),
      m.room.getSeats(roomId),
      m.room.getState(roomId),
      m.room.getPrivate(roomId),
      m.wallet.ensureWallet().catch(() => null),
    ]);
    if (closed) return;
    if (!r) return gone();
    queue.length = 0;
    epoch++;
    playingNext = null;
    pendingPriv = undefined;
    room = r;
    seats = s;
    // 기기에서 진행 중인 판이면 서버의 (낡은) 상태 대신 기기 진행 상태를 그대로 둔다 (방·자리를 먼저 넣어 둔다: 내 자리를 알아야 한다)
    let sub: ReturnType<LocalPlay['onReload']> = null;
    try {
      sub = local?.onReload({ room: r, state: gs }) ?? null;
    } catch (e) {
      console.warn('local', e);
    }
    st = sub ? sub.state : gs;
    priv = sub ? sub.priv : p;
    if (w) wallet = w;
    if (firstLoad && st && r.status === 'waiting') resultShownFor = st.round_no;
    if (r.status === 'playing' && st?.public_state && !st.public_state.result) liveRound = st.round_no;
    if (st) {
      replayRound = st.round_no;
      replaySeen = ((st.public_state?.events as GameEventLite[] | undefined) ?? []).reduce((a, e) => Math.max(a, e.id), 0);
    }
    firstLoad = false;
    paintMoney();
    paint();
    showCutins();
    paintResult();
  };

  // ── 연출 재생기: 서버 응답에 행동이 여러 개 들어 있으면 하나씩 보여 준 뒤 새 상태를 그린다 ──
  let replayRound = -1;
  let replaySeen = 0;
  const applyState = (s: StateRow) => {
    inApply = true;
    try {
      applyStateNow(s);
    } finally {
      inApply = false;
    }
  };
  const applyStateNow = (s: StateRow) => {
    if (busy && s.updated_at !== busySince) unbusy();
    st = s;
    if (room?.status === 'playing' && s.public_state && !s.public_state.result) liveRound = s.round_no;
    if (pendingPriv !== undefined && queue.length === 0) {
      priv = pendingPriv;
      pendingPriv = undefined;
    }
    if (ui.liveWallet) refreshWallet(typeof ui.liveWallet === 'function' ? ui.liveWallet(s.public_state) : 400);
    paint(); // 먼저 그려야 카드 연출 시각을 안다 (컷인·결과는 그 뒤)
    showCutins();
    paintResult();
  };
  /** 이 상태에서 새로 생긴 사건들. exact = 빠진 번호 없이 이어진다 (한 동작씩 되돌려 보여 줄 수 있다) */
  const freshEvents = (s: StateRow): { events: GameEventLite[]; exact: boolean; newRound: boolean } => {
    const events = (s.public_state?.events as GameEventLite[] | undefined) ?? [];
    const maxId = events.reduce((a, e) => Math.max(a, e.id), 0);
    let newRound = false;
    if (s.round_no !== replayRound || maxId < replaySeen) {
      // 새 판: 처음부터 (단, 방에 막 들어온 경우는 지난 일은 재생하지 않는다)
      const first = replayRound === -1;
      newRound = !first && s.round_no !== replayRound;
      replayRound = s.round_no;
      replaySeen = first ? maxId : 0;
      if (first) return { events: [], exact: false, newRound: false };
    }
    const fresh = events.filter((e) => e.id > replaySeen).sort((x, y) => x.id - y.id);
    const exact = fresh.every((e, i) => e.id === replaySeen + 1 + i);
    replaySeen = Math.max(replaySeen, maxId);
    if (!ui.replay || !scene || !dealReady || reduceMotion) return { events: [], exact: false, newRound: false };
    return { events: fresh, exact, newRound };
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** 한 동작에서 다음 동작으로 넘어가는 쉬는 시간의 배율 (클수록 천천히. 카드가 움직이는 시간은 그대로) */
  const PACE = 1.15;
  /** 진행 중인 카드 연출이 다 끝날 때까지 (다시 그리면서 늘어날 수 있어 되풀이해서 확인) */
  const waitAnim = async (pad = 120) => {
    for (let i = 0; i < 40 && !closed; i++) {
      const wait = animEnd - performance.now();
      if (wait <= 0) return;
      await sleep(wait + pad);
    }
  };
  const enqueueState = (s: StateRow) => {
    // 이미 본 것보다 오래된 상태 (다시 불러온 뒤 늦게 온 실시간 등)는 버린다
    // (기기에서 진행해 만든 상태는 시각이 아니라 순번이라 견주지 않는다. 그쪽의 낡은 서버 상태는 local.filterState 가 먼저 거른다)
    const latest = queue.length ? queue[queue.length - 1].s : st;
    if (latest && !s.local && !latest.local && s.updated_at && latest.updated_at && s.updated_at < latest.updated_at) return;
    let f: ReturnType<typeof freshEvents> = { events: [], exact: false, newRound: false };
    try {
      f = freshEvents(s);
    } catch (e) {
      console.warn('replay', e);
    }
    queue.push({ s, ...f });
    void runQueue();
  };
  // 개발 서버 전용: 연출 점검용으로 상태를 직접 넣어 볼 수 있게 (배포 빌드에는 들어가지 않는다)
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    (window as unknown as { __siaTable?: unknown }).__siaTable = {
      enqueue: enqueueState,
      state: () => st,
      mySeat: () => mySeatRow()?.seat_no ?? null,
      // 조작 점검용: 내 패 · 지금 누를 수 있는가 · 행동 넣기 (버튼을 누른 것과 같은 길)
      hand: () => (priv && st && priv.round_no === st.round_no ? priv.hand : null),
      myTurn: () => !!ctx()?.myTurn && !busy,
      act: (payload: unknown) => ctx()?.act(payload),
      // 연출 점검용: 화면에 '차례'로 보이는 자리 (게임이 따로 정하지 않으면 상태의 차례)
      turn: () => {
        const shown = shownTurn();
        return shown === undefined ? (st?.pending_seats ?? [])[0] ?? null : shown;
      },
      // 연출 점검용: 그 카드가 지금 화면에 그려지는 자리 (이동 중이면 그 중간. 아직 그린 적이 없으면 null)
      pos: (key: string) => {
        const r = moves.get(key);
        if (!r) return null;
        const at = posAt(r, performance.now());
        return { x: Math.round(at.x), y: Math.round(at.y), tx: Math.round(r.x), ty: Math.round(r.y) };
      },
    };
  }
  /** 사건 → 연출 한 걸음 (지금 보이는 화면 기준) */
  const stepOf = (ev: GameEventLite): ReplayStep | null => {
    try {
      const c = ctx();
      return c && ui.replay ? ui.replay(ev, c) : null;
    } catch (e) {
      console.warn('replay', e);
      return null;
    }
  };
  /** 그 사건의 컷인을 그 자리에서 띄우고 끝날 때까지 기다려야 하는가 (GameUI.cutinHold) */
  const holdsCutin = (ev: GameEventLite): boolean => {
    try {
      const c = ctx();
      return !!c && !!ui.cutinHold?.(ev, c);
    } catch {
      return false;
    }
  };
  /** 그 사건의 컷인을 지금 띄우고 다 보일 때까지 기다린다 → 띄웠으면 true */
  const playHeldCutin = async (ev: GameEventLite): Promise<boolean> => {
    let text: string | null | undefined = null;
    const c = ctx();
    try {
      text = c ? ui.cutin?.(ev, c) : null;
    } catch (e) {
      console.warn('cutin', e);
    }
    if (!c || !text) return false;
    showCutin(c, ev, text);
    await sleep(CUTIN_MS);
    return true;
  };
  const tryStep = (step: ReplayStep | null) => {
    if (!step) return;
    try {
      playStep(step);
    } catch (e) {
      console.warn('replay', e);
    }
  };
  const isAiStep = (step: ReplayStep) => {
    if (typeof step.at !== 'number') return false;
    const r = seats.find((x) => x.seat_no === step.at);
    return !r || !r.user_id || r.left_game;
  };
  /** 연출 중에 테이블 다시 그리기 (재생 중에는 paint가 테이블을 건너뛰므로) */
  /** 내 패를 기다리는 중인가 (판마다 처음 본 때부터 최대 3초: 그래도 안 오면 뒷면으로라도 그린다) */
  let privWaitRound = -1;
  let privWaitSince = 0;
  let privWaitTimer: ReturnType<typeof setTimeout> | null = null;
  function privWaiting(seated: boolean): boolean {
    if (!seated || !st || room?.status !== 'playing') return false;
    if (priv && priv.round_no === st.round_no) return false;
    // 끝난 판 화면이거나, 새 판의 내 패가 판 정보보다 먼저 온 경우: 지금 화면(지난 판)의 카드는 그대로 둔다
    if (st.public_state?.result || (priv && priv.round_no > st.round_no)) return false;
    // 연출 재생 중이라 미뤄 둔 내 패가 이번 판 것이면 바로 쓴다 (새 판 첫 패를 기다리게 하지 않는다)
    if (pendingPriv && pendingPriv.round_no === st.round_no) {
      priv = pendingPriv;
      pendingPriv = undefined;
      return false;
    }
    if (privWaitRound !== st.round_no) {
      privWaitRound = st.round_no;
      privWaitSince = performance.now();
      if (privWaitTimer) clearTimeout(privWaitTimer);
      // 연출 재생 중이어도 테이블까지 다시 그린다 (paint는 재생 중 테이블을 건너뛴다)
      privWaitTimer = setTimeout(() => !closed && repaint(), 3100);
    }
    return performance.now() - privWaitSince < 3000;
  }
  const repaint = () => {
    inApply = true;
    try {
      paint();
    } catch (e) {
      console.warn('paint', e);
    } finally {
      inApply = false;
    }
  };
  /**
   * 연출 순서 (어떤 동작도 앞 동작의 연출이 끝나기 전에 시작하지 않는다):
   *   앞 상태의 카드 연출이 끝남 → (새 판이면 판을 먼저 새로 펴고 '새 판 시작') → 사건을 하나씩 (말풍선·칩 → 카드 → 끝날 때까지 기다림)
   *   → 결과 걸음 → 결과 창 → 그제서야 내 조작 버튼 · 레디 버튼
   */
  const runQueue = async () => {
    if (replaying) return;
    replaying = true;
    try {
      while (queue.length && !closed) {
        const item = queue.shift()!;
        const myEpoch = epoch;
        const stale = () => closed || myEpoch !== epoch;
        // ctx.pubNext 는 이 항목을 그리기 시작할 때부터 (앞 항목 연출을 기다리는 동안은 앞 상태 그대로)
        const playing = () => {
          if (!stale()) playingNext = item.s.public_state ?? null;
        };
        const mine = seats.find((x) => x.user_id === me.userId);
        const myNext = !!mine && (item.s.pending_seats ?? []).includes(mine.seat_no);
        const wasMine = !!mine && room?.status === 'playing' && (st?.pending_seats ?? []).includes(mine.seat_no);
        // 내가 고르던 중이고 (아직 안 눌렀고) 새 상태에서도 내 차례면 버튼을 그대로 둔다. 그 밖에는 연출이 끝난 뒤에 켠다
        const keep = wasMine && !busy && myNext;
        ctlHold = !keep;
        itemApplied = false;
        // 이 상태에서 내 차례가 오면 내 시간(서버 마감)이 줄지 않게 조금 빨리
        // 내 시간이 많이 줄었으면 (서버 마감까지 12초 미만) 남은 연출은 기다리지 않고 바로 버튼을 켠다
        const dl = myNext && item.s.turn_deadline ? Date.parse(item.s.turn_deadline) : 0;
        const hurry = () => !!dl && dl - Date.now() < 12000;
        const quick = (ms: number) => (hurry() ? Math.min(ms, 100) : myNext ? Math.min(ms, 500) : ms);
        const waitA = async () => {
          if (!hurry()) await waitAnim();
        };
        const gapOf = (step: ReplayStep) => quick(Math.round((step.gap ?? (step.after ? 800 : isAiStep(step) ? 800 : 350)) * PACE));
        // 앞 상태의 카드 연출이 끝난 뒤에 시작
        // (내가 방금 기기에서 둔 행동은 서버 답을 기다릴 일이 없다: 누른 패가 바닥에 내려앉을 시간만 두고 바로 이어 간다.
        //  이때 남아 있는 연출은 손패가 자리를 고치는 것뿐이다 — 조작은 앞 차례의 연출이 끝난 뒤에만 켜진다)
        if (item.s.eager) await sleep(Math.max(0, Math.min(animEnd - performance.now() + 40, 260)));
        else await waitA();
        if (closed) return;
        let afterAt = 0;
        const markAfter = () => {
          if (!afterAt) afterAt = performance.now();
        };
        let frames: unknown[] | null = null;
        if (!stale() && ui.rewind && item.exact && item.events.length) {
          try {
            const f = ui.rewind(item.s.public_state, item.events);
            if (f && f.length === item.events.length) frames = f;
          } catch (e) {
            console.warn('rewind', e);
          }
        }
        // 결과가 든 상태면 결과 걸음을 다 보여 준 뒤에 결과 창·레디 버튼
        const ending = !!item.s.public_state?.result && (!!frames || item.events.some((e) => stepOf(e)?.after));
        if (ending) holdResult = true;
        /** 중간 화면 그리기: 내 버튼은 (고르던 중이 아니면) 숨긴 채로 */
        const showFrame = (pub: unknown) => {
          playing();
          st = { ...item.s, public_state: { ...(pub as object), result: null, deltas: null }, pending_seats: keep && mine ? [mine.seat_no] : [] } as StateRow;
          repaint();
        };
        const apply = () => {
          playing();
          try {
            applyState(item.s);
          } catch (e) {
            console.warn('apply', e);
          }
          itemApplied = true;
        };
        if (!stale() && frames) {
          // ── 한 동작씩: 말풍선·칩 → 그 동작의 화면 → 카드 연출이 끝나면 다음 ──
          if (item.newRound) {
            showFrame(frames[0]);
            playBanner('새 판 시작!');
            await sleep(quick(900));
            await waitA();
          }
          for (let i = 0; i < item.events.length && !stale(); i++) {
            const step = stepOf(item.events[i]);
            const t0 = performance.now();
            if (step && !step.after) tryStep(step);
            // 제때 띄울 컷인: 새 상태를 그릴 때(apply) 맨 끝에 한 번 더 뜨지 않게 먼저 표시해 둔다
            const hold = holdsCutin(item.events[i]);
            if (hold) {
              if (heldCutins.size > 200) heldCutins.clear();
              heldCutins.add(`${item.s.round_no}:${item.events[i].id}`);
            }
            if (i === item.events.length - 1) apply();
            else showFrame(frames[i + 1]);
            await waitA();
            if (stale()) break;
            // 이 사건의 이펙트(컷인)를 다 보여 준 뒤에 다음 걸음 (블랙잭 이펙트 → 그 뒤에 칩 지급·회수)
            if (hold && (await playHeldCutin(item.events[i]))) {
              if (stale()) break;
            }
            if (step?.after) {
              markAfter();
              tryStep(step);
              await sleep(gapOf(step));
            } else {
              // 걸음 간격에서 카드 연출에 쓴 시간은 뺀다. 카드가 움직였으면 놓인 뒤 잠깐은 쉰다
              const spent = performance.now() - t0;
              await sleep(Math.max(step ? gapOf(step) - spent : 0, spent > 200 ? Math.round(250 * PACE) : 0));
            }
          }
        } else if (!stale()) {
          // 걸음(ui.replay)은 apply 전에 계산하므로 여기서 먼저 ctx.pubNext 를 이 항목의 새 상태로 (돌려받음·결과 판정이 새 상태를 본다)
          playing();
          const steps = item.events.map(stepOf).filter((x): x is ReplayStep => !!x);
          const pre = steps.filter((x) => !x.after);
          const post = steps.filter((x) => x.after);
          if (item.newRound) {
            // 새 판: 먼저 판을 새로 펴고 (지난 판 테이블 위에 새 판의 베팅이 보이지 않게) 그다음에 사건을 하나씩
            apply();
            playBanner('새 판 시작!');
            await sleep(quick(700));
            await waitA();
          }
          for (const step of pre) {
            if (stale()) break;
            tryStep(step);
            await sleep(gapOf(step));
          }
          if (!stale() && !item.newRound) {
            apply();
            await waitA();
          }
          // 제때 보여 줘야 하는 컷인(블랙잭 이펙트)이 있으면 다 보인 뒤에 승패·정산 걸음
          if (!stale() && post.length && item.events.some(holdsCutin)) {
            await sleep(150);
            const wait = cutinUntil - performance.now();
            if (wait > 0) await sleep(wait);
          }
          // 카드가 다 놓인 뒤에 승패·정산을 하나씩
          for (const step of post) {
            if (stale()) break;
            markAfter();
            tryStep(step);
            await sleep(gapOf(step));
          }
        }
        if (closed) return;
        // 재생하는 동안 다시 불러왔으면 (탭 복귀·재연결) 이 항목은 이미 지난 상태 → 새 상태로 다시 그린다
        if (myEpoch !== epoch) {
          playingNext = null;
          holdResult = false;
          ctlHold = false;
          repaint();
          continue;
        }
        if (ending) {
          // 결과(승패 말풍선)는 적어도 2초는 보인 뒤에 결과 창
          if (afterAt) await sleep(Math.max(0, 2000 - (performance.now() - afterAt)));
          if (closed) return;
          holdResult = false;
          if (pendingPriv !== undefined && !queue.length) {
            priv = pendingPriv;
            pendingPriv = undefined;
          }
          try {
            paintResult();
          } catch (e) {
            console.warn('result', e);
          }
        }
        // 연출이 다 끝났다: 내 차례면 이제 조작 버튼을 켠다 (테이블의 누를 수 있는 패도 함께)
        if (ctlHold) {
          ctlHold = false;
          if (myNext && !queue.length) repaint();
        }
      }
    } finally {
      replaying = false;
      playingNext = null;
      holdResult = false;
      ctlHold = false;
      itemApplied = false;
      if (!closed) {
        if (pendingPriv !== undefined && !queue.length) {
          priv = pendingPriv;
          pendingPriv = undefined;
          repaint();
        }
        try {
          // 재생하는 동안 방이 '대기'로 바뀌었으면 여기서 결과 창을 띄운다 (재생 중에는 방 갱신이 그리기를 미룬다)
          paintResult();
          paintControls();
        } catch (e) {
          console.warn('controls', e);
        }
        // 남은 항목이 있으면 (예외로 멈춘 경우) 이어서
        if (queue.length) setTimeout(() => void runQueue(), 0);
      }
    }
  };
  /** 화면 가운데 알림 말풍선 ('새 판 시작!') */
  const playBanner = (text: string) => {
    const b = document.createElement('div');
    b.className = 'say banner';
    b.textContent = text;
    $(root, '#stage').append(b);
    setTimeout(() => b.remove(), 1500);
  };
  const anchorOf = (k: number | string) => anchors.get(typeof k === 'number' ? `seat:${k}` : k) ?? null;
  /** 한 걸음: 말풍선 + 칩 이동 + 소리 (Phaser 위 HTML이라 다시 그려도 끊기지 않는다) */
  const playStep = (step: ReplayStep) => {
    if (step.sound) sfx(step.sound);
    const stageEl = $(root, '#stage');
    if (step.text && step.at !== undefined) {
      const a = anchorOf(step.at);
      if (a) {
        const b = document.createElement('div');
        b.className = 'say';
        b.textContent = step.text;
        b.style.left = `${a.x}px`;
        b.style.top = `${Math.max(a.y, 48)}px`;
        stageEl.append(b);
        setTimeout(() => b.remove(), 1500);
      }
    }
    if (step.chips && step.chips.amount > 0) {
      const from = anchorOf(step.chips.from);
      const to = anchorOf(step.chips.to);
      if (from && to) {
        const n = Math.min(4, Math.max(1, Math.round(Math.log10(step.chips.amount / Math.max(1, room?.base_unit ?? 100)) * 2) + 1));
        for (let i = 0; i < n; i++) {
          const chip = document.createElement('i');
          chip.className = 'fly-chip';
          stageEl.append(chip);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const lift = Math.min(80, Math.hypot(dx, dy) * 0.25);
          const anim = chip.animate(
            [
              { transform: `translate(${from.x}px, ${from.y}px) scale(0.8)`, opacity: 0 },
              { transform: `translate(${from.x + dx * 0.5}px, ${from.y + dy * 0.5 - lift}px) scale(1.1)`, opacity: 1, offset: 0.5 },
              { transform: `translate(${to.x}px, ${to.y}px) scale(0.9)`, opacity: 1 },
            ],
            { duration: 520, delay: i * 70, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' },
          );
          anim.onfinish = () => chip.remove();
        }
        sfxMany('chip', n, 70);
      }
    }
  };

  const gone = () => {
    if (closed) return;
    toast('방이 사라졌어요');
    cleanup();
    void showLobby(ui, m, me);
  };

  const unwatch = m.room.watchRoom(roomId, {
    onRoom: (r) => {
      if (closed) return;
      if (!r) return gone();
      room = { ...room!, ...r };
      // 연출 재생 중이면 지금 그리지 않는다 (판이 끝나며 테이블이 비거나 남은 말풍선이 사라지지 않게) → 재생 뒤 applyState가 그린다
      if (replaying || queue.length) return;
      paint();
      paintResult();
    },
    onSeats: async () => {
      if (closed) return;
      seats = await m.room.getSeats(roomId).catch(() => seats);
      if (closed) return;
      if (!seats.some((s) => s.user_id === me.userId || s.pending_user_id === me.userId)) {
        // 오래 자리를 비워 정리되었으면
        toast('방에서 나와졌어요');
        cleanup();
        return void showLobby(ui, m, me);
      }
      // 기기에서 진행하는 판: 상대가 나갔으면 바로 혼자 하는 판으로 넘어간다
      try {
        local?.onSeats?.();
      } catch (e) {
        console.warn('local', e);
      }
      paint();
    },
    onState: (s) => {
      if (closed) return;
      // 기기에서 진행 중인 판: 기기 진행보다 낡은 서버 상태(내가 보낸 중간 저장 등)는 버린다. 결과가 든 상태는 그대로 받는다
      if (local?.filterState(s)) return;
      enqueueState(s);
    },
    onPrivate: (p) => {
      if (closed) return;
      if (local?.filterPrivate(p)) return;
      takePrivate(p);
    },
    onResync: () => void reloadAll(),
  });
  /** 내 비공개 패 받기 (실시간 · 기기 진행 공통) */
  function takePrivate(p: PrivateRow) {
    // 연출 재생 중이면 새 상태와 함께 (새 카드가 미리 보이지 않게)
    if (replaying && !(itemApplied && !queue.length)) {
      pendingPriv = p;
      return;
    }
    priv = p;
    if (replaying) repaint();
    else paint();
  }
  // ── 기기에서 진행하는 판 (혼자 하는 맞고): 게임이 주는 진행기에 셸의 문을 열어 준다 ──
  /** 방 채널 (기기에서 진행하는 게임만): 상대 화면이 알려 온 행동을 진행기에 넘긴다 */
  let cast: { send(msg: unknown): void; emote?(msg: unknown): void; close(): void } | null = null;
  // 방 채널은 카드 게임 5종 모두 연다: 한마디(이모티콘)는 어느 방에서나 오간다. 행동 알림('act')은 기기에서 진행하는 게임(맞고)만 쓴다
  try {
    cast = m.room.roomCast?.(roomId, (msg) => !closed && local?.onCast(msg), (msg) => takeEmote(msg)) ?? null;
  } catch (e) {
    console.warn('cast', e);
  }

  // ── 한마디(이모티콘): 자리 위 말풍선 2.5초. 방 채널로 { seat, i(문구 번호) } 만 보낸다 ──
  let emoteSentAt = -EMOTE_GAP_MS;
  /** 자리별로 마지막에 띄운 시각 (남이 마구 보내도 화면이 덮이지 않게, 받는 쪽에서도 간격을 둔다) */
  const emoteSeenAt = new Map<number, number>();
  const emoteBubbles = new Map<number, HTMLElement>();
  const showEmote = (seat: number, text: string) => {
    if (closed) return;
    const page = root.querySelector<HTMLElement>('.table-page');
    if (!page) return;
    emoteBubbles.get(seat)?.remove();
    const b = document.createElement('div');
    b.className = 'emote-say';
    b.textContent = text;
    // 자리 기준점 (테이블 좌표) → 화면 좌표. 테이블이 숨겨졌거나(룰렛 베팅 중 휴대폰) 기준점이 없으면 자리 줄의 그 사람 칸 아래
    const sr = stage.getBoundingClientRect();
    const up = anchors.get(`seat:${seat}`);
    const down = anchors.get(`seat-below:${seat}`);
    let x: number;
    let y: number;
    let below = false;
    if (sr.width > 0 && sr.height > 0 && (up || down)) {
      // 아래 기준점을 먼저 본다: 위쪽 자리(포커·홀덤 상대)는 칩·말풍선용 'seat:' 도 함께 등록하는데, 그 위에 띄우면 카드를 가린다
      below = !!down;
      const a = (down ?? up)!;
      x = sr.left + a.x;
      y = sr.top + (below ? a.y : Math.max(a.y, 48));
    } else {
      const chip = root.querySelector<HTMLElement>(`#seats [data-seat="${seat}"]`)?.getBoundingClientRect();
      below = true;
      if (chip && chip.width > 0) {
        x = chip.left + chip.width / 2;
        y = chip.bottom;
      } else {
        // 기준점도 자리 칸도 없다 (룰렛 · 낮은 화면에서 자리 줄을 숨겼을 때): 누가 말했는지 이름을 붙이고, 자리 순서대로 옆으로 벌린다
        const p = emoteSpread(seats.map((s) => s.seat_no), seat, window.innerWidth);
        const who = seats.find((s) => s.seat_no === seat)?.nickname;
        if (who) b.textContent = `${who}: ${text}`;
        x = p.x;
        y = (sr.height > 0 ? sr.top : 60) + 8 + p.dy;
      }
    }
    if (below) b.classList.add('below');
    b.style.left = `${Math.max(48, Math.min(window.innerWidth - 48, x))}px`;
    b.style.top = `${y}px`;
    page.append(b);
    emoteBubbles.set(seat, b);
    sfx('toggle', { volume: 0.6 });
    setTimeout(() => {
      b.remove();
      if (emoteBubbles.get(seat) === b) emoteBubbles.delete(seat);
    }, EMOTE_SHOW_MS);
  };
  /** 방 채널로 받은 한마디 (믿지 않는다: 모양 · 사람이 앉은 자리 · 간격을 확인한 것만 띄운다) */
  function takeEmote(msg: unknown) {
    if (closed) return;
    const humans = seats.filter((s) => s.user_id && !s.left_game).map((s) => s.seat_no);
    const e = parseEmote(msg, humans, mySeatRow()?.seat_no ?? null);
    if (!e) return;
    const now = performance.now();
    if (!emoteReady(emoteSeenAt.get(e.seat) ?? -EMOTE_GAP_MS, now, EMOTE_GAP_MS - 300)) return;
    emoteSeenAt.set(e.seat, now);
    showEmote(e.seat, e.text);
  }
  const emoteBtn = root.querySelector<HTMLButtonElement>('#emote');
  const emotePop = root.querySelector<HTMLElement>('#emote-pop');
  function closeEmotePop() {
    if (!emotePop || emotePop.hidden) return;
    emotePop.hidden = true;
    emoteBtn?.setAttribute('aria-expanded', 'false');
  }
  const onDocDown = (e: Event) => {
    const el = e.target as Element | null;
    if (el && (emotePop?.contains(el) || el.closest?.('.emote-btn'))) return;
    closeEmotePop();
  };
  document.addEventListener('pointerdown', onDocDown);
  /** 한마디 고르는 판 열기/닫기 (from: 누른 버튼 — 상단 바의 💬 또는 결과 창 안의 💬) */
  function toggleEmotePop(from: HTMLElement) {
    if (!emotePop) return;
    if (!emotePop.hidden) return closeEmotePop();
    // 버튼 바로 아래 (아래에 틈이 없으면 위), 화면 밖으로 나가지 않게
    const r = from.getBoundingClientRect();
    emotePop.hidden = false;
    const w = emotePop.offsetWidth;
    const h = emotePop.offsetHeight;
    const top = r.bottom + 8 + h > window.innerHeight - 8 ? r.top - 8 - h : r.bottom + 8;
    emotePop.style.top = `${Math.max(8, top)}px`;
    emotePop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    emoteBtn?.setAttribute('aria-expanded', 'true');
  }
  emoteBtn?.addEventListener('click', () => toggleEmotePop(emoteBtn));
  emotePop?.querySelectorAll<HTMLButtonElement>('[data-emote]').forEach((b) =>
    b.addEventListener('click', () => {
      closeEmotePop();
      const mine = mySeatRow();
      const i = Number(b.dataset.emote);
      // 관전자는 보기만. 보내기는 1.5초에 한 번
      if (closed || !mine || !EMOTES[i]) return;
      const now = performance.now();
      if (!emoteReady(emoteSentAt, now)) return void toast('한마디는 잠깐 쉬었다가 보낼 수 있어요');
      emoteSentAt = now;
      showEmote(mine.seat_no, EMOTES[i]);
      cast?.emote?.({ seat: mine.seat_no, i });
      // 다음에 보낼 수 있을 때까지 버튼을 흐리게 (상단 바 + 결과 창 안)
      const btns = [...document.querySelectorAll<HTMLButtonElement>('.emote-btn')];
      btns.forEach((x) => (x.disabled = true));
      setTimeout(() => !closed && btns.forEach((x) => (x.disabled = false)), EMOTE_GAP_MS);
    }),
  );

  if (ui.local) {
    const maxEvent = (s: StateRow) => ((s.public_state?.events as GameEventLite[] | undefined) ?? []).reduce((a, e) => Math.max(a, e.id), 0);
    local = ui.local({
      roomId,
      get: () => ({ room, seats, mySeat: mySeatRow()?.seat_no ?? null }),
      api: {
        sync: () => m.room.soloSync(roomId),
        // 사람이 둘인 판: 내 행동을 하나씩 서버에 (진행 수와 함께), 상대 화면에는 방 채널로 바로
        act: (payload, n) => m.room.act(roomId, payload, n),
        cast: (msg) => cast?.send(msg),
        replay: (p) => m.room.soloReplay(roomId, p),
        replayOnExit: (p) => m.room.soloReplayOnExit(roomId, p),
      },
      // 실시간으로 받은 것과 같은 길: 상태는 재생 대기열로, 내 패는 그 상태와 함께
      push: (s, p) => {
        if (closed) return;
        enqueueState(s);
        takePrivate(p);
      },
      // 연출 없이 바로 (다시 불러올 때와 같은 길)
      jump: (s, p) => {
        if (closed) return;
        queue.length = 0;
        epoch++;
        playingNext = null;
        pendingPriv = undefined;
        unbusy();
        st = s;
        priv = p;
        replayRound = s.round_no;
        replaySeen = maxEvent(s);
        lastEvent = replaySeen;
        cutinRound = s.round_no;
        if (room?.status === 'playing' && !s.public_state?.result) liveRound = s.round_no;
        paint();
      },
      settled: async () => {
        for (let i = 0; i < 2000 && !closed; i++) {
          if (replaying || queue.length) {
            await sleep(60);
            continue;
          }
          const wait = Math.max(animEnd, cutinUntil) - performance.now();
          if (wait <= 0) return;
          await sleep(wait + 40);
        }
      },
      setDeadline: (iso) => {
        if (st && !closed) st = { ...st, turn_deadline: iso };
      },
      reload: () => reloadAll(),
      refresh: () => !closed && paint(),
      toast,
      outdated: () => !closed && showOutdated(),
    });
  }
  // 페이지를 떠날 때 (닫기 · 새로고침 · 다른 곳으로): 기기에서 둔 데까지를 서버에 맞춰 둔다
  const onPageHide = () => void local?.flush('pagehide').catch(() => undefined);
  window.addEventListener('pagehide', onPageHide);
  const touch = setInterval(() => void m.room.touchRoom(roomId), m.room.TOUCH_MS);
  void m.room.touchRoom(roomId);
  // 백그라운드 탭에서는 타이머가 느려지므로, 다시 보이면 바로 신호를 보내고 상태를 다시 읽는다
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    void m.room.touchRoom(roomId);
    void reloadAll();
  };
  document.addEventListener('visibilitychange', onVisible);
  // 화면이 가려질 때 (다른 앱·탭으로): 기기에서 둔 데까지를 서버에 맞춰 둔다 → 오래 자리를 비워 서버 AI 가 대신 두게 돼도 내가 둔 데서 이어진다
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && !closed) void local?.flush('pagehide').catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onHidden);

  function cleanup() {
    // 이미 정리했으면 다시 하지 않는다 (나가기를 두 번 눌러도 로비 채널·리스너가 겹치지 않게)
    if (closed) return;
    closed = true;
    unwatch();
    clearInterval(touch);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('visibilitychange', onHidden);
    document.removeEventListener('pointerdown', onDocDown);
    window.removeEventListener('pagehide', onPageHide);
    local?.dispose();
    try {
      cast?.close();
    } catch {
      /* 무시 */
    }
    ro.disconnect();
    unbusy();
    if (walletTimer) clearTimeout(walletTimer);
    if (privWaitTimer) clearTimeout(privWaitTimer);
    try {
      ui.leave?.();
    } catch (e) {
      console.warn('leave', e);
    }
    game.destroy(true);
    // Phaser 가 떼지 않고 남기는 것들 (위 참고)
    for (const l of phaserDocListeners) document.removeEventListener(l.type, l.fn, l.opts);
    phaserDocListeners.length = 0;
    if (phaserBlur && window.onblur === phaserBlur) window.onblur = null;
    if (phaserFocus && window.onfocus === phaserFocus) window.onfocus = null;
  }

  let leaving = false;
  $(root, '#leave').addEventListener('click', async (e) => {
    // 두 번 눌러도 한 번만 나간다 (leaveRoom·cleanup·showLobby 가 겹치면 첫 로비의 채널·리스너가 남는다)
    if (closed || leaving) return;
    leaving = true;
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (room?.status === 'playing' && mySeatRow() && !confirm(`게임 중이에요. ${LEAVE_NOTE[ui.game] ?? '나가면 이번 판은 AI가 대신하고 결과는 내 지갑에 반영돼요.'} 나갈까요?`)) {
      leaving = false;
      btn.disabled = false;
      return;
    }
    // 기기에서 둔 데까지를 먼저 서버에 보낸다 (그 뒤는 서버 AI 가 이어 둔다)
    await local?.flush('leave').catch(() => undefined);
    await m.room.leaveRoom(roomId).catch(() => undefined);
    // 기다리는 사이 다른 경로(방이 사라짐·자리 정리)가 이미 정리하고 로비를 띄웠으면 또 띄우지 않는다
    if (closed) return;
    cleanup();
    void showLobby(ui, m, me);
  });
  $(root, '#invite').addEventListener('click', async () => {
    const link = location.href;
    try {
      await navigator.clipboard.writeText(link);
      toast('초대 링크를 복사했어요');
    } catch {
      prompt('이 링크를 보내 주세요', link);
    }
  });

  await reloadAll();
}

/** 십이지신 얼굴을 원 모양으로 잘라 둔다 (avc-<id>): 이름패의 원 안에 꼭 맞게 */
function makeRoundAvatars(scene: PhaserNS.Scene, ids: readonly string[]) {
  const S = 128;
  for (const id of ids) {
    const key = `avc-${id}`;
    if (scene.textures.exists(key) || !scene.textures.exists(`av-${id}`)) continue;
    const src = scene.textures.get(`av-${id}`).getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas(key, S, S);
    if (!tex || !src.width) continue;
    const c = tex.context;
    c.save();
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    // 얼굴 그림이 원 안에 다 들어오게 조금 줄여서 가운데 (아래로 살짝)
    const k = (S * 0.86) / Math.max(src.width, src.height);
    const w = src.width * k;
    const h = src.height * k;
    c.drawImage(src, (S - w) / 2, (S - h) / 2 + S * 0.04, w, h);
    c.restore();
    tex.refresh();
  }
}

/** 천천히 출발해 빨라졌다가 천천히 멈춘다 (cubic in-out) */
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
