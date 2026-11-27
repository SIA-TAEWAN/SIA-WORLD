/** 화면 공통: 소리 · 진동 · 알림 · 조사 */
import type { SoundModule } from '../net/world';

let sound: SoundModule | null = null;
export const setSound = (s: SoundModule | null) => (sound = s);
export const getSound = () => sound;
export function sfx(name: string, opts?: { delay?: number; volume?: number; rate?: number }) {
  try {
    sound?.play(name, opts);
  } catch {
    /* 소리 없음 */
  }
}

const VIBE_KEY = 'siaNyang:vibe';
export function vibeOn(): boolean {
  try {
    return localStorage.getItem(VIBE_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setVibe(on: boolean) {
  try {
    localStorage.setItem(VIBE_KEY, on ? '1' : '0');
  } catch {
    /* 저장이 막힌 기기 */
  }
}
/** 짧은 진동 (설정에서 끌 수 있다. navigator.vibrate 가 없는 아이폰 사파리는 아무 일도 없다) */
export function buzz(p: number | number[]) {
  if (!vibeOn()) return;
  try {
    navigator.vibrate?.(p);
  } catch {
    /* 막힌 기기 */
  }
}

let toastTimer = 0;
export function toast(text: string, ms = 2000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('on'), ms);
}

/** 받침이 있으면 a, 없으면 b (이/가, 은/는, 이를/를 …) */
export function josa(word: string, a: string, b: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return word + ((c - 0xac00) % 28 ? a : b);
  return word + (/[aeiouy]$/i.test(word) ? b : a);
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 위로 떠오르는 작은 글 · 하트 (방 안 px 자리) */
export function floatAt(parent: HTMLElement, x: number, y: number, html: string, cls = 'float') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  parent.append(el);
  setTimeout(() => el.remove(), 1400);
}
