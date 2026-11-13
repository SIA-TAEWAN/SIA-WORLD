import { ITEMS, WEAPONS } from '../game/data';
import type { Match } from '../game/match';
import type { TankState } from '../game/types';
import { TEAM_COLORS } from './teams';
import type { Input } from './input';
import { sfx } from './sfx';

export interface HudView {
  power: number;
  charging: boolean;
  weapon: 0 | 1 | 2;
  itemSlot: number | null;
  timeLeft: number;
  human: boolean;
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
  private moveFill = el('div', 'move-fill');
  private weapons: HTMLButtonElement[] = [];
  private items: HTMLButtonElement[] = [];
  private mini = el('canvas', 'minimap') as HTMLCanvasElement;
  private miniBase = document.createElement('canvas');
  private toastEl = el('div', 'toast');
  private lastTimer = -1;

  constructor(parent: HTMLElement, input: Input, touch: boolean) {
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
    pw.append(this.powerFill, this.powerLast, this.powerNum);
    for (let i = 1; i < 10; i++) {
      const tick = el('i', 'tick');
      tick.style.left = `${i * 10}%`;
      pw.append(tick);
    }
    const mv = el('div', 'gauge move');
    mv.append(this.moveFill);
    gauges.append(el('label', '', 'POWER'), pw, el('label', '', 'MOVE'), mv);
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
    const miniBox = el('div', 'panel mini-box');
    this.mini.width = 176;
    this.mini.height = 88;
    miniBox.append(this.mini);
    bottom.append(angleBox, gauges, wbox, ibox, miniBox);

    this.root.append(top, this.banner, this.toastEl, bottom);

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
    this.angleNum.textContent = `${Math.round(t.angle)}°`;
    this.drawDial(t);
    this.powerFill.style.width = `${v.power}%`;
    this.powerFill.classList.toggle('charging', v.charging);
    this.powerLast.style.left = `${t.lastPower}%`;
    this.powerLast.style.display = t.lastPower > 0 ? 'block' : 'none';
    this.powerNum.textContent = v.power > 0 ? `${Math.round(v.power)}` : '';
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

  private drawDial(t: TankState) {
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
    const a1 = toRad(t.def.angleMin);
    const a2 = toRad(t.def.angleMax);
    c.arc(cx, cy, r, Math.min(a1, a2), Math.max(a1, a2));
    c.stroke();
    const a = toRad(t.angle);
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
    this.root.remove();
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
