/**
 * 시아마을 전용 효과음: 코드로 만든 짧은 소리 (WebAudio). 공용 효과음(shared/sound.js)은 고치지 않고 마을 안에서 만든다.
 * shared/sounds/<이름>.ogg|.mp3 를 넣으면 그 파일로 바뀐다 (공용 모듈의 bgmFileUrl 로 한 번만 확인).
 * 켜기/끄기는 공용 효과음 설정('sia:sound')을 그대로 따른다.
 */

/** 음 하나: [반음(라4 = 0), 시작(초), 길이(초), 파형, 크기] */
type Note = [number, number, number, OscillatorType, number];

export const VILL_SOUNDS = {
  /** 수확: 통통 튀는 두 음 + 반짝 */
  villHarvest: [[7, 0, 0.09, 'triangle', 0.22], [14, 0.06, 0.12, 'triangle', 0.2], [26, 0.1, 0.1, 'sine', 0.08]],
  /** 건설 · 업그레이드 시작: 망치 두 번 */
  villBuild: [[-14, 0, 0.06, 'square', 0.12], [-2, 0, 0.04, 'triangle', 0.15], [-14, 0.14, 0.06, 'square', 0.12], [-2, 0.14, 0.04, 'triangle', 0.15]],
  /** 건설 · 업그레이드 끝: 올라가는 세 음 */
  villDone: [[3, 0, 0.1, 'triangle', 0.2], [7, 0.09, 0.1, 'triangle', 0.2], [10, 0.18, 0.22, 'triangle', 0.22], [22, 0.18, 0.22, 'sine', 0.07]],
  /** 레벨업: 5음 음계로 짧은 팡파르 */
  villLevel: [[0, 0, 0.12, 'square', 0.1], [2, 0.1, 0.12, 'square', 0.1], [4, 0.2, 0.12, 'square', 0.1], [7, 0.3, 0.12, 'square', 0.1], [12, 0.42, 0.4, 'triangle', 0.22], [16, 0.42, 0.4, 'sine', 0.1]],
  /** 부탁 · 목표 완료 */
  villRequest: [[9, 0, 0.1, 'triangle', 0.2], [16, 0.1, 0.24, 'triangle', 0.22], [21, 0.1, 0.24, 'sine', 0.06]],
  /** 주민 이사 환영: 정겨운 네 음 */
  villWelcome: [[0, 0, 0.14, 'triangle', 0.2], [4, 0.14, 0.14, 'triangle', 0.2], [7, 0.28, 0.14, 'triangle', 0.2], [12, 0.42, 0.36, 'triangle', 0.22], [7, 0.42, 0.36, 'sine', 0.08]],
} satisfies Record<string, Note[]>;
export type VillSound = keyof typeof VILL_SOUNDS;
export const isVillSound = (n: string): n is VillSound => Object.prototype.hasOwnProperty.call(VILL_SOUNDS, n);

let ctx: AudioContext | null = null;
export function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const a = new AudioContext();
      ctx = a;
      // 전화·백그라운드 뒤에 멈추면('interrupted'/'suspended') 다음 입력에서 다시 깨운다
      a.addEventListener('statechange', () => (a.state === 'running' ? disarmWake() : a.state !== 'closed' && armWake()));
    }
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      void ctx.resume().catch(() => undefined);
      armWake();
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 오디오 깨우기 (shared/sound.js 와 같은 방식): 실제로 소리가 날 때까지 입력마다 다시 깨운다.
 * 아이폰은 pointerdown 이 아니라 손을 뗄 때(touchend/click)에야 소리를 허락하고, 입력 밖(타이머)에서 부른 resume 은 막힌다.
 */
const WAKE_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'];
let wakeOn = false;
function armWake() {
  if (wakeOn) return;
  wakeOn = true;
  for (const ev of WAKE_EVENTS) window.addEventListener(ev, wake, { capture: true, passive: true });
}
function disarmWake() {
  if (!wakeOn) return;
  wakeOn = false;
  for (const ev of WAKE_EVENTS) window.removeEventListener(ev, wake, { capture: true });
}
function wake() {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return disarmWake();
  void ctx.resume().catch(() => undefined);
}

/** 이름 → 교체 파일 주소 (없으면 null, 확인 중이면 undefined) */
const files = new Map<VillSound, string | null>();
const lastAt = new Map<VillSound, number>();

export function playVill(name: VillSound, fileUrl: (n: string) => Promise<string | null>, volume = 1) {
  const now = performance.now();
  if (now - (lastAt.get(name) ?? -1e9) < 90) return;
  lastAt.set(name, now);
  if (!files.has(name)) {
    files.set(name, null);
    void fileUrl(name).then((u) => files.set(name, u), () => undefined);
  }
  const url = files.get(name);
  if (url) {
    const el = new Audio(url);
    el.volume = Math.min(1, 0.7 * volume);
    void el.play().catch(() => undefined);
    return;
  }
  const a = audioCtx();
  if (!a || a.state !== 'running') return;
  const out = a.createGain();
  out.gain.value = 0.9 * volume;
  out.connect(a.destination);
  const t0 = a.currentTime + 0.01;
  for (const [semi, at, dur, type, vol] of VILL_SOUNDS[name] as Note[]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (semi + 3) / 12);
    const t = t0 + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}
