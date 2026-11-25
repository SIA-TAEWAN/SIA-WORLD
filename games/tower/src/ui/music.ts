/**
 * 시아의탑 배경음: 새 소리 파일 없이, 다른 게임이 이미 쓰는 코드 반복곡을 빌려 쓴다
 * (시아서바이벌 games/survival/src/ui/music.ts 의 메인 · 달빛 궁궐 · 대나무 숲 · 보스 곡, 시아마을 games/village/src/ui/music.ts 의 낮 곡 — 같은 악보).
 * 소리 파일은 찾지 않는다 (새 파일 없음 — 없는 파일을 찾으면 콘솔에 404 가 남는다). 곡의 file 이름은 나중에 파일로 바꿀 때 쓸 이름.
 * 켜기/끄기: 공용 효과음(shared/sound.js 'sia:sound')과 공용 배경음 설정('sia:bgm')이 모두 켜져 있을 때만. 가려진 탭에서는 멈춘다.
 */
import type { SoundModule } from '../net/world';

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
  /** 북 (보스 곡만) */
  drums: boolean;
  file: string;
}

/** 처음 화면: 시아서바이벌 메인 곡 */
const TITLE: Track = {
  bpm: 100, arpVol: 0.03, leadVol: 0.045, drums: false, file: 'bgmTowerTitle',
  bars: [
    { arp: [67, 71, 74, 71, 67, 71, 74, 71], lead: [74, 0, 79, 0], bass: 43 },
    { arp: [64, 67, 71, 67, 64, 67, 71, 67], lead: [76, 79, 83, 79], bass: 40 },
    { arp: [60, 64, 67, 64, 60, 64, 67, 64], lead: [76, 0, 72, 76], bass: 36 },
    { arp: [62, 66, 69, 66, 62, 66, 69, 72], lead: [74, 0, 0, -1], bass: 38 },
  ],
};
/** 1구역 돌 복도: 시아서바이벌 달빛 궁궐 (나단조, 고요한 밤) */
const STONE: Track = {
  bpm: 112, arpVol: 0.026, leadVol: 0.044, drums: false, file: 'bgmTowerStone',
  bars: [
    { arp: [59, 62, 66, 71, 66, 62, 66, 71], lead: [78, 0, 0, 76], bass: 35 },
    { arp: [55, 59, 62, 67, 62, 59, 62, 67], lead: [74, 0, 71, 0], bass: 31 },
    { arp: [57, 61, 64, 69, 64, 61, 64, 69], lead: [73, 0, 76, 0], bass: 33 },
    { arp: [54, 58, 61, 66, 61, 58, 61, 66], lead: [78, 0, 0, -1], bass: 30 },
    { arp: [59, 62, 66, 71, 66, 62, 66, 71], lead: [83, 0, 81, 78], bass: 35 },
    { arp: [52, 55, 59, 64, 59, 55, 59, 64], lead: [79, 0, 76, 0], bass: 28 },
    { arp: [57, 61, 64, 69, 64, 61, 64, 69], lead: [76, 73, 71, 73], bass: 33 },
    { arp: [54, 58, 61, 66, 61, 58, 61, 66], lead: [78, 0, 0, -1], bass: 30 },
  ],
};
/** 2구역 이끼 낀 회랑: 시아서바이벌 대나무 숲 (라단조 5음) */
const MOSS: Track = {
  bpm: 126, arpVol: 0.028, leadVol: 0.042, drums: false, file: 'bgmTowerMoss',
  bars: [
    { arp: [62, 65, 69, 72, 69, 65, 69, 72], lead: [74, 0, 72, 69], bass: 38 },
    { arp: [60, 65, 67, 72, 67, 65, 67, 72], lead: [72, 0, 69, 67], bass: 36 },
    { arp: [62, 65, 69, 74, 69, 65, 69, 74], lead: [69, 72, 74, 77], bass: 38 },
    { arp: [57, 62, 64, 69, 64, 62, 64, 69], lead: [76, 0, 74, -1], bass: 33 },
    { arp: [65, 69, 72, 77, 72, 69, 72, 77], lead: [77, 0, 74, 72], bass: 41 },
    { arp: [60, 65, 67, 72, 67, 65, 67, 72], lead: [72, 74, 72, 69], bass: 36 },
    { arp: [62, 65, 69, 74, 69, 65, 69, 74], lead: [74, 0, 77, 0], bass: 38 },
    { arp: [57, 62, 64, 69, 72, 69, 64, 62], lead: [74, 0, 0, -1], bass: 33 },
  ],
};
/** 휴식층 · 체크포인트: 시아마을 낮 곡 */
const REST: Track = {
  bpm: 92, arpVol: 0.022, leadVol: 0.05, drums: false, file: 'bgmTowerRest',
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
/** 보스층: 시아서바이벌 보스 곡 */
const BOSS: Track = {
  bpm: 152, arpVol: 0.03, leadVol: 0.045, drums: true, file: 'bgmTowerBoss',
  bars: [
    { arp: [52, 59, 64, 59, 52, 59, 64, 59], lead: [76, 0, 75, 76], bass: 40 },
    { arp: [52, 59, 64, 59, 52, 59, 64, 67], lead: [79, 0, 76, 0], bass: 40 },
    { arp: [48, 55, 60, 55, 48, 55, 60, 55], lead: [72, 0, 71, 72], bass: 36 },
    { arp: [47, 54, 59, 54, 47, 54, 59, 63], lead: [75, 0, 71, -1], bass: 35 },
  ],
};

const TRACKS = { title: TITLE, stone: STONE, moss: MOSS, rest: REST, boss: BOSS };
export type TrackName = keyof typeof TRACKS;

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let snd: SoundModule | null = null;
let ac: AudioContext | null = null;
let current: TrackName | null = null;
let want: TrackName | null = null;
let master: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
let unlocked = false;

function audio(): AudioContext | null {
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
    return ac;
  } catch {
    return null;
  }
}

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
/** 북 (짧은 잡음) */
function drum(a: AudioContext, out: AudioNode, t: number, vol: number, hi: boolean) {
  const n = Math.floor(a.sampleRate * (hi ? 0.03 : 0.08));
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** (hi ? 3 : 1.5);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(out);
  src.start(t);
}

function schedule() {
  const a = ac;
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
    if (tr.drums) drum(a, master, t, i % 4 === 0 ? 0.09 : 0.03, i % 4 !== 0);
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

function startSynth() {
  const a = audio();
  if (!a) return;
  if (!master) {
    master = a.createGain();
    master.connect(a.destination);
  }
  master.gain.cancelScheduledValues(a.currentTime);
  master.gain.setValueAtTime(0.0001, a.currentTime);
  master.gain.exponentialRampToValueAtTime(0.55, a.currentTime + 1.2);
  step = 0;
  nextAt = a.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 100);
  schedule();
}

function start(name: TrackName) {
  current = name;
  startSynth();
}

function stop() {
  current = null;
  if (timer) clearInterval(timer);
  timer = null;
  const a = ac;
  if (a && master) {
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(master.gain.value, a.currentTime);
    master.gain.linearRampToValueAtTime(0, a.currentTime + 0.4);
  }
}

function apply() {
  const on = !!snd && !snd.isMuted() && snd.isBgmOn();
  const target = !on || !unlocked || document.hidden ? null : want;
  if (target === current) return;
  if (current) stop();
  if (target) start(target);
}

export const music = {
  /** 공용 효과음 모듈을 붙인다 (켜기/끄기 설정을 따른다) */
  attach(m: SoundModule) {
    snd = m;
    m.onMuteChange(apply);
    m.onBgmChange(apply);
    apply();
  },
  /** 이 곡을 틀어 둔다 (첫 입력 전에는 기다렸다가 시작). null = 멈춤 */
  play(name: TrackName | null) {
    want = name;
    apply();
  },
};

// 브라우저 정책: 첫 클릭·터치·키 입력 뒤에 시작한다
const wake = () => {
  unlocked = true;
  audio();
  setTimeout(apply, 0);
};
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, wake, { capture: true, passive: true });
  document.addEventListener('visibilitychange', apply);
}
