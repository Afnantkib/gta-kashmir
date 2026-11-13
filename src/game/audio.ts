// Procedural Web Audio Engine for GTA Kashmir
let AC: AudioContext | null = null;
let motorOsc: OscillatorNode | null = null;
let motorGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sirenOsc: OscillatorNode | null = null;
let sirenLFO: OscillatorNode | null = null;
let sirenGain: GainNode | null = null;
let isMuted = false;
let isSirenActive = false;
let noiseBuffer: AudioBuffer | null = null;

// GTA San Andreas Theme Sequencer Config
const GTA_MUSIC = {
  tempo: 92,
  step: 0,
  nextTime: 0,
  stepDur: (60 / 92) / 4, // ~0.163s
  isPlaying: false,

  bassSteps: {
    0: { f: 49.0, d: 0.45 }, 6: { f: 49.0, d: 0.3 }, 10: { f: 58.27, d: 0.3 }, 12: { f: 65.41, d: 0.3 },
    16: { f: 49.0, d: 0.55 }, 22: { f: 49.0, d: 0.3 }, 26: { f: 87.31, d: 0.3 }, 28: { f: 73.42, d: 0.25 },
    32: { f: 49.0, d: 0.45 }, 38: { f: 49.0, d: 0.3 }, 42: { f: 58.27, d: 0.3 }, 44: { f: 65.41, d: 0.3 },
    48: { f: 77.78, d: 0.45 }, 54: { f: 73.42, d: 0.3 }, 58: { f: 65.41, d: 0.25 }, 62: { f: 87.31, d: 0.3 }
  } as Record<number, { f: number; d: number }>,

  leadSteps: {
    0: { f: 587.33, d: 0.62 }, 6: { f: 523.25, d: 0.45 }, 10: { f: 466.16, d: 0.28 }, 12: { f: 392.0, d: 1.10 },
    22: { f: 698.46, d: 0.55 }, 26: { f: 587.33, d: 0.40 }, 30: { f: 466.16, d: 0.35 },
    32: { f: 392.0, d: 0.50 }, 38: { f: 587.33, d: 0.30 }, 42: { f: 783.99, d: 0.60 },
    48: { f: 587.33, d: 0.28 }, 52: { f: 466.16, d: 0.28 }, 56: { f: 587.33, d: 0.55 }, 62: { f: 392.0, d: 0.95 }
  } as Record<number, { f: number; d: number }>,

  kicks: [0, 6, 10, 16, 22, 26, 30, 32, 38, 42, 48, 54, 58, 62],
  snares: [4, 12, 20, 28, 36, 44, 52, 60],
};

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = b.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = b;
  return b;
}

function playKick(t: number) {
  if (!AC || !musicGain) return;
  const osc = AC.createOscillator();
  const g = AC.createGain();
  osc.frequency.setValueAtTime(145, t);
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.14);
  g.gain.setValueAtTime(0.85, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  osc.connect(g);
  g.connect(musicGain);
  osc.start(t);
  osc.stop(t + 0.3);
}

function playSnare(t: number) {
  if (!AC || !musicGain) return;
  const src = AC.createBufferSource();
  src.buffer = getNoiseBuffer(AC);
  const f = AC.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.setValueAtTime(900, t);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.48, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  src.connect(f);
  f.connect(g);
  g.connect(musicGain);
  src.start(t);
  src.stop(t + 0.22);
}

function playBass(t: number, freq: number, dur: number) {
  if (!AC || !musicGain) return;
  const osc = AC.createOscillator();
  const f = AC.createBiquadFilter();
  const g = AC.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(450, t);
  g.gain.setValueAtTime(0.65, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(musicGain);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function playLead(t: number, freq: number, dur: number) {
  if (!AC || !musicGain) return;
  const osc = AC.createOscillator();
  const f = AC.createBiquadFilter();
  const g = AC.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1600, t);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(musicGain);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function scheduleMusic() {
  if (!AC || !GTA_MUSIC.isPlaying) return;
  while (GTA_MUSIC.nextTime < AC.currentTime + 0.12) {
    const st = GTA_MUSIC.step;
    const t = GTA_MUSIC.nextTime;
    if (GTA_MUSIC.kicks.includes(st)) playKick(t);
    if (GTA_MUSIC.snares.includes(st)) playSnare(t);
    if (GTA_MUSIC.bassSteps[st]) {
      const b = GTA_MUSIC.bassSteps[st];
      playBass(t, b.f, b.d);
    }
    if (GTA_MUSIC.leadSteps[st]) {
      const l = GTA_MUSIC.leadSteps[st];
      playLead(t, l.f, l.d);
    }
    GTA_MUSIC.nextTime += GTA_MUSIC.stepDur;
    GTA_MUSIC.step = (GTA_MUSIC.step + 1) % 64;
  }
}

export function initAudio() {
  if (AC) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    AC = new AudioCtx();

    // Motor Sound Oscillator
    motorOsc = AC.createOscillator();
    motorOsc.type = 'triangle';
    const f = AC.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    motorGain = AC.createGain();
    motorGain.gain.value = 0.04;
    motorOsc.connect(f);
    f.connect(motorGain);
    motorGain.connect(AC.destination);
    motorOsc.start();

    // Music Channel
    musicGain = AC.createGain();
    musicGain.gain.value = 0.32;
    musicGain.connect(AC.destination);

    // Police Siren Rig
    sirenOsc = AC.createOscillator();
    sirenOsc.type = 'sawtooth';
    sirenLFO = AC.createOscillator();
    sirenLFO.frequency.value = 2.0; // 2 Hz wail
    const lfoGain = AC.createGain();
    lfoGain.gain.value = 250; // modulate frequency ±250 Hz
    sirenLFO.connect(lfoGain);
    sirenOsc.frequency.value = 750;
    lfoGain.connect(sirenOsc.frequency);
    
    sirenGain = AC.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(AC.destination);
    sirenOsc.start();
    sirenLFO.start();

    GTA_MUSIC.isPlaying = false;
  } catch (err) {
    console.warn('[Audio] Web Audio initialization warning:', err);
  }
}

let themeAudio: HTMLAudioElement | null = null;
let clashAudio: HTMLAudioElement | null = null;
let isClashSongPlaying = false;
let lastCollisionAudioTime = 0;

export const THEME_AUDIO_PATH = '/assets/audio/gta-san-andreas-theme.mp3';
export const KASHMIRI_AUDIO_PATH = '/assets/audio/danisha-kale-ha-phot.mp3';
const THEME_VOLUME = 0.42;
const THEME_DUCKED = 0.06;
const CLASH_VOLUME = 0.95;

function makeAudio(src: string, loop: boolean): HTMLAudioElement {
  const el = new Audio(src);
  el.preload = 'auto';
  el.loop = loop;
  return el;
}

function setThemeVolume(vol: number) {
  if (themeAudio) themeAudio.volume = isMuted ? 0 : vol;
}

/**
 * Plays physical metal collision crash SFX via Web Audio API.
 */
export function playCrashFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    // Heavy metal impact thud
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.24);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.3);

    // Crunch noise impact
    const noise = AC.createBufferSource();
    noise.buffer = getNoiseBuffer(AC);
    const filter = AC.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(550, t);
    filter.Q.value = 1.6;
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.42, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(AC.destination);
    noise.start(t);
    noise.stop(t + 0.26);
  } catch {}
}

/**
 * Plays the song once when a vehicle clashes with a wall/boundary/hotel/vehicle.
 * If the song is already actively playing from a clash, it lets it play through once
 * without stutter-restarting on continuous contact.
 */
export function playCollisionAudio(forceRestart: boolean = false) {
  playCrashFX();

  const now = Date.now();
  if (now - lastCollisionAudioTime < 600) return;
  lastCollisionAudioTime = now;

  try {
    if (!clashAudio) {
      clashAudio = makeAudio(KASHMIRI_AUDIO_PATH, false);
      clashAudio.onended = () => {
        isClashSongPlaying = false;
        setThemeVolume(THEME_VOLUME);
      };
    }

    if (isClashSongPlaying && !clashAudio.paused && !clashAudio.ended && !forceRestart) {
      return;
    }

    clashAudio.pause();
    clashAudio.currentTime = 0;
    clashAudio.volume = isMuted ? 0 : CLASH_VOLUME;
    setThemeVolume(THEME_DUCKED);

    const playPromise = clashAudio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          isClashSongPlaying = true;
        })
        .catch(e => {
          console.warn('[Audio] Collision audio play catch:', e);
        });
    }
  } catch (err) {
    console.warn('[Audio] Collision audio error:', err);
  }
}

export function playKashmiriSoundtrack() {
  try {
    if (!themeAudio) {
      themeAudio = makeAudio(THEME_AUDIO_PATH, true);
    }
    themeAudio.loop = true;
    setThemeVolume(isClashSongPlaying ? THEME_DUCKED : THEME_VOLUME);
    if (isMuted) {
      themeAudio.pause();
      return;
    }
    const playPromise = themeAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.warn('[Audio] Theme play catch:', e);
      });
    }
  } catch (err) {
    console.warn('[Audio] Theme audio error:', err);
  }
}

export function updateEngineSound(vehicleType: string, speedMps: number) {
  if (!motorOsc || !motorGain) return;
  const speed = Math.abs(speedMps);
  // Tuned for high speed up to 55.6 m/s (200 km/h)
  const speedRatio = Math.min(1.0, speed / 55.6);

  if (vehicleType === 'auto') {
    motorOsc.type = 'triangle';
    motorOsc.frequency.setTargetAtTime(80 + speedRatio * 850, AC!.currentTime, 0.04);
    motorGain.gain.setTargetAtTime(isMuted ? 0 : 0.035 + speedRatio * 0.05, AC!.currentTime, 0.04);
  } else if (vehicleType === 'bike') {
    motorOsc.type = 'sawtooth';
    motorOsc.frequency.setTargetAtTime(28 + speedRatio * 95, AC!.currentTime, 0.04); // deep aggressive thump
    motorGain.gain.setTargetAtTime(isMuted ? 0 : 0.045 + speedRatio * 0.065, AC!.currentTime, 0.04);
  } else if (vehicleType === 'police') {
    motorOsc.type = 'sawtooth';
    motorOsc.frequency.setTargetAtTime(95 + speedRatio * 280, AC!.currentTime, 0.04); // high-rev roar
    motorGain.gain.setTargetAtTime(isMuted ? 0 : 0.05 + speedRatio * 0.07, AC!.currentTime, 0.04);
  } else {
    // Taxi
    motorOsc.type = 'triangle';
    motorOsc.frequency.setTargetAtTime(60 + speedRatio * 220, AC!.currentTime, 0.04);
    motorGain.gain.setTargetAtTime(isMuted ? 0 : 0.04 + speedRatio * 0.055, AC!.currentTime, 0.04);
  }
}

export function setPursuitSiren(active: boolean) {
  isSirenActive = active;
  if (!sirenGain) return;
  sirenGain.gain.setTargetAtTime(active && !isMuted ? 0.22 : 0, AC!.currentTime, 0.1);
}

export function toggleAudioMute(): boolean {
  isMuted = !isMuted;
  if (motorGain) motorGain.gain.value = isMuted ? 0 : 0.05;
  if (musicGain) musicGain.gain.value = isMuted ? 0 : 0.28;
  if (sirenGain) sirenGain.gain.value = isMuted || !isSirenActive ? 0 : 0.22;
  if (themeAudio) {
    themeAudio.volume = isMuted ? 0 : isClashSongPlaying ? THEME_DUCKED : THEME_VOLUME;
    if (isMuted) themeAudio.pause();
    else void themeAudio.play().catch(() => {});
  }
  if (clashAudio) clashAudio.volume = isMuted ? 0 : CLASH_VOLUME;
  return isMuted;
}

export function playRewardChime() {
  if (!AC || isMuted) return;
  const osc = AC.createOscillator();
  const g = AC.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523.25, AC.currentTime); // C5
  osc.frequency.exponentialRampToValueAtTime(1046.5, AC.currentTime + 0.18); // C6
  g.gain.setValueAtTime(0.3, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.35);
  osc.connect(g);
  g.connect(AC.destination);
  osc.start();
  osc.stop(AC.currentTime + 0.36);
}

// ----------------------------------------------------------------------------
// DAL LAKE MAYHEM — PROCEDURAL COMBAT AUDIO ENGINE
// ----------------------------------------------------------------------------

export function playMachineGunFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.06);
    g.gain.setValueAtTime(0.38, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.08);

    const noise = AC.createBufferSource();
    noise.buffer = getNoiseBuffer(AC);
    const filter = AC.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1800, t);
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.32, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(AC.destination);
    noise.start(t);
    noise.stop(t + 0.06);
  } catch {}
}

export function playRocketLaunchFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(650, t + 0.25);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  } catch {}
}

export function playExplosionFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    // Sub-bass punch
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.55);

    // Blast noise
    const noise = AC.createBufferSource();
    noise.buffer = getNoiseBuffer(AC);
    const filter = AC.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.65, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(AC.destination);
    noise.start(t);
    noise.stop(t + 0.48);
  } catch {}
}

export function playGrenadeLaunchFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.12);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch {}
}

export function playKangriFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const roar = AC.createOscillator();
    const rg = AC.createGain();
    roar.type = 'sawtooth';
    roar.frequency.setValueAtTime(220, t);
    roar.frequency.exponentialRampToValueAtTime(55, t + 0.55);
    rg.gain.setValueAtTime(0.42, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    roar.connect(rg);
    rg.connect(AC.destination);
    roar.start(t);
    roar.stop(t + 0.62);

    const noise = AC.createBufferSource();
    noise.buffer = getNoiseBuffer(AC);
    const filter = AC.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.5);
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(AC.destination);
    noise.start(t);
    noise.stop(t + 0.58);

    for (let i = 0; i < 5; i++) {
      const pt = t + i * 0.045;
      const pop = AC.createOscillator();
      const pg = AC.createGain();
      pop.type = 'triangle';
      pop.frequency.setValueAtTime(480 + Math.random() * 520, pt);
      pop.frequency.exponentialRampToValueAtTime(70, pt + 0.1);
      pg.gain.setValueAtTime(0.28, pt);
      pg.gain.exponentialRampToValueAtTime(0.001, pt + 0.12);
      pop.connect(pg);
      pg.connect(AC.destination);
      pop.start(pt);
      pop.stop(pt + 0.14);
    }
  } catch {}
}

export function playFirecrackerFX() {
  if (!AC || isMuted) return;
  try {
    for (let i = 0; i < 4; i++) {
      const delay = i * 0.05;
      const t = AC.currentTime + delay;
      const osc = AC.createOscillator();
      const g = AC.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600 + Math.random() * 400, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g);
      g.connect(AC.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  } catch {}
}

export function playEmpShockwaveFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.52);
  } catch {}
}

export function playHazardDropFX(type: 'oil' | 'spike') {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = type === 'oil' ? 'sine' : 'square';
    osc.frequency.setValueAtTime(type === 'oil' ? 240 : 450, t);
    osc.frequency.exponentialRampToValueAtTime(type === 'oil' ? 90 : 180, t + 0.18);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  } catch {}
}

export function playMissileLockWarningFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(950, t);
    osc.frequency.setValueAtTime(1150, t + 0.08);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    g.connect(AC.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  } catch {}
}

export function playCratePickupFX() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    // Ascending arpeggio chime (C5 -> E5 -> G5)
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const st = t + idx * 0.055;
      const osc = AC!.createOscillator();
      const g = AC!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, st);
      g.gain.setValueAtTime(0.3, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.25);
      osc.connect(g);
      g.connect(AC!.destination);
      osc.start(st);
      osc.stop(st + 0.28);
    });
  } catch {}
}

export function playEliminationHorn() {
  if (!AC || isMuted) return;
  try {
    const t = AC.currentTime;
    [349.23, 440.0, 523.25, 698.46].forEach((freq, idx) => {
      const st = t + idx * 0.08;
      const osc = AC!.createOscillator();
      const g = AC!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, st);
      g.gain.setValueAtTime(0.35, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.38);
      osc.connect(g);
      g.connect(AC!.destination);
      osc.start(st);
      osc.stop(st + 0.4);
    });
  } catch {}
}

