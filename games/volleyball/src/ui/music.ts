import { sound, whenSound } from './sfx';

/**
 * 배경음: 파일 없이 코드로 만든 짧은 반복곡 (시아탱크 games/running/src/ui/music.ts 를 그대로 가져옴).
 * shared/sounds/bgmLobby|bgmVolley|bgmResult.ogg|.mp3 를 넣으면 그 파일을 반복 재생한다.
 */

interface Bar {
  /** 8분음표 8개 (MIDI 번호, -1은 쉼) */
  arp: number[];
  /** 4분음표 4개 멜로디 (-1 쉼, 0은 앞 음 이어서) */
  lead?: number[];
  /** 베이스 근음 */
  bass: number;
}

interface Track {
  bpm: number;
  bars: Bar[];
  arpVol: number;
  leadVol: number;
  drums: 'light' | 'run' | 'none';
  file: string;
}

/** 대기실: 통통 튀는 밝은 곡 (다장조) */
const LOBBY: Track = {
  bpm: 112, arpVol: 0.03, leadVol: 0.045, drums: 'light', file: 'bgmLobby',
  bars: [
    { arp: [72, 76, 79, 76, 72, 76, 79, 76], lead: [79, 0, 76, 72], bass: 48 },
    { arp: [72, 77, 81, 77, 72, 77, 81, 77], lead: [77, 0, 81, 0], bass: 53 },
    { arp: [71, 74, 79, 74, 71, 74, 79, 74], lead: [79, 81, 83, 79], bass: 55 },
    { arp: [72, 76, 79, 76, 72, 76, 79, 84], lead: [84, 0, 0, -1], bass: 48 },
    { arp: [69, 72, 76, 72, 69, 72, 76, 72], lead: [76, 0, 72, 69], bass: 45 },
    { arp: [65, 69, 72, 69, 65, 69, 72, 69], lead: [77, 76, 74, 72], bass: 41 },
    { arp: [67, 71, 74, 71, 67, 71, 74, 71], lead: [74, 0, 79, 77], bass: 43 },
    { arp: [72, 76, 79, 76, 72, 79, 76, 72], lead: [76, 0, 0, -1], bass: 48 },
  ],
};

/** 경기 중: 빠르고 신나는 곡 (사장조) */
const MATCH: Track = {
  bpm: 156, arpVol: 0.028, leadVol: 0.042, drums: 'run', file: 'bgmVolley',
  bars: [
    { arp: [67, 71, 74, 79, 74, 71, 74, 79], lead: [79, 0, 83, 81], bass: 43 },
    { arp: [72, 76, 79, 84, 79, 76, 79, 84], lead: [84, 0, 83, 79], bass: 48 },
    { arp: [69, 74, 78, 81, 78, 74, 78, 81], lead: [81, 83, 86, 0], bass: 50 },
    { arp: [67, 71, 74, 79, 74, 71, 74, 79], lead: [83, 0, 0, -1], bass: 43 },
    { arp: [64, 67, 71, 76, 71, 67, 71, 76], lead: [76, 0, 79, 83], bass: 40 },
    { arp: [72, 76, 79, 84, 79, 76, 79, 84], lead: [84, 86, 88, 0], bass: 48 },
    { arp: [69, 74, 78, 81, 78, 74, 78, 81], lead: [86, 0, 81, 78], bass: 50 },
    { arp: [67, 71, 74, 79, 83, 79, 74, 71], lead: [79, 0, 0, -1], bass: 43 },
  ],
};

/** 결과: 느긋하고 따뜻한 곡 (바장조) */
const RESULT: Track = {
  bpm: 96, arpVol: 0.03, leadVol: 0.045, drums: 'none', file: 'bgmResult',
  bars: [
    { arp: [65, 69, 72, 77, 72, 69, 72, 77], lead: [81, 0, 77, 0], bass: 41 },
    { arp: [70, 74, 77, 82, 77, 74, 77, 82], lead: [82, 0, 81, 77], bass: 46 },
    { arp: [72, 76, 79, 84, 79, 76, 79, 84], lead: [79, 0, 84, 0], bass: 48 },
    { arp: [65, 69, 72, 77, 72, 69, 72, 69], lead: [81, 0, 0, -1], bass: 41 },
  ],
};

const TRACKS = { lobby: LOBBY, match: MATCH, result: RESULT };
export type TrackName = keyof typeof TRACKS;

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

let current: TrackName | null = null;
let want: TrackName | null = null;
let master: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
let noiseBuf: AudioBuffer | null = null;
let unlocked = false;
/** 곡 이름 → 교체 파일 주소 (없으면 null, 아직 확인 전이면 undefined) */
const files = new Map<TrackName, string | null>();
let fileEl: HTMLAudioElement | null = null;

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
    g.gain.setValueAtTime(0.14, t);
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
  g.gain.setValueAtTime(kind === 'hat' ? 0.022 : 0.06, t);
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
    note(a, master, 'triangle', freq(bar.bass + (i % 2 ? 12 : 0)), t, eighth * 0.95, 0.08);
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
    if (tr.drums !== 'none') {
      if (i === 0 || i === 4 || (tr.drums === 'run' && i === 3)) hit(a, master, t, 'kick');
      if (i === 2 || i === 6) hit(a, master, t, 'snare');
      if (tr.drums === 'run' || i % 2 === 0) hit(a, master, t, 'hat');
    }
    nextAt += eighth;
    step++;
  }
}

function stopFile() {
  if (fileEl) {
    fileEl.pause();
    fileEl = null;
  }
}

function startSynth() {
  const a = audioCtx();
  if (!a) return;
  if (!master) {
    master = a.createGain();
    master.connect(a.destination);
  }
  master.gain.cancelScheduledValues(a.currentTime);
  master.gain.setValueAtTime(0.0001, a.currentTime);
  master.gain.exponentialRampToValueAtTime(0.6, a.currentTime + 0.6);
  step = 0;
  nextAt = a.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 90);
  schedule();
}

function start(name: TrackName) {
  current = name;
  stopFile();
  const url = files.get(name);
  if (url === undefined) {
    // 교체 파일이 있는지 한 번만 확인하고 다시 시작한다
    files.set(name, null);
    void sound.bgmFile(TRACKS[name].file).then((u) => {
      if (!u) return;
      files.set(name, u);
      if (current === name) {
        stop();
        apply();
      }
    });
  }
  if (url) {
    fileEl = new Audio(url);
    fileEl.loop = true;
    fileEl.volume = 0.5;
    void fileEl.play().catch(() => undefined);
    return;
  }
  startSynth();
}

function stop() {
  current = null;
  stopFile();
  if (timer) clearInterval(timer);
  timer = null;
  const a = ctx;
  if (a && master) {
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(master.gain.value, a.currentTime);
    master.gain.linearRampToValueAtTime(0, a.currentTime + 0.25);
  }
}

function apply() {
  const target = !sound.bgmOn || !unlocked || document.hidden ? null : want;
  if (target === current) return;
  if (current) stop();
  if (target) start(target);
}

export const music = {
  /** 이 곡을 틀어 둔다 (첫 터치 전에는 기다렸다가 시작) */
  play(name: TrackName | null) {
    want = name;
    apply();
  },
  /** 설정이 바뀌었을 때 */
  refresh: apply,
};

// 브라우저는 사용자가 한 번 누른 뒤에야 소리를 낼 수 있다
const unlock = () => {
  if (unlocked) return;
  unlocked = true;
  apply();
};
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);
document.addEventListener('visibilitychange', apply);
whenSound(() => {
  sound.onBgm(() => apply());
  apply();
});
