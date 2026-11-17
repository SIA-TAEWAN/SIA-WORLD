/** 키보드와 터치 버튼을 하나의 입력 상태로 합친다 */
export interface Controls {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
}

export type ControlEvent =
  | { type: 'weapon'; slot: 0 | 1 | 2 }
  | { type: 'item'; slot: number }
  /** 파워 리미터: value(0~100)로 정하거나 delta만큼 바꾼다 */
  | { type: 'limit'; value?: number; delta?: number };

export class Input {
  readonly state: Controls = { left: false, right: false, up: false, down: false, fire: false };
  private listeners: ((e: ControlEvent) => void)[] = [];
  private cleanup: (() => void)[] = [];

  constructor() {
    const map: Record<string, keyof Controls> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Space: 'fire',
    };
    // 채팅을 치는 중일 때만 키를 글자로 보낸다
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !!a.closest('.game-chat');
    };
    // 화면을 누르면 버튼·입력칸에 남은 포커스를 푼다 (스페이스가 버튼을 누르지 않게)
    const unfocus = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.game-chat')) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body) setTimeout(() => a.blur(), 0);
    };
    window.addEventListener('pointerdown', unfocus, true);
    this.cleanup.push(() => window.removeEventListener('pointerdown', unfocus, true));
    const down = (e: KeyboardEvent) => {
      if (typing()) return;
      if (document.activeElement && document.activeElement !== document.body) (document.activeElement as HTMLElement).blur();
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        this.state[k] = true;
        return;
      }
      if (e.repeat) return;
      const weapon = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
      if (weapon !== undefined) this.emit({ type: 'weapon', slot: weapon as 0 | 1 | 2 });
      const item = { KeyQ: 0, KeyW: 1, KeyE: 2 }[e.code];
      if (item !== undefined) this.emit({ type: 'item', slot: item });
    };
    const up = (e: KeyboardEvent) => {
      if (typing()) return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        this.state[k] = false;
      }
    };
    const blur = () => {
      for (const k of Object.keys(this.state) as (keyof Controls)[]) this.state[k] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  /** 터치 버튼을 누르고 있는 동안 해당 입력을 켠다 */
  bindHold(el: HTMLElement, key: keyof Controls) {
    const on = (e: Event) => {
      e.preventDefault();
      this.state[key] = true;
      el.classList.add('pressed');
    };
    const off = (e: Event) => {
      e.preventDefault();
      this.state[key] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  on(fn: (e: ControlEvent) => void) {
    this.listeners.push(fn);
  }

  emit(e: ControlEvent) {
    this.listeners.forEach((l) => l(e));
  }

  destroy() {
    this.cleanup.forEach((c) => c());
    this.listeners = [];
  }
}
