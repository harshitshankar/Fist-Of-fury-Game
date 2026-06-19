// Battle arenas / maps. Each map renders a unique animated background on the
// canvas and has its own procedurally-generated background music
// (see MAP_MUSIC in audio.ts, keyed by map id).

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
  scene?: string;            // which scenery renderer to use (defaults to id)
}

export const MAPS: ArenaMap[] = [
  {
    id: "dojo", name: "Ancient Dojo", emoji: "🏯",
    sky: ["#2a1a3e", "#5a2d5a"], ground: "#3a2a1a", groundEdge: "#c98a3b",
    accent: "#ff9b3b", particle: "#ffce8a", mood: "Sunset over the temple",
  },
  {
    id: "neon", name: "Neon City", emoji: "🌆",
    sky: ["#0a0a2e", "#2a0a4e"], ground: "#12122a", groundEdge: "#3bd0ff",
    accent: "#ff3bd0", particle: "#3bd0ff", mood: "Cyberpunk rooftops",
  },
  {
    id: "volcano", name: "Volcano Crater", emoji: "🌋",
    sky: ["#3a0a0a", "#7a1a0a"], ground: "#2a0a0a", groundEdge: "#ff5b00",
    accent: "#ffce3b", particle: "#ff7b3b", mood: "Lava and ember storm",
  },
  {
    id: "space", name: "Cosmic Void", emoji: "🌌",
    sky: ["#05051a", "#1a0a3e"], ground: "#0a0a2a", groundEdge: "#8a3bff",
    accent: "#3bffd0", particle: "#ffffff", mood: "Battle among the stars",
  },
  {
    id: "frozen", name: "Frozen Peaks", emoji: "🏔️",
    sky: ["#0a2a4e", "#2a6a9e"], ground: "#aeebff", groundEdge: "#ffffff",
    accent: "#3bd0ff", particle: "#ffffff", mood: "Snowstorm summit",
  },
  {
    id: "arena", name: "Grand Arena", emoji: "🏟️",
    sky: ["#1a1a2e", "#3a2a4e"], ground: "#2a2a3a", groundEdge: "#ffce3b",
    accent: "#ff5b3b", particle: "#ffce3b", mood: "Roaring crowd colosseum",
  },
  {
    id: "forest", name: "Enchanted Forest", emoji: "🌲",
    sky: ["#0a2e1a", "#1a5a3a"], ground: "#1a3a1a", groundEdge: "#7bff8a",
    accent: "#aaff3b", particle: "#caffaa", mood: "Glowing woodland",
    scene: "frozen",
  },
  {
    id: "desert", name: "Desert Ruins", emoji: "🏜️",
    sky: ["#4e2a0a", "#9e6a2a"], ground: "#c9a05a", groundEdge: "#ffce8a",
    accent: "#ff9b3b", particle: "#ffe8c0", mood: "Sandstorm dunes",
    scene: "dojo",
  },
  {
    id: "cyber", name: "Cyber Grid", emoji: "🟦",
    sky: ["#05051a", "#0a1a4e"], ground: "#0a0a1a", groundEdge: "#3bffff",
    accent: "#3bffff", particle: "#3bffff", mood: "Digital battleground",
    scene: "neon",
  },
  {
    id: "underwater", name: "Deep Abyss", emoji: "🐠",
    sky: ["#031a3a", "#063a6a"], ground: "#04263a", groundEdge: "#3bd0ff",
    accent: "#3bffea", particle: "#8adfff", mood: "Bioluminescent depths",
    scene: "space",
  },
  {
    id: "castle", name: "Dark Castle", emoji: "🏰",
    sky: ["#1a0a2a", "#3a1a3a"], ground: "#1a141a", groundEdge: "#a05bff",
    accent: "#ff5b8a", particle: "#c08aff", mood: "Haunted fortress",
    scene: "dojo",
  },
  {
    id: "graveyard", name: "Cursed Graveyard", emoji: "⚰️",
    sky: ["#0a1a1a", "#1a3a2a"], ground: "#14201a", groundEdge: "#56ff8a",
    accent: "#56ff8a", particle: "#aaffc0", mood: "Foggy tombstones",
    scene: "frozen",
  },
  {
    id: "sky", name: "Sky Sanctuary", emoji: "☁️",
    sky: ["#3b8aff", "#aadfff"], ground: "#dfefff", groundEdge: "#ffffff",
    accent: "#ffd23b", particle: "#ffffff", mood: "Floating cloud temple",
    scene: "frozen",
  },
  {
    id: "factory", name: "Steel Factory", emoji: "🏭",
    sky: ["#2a1a0a", "#4a2a1a"], ground: "#2a2422", groundEdge: "#ff8c3b",
    accent: "#ffce3b", particle: "#ffae6a", mood: "Industrial furnace",
    scene: "neon",
  },
  {
    id: "temple", name: "Jade Temple", emoji: "🛕",
    sky: ["#0a2a2a", "#1a5a4a"], ground: "#1a3a32", groundEdge: "#3bffd0",
    accent: "#ffce3b", particle: "#aaffe0", mood: "Mystic jade halls",
    scene: "dojo",
  },
  {
    id: "storm", name: "Thunder Storm", emoji: "⛈️",
    sky: ["#1a1a2e", "#2a2a4a"], ground: "#1a1a2a", groundEdge: "#ffe23b",
    accent: "#ffe600", particle: "#cad0ff", mood: "Lightning tempest",
    scene: "neon",
  },
  {
    id: "jungle", name: "Lost Jungle", emoji: "🌴",
    sky: ["#0a2e1a", "#2a6a2a"], ground: "#1a3a1a", groundEdge: "#9bff3b",
    accent: "#ffce3b", particle: "#caffaa", mood: "Ancient overgrowth",
    scene: "frozen",
  },
  {
    id: "crystal", name: "Crystal Caverns", emoji: "💎",
    sky: ["#1a0a3a", "#3a1a6a"], ground: "#1a1440", groundEdge: "#3bffff",
    accent: "#ff8aff", particle: "#aaeaff", mood: "Glittering caves",
    scene: "space",
  },
  {
    id: "hell", name: "Infernal Pit", emoji: "🔥",
    sky: ["#2a0000", "#6a0a0a"], ground: "#1a0000", groundEdge: "#ff3b00",
    accent: "#ffae00", particle: "#ff5b3b", mood: "Demon's domain",
    scene: "volcano",
  },
  {
    id: "heaven", name: "Celestial Gate", emoji: "🌅",
    sky: ["#ffd29b", "#ffeec0"], ground: "#fff4d0", groundEdge: "#ffae3b",
    accent: "#ff9b3b", particle: "#ffffff", mood: "Golden paradise",
    scene: "frozen",
  },
  {
    id: "ruins", name: "Lost Civilization", emoji: "🗿",
    sky: ["#2a2a1a", "#5a5a3a"], ground: "#3a3424", groundEdge: "#ffce8a",
    accent: "#ffce3b", particle: "#e8e0c0", mood: "Forgotten monuments",
    scene: "dojo",
  },
  {
    id: "tundra", name: "Frozen Tundra", emoji: "🧊",
    sky: ["#0a3a5a", "#3a8aba"], ground: "#cfeeff", groundEdge: "#ffffff",
    accent: "#3bd0ff", particle: "#ffffff", mood: "Endless ice plains",
    scene: "frozen",
  },
  {
    id: "carnival", name: "Neon Carnival", emoji: "🎡",
    sky: ["#2a0a3e", "#5a1a6a"], ground: "#2a1a3a", groundEdge: "#ff3bd0",
    accent: "#ffe23b", particle: "#ff8aff", mood: "Festival of lights",
    scene: "neon",
  },
  {
    id: "void", name: "The Void", emoji: "🕳️",
    sky: ["#050510", "#15052a"], ground: "#0a0518", groundEdge: "#a05bff",
    accent: "#ff3bd0", particle: "#8a5bff", mood: "Edge of reality",
    scene: "space",
  },
];

export function getMap(id: string): ArenaMap {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
