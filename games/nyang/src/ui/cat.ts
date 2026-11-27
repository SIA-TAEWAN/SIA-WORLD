/**
 * 방 안을 돌아다니는 고양이 한 마리 (DOM). 자세 그림(ui/catart.ts) + 코드 움직임:
 * 숨쉬기(세로로 살짝) · 눈 깜빡임(sit ↔ sit-blink) · 통통 튀며 걷기(walk-1 ↔ walk-2, 왼쪽은 좌우 뒤집기).
 * 자리는 바닥 위의 비율 (x 0 ~ 1: 왼쪽 → 오른쪽, y 0 ~ 1: 벽 쪽 → 앞쪽). 모든 그림의 발 바닥 기준점을 그 자리에 놓는다.
 */
import type { ColorId } from '../data/balance';
import { POSE_ART } from '../data/poses.gen';
import { POSE_IMAGE, catArt, type Pose } from './catart';

export interface Spot2 {
  x: number;
  y: number;
}
/** 지금 하는 일 */
export type Act =
  | { kind: 'idle'; until: number }
  | { kind: 'walk'; to: Spot2; speed: number; then?: Act }
  /** ms: 걸어간 뒤에 시작하는 자세는 도착한 때부터 ms 동안 */
  | { kind: 'pose'; pose: Pose; until: number; ms?: number; face?: 1 | -1 }
  | { kind: 'pet' }
  | { kind: 'hold'; pose: Pose };

export class CatActor {
  readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly bubbleEl: HTMLDivElement;
  pos: Spot2;
  facing: 1 | -1 = 1;
  act: Act = { kind: 'idle', until: 0 };
  pose: Pose = 'sit';
  private color: ColorId;
  private pattern: string | null;
  private shown = '';
  private blinkAt = 0;
  private nextBlink = 0;
  private stepPhase = 0;
  private bubbleUntil = 0;
  /** 아플 때: 축 처지고 색이 살짝 푸르스름 */
  sick = false;
  /** 바닥 → 화면 좌표 (방 크기가 바뀌면 다시 받는다) */
  floor = { left: 0, top: 0, width: 300, height: 300, scale: 0.5 };
  shake = 0;

  constructor(parent: HTMLElement, color: ColorId, pattern: string | null, pos: Spot2) {
    this.color = color;
    this.pattern = pattern;
    this.pos = { ...pos };
    this.el = document.createElement('div');
    this.el.className = 'cat';
    this.body = document.createElement('div');
    this.body.className = 'cat-body';
    this.img = document.createElement('img');
    this.img.alt = '';
    this.img.draggable = false;
    this.body.append(this.img);
    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'bubble hidden';
    this.el.append(this.body, this.bubbleEl);
    parent.append(this.el);
  }

  setColor(color: ColorId, pattern: string | null) {
    if (color === this.color && pattern === this.pattern) return;
    this.color = color;
    this.pattern = pattern;
    this.shown = '';
  }

  /** 지금 화면 좌표 (방 안 px) */
  screen(p = this.pos) {
    const f = this.floor;
    return { x: f.left + p.x * f.width, y: f.top + p.y * f.height, s: f.scale * (0.86 + 0.22 * p.y) };
  }

  say(text: string, ms = 1800, now = performance.now()) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.remove('hidden');
    this.bubbleEl.classList.remove('pop');
    void this.bubbleEl.offsetWidth;
    this.bubbleEl.classList.add('pop');
    this.bubbleUntil = now + ms;
  }

  /** 그림 안의 비율 (0 ~ 1) → 쓰다듬는 곳. 정면 앉은 그림 기준의 대강 */
  spotAt(clientX: number, clientY: number): 'head' | 'chin' | 'back' | 'belly' {
    const r = this.img.getBoundingClientRect();
    let x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (this.facing === -1) x = 1 - x;
    const cx = this.pose === 'sit' || this.pose === 'blink' ? 0.5 : 0.55;
    if (y < 0.5) return y > 0.36 && Math.abs(x - cx) < 0.14 ? 'chin' : 'head';
    return Math.abs(x - cx) < 0.16 && y > 0.6 ? 'belly' : 'back';
  }

  /** 누를 수 있는 그림 */
  get hit(): HTMLElement {
    return this.img;
  }

  update(now: number, dt: number) {
    const a = this.act;
    let pose: Pose = 'sit';
    let hop = 0;
    if (a.kind === 'walk') {
      const d = { x: a.to.x - this.pos.x, y: a.to.y - this.pos.y };
      // 바닥 비율 → 화면 거리로 재서 같은 빠르기로 걷는다
      const fx = this.floor.width;
      const fy = this.floor.height;
      const dist = Math.hypot(d.x * fx, d.y * fy);
      const step = a.speed * dt * this.floor.scale * 2.2;
      if (Math.abs(d.x) > 0.002) this.facing = d.x > 0 ? 1 : -1;
      if (dist <= step || dist < 1) {
        this.pos = { ...a.to };
        const n = a.then;
        if (n?.kind === 'pose' && n.ms) n.until = now + n.ms;
        if (n?.kind === 'pose' && n.face) this.facing = n.face;
        this.act = n ?? { kind: 'idle', until: now + 2500 + Math.random() * 4000 };
      } else {
        this.pos = { x: this.pos.x + (d.x * step) / dist, y: this.pos.y + (d.y * step) / dist };
      }
      this.stepPhase += dt * (a.speed > 260 ? 0.026 : 0.017);
      pose = Math.floor(this.stepPhase) % 2 ? 'walk2' : 'walk1';
      hop = Math.abs(Math.sin(this.stepPhase * Math.PI)) * (a.speed > 260 ? 10 : 5);
    } else if (a.kind === 'pose') {
      pose = a.pose;
      if (now >= a.until) this.act = { kind: 'idle', until: now + 2000 + Math.random() * 3000 };
    } else if (a.kind === 'hold') {
      pose = a.pose;
    } else if (a.kind === 'pet') {
      pose = 'blink';
    } else {
      pose = this.sick ? 'loaf' : 'sit';
    }
    // 눈 깜빡임: 앉아 있을 때 3 ~ 6초마다 0.16초 (sit ↔ sit-blink)
    if (pose === 'sit') {
      if (now > this.nextBlink) {
        this.blinkAt = now;
        this.nextBlink = now + 3000 + Math.random() * 3000;
      }
      if (now - this.blinkAt < 160) pose = 'blink';
    }
    this.pose = pose;
    this.render(now, hop);
  }

  private render(now: number, hop: number) {
    const art = POSE_IMAGE[this.pose];
    const meta = POSE_ART[art];
    const key = `${this.color}:${art}`;
    if (this.shown !== key) {
      this.shown = key;
      void catArt(this.color, art, this.pattern).then((url) => {
        if (this.shown === key) this.img.src = url;
      });
      this.img.style.width = `${meta.w}px`;
      this.img.style.height = `${meta.h}px`;
      this.img.style.left = `${-meta.fx}px`;
      this.img.style.top = `${-meta.fy}px`;
    }
    const { x, y, s } = this.screen();
    const breathe = this.pose === 'walk1' || this.pose === 'walk2' ? 1 : 1 + Math.sin(now / (this.pose === 'sleep' ? 900 : 520)) * (this.sick ? 0.008 : 0.016);
    const droop = this.sick ? 0.94 : 1;
    const sh = this.shake > now ? Math.sin(now / 22) * 4 : 0;
    const lift = meta.anchor === 'air' ? 40 : 0;
    this.el.style.transform = `translate3d(${x + sh}px, ${y - hop - lift}px, 0)`;
    this.el.style.zIndex = String(Math.round(y));
    this.body.style.transform = `scale(${s * this.facing}, ${s * breathe * droop})`;
    this.body.classList.toggle('sick', this.sick);
    // 말풍선은 머리 위 (뒤집지 않는다)
    this.bubbleEl.style.transform = `translate(-50%, ${-meta.fy * s - 8}px)`;
    if (this.bubbleUntil && now > this.bubbleUntil) {
      this.bubbleUntil = 0;
      this.bubbleEl.classList.add('hidden');
    }
  }
}
