/**
 * 방 안을 돌아다니는 고양이 한 마리 (DOM). 자세 그림(ui/catart.ts) + 코드 움직임:
 * 숨쉬기(세로로 살짝) · 눈 깜빡임(sit ↔ sit-blink) · 통통 튀며 걷기(walk-1 ↔ walk-2, 왼쪽은 좌우 뒤집기).
 * 자리는 바닥 위의 비율 (x 0 ~ 1: 왼쪽 → 오른쪽, y 0 ~ 1: 벽 쪽 → 앞쪽). 모든 그림의 발 바닥 기준점을 그 자리에 놓는다.
 */
import type { ColorId } from '../data/balance';
import { POSE_ART } from '../data/poses.gen';
import { POSE_IMAGE, catArt, roomArtScale, type ArtName, type Pose } from './catart';

/** 얼굴 연출: 눈 반짝(츄르를 볼 때) · 혀 낼름(핥기) · 입맛 다시기(다 먹고) */
export type FaceFx = 'none' | 'sparkle' | 'lick' | 'smack';
/** 그림 안의 눈 · 입 자리 (그림 크기에 대한 비율). 정면 그림만 — 없는 자세는 얼굴 연출을 숨긴다 */
const FACE: Partial<Record<ArtName, { eyes: [number, number][]; mouth: [number, number] }>> = {
  beg: { eyes: [[0.337, 0.335], [0.563, 0.338]], mouth: [0.43, 0.388] },
  sit: { eyes: [[0.336, 0.447], [0.617, 0.452]], mouth: [0.5, 0.535] },
  'sit-blink': { eyes: [[0.336, 0.447], [0.617, 0.452]], mouth: [0.5, 0.535] },
  // 츄르 핥기 칸: 입 자리만 쓴다 (눈 반짝 · 혀는 그림에 이미 있다 — 연출은 'none' 으로 둔다)
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`lick-${i}`, { eyes: [[0.33, 0.36], [0.57, 0.36]], mouth: [0.405, 0.44] }])),
};

export interface Spot2 {
  x: number;
  y: number;
}
/** 지금 하는 일 */
export type Act =
  | { kind: 'idle'; until: number }
  | { kind: 'walk'; to: Spot2; speed: number; then?: Act; arrive?: () => void }
  /** ms: 걸어간 뒤에 시작하는 자세는 도착한 때부터 ms 동안 */
  | { kind: 'pose'; pose: Pose; until: number; ms?: number; face?: 1 | -1 }
  | { kind: 'pet' }
  | { kind: 'hold'; pose: Pose };

export class CatActor {
  readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly bubbleEl: HTMLDivElement;
  private readonly fxEl: HTMLDivElement;
  private fx: FaceFx = 'none';
  /** 엉덩이 실룩 (덮치기 전) */
  wiggle = false;
  /** 그림을 위로 더 띄우기 (px, 화면) — 점프 높이 등 */
  lift = 0;
  /** 상자 속으로 가라앉기 (px, 화면): 그만큼 아래로 내리고 원래 바닥 아래는 잘라 낸다 */
  sink = 0;
  /** 방석 · 쿠션 위에서 잘 때 가구보다 앞에 그린다 (걸어 나가면 0) */
  bedLift = 0;
  /** 츄르 · 빗질 · 풀 주기 연출 중: 가구보다 늘 앞에 (집사와 마주 보는 장면) */
  front = false;
  /** 걸을 때 꼬리 세우고 통통 (따라다니기) */
  perky = false;
  /** 숨숨집 속에 숨었을 때 (그림을 감춘다) */
  vanish = false;
  /** 그림 덮어쓰기 (그루밍 혀 낼름처럼 자세를 코드로 돌릴 때) */
  forcePose: Pose | null = null;
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
  /** 말풍선 너비 (방 가장자리에서 잘리지 않게 안쪽으로 민다) · 꼬리 자리 */
  private bubbleW = 0;
  private bubbleDx = 0;
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
    this.fxEl = document.createElement('div');
    this.fxEl.className = 'face-fx';
    this.fxEl.innerHTML = '<i class="spark"></i><i class="spark"></i><b class="tongue"></b>';
    this.body.append(this.img, this.fxEl);
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
    this.bubbleW = this.bubbleEl.offsetWidth;
    this.bubbleDx = NaN;
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

  /** 입 자리 (방 안 px). 정면 그림이 아니면 머리 위쯤 */
  mouthPoint(): { x: number; y: number } {
    const art = POSE_IMAGE[this.pose];
    const meta = POSE_ART[art];
    const { x, y, s } = this.screen();
    const face = FACE[art];
    const lift = (meta.anchor === 'air' ? 40 : 0) + this.lift - this.sink;
    if (!face) return { x, y: y - meta.fy * s * 0.7 - lift };
    return { x: x + (face.mouth[0] * meta.w - meta.fx) * s * this.facing, y: y + (face.mouth[1] * meta.h - meta.fy) * s - lift };
  }

  /** 얼굴 연출 바꾸기 */
  setFx(fx: FaceFx) {
    if (fx === this.fx) return;
    this.fx = fx;
    this.fxEl.dataset.fx = fx;
    this.shown = '';
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
        // 도착했을 때 할 일 (다음 동작을 바꿀 수 있다)
        a.arrive?.();
      } else {
        this.pos = { x: this.pos.x + (d.x * step) / dist, y: this.pos.y + (d.y * step) / dist };
      }
      this.stepPhase += dt * (a.speed > 260 ? 0.026 : 0.017);
      pose = Math.floor(this.stepPhase) % 2 ? 'walk2' : 'walk1';
      hop = Math.abs(Math.sin(this.stepPhase * Math.PI)) * (a.speed > 260 ? 10 : this.perky ? 8 : 5);
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
    if (this.forcePose && a.kind !== 'walk') pose = this.forcePose;
    this.pose = pose;
    this.render(now, hop);
  }

  private last = new Map<string, string>();
  private set(el: HTMLElement, prop: 'transform' | 'clipPath' | 'zIndex' | 'visibility', v: string) {
    const k = (el === this.el ? 'e' : el === this.body ? 'b' : 'u') + prop;
    if (this.last.get(k) === v) return;
    this.last.set(k, v);
    el.style[prop] = v;
  }

  private render(now: number, hop: number) {
    const art = POSE_IMAGE[this.pose];
    const meta = POSE_ART[art];
    const sc = roomArtScale();
    const key = `${this.color}:${art}:${sc}`;
    if (this.shown !== key) {
      this.shown = key;
      void catArt(this.color, art, this.pattern, sc).then((url) => {
        if (this.shown === key) this.img.src = url;
      });
      this.img.style.width = `${meta.w}px`;
      this.img.style.height = `${meta.h}px`;
      this.img.style.left = `${-meta.fx}px`;
      this.img.style.top = `${-meta.fy}px`;
      // 얼굴 연출 자리 (그림이 바뀔 때마다)
      const face = FACE[art];
      this.fxEl.classList.toggle('hidden', !face || this.fx === 'none');
      if (face) {
        const at = ([x, y]: [number, number]) => `left:${x * meta.w - meta.fx}px;top:${y * meta.h - meta.fy}px`;
        const [s1, s2] = this.fxEl.querySelectorAll<HTMLElement>('.spark');
        s1.style.cssText = at(face.eyes[0]);
        s2.style.cssText = at(face.eyes[1]);
        this.fxEl.querySelector<HTMLElement>('.tongue')!.style.cssText = at(face.mouth);
      }
    }
    const { x, y, s } = this.screen();
    const breathe = this.pose === 'walk1' || this.pose === 'walk2' ? 1 : 1 + Math.sin(now / (this.pose === 'sleep' ? 900 : 520)) * (this.sick ? 0.008 : 0.016);
    const droop = this.sick ? 0.94 : 1;
    const sh = this.shake > now ? Math.sin(now / 22) * 4 : 0;
    const lift = (meta.anchor === 'air' ? 40 : 0) + this.lift - this.sink;
    const wig = this.wiggle ? Math.sin(now / 55) * 3 : 0;
    // 바뀐 것만 쓴다 (고양이 4마리 × 매 장면 — 쓸데없는 스타일 다시 계산을 줄인다)
    this.set(this.el, 'transform', `translate3d(${(x + sh + wig).toFixed(1)}px, ${(y - hop - lift).toFixed(1)}px, 0)`);
    this.set(this.el, 'clipPath', this.sink > 0 ? `inset(-3000px -3000px ${Math.round(this.sink)}px -3000px)` : '');
    if (this.act.kind === 'walk') this.bedLift = 0;
    this.set(this.el, 'zIndex', String(Math.round(y) + this.bedLift + (this.front ? 400 : 0)));
    this.set(this.el, 'visibility', this.vanish ? 'hidden' : '');
    this.set(this.body, 'transform', `scale(${(s * this.facing).toFixed(4)}, ${(s * breathe * droop).toFixed(4)})`);
    if (this.body.classList.contains('sick') !== this.sick) this.body.classList.toggle('sick', this.sick);
    // 말풍선은 머리 위 (뒤집지 않는다)
    // 방 양 끝에서 잘리지 않게 안쪽으로 (꼬리는 고양이 머리 위 그대로)
    const roomW = this.floor.left * 2 + this.floor.width;
    const half = this.bubbleW / 2;
    const dx = this.bubbleW ? Math.round(Math.max(6 - (x - half), Math.min(0, roomW - 6 - (x + half)))) : 0;
    if (dx !== this.bubbleDx) {
      this.bubbleDx = dx;
      this.bubbleEl.style.setProperty('--tail', `${Math.round(half - dx)}px`);
    }
    this.set(this.bubbleEl, 'transform', `translate(calc(-50% + ${dx}px), ${Math.round(-meta.fy * s - 8)}px)`);
    if (this.bubbleUntil && now > this.bubbleUntil) {
      this.bubbleUntil = 0;
      this.bubbleEl.classList.add('hidden');
    }
  }
}
