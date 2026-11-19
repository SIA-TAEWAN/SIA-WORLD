import { sound } from './app';
import { audioCtx } from './vsound';

/**
 * 마을 배경음: 파일 없이 코드로 만든 잔잔한 반복곡 (시아서바이벌 src/ui/music.ts 와 같은 방식, 북 없이 5음 음계).
 * shared/sounds/bgmVillDay|bgmVillNight.ogg|.mp3 를 넣으면 그 파일을 반복 재생한다.
 * 낮 곡 · 밤 곡은 서버 시각(한국 시간)으로 고른다 (village.ts 의 하늘 색과 같은 때). 가려진 탭에서는 멈춘다.
 * 켜기/끄기: 효과음이 켜져 있고 공용 배경음 설정('sia:bgm')도 켜져 있을 때만 울린다.
 */

interface Bar {
  /** 8분음표 8개 (MIDI 번호, -1 쉼) */
  arp: number[];
  /** 4분음표 4개 멜로디 (-1 쉼, 0 앞 음 이어서) */
  lead: number[];
  bass: number;
}
interface Track {
  bpm: number;
  bars: Bar[];
  arpVol: number;
  leadVol: number;
  file: string;
}

/** 낮: 느긋하고 밝은 곡 (다장조 5음: 도 레 미 솔 라) */
const DAY: Track = {
  bpm: 92, arpVol: 0.022, leadVol: 0.05, file: 'bgmVillDay',
  bars: [
    { arp: [60, 64, 67, 72, 67, 64, 67, 72], lead: [76, 0, 79, 76], bass: 48 },
    { arp: [57, 60, 64, 69, 64, 60, 64, 69], lead: [74, 0, 72, 0], bass: 45 },
    { arp: [55, 60, 62, 67, 62, 60, 62, 67], lead: [72, 74, 76, 79], bass: 43 },
    { arp: [62, 67, 69, 74, 69, 67, 69, 74], lead: [81, 0, 79, -1], bass: 50 },
    { arp: [60, 64, 67, 72, 67, 64, 67, 72], lead: [79, 0, 76, 74], bass: 48 },
    { arp: [57, 60, 64, 69, 64, 60, 64, 69], lead: [72, 0, 69, 72], bass: 45 },
    { arp: [55, 59, 62, 67, 62, 59, 62, 67], lead: [74, 0, 76, 74], bass: 43 },
    { arp: [60, 64, 67, 72, 76, 72, 67, 64], lead: [72, 0, 0, -1], bass: 48 },
  ],
};

/** 밤: 느리고 고요한 곡 (가단조 5음: 라 도 레 미 솔), 아르페지오는 작게 */
const NIGHT: Track = {
  bpm: 72, arpVol: 0.016, leadVol: 0.04, file: 'bgmVillNight',
  bars: [
    { arp: [57, 60, 64, 69, 64, 60, 64, 69], lead: [76, 0, 0, 74], bass: 45 },
    { arp: [53, 57, 60, 65, 60, 57, 60, 65], lead: [72, 0, 69, 0], bass: 41 },
    { arp: [55, 60, 62, 67, 62, 60, 62, 67], lead: [67, 0, 69, 72], bass: 43 },
    { arp: [52, 57, 59, 64, 59, 57, 59, 64], lead: [69, 0, 0, -1], bass: 40 },
    { arp: [57, 60, 64, 69, 64, 60, 64, 69], lead: [72, 0, 74, 76], bass: 45 },
    { arp: [53, 57, 60, 65, 60, 57, 60, 65], lead: [79, 0, 76, 0], bass: 41 },
    { arp: [55, 59, 62, 67, 62, 59, 62, 67], lead: [74, 0, 72, 74], bass: 43 },
    { arp: [57, 60, 64, 69, 72, 69, 64, 60], lead: [69, 0, 0, -1], bass: 45 },
  ],
};

const TRACKS = { day: DAY, night: NIGHT };
export type TrackName = keyof typeof TRACKS;

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let current: TrackName | null = null;
let want: TrackName | null = null;
let master: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
const files = new Map<TrackName, string | null>();
let fileEl: HTMLAudioElement | null = null;

function note(a: AudioContext, out: AudioNode, type: OscillatorType, f: number, t: number, dur: number, vol: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function schedule() {
  const a = audioCtx();
  if (!a || !master || !current) return;
  const tr = TRACKS[current];
  const eighth = 60 / tr.bpm / 2;
  if (nextAt < a.currentTime) nextAt = a.currentTime + 0.05;
  while (nextAt < a.currentTime + 0.3) {
    const bar = tr.bars[Math.floor(step / 8) % tr.bars.length];
    const i = step % 8;
    const t = nextAt;
    if (bar.arp[i] >= 0) note(a, master, 'triangle', freq(bar.arp[i]), t, eighth * 1.6, tr.arpVol);
    if (i % 4 === 0) note(a, master, 'sine', freq(bar.bass), t, eighth * 3.6, 0.07);
    if (i % 2 === 0) {
      const q = i / 2;
      const m = bar.lead[q];
      if (m > 0) {
        let len = 1;
        while (q + len < 4 && bar.lead[q + len] === 0) len++;
        note(a, master, 'triangle', freq(m), t, eighth * 2 * len * 0.95, tr.leadVol);
        note(a, master, 'sine', freq(m + 12), t, eighth * 2 * len * 0.7, tr.leadVol * 0.3);
      }
    }
    nextAt += eighth;
    step++;
  }
}

function stopFile() {
  fileEl?.pause();
  fileEl = null;
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
  master.gain.exponentialRampToValueAtTime(0.6, a.currentTime + 1.2);
  step = 0;
  nextAt = a.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 100);
  schedule();
}

function start(name: TrackName) {
  current = name;
  stopFile();
  const url = files.get(name);
  if (url === undefined) {
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
    fileEl.volume = 0.45;
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
  const a = audioCtx();
  if (a && master) {
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(master.gain.value, a.currentTime);
    master.gain.linearRampToValueAtTime(0, a.currentTime + 0.4);
  }
}

function apply() {
  const target = !sound.on || !sound.bgmOn || !sound.unlocked || document.hidden ? null : want;
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
  refresh: apply,
};

// 첫 입력 뒤에 시작 (app.ts 의 unlock 이 먼저 불린다: capture)
window.addEventListener('pointerdown', () => setTimeout(apply, 0), { passive: true });
window.addEventListener('keydown', () => setTimeout(apply, 0));
document.addEventListener('visibilitychange', apply);
sound.onChange(apply);
