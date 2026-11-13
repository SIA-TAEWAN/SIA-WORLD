import { audioCtx, sfx } from './sfx';

/** 배경음악: 파일 없이 8비트 느낌으로 합성한다 */

interface Bar {
  /** 8분음표 8개 (MIDI 번호, -1은 쉼) */
  arp: number[];
  /** 4분음표 4개 멜로디 (없으면 생략, -1 쉼, 0은 앞 음 이어서) */
  lead?: number[];
  /** 베이스 근음 */
  bass: number;
}

interface Track {
  bpm: number;
  bars: Bar[];
  arpVol: number;
  leadVol: number;
  drums: boolean;
}

const MENU: Track = {
  bpm: 108,
  arpVol: 0.035,
  leadVol: 0.05,
  drums: true,
  bars: [
    { arp: [72, 76, 79, 76, 72, 76, 79, 76], lead: [84, 0, 83, 79], bass: 48 },
    { arp: [69, 72, 76, 72, 69, 72, 76, 72], lead: [81, 0, 79, 76], bass: 45 },
    { arp: [65, 69, 72, 69, 65, 69, 72, 69], lead: [77, 79, 81, 84], bass: 41 },
    { arp: [67, 71, 74, 71, 67, 71, 74, 71], lead: [83, 0, 0, -1], bass: 43 },
    { arp: [72, 76, 79, 76, 72, 76, 79, 76], lead: [79, 81, 79, 76], bass: 48 },
    { arp: [69, 72, 76, 72, 69, 72, 76, 72], lead: [74, 76, 72, 0], bass: 45 },
    { arp: [65, 69, 72, 69, 65, 69, 72, 69], lead: [74, 0, 77, 76], bass: 41 },
    { arp: [67, 71, 74, 71, 67, 71, 74, 77], lead: [72, 0, 0, -1], bass: 43 },
  ],
};

const BATTLE: Track = {
  bpm: 138,
  arpVol: 0.03,
  leadVol: 0.045,
  drums: true,
  bars: [
    { arp: [69, 72, 76, 72, 81, 72, 76, 72], lead: [76, 0, 74, 72], bass: 45 },
    { arp: [67, 71, 74, 71, 79, 71, 74, 71], lead: [74, 0, 71, 67], bass: 43 },
    { arp: [65, 69, 72, 69, 77, 69, 72, 69], lead: [72, 74, 76, 77], bass: 41 },
    { arp: [64, 68, 71, 68, 76, 68, 71, 74], lead: [76, 0, 0, -1], bass: 40 },
    { arp: [69, 72, 76, 72, 81, 72, 76, 72], lead: [81, 0, 79, 76], bass: 45 },
    { arp: [65, 69, 72, 69, 77, 69, 72, 69], lead: [77, 0, 76, 72], bass: 41 },
    { arp: [62, 65, 69, 65, 74, 65, 69, 65], lead: [74, 72, 71, 72], bass: 38 },
    { arp: [64, 68, 71, 68, 76, 74, 71, 68], lead: [69, 0, 0, -1], bass: 40 },
  ],
};

const TRACKS = { menu: MENU, battle: BATTLE };
export type TrackName = keyof typeof TRACKS;

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let current: TrackName | null = null;
let want: TrackName | null = null;
let master: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
let noiseBuf: AudioBuffer | null = null;
let unlocked = false;

function note(a: AudioContext, out: AudioNode, type: OscillatorType, f: number, t: number, dur: number, vol: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hit(a: AudioContext, out: AudioNode, t: number, kind: 'kick' | 'snare' | 'hat') {
  if (kind === 'kick') {
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.18);
    return;
  }
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1500;
  const g = a.createGain();
  const dur = kind === 'hat' ? 0.04 : 0.12;
  g.gain.setValueAtTime(kind === 'hat' ? 0.025 : 0.07, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.01);
}

/** 앞으로 0.25초 안에 울릴 음을 미리 예약한다 */
function schedule() {
  const a = audioCtx();
  if (!a || !master || !current) return;
  const tr = TRACKS[current];
  const eighth = 60 / tr.bpm / 2;
  if (nextAt < a.currentTime) nextAt = a.currentTime + 0.05;
  while (nextAt < a.currentTime + 0.25) {
    const bar = tr.bars[Math.floor(step / 8) % tr.bars.length];
    const i = step % 8;
    const t = nextAt;
    if (bar.arp[i] >= 0) note(a, master, 'square', freq(bar.arp[i]), t, eighth * 0.9, tr.arpVol);
    // 베이스: 8분음표로 근음·옥타브
    note(a, master, 'triangle', freq(bar.bass + (i % 2 ? 12 : 0)), t, eighth * 0.95, 0.09);
    if (bar.lead && i % 2 === 0) {
      const q = i / 2;
      const m = bar.lead[q];
      if (m > 0) {
        let len = 1;
        while (q + len < 4 && bar.lead[q + len] === 0) len++;
        note(a, master, 'square', freq(m), t, eighth * 2 * len * 0.95, tr.leadVol);
        note(a, master, 'sine', freq(m + 12), t, eighth * 2 * len * 0.8, tr.leadVol * 0.5);
      }
    }
    if (tr.drums) {
      if (i === 0 || i === 4) hit(a, master, t, 'kick');
      if (i === 2 || i === 6) hit(a, master, t, 'snare');
      hit(a, master, t, 'hat');
    }
    nextAt += eighth;
    step++;
  }
}

function start(name: TrackName) {
  const a = audioCtx();
  if (!a) return;
  if (!master) {
    master = a.createGain();
    master.connect(a.destination);
  }
  master.gain.cancelScheduledValues(a.currentTime);
  master.gain.setValueAtTime(0.0001, a.currentTime);
  master.gain.exponentialRampToValueAtTime(0.7, a.currentTime + 0.8);
  current = name;
  step = 0;
  nextAt = a.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 90);
  schedule();
}

function stop() {
  current = null;
  if (timer) clearInterval(timer);
  timer = null;
  const a = audioCtx();
  if (a && master) {
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(master.gain.value, a.currentTime);
    master.gain.linearRampToValueAtTime(0, a.currentTime + 0.3);
  }
}

function apply() {
  const target = sfx.muted || !unlocked || document.hidden ? null : want;
  if (target === current) return;
  if (target) start(target);
  else stop();
}

export const music = {
  /** 이 곡을 틀어 둔다 (첫 터치 전에는 기다렸다가 시작) */
  play(name: TrackName | null) {
    want = name;
    apply();
  },
};

// 브라우저는 사용자가 한 번 누른 뒤에야 소리를 낼 수 있다
const unlock = () => {
  if (unlocked) return;
  unlocked = true;
  apply();
};
window.addEventListener('pointerdown', unlock, { once: false, passive: true });
window.addEventListener('keydown', unlock);
document.addEventListener('visibilitychange', apply);
sfx.onMute(() => apply());
