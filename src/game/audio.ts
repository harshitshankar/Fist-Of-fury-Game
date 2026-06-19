// Lightweight procedural sound engine using the Web Audio API.
// No audio files needed — keeps the single-file build small. Generates
// punches, kicks, blocks, special blasts, hits, KO and victory stings.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;   // SFX bus
let musicBus: GainNode | null = null; // music bus (separate volume)
let enabled = true;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.32; // music a bit quieter than SFX
      musicBus.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  // resume if suspended (mobile autoplay policy)
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Call once on a user gesture to unlock audio on mobile.
export function unlockAudio() {
  ensure();
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol = 0.4,
  slideTo?: number
) {
  const c = ensure();
  if (!c || !master || !enabled) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g);
  g.connect(master);
  o.start();
  o.stop(c.currentTime + dur);
}

function noise(dur: number, vol = 0.3, filterFreq = 1000) {
  const c = ensure();
  if (!c || !master || !enabled) return;
  const buffer = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
}

export const Sfx = {
  punch() {
    tone(220, 0.08, "square", 0.25, 90);
    noise(0.06, 0.18, 1800);
  },
  kick() {
    tone(150, 0.12, "square", 0.3, 60);
    noise(0.1, 0.22, 1200);
  },
  block() {
    tone(600, 0.05, "triangle", 0.2, 900);
    noise(0.04, 0.1, 3000);
  },
  hit() {
    tone(120, 0.12, "sawtooth", 0.35, 50);
    noise(0.12, 0.25, 900);
  },
  special() {
    const c = ensure();
    if (!c) return;
    tone(880, 0.5, "sawtooth", 0.3, 110);
    setTimeout(() => tone(440, 0.4, "square", 0.25, 880), 60);
    noise(0.5, 0.2, 2500);
  },
  jump() {
    tone(330, 0.15, "sine", 0.2, 680);
  },
  ko() {
    tone(200, 0.6, "sawtooth", 0.4, 40);
    noise(0.6, 0.35, 700);
  },
  victory() {
    const notes = [523, 659, 784, 1047]; // C E G C
    notes.forEach((n, i) => setTimeout(() => tone(n, 0.4, "triangle", 0.3), i * 130));
  },
  countdown() {
    tone(440, 0.12, "square", 0.3);
  },
  go() {
    tone(880, 0.3, "square", 0.35, 1200);
  },
};

// ============================================================
//  PROCEDURAL BACKGROUND MUSIC (chiptune-style, looping)
// ============================================================

// Musical note frequencies (we build patterns from semitone offsets).
function noteFreq(semitoneFromA4: number) {
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

interface MusicTrack {
  bpm: number;
  bass: number[];      // semitone offsets (one per beat), -99 = rest
  arp: number[];       // faster arpeggio (two per beat)
  lead: number[];      // melody (one per beat), -99 = rest
  bassType: OscillatorType;
  leadType: OscillatorType;
}

// Hand-authored menu theme; battle themes are generated per-map below.
const TRACKS: Record<string, MusicTrack> = {
  menu: {
    bpm: 96,
    bass: [-17, -17, -12, -12, -15, -15, -10, -10],
    arp: [-5, 0, 3, 7, -2, 3, 7, 10, -3, 0, 5, 8, -1, 3, 8, 12],
    lead: [7, -99, 10, -99, 5, -99, 8, 7],
    bassType: "triangle",
    leadType: "square",
  },
};

// Musical scales (semitone patterns) to give each track a distinct mood.
const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10, 12],          // dark / tense
  major: [0, 2, 4, 5, 7, 9, 11, 12],          // bright / heroic
  pentatonic: [0, 2, 4, 7, 9, 12, 14, 16],    // upbeat / catchy
  phrygian: [0, 1, 3, 5, 7, 8, 10, 12],       // exotic / eastern
  dorian: [0, 2, 3, 5, 7, 9, 10, 12],         // cool / mysterious
  blues: [0, 3, 5, 6, 7, 10, 12, 15],         // gritty / heavy
  lydian: [0, 2, 4, 6, 7, 9, 11, 12],         // dreamy / cosmic
  harmonic: [0, 2, 3, 5, 7, 8, 11, 12],       // dramatic
};

const BASS_TYPES: OscillatorType[] = ["sawtooth", "triangle", "square"];
const LEAD_TYPES: OscillatorType[] = ["square", "triangle", "sawtooth"];

// Deterministic pseudo-random from a string seed (so a track is stable).
function seedRand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a unique looping battle track for a given theme key.
function generateTrack(key: string, scaleName: string, bpm: number, root: number): MusicTrack {
  const rnd = seedRand(key + scaleName);
  const scale = SCALES[scaleName] || SCALES.minor;
  const pick = () => scale[Math.floor(rnd() * scale.length)];

  const bass: number[] = [];
  for (let i = 0; i < 8; i++) bass.push(root - 12 + (i % 2 === 0 ? 0 : pick() % 5));
  const arp: number[] = [];
  for (let i = 0; i < 16; i++) arp.push(root + pick());
  const lead: number[] = [];
  for (let i = 0; i < 8; i++) lead.push(rnd() > 0.25 ? root + 12 + pick() : -99);

  return {
    bpm,
    bass,
    arp,
    lead,
    bassType: BASS_TYPES[Math.floor(rnd() * BASS_TYPES.length)],
    leadType: LEAD_TYPES[Math.floor(rnd() * LEAD_TYPES.length)],
  };
}

// Per-map music definitions: scale + tempo + key give each arena its own song.
const MAP_MUSIC: Record<string, { scale: string; bpm: number; root: number }> = {
  dojo: { scale: "phrygian", bpm: 132, root: -5 },
  neon: { scale: "minor", bpm: 150, root: -3 },
  volcano: { scale: "blues", bpm: 128, root: -7 },
  space: { scale: "lydian", bpm: 120, root: 0 },
  frozen: { scale: "dorian", bpm: 124, root: -2 },
  arena: { scale: "major", bpm: 140, root: -5 },
  forest: { scale: "dorian", bpm: 118, root: -4 },
  desert: { scale: "phrygian", bpm: 126, root: -6 },
  cyber: { scale: "minor", bpm: 158, root: -3 },
  underwater: { scale: "lydian", bpm: 112, root: -1 },
  castle: { scale: "harmonic", bpm: 134, root: -5 },
  graveyard: { scale: "harmonic", bpm: 116, root: -7 },
  sky: { scale: "major", bpm: 138, root: 0 },
  factory: { scale: "blues", bpm: 146, root: -6 },
  temple: { scale: "phrygian", bpm: 122, root: -4 },
  storm: { scale: "minor", bpm: 152, root: -3 },
  jungle: { scale: "pentatonic", bpm: 130, root: -5 },
  crystal: { scale: "lydian", bpm: 128, root: -1 },
  hell: { scale: "blues", bpm: 156, root: -8 },
  heaven: { scale: "major", bpm: 110, root: 2 },
  ruins: { scale: "harmonic", bpm: 124, root: -6 },
  tundra: { scale: "dorian", bpm: 120, root: -2 },
  carnival: { scale: "pentatonic", bpm: 144, root: -3 },
  void: { scale: "minor", bpm: 134, root: -5 },
};

// Pick (and lazily build) the unique battle track for a map id.
export function battleTrackForMap(mapId: string): string {
  const key = "battle_" + mapId;
  if (!TRACKS[key]) {
    const cfg = MAP_MUSIC[mapId] || { scale: "minor", bpm: 138, root: -4 };
    TRACKS[key] = generateTrack(key, cfg.scale, cfg.bpm, cfg.root);
  }
  return key;
}

let musicTimer: number | null = null;
let musicEnabled = true;
let currentTrackKey: string | null = null;

function playMusicNote(semitone: number, dur: number, type: OscillatorType, vol: number) {
  const c = ensure();
  if (!c || !musicBus || !musicEnabled || semitone <= -99) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = noteFreq(semitone);
  const now = c.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(vol, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g);
  g.connect(musicBus);
  o.start(now);
  o.stop(now + dur + 0.02);
}

/** Start (or switch to) a looping music track. */
export function startMusic(key: string) {
  const c = ensure();
  if (!c) return;
  if (currentTrackKey === key && musicTimer !== null) return; // already playing
  stopMusic();
  currentTrackKey = key;
  const track = TRACKS[key] || TRACKS.menu;
  const beat = 60 / track.bpm; // seconds per beat
  let step = 0;

  const tick = () => {
    if (!musicEnabled) return;
    const bi = step % track.bass.length;
    const li = step % track.lead.length;
    // bass on every beat
    playMusicNote(track.bass[bi], beat * 0.95, track.bassType, 0.5);
    // two arpeggio notes per beat
    const a0 = (step * 2) % track.arp.length;
    const a1 = (step * 2 + 1) % track.arp.length;
    playMusicNote(track.arp[a0], beat * 0.45, "square", 0.16);
    window.setTimeout(
      () => playMusicNote(track.arp[a1], beat * 0.45, "square", 0.16),
      beat * 500
    );
    // lead melody
    playMusicNote(track.lead[li], beat * 0.9, track.leadType, 0.22);
    step++;
  };

  tick();
  musicTimer = window.setInterval(tick, beat * 1000);
}

export function stopMusic() {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  currentTrackKey = null;
}

export function setMusicEnabled(on: boolean) {
  musicEnabled = on;
  if (musicBus) musicBus.gain.value = on ? 0.32 : 0;
  if (!on) stopMusic();
}

export function isMusicEnabled() {
  return musicEnabled;
}
