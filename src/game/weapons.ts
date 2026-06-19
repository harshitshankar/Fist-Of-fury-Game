// Per-fighter unique WEAPONS.
// Each fighter carries one signature weapon they can:
//   • equip (hold) and melee-attack with for bonus damage & reach, or
//   • THROW as a projectile (then it's gone until the next round / pickup).
//
// Weapon shapes are drawn on the canvas (see engine.drawWeapon). The "type"
// controls the silhouette; emoji is used in the UI button.

export type WeaponType =
  | "katana"    // long curved blade
  | "sword"     // straight broadsword
  | "axe"       // heavy axe
  | "spear"     // long pole + tip
  | "hammer"    // big mallet
  | "dagger"    // short blade
  | "scythe"    // curved reaper blade
  | "staff"     // magic rod with orb
  | "shuriken"  // spinning star
  | "club"      // brute club
  | "trident"   // 3-prong
  | "chakram"   // spinning ring
  | "bo";       // long staff

export interface Weapon {
  name: string;
  emoji: string;
  type: WeaponType;
  color: string;      // blade/metal color
  trail: string;      // throw trail / glow color
  meleeDmg: number;   // bonus melee damage when equipped
  throwDmg: number;   // projectile damage
  reach: number;      // extra melee reach in px
  length: number;     // drawn length
}

// Default fallback weapon.
const DEFAULT: Weapon = {
  name: "Fist Blade", emoji: "🗡️", type: "dagger",
  color: "#cfd6e0", trail: "#ffffff", meleeDmg: 6, throwDmg: 18, reach: 30, length: 46,
};

const WEAPONS: Record<string, Weapon> = {
  blaze:    { name: "Flame Saber", emoji: "🔥🗡️", type: "sword",   color: "#ff7b3b", trail: "#ff3b00", meleeDmg: 8, throwDmg: 22, reach: 40, length: 56 },
  frost:    { name: "Ice Shard",   emoji: "❄️🗡️", type: "spear",   color: "#bfeaff", trail: "#36c6ff", meleeDmg: 7, throwDmg: 20, reach: 58, length: 78 },
  volt:     { name: "Volt Chakram",emoji: "⚡🛞",  type: "chakram", color: "#ffe600", trail: "#ff9d00", meleeDmg: 6, throwDmg: 19, reach: 34, length: 40 },
  venom:    { name: "Toxic Dagger",emoji: "🐍🔪",  type: "dagger",  color: "#56ff5b", trail: "#8a00ff", meleeDmg: 6, throwDmg: 18, reach: 28, length: 42 },
  titan:    { name: "War Hammer",  emoji: "🛡️🔨",  type: "hammer",  color: "#9aa3b2", trail: "#ffce3b", meleeDmg: 12, throwDmg: 28, reach: 44, length: 64 },
  nova:     { name: "Star Staff",  emoji: "🌟🪄",  type: "staff",   color: "#ff8aff", trail: "#ff3bd0", meleeDmg: 7, throwDmg: 21, reach: 52, length: 74 },
  ronin:    { name: "Katana",      emoji: "⚔️",    type: "katana",  color: "#eef2ff", trail: "#caffe9", meleeDmg: 9, throwDmg: 23, reach: 50, length: 70 },
  magma:    { name: "Magma Axe",   emoji: "🌋🪓",  type: "axe",     color: "#ff5b3b", trail: "#ff5b00", meleeDmg: 11, throwDmg: 27, reach: 42, length: 60 },
  tempest:  { name: "Wind Glaive", emoji: "🌪️🗡️", type: "spear",   color: "#cffaff", trail: "#7fffd4", meleeDmg: 8, throwDmg: 21, reach: 56, length: 76 },
  obsidian: { name: "Void Club",   emoji: "🖤🏏",  type: "club",    color: "#5a5a6a", trail: "#a05bff", meleeDmg: 12, throwDmg: 26, reach: 40, length: 58 },
  seraph:   { name: "Holy Spear",  emoji: "👼🔱",  type: "trident", color: "#fff6c0", trail: "#ffd23b", meleeDmg: 9, throwDmg: 24, reach: 58, length: 80 },
  reaper:   { name: "Soul Scythe", emoji: "💀🌾",  type: "scythe",  color: "#cfe0d0", trail: "#56ff8a", meleeDmg: 10, throwDmg: 25, reach: 54, length: 72 },
  aqua:     { name: "Tide Trident",emoji: "🌊🔱",  type: "trident", color: "#bfe6ff", trail: "#3b9bff", meleeDmg: 8, throwDmg: 22, reach: 56, length: 78 },
  phantom:  { name: "Ghost Dagger",emoji: "👻🔪",  type: "dagger",  color: "#d6d6ff", trail: "#b0b0ff", meleeDmg: 6, throwDmg: 18, reach: 30, length: 44 },
  inferna:  { name: "Phoenix Fan", emoji: "💃🪭",  type: "chakram", color: "#ff7b8a", trail: "#ff3b6a", meleeDmg: 7, throwDmg: 20, reach: 36, length: 42 },
  goliath:  { name: "Boulder Club",emoji: "🦏🪨",  type: "club",    color: "#8a7a6a", trail: "#ffce3b", meleeDmg: 14, throwDmg: 30, reach: 46, length: 66 },
  spark:    { name: "Neon Shuriken",emoji:"🛹✴️",  type: "shuriken",color: "#3bffea", trail: "#ff3bd0", meleeDmg: 5, throwDmg: 17, reach: 30, length: 38 },
  kaiju:    { name: "Bone Club",   emoji: "🦖🦴",  type: "club",    color: "#d8d0b0", trail: "#9bff3b", meleeDmg: 13, throwDmg: 29, reach: 44, length: 62 },
  mystic:   { name: "Arcane Staff",emoji: "🔮🪄",  type: "staff",   color: "#c08aff", trail: "#c08aff", meleeDmg: 7, throwDmg: 21, reach: 54, length: 76 },
  blade:    { name: "Broadsword",  emoji: "🗡️",    type: "sword",   color: "#dfe6f0", trail: "#ff3b5b", meleeDmg: 10, throwDmg: 24, reach: 46, length: 64 },
  lumen:    { name: "Prism Blade", emoji: "🌈🗡️",  type: "katana",  color: "#caffe9", trail: "#8affd0", meleeDmg: 8, throwDmg: 22, reach: 50, length: 70 },
  drakon:   { name: "Dragon Spear",emoji: "🐲🔱",  type: "trident", color: "#bfffe0", trail: "#3bffae", meleeDmg: 9, throwDmg: 25, reach: 58, length: 80 },
  celesta:  { name: "Star Chakram",emoji: "✨🛞",  type: "chakram", color: "#ffeaa0", trail: "#ffd23b", meleeDmg: 7, throwDmg: 21, reach: 36, length: 42 },
  ragnar:   { name: "Battle Axe",  emoji: "🪓",    type: "axe",     color: "#d8c0a0", trail: "#ff7b3b", meleeDmg: 12, throwDmg: 28, reach: 44, length: 62 },
};

export function getWeapon(fighterId: string): Weapon {
  return WEAPONS[fighterId] || DEFAULT;
}

// Weapons that spin in flight when thrown (vs. flying straight like spears).
export function spinsInFlight(type: WeaponType): boolean {
  return ["chakram", "shuriken", "axe", "hammer", "club"].includes(type);
}
