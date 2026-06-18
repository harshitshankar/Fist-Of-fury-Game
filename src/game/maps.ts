// Battle arenas / maps. Each map renders a unique animated gradient
// background with parallax layers drawn on the canvas.

export interface ArenaMap {
  id: string;
  name: string;
  emoji: string;
  sky: [string, string];     // gradient top -> bottom
  ground: string;
  groundEdge: string;
  accent: string;
  particle: string;          // floating particle color
  mood: string;
}

export const MAPS: ArenaMap[] = [
  {
    id: "dojo",
    name: "Ancient Dojo",
    emoji: "🏯",
    sky: ["#2a1a3e", "#5a2d5a"],
    ground: "#3a2a1a",
    groundEdge: "#c98a3b",
    accent: "#ff9b3b",
    particle: "#ffce8a",
    mood: "Sunset over the temple",
  },
  {
    id: "neon",
    name: "Neon City",
    emoji: "🌆",
    sky: ["#0a0a2e", "#2a0a4e"],
    ground: "#12122a",
    groundEdge: "#3bd0ff",
    accent: "#ff3bd0",
    particle: "#3bd0ff",
    mood: "Cyberpunk rooftops",
  },
  {
    id: "volcano",
    name: "Volcano Crater",
    emoji: "🌋",
    sky: ["#3a0a0a", "#7a1a0a"],
    ground: "#2a0a0a",
    groundEdge: "#ff5b00",
    accent: "#ffce3b",
    particle: "#ff7b3b",
    mood: "Lava and ember storm",
  },
  {
    id: "space",
    name: "Cosmic Void",
    emoji: "🌌",
    sky: ["#05051a", "#1a0a3e"],
    ground: "#0a0a2a",
    groundEdge: "#8a3bff",
    accent: "#3bffd0",
    particle: "#ffffff",
    mood: "Battle among the stars",
  },
  {
    id: "frozen",
    name: "Frozen Peaks",
    emoji: "🏔️",
    sky: ["#0a2a4e", "#2a6a9e"],
    ground: "#aeebff",
    groundEdge: "#ffffff",
    accent: "#3bd0ff",
    particle: "#ffffff",
    mood: "Snowstorm summit",
  },
  {
    id: "arena",
    name: "Grand Arena",
    emoji: "🏟️",
    sky: ["#1a1a2e", "#3a2a4e"],
    ground: "#2a2a3a",
    groundEdge: "#ffce3b",
    accent: "#ff5b3b",
    particle: "#ffce3b",
    mood: "Roaring crowd colosseum",
  },
];

export function getMap(id: string): ArenaMap {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
