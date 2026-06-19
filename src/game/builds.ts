// Per-fighter body silhouette traits — makes each of the 24 fighters look
// physically distinct (size, bulk, head shape, hair style, extras like tail,
// horns, halo, cape, wings, transparency, glow).

export type HairStyle =
  | "spiky"     // DBZ spikes (default)
  | "long"      // flowing long hair
  | "mohawk"    // tall mohawk
  | "bald"      // no hair
  | "hood"      // hooded
  | "horns"     // demon horns
  | "topknot"   // samurai bun
  | "crown"     // royal/crystal crown
  | "helmet"    // armored helm
  | "antenna"   // bug/alien antennae
  | "flame";    // hair made of flame tips

export type Extra =
  | "tail"      // dino/dragon tail
  | "cape"      // flowing cape
  | "wings"     // angel/demon wings
  | "halo"      // glowing ring above head
  | "aura"      // permanent body glow
  | "scarf"     // trailing scarf
  | "shoulderSpikes"
  | "none";

export interface BuildTraits {
  scale: number;     // overall size multiplier
  bulk: number;      // torso/limb width multiplier
  headScale: number; // head size multiplier
  alpha: number;     // body opacity (Phantom < 1)
  hair: HairStyle;
  extra: Extra;
  glow?: string;     // optional silhouette glow color (uses fighter color if undefined)
}

const DEFAULT: BuildTraits = {
  scale: 1,
  bulk: 1,
  headScale: 1,
  alpha: 1,
  hair: "spiky",
  extra: "none",
};

const BUILDS: Record<string, Partial<BuildTraits>> = {
  blaze:    { hair: "flame", extra: "aura" },
  frost:    { hair: "spiky", extra: "scarf", bulk: 0.96 },
  volt:     { scale: 0.94, bulk: 0.86, hair: "mohawk", extra: "aura" },
  venom:    { scale: 0.98, bulk: 0.9, hair: "hood", extra: "scarf" },
  titan:    { scale: 1.12, bulk: 1.4, headScale: 0.92, hair: "helmet", extra: "shoulderSpikes" },
  nova:     { hair: "long", extra: "aura" },
  ronin:    { hair: "topknot", extra: "scarf", bulk: 0.95 },
  magma:    { scale: 1.06, bulk: 1.25, hair: "flame", extra: "shoulderSpikes" },
  tempest:  { scale: 0.96, bulk: 0.9, hair: "long", extra: "scarf" },
  obsidian: { scale: 1.1, bulk: 1.35, headScale: 0.95, hair: "bald", extra: "shoulderSpikes" },
  seraph:   { hair: "long", extra: "wings", glow: "#fff6c0" },
  reaper:   { scale: 1.02, bulk: 0.96, hair: "hood", extra: "cape" },
  aqua:     { hair: "long", extra: "scarf", bulk: 0.95 },
  phantom:  { scale: 0.98, bulk: 0.9, alpha: 0.55, hair: "hood", extra: "aura", glow: "#b0b0ff" },
  inferna:  { scale: 0.96, bulk: 0.86, hair: "long", extra: "scarf" },
  goliath:  { scale: 1.22, bulk: 1.6, headScale: 0.85, hair: "bald", extra: "shoulderSpikes" },
  spark:    { scale: 0.9, bulk: 0.82, hair: "mohawk", extra: "aura" },
  kaiju:    { scale: 1.14, bulk: 1.35, headScale: 1.05, hair: "horns", extra: "tail" },
  mystic:   { hair: "hood", extra: "cape", glow: "#c08aff" },
  blade:    { bulk: 0.96, hair: "spiky", extra: "cape" },
  lumen:    { hair: "crown", extra: "aura", glow: "#8affd0" },
  drakon:   { scale: 1.08, bulk: 1.18, hair: "horns", extra: "tail" },
  celesta:  { scale: 0.96, hair: "crown", extra: "halo", glow: "#ffd23b" },
  ragnar:   { scale: 1.08, bulk: 1.3, headScale: 0.95, hair: "topknot", extra: "shoulderSpikes" },
};

export function getBuild(id: string): BuildTraits {
  return { ...DEFAULT, ...(BUILDS[id] || {}) };
}
