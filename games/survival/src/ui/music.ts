import { sound, whenSound } from './sfx';

/**
 * 배경음: 파일 없이 코드로 만든 짧은 반복곡 (시아배구 games/volleyball/src/ui/music.ts 를 그대로 가져옴).
 * shared/sounds/bgmSurvMain|bgmSurvField|bgmSurvBamboo|bgmSurvPalace|bgmSurvUnderworld|bgmSurvBoss|bgmSurvResult.ogg|.mp3 를 넣으면 그 파일을 반복 재생한다.
 * 곡: 메인 · 맵 4종(들판 · 대나무 숲 · 달빛 궁궐 · 황천길) · 보스 · 결과.
 * 헬 모드: 맵 4곡과 보스 곡을 낮고 빠르게 바꾼 변주 (hellOf. 파일로 바꿀 때는 bgmSurvHellField … bgmSurvHellBoss).
 * 가려진 탭에서는 멈춘다 (아래 apply 의 document.hidden).
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

/** 메인: 느긋하게 통통 튀는 곡 (사장조) */
const MAIN: Track = {
  bpm: 100, arpVol: 0.03, leadVol: 0.045, drums: 'light', file: 'bgmSurvMain',
  bars: [
    { arp: [67, 71, 74, 71, 67, 71, 74, 71], lead: [74, 0, 79, 0], bass: 43 },
    { arp: [64, 67, 71, 67, 64, 67, 71, 67], lead: [76, 79, 83, 79], bass: 40 },
    { arp: [60, 64, 67, 64, 60, 64, 67, 64], lead: [76, 0, 72, 76], bass: 36 },
    { arp: [62, 66, 69, 66, 62, 66, 69, 72], lead: [74, 0, 0, -1], bass: 38 },
  ],
};

/** 들판: 바쁘게 달리는 곡 (마단조 → 사장조) */
const FIELD: Track = {
  bpm: 132, arpVol: 0.028, leadVol: 0.042, drums: 'run', file: 'bgmSurvField',
  bars: [
    { arp: [64, 67, 71, 76, 71, 67, 71, 76], lead: [76, 0, 79, 0], bass: 40 },
    { arp: [64, 67, 71, 76, 71, 67, 71, 76], lead: [83, 79, 76, 0], bass: 40 },
    { arp: [60, 64, 67, 72, 67, 64, 67, 72], lead: [72, 0, 76, 0], bass: 36 },
    { arp: [62, 66, 69, 74, 69, 66, 69, 74], lead: [78, 81, 78, -1], bass: 38 },
    { arp: [67, 71, 74, 79, 74, 71, 74, 79], lead: [79, 0, 83, 86], bass: 43 },
    { arp: [62, 66, 69, 74, 69, 66, 69, 74], lead: [81, 0, 78, 74], bass: 38 },
    { arp: [60, 64, 67, 72, 67, 64, 67, 72], lead: [76, 0, 72, 76], bass: 36 },
    { arp: [59, 63, 66, 71, 75, 71, 66, 63], lead: [75, 0, 0, -1], bass: 35 },
  ],
};

/** 대나무 숲: 가볍게 통통 튀는 5음 음계 (라단조 5음) */
const BAMBOO: Track = {
  bpm: 126, arpVol: 0.028, leadVol: 0.042, drums: 'light', file: 'bgmSurvBamboo',
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

/** 달빛 궁궐: 느리고 고요한 밤의 곡 (나단조) */
const PALACE: Track = {
  bpm: 112, arpVol: 0.026, leadVol: 0.044, drums: 'light', file: 'bgmSurvPalace',
  bars: [
    { arp: [59, 62, 66, 71, 66, 62, 66, 71], lead: [78, 0, 0, 76], bass: 35 },
    { arp: [55, 59, 62, 67, 62, 59, 62, 67], lead: [74, 0, 71, 0], bass: 31 },
    { arp: [57, 61, 64, 69, 64, 61, 64, 69], lead: [73, 0, 76, 0], bass: 33 },
    { arp: [54, 58, 61, 66, 61, 58, 61, 66], lead: [78, 0, 0, -1], bass: 30 },
    { arp: [59, 62, 66, 71, 66, 62, 66, 71], lead: [83, 0, 81, 78], bass: 35 },
    { arp: [52, 55, 59, 64, 59, 55, 59, 64], lead: [79, 0, 76, 0], bass: 28 },
    { arp: [57, 61, 64, 69, 64, 61, 64, 69], lead: [76, 73, 71, 73], bass: 33 },
    { arp: [59, 62, 66, 71, 74, 71, 66, 62], lead: [71, 0, 0, -1], bass: 35 },
  ],
};

/** 황천길: 낮게 깔리는 으스스한 곡 (다단조, 반음이 섞인다) */
const UNDERWORLD: Track = {
  bpm: 118, arpVol: 0.026, leadVol: 0.04, drums: 'run', file: 'bgmSurvUnderworld',
  bars: [
    { arp: [48, 55, 60, 63, 60, 55, 60, 63], lead: [72, 0, 75, 0], bass: 36 },
    { arp: [48, 55, 60, 63, 60, 55, 60, 66], lead: [74, 0, 72, 0], bass: 36 },
    { arp: [44, 51, 56, 60, 56, 51, 56, 60], lead: [68, 0, 72, 75], bass: 32 },
    { arp: [43, 50, 55, 59, 55, 50, 55, 59], lead: [74, 0, 71, -1], bass: 31 },
    { arp: [48, 55, 60, 63, 60, 55, 60, 63], lead: [79, 0, 78, 79], bass: 36 },
    { arp: [41, 48, 53, 56, 53, 48, 53, 56], lead: [77, 0, 72, 0], bass: 29 },
    { arp: [44, 51, 56, 60, 56, 51, 56, 60], lead: [75, 0, 72, 68], bass: 32 },
    { arp: [43, 50, 55, 59, 62, 59, 55, 50], lead: [71, 0, 0, -1], bass: 31 },
  ],
};

/** 보스: 낮고 급한 곡 (마단조) */
const BOSS: Track = {
  bpm: 152, arpVol: 0.03, leadVol: 0.045, drums: 'run', file: 'bgmSurvBoss',
  bars: [
    { arp: [52, 59, 64, 59, 52, 59, 64, 59], lead: [76, 0, 75, 76], bass: 40 },
    { arp: [52, 59, 64, 59, 52, 59, 64, 67], lead: [79, 0, 76, 0], bass: 40 },
    { arp: [48, 55, 60, 55, 48, 55, 60, 55], lead: [72, 0, 71, 72], bass: 36 },
    { arp: [47, 54, 59, 54, 47, 54, 59, 63], lead: [75, 0, 71, -1], bass: 35 },
  ],
};

/** 결과: 느긋하고 따뜻한 곡 (사장조) */
const RESULT: Track = {
  bpm: 92, arpVol: 0.03, leadVol: 0.045, drums: 'none', file: 'bgmSurvResult',
  bars: [
    { arp: [67, 71, 74, 79, 74, 71, 74, 79], lead: [83, 0, 79, 0], bass: 43 },
    { arp: [60, 64, 67, 72, 67, 64, 67, 72], lead: [84, 0, 83, 79], bass: 36 },
    { arp: [62, 66, 69, 74, 69, 66, 69, 74], lead: [81, 0, 78, 0], bass: 38 },
    { arp: [67, 71, 74, 79, 74, 71, 74, 71], lead: [79, 0, 0, -1], bass: 43 },
  ],
};

/**
 * 헬 모드 변주: 같은 곡을 완전 4도(반음 5개) 낮추고 16% 빠르게, 북은 언제나 급한 박자로. 멜로디는 조금 작게, 아르페지오는 조금 크게 (낮게 으르렁거리는 느낌)
 */
const HELL_DOWN = 5;
const HELL_FAST = 1.16;
const hellOf = (t: Track, file: string): Track => ({
  ...t,
  bpm: Math.round(t.bpm * HELL_FAST),
  drums: 'run',
  arpVol: t.arpVol * 1.15,
  leadVol: t.leadVol * 0.9,
  file,
  bars: t.bars.map((b) => ({
    arp: b.arp.map((n) => (n < 0 ? n : n - HELL_DOWN)),
    lead: b.lead?.map((n) => (n > 0 ? n - HELL_DOWN : n)),
    bass: b.bass - HELL_DOWN,
  })),
});

const TRACKS = {
  main: MAIN, field: FIELD, bamboo: BAMBOO, palace: PALACE, underworld: UNDERWORLD, boss: BOSS, result: RESULT,
  hellField: hellOf(FIELD, 'bgmSurvHellField'), hellBamboo: hellOf(BAMBOO, 'bgmSurvHellBamboo'), hellPalace: hellOf(PALACE, 'bgmSurvHellPalace'),
  hellUnderworld: hellOf(UNDERWORLD, 'bgmSurvHellUnderworld'), hellBoss: hellOf(BOSS, 'bgmSurvHellBoss'),
};
/** 맵 id → 그 맵의 곡 (없는 맵은 들판 곡). hell: 헬 모드의 변주 */
export const mapTrack = (map: string, hell = false): TrackName => {
  const m = map === 'bamboo' || map === 'palace' || map === 'underworld' ? map : 'field';
  if (!hell) return m;
  return m === 'bamboo' ? 'hellBamboo' : m === 'palace' ? 'hellPalace' : m === 'underworld' ? 'hellUnderworld' : 'hellField';
};
/** 보스 곡 (헬 모드는 변주) */
export const bossTrack = (hell = false): TrackName => (hell ? 'hellBoss' : 'boss');
export type TrackName = keyof typeof TRACKS;

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
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
 * 오디오 깨우기 (shared/sound.js 와 같은 방식): 첫 입력 한 번으로 끝내지 않고 실제로 소리가 날 때까지 입력마다 다시 깨운다.
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
  // 브라우저는 사용자가 한 번 누른 뒤에야 소리를 낼 수 있다
  if (!unlocked) {
    unlocked = true;
    apply();
  }
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  if (current && fileEl?.paused) playFile(fileEl);
  const ctxOk = !ctx || ctx.state === 'running' || ctx.state === 'closed';
  if (ctxOk && !(current && fileEl?.paused)) disarmWake();
}
/** 파일 곡 재생: 막히면(입력 밖에서 부름) 다음 입력 때 다시 시도 */
function playFile(el: HTMLAudioElement) {
  void el.play().catch(() => {
    if (fileEl === el) armWake();
  });
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
  const tr: Track = TRACKS[current];
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
    playFile(fileEl);
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

// 첫 입력을 기다린다 (wake 가 unlocked 를 켠다)
armWake();
document.addEventListener('visibilitychange', apply);
whenSound(() => {
  sound.onBgm(() => apply());
  apply();
});
