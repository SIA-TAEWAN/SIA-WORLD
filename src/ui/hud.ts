import { ITEMS, WEAPONS } from '../game/data';
import type { Match } from '../game/match';
import type { TankState } from '../game/types';
import { TEAM_COLORS } from './teams';
import type { Input } from './input';
import type { GameChat } from '../scenes/GameScene';
import { sfx } from './sfx';

export interface HudView {
  power: number;
  charging: boolean;
  weapon: 0 | 1 | 2;
  itemSlot: number | null;
  timeLeft: number;
  /** 지금 내가 조종 중 (이동·발사·아이템 가능) */
  human: boolean;
  /** 파워 리미터 (%) */
  limit: number;
  /** 내 탱크가 없거나 탈락 → 구경만 */
  spectate: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Hud {
  readonly root: HTMLElement;
  private wind = el('div', 'wind');
  private timer = el('div', 'timer');
  private order = el('div', 'order');
  private banner = el('div', 'banner');
  private angleNum = el('div', 'angle-num');
  private dial = el('canvas', 'dial') as HTMLCanvasElement;
  private powerFill = el('div', 'power-fill');
  private powerLast = el('div', 'power-last');
  private powerNum = el('div', 'power-num');
  private powerLimit = el('div', 'power-limit');
  private limitLabel = el('label', 'limit-label', 'POWER');
  private moveFill = el('div', 'move-fill');
  private weapons: HTMLButtonElement[] = [];
  private items: HTMLButtonElement[] = [];
  private mini = el('canvas', 'minimap2') as HTMLCanvasElement;
  /** 미니맵을 누르면 맵의 그 위치(0~1)로 카메라를 옮긴다 */
  onMiniClick: ((fx: number, fy: number) => void) | null = null;
  private miniBase = document.createElement('canvas');
  private toastEl = el('div', 'toast');
  private lastTimer = -1;

  constructor(parent: HTMLElement, input: Input, touch: boolean, chat?: GameChat) {
    this.root = el('div', 'hud');
    const top = el('div', 'hud-top');
    const timerBox = el('div', 'timer-box');
    timerBox.append(this.timer);
    const mute = el('button', 'mute', sfx.muted ? '🔇' : '🔊') as HTMLButtonElement;
    mute.title = '소리 켜기/끄기';
    mute.onclick = () => sfx.toggleMute();
    this.offMute = sfx.onMute((m) => (mute.textContent = m ? '🔇' : '🔊'));
    top.append(timerBox, this.wind, this.order, mute);

    const bottom = el('div', 'hud-bottom');
    // 각도
    const angleBox = el('div', 'panel angle-box');
    this.dial.width = 84;
    this.dial.height = 84;
    angleBox.append(this.dial, this.angleNum);
    // 파워·이동
    const gauges = el('div', 'panel gauges');
    const pw = el('div', 'gauge power');
    pw.title = '마우스로 클릭(드래그)해서 파워 리미터 설정 · 오른쪽 끝을 누르면 해제';
    pw.append(this.powerFill, this.powerLimit, this.powerLast, this.powerNum);
    // 게이지를 누르거나 끌면 그 위치가 파워 리미터가 된다
    let dragging = false;
    const setAt = (e: PointerEvent) => {
      const r = pw.getBoundingClientRect();
      input.emit({ type: 'limit', value: ((e.clientX - r.left) / r.width) * 100 });
    };
    pw.addEventListener('pointerdown', (e) => {
      dragging = true;
      pw.setPointerCapture(e.pointerId);
      setAt(e);
    });
    pw.addEventListener('pointermove', (e) => dragging && setAt(e));
    pw.addEventListener('pointerup', () => (dragging = false));
    pw.addEventListener('pointercancel', () => (dragging = false));
    for (let i = 1; i < 10; i++) {
      const tick = el('i', 'tick');
      tick.style.left = `${i * 10}%`;
      pw.append(tick);
    }
    const mv = el('div', 'gauge move');
    mv.append(this.moveFill);
    gauges.append(this.limitLabel, pw, el('label', '', 'MOVE'), mv);
    // 무기
    const wbox = el('div', 'panel slots weapons');
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'slot') as HTMLButtonElement;
      b.onclick = () => input.emit({ type: 'weapon', slot: i as 0 | 1 | 2 });
      this.weapons.push(b);
      wbox.append(b);
    }
    // 아이템
    const ibox = el('div', 'panel slots items');
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'slot item') as HTMLButtonElement;
      b.onclick = () => input.emit({ type: 'item', slot: i });
      this.items.push(b);
      ibox.append(b);
    }
    // 미니맵: 화면 왼쪽 위 (맵 전체·탱크 위치·포탄)
    const miniBox = el('div', 'mini-top');
    this.mini.width = 200;
    this.mini.height = 100;
    miniBox.append(this.mini);
    miniBox.title = '눌러서 그 위치 보기';
    miniBox.addEventListener('pointerdown', (e) => {
      const r = this.mini.getBoundingClientRect();
      this.onMiniClick?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    bottom.append(angleBox, gauges, wbox, ibox);

    this.root.append(top, miniBox, this.banner, this.toastEl, bottom);
    if (chat) this.buildChat(chat);

    if (touch) {
      const pad = el('div', 'touch-pad');
      const mk = (cls: string, label: string, key: 'left' | 'right' | 'up' | 'down' | 'fire') => {
        const b = el('button', `tbtn ${cls}`, label) as HTMLButtonElement;
        input.bindHold(b, key);
        return b;
      };
      const lr = el('div', 'tgroup lr');
      lr.append(mk('l', '◀', 'left'), mk('r', '▶', 'right'));
      const ud = el('div', 'tgroup ud');
      ud.append(mk('u', '▲', 'up'), mk('d', '▼', 'down'));
      const right = el('div', 'tgroup right');
      right.append(mk('fire', '발사', 'fire'), ud);
      pad.append(lr, right);
      this.root.append(pad);
    }
    parent.append(this.root);
    // 아래 조작판 높이에 맞춰 터치 버튼 위치를 잡는다
    this.bottomEl = bottom;
    const sync = () => this.root.style.setProperty('--hud-h', `${bottom.offsetHeight}px`);
    sync();
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(sync);
      this.ro.observe(bottom);
    }
  }

  private bottomEl: HTMLElement;
  private offMute: () => void;
  private ro: ResizeObserver | null = null;

  private chatOff: (() => void) | null = null;

  /** 게임 중 채팅: Enter로 열고 보내기, Esc로 닫기. 최근 메시지는 잠깐 보였다 흐려진다 */
  private buildChat(chat: GameChat) {
    const box = el('div', 'game-chat');
    const log = el('div', 'gc-log');
    const form = el('form', 'gc-form hidden') as HTMLFormElement;
    const inp = el('input') as HTMLInputElement;
    inp.maxLength = 120;
    inp.placeholder = '채팅 입력 후 Enter (Esc 닫기)';
    inp.autocomplete = 'off';
    form.append(inp);
    const btn = el('button', 'gc-btn', '💬') as HTMLButtonElement;
    btn.title = '채팅 (Enter)';
    box.append(log, form, btn);
    this.root.append(box);
    let shown = 0;
    const render = () => {
      const msgs = chat.chat.slice(-6);
      log.innerHTML = msgs
        .map((c, i) => `<p class="${c.system ? 'sys' : ''} ${i >= msgs.length - (chat.chat.length - shown) ? 'new' : ''}">${c.system ? '' : `<b>${escapeHtml(c.name)}</b> `}${escapeHtml(c.text)}</p>`)
        .join('');
      shown = chat.chat.length;
      box.classList.add('active');
      clearTimeout(fade);
      fade = setTimeout(() => form.classList.contains('hidden') && box.classList.remove('active'), 6000);
    };
    let fade: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      form.classList.remove('hidden');
      box.classList.add('active');
      inp.focus();
    };
    const close = () => {
      form.classList.add('hidden');
      inp.value = '';
      inp.blur();
      fade = setTimeout(() => box.classList.remove('active'), 3000);
    };
    btn.onclick = () => (form.classList.contains('hidden') ? open() : close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inp.value.trim()) chat.sendChat(inp.value);
      close();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      e.stopPropagation();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && form.classList.contains('hidden') && document.activeElement !== inp) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    const off = chat.onChat(render);
    this.chatOff = () => {
      off();
      window.removeEventListener('keydown', onKey);
      clearTimeout(fade);
    };
    shown = chat.chat.length;
  }

  /** 화면 아래 조작판 높이(px) */
  get bottomHeight() {
    return this.bottomEl.offsetHeight;
  }

  setTurn(match: Match, t: TankState, human: boolean, tag = '') {
    const w = match.wind;
    const arrow = w === 0 ? '·' : w > 0 ? '➜' : '➜';
    this.wind.innerHTML = `<span class="wind-label">WIND</span><span class="wind-arrow ${w < 0 ? 'flip' : ''}" style="--s:${0.6 + Math.abs(w) / 12}">${arrow}</span><b>${Math.abs(w)}</b>`;
    this.wind.title = w === 0 ? '무풍' : `${w > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(w)}`;
    this.banner.innerHTML = `<span style="color:${TEAM_COLORS[t.team]}">${escapeHtml(t.name)}</span> 차례${tag ? ` <small>(${escapeHtml(tag)})</small>` : ''}`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.order.innerHTML =
      '<span class="order-label">NEXT</span>' +
      match
        .order()
        .slice(0, 4)
        .map((o) => `<span class="chip" style="--c:${TEAM_COLORS[o.team]}">${escapeHtml(o.name)}</span>`)
        .join('');
    this.root.classList.toggle('ai-turn', !human);
  }

  update(match: Match, t: TankState, v: HudView) {
    // 실제 발사각 = 포신 각도 + 경사
    const off = t.facing * match.tilt(t);
    const shown = `${Math.round(t.angle + off)}°`;
    if (this.angleNum.textContent !== shown) this.angleNum.textContent = shown;
    this.angleNum.title = off ? `포신 ${Math.round(t.angle)}° ${off > 0 ? '+' : '−'} 경사 ${Math.abs(off)}°` : '';
    this.drawDial(t, off);
    this.powerFill.style.width = `${v.power}%`;
    this.powerFill.classList.toggle('charging', v.charging);
    this.powerLast.style.left = `${t.lastPower}%`;
    this.powerLast.style.display = t.lastPower > 0 ? 'block' : 'none';
    this.powerNum.textContent = v.power > 0 ? `${Math.round(v.power)}` : '';
    this.powerLimit.style.left = `${v.limit}%`;
    this.powerLimit.style.display = v.limit < 100 ? 'block' : 'none';
    const lt = v.limit < 100 ? `POWER<small>≤${v.limit}</small>` : 'POWER';
    if (this.limitLabel.innerHTML !== lt) this.limitLabel.innerHTML = lt;
    this.root.classList.toggle('my-turn', v.human);
    this.root.classList.toggle('spectate', v.spectate);
    this.moveFill.style.width = `${(match.moveLeft / t.def.move) * 100}%`;

    const tl = Math.ceil(v.timeLeft);
    if (tl !== this.lastTimer) {
      this.lastTimer = tl;
      this.timer.textContent = `${Math.max(0, tl)}`;
      this.timer.classList.toggle('hurry', tl <= 5);
      if (tl <= 5 && tl > 0 && v.human) sfx.tick();
    }

    t.def.weapons.forEach((wid, i) => {
      const w = WEAPONS[wid];
      const b = this.weapons[i];
      const ult = i === 2;
      const ready = !ult || t.ult >= 100;
      const html = `<span class="key">${i + 1}</span><span class="nm">${w.name}</span>${ult ? `<span class="ult-bar"><i style="width:${t.ult}%"></i></span>` : ''}`;
      if (b.dataset.html !== html) {
        b.innerHTML = html;
        b.dataset.html = html;
      }
      b.title = `${w.name} — ${w.desc}`;
      b.classList.toggle('sel', v.weapon === i);
      b.classList.toggle('locked', !ready);
      b.classList.toggle('ready', ult && ready);
    });
    t.items.forEach((id, i) => {
      const b = this.items[i];
      const html = `<span class="key">${'QWE'[i]}</span>${id ? `<span class="ic">${ITEMS[id].icon}</span><span class="nm">${ITEMS[id].name}</span>` : '<span class="nm empty">빈칸</span>'}`;
      if (b.dataset.html !== html) {
        b.innerHTML = html;
        b.dataset.html = html;
      }
      b.title = id ? `${ITEMS[id].name} — ${ITEMS[id].desc}` : '';
      b.classList.toggle('sel', v.itemSlot === i);
      b.disabled = !id;
    });
  }

  private drawDial(t: TankState, off: number) {
    const c = this.dial.getContext('2d')!;
    const W = this.dial.width;
    const cx = W / 2;
    const cy = W / 2 + 14;
    const r = 34;
    c.clearRect(0, 0, W, W);
    const f = t.facing;
    const toRad = (a: number) => (f > 0 ? -a : -(180 - a)) * (Math.PI / 180);
    c.lineWidth = 7;
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    c.arc(cx, cy, r, Math.PI, 0);
    c.stroke();
    c.strokeStyle = '#ffd34d';
    c.beginPath();
    const a1 = toRad(t.def.angleMin + off);
    const a2 = toRad(t.def.angleMax + off);
    c.arc(cx, cy, r, Math.min(a1, a2), Math.max(a1, a2));
    c.stroke();
    const a = toRad(t.angle + off);
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
    c.stroke();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(cx, cy, 4, 0, Math.PI * 2);
    c.fill();
  }

  /** 지형이 바뀌었을 때 미니맵 바탕을 다시 그린다 */
  drawMiniBase(match: Match) {
    const { terrain } = match;
    const W = this.mini.width;
    const H = this.mini.height;
    this.miniBase.width = W;
    this.miniBase.height = H;
    const c = this.miniBase.getContext('2d')!;
    const img = c.createImageData(W, H);
    const sx = terrain.w / W;
    const sy = terrain.h / H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const solid = terrain.solid(x * sx + sx / 2, y * sy + sy / 2);
        img.data[o] = solid ? 150 : 30;
        img.data[o + 1] = solid ? 110 : 50;
        img.data[o + 2] = solid ? 70 : 90;
        img.data[o + 3] = solid ? 255 : 120;
      }
    }
    c.putImageData(img, 0, 0);
  }

  drawMini(match: Match, view: { x: number; y: number; w: number; h: number }, shells: { x: number; y: number }[]) {
    const c = this.mini.getContext('2d')!;
    const W = this.mini.width;
    const H = this.mini.height;
    const sx = W / match.terrain.w;
    const sy = H / match.terrain.h;
    c.clearRect(0, 0, W, H);
    c.drawImage(this.miniBase, 0, 0);
    for (const t of match.tanks) {
      if (!t.alive) continue;
      c.fillStyle = TEAM_COLORS[t.team];
      c.strokeStyle = t.idx === match.current ? '#fff' : '#0008';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(t.x * sx, (t.y - 10) * sy, 3.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.fillStyle = '#ffeb3b';
    for (const s of shells) c.fillRect(s.x * sx - 1.5, s.y * sy - 1.5, 3, 3);
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 1;
    c.strokeRect(view.x * sx, view.y * sy, view.w * sx, view.h * sy);
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  destroy() {
    this.ro?.disconnect();
    this.offMute();
    this.chatOff?.();
    this.root.remove();
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
