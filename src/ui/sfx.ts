/** 효과음을 코드로 합성한다 (파일 없음) */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
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
  fire: () => {
    noise(0.18, 0.35, 1800);
    tone(180, 0.15, 'square', 0.08, -120);
  },
  boom: (big = false) => {
    noise(big ? 0.9 : 0.5, big ? 0.7 : 0.5, big ? 600 : 900);
    tone(big ? 70 : 110, big ? 0.6 : 0.35, 'sine', 0.3, -50);
  },
  laser: () => tone(1400, 0.6, 'sawtooth', 0.08, -1200),
  build: () => tone(220, 0.25, 'triangle', 0.15, -100),
  click: () => tone(660, 0.05, 'square', 0.05),
  tick: () => tone(980, 0.06, 'sine', 0.08),
  turn: () => {
    tone(523, 0.1, 'triangle', 0.1);
    setTimeout(() => tone(784, 0.14, 'triangle', 0.1), 90);
  },
  heal: () => tone(440, 0.3, 'sine', 0.1, 400),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 130)),
  toggleMute: () => (muted = !muted),
  get muted() {
    return muted;
  },
};
