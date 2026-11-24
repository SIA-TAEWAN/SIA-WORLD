/**
 * 조작: 왼쪽 가상 조이스틱 + 오른쪽 버튼(공격·스킬·각성·상호작용·물약), PC 는 키보드
 * (WASD/방향키 이동 · J/Space 공격 · K 스킬 · L 각성 · E 상호작용 · Q 물약 · I/Esc 메뉴). 시아열두길 controls.ts 와 같은 방식.
 *
 * 아이폰 함정: 손가락 번호(Touch.identifier)가 음수일 수 있다 → "없음"은 null. 터치는 preventDefault 로 받는다.
 */
import { noInput, type Input } from '../game/sim';

export interface PadView {
  skillIcon: string;
  skillOn: boolean;
  skillCd: number;
  skillMp: boolean;
  awakenOn: boolean;
  awakenCd: number;
  awakenMp: boolean;
  interact: string | null;
  potions: number;
}
export interface Controls {
  input: Input;
  consume(): void;
  /** 키보드 방향을 입력에 넣고 버튼 모양을 맞춘다 (화면마다) */
  update(v: PadView): void;
  /** 메뉴가 열렸을 때 눌린 것을 모두 뗀다 */
  release(): void;
  destroy(): void;
}

type Key = 'atk' | 'skill' | 'awaken' | 'act' | 'potion';
const STICK_R = 50;

export function createControls(root: HTMLElement, opts: { onMenu(): void }): Controls {
  const input = noInput();
  const pad = document.createElement('div');
  pad.className = 'pad';
  pad.innerHTML = `
    <div class="stick-zone"><div class="stick"><i></i></div></div>
    <button class="act potion" data-k="potion" aria-label="회복약"><span>🧪</span><b></b><kbd>Q</kbd></button>
    <button class="act awaken" data-k="awaken" aria-label="각성"><span>✨</span><i class="cd"></i><em></em><kbd>L</kbd></button>
    <button class="act skill" data-k="skill" aria-label="스킬"><span>🔮</span><i class="cd"></i><em></em><kbd>K</kbd></button>
    <button class="act interact hidden" data-k="act" aria-label="상호작용"><span>✋</span><small></small><kbd>E</kbd></button>
    <button class="act attack" data-k="atk" aria-label="공격"><span>🗡️</span><kbd>J</kbd></button>`;
  root.appendChild(pad);

  // ----- 조이스틱: 누른 자리가 가운데 -----
  const zone = pad.querySelector<HTMLElement>('.stick-zone')!;
  const stick = pad.querySelector<HTMLElement>('.stick')!;
  const knob = stick.querySelector<HTMLElement>('i')!;
  let stickId: number | 'mouse' | null = null;
  let ox = 0;
  let oy = 0;
  let sx = 0;
  let sy = 0;
  const stickMove = (x: number, y: number) => {
    let dx = x - ox;
    let dy = y - oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    sx = d < 8 ? 0 : dx / STICK_R;
    sy = d < 8 ? 0 : dy / STICK_R;
  };
  const stickStart = (id: number | 'mouse', x: number, y: number) => {
    stickId = id;
    const r = zone.getBoundingClientRect();
    ox = x;
    oy = y;
    stick.style.left = `${x - r.left}px`;
    stick.style.top = `${y - r.top}px`;
    stick.classList.add('on');
    stickMove(x, y);
  };
  const stickEnd = () => {
    stickId = null;
    sx = sy = 0;
    stick.classList.remove('on');
    stick.style.left = stick.style.top = '';
    knob.style.transform = '';
  };
  const find = (list: TouchList, id: number) => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  };
  zone.addEventListener('touchstart', (ev) => {
    ev.preventDefault();
    if (stickId !== null) return;
    const t = ev.changedTouches[0];
    stickStart(t.identifier, t.clientX, t.clientY);
  }, { passive: false });
  zone.addEventListener('touchmove', (ev) => {
    if (typeof stickId !== 'number') return;
    const t = find(ev.changedTouches, stickId);
    if (!t) return;
    ev.preventDefault();
    stickMove(t.clientX, t.clientY);
  }, { passive: false });
  const onTouchEnd = (ev: TouchEvent) => {
    if (typeof stickId === 'number' && find(ev.changedTouches, stickId)) stickEnd();
  };
  zone.addEventListener('touchend', onTouchEnd);
  zone.addEventListener('touchcancel', onTouchEnd);
  zone.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    if (stickId === null) stickStart('mouse', ev.clientX, ev.clientY);
  });
  const onMouseMove = (ev: MouseEvent) => stickId === 'mouse' && stickMove(ev.clientX, ev.clientY);
  const onMouseUp = () => stickId === 'mouse' && stickEnd();
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ----- 버튼 -----
  const btn = {} as Record<Key, HTMLButtonElement>;
  const press = (k: Key, down: boolean) => {
    btn[k].classList.toggle('down', down);
    if (k === 'atk') input.attack = down;
    else if (!down) return;
    else if (k === 'skill') input.skill = true;
    else if (k === 'awaken') input.awaken = true;
    else if (k === 'act') input.interact = true;
    else if (k === 'potion') input.potion = true;
  };
  pad.querySelectorAll<HTMLButtonElement>('.act').forEach((b) => {
    const k = b.dataset.k as Key;
    btn[k] = b;
    b.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      press(k, true);
    }, { passive: false });
    const up = (ev: Event) => {
      ev.preventDefault();
      press(k, false);
    };
    b.addEventListener('touchend', up);
    b.addEventListener('touchcancel', up);
    b.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      press(k, true);
    });
    b.addEventListener('mouseup', () => press(k, false));
    b.addEventListener('mouseleave', () => press(k, false));
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  });

  // ----- 키보드 -----
  const held = new Set<string>();
  const KEYS: Record<string, Key> = { KeyJ: 'atk', Space: 'atk', KeyK: 'skill', KeyL: 'awaken', KeyE: 'act', KeyQ: 'potion' };
  const onKeyDown = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement | null)?.closest?.('.overlay')) return;
    if (ev.code === 'Escape' || ev.code === 'KeyI') {
      ev.preventDefault();
      return opts.onMenu();
    }
    const k = KEYS[ev.code];
    if (k) {
      ev.preventDefault();
      if (!ev.repeat) press(k, true);
      return;
    }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(ev.code)) {
      ev.preventDefault();
      held.add(ev.code);
    }
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    const k = KEYS[ev.code];
    if (k) press(k, false);
    held.delete(ev.code);
  };
  const release = () => {
    held.clear();
    for (const k of Object.keys(btn) as Key[]) btn[k].classList.remove('down');
    input.attack = false;
    if (stickId !== null) stickEnd();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', release);

  // ----- 표시 (바뀔 때만) -----
  const shown = new Map<string, string>();
  const set = (key: string, value: string, apply: (v: string) => void) => {
    if (shown.get(key) === value) return;
    shown.set(key, value);
    apply(value);
  };
  const cool = (k: Key, left: number, total: number, off: boolean) => {
    const f = left > 0 && total > 0 ? Math.min(1, left / total) : 0;
    const cd = btn[k].querySelector<HTMLElement>('.cd');
    if (cd) set(`${k}:h`, String(Math.round(f * 20)), () => (cd.style.height = `${f * 100}%`));
    const em = btn[k].querySelector('em');
    if (em) set(`${k}:t`, left > 0.05 ? String(Math.ceil(left)) : '', (v) => (em.textContent = v));
    set(`${k}:off`, String(left > 0 || off), (v) => btn[k].classList.toggle('off', v === 'true'));
  };
  const cdTotal = { skill: 1, awaken: 1 };

  return {
    input,
    consume() {
      input.skill = input.awaken = input.interact = input.potion = false;
    },
    update(v) {
      const kx = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      const ky = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
      input.mx = kx || sx;
      input.my = ky || sy;
      set('skill:icon', v.skillIcon, (x) => (btn.skill.querySelector('span')!.textContent = x));
      set('skill:show', String(v.skillOn), (x) => btn.skill.classList.toggle('none', x !== 'true'));
      set('awaken:show', String(v.awakenOn), (x) => btn.awaken.classList.toggle('none', x !== 'true'));
      if (v.skillCd > cdTotal.skill || v.skillCd <= 0) cdTotal.skill = Math.max(0.01, v.skillCd);
      if (v.awakenCd > cdTotal.awaken || v.awakenCd <= 0) cdTotal.awaken = Math.max(0.01, v.awakenCd);
      cool('skill', v.skillCd, cdTotal.skill, !v.skillMp);
      cool('awaken', v.awakenCd, cdTotal.awaken, !v.awakenMp);
      set('act', v.interact ?? '', (x) => {
        btn.act.classList.toggle('hidden', !x);
        btn.act.querySelector('small')!.textContent = x;
      });
      set('potion', String(v.potions), (x) => {
        btn.potion.querySelector('b')!.textContent = x;
        btn.potion.classList.toggle('off', x === '0');
      });
    },
    release,
    destroy() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      pad.remove();
    },
  };
}
