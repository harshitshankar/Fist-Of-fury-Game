// FightEngine — a self-contained 2D fighting game engine rendered to a canvas.
// Handles two fighters, physics, hit detection, animations, particles,
// and the "Victory Mate" slow-motion finish.
//
// The engine is authoritative for the LOCAL player only. For online play,
// each client simulates its own fighter and sends lightweight input/state
// snapshots over the network; the opponent fighter is driven by the remote
// snapshots (interpolated) via setRemoteState().

import { Fighter, getFighter } from "./characters";
import { ArenaMap, getMap } from "./maps";
import { Sfx } from "./audio";
import { getBuild } from "./builds";
import { getWeapon, spinsInFlight } from "./weapons";

export type FacingDir = 1 | -1;

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  block: boolean;
  special: boolean;
  weapon: boolean;      // weapon melee attack (only when equipped)
  throwWeapon: boolean; // throw the weapon as a projectile
  holster: boolean;     // toggle equip / put away the weapon
}

export const EMPTY_INPUT: InputState = {
  left: false,
  right: false,
  jump: false,
  punch: false,
  kick: false,
  block: false,
  special: false,
  weapon: false,
  throwWeapon: false,
  holster: false,
};

type Anim =
  | "idle"
  | "walk"
  | "jump"
  | "punch"
  | "kick"
  | "block"
  | "special"
  | "weaponAtk"
  | "throw"
  | "hurt"
  | "ko"
  | "win";

export interface FighterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: FacingDir;
  hp: number;
  maxHp: number;
  meter: number;       // special meter 0-100
  anim: Anim;
  animTime: number;
  attackCd: number;
  hurtTime: number;
  blocking: boolean;
  onGround: boolean;
  color: string;
  customColor?: string;
  fighterId: string;
  name: string;
  specialUsed: boolean;   // true once the special beam is fired this round
  weaponEquipped: boolean; // weapon is drawn/held in hand
  weaponThrown: boolean;   // weapon has been thrown (gone until pickup/next round)
  actionCd: number;        // debounce for holster/throw toggles
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  size: number;
}

interface Beam {
  x: number;          // leading edge position
  y: number;          // chest height (center of beam)
  vx: number;         // travel speed * direction
  dir: FacingDir;
  life: number;
  maxLife: number;
  color: string;      // main beam color (unique per fighter)
  color2: string;     // bright inner core color
  glow: string;       // outer blurred aura color
  width: number;      // beam vertical thickness
  owner: "p1" | "p2";
  dmg: number;
  hit: boolean;       // already struck the foe?
  fighterId: string;
  charge: number;     // 0..1 charge-up before firing (DBZ style)
}

interface ThrownWeapon {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: FacingDir;
  rot: number;        // current rotation (radians)
  spin: number;       // rotation speed
  spins: boolean;     // spins in flight vs flies straight
  owner: "p1" | "p2";
  fighterId: string;
  dmg: number;
  hit: boolean;
  life: number;
}

// A BEAM CLASH: two opposing special beams collide and a glowing orb forms at
// the meeting point. Each player mashes their SPECIAL/PUNCH button to push the
// clash toward the opponent. The loser (whose side the orb reaches) takes a big
// hit + knockback.
interface BeamClash {
  x: number;          // current clash-orb x (the contested point)
  y: number;          // clash height
  p1Beam: Beam;       // p1's beam
  p2Beam: Beam;       // p2's beam
  p1Power: number;    // accumulated mash power for p1
  p2Power: number;    // accumulated mash power for p2
  time: number;       // elapsed frames
  resolved: boolean;
}

const WORLD = { w: 1280, h: 600 };
const GROUND_Y = 480;
const GRAVITY = 0.9;
const FIGHTER_W = 70;
const FIGHTER_H = 150;
const MOVE_SPEED = 4.6;
const JUMP_V = -17;

export interface EngineCallbacks {
  onHit?: (attacker: "p1" | "p2", dmg: number) => void;
  onKO?: (winner: "p1" | "p2") => void;
  onMeterFull?: () => void;
  onRoundEnd?: (winner: "p1" | "p2", p1Rounds: number, p2Rounds: number) => void;
  onRoundStart?: (round: number) => void;
  onReportKO?: (who: "self" | "opponent") => void; // online: report KO to server
}

export class FightEngine {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  map: ArenaMap;
  p1Fighter: Fighter;
  p2Fighter: Fighter;
  p1: FighterState;
  p2: FighterState;
  particles: Particle[] = [];
  beams: Beam[] = [];
  thrownWeapons: ThrownWeapon[] = [];
  beamClash: BeamClash | null = null; // active beam clash (button-smash mini-game)
  prevInput: InputState = { ...EMPTY_INPUT }; // last frame's input (edge detection)
  texts: FloatingText[] = [];
  input: InputState = { ...EMPTY_INPUT };
  remoteInput: InputState = { ...EMPTY_INPUT };
  // CPU AI decision state
  aiTimer = 0;
  aiAction: "approach" | "punch" | "kick" | "special" | "jump" | "block" | "retreat" = "approach";
  timeScale = 1;
  targetTimeScale = 1;
  shakeMag = 0;
  bgTime = 0;
  matchOver = false;
  winner: "p1" | "p2" | null = null;
  victoryTimer = 0;
  cb: EngineCallbacks;
  isOnline: boolean;
  // remote snapshot for online opponent
  remoteSnapshot: Partial<FighterState> | null = null;
  paused = true;
  raf = 0;
  last = 0;
  hitFlash = 0;
  roundTime = 99;
  roundTimer = 99;
  // ---- best-of-N rounds ----
  roundsToWin = 1;       // first to this many round wins takes the match
  totalRounds = 1;       // informational (e.g. 3 or 5)
  p1Rounds = 0;          // rounds won by p1
  p2Rounds = 0;          // rounds won by p2
  currentRound = 1;
  roundOver = false;     // a single round just ended (but match may continue)
  roundWinner: "p1" | "p2" | null = null;
  roundGrace = 0;        // frames after a round reset where remote HP is ignored
  reportedKO = false;    // online: have we reported this round's KO to the server yet

  constructor(
    canvas: HTMLCanvasElement,
    opts: {
      mapId: string;
      p1Id: string;
      p2Id: string;
      p1Color?: string;
      p2Color?: string;
      p1Name: string;
      p2Name: string;
      online?: boolean;
      rounds?: number;      // total rounds: 1, 3 or 5 (best-of)
      callbacks?: EngineCallbacks;
    }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.map = getMap(opts.mapId);
    this.p1Fighter = getFighter(opts.p1Id);
    this.p2Fighter = getFighter(opts.p2Id);
    this.isOnline = !!opts.online;
    this.cb = opts.callbacks || {};
    this.totalRounds = opts.rounds && opts.rounds > 0 ? opts.rounds : 1;
    // best-of-N => need majority. (1->1, 3->2, 5->3)
    this.roundsToWin = Math.floor(this.totalRounds / 2) + 1;

    this.p1 = this.makeState(this.p1Fighter, 320, 1, opts.p1Color, opts.p1Name);
    this.p2 = this.makeState(this.p2Fighter, 960, -1, opts.p2Color, opts.p2Name);
  }

  makeState(
    f: Fighter,
    x: number,
    facing: FacingDir,
    custom: string | undefined,
    name: string
  ): FighterState {
    return {
      x,
      y: GROUND_Y - FIGHTER_H,
      vx: 0,
      vy: 0,
      facing,
      hp: f.health,
      maxHp: f.health,
      meter: 0,
      anim: "idle",
      animTime: 0,
      attackCd: 0,
      hurtTime: 0,
      blocking: false,
      onGround: true,
      color: custom || f.color,
      customColor: custom,
      fighterId: f.id,
      name,
      specialUsed: false,
      weaponEquipped: true, // start each round with the weapon ready in hand
      weaponThrown: false,
      actionCd: 0,
    };
  }

  start() {
    this.paused = false;
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min((t - this.last) / 16.67, 2);
      this.last = t;
      if (!this.paused) this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  setInput(i: InputState) {
    this.input = i;
  }

  // For online: opponent drives p2 directly with their authoritative state.
  setRemoteState(s: Partial<FighterState>) {
    this.remoteSnapshot = s;
  }

  // Returns a compact snapshot of local p1 to send to peer.
  getLocalSnapshot() {
    return {
      x: this.p1.x,
      y: this.p1.y,
      facing: this.p1.facing,
      hp: this.p1.hp,
      meter: this.p1.meter,
      anim: this.p1.anim,
      animTime: this.p1.animTime,
      blocking: this.p1.blocking,
      weaponEquipped: this.p1.weaponEquipped,
      weaponThrown: this.p1.weaponThrown,
    };
  }

  update(dt: number) {
    // smooth time scale toward target (slow-mo)
    this.timeScale += (this.targetTimeScale - this.timeScale) * 0.08;
    const ts = this.timeScale;
    const step = dt * ts;

    this.bgTime += dt * 0.5;
    if (this.shakeMag > 0) this.shakeMag *= 0.86;
    if (this.hitFlash > 0) this.hitFlash -= 0.06 * dt;
    if (this.roundGrace > 0) this.roundGrace -= dt;

    if (this.matchOver || this.roundOver) {
      this.victoryTimer += dt;
      this.updateFighterPhysics(this.p1, step, true);
      this.updateFighterPhysics(this.p2, step, true);
      this.updateBeams(step);
      this.updateThrownWeapons(step);
      this.updateParticles(step);
      this.updateTexts(dt);
      return;
    }

    // round timer
    if (!this.paused) {
      this.roundTimer -= (dt / 60) * ts;
      if (this.roundTimer <= 0) {
        this.roundTimer = 0;
        // time over — higher HP wins the round
        const w = this.p1.hp >= this.p2.hp ? "p1" : "p2";
        this.endRound(w);
      }
    }

    // During a BEAM CLASH, button presses push the clash orb instead of
    // performing normal actions (rapid PUNCH/SPECIAL/KICK taps = mash power).
    if (this.beamClash && !this.beamClash.resolved) {
      const i = this.input;
      const p = this.prevInput;
      const pressed =
        (i.punch && !p.punch) ||
        (i.special && !p.special) ||
        (i.kick && !p.kick);
      if (pressed) this.pushClash("p1", 6);
      this.prevInput = { ...i };
      this.updateParticles(step);
      this.updateTexts(dt);
      this.updateBeams(step); // advances/ resolves the clash
      this.p1.animTime += step;
      this.p2.animTime += step;
      return; // freeze normal control while clashing
    }
    this.prevInput = { ...this.input };

    // P1 controlled by local input
    this.controlFighter(this.p1, this.p2, this.input, step, "p1");

    if (this.isOnline) {
      // P2 driven by remote snapshot (interpolated)
      if (this.remoteSnapshot) {
        const s = this.remoteSnapshot;
        if (typeof s.x === "number") this.p2.x += (s.x - this.p2.x) * 0.35 * dt;
        if (typeof s.y === "number") this.p2.y += (s.y - this.p2.y) * 0.35 * dt;
        if (typeof s.facing === "number") this.p2.facing = s.facing as FacingDir;
        // Ignore remote HP during the round-reset grace window so a stale
        // post-KO hp:0 snapshot can't instantly re-end the next round.
        if (typeof s.hp === "number" && this.roundGrace <= 0) this.p2.hp = s.hp;
        if (typeof s.meter === "number") this.p2.meter = s.meter;
        if (s.anim) {
          // detect the opponent starting a special -> spawn a visual beam (no local damage)
          if (s.anim === "special" && this.p2.anim !== "special") {
            this.spawnRemoteBeam();
          }
          // detect the opponent throwing their weapon -> spawn visual projectile
          if (s.anim === "throw" && this.p2.anim !== "throw") {
            this.spawnRemoteWeapon();
          }
          this.p2.anim = s.anim;
        }
        if (typeof s.blocking === "boolean") this.p2.blocking = s.blocking;
        if (typeof (s as any).weaponEquipped === "boolean") this.p2.weaponEquipped = (s as any).weaponEquipped;
        if (typeof (s as any).weaponThrown === "boolean") this.p2.weaponThrown = (s as any).weaponThrown;
      }
      this.updateFighterPhysics(this.p2, step, false);
      this.p2.animTime += step;
    } else {
      // P2 is a CPU bot
      this.aiControl(this.p2, this.p1, step);
      this.controlFighter(this.p2, this.p1, this.remoteInput, step, "p2");
    }

    // face each other
    if (this.p1.onGround && this.p1.anim !== "punch" && this.p1.anim !== "kick")
      this.p1.facing = this.p1.x < this.p2.x ? 1 : -1;
    if (this.p2.onGround && this.p2.anim !== "punch" && this.p2.anim !== "kick")
      this.p2.facing = this.p2.x < this.p1.x ? 1 : -1;

    // meter regen
    this.p1.meter = Math.min(100, this.p1.meter + 0.08 * step);
    if (!this.isOnline) this.p2.meter = Math.min(100, this.p2.meter + 0.05 * step);

    this.updateBeams(step);
    this.updateThrownWeapons(step);
    this.updateParticles(step);
    this.updateTexts(dt);

    // KO check (ends the current round)
    if (this.isOnline) {
      // ONLINE: the server is authoritative for round results. Report the KO
      // once and freeze; the actual round end is applied via applyRoundResult().
      if (
        !this.matchOver && !this.roundOver && !this.reportedKO &&
        (this.p1.hp <= 0 || this.p2.hp <= 0)
      ) {
        const localLost = this.p1.hp <= 0;
        this.reportedKO = true;
        this.roundOver = true; // freeze the action while we wait for the server
        this.targetTimeScale = 0.18;
        this.shakeMag = 16;
        this.hitFlash = 1;
        const ko = this.p1.hp <= 0 ? this.p1 : this.p2;
        const wn = this.p1.hp <= 0 ? this.p2 : this.p1;
        ko.anim = "ko"; ko.animTime = 0; ko.vy = -10; ko.vx = -ko.facing * 6;
        wn.anim = "win"; wn.animTime = 0;
        Sfx.ko();
        this.cb.onReportKO?.(localLost ? "self" : "opponent");
      }
    } else {
      if (this.p1.hp <= 0 && !this.matchOver && !this.roundOver) this.endRound("p2");
      else if (this.p2.hp <= 0 && !this.matchOver && !this.roundOver) this.endRound("p1");
    }
  }

  // Called when the SERVER confirms a round result (online only). Keeps both
  // clients perfectly in sync regardless of who detected the KO first.
  applyRoundResult(localWon: boolean, p1Rounds: number, p2Rounds: number, matchOver: boolean) {
    this.p1Rounds = p1Rounds;
    this.p2Rounds = p2Rounds;
    this.roundOver = true;
    this.roundWinner = localWon ? "p1" : "p2";
    this.victoryTimer = 0;
    this.targetTimeScale = 0.18;
    if (matchOver) {
      this.matchOver = true;
      this.winner = localWon ? "p1" : "p2";
      if (localWon) setTimeout(() => Sfx.victory(), 700); // jingle only when YOU win
      this.cb.onKO?.(this.winner);
      setTimeout(() => { this.targetTimeScale = 1; }, 2600);
    } else {
      this.cb.onRoundEnd?.(localWon ? "p1" : "p2", p1Rounds, p2Rounds);
      setTimeout(() => { this.targetTimeScale = 1; }, 1600);
      setTimeout(() => this.startNextRound(), 2400);
    }
  }

  // A single round ended. Award it; if someone reached roundsToWin, finish the
  // match (triggerVictory). Otherwise reset fighters and start the next round.
  endRound(winner: "p1" | "p2") {
    this.roundOver = true;
    this.roundWinner = winner;
    this.victoryTimer = 0;
    this.targetTimeScale = 0.18; // slow-mo on the knockout
    this.shakeMag = 16;
    this.hitFlash = 1;

    if (winner === "p1") this.p1Rounds++;
    else this.p2Rounds++;

    const loser = winner === "p1" ? this.p2 : this.p1;
    const win = winner === "p1" ? this.p1 : this.p2;
    loser.anim = "ko";
    loser.animTime = 0;
    loser.vy = -10;
    loser.vx = -loser.facing * 6;
    win.anim = "win";
    win.animTime = 0;
    this.burst(loser.x, loser.y + 60, 36, "#ffce3b");
    Sfx.ko();

    const matchDecided =
      this.p1Rounds >= this.roundsToWin || this.p2Rounds >= this.roundsToWin;

    if (matchDecided) {
      // final match victory — keep slow-mo + fire the win callback
      this.matchOver = true;
      this.winner = winner;
      if (winner === "p1") setTimeout(() => Sfx.victory(), 700); // jingle only when YOU win
      this.cb.onKO?.(winner);
      setTimeout(() => {
        this.targetTimeScale = 1;
      }, 2600);
    } else {
      // more rounds to go — show "ROUND WON" then reset
      this.cb.onRoundEnd?.(winner, this.p1Rounds, this.p2Rounds);
      setTimeout(() => {
        this.targetTimeScale = 1;
      }, 1600);
      setTimeout(() => this.startNextRound(), 2400);
    }
  }

  startNextRound() {
    if (this.matchOver) return;
    this.currentRound++;
    // reset fighter positions, hp, meter, anim
    const reset = (st: FighterState, baseX: number, facing: FacingDir, hp: number) => {
      st.x = baseX;
      st.y = GROUND_Y - FIGHTER_H;
      st.vx = 0;
      st.vy = 0;
      st.facing = facing;
      st.hp = hp;
      st.meter = 0;
      st.anim = "idle";
      st.animTime = 0;
      st.attackCd = 0;
      st.hurtTime = 0;
      st.blocking = false;
      st.onGround = true;
      st.specialUsed = false; // refill the once-per-round special for the new round
      st.weaponEquipped = true; // weapon returns to hand each round
      st.weaponThrown = false;
      st.actionCd = 0;
    };
    reset(this.p1, 320, 1, this.p1Fighter.health);
    reset(this.p2, 960, -1, this.p2Fighter.health);
    this.beams = [];
    this.thrownWeapons = [];
    this.roundTimer = this.roundTime;
    this.roundOver = false;
    this.roundWinner = null;
    this.victoryTimer = 0;
    this.targetTimeScale = 1;
    this.roundGrace = 90; // ~1.5s where stale remote HP is ignored
    this.reportedKO = false; // ready to report the next round's KO
    this.cb.onRoundStart?.(this.currentRound);
  }

  triggerVictory(winner: "p1" | "p2") {
    this.matchOver = true;
    this.winner = winner;
    this.victoryTimer = 0;
    this.targetTimeScale = 0.18; // SLOW MOTION — Victory Mate!
    this.shakeMag = 18;
    this.hitFlash = 1;
    const loser = winner === "p1" ? this.p2 : this.p1;
    const win = winner === "p1" ? this.p1 : this.p2;
    loser.anim = "ko";
    loser.animTime = 0;
    loser.vy = -10;
    loser.vx = -loser.facing * 6;
    win.anim = "win";
    win.animTime = 0;
    this.burst(loser.x, loser.y + 60, 40, "#ffce3b");
    Sfx.ko();
    if (winner === "p1") setTimeout(() => Sfx.victory(), 700); // jingle only when YOU win
    this.cb.onKO?.(winner);
    // restore normal time after the dramatic slow-mo
    setTimeout(() => {
      this.targetTimeScale = 1;
    }, 2600);
  }

  controlFighter(
    self: FighterState,
    foe: FighterState,
    inp: InputState,
    step: number,
    who: "p1" | "p2"
  ) {
    if (self.attackCd > 0) self.attackCd -= step;
    if (self.actionCd > 0) self.actionCd -= step;
    if (self.hurtTime > 0) {
      self.hurtTime -= step;
      this.updateFighterPhysics(self, step, false);
      self.animTime += step;
      return;
    }

    const f = who === "p1" ? this.p1Fighter : this.p2Fighter;
    self.blocking = inp.block && self.onGround;

    const attacking =
      self.anim === "punch" || self.anim === "kick" || self.anim === "special" ||
      self.anim === "weaponAtk" || self.anim === "throw";

    // ---- HOLSTER toggle (equip / put away the weapon) ----
    if (inp.holster && self.actionCd <= 0 && !attacking && !self.weaponThrown) {
      self.weaponEquipped = !self.weaponEquipped;
      self.actionCd = 18;
    }

    if (!attacking && !self.blocking) {
      let moving = false;
      if (inp.left) {
        self.vx = -MOVE_SPEED * f.speed;
        moving = true;
      } else if (inp.right) {
        self.vx = MOVE_SPEED * f.speed;
        moving = true;
      } else {
        self.vx *= 0.7;
      }
      if (inp.jump && self.onGround) {
        self.vy = JUMP_V * f.jump;
        self.onGround = false;
        self.anim = "jump";
        self.animTime = 0;
        if (self === this.p1) Sfx.jump();
      }
      if (self.onGround) {
        self.anim = moving ? "walk" : "idle";
      }
    } else if (self.blocking) {
      self.vx *= 0.6;
      self.anim = "block";
    } else {
      self.vx *= 0.85;
    }

    // attacks
    if (!attacking && self.attackCd <= 0 && self.onGround) {
      const wpn = getWeapon(f.id);
      const hasWeapon = self.weaponEquipped && !self.weaponThrown;
      if (inp.throwWeapon && hasWeapon) {
        // THROW the weapon — it's gone until the round ends (or pickup)
        self.anim = "throw";
        self.animTime = 0;
        self.attackCd = 28;
        this.throwWeaponProj(self, who, f);
        self.weaponThrown = true;
        self.weaponEquipped = false;
      } else if (inp.weapon && hasWeapon) {
        // melee swing WITH the weapon (more damage + reach than a punch)
        self.anim = "weaponAtk";
        self.animTime = 0;
        self.attackCd = 28;
        Sfx.kick();
        this.scheduleHit(self, foe, who, f, wpn.meleeDmg + 8, wpn.reach);
      } else if (inp.special && self.meter >= 50) {
        // Special can be fired as many times as the meter allows (refills over time).
        self.anim = "special";
        self.animTime = 0;
        self.attackCd = 45;
        self.meter -= 50;
        Sfx.special();
        this.doSpecial(self, foe, who, f);
      } else if (inp.punch) {
        self.anim = "punch";
        self.animTime = 0;
        self.attackCd = 22;
        Sfx.punch();
        this.scheduleHit(self, foe, who, f, 8, 9);
      } else if (inp.kick) {
        self.anim = "kick";
        self.animTime = 0;
        self.attackCd = 30;
        Sfx.kick();
        this.scheduleHit(self, foe, who, f, 12, 11);
      }
    }

    this.updateFighterPhysics(self, step, false);
    self.animTime += step;

    // end attack anim
    if (
      (self.anim === "punch" && self.animTime > 18) ||
      (self.anim === "kick" && self.animTime > 24) ||
      (self.anim === "special" && self.animTime > 50) ||
      (self.anim === "weaponAtk" && self.animTime > 26) ||
      (self.anim === "throw" && self.animTime > 22)
    ) {
      self.anim = self.onGround ? "idle" : "jump";
    }
  }

  scheduleHit(
    self: FighterState,
    foe: FighterState,
    who: "p1" | "p2",
    f: Fighter,
    baseDmg: number,
    extraReach = 0
  ) {
    // resolve a few frames into the swing
    const delay = 8;
    setTimeout(() => {
      if (this.matchOver || this.roundOver) return;
      const reach = FIGHTER_W + 28 + extraReach;
      // Use absolute horizontal gap so hits land even when the fighters are
      // pressed right up against each other (overlapping). Only require the
      // foe to be roughly in front (or overlapping) and at a similar height.
      const gap = Math.abs(foe.x - self.x);
      const inFront = (foe.x - self.x) * self.facing > -FIGHTER_W; // in front OR overlapping
      const close = gap < reach && inFront && Math.abs(foe.y - self.y) < 130;
      if (close) {
        this.applyDamage(foe, self, baseDmg * f.power, who);
      }
    }, delay * 16);
  }

  doSpecial(self: FighterState, _foe: FighterState, who: "p1" | "p2", f: Fighter) {
    this.shakeMag = 12;
    this.hitFlash = 0.6;

    // Chest / body height (sprite top is self.y; chest sits ~48px down).
    const chestY = self.y + 48;
    const muzzleX = self.x + self.facing * 64;

    // charge flash at the hand before the beam fires
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      this.particles.push({
        x: muzzleX,
        y: chestY,
        vx: Math.cos(a) * sp - self.facing * 2,
        vy: Math.sin(a) * sp,
        life: 18 + Math.random() * 14,
        maxLife: 32,
        color: i % 2 ? f.specialColor : "#ffffff",
        size: 4 + Math.random() * 8,
      });
    }

    // spawn the travelling beam projectile (aimed straight at body height)
    this.beams.push({
      x: muzzleX,
      y: chestY,
      vx: self.facing * 16,
      dir: self.facing,
      life: 78,        // longer duration
      maxLife: 78,
      color: f.specialColor,
      color2: f.beamCore || "#ffffff",
      glow: f.beamGlow || f.specialColor,
      width: 52,       // thick colorful beam
      owner: who,
      dmg: 26 * f.power,
      hit: false,
      fighterId: f.id,
      charge: 0,
    });

    this.texts.push({
      x: self.x,
      y: self.y - 20,
      text: f.special + "!",
      life: 70,
      color: f.specialColor,
      size: 36,
    });
  }

  // Online: visual-only thrown weapon from the remote opponent. Damage to us
  // arrives separately via the "opp:hit" network event.
  spawnRemoteWeapon() {
    const f = this.p2Fighter;
    const wpn = getWeapon(f.id);
    this.thrownWeapons.push({
      x: this.p2.x + this.p2.facing * 50,
      y: this.p2.y + 56,
      vx: this.p2.facing * 16,
      vy: -2,
      dir: this.p2.facing,
      rot: 0,
      spin: spinsInFlight(wpn.type) ? this.p2.facing * 0.5 : 0,
      spins: spinsInFlight(wpn.type),
      owner: "p2",
      fighterId: f.id,
      dmg: 0, // no local damage; authoritative damage comes over the network
      hit: false,
      life: 90,
    });
  }

  // Online: visual-only beam fired by the remote opponent (p2). Damage to us
  // is delivered separately via receiveDamage() / the "opp:hit" event.
  spawnRemoteBeam() {
    const f = this.p2Fighter;
    const chestY = this.p2.y + 48;
    const muzzleX = this.p2.x + this.p2.facing * 64;
    this.shakeMag = 12;
    this.hitFlash = 0.5;
    this.beams.push({
      x: muzzleX,
      y: chestY,
      vx: this.p2.facing * 16,
      dir: this.p2.facing,
      life: 78,
      maxLife: 78,
      color: f.specialColor,
      color2: f.beamCore || "#ffffff",
      glow: f.beamGlow || f.specialColor,
      width: 52,
      owner: "p2",
      dmg: 0,        // no local damage; authoritative damage comes over the network
      hit: false,
      fighterId: f.id,
      charge: 0,
    });
    this.texts.push({
      x: this.p2.x,
      y: this.p2.y - 20,
      text: f.special + "!",
      life: 70,
      color: f.specialColor,
      size: 36,
    });
  }

  // Launch the equipped weapon as a projectile toward the foe.
  throwWeaponProj(self: FighterState, who: "p1" | "p2", f: Fighter) {
    const wpn = getWeapon(f.id);
    this.shakeMag = Math.max(this.shakeMag, 6);
    Sfx.special();
    this.thrownWeapons.push({
      x: self.x + self.facing * 50,
      y: self.y + 56,
      vx: self.facing * 16,
      vy: -2,
      dir: self.facing,
      rot: 0,
      spin: spinsInFlight(wpn.type) ? self.facing * 0.5 : 0,
      spins: spinsInFlight(wpn.type),
      owner: who,
      fighterId: f.id,
      dmg: wpn.throwDmg * f.power,
      hit: false,
      life: 90,
    });
  }

  // Two thrown weapons smash into each other mid-air: shower of metallic
  // sparks, a bright ricochet flash, and a clang.
  weaponClash(x: number, y: number, wa: ThrownWeapon, wb: ThrownWeapon) {
    const ca = getWeapon(wa.fighterId).trail;
    const cb = getWeapon(wb.fighterId).trail;
    // burst of sparks shooting outward
    for (let i = 0; i < 50; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 14;
      this.particles.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 16 + Math.random() * 22, maxLife: 38,
        color: [ca, cb, "#ffffff", "#ffd23b"][Math.floor(Math.random() * 4)],
        size: 2 + Math.random() * 6,
      });
    }
    // bright ring flash
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(ang) * 10, vy: Math.sin(ang) * 10,
        life: 14, maxLife: 14, color: "#ffffff", size: 5,
      });
    }
    this.texts.push({ x, y: y - 40, text: "CLANG!", life: 45, color: "#ffd23b", size: 30 });
    this.shakeMag = Math.max(this.shakeMag, 18);
    this.hitFlash = Math.max(this.hitFlash, 0.6);
    Sfx.block();
    setTimeout(() => Sfx.hit(), 40);
  }

  updateThrownWeapons(step: number) {
    const targetFor = (o: "p1" | "p2") => (o === "p1" ? this.p2 : this.p1);
    const ownerFor = (o: "p1" | "p2") => (o === "p1" ? this.p1 : this.p2);

    // ---- WEAPON CLASH: two opposing thrown weapons collide mid-air ----
    for (let a = 0; a < this.thrownWeapons.length; a++) {
      for (let b = a + 1; b < this.thrownWeapons.length; b++) {
        const wa = this.thrownWeapons[a];
        const wb = this.thrownWeapons[b];
        if (wa.owner === wb.owner || wa.hit || wb.hit) continue;
        if (Math.abs(wa.x - wb.x) < 44 && Math.abs(wa.y - wb.y) < 44) {
          this.weaponClash((wa.x + wb.x) / 2, (wa.y + wb.y) / 2, wa, wb);
          wa.hit = true; wb.hit = true;
          wa.life = 0; wb.life = 0;
        }
      }
    }

    for (let i = this.thrownWeapons.length - 1; i >= 0; i--) {
      const tw = this.thrownWeapons[i];
      tw.x += tw.vx * step;
      tw.y += tw.vy * step;
      tw.vy += 0.18 * step; // slight gravity arc
      tw.rot += tw.spin * step;
      tw.life -= step;

      // sparkle trail
      if (Math.random() < 0.6) {
        const w = getWeapon(tw.fighterId);
        this.particles.push({
          x: tw.x, y: tw.y,
          vx: -tw.dir * Math.random() * 2, vy: (Math.random() - 0.5) * 3,
          life: 12 + Math.random() * 10, maxLife: 22,
          color: w.trail, size: 3 + Math.random() * 4,
        });
      }

      if (!tw.hit) {
        const foe = targetFor(tw.owner);
        const self = ownerFor(tw.owner);
        const dx = (tw.x - foe.x) * tw.dir;
        const close = dx > -FIGHTER_W * 0.6 && dx < FIGHTER_W * 0.6 &&
          Math.abs(tw.y - (foe.y + 70)) < FIGHTER_H * 0.55;
        if (close) {
          tw.hit = true;
          if (!this.isOnline || tw.owner === "p1") {
            this.applyDamage(foe, self, tw.dmg, tw.owner, true);
          }
          const w = getWeapon(tw.fighterId);
          this.burst(tw.x, foe.y + 60, 22, w.trail);
          this.shakeMag = Math.max(this.shakeMag, 14);
          tw.life = 0;
        }
      }

      if (tw.life <= 0 || tw.x < -80 || tw.x > WORLD.w + 80 || tw.y > GROUND_Y + 40) {
        this.thrownWeapons.splice(i, 1);
      }
    }
  }

  updateBeams(step: number) {
    const targetFor = (owner: "p1" | "p2") => (owner === "p1" ? this.p2 : this.p1);
    const ownerFor = (owner: "p1" | "p2") => (owner === "p1" ? this.p1 : this.p2);

    // ---- BEAM CLASH DETECTION: two opposing beams meeting head-on ----
    if (!this.beamClash) {
      const p1b = this.beams.find((b) => b.owner === "p1" && !b.hit);
      const p2b = this.beams.find((b) => b.owner === "p2" && !b.hit);
      if (p1b && p2b && Math.abs(p1b.x - p2b.x) < 70 && Math.abs(p1b.y - p2b.y) < 80) {
        this.startBeamClash(p1b, p2b);
      }
    }
    if (this.beamClash) {
      this.updateBeamClash(step);
      return; // clash takes over beam movement
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.x += b.vx * step;
      b.life -= step;

      // trail particles for a strong glowing effect
      if (Math.random() < 0.9) {
        this.particles.push({
          x: b.x - b.dir * (Math.random() * 60),
          y: b.y + (Math.random() - 0.5) * b.width,
          vx: -b.dir * (Math.random() * 3),
          vy: (Math.random() - 0.5) * 5,
          life: 14 + Math.random() * 16,
          maxLife: 30,
          color: [b.color, b.color2, b.glow][Math.floor(Math.random() * 3)],
          size: 4 + Math.random() * 10,
        });
      }

      // collision with the foe's BODY (chest band)
      if (!b.hit) {
        const foe = targetFor(b.owner);
        const self = ownerFor(b.owner);
        const foeChest = foe.y + 48;
        const dx = (b.x - foe.x) * b.dir;
        const bodyHit =
          dx > -FIGHTER_W * 0.6 &&
          dx < FIGHTER_W * 0.6 &&
          Math.abs(b.y - foeChest) < FIGHTER_H * 0.55;
        if (bodyHit) {
          b.hit = true;
          // online: only the LOCAL owner resolves & reports damage
          if (this.isOnline) {
            if (b.owner === "p1") {
              this.applyDamage(foe, self, b.dmg, b.owner, true);
            }
          } else {
            this.applyDamage(foe, self, b.dmg, b.owner, true);
          }
          // big colorful explosion on the chest
          this.beamExplosion(b.x, foeChest, b.color, b.color2, b.glow);
          this.shakeMag = 26;
          this.hitFlash = 0.8;
          b.life = Math.min(b.life, 8); // fizzle quickly after impact
        }
      }

      if (b.life <= 0 || b.x < -120 || b.x > WORLD.w + 120) {
        this.beams.splice(i, 1);
      }
    }
  }

  beamExplosion(x: number, y: number, c1: string, c2: string, c3?: string) {
    const palette = ["#ffffff", c1, c2, c3 || c1];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 15;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 22 + Math.random() * 28,
        maxLife: 50,
        color: palette[Math.floor(Math.random() * palette.length)],
        size: 5 + Math.random() * 14,
      });
    }
  }

  // ---- BEAM CLASH (button-smash) ----
  startBeamClash(p1b: Beam, p2b: Beam) {
    const cx = (p1b.x + p2b.x) / 2;
    const cy = (p1b.y + p2b.y) / 2;
    this.beamClash = {
      x: cx,
      y: cy,
      p1Beam: p1b,
      p2Beam: p2b,
      p1Power: 0,
      p2Power: 0,
      time: 0,
      resolved: false,
    };
    this.shakeMag = 14;
    this.hitFlash = 0.5;
    this.texts.push({ x: cx, y: cy - 70, text: "CLASH!", life: 50, color: "#ffffff", size: 40 });
    this.beamExplosion(cx, cy, p1b.color, p2b.color, "#ffffff");
    Sfx.special();
  }

  // Called when a player taps SPECIAL/PUNCH during a clash to push the orb.
  pushClash(who: "p1" | "p2", amount = 1) {
    if (!this.beamClash || this.beamClash.resolved) return;
    if (who === "p1") this.beamClash.p1Power += amount;
    else this.beamClash.p2Power += amount;
  }

  updateBeamClash(step: number) {
    const c = this.beamClash!;
    c.time += step;

    // CPU auto-mashes during a clash (offline). Online: each client mashes for
    // its own p1 via pushClash(); the loser is decided by the local sim.
    if (!this.isOnline) {
      // CPU strength scales a bit so it's a real contest
      c.p2Power += (0.5 + Math.random() * 0.9) * step;
    }
    // gentle decay so the orb naturally drifts toward whoever stops mashing
    const diff = (c.p1Power - c.p2Power) * 0.12;
    c.x += diff * step;
    c.y = (this.p1.y + this.p2.y) / 2 + 48;

    // keep both beams anchored to the clash point
    c.p1Beam.x = c.x;
    c.p2Beam.x = c.x;
    c.p1Beam.life = Math.max(c.p1Beam.life, 4);
    c.p2Beam.life = Math.max(c.p2Beam.life, 4);

    // sparks flying from the contested orb
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      this.particles.push({
        x: c.x, y: c.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 10 + Math.random() * 14, maxLife: 24,
        color: Math.random() < 0.5 ? c.p1Beam.color : c.p2Beam.color,
        size: 3 + Math.random() * 6,
      });
    }
    this.shakeMag = Math.max(this.shakeMag, 6);

    // resolve when the orb reaches a fighter OR after a max duration
    const p1Lost = c.x <= this.p1.x + FIGHTER_W * 0.7;
    const p2Lost = c.x >= this.p2.x - FIGHTER_W * 0.7;
    const timeout = c.time > 240;

    if ((p1Lost || p2Lost || timeout) && !c.resolved) {
      c.resolved = true;
      let winner: "p1" | "p2";
      if (p2Lost) winner = "p1";
      else if (p1Lost) winner = "p2";
      else winner = c.p1Power >= c.p2Power ? "p1" : "p2";

      const loser = winner === "p1" ? this.p2 : this.p1;
      const champ = winner === "p1" ? this.p1 : this.p2;
      // huge clash explosion
      this.beamExplosion(loser.x, loser.y + 48, c.p1Beam.color, c.p2Beam.color, "#ffffff");
      this.beamExplosion(loser.x, loser.y + 48, "#ffffff", c.p1Beam.color, c.p2Beam.color);
      this.shakeMag = 30;
      this.hitFlash = 1;
      this.texts.push({
        x: champ.x, y: champ.y - 30,
        text: "CLASH WIN!", life: 60, color: "#ffd23b", size: 34,
      });
      // big damage + launch to the loser (online: only local owner applies/sends)
      if (!this.isOnline || winner === "p1") {
        this.applyDamage(loser, champ, 30, winner, true);
      }
      // remove the clashing beams
      this.beams = this.beams.filter((b) => b !== c.p1Beam && b !== c.p2Beam);
      this.beamClash = null;
    }
  }

  applyDamage(
    foe: FighterState,
    self: FighterState,
    dmg: number,
    who: "p1" | "p2",
    isSpecial = false
  ) {
    if (foe.hp <= 0 || this.matchOver) return;
    let final = dmg;
    if (foe.blocking) {
      final = dmg * 0.18; // chip damage
      Sfx.block();
      this.burst(foe.x, foe.y + 60, 8, "#aaccff");
      this.texts.push({
        x: foe.x,
        y: foe.y,
        text: "BLOCK",
        life: 40,
        color: "#8ad0ff",
        size: 22,
      });
    } else {
      Sfx.hit();
      // Beam/special hits launch the opponent FAR away; normal hits nudge.
      foe.hurtTime = isSpecial ? 40 : 12;
      foe.anim = "hurt";
      foe.animTime = 0;
      foe.vx = self.facing * (isSpecial ? 26 : 4.5);
      foe.vy = isSpecial ? -12 : -2;
      this.burst(
        foe.x,
        foe.y + 50,
        isSpecial ? 22 : 12,
        isSpecial ? self.color : "#ff5b5b"
      );
      this.texts.push({
        x: foe.x,
        y: foe.y - 10,
        text: "-" + Math.round(final),
        life: 45,
        color: isSpecial ? "#ffce3b" : "#ffffff",
        size: isSpecial ? 30 : 22,
      });
      self.meter = Math.min(100, self.meter + (isSpecial ? 4 : 8));
    }
    foe.hp = Math.max(0, foe.hp - final);
    this.shakeMag = Math.max(this.shakeMag, isSpecial ? 14 : 6);
    this.hitFlash = Math.max(this.hitFlash, isSpecial ? 0.5 : 0.25);
    this.cb.onHit?.(who, final);
  }

  // Online: apply damage event received from opponent (they hit us)
  receiveDamage(dmg: number, fromX: number, isSpecial: boolean) {
    const foe = this.p1;
    const dir: FacingDir = fromX < foe.x ? 1 : -1;
    this.applyDamage(foe, { ...this.p2, facing: dir } as FighterState, dmg, "p2", isSpecial);
  }

  updateFighterPhysics(s: FighterState, step: number, _frozenInput: boolean) {
    s.x += s.vx * step;
    s.y += s.vy * step;
    s.vy += GRAVITY * step;
    if (s.y >= GROUND_Y - FIGHTER_H) {
      s.y = GROUND_Y - FIGHTER_H;
      s.vy = 0;
      if (!s.onGround) {
        s.onGround = true;
        if (s.anim === "jump") s.anim = "idle";
      }
    } else {
      s.onGround = false;
    }
    // bounds & soft collision
    s.x = Math.max(60, Math.min(WORLD.w - 60, s.x));
    const other = s === this.p1 ? this.p2 : this.p1;
    const overlap = FIGHTER_W - Math.abs(s.x - other.x);
    if (overlap > 0 && Math.abs(s.y - other.y) < 100) {
      const push = (overlap / 2) * (s.x < other.x ? -1 : 1);
      s.x += push;
    }
  }

  aiControl(self: FighterState, foe: FighterState, _step: number) {
    if (this.matchOver || this.roundOver) {
      this.remoteInput = { ...EMPTY_INPUT };
      return;
    }
    const gap = Math.abs(foe.x - self.x);     // horizontal distance to player
    const HIT_RANGE = 80;                      // close enough to land a punch/kick
    const r = { ...EMPTY_INPUT };

    // AI "think" timer so it commits to an action for a few frames instead of
    // flickering inputs every single frame (which made attacks never fire).
    this.aiTimer -= 1;

    if (this.aiTimer <= 0) {
      // pick a new decision
      if (gap > HIT_RANGE) {
        this.aiAction = "approach";
        this.aiTimer = 6;
      } else {
        // in striking range — choose an attack and hold it briefly
        const roll = Math.random();
        if (self.meter >= 50 && roll > 0.85) this.aiAction = "special";
        else if (roll > 0.55) this.aiAction = "punch";
        else if (roll > 0.30) this.aiAction = "kick";
        else if (roll > 0.18) this.aiAction = "block";
        else if (roll > 0.10) this.aiAction = "retreat";
        else this.aiAction = "jump";
        this.aiTimer = 10 + Math.floor(Math.random() * 10);
      }
    }

    // close the gap whenever out of range, regardless of the current action
    if (gap > HIT_RANGE && this.aiAction !== "block") {
      if (foe.x > self.x) r.right = true;
      else r.left = true;
    }

    // execute the committed action
    switch (this.aiAction) {
      case "punch": if (gap <= HIT_RANGE + 10) r.punch = true; break;
      case "kick": if (gap <= HIT_RANGE + 14) r.kick = true; break;
      case "special": if (self.meter >= 50) r.special = true; break;
      case "jump": r.jump = true; break;
      case "block": r.block = true; break;
      case "retreat":
        if (foe.x > self.x) r.left = true; else r.right = true;
        break;
    }

    // reactive block when the player throws a heavy move (some of the time)
    if (
      (foe.anim === "special" || foe.anim === "throw") &&
      Math.random() > 0.5
    ) {
      r.block = true;
    }

    this.remoteInput = r;
  }

  burst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 7;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 2,
        life: 20 + Math.random() * 20,
        maxLife: 40,
        color,
        size: 3 + Math.random() * 6,
      });
    }
  }

  updateParticles(step: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += 0.25 * step;
      p.life -= step;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  updateTexts(dt: number) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y -= 0.8 * dt;
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  // ---------- RENDERING ----------
  render() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = cw / WORLD.w;

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);

    // screen shake
    const sx = (Math.random() - 0.5) * this.shakeMag * scale;
    const sy = (Math.random() - 0.5) * this.shakeMag * scale;
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);

    this.drawBackground(ctx);
    // draw fighters back-to-front by x for slight depth
    this.drawFighter(ctx, this.p2, this.p2Fighter);
    this.drawFighter(ctx, this.p1, this.p1Fighter);
    this.drawBeams(ctx);
    this.drawThrownWeapons(ctx);
    this.drawBeamClash(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);

    ctx.restore();

    // hit flash overlay
    if (this.hitFlash > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, this.hitFlash);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    // slow-mo vignette during victory
    if (this.matchOver) {
      const g = ctx.createRadialGradient(
        cw / 2,
        ch / 2,
        ch * 0.2,
        cw / 2,
        ch / 2,
        ch * 0.75
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  drawBackground(ctx: CanvasRenderingContext2D) {
    const m = this.map;
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, m.sky[0]);
    g.addColorStop(1, m.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    // soft sun / moon glow
    ctx.save();
    ctx.globalAlpha = 0.5;
    const sun = ctx.createRadialGradient(WORLD.w * 0.5, 180, 20, WORLD.w * 0.5, 180, 320);
    sun.addColorStop(0, m.accent);
    sun.addColorStop(1, "transparent");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, WORLD.w, GROUND_Y);
    ctx.restore();

    // unique scenery per map
    switch (m.scene || m.id) {
      case "dojo": this.sceneDojo(ctx, m); break;
      case "neon": this.sceneNeon(ctx, m); break;
      case "volcano": this.sceneVolcano(ctx, m); break;
      case "space": this.sceneSpace(ctx, m); break;
      case "frozen": this.sceneFrozen(ctx, m); break;
      case "arena": this.sceneArena(ctx, m); break;
      default: this.sceneNeon(ctx, m);
    }

    // ambient floating particles (snow/embers/stars depending on map)
    ctx.save();
    for (let i = 0; i < 36; i++) {
      const drift = m.id === "frozen" ? 18 : 8;
      const px = (i * 137.5 + this.bgTime * (drift + (i % 5))) % WORLD.w;
      const py = (i * 90 + this.bgTime * 6) % GROUND_Y;
      ctx.globalAlpha = 0.18 + 0.25 * Math.abs(Math.sin(i + this.bgTime * 0.05));
      ctx.fillStyle = m.particle;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawGround(ctx, m);
  }

  drawGround(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // textured ground with depth gradient
    const gg = ctx.createLinearGradient(0, GROUND_Y, 0, WORLD.h);
    gg.addColorStop(0, shade(m.ground, 14));
    gg.addColorStop(1, shade(m.ground, -20));
    ctx.fillStyle = gg;
    ctx.fillRect(0, GROUND_Y, WORLD.w, WORLD.h - GROUND_Y);

    // glowing edge line
    ctx.save();
    ctx.shadowColor = m.groundEdge;
    ctx.shadowBlur = 16;
    ctx.fillStyle = m.groundEdge;
    ctx.fillRect(0, GROUND_Y, WORLD.w, 6);
    ctx.restore();

    // perspective floor tiles (texture)
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = m.groundEdge;
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const gx = (((i * 70 - this.bgTime * 0.2) % WORLD.w) + WORLD.w) % WORLD.w;
      ctx.beginPath();
      ctx.moveTo(gx, GROUND_Y);
      ctx.lineTo(gx - 90, WORLD.h);
      ctx.stroke();
    }
    // horizontal depth lines
    for (let r = 1; r <= 4; r++) {
      const y = GROUND_Y + (WORLD.h - GROUND_Y) * (r / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- scenery helpers ----
  sceneDojo(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // distant mountains
    ctx.save();
    ctx.fillStyle = shade(m.sky[1], -16);
    for (let i = 0; i < 5; i++) {
      const mx = i * 320 - 80;
      ctx.beginPath();
      ctx.moveTo(mx, GROUND_Y);
      ctx.lineTo(mx + 160, GROUND_Y - 200 - (i % 2) * 60);
      ctx.lineTo(mx + 320, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // big temple/pagoda silhouette
    ctx.save();
    ctx.fillStyle = "#1a0f1f";
    const tx = WORLD.w * 0.5;
    for (let tier = 0; tier < 3; tier++) {
      const w = 260 - tier * 70;
      const ty = GROUND_Y - 120 - tier * 90;
      roundRect(ctx, tx - w / 2, ty, w, 70, 6);
      ctx.fill();
      // curved roof
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.moveTo(tx - w / 2 - 22, ty);
      ctx.quadraticCurveTo(tx, ty - 40, tx + w / 2 + 22, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1a0f1f";
    }
    // glowing lanterns
    ctx.shadowColor = m.accent;
    ctx.shadowBlur = 22;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "#ffae3b";
      ctx.beginPath();
      ctx.arc(120 + i * 180, GROUND_Y - 60 + Math.sin(this.bgTime * 0.1 + i) * 6, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // falling cherry-blossom petals handled by ambient particles
  }

  sceneNeon(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // layered neon skyscrapers with lit windows
    const layers = [
      { a: 0.4, h: 0.55, w: 150, c: shade(m.sky[1], -22) },
      { a: 0.7, h: 0.75, w: 110, c: shade(m.sky[1], -8) },
      { a: 1.0, h: 0.95, w: 90, c: "#0c0c20" },
    ];
    layers.forEach((L, li) => {
      ctx.save();
      ctx.globalAlpha = L.a;
      for (let i = -1; i < WORLD.w / L.w + 1; i++) {
        const bx = i * L.w + ((li * 30) % L.w);
        const bh = (120 + ((i * 67 + li * 40) % 200)) * L.h;
        ctx.fillStyle = L.c;
        ctx.fillRect(bx, GROUND_Y - bh, L.w - 14, bh);
        // neon edge
        ctx.fillStyle = li % 2 ? m.accent : m.particle;
        ctx.globalAlpha = L.a * 0.5;
        ctx.fillRect(bx, GROUND_Y - bh, L.w - 14, 3);
        ctx.globalAlpha = L.a;
        // windows
        if (li === 2) {
          for (let wy = GROUND_Y - bh + 14; wy < GROUND_Y - 14; wy += 18) {
            for (let wx = bx + 8; wx < bx + L.w - 22; wx += 16) {
              if ((wx + wy) % 3 === 0) {
                ctx.fillStyle = Math.sin(wx + wy + this.bgTime * 0.1) > 0 ? m.accent : m.particle;
                ctx.globalAlpha = L.a * 0.85;
                ctx.fillRect(wx, wy, 7, 9);
              }
            }
          }
          ctx.globalAlpha = L.a;
        }
      }
      ctx.restore();
    });
    // flying car lights
    ctx.save();
    ctx.shadowColor = m.accent;
    ctx.shadowBlur = 16;
    for (let i = 0; i < 4; i++) {
      const fx = ((this.bgTime * (20 + i * 8) + i * 300) % (WORLD.w + 100)) - 50;
      ctx.fillStyle = i % 2 ? m.accent : m.particle;
      ctx.fillRect(fx, 90 + i * 50, 22, 4);
    }
    ctx.restore();
  }

  sceneVolcano(ctx: CanvasRenderingContext2D, _m: ArenaMap) {
    // jagged volcanic mountains
    ctx.save();
    ctx.fillStyle = "#1a0606";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= WORLD.w; x += 80) {
      ctx.lineTo(x, GROUND_Y - 140 - Math.abs(Math.sin(x * 0.01) * 130));
    }
    ctx.lineTo(WORLD.w, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // lava glow at the peaks
    ctx.shadowColor = "#ff5b00";
    ctx.shadowBlur = 30;
    ctx.fillStyle = "#ff5b00";
    for (let x = 120; x < WORLD.w; x += 260) {
      ctx.beginPath();
      ctx.arc(x, GROUND_Y - 200 - Math.abs(Math.sin(x) * 60), 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // rising lava glow on horizon
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.15 * Math.sin(this.bgTime * 0.2);
    const lg = ctx.createLinearGradient(0, GROUND_Y - 80, 0, GROUND_Y);
    lg.addColorStop(0, "transparent");
    lg.addColorStop(1, "#ff5b00");
    ctx.fillStyle = lg;
    ctx.fillRect(0, GROUND_Y - 80, WORLD.w, 80);
    ctx.restore();

    // rising embers
    ctx.save();
    ctx.shadowColor = "#ff7b3b";
    ctx.shadowBlur = 10;
    for (let i = 0; i < 24; i++) {
      const ex = (i * 90 + this.bgTime * 3) % WORLD.w;
      const ey = GROUND_Y - ((this.bgTime * (4 + (i % 4)) + i * 50) % GROUND_Y);
      ctx.fillStyle = i % 2 ? "#ff5b00" : "#ffce3b";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(ex, ey, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  sceneSpace(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // starfield
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const sx = (i * 73.3) % WORLD.w;
      const sy = (i * 51.7) % (GROUND_Y - 20);
      ctx.globalAlpha = 0.3 + 0.6 * Math.abs(Math.sin(i + this.bgTime * 0.1));
      ctx.fillStyle = "#fff";
      ctx.fillRect(sx, sy, 1.5 + (i % 2), 1.5 + (i % 2));
    }
    ctx.restore();
    // big planet with ring
    ctx.save();
    const pcx = WORLD.w * 0.78;
    const pcy = 150;
    const pg = ctx.createRadialGradient(pcx - 30, pcy - 30, 10, pcx, pcy, 90);
    pg.addColorStop(0, m.accent);
    pg.addColorStop(1, shade(m.accent, -55));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(pcx, pcy, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = m.particle;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(pcx, pcy, 130, 30, -0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // distant nebula glow
    ctx.save();
    ctx.globalAlpha = 0.25;
    const ng = ctx.createRadialGradient(WORLD.w * 0.25, 220, 20, WORLD.w * 0.25, 220, 260);
    ng.addColorStop(0, m.particle);
    ng.addColorStop(1, "transparent");
    ctx.fillStyle = ng;
    ctx.fillRect(0, 0, WORLD.w, GROUND_Y);
    ctx.restore();
  }

  sceneFrozen(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // layered snowy mountains
    const peaks = [
      { c: shade(m.sky[1], -18), h: 240, o: 0 },
      { c: shade(m.sky[0], 28), h: 180, o: 120 },
    ];
    peaks.forEach((P) => {
      ctx.save();
      ctx.fillStyle = P.c;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      for (let x = -100; x <= WORLD.w + 100; x += 200) {
        ctx.lineTo(x + P.o, GROUND_Y - P.h - Math.abs(Math.sin((x + P.o) * 0.008) * 90));
        ctx.lineTo(x + 100 + P.o, GROUND_Y);
      }
      ctx.closePath();
      ctx.fill();
      // snow caps
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      for (let x = -100; x <= WORLD.w + 100; x += 200) {
        const peakY = GROUND_Y - P.h - Math.abs(Math.sin((x + P.o) * 0.008) * 90);
        ctx.beginPath();
        ctx.moveTo(x + P.o - 26, peakY + 34);
        ctx.lineTo(x + P.o, peakY);
        ctx.lineTo(x + P.o + 26, peakY + 34);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
    // aurora
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(this.bgTime * 0.1);
    const ag = ctx.createLinearGradient(0, 40, 0, 220);
    ag.addColorStop(0, m.accent);
    ag.addColorStop(1, "transparent");
    ctx.fillStyle = ag;
    ctx.fillRect(0, 40, WORLD.w, 180);
    ctx.restore();
  }

  sceneArena(ctx: CanvasRenderingContext2D, m: ArenaMap) {
    // colosseum tiers with a cheering crowd
    ctx.save();
    for (let tier = 0; tier < 3; tier++) {
      const ty = 120 + tier * 70;
      ctx.fillStyle = shade(m.sky[1], -10 - tier * 6);
      ctx.fillRect(0, ty, WORLD.w, 60);
      // crowd dots that twinkle
      for (let x = 10; x < WORLD.w; x += 16) {
        const flick = Math.sin(x * 0.5 + tier + this.bgTime * 0.3) > 0.3;
        ctx.fillStyle = flick ? m.accent : shade(m.accent, -30);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x + (tier % 2) * 8, ty + 30, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // big spotlights
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 4; i++) {
      const lx = 180 + i * 320;
      const sg = ctx.createLinearGradient(lx, 60, lx, GROUND_Y);
      sg.addColorStop(0, "#ffffff");
      sg.addColorStop(1, "transparent");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(lx, 60);
      ctx.lineTo(lx - 70, GROUND_Y);
      ctx.lineTo(lx + 70, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // arena wall + banners
    ctx.save();
    ctx.fillStyle = shade(m.ground, 10);
    ctx.fillRect(0, GROUND_Y - 60, WORLD.w, 60);
    ctx.fillStyle = m.accent;
    for (let x = 40; x < WORLD.w; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y - 60);
      ctx.lineTo(x + 26, GROUND_Y - 60);
      ctx.lineTo(x + 13, GROUND_Y - 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawFighter(ctx: CanvasRenderingContext2D, s: FighterState, f: Fighter) {
    const build = getBuild(f.id);
    ctx.save();
    ctx.translate(s.x, s.y);
    const dir = s.facing;
    ctx.scale(dir, 1);

    const t = s.animTime;
    const w = FIGHTER_W;
    const h = FIGHTER_H;
    const bulk = build.bulk;       // limb/torso width multiplier
    const hs = build.headScale;    // head size multiplier

    // shadow (sized to the build so big fighters cast bigger shadows)
    ctx.save();
    ctx.scale(dir, 1);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    const groundOff = GROUND_Y - FIGHTER_H - s.y;
    ctx.ellipse(0, h + groundOff, 38 * build.scale * bulk, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // overall body scale (anchored at the feet) + opacity for ghostly fighters
    ctx.translate(0, h);
    ctx.scale(build.scale, build.scale);
    ctx.translate(0, -h);
    ctx.globalAlpha = build.alpha;
    // silhouette glow for aura/ghost/holy fighters
    if (build.extra === "aura" || build.glow) {
      ctx.shadowColor = build.glow || f.specialColor;
      ctx.shadowBlur = 18;
    }

    // aura when meter high or special
    if (s.meter >= 100 || s.anim === "special") {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(this.bgTime);
      const aura = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 110);
      aura.addColorStop(0, f.specialColor);
      aura.addColorStop(1, "transparent");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, h / 2, 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // animation pose offsets
    let lean = 0;
    let armPunch = 0;
    let legKick = 0;
    let crouch = 0;
    let bob = Math.sin(t * 0.15) * 3;

    switch (s.anim) {
      case "idle":
        // classic fighting-game ready stance: slight forward lean + gentle breathing bob
        bob = Math.sin(t * 0.12) * 2.5;
        lean = 9;
        crouch = 6; // knees bent, body lowered
        break;
      case "walk":
        bob = Math.sin(t * 0.4) * 4;
        lean = 9;
        crouch = 5; // keep the bent-knee guard while shuffling
        break;
      case "punch":
        armPunch = Math.min(1, t / 8) * (t < 12 ? 1 : 0.4);
        lean = 10;
        break;
      case "kick":
        legKick = Math.min(1, t / 10);
        lean = 8;
        break;
      case "block":
        crouch = 8;
        lean = -4;
        break;
      case "hurt":
        lean = -14;
        bob = Math.sin(t) * 4;
        break;
      case "special":
        lean = 16;
        armPunch = 1;
        break;
      case "ko":
        ctx.rotate(-1.2);
        break;
      case "win":
        bob = Math.sin(t * 0.2) * 8;
        break;
    }

    const body = s.color;
    const accent = f.accent;
    const skin = "#f3c79a";
    const skinDark = "#d9a877";
    const glove = shade(accent, -10);
    const boot = "#2a2a33";
    const bootSole = "#15151a";

    // bone: a tapered, shaded limb segment with rounded ends
    const bone = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      width: number,
      col: string
    ) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // subtle highlight down the limb for a 3D feel
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(2, width * 0.32);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // a circular joint / hand / foot blob
    const blob = (x: number, y: number, r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    // a boot (foot) pointing forward
    const drawBoot = (x: number, y: number) => {
      ctx.fillStyle = boot;
      roundRect(ctx, x - 4, y - 8, 26, 14, 5);
      ctx.fill();
      ctx.fillStyle = bootSole;
      roundRect(ctx, x - 4, y + 3, 26, 5, 2);
      ctx.fill();
    };

    // a gloved fist
    const drawFist = (x: number, y: number, r = 10) => {
      blob(x, y, r, glove);
      // knuckle line
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, -0.6, 0.9);
      ctx.stroke();
      // wrist band
      ctx.fillStyle = accent;
      roundRect(ctx, x - r, y + r - 4, r * 0.7, 6, 2);
      ctx.fill();
    };

    ctx.translate(0, crouch);
    const hipY = h - 62;
    const shoulderY = hipY - 56;
    const headY = shoulderY - 30;

    // ============ BACK-LAYER EXTRAS (behind the body) ============
    if (build.extra === "tail") {
      // dino/dragon tail swaying behind
      const sway = Math.sin(t * 0.12 + this.bgTime * 0.4) * 18;
      ctx.save();
      ctx.fillStyle = shade(body, -12);
      ctx.beginPath();
      ctx.moveTo(-10, hipY - 4);
      ctx.quadraticCurveTo(-52, hipY + 6 + sway * 0.4, -78, hipY - 18 + sway);
      ctx.quadraticCurveTo(-54, hipY + 22 + sway * 0.4, -10, hipY + 12);
      ctx.closePath();
      ctx.fill();
      // tail spikes
      ctx.fillStyle = accent;
      for (let i = 1; i <= 3; i++) {
        const tx = -10 - i * 18;
        const ty = hipY - 4 + (sway * i) / 4;
        ctx.beginPath();
        ctx.moveTo(tx, ty - 2);
        ctx.lineTo(tx - 4, ty - 12);
        ctx.lineTo(tx + 6, ty - 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (build.extra === "cape") {
      const sway = Math.sin(t * 0.12 + this.bgTime * 0.3) * 10;
      ctx.save();
      ctx.fillStyle = shade(accent, -22);
      ctx.beginPath();
      ctx.moveTo(-20, shoulderY - 2);
      ctx.lineTo(20, shoulderY - 2);
      ctx.quadraticCurveTo(34 + sway, hipY + 30, 10 + sway, h - 6);
      ctx.lineTo(-26 + sway, h - 6);
      ctx.quadraticCurveTo(-34 + sway, hipY + 20, -20, shoulderY - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (build.extra === "wings") {
      const flap = Math.sin(this.bgTime * 0.8) * 0.25;
      ctx.save();
      ctx.fillStyle = build.glow || "#ffffff";
      ctx.globalAlpha = build.alpha * 0.85;
      for (const sgn of [-1, 1]) {
        ctx.save();
        ctx.translate(sgn * 8, shoulderY + 4);
        ctx.rotate(sgn * (0.5 + flap));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(sgn * 30, -30, sgn * 18, -64);
        ctx.quadraticCurveTo(sgn * 8, -36, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    if (build.extra === "halo") {
      ctx.save();
      ctx.strokeStyle = build.glow || "#ffd23b";
      ctx.shadowColor = build.glow || "#ffd23b";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(2, headY - 26, 16, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ============ LEGS (drawn first, behind torso) ============
    if (s.anim === "kick") {
      // standing/support leg
      bone(2, hipY, 4, hipY + 36, 17, body);
      bone(4, hipY + 36, 0, h - 4, 14, body);
      drawBoot(-6, h - 4);
      // kicking leg extends forward with shin + boot
      const kx = 30 + legKick * 58;
      const ky = hipY + 18 - legKick * 34;
      bone(2, hipY, kx * 0.6, ky + 6, 17, body);   // thigh
      bone(kx * 0.6, ky + 6, kx, ky, 14, body);    // shin
      drawBoot(kx + 4, ky);                        // boot toe
      blob(2, hipY, 9, shade(body, -12));          // hip joint
    } else {
      // Wide, bent-knee fighting stance (Ryu-style): front leg forward, back leg
      // planted behind, both knees bent. Walk adds a small shuffle.
      const shuffle = s.anim === "walk" ? Math.sin(t * 0.4) * 8 : 0;
      // ---- BACK leg (planted behind, knee bent outward) ----
      const bKnX = -26;                 // back knee pushed back
      const bFtX = -34 + shuffle;       // back foot far behind
      bone(-2, hipY, bKnX, hipY + 30, 18, shade(body, -16));      // thigh
      bone(bKnX, hipY + 30, bFtX, h - 4, 15, shade(body, -16));   // shin
      drawBoot(bFtX - 4, h - 4);
      // ---- FRONT leg (steps toward foe, knee bent) ----
      const fKnX = 18;                  // front knee forward
      const fFtX = 26 - shuffle;        // front foot forward
      bone(2, hipY, fKnX, hipY + 32, 18, body);                  // thigh
      bone(fKnX, hipY + 32, fFtX, h - 4, 15, body);              // shin
      drawBoot(fFtX - 2, h - 4);
      blob(0, hipY, 11, shade(body, -10)); // hip/belt joint
    }

    // ============ TORSO + HEAD (lean group) ============
    ctx.save();
    ctx.rotate((lean * Math.PI) / 180);

    // ---- BACK ARM (behind torso) ----
    const backArm = (
      ex: number,
      ey: number,
      hx: number,
      hy: number,
      fist: boolean
    ) => {
      bone(-6, shoulderY + 4, ex, ey, 13, shade(body, -16));
      bone(ex, ey, hx, hy, 11, shade(skin, -10));
      if (fist) drawFist(hx, hy, 8);
      else blob(hx, hy, 8, skinDark);
    };

    // back arm pose
    if (s.anim === "punch" || s.anim === "special") {
      backArm(-14, shoulderY + 18, -20, shoulderY + 30, true);
    } else if (s.anim === "win") {
      backArm(-16, shoulderY - 18, -22, shoulderY - 40 - bob, true);
    } else if (s.anim === "block") {
      // tuck the back fist tight to the chin
      backArm(-2, shoulderY + 2, 4, shoulderY - 18, true);
    } else {
      // IDLE / WALK: back fist raised guarding the chin (bobs gently)
      const gb = s.anim === "walk" ? Math.sin(t * 0.4) * 2 : bob * 0.5;
      backArm(-2, shoulderY + 6, 6, shoulderY - 16 + gb, true);
    }

    // ---- TORSO (costume) ---- (width scales with the fighter's bulk)
    const tw = 24 * bulk; // torso half-width
    // main body suit
    ctx.fillStyle = body;
    roundRect(ctx, -tw, shoulderY - 4, tw * 2, hipY - shoulderY + 12, 14);
    ctx.fill();
    // chest shading
    ctx.fillStyle = shade(body, -12);
    roundRect(ctx, tw * 0.25, shoulderY - 2, tw * 0.66, hipY - shoulderY + 8, 10);
    ctx.fill();
    // muscle/abs definition for bulky fighters
    if (bulk >= 1.2) {
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 16);
      ctx.lineTo(0, hipY - 6);
      ctx.stroke();
      for (let ab = 0; ab < 3; ab++) {
        const ay = shoulderY + 24 + ab * 12;
        ctx.beginPath();
        ctx.moveTo(-tw * 0.5, ay);
        ctx.lineTo(tw * 0.5, ay);
        ctx.stroke();
      }
    }
    // chest plate / costume accent panel
    ctx.fillStyle = accent;
    roundRect(ctx, -tw + 2, shoulderY - 2, tw * 2 - 4, 18, 8);
    ctx.fill();
    // diagonal sash
    ctx.fillStyle = shade(accent, 18);
    ctx.beginPath();
    ctx.moveTo(-tw, shoulderY + 14);
    ctx.lineTo(-6, shoulderY + 14);
    ctx.lineTo(14, hipY - 2);
    ctx.lineTo(-2, hipY - 2);
    ctx.closePath();
    ctx.fill();
    // belt
    ctx.fillStyle = "#222";
    roundRect(ctx, -tw, hipY - 8, tw * 2, 12, 4);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, -7, hipY - 7, 14, 10, 3); // buckle
    ctx.fill();
    // shoulder pads (with spikes for heavy/brute builds)
    ctx.fillStyle = shade(accent, -8);
    blob(-tw + 6, shoulderY + 2, 10 * bulk, shade(accent, -8));
    blob(tw - 6, shoulderY + 2, 10 * bulk, shade(accent, -8));
    if (build.extra === "shoulderSpikes") {
      ctx.fillStyle = shade(accent, 20);
      for (const sx of [-tw + 6, tw - 6]) {
        ctx.beginPath();
        ctx.moveTo(sx - 8, shoulderY - 2);
        ctx.lineTo(sx, shoulderY - 18);
        ctx.lineTo(sx + 8, shoulderY - 2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ---- NECK + HEAD ----
    ctx.fillStyle = skin;
    roundRect(ctx, -7, shoulderY - 16, 14, 16, 5); // neck
    ctx.fill();
    // (headY declared earlier near the back-layer extras)
    // The whole head (+hair) is scaled by hs so big/small heads read clearly.
    ctx.save();
    ctx.translate(2, headY);
    ctx.scale(hs, hs);
    ctx.translate(-2, -headY);

    // face
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(2, headY, 17, 0, Math.PI * 2);
    ctx.fill();
    // jaw shading
    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.arc(2, headY + 4, 17, 0.2, Math.PI - 0.2);
    ctx.fill();

    // ---- HAIR / HEADGEAR by style ----
    this.drawHair(ctx, build.hair, headY, f.accent, body, accent);

    // eye + brow (facing forward = +x because we already scaled by dir)
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(9, headY, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(10, headY, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a2a1a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(4, headY - 7);
    ctx.lineTo(14, headY - 5);
    ctx.stroke();

    ctx.restore(); // head scale

    // ---- FRONT ARM ----
    const hasWeapon = s.weaponEquipped && !s.weaponThrown;
    const wpn = getWeapon(f.id);
    // helper: draw the held weapon from the hand, angled `ang`, scaled to its length
    const drawHeld = (hx: number, hy: number, ang: number) => {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ang);
      this.drawWeaponShape(ctx, f.id, wpn.length);
      ctx.restore();
    };

    if (s.anim === "weaponAtk") {
      // big overhead/forward weapon swing
      const sw = Math.min(1, t / 10);
      const ang = -1.1 + sw * 1.7; // arc down
      const hx = 22, hy = shoulderY - 4;
      bone(8, shoulderY + 4, 18, shoulderY, 14, body);
      bone(18, shoulderY, hx, hy, 12, skin);
      drawFist(hx, hy, 10);
      drawHeld(hx + 4, hy, ang);
    } else if (s.anim === "throw") {
      // throwing motion (arm whips forward)
      const sw = Math.min(1, t / 8);
      const px = 14 + sw * 40;
      bone(8, shoulderY + 4, px * 0.6, shoulderY + 4, 14, body);
      bone(px * 0.6, shoulderY + 4, px, shoulderY + 4, 12, skin);
      drawFist(px + 8, shoulderY + 4, 10);
    } else if (s.anim === "punch" || s.anim === "special") {
      const reach = s.anim === "special" ? 78 : 50;
      const px = 14 + armPunch * reach;
      bone(8, shoulderY + 4, px * 0.55, shoulderY + 6, 14, body);     // upper
      bone(px * 0.55, shoulderY + 6, px, shoulderY + 6, 12, skin);    // forearm
      drawFist(px + 8, shoulderY + 6, 11);                            // fist
      if (s.anim === "special") {
        blob(px + 12, shoulderY + 6, 9 + 4 * Math.sin(t), f.specialColor);
      }
    } else if (s.anim === "block") {
      bone(8, shoulderY + 4, 16, shoulderY - 8, 14, body);
      bone(16, shoulderY - 8, 18, shoulderY - 24, 12, skin);
      drawFist(18, shoulderY - 28, 11);
      if (hasWeapon) drawHeld(18, shoulderY - 28, -0.5);
    } else if (s.anim === "win") {
      bone(8, shoulderY + 4, 14, shoulderY - 22, 14, body);
      bone(14, shoulderY - 22, 16, shoulderY - 46 + bob, 12, skin);
      drawFist(16, shoulderY - 52 + bob, 11);
      if (hasWeapon) drawHeld(16, shoulderY - 52 + bob, -1.4);
    } else {
      // IDLE / WALK: lead hand forward; weapon points forward if equipped
      const gb = s.anim === "walk" ? Math.sin(t * 0.4) * 2.5 : bob * 0.6;
      const hx = 30, hy = shoulderY - 12 + gb;
      bone(8, shoulderY + 4, 20, shoulderY + 6, 14, body);
      bone(20, shoulderY + 6, hx, hy, 12, skin);
      drawFist(hx + 3, hy - 5, 11);
      if (hasWeapon) drawHeld(hx + 3, hy - 5, -0.35);
    }

    ctx.restore(); // torso group

    ctx.restore(); // fighter
  }

  // Draw a fighter's hair / headgear in local head coordinates (centered ~headY).
  drawHair(
    ctx: CanvasRenderingContext2D,
    style: string,
    headY: number,
    hairCol: string,
    body: string,
    accent: string
  ) {
    const spikes = () => {
      ctx.fillStyle = hairCol;
      ctx.beginPath();
      ctx.moveTo(-15, headY - 4);
      ctx.lineTo(-18, headY - 22);
      ctx.lineTo(-6, headY - 14);
      ctx.lineTo(-2, headY - 28);
      ctx.lineTo(6, headY - 14);
      ctx.lineTo(12, headY - 26);
      ctx.lineTo(15, headY - 8);
      ctx.lineTo(18, headY - 2);
      ctx.lineTo(-15, headY - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = body;
      roundRect(ctx, -16, headY - 6, 36, 7, 3);
      ctx.fill();
    };

    switch (style) {
      case "spiky":
        spikes();
        break;
      case "flame": {
        // wild flickering flame-hair
        ctx.fillStyle = hairCol;
        ctx.shadowColor = hairCol;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(-16, headY - 2);
        for (let i = 0; i <= 6; i++) {
          const fx = -16 + (i / 6) * 32;
          const fl = 18 + Math.sin(this.bgTime * 1.5 + i) * 8;
          ctx.lineTo(fx - 3, headY - 10 - fl);
          ctx.lineTo(fx + 3, headY - 6);
        }
        ctx.lineTo(18, headY - 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case "long":
        // flowing long hair (frames the face + down the back)
        ctx.fillStyle = hairCol;
        ctx.beginPath();
        ctx.arc(2, headY - 6, 19, Math.PI, 0);
        ctx.lineTo(20, headY + 30);
        ctx.lineTo(12, headY + 30);
        ctx.lineTo(14, headY);
        ctx.lineTo(-14, headY);
        ctx.lineTo(-20, headY + 34);
        ctx.lineTo(-22, headY - 4);
        ctx.closePath();
        ctx.fill();
        break;
      case "mohawk":
        ctx.fillStyle = hairCol;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(-8 + i * 4, headY - 8);
          ctx.lineTo(-6 + i * 4, headY - 30 + (i % 2) * 6);
          ctx.lineTo(-4 + i * 4, headY - 8);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "bald":
        // just a subtle scalp highlight
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(-2, headY - 8, 7, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "hood":
        ctx.fillStyle = shade(body, -20);
        ctx.beginPath();
        ctx.arc(2, headY - 2, 21, Math.PI * 1.05, Math.PI * 1.95);
        ctx.lineTo(20, headY - 4);
        ctx.lineTo(-18, headY - 4);
        ctx.closePath();
        ctx.fill();
        // face shadow under hood
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.arc(2, headY, 14, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "horns":
        spikes();
        ctx.fillStyle = shade(accent, 15);
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sgn * 12, headY - 14);
          ctx.quadraticCurveTo(sgn * 26, headY - 24, sgn * 20, headY - 40);
          ctx.quadraticCurveTo(sgn * 16, headY - 22, sgn * 8, headY - 16);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "topknot":
        ctx.fillStyle = hairCol;
        ctx.beginPath();
        ctx.arc(2, headY - 8, 16, Math.PI, 0);
        ctx.fill();
        // bun
        ctx.beginPath();
        ctx.arc(2, headY - 26, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = body;
        roundRect(ctx, -16, headY - 6, 36, 6, 3);
        ctx.fill();
        break;
      case "crown":
        ctx.fillStyle = hairCol;
        ctx.beginPath();
        ctx.arc(2, headY - 6, 18, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#ffd23b";
        ctx.beginPath();
        ctx.moveTo(-14, headY - 14);
        ctx.lineTo(-14, headY - 26);
        ctx.lineTo(-7, headY - 18);
        ctx.lineTo(2, headY - 30);
        ctx.lineTo(11, headY - 18);
        ctx.lineTo(18, headY - 26);
        ctx.lineTo(18, headY - 14);
        ctx.closePath();
        ctx.fill();
        break;
      case "helmet":
        ctx.fillStyle = shade(accent, -6);
        ctx.beginPath();
        ctx.arc(2, headY - 2, 19, Math.PI, 0);
        ctx.lineTo(20, headY + 6);
        ctx.lineTo(-16, headY + 6);
        ctx.closePath();
        ctx.fill();
        // visor slit
        ctx.fillStyle = "#1a1a1a";
        roundRect(ctx, -12, headY - 4, 28, 6, 2);
        ctx.fill();
        // crest
        ctx.fillStyle = hairCol;
        roundRect(ctx, 0, headY - 30, 4, 26, 2);
        ctx.fill();
        break;
      case "antenna":
        spikes();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sgn * 6, headY - 16);
          ctx.quadraticCurveTo(sgn * 18, headY - 34, sgn * 10, headY - 44);
          ctx.stroke();
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(sgn * 10, headY - 44, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      default:
        spikes();
    }
  }

  // Draw a weapon silhouette at the current origin, pointing toward +x.
  drawWeaponShape(ctx: CanvasRenderingContext2D, fighterId: string, len: number) {
    const w = getWeapon(fighterId);
    const c = w.color;
    const dark = shade(c, -25);
    const handle = "#5a3a1a";
    ctx.lineCap = "round";
    switch (w.type) {
      case "katana":
      case "sword":
      case "blade" as any: {
        ctx.fillStyle = handle; roundRect(ctx, -10, -2.5, 12, 5, 2); ctx.fill();
        ctx.fillStyle = dark; roundRect(ctx, 2, -4, 6, 8, 2); ctx.fill(); // guard
        const grad = ctx.createLinearGradient(8, 0, len, 0);
        grad.addColorStop(0, c); grad.addColorStop(1, "#ffffff");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(8, -3); ctx.lineTo(len - 6, w.type === "katana" ? -5 : -3);
        ctx.lineTo(len, 0); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill();
        break;
      }
      case "dagger": {
        ctx.fillStyle = handle; roundRect(ctx, -8, -2, 9, 4, 2); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(len, 0); ctx.lineTo(2, 3); ctx.closePath(); ctx.fill();
        break;
      }
      case "axe": {
        ctx.strokeStyle = handle; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(len * 0.7, 0); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(len * 0.55, -4); ctx.quadraticCurveTo(len, -22, len + 4, 0);
        ctx.quadraticCurveTo(len, 22, len * 0.55, 4); ctx.closePath(); ctx.fill();
        break;
      }
      case "hammer": {
        ctx.strokeStyle = handle; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(len * 0.7, 0); ctx.stroke();
        ctx.fillStyle = c; roundRect(ctx, len * 0.6, -16, 22, 32, 4); ctx.fill();
        ctx.fillStyle = dark; roundRect(ctx, len * 0.6, -16, 6, 32, 4); ctx.fill();
        break;
      }
      case "club": {
        ctx.strokeStyle = handle; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(len * 0.55, 0); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(len * 0.8, 0, len * 0.28, 14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = dark;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(len * 0.7 + k * 8, (k % 2 ? -8 : 8), 3, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case "spear":
      case "trident":
      case "bo": {
        ctx.strokeStyle = handle; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-len * 0.4, 0); ctx.lineTo(len * 0.8, 0); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(len * 0.78, -5); ctx.lineTo(len + 6, 0); ctx.lineTo(len * 0.78, 5); ctx.closePath(); ctx.fill();
        if (w.type === "trident") {
          ctx.fillStyle = c;
          for (const oy of [-10, 10]) { ctx.beginPath(); ctx.moveTo(len * 0.82, oy); ctx.lineTo(len + 2, oy * 0.4); ctx.lineTo(len * 0.82, oy * 0.2); ctx.closePath(); ctx.fill(); }
        }
        break;
      }
      case "scythe": {
        ctx.strokeStyle = handle; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-len * 0.4, 0); ctx.lineTo(len * 0.85, 0); ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(len * 0.85, -2, 22, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        break;
      }
      case "staff": {
        ctx.strokeStyle = handle; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-len * 0.4, 0); ctx.lineTo(len * 0.8, 0); ctx.stroke();
        ctx.shadowColor = w.trail; ctx.shadowBlur = 16;
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(len * 0.9, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case "shuriken":
      case "chakram": {
        ctx.fillStyle = c; ctx.shadowColor = w.trail; ctx.shadowBlur = 12;
        if (w.type === "shuriken") {
          for (let k = 0; k < 4; k++) {
            ctx.save(); ctx.rotate((k * Math.PI) / 2);
            ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(len * 0.5, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
        } else {
          ctx.lineWidth = 5; ctx.strokeStyle = c;
          ctx.beginPath(); ctx.arc(0, 0, len * 0.4, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.shadowBlur = 0;
        break;
      }
      default: {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(len, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
      }
    }
  }

  // The contested glowing orb at the center of a beam clash.
  drawBeamClash(ctx: CanvasRenderingContext2D) {
    const c = this.beamClash;
    if (!c) return;
    const c1 = c.p1Beam.color;
    const c2 = c.p2Beam.color;
    const pulse = 1 + 0.25 * Math.sin(this.bgTime * 3);
    const r = (46 + Math.min(40, c.time * 0.2)) * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // outer blurred aura (blend of both colors)
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 50;
    const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, c1);
    g.addColorStop(0.7, c2);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    // bright white core
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // crackling lightning arcs radiating out
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 14;
    for (let k = 0; k < 7; k++) {
      const a = this.bgTime * 0.5 + (k / 7) * Math.PI * 2;
      const len = r * (0.9 + Math.random() * 0.5);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(
        c.x + Math.cos(a) * len + (Math.random() - 0.5) * 14,
        c.y + Math.sin(a) * len + (Math.random() - 0.5) * 14
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawThrownWeapons(ctx: CanvasRenderingContext2D) {
    for (const tw of this.thrownWeapons) {
      ctx.save();
      ctx.translate(tw.x, tw.y);
      ctx.scale(tw.dir, 1);
      ctx.rotate(tw.spins ? tw.rot : 0);
      const w = getWeapon(tw.fighterId);
      ctx.shadowColor = w.trail;
      ctx.shadowBlur = 14;
      this.drawWeaponShape(ctx, tw.fighterId, w.length);
      ctx.restore();
    }
  }

  drawBeams(ctx: CanvasRenderingContext2D) {
    for (const b of this.beams) {
      const owner = b.owner === "p1" ? this.p1 : this.p2;
      const muzzleX = owner.x + b.dir * 60;
      const muzzleY = owner.y + 48;
      const headX = b.x;
      const len = headX - muzzleX;
      const absLen = Math.max(20, Math.abs(len));
      const pulse = 1 + 0.16 * Math.sin(this.bgTime * 1.6 + b.x * 0.05);
      const halfW = (b.width / 2) * pulse;
      const fade = Math.min(1, b.life / 16);
      const core = b.color2 || "#ffffff";
      const glow = b.glow || b.color;

      ctx.save();
      ctx.globalCompositeOperation = "lighter"; // additive = energy glow

      // helper: a tapered beam body from tail (thin) to head (full)
      const beamBody = (hw: number, col: string, a: number) => {
        ctx.globalAlpha = a * fade;
        const g = ctx.createLinearGradient(muzzleX, 0, headX, 0);
        g.addColorStop(0, col + "00");
        g.addColorStop(0.12, col);
        g.addColorStop(0.85, col);
        g.addColorStop(1, col + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(muzzleX, muzzleY - hw * 0.25);
        ctx.lineTo(headX, muzzleY - hw);
        ctx.lineTo(headX + b.dir * hw * 0.8, muzzleY); // rounded nose
        ctx.lineTo(headX, muzzleY + hw);
        ctx.lineTo(muzzleX, muzzleY + hw * 0.25);
        ctx.closePath();
        ctx.fill();
      };

      // 1) wide soft BLUR aura (Kamehameha haze) — drawn big + low alpha
      ctx.shadowColor = glow;
      ctx.shadowBlur = 55;
      beamBody(halfW * 1.9, glow, 0.35);

      // 2) main colored beam body
      ctx.shadowBlur = 30;
      beamBody(halfW, b.color, 0.9);

      // 3) bright white-hot inner core
      ctx.shadowBlur = 16;
      beamBody(halfW * 0.42, core, 1);

      // 4) spiraling energy helix wrapping the beam (Galick Gun swirl)
      ctx.globalAlpha = fade;
      ctx.strokeStyle = core;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 14;
      ctx.shadowColor = b.color;
      for (let s = 0; s < 2; s++) {
        ctx.beginPath();
        const phase = this.bgTime * 0.35 + s * Math.PI;
        for (let p = 0; p <= 1.0001; p += 0.06) {
          const px = muzzleX + len * p;
          const wob = Math.sin(p * 14 + phase) * halfW * 0.7;
          if (p === 0) ctx.moveTo(px, muzzleY + wob);
          else ctx.lineTo(px, muzzleY + wob);
        }
        ctx.stroke();
      }

      // 5) travelling energy rings
      ctx.fillStyle = core;
      ctx.globalAlpha = fade * 0.8;
      for (let r = 0; r < 5; r++) {
        const rx = muzzleX + (((this.bgTime * 18 + r * 55) % absLen)) * b.dir;
        ctx.beginPath();
        ctx.ellipse(rx, muzzleY, 5, halfW * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6) CHARGE / muzzle orb at the hand (big pulsing sphere)
      const orbR = halfW * (1.7 + 0.25 * Math.sin(this.bgTime * 2));
      const mg = ctx.createRadialGradient(muzzleX, muzzleY, 2, muzzleX, muzzleY, orbR);
      mg.addColorStop(0, "#ffffff");
      mg.addColorStop(0.35, core);
      mg.addColorStop(0.7, b.color);
      mg.addColorStop(1, glow + "00");
      ctx.globalAlpha = fade;
      ctx.shadowBlur = 40;
      ctx.shadowColor = b.color;
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(muzzleX, muzzleY, orbR, 0, Math.PI * 2);
      ctx.fill();

      // 7) leading impact SPHERE at the head (bigger, brighter)
      const headR = halfW * 1.9;
      const hg = ctx.createRadialGradient(headX, muzzleY, 2, headX, muzzleY, headR);
      hg.addColorStop(0, "#ffffff");
      hg.addColorStop(0.3, core);
      hg.addColorStop(0.65, b.color);
      hg.addColorStop(1, glow + "00");
      ctx.fillStyle = hg;
      ctx.shadowBlur = 50;
      ctx.beginPath();
      ctx.arc(headX, muzzleY, headR, 0, Math.PI * 2);
      ctx.fill();

      // 8) lightning sparks darting off the head
      ctx.globalAlpha = fade;
      ctx.strokeStyle = core;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10;
      for (let k = 0; k < 4; k++) {
        const a = this.bgTime * 0.6 + (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(headX, muzzleY);
        ctx.lineTo(
          headX + Math.cos(a) * headR * 1.3,
          muzzleY + Math.sin(a) * headR * 1.3
        );
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawTexts(ctx: CanvasRenderingContext2D) {
    for (const t of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life / 30);
      ctx.font = `900 ${t.size}px 'Arial Black', sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Lighten (positive amt) or darken (negative amt) a hex color by a percentage.
function shade(hex: string, amt: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return hex;
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const f = amt / 100;
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (f >= 0 ? 255 - c : c) * f)));
  r = adj(r);
  g = adj(g);
  b = adj(b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
