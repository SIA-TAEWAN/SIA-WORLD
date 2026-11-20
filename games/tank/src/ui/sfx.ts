/**
 * 시아탱크 효과음: SIA WORLD 공용 효과음(shared/sound.js, ZzFX)을 쓴다. 켜기/끄기 설정도 공용과 같다.
 * 공용 모듈을 못 불러오면(오프라인 등) 예전처럼 여기서 직접 합성한다.
 */
import { loadSound, type SoundModule } from '../net/world';
let shared: SoundModule | null = null;
void loadSound().then(
  (m) => {
    shared = m;
    muted = m.isMuted();
    muteListeners.forEach((f) => f(muted));
    m.onMuteChange((v) => {
      muted = v;
      muteListeners.forEach((f) => f(muted));
    });
  },
  () => undefined,
);
/** 공용 소리가 있으면 그것으로, 없으면 fallback */
const say = (name: string, fallback: () => void) => (shared ? shared.play(name) : fallback());

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('siatank:mute') === '1';
} catch {
  /* 저장소를 못 쓰면 소리 켬 */
}
const muteListeners = new Set<(m: boolean) => void>();

/** 소리 끔 상태와 상관없이 오디오 장치를 얻는다 (배경음악용) */
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

function ac(): AudioContext | null {
  return muted ? null : audioCtx();
}

function tone(freq: number, dur: number, type: OscillatorType, vol = 0.15, slide = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise(dur: number, vol: number, cutoff: number) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  fire: () =>
    say('tankFire', () => {
      noise(0.18, 0.35, 1800);
      tone(180, 0.15, 'square', 0.08, -120);
    }),
  boom: (big = false) =>
    say(big ? 'tankBigBoom' : 'tankBoom', () => {
      noise(big ? 0.9 : 0.5, big ? 0.7 : 0.5, big ? 600 : 900);
      tone(big ? 70 : 110, big ? 0.6 : 0.35, 'sine', 0.3, -50);
    }),
  laser: () => say('tankLaser', () => tone(1400, 0.6, 'sawtooth', 0.08, -1200)),
  build: () => say('tankBuild', () => tone(220, 0.25, 'triangle', 0.15, -100)),
  click: () => say('click', () => tone(660, 0.05, 'square', 0.05)),
  tick: () => say('tick', () => tone(980, 0.06, 'sine', 0.08)),
  turn: () =>
    say('tankTurn', () => {
      tone(523, 0.1, 'triangle', 0.1);
      setTimeout(() => tone(784, 0.14, 'triangle', 0.1), 90);
    }),
  heal: () => say('tankHeal', () => tone(440, 0.3, 'sine', 0.1, 400)),
  win: () => say('tankWin', () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 130))),
  toggleMute: () => {
    if (shared) {
      shared.setMuted(!muted);
      return muted;
    }
    muted = !muted;
    try {
      localStorage.setItem('siatank:mute', muted ? '1' : '0');
      localStorage.setItem('sia:sound', muted ? 'off' : 'on');
    } catch {
      /* 무시 */
    }
    muteListeners.forEach((f) => f(muted));
    return muted;
  },
  onMute: (f: (m: boolean) => void) => {
    muteListeners.add(f);
    return () => muteListeners.delete(f);
  },
  get muted() {
    return muted;
  },
};
