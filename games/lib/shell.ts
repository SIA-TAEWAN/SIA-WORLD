/**
 * 맞고 · 포커 · 블랙잭 공용 화면 틀.
 *   로그인 확인 → 방 목록(만들기/입장) → 방 화면(자리 · 레디 · 게임 테이블 · 조작 · 결과 · 컷인)
 * 게임마다 다른 부분(테이블 그림, 조작 버튼, 결과 요약, 컷인 문구)은 GameUI로 받는다.
 */
import type PhaserNS from 'phaser';
import './style.css';
import {
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
  pub: P | null;
  priv: Q | null;
  pending: number[];
  myTurn: boolean;
  /** 서버로 행동 보내기 (실패하면 알림) */
  act(payload: unknown): Promise<void>;
  busy: boolean;
  fmt(n: number): string;
  avatarUrl(id: string): string;
  seatName(seat: number): string;
  seatAvatar(seat: number): string;
  /** 다시 그리기 요청 */
  redraw(): void;
}

export interface GameUI<P = any, Q = any> {
  game: GameId;
  title: string;
  icon: string;
  /** 방 목록에서 '← 뒤로' 갈 곳 (SIA WORLD 최상위 기준 상대 경로) */
  back: string;
  backLabel: string;
  /** 테이블 바탕색 */
  felt: number;
  /** Phaser 테이블 그리기 (매번 지우고 새로 그린다) */
  draw(t: TableCtx<P, Q>): void;
  /** 게임 중 조작 버튼 (el을 채운다) */
  controls(t: TableCtx<P, Q>, el: HTMLElement): void;
  /** 판 결과 요약 HTML (pub.result가 있을 때) */
  resultHtml(t: TableCtx<P, Q>): string;
  /** 컷인 문구 (없으면 null) */
  cutin?(ev: GameEventLite, t: TableCtx<P, Q>): string | null;
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
        <img src="${z.avatarUrl(a.id)}" alt=""/><span>${a.name}</span></button>`,
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
  document.documentElement.style.setProperty('--felt', `#${ui.felt.toString(16).padStart(6, '0')}`);
  app().innerHTML = '<div class="center">불러오는 중…</div>';
  let me: WorldUser;
  let mods: Mods;
  try {
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
        <button class="btn primary big" id="c-go">방 만들기</button></div>
      <p class="hint" id="c-hint"></p>
    </section>
    <section class="card"><h2>방 목록</h2><div id="rooms" class="rooms"><p class="empty">불러오는 중…</p></div></section>
  </div>`;
  const root = app();

  const paintAvatar = () => {
    const a = m.z.ZODIAC.find((x) => x.id === avatar)!;
    $(root, '#c-av').innerHTML = `<img src="${m.z.avatarUrl(avatar)}" alt=""/><span>${a.name}<small>바꾸기</small></span>`;
  };
  const paintMoney = () => {
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
    box.innerHTML = m.wallet.canRefill(wallet, cur, baseUnit)
      ? `<button class="btn" id="refill">무료 충전 (오늘 ${wallet![`${cur}RefillsLeft`]}번 남음)</button>`
      : '';
    box.querySelector('#refill')?.addEventListener('click', async () => {
      try {
        const r = await m.wallet.refill(cur, baseUnit);
        wallet = r;
        toast(r.ok ? `10,000${unit}으로 채웠어요` : r.reason === 'limit' ? '오늘 무료 충전을 모두 썼어요' : '아직 충분해요');
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
    } catch (e) {
      $(root, '#rooms').innerHTML = `<p class="empty">${esc(m.room.friendly(e))}</p>`;
      return;
    }
    $(root, '#rooms').innerHTML = rooms.length
      ? rooms
          .map((r) => {
            const seats = r.seats ?? [];
            const humans = seats.filter((s) => s.user_id && !s.left_game);
            const ais = seats.filter((s) => !s.user_id || s.left_game).length;
            const full = ais === 0;
            const playing = r.status === 'playing';
            return `<div class="room-row ${playing ? 'playing' : ''}">
              <div class="rn">${r.has_password ? '🔒 ' : ''}${esc(r.name)}
                <small>기본 ${m.wallet.formatAmount(r.base_unit)} · ${humans.map((h) => esc(h.nickname)).join(', ')}${ais ? ` · AI ${ais}` : ''}</small></div>
              <span class="st">${playing ? '게임 중' : '대기'}</span>
              <button class="btn ${full ? '' : 'primary'}" data-id="${r.id}" data-pw="${r.has_password ? 1 : 0}" ${full ? 'disabled' : ''}>${full ? '가득 참' : playing ? '관전·예약' : '입장'}</button>
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
    unwatch();
    window.removeEventListener('focus', onFocus);
  };
  await Promise.all([loadWallet(), paintRooms()]);
}

// ---------- 방 ----------

async function enterRoom(ui: GameUI, m: Mods, me: WorldUser, roomId: string, password = '') {
  app().innerHTML = '<div class="center">방에 들어가는 중…</div>';
  let avatar = m.z.lastAvatar(me.userId);
  for (let tries = 0; tries < 4; tries++) {
    try {
      const r = await m.room.joinRoom(roomId, password, avatar);
      if (r.pending) toast('게임이 진행 중이에요. 이번 판은 구경하고 다음 판부터 참여해요');
      break;
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
  let closed = false;
  let lastEvent = -1;
  let resultShownFor = -1;

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
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: stage,
    backgroundColor: ui.felt,
    scale: { mode: Phaser.Scale.RESIZE, width: stage.clientWidth || 800, height: stage.clientHeight || 400 },
    banner: false,
    scene: {
      key: 'table',
      preload(this: PhaserNS.Scene) {
        for (const z of m.z.ZODIAC_IDS) this.load.image(`av-${z}`, m.z.avatarUrl(z));
        ui.preload?.(this, m.z.avatarUrl);
      },
      create(this: PhaserNS.Scene) {
        scene = this;
        this.scale.on('resize', () => paint());
        paint();
      },
    },
  });

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
      pub: (room.status === 'playing' || st?.public_state?.result) && st?.round_no ? st.public_state : null,
      priv: priv && st && priv.round_no === st.round_no ? priv.hand : null,
      pending,
      myTurn: !!mine && room.status === 'playing' && pending.includes(mine.seat_no),
      act: async (payload) => {
        if (busy) return;
        busy = true;
        paintControls();
        try {
          await m.room.act(roomId, payload);
        } catch (e) {
          toast(m.room.friendly(e));
        } finally {
          busy = false;
          paintControls();
        }
      },
      busy,
      fmt: (n) => m.wallet.formatAmount(n),
      avatarUrl: m.z.avatarUrl,
      seatName: (n) => seats.find((s) => s.seat_no === n)?.nickname ?? `자리 ${n + 1}`,
      seatAvatar: (n) => seats.find((s) => s.seat_no === n)?.avatar ?? 'tiger',
      redraw: () => paint(),
    };
  };

  const paintMoney = () => {
    $(root, '#money').textContent = wallet ? `${cur === 'nyang' ? '💰' : '🪙'} ${m.wallet.formatAmount(wallet[cur])}${unit}` : '-';
  };

  const paintSeats = () => {
    const pending = room?.status === 'playing' ? (st?.pending_seats ?? []) : [];
    $(root, '#seats').innerHTML = seats
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
    el.innerHTML = `<div class="row">
      <button class="btn" id="av">🐾 동물 바꾸기</button>
      ${!enough && m.wallet.canRefill(wallet, cur, room.base_unit) ? `<button class="btn" id="refill">무료 충전</button>` : ''}
      <button class="btn big ${mine.ready ? '' : 'primary'}" id="ready" ${enough ? '' : 'disabled'}>${mine.ready ? '레디 취소' : '레디'}</button>
    </div>
    <p class="msg">${enough ? (mine.ready ? '다른 사람을 기다리는 중… 사람이 모두 레디하면 시작해요' : '레디를 누르면 시작해요') : `${m.wallet.formatAmount(m.wallet.minEntry(room.base_unit))}${unit} 이상 있어야 해요`}</p>`;
    el.querySelector('#ready')?.addEventListener('click', async () => {
      try {
        await m.room.setReady(roomId, !mine.ready);
      } catch (e) {
        toast(m.room.friendly(e));
      }
    });
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
        toast(r.ok ? `10,000${unit}으로 채웠어요` : '충전할 수 없어요');
      } catch (e) {
        toast(m.room.friendly(e));
      }
      paintMoney();
      paintControls();
    });
  };

  const paintResult = () => {
    const c = ctx();
    const res = st?.public_state?.result;
    if (!c || !res || room?.status !== 'waiting' || !st || resultShownFor === st.round_no) return;
    resultShownFor = st.round_no;
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="box result">${ui.resultHtml(c)}<div class="row"><button class="btn primary" data-x>확인</button></div></div>`;
    document.body.append(d);
    $(d, '[data-x]').addEventListener('click', () => d.remove());
    void m.wallet.ensureWallet().then((w) => ((wallet = w), paintMoney(), paintControls()));
  };

  const showCutins = () => {
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
    const texts = fresh.map((e) => ui.cutin?.(e, c)).filter((t): t is string => !!t);
    if (!texts.length) return;
    const el = $(root, '#cutin');
    el.innerHTML = `<div>${esc(texts[texts.length - 1])}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  };

  function paint() {
    if (closed) return;
    paintSeats();
    const c = ctx();
    if (c) {
      c.scene.children.removeAll(true);
      c.scene.tweens.killAll();
      ui.draw(c);
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
    if (!r) return gone();
    room = r;
    seats = s;
    st = gs;
    priv = p;
    if (w) wallet = w;
    paintMoney();
    showCutins();
    paint();
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
      if (!r) return gone();
      room = { ...room!, ...r };
      paint();
      paintResult();
    },
    onSeats: async () => {
      seats = await m.room.getSeats(roomId).catch(() => seats);
      if (!seats.some((s) => s.user_id === me.userId || s.pending_user_id === me.userId)) {
        // 오래 자리를 비워 정리되었으면
        toast('방에서 나와졌어요');
        cleanup();
        return void showLobby(ui, m, me);
      }
      paint();
    },
    onState: (s) => {
      st = s;
      showCutins();
      paint();
      paintResult();
    },
    onPrivate: (p) => {
      priv = p;
      paint();
    },
    onResync: () => void reloadAll(),
  });
  const touch = setInterval(() => void m.room.touchRoom(roomId), m.room.TOUCH_MS);
  void m.room.touchRoom(roomId);

  function cleanup() {
    closed = true;
    unwatch();
    clearInterval(touch);
    clearInterval(timer);
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
