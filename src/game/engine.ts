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

export type FacingDir = 1 | -1;

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  block: boolean;
  special: boolean;
}

export const EMPTY_INPUT: InputState = {
  left: false,
  right: false,
  jump: false,
  punch: false,
  kick: false,
  block: false,
  special: false,
};

type Anim =
  | "idle"
  | "walk"
  | "jump"
  | "punch"
  | "kick"
  | "block"
  | "special"
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
  texts: FloatingText[] = [];
  input: InputState = { ...EMPTY_INPUT };
  remoteInput: InputState = { ...EMPTY_INPUT };
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
          this.p2.anim = s.anim;
        }
        if (typeof s.blocking === "boolean") this.p2.blocking = s.blocking;
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
    this.updateParticles(step);
    this.updateTexts(dt);

    // KO check (ends the current round)
    if (this.p1.hp <= 0 && !this.matchOver && !this.roundOver) this.endRound("p2");
    else if (this.p2.hp <= 0 && !this.matchOver && !this.roundOver) this.endRound("p1");
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
      setTimeout(() => Sfx.victory(), 700);
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
    };
    reset(this.p1, 320, 1, this.p1Fighter.health);
    reset(this.p2, 960, -1, this.p2Fighter.health);
    this.beams = [];
    this.roundTimer = this.roundTime;
    this.roundOver = false;
    this.roundWinner = null;
    this.victoryTimer = 0;
    this.targetTimeScale = 1;
    this.roundGrace = 90; // ~1.5s where stale remote HP is ignored
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
    setTimeout(() => Sfx.victory(), 700);
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
    if (self.hurtTime > 0) {
      self.hurtTime -= step;
      this.updateFighterPhysics(self, step, false);
      self.animTime += step;
      return;
    }

    const f = who === "p1" ? this.p1Fighter : this.p2Fighter;
    self.blocking = inp.block && self.onGround;

    const attacking =
      self.anim === "punch" || self.anim === "kick" || self.anim === "special";

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
      if (inp.special && self.meter >= 50) {
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
      (self.anim === "special" && self.animTime > 50)
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
    _range: number
  ) {
    // resolve a few frames into the swing
    const delay = 8;
    setTimeout(() => {
      if (this.matchOver) return;
      const reach = FIGHTER_W + 24;
      const dx = (foe.x - self.x) * self.facing;
      const close = dx > 0 && dx < reach && Math.abs(foe.y - self.y) < 120;
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

  updateBeams(step: number) {
    const targetFor = (owner: "p1" | "p2") => (owner === "p1" ? this.p2 : this.p1);
    const ownerFor = (owner: "p1" | "p2") => (owner === "p1" ? this.p1 : this.p2);

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
    if (this.matchOver) return;
    const dist = (foe.x - self.x) * self.facing;
    const r = { ...EMPTY_INPUT };
    if (Math.abs(dist) > 130) {
      if (foe.x > self.x) r.right = true;
      else r.left = true;
    } else {
      // in range — decide
      const roll = Math.random();
      if (self.meter >= 50 && roll > 0.97) r.special = true;
      else if (roll > 0.93) r.punch = true;
      else if (roll > 0.89) r.kick = true;
      else if (roll > 0.86) r.block = true;
      else if (roll > 0.84) r.jump = true;
    }
    // dodge when foe attacks
    if ((foe.anim === "punch" || foe.anim === "special") && Math.random() > 0.6)
      r.block = true;
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
    ctx.save();
    ctx.translate(s.x, s.y);
    const dir = s.facing;
    ctx.scale(dir, 1);

    const t = s.animTime;
    const w = FIGHTER_W;
    const h = FIGHTER_H;

    // shadow
    ctx.save();
    ctx.scale(dir, 1);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    const groundOff = GROUND_Y - FIGHTER_H - s.y;
    ctx.ellipse(0, h + groundOff, 38, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    // ---- TORSO (costume) ----
    // main body suit
    ctx.fillStyle = body;
    roundRect(ctx, -24, shoulderY - 4, 48, hipY - shoulderY + 12, 14);
    ctx.fill();
    // chest shading
    ctx.fillStyle = shade(body, -12);
    roundRect(ctx, 6, shoulderY - 2, 16, hipY - shoulderY + 8, 10);
    ctx.fill();
    // chest plate / costume accent panel
    ctx.fillStyle = accent;
    roundRect(ctx, -22, shoulderY - 2, 44, 18, 8);
    ctx.fill();
    // diagonal sash
    ctx.fillStyle = shade(accent, 18);
    ctx.beginPath();
    ctx.moveTo(-22, shoulderY + 14);
    ctx.lineTo(-6, shoulderY + 14);
    ctx.lineTo(14, hipY - 2);
    ctx.lineTo(-2, hipY - 2);
    ctx.closePath();
    ctx.fill();
    // belt
    ctx.fillStyle = "#222";
    roundRect(ctx, -24, hipY - 8, 48, 12, 4);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, -7, hipY - 7, 14, 10, 3); // buckle
    ctx.fill();
    // shoulder pads
    ctx.fillStyle = shade(accent, -8);
    blob(-18, shoulderY + 2, 10, shade(accent, -8));
    blob(18, shoulderY + 2, 10, shade(accent, -8));

    // ---- NECK + HEAD ----
    ctx.fillStyle = skin;
    roundRect(ctx, -7, shoulderY - 16, 14, 16, 5); // neck
    ctx.fill();
    const headY = shoulderY - 30;
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
    // hair (spiky, DBZ-style)
    ctx.fillStyle = f.accent;
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
    // headband
    ctx.fillStyle = body;
    roundRect(ctx, -16, headY - 6, 36, 7, 3);
    ctx.fill();
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

    // ---- FRONT ARM ----
    if (s.anim === "punch" || s.anim === "special") {
      const reach = s.anim === "special" ? 78 : 50;
      const px = 14 + armPunch * reach;
      bone(8, shoulderY + 4, px * 0.55, shoulderY + 6, 14, body);     // upper
      bone(px * 0.55, shoulderY + 6, px, shoulderY + 6, 12, skin);    // forearm
      drawFist(px + 8, shoulderY + 6, 11);                            // fist
      if (s.anim === "special") {
        // energy in the fist
        blob(px + 12, shoulderY + 6, 9 + 4 * Math.sin(t), f.specialColor);
      }
    } else if (s.anim === "block") {
      bone(8, shoulderY + 4, 16, shoulderY - 8, 14, body);
      bone(16, shoulderY - 8, 18, shoulderY - 24, 12, skin);
      drawFist(18, shoulderY - 28, 11);
    } else if (s.anim === "win") {
      bone(8, shoulderY + 4, 14, shoulderY - 22, 14, body);
      bone(14, shoulderY - 22, 16, shoulderY - 46 + bob, 12, skin);
      drawFist(16, shoulderY - 52 + bob, 11);
    } else {
      // IDLE / WALK: lead fist raised forward in a guard (elbow tucked, fist up)
      const gb = s.anim === "walk" ? Math.sin(t * 0.4) * 2.5 : bob * 0.6;
      bone(8, shoulderY + 4, 20, shoulderY + 6, 14, body);      // upper arm out
      bone(20, shoulderY + 6, 30, shoulderY - 12 + gb, 12, skin); // forearm up
      drawFist(33, shoulderY - 17 + gb, 11);                    // raised lead fist
    }

    ctx.restore(); // torso group

    ctx.restore(); // fighter
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
