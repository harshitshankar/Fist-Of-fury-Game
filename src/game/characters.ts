// Character roster — Tekken / DBFZ inspired fighters.
// Each fighter has unique stats and a signature special move.

export interface Fighter {
  id: string;
  name: string;
  title: string;
  emoji: string;
  color: string;      // primary body color
  accent: string;     // accent / aura color
  speed: number;      // movement multiplier
  power: number;      // damage multiplier
  health: number;     // base HP
  jump: number;       // jump strength
  special: string;    // special move name
  specialColor: string; // main beam color (unique per fighter)
  beamCore?: string;  // inner white-hot core tint
  beamGlow?: string;  // outer blurred aura color
  style: string;      // fighting style description
}

export const FIGHTERS: Fighter[] = [
  {
    id: "blaze",
    name: "BLAZE",
    title: "The Inferno King",
    emoji: "🔥",
    color: "#ff5b3b",
    accent: "#ffd23b",
    speed: 1.05,
    power: 1.1,
    health: 100,
    jump: 1.0,
    special: "DRAGON FLAME",
    specialColor: "#ff6a00",
    beamCore: "#fff3c0",
    beamGlow: "#ff2a00",
    style: "Aggressive Striker",
  },
  {
    id: "frost",
    name: "FROST",
    title: "Ice Sovereign",
    emoji: "❄️",
    color: "#3bd0ff",
    accent: "#e0fbff",
    speed: 1.0,
    power: 1.05,
    health: 105,
    jump: 1.05,
    special: "GLACIER WAVE",
    specialColor: "#36c6ff",
    beamCore: "#eafdff",
    beamGlow: "#0a6cff",
    style: "Zoner / Control",
  },
  {
    id: "volt",
    name: "VOLT",
    title: "Thunder Fist",
    emoji: "⚡",
    color: "#ffe23b",
    accent: "#fff7c2",
    speed: 1.2,
    power: 0.95,
    health: 90,
    jump: 1.15,
    special: "LIGHTNING RUSH",
    specialColor: "#ffe600",
    beamCore: "#ffffff",
    beamGlow: "#ff9d00",
    style: "Speed Rushdown",
  },
  {
    id: "venom",
    name: "VENOM",
    title: "Shadow Assassin",
    emoji: "🐍",
    color: "#8a3bff",
    accent: "#3bff8a",
    speed: 1.1,
    power: 1.0,
    health: 95,
    jump: 1.1,
    special: "TOXIC STRIKE",
    specialColor: "#56ff5b",
    beamCore: "#e8ffe0",
    beamGlow: "#8a00ff",
    style: "Mix-up Master",
  },
  {
    id: "titan",
    name: "TITAN",
    title: "The Unbreakable",
    emoji: "🛡️",
    color: "#9aa3b2",
    accent: "#ffce3b",
    speed: 0.82,
    power: 1.3,
    health: 130,
    jump: 0.85,
    special: "EARTHQUAKE SLAM",
    specialColor: "#e0a23b",
    beamCore: "#fff0c0",
    beamGlow: "#8a4a00",
    style: "Heavy Grappler",
  },
  {
    id: "nova",
    name: "NOVA",
    title: "Cosmic Warrior",
    emoji: "🌟",
    color: "#ff3bd0",
    accent: "#8a3bff",
    speed: 1.08,
    power: 1.08,
    health: 100,
    jump: 1.1,
    special: "SUPERNOVA BEAM",
    specialColor: "#ff3bd0",
    beamCore: "#ffffff",
    beamGlow: "#6a00ff",
    style: "All-Rounder",
  },
  {
    id: "ronin",
    name: "RONIN",
    title: "Blade Master",
    emoji: "⚔️",
    color: "#3bffb0",
    accent: "#ffffff",
    speed: 1.12,
    power: 1.12,
    health: 92,
    jump: 1.05,
    special: "THOUSAND CUTS",
    specialColor: "#3bffd0",
    beamCore: "#ffffff",
    beamGlow: "#00b89e",
    style: "Precision Slasher",
  },
  {
    id: "magma",
    name: "MAGMA",
    title: "Volcanic Beast",
    emoji: "🌋",
    color: "#ff8c3b",
    accent: "#ff3b3b",
    speed: 0.95,
    power: 1.2,
    health: 115,
    jump: 0.95,
    special: "ERUPTION",
    specialColor: "#ff3b00",
    beamCore: "#ffe08a",
    beamGlow: "#b80000",
    style: "Power Bruiser",
  },
];

export function getFighter(id: string): Fighter {
  return FIGHTERS.find((f) => f.id === id) || FIGHTERS[0];
}
