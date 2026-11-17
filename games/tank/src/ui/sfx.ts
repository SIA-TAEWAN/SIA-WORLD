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
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
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
