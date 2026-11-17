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
  type GameId,
  type PrivateRow,
  type RoomModule,
  type RoomRow,
  type SeatRow,
  type StateRow,
  type Wallet,
  type WalletModule,
  type WorldUser,
  type ZodiacModule,
} from './world.ts';

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
  pending: number[];
  myTurn: boolean;
  /** 서버로 행동 보내기 (실패하면 알림) → 서버가 받았으면 true */
  act(payload: unknown): Promise<boolean>;
  busy: boolean;
  fmt(n: number): string;
  avatarUrl(id: string): string;
  seatName(seat: number): string;
  seatAvatar(seat: number): string;
  /** 다시 그리기 요청 (테이블 + 아래 버튼) */
  redraw(): void;
  /** 테이블만 다시 그리기 (아래 버튼은 그대로: 누르던 버튼·포커스가 끊기지 않게) */
  redrawTable(): void;
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
  /** 먹는 패: 먼저 이 자리(바닥)에 내려앉았다가 '가져가기' 차례에 목표로 */
  via?: { x: number; y: number };
  /** 경유점에서 떠나는 시각 (지금부터 ms, 기본: 가져가기 차례) */
  viaLeave?: number;
  /** 경유점에서의 크기 배율 (바닥 패 크기 ÷ 목표 크기) */
  viaScale?: number;
  /** 뒤집으며 출발 (더미에서 뒤집은 패) */
  flip?: boolean;
  /** 날아가서 내려앉는 순간 한 번 (찰싹 효과 등). 경유점이 있으면 경유점에 내려앉을 때 */
  onLand?: () => void;
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
  /** 판 도중에도 지갑이 바뀌는 게임 (룰렛: 확정 때 빠지고 결과 때 들어온다) → 상태가 올 때마다 금액을 다시 읽는다 */
  liveWallet?: boolean | ((pub: any) => number);
  /** AI가 없는 게임 (룰렛): 빈자리는 자리 줄·방 목록에 보이지 않는다 */
  noAi?: boolean;
  /** 카드를 한 장씩 나눠 줄 때 간격(ms). 기본 110 */
  dealGap?: number;
  /** 대기방 '게임 방법' 창 내용 (HTML). 없으면 버튼을 숨긴다 */
  manual?: string;
  /** Phaser에 미리 불러올 그림 (key → url) */
  preload?(scene: PhaserNS.Scene, avatarUrl: (id: string) => string): void;
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

export async function bootGame(ui: GameUI) {
  document.title = ui.title;
  linkThemeCss();
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
      <h2>방 만들기</h2>
      <div class="grid2">
        <label>방 이름<input id="c-name" maxlength="20" placeholder="${esc(me.nickname)}의 방"/></label>
        <label>비밀번호 (선택)<input id="c-pw" maxlength="20" type="password" autocomplete="new-password" placeholder="없으면 공개방"/></label>
      </div>
      <div class="units" id="units"></div>
      <div class="me-row"><button class="av-btn" id="c-av"></button><span id="refill-box"></span>
        <button class="btn primary big" id="c-go">방 만들기 ▶</button></div>
      <p class="hint" id="c-hint"></p>
    </section>
    <section class="card"><h2>방 목록</h2><div id="rooms" class="rooms"><p class="empty">불러오는 중…</p></div></section>
  </div>`;
  const root = app();

  const paintAvatar = () => {
    const a = m.z.ZODIAC.find((x) => x.id === avatar)!;
    $(root, '#c-av').innerHTML = `<img src="${m.z.avatarUrl(avatar)}" alt=""/><span>${a.nick}<small>${a.name} · 바꾸기</small></span>`;
  };
  let alive = true;
  const paintMoney = () => {
    if (!alive) return;
    $(root, '#money').textContent = wallet ? `${cur === 'nyang' ? '💰' : '🪙'} ${m.wallet.formatAmount(wallet[cur])}${unit}` : '-';
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
      ? `<button class="btn" id="refill">무료 충전 (오늘 ${wallet![`${cur}RefillsLeft`]}번 남음)</button>`
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
            const full = open === 0;
            const playing = r.status === 'playing';
            return `<div class="room-row ${playing ? 'playing' : ''}">
              <div class="rn">${r.has_password ? '🔒 ' : ''}${esc(r.name)}
                <small>기본 ${m.wallet.formatAmount(r.base_unit)} · ${humans.map((h) => esc(h.nickname)).join(', ')}${ui.noAi ? ` · ${humans.length}/${seats.length}명` : ais ? ` · AI ${ais}` : ''}</small></div>
              <span class="st">${playing ? '게임 중' : '대기'}</span>
              <button class="btn ${full ? '' : 'primary'}" data-id="${r.id}" data-pw="${r.has_password ? 1 : 0}" ${full ? 'disabled' : ''}>${full ? '가득 참' : playing && !ui.noAi ? '관전·예약' : '입장'}</button>
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
  const unbusy = () => {
    busy = false;
    busySince = null;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = null;
  };
  let closed = false;
  let lastEvent = -1;
  let resultShownFor = -1;
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
  const ORDER_AT = [0, 760, 1650];
  const MOVE_MS = 560;
  const moveEnd = (r: MoveRec) => (r.via ? r.s2 : r.s1) + MOVE_MS;
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
    const p1 = Math.min(1, (t - r.s1) / MOVE_MS);
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
  /** 진행 중인 카드 연출이 끝나는 시각 (컷인·결과 창은 그 뒤에) */
  let animEnd = 0;
  const afterAnim = (fn: () => void) => {
    const wait = animEnd - performance.now();
    if (wait <= 0) fn();
    else setTimeout(() => !closed && fn(), wait + 150);
  };

  app().innerHTML = `<div class="table-page">
    <header class="bar"><button class="btn ghost" id="leave">← 나가기</button>
      <h1>${esc(room.name)} <small>${ui.icon} 기본 ${m.wallet.formatAmount(room.base_unit)}</small></h1>
      <span class="money" id="money">-</span><button class="btn small" id="invite">🔗 초대</button></header>
    <div class="seats" id="seats"></div>
    <div class="stage" id="stage"></div>
    <div class="timer"><i id="timer"></i></div>
    <div class="controls" id="controls"></div>
    <div class="cutin" id="cutin"></div>
  </div>`;
  const root = app();

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
    return {
      scene,
      Phaser,
      room,
      seats,
      me,
      mySeat: mine?.seat_no ?? null,
      resultSeat: priv && st && priv.round_no === st.round_no ? priv.seat_no : null,
      pub: (room.status === 'playing' || st?.public_state?.result) && st?.round_no ? st.public_state : null,
      priv: priv && st && priv.round_no === st.round_no ? priv.hand : null,
      pending,
      myTurn: !!mine && room.status === 'playing' && pending.includes(mine.seat_no),
      act: async (payload) => {
        if (busy) return false;
        busy = true;
        busySince = st?.updated_at ?? null;
        paintControls();
        try {
          await m.room.act(roomId, payload);
          // 새 상태(실시간)가 도착하면 풀린다. 혹시 안 오면 3초 뒤에 푼다
          if (busy && st?.updated_at === busySince) {
            busyTimer = setTimeout(() => {
              unbusy();
              paintControls();
            }, 3000);
            return true;
          }
          unbusy();
        } catch (e) {
          toast(m.room.friendly(e));
          unbusy();
          paintControls();
          return false;
        }
        paintControls();
        return true;
      },
      busy,
      fmt: (n) => m.wallet.formatAmount(n),
      avatarUrl: m.z.avatarUrl,
      seatName: (n) => seats.find((s) => s.seat_no === n)?.nickname ?? `자리 ${n + 1}`,
      seatAvatar: (n) => seats.find((s) => s.seat_no === n)?.avatar ?? 'tiger',
      redraw: () => paint(),
      redrawTable: () => drawTableOnly(),
      dpr: DPR,
      track: (obj, key, opts = {}) => {
        const round = st?.round_no ?? 0;
        if (round !== moveRound) {
          moveRound = round;
          moves.clear();
          movesSnap.clear();
        }
        const now = performance.now();
        const tx = obj.x;
        const ty = obj.y;
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
          const animate = dealReady && !reduceMotion && (prev ? true : !!opts.from);
          const s1 = now + ORDER_AT[Math.min(2, opts.order ?? 0)] + (animate ? (opts.delay ?? 0) : 0);
          const via = animate && opts.via ? opts.via : null;
          rec = {
            x: tx,
            y: ty,
            fromX: animate ? fx : tx,
            fromY: animate ? fy : ty,
            via,
            s1,
            // 경유점(바닥)에 내려앉은 뒤 '가져가기' 차례에 떠난다
            s2: via ? Math.max(s1 + MOVE_MS + 120, now + (opts.viaLeave ?? ORDER_AT[2])) : s1,
            flip: animate && !!opts.flip,
            scale0: animate && opts.fromScale && Math.abs(opts.fromScale - 1) > 0.05 ? opts.fromScale : 1,
            viaScale: via ? (opts.viaScale ?? 1) : 1,
          };
          moves.set(key, rec);
          if (animate && opts.onLand && scene) {
            const land = opts.onLand;
            scene.time.delayedCall(Math.max(0, rec.s1 + MOVE_MS - now), () => !closed && land());
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
          obj.setDepth(t >= r.s1 && t < end ? 11 : 10);
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

  const paintSeats = () => {
    const pending = room?.status === 'playing' ? (st?.pending_seats ?? []) : [];
    $(root, '#seats').innerHTML = seats
      .filter((s) => !ui.noAi || (s.user_id && !s.left_game) || s.pending_user_id)
      .map((s) => {
        const human = !!s.user_id && !s.left_game;
        const meHere = s.user_id === me.userId && !s.left_game;
        const tag = room?.status === 'playing'
          ? pending.includes(s.seat_no) ? '<b class="turn">차례</b>' : s.left_game ? '<em>AI 대신</em>' : ''
          : human ? (s.ready ? '<b class="ready">레디</b>' : '<em>대기</em>') : '<em>AI</em>';
        return `<div class="seat ${meHere ? 'me' : ''} ${human ? '' : 'ai'}">
          <img src="${m.z.avatarUrl(s.avatar)}" alt=""/><span class="nm">${esc(s.nickname)}${meHere ? ' (나)' : ''}${room?.host_id && s.user_id === room.host_id ? ' 👑' : ''}</span>${tag}
          ${s.pending_user_id ? `<small>다음 판: ${esc(s.pending_nickname ?? '')}</small>` : ''}</div>`;
      })
      .join('');
  };

  const paintControls = () => {
    if (closed) return;
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
        c.busy = busy;
        el.innerHTML = '';
        ui.controls(c, el);
      }
      return;
    }
    // 대기 중
    if (spectator) {
      el.innerHTML = '<p class="msg">자리를 기다리는 중이에요…</p>';
      return;
    }
    const enough = !!wallet && wallet[cur] >= m.wallet.minEntry(room.base_unit);
    const allHumansReady = seats.filter((x) => x.user_id && !x.left_game).every((x) => x.ready);
    el.innerHTML = `<div class="row">
      <button class="btn" id="av">🐾 동물 바꾸기</button>
      ${ui.manual ? '<button class="btn" id="manual">📖 게임 방법</button>' : ''}
      ${!enough && m.wallet.canRefill(wallet, cur, room.base_unit) ? `<button class="btn" id="refill">무료 충전</button>` : ''}
      <button class="btn big ${mine.ready ? '' : 'primary'}" id="ready" ${enough ? '' : 'disabled'}>${mine.ready ? '레디 취소' : '레디 ▶'}</button>
    </div>
    <p class="msg">${!enough ? `${m.wallet.formatAmount(m.wallet.minEntry(room.base_unit))}${unit} 이상 있어야 해요` : !mine.ready ? '레디를 누르면 시작해요' : allHumansReady ? '모두 레디! 곧 시작해요…' : '다른 사람을 기다리는 중… 사람이 모두 레디하면 시작해요'}</p>`;
    el.querySelector('#ready')?.addEventListener('click', async () => {
      try {
        await m.room.setReady(roomId, !mine.ready);
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
    if (!c || !res || room?.status !== 'waiting' || !st || resultShownFor === st.round_no) return;
    resultShownFor = st.round_no;
    afterAnim(() => showResultBox(c));
  };
  const showResultBox = (c: TableCtx) => {
    const d = document.createElement('div');
    d.className = 'modal';
    // 내가 이긴 판이면 별·색종이
    const deltas = (st?.public_state?.deltas ?? null) as Record<string, number> | null;
    const won = c.resultSeat !== null && (deltas?.[String(c.resultSeat)] ?? 0) > 0;
    const sparkles = won
      ? Array.from({ length: 10 }, (_, i) => `<span class="sparkle" style="left:${4 + ((i * 37) % 90)}%;top:${-4 + ((i * 53) % 100)}%;animation-delay:${(i * 0.15).toFixed(2)}s">${i % 2 ? '★' : '✦'}</span>`).join('')
      : '';
    d.innerHTML = `<div class="box result ${won ? 'win' : ''}">${sparkles}${ui.resultHtml(c)}<div class="row"><button class="btn primary" data-x>확인</button></div></div>`;
    document.body.append(d);
    $(d, '[data-x]').addEventListener('click', () => d.remove());
    void m.wallet.ensureWallet().then((w) => ((wallet = w), paintMoney(), paintControls()));
  };

  const showCutins = () => {
    if (closed) return;
    const c = ctx();
    const events = (st?.public_state?.events as GameEventLite[] | undefined) ?? [];
    const maxId = events.reduce((a, e) => Math.max(a, e.id), 0);
    if (lastEvent < 0 || !c) {
      lastEvent = maxId;
      return;
    }
    if (maxId < lastEvent) lastEvent = 0; // 새 판
    const fresh = events.filter((e) => e.id > lastEvent);
    lastEvent = maxId;
    const hits = fresh.map((e) => ({ e, text: ui.cutin?.(e, c) })).filter((x): x is { e: GameEventLite; text: string } => !!x.text);
    if (!hits.length) return;
    const { e, text } = hits[hits.length - 1];
    const av = typeof e.seat === 'number' ? c.seatAvatar(e.seat) : null;
    afterAnim(() => {
      const el = $(root, '#cutin');
      el.innerHTML = `<div>${av ? `<img src="${m.z.fullUrl(av)}" alt=""/>` : ''}<span>${esc(text)}</span></div>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    });
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
      void m.room.startRound(roomId).catch(() => undefined);
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

  function drawTableOnly() {
    if (closed) return;
    const c = ctx();
    if (!c) return;
    c.scene.children.removeAll(true);
    c.scene.tweens.killAll();
    dealSeq = 0;
    movesSnap = new Map(moves);
    ui.draw(c);
    sharpenText(c.scene.children.list);
  }

  function paint() {
    if (closed) return;
    maybeStart();
    paintSeats();
    const c = ctx();
    if (c) {
      c.scene.children.removeAll(true);
      c.scene.tweens.killAll();
      dealSeq = 0;
      movesSnap = new Map(moves);
      ui.draw(c);
      sharpenText(c.scene.children.list);
      // 처음 그린 뒤부터 연출 (들어오자마자 모든 카드가 날아오지 않게)
      // 대기실에서 시작을 본 경우도 (첫 판 나눠 주기 연출)
      if (st?.public_state || room?.status === 'waiting') dealReady = true;
    }
    paintControls();
  }

  // 차례 타이머
  const timer = setInterval(() => {
    const bar = $(root, '#timer');
    if (!st?.turn_deadline || room?.status !== 'playing') {
      bar.style.width = '0';
      return;
    }
    const left = Math.max(0, new Date(st.turn_deadline).getTime() - Date.now());
    bar.style.width = `${Math.min(100, (left / 20000) * 100)}%`;
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
    room = r;
    seats = s;
    st = gs;
    priv = p;
    if (w) wallet = w;
    if (firstLoad && st && r.status === 'waiting') resultShownFor = st.round_no;
    firstLoad = false;
    paintMoney();
    paint();
    showCutins();
    paintResult();
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
      paint();
    },
    onState: (s) => {
      if (closed) return;
      if (busy && s.updated_at !== busySince) unbusy();
      st = s;
      if (ui.liveWallet) refreshWallet(typeof ui.liveWallet === 'function' ? ui.liveWallet(s.public_state) : 400);
      paint(); // 먼저 그려야 카드 연출 시각을 안다 (컷인·결과는 그 뒤)
      showCutins();
      paintResult();
    },
    onPrivate: (p) => {
      if (closed) return;
      priv = p;
      paint();
    },
    onResync: () => void reloadAll(),
  });
  const touch = setInterval(() => void m.room.touchRoom(roomId), m.room.TOUCH_MS);
  void m.room.touchRoom(roomId);
  // 백그라운드 탭에서는 타이머가 느려지므로, 다시 보이면 바로 신호를 보내고 상태를 다시 읽는다
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    void m.room.touchRoom(roomId);
    void reloadAll();
  };
  document.addEventListener('visibilitychange', onVisible);

  function cleanup() {
    closed = true;
    unwatch();
    clearInterval(touch);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    ro.disconnect();
    unbusy();
    game.destroy(true);
  }

  $(root, '#leave').addEventListener('click', async () => {
    if (room?.status === 'playing' && mySeatRow() && !confirm('게임 중이에요. 나가면 이번 판은 AI가 대신하고 결과는 내 지갑에 반영돼요. 나갈까요?')) return;
    await m.room.leaveRoom(roomId).catch(() => undefined);
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
