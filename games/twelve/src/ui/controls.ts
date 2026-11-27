/**
 * 전투 조작 (PRD '전투와 조작'): 왼쪽 아래 가상 조이스틱 + 오른쪽 아래 버튼(공격·스킬 2·고유·구르기·물약 2), PC 는 키보드.
 * 왼손잡이 설정이면 좌우가 바뀐다.
 *
 * 아이폰 함정 (시아서바이벌에서 겪은 것): 손가락 번호(Touch.identifier)가 음수일 수 있다 → "없음"은 null 로.
 * 조이스틱·버튼은 touch 이벤트 + preventDefault 로 받는다 (길게 누름 제스처가 조작을 끊지 않게). 마우스는 PC 확인용.
 */
import { IC, icon } from './icons';
import { mpCost, noInput, type Input, type RunState } from '../game/sim';

export interface Controls {
  input: Input;
  /** 눌렀다 떼는 버튼(스킬·구르기·물약)을 내린다 — 한 간격을 돌린 뒤 부른다 */
  consume(): void;
  /** 대기 시간·물약 수 표시 */
  update(s: RunState): void;
  destroy(): void;
}

type Key = 'atk' | 's0' | 's1' | 'uq' | 'roll' | 'p0' | 'p1';
const STICK_R = 56;

export function createControls(root: HTMLElement, run: RunState, opts: { lefty: boolean; onPause(): void }): Controls {
  const input = noInput();
  const w = run.weapon;
  const pad = document.createElement('div');
  pad.className = `pad ${opts.lefty ? 'lefty' : ''}`;
  pad.innerHTML = `
    <div class="stick-zone"><div class="stick"><i></i></div></div>
    <button class="act potion p0" data-k="p0"><span>${IC.hp}</span><b></b><i class="cd"></i><kbd>1</kbd></button>
    <button class="act potion p1" data-k="p1"><span>${IC.mp}</span><b></b><i class="cd"></i><kbd>2</kbd></button>
    <button class="act skill uq" data-k="uq"><span>${icon(run.hero.unique.icon)}</span><i class="cd"></i><em></em><kbd>U</kbd></button>
    <button class="act skill s1" data-k="s1"><span>${icon(w.skills[1].icon)}</span><i class="cd"></i><em></em><kbd>L</kbd></button>
    <button class="act skill s0" data-k="s0"><span>${icon(w.skills[0].icon)}</span><i class="cd"></i><em></em><kbd>K</kbd></button>
    <button class="act roll" data-k="roll"><span>${IC.roll}</span><i class="cd"></i><small>구르기</small></button>
    <button class="act attack" data-k="atk"><span>${icon(w.icon)}</span><kbd>J</kbd></button>`;
  root.appendChild(pad);

  // ----- 조이스틱: 누른 자리가 가운데가 된다 -----
  const zone = pad.querySelector<HTMLElement>('.stick-zone')!;
  const stick = pad.querySelector<HTMLElement>('.stick')!;
  const knob = stick.querySelector<HTMLElement>('i')!;
  let stickId: number | 'mouse' | null = null;
  let ox = 0;
  let oy = 0;
  let sx = 0;
  let sy = 0;
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
  const stickMove = (x: number, y: number) => {
    let dx = x - ox;
    let dy = y - oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 가운데 근처는 0 (손 떨림)
    sx = d < 8 ? 0 : dx / STICK_R;
    sy = d < 8 ? 0 : dy / STICK_R;
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
  const onTouchStart = (ev: TouchEvent) => {
    ev.preventDefault();
    // touchend · touchcancel 을 못 받아 남은 손가락 (화면 밖에서 뗐거나 알림이 끼어들었을 때): 지금 닿은 손가락에 없으면 놓은 것으로
    if (typeof stickId === 'number' && !find(ev.touches, stickId)) stickEnd();
    if (stickId !== null) return;
    const t = ev.changedTouches[0];
    stickStart(t.identifier, t.clientX, t.clientY);
  };
  const onTouchMove = (ev: TouchEvent) => {
    if (typeof stickId !== 'number') return;
    const t = find(ev.changedTouches, stickId);
    if (!t) return;
    ev.preventDefault();
    stickMove(t.clientX, t.clientY);
  };
  const onTouchEnd = (ev: TouchEvent) => {
    if (typeof stickId === 'number' && find(ev.changedTouches, stickId)) stickEnd();
  };
  zone.addEventListener('touchstart', onTouchStart, { passive: false });
  zone.addEventListener('touchmove', onTouchMove, { passive: false });
  zone.addEventListener('touchend', onTouchEnd);
  zone.addEventListener('touchcancel', onTouchEnd);
  const onMouseMove = (ev: MouseEvent) => stickId === 'mouse' && stickMove(ev.clientX, ev.clientY);
  const onMouseUp = () => stickId === 'mouse' && stickEnd();
  zone.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    if (stickId === null) stickStart('mouse', ev.clientX, ev.clientY);
  });
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ----- 버튼 -----
  const btn = {} as Record<Key, HTMLButtonElement>;
  const press = (k: Key, down: boolean) => {
    btn[k].classList.toggle('down', down);
    if (k === 'atk') input.attack = down;
    else if (!down) return;
    else if (k === 's0') input.skill[0] = true;
    else if (k === 's1') input.skill[1] = true;
    else if (k === 'uq') input.unique = true;
    else if (k === 'roll') input.roll = true;
    else if (k === 'p0') input.potion[0] = true;
    else if (k === 'p1') input.potion[1] = true;
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

  // ----- 키보드 (PC) -----
  const held = new Set<string>();
  const KEYS: Record<string, Key> = { KeyJ: 'atk', KeyK: 's0', KeyL: 's1', KeyU: 'uq', Space: 'roll', Digit1: 'p0', Digit2: 'p1' };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.code === 'Escape') return opts.onPause();
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
  const onBlur = () => {
    held.clear();
    press('atk', false);
    if (stickId !== null) stickEnd();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ----- 표시: 값이 바뀔 때만 DOM 을 건드린다 -----
  const shown = new Map<string, string>();
  const set = (key: string, value: string, apply: (v: string) => void) => {
    if (shown.get(key) === value) return;
    shown.set(key, value);
    apply(value);
  };
  const cdEl = (k: Key) => btn[k].querySelector<HTMLElement>('.cd')!;
  const cool = (k: Key, left: number, total: number, mpShort: boolean) => {
    const f = left > 0 ? Math.min(1, left / total) : 0;
    set(`${k}:h`, String(Math.round(f * 20)), () => (cdEl(k).style.height = `${f * 100}%`));
    const em = btn[k].querySelector('em');
    if (em) set(`${k}:t`, left > 0.05 ? String(Math.ceil(left)) : '', (v) => (em.textContent = v));
    set(`${k}:off`, String(left > 0 || mpShort), (v) => btn[k].classList.toggle('off', v === 'true'));
  };

  return {
    input,
    consume() {
      input.skill[0] = input.skill[1] = input.unique = input.roll = input.potion[0] = input.potion[1] = false;
    },
    update(s) {
      const kx = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      const ky = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
      input.mx = kx || sx;
      input.my = ky || sy;
      const p = s.p;
      cool('s0', p.skillCd[0], s.weapon.skills[0].cd, p.mp < mpCost(s, s.weapon.skills[0]));
      cool('s1', p.skillCd[1], s.weapon.skills[1].cd, p.mp < mpCost(s, s.weapon.skills[1]));
      cool('uq', p.uniqueCd, s.hero.unique.cd, p.mp < mpCost(s, s.hero.unique));
      cool('roll', p.rollCd, 1, false);
      for (const i of [0, 1] as const) {
        const k = i ? 'p1' : 'p0';
        cool(k, p.potionCd, 3, s.potions[i] <= 0);
        set(`${k}:n`, String(s.potions[i]), (v) => (btn[k].querySelector('b')!.textContent = v));
      }
    },
    destroy() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      pad.remove();
    },
  };
}
