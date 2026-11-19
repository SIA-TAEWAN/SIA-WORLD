import { loadSound, type SoundModule } from '../net/world';

export const app = document.getElementById('app')!;
export const stage = document.getElementById('stage')!;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const num = (n: number) => Math.floor(n).toLocaleString('ko-KR');

/** 걸리는 시간: 10초 · 2분 · 1시간 30분 */
export function duration(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`;
  const m = Math.floor((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)}시간 ${m}분` : `${Math.floor(s / 3600)}시간`;
}

export function screen(html: string, cls = ''): HTMLElement {
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

// ---------- 효과음: SIA WORLD 공용(shared/sound.js). 마을 전용 소리는 9단계에서 더한다 (지금은 있는 이름만 쓴다) ----------
let shared: SoundModule | null = null;
const waiting: (() => void)[] = [];
void loadSound().then(
  (m) => {
    shared = m;
    waiting.splice(0).forEach((f) => f());
  },
  () => undefined,
);
export type SfxName = 'click' | 'toggle' | 'coin' | 'chip' | 'win' | 'tankBuild' | 'survLevel' | 'fold';
export const sfx = (name: SfxName, opts?: { volume?: number; rate?: number }) => shared?.play(name, opts);
export const sound = {
  get on() {
    return shared ? !shared.isMuted() : true;
  },
  set(on: boolean) {
    shared?.setMuted(!on);
  },
  whenReady(fn: () => void) {
    if (shared) fn();
    else waiting.push(fn);
  },
};
