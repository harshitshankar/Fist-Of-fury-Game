import { useEffect, useRef, useState } from "react";
import { FightEngine, InputState, EMPTY_INPUT } from "../game/engine";
import { getFighter } from "../game/characters";
import { getMap } from "../game/maps";
import { getWeapon } from "../game/weapons";
import {
  unlockAudio,
  Sfx,
  setSoundEnabled,
  setMusicEnabled,
  startMusic,
  stopMusic,
  battleTrackForMap,
} from "../game/audio";
import TouchControls from "./TouchControls";

interface Props {
  mapId: string;
  p1Id: string;
  p2Id: string;
  p1Color: string;
  p2Color: string;
  p1Name: string;
  p2Name: string;
  online: boolean;
  rounds?: number;
  selfId?: string | null;
  oppId?: string | null;
  onSendState?: (s: any) => void;
  onSendHit?: (d: any) => void;
  onReportKO?: (loserId: string, round: number) => void;
  registerRemoteState?: (fn: (s: any) => void) => void;
  registerRemoteHit?: (fn: (d: any) => void) => void;
  registerRoundResult?: (fn: (d: any) => void) => void;
  onExit: () => void;
}

export default function GameScreen(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FightEngine | null>(null);
  const inputRef = useRef<InputState>({ ...EMPTY_INPUT });
  const [hud, setHud] = useState({ p1: 100, p2: 100, p1m: 0, p2m: 0, time: 99 });

  const [specialReady, setSpecialReady] = useState(false);
  const [weaponState, setWeaponState] = useState({ equipped: true, thrown: false });
  const [victory, setVictory] = useState<null | { winner: "p1" | "p2"; name: string }>(null);
  const [ready, setReady] = useState(false);
  const [intro, setIntro] = useState(true);
  const [muted, setMuted] = useState(false);
  const totalRounds = props.rounds && props.rounds > 0 ? props.rounds : 1;
  const roundsToWin = Math.floor(totalRounds / 2) + 1;
  const [roundWins, setRoundWins] = useState({ p1: 0, p2: 0 });
  const [roundBanner, setRoundBanner] = useState<string | null>(null);
  const [curRound, setCurRound] = useState(1);

  useEffect(() => {
    // GameScreen overlays the page as fixed (see root div) so we don't need to
    // lock body scrolling. Scroll the page to top so the match fills the view.
    window.scrollTo(0, 0);
    const canvas = canvasRef.current!;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    const engine = new FightEngine(canvas, {
      mapId: props.mapId,
      p1Id: props.p1Id,
      p2Id: props.p2Id,
      p1Color: props.p1Color,
      p2Color: props.p2Color,
      p1Name: props.p1Name,
      p2Name: props.p2Name,
      online: props.online,
      rounds: totalRounds,
      callbacks: {
        onHit: (who, dmg) => {
          if (props.online && who === "p1") {
            props.onSendHit?.({
              dmg,
              fromX: engine.p1.x,
              isSpecial:
                engine.p1.anim === "special" ||
                engine.p1.anim === "throw" ||
                engine.p1.anim === "weaponAtk",
            });
          }
        },
        onRoundEnd: (winner, p1r, p2r) => {
          setRoundWins({ p1: p1r, p2: p2r });
          const w = winner === "p1" ? props.p1Name : props.p2Name;
          setRoundBanner(`${w} wins the round!`);
          setTimeout(() => setRoundBanner(null), 2200);
        },
        onRoundStart: (round) => {
          setCurRound(round);
          setRoundBanner(`ROUND ${round}`);
          setTimeout(() => {
            setRoundBanner(null);
            Sfx.go();
          }, 1400);
        },
        onKO: (winner) => {
          // final match victory
          setRoundWins({ p1: engine.p1Rounds, p2: engine.p2Rounds });
          const w = winner === "p1" ? props.p1Name : props.p2Name;
          setTimeout(() => setVictory({ winner, name: w }), 1800);
        },
        onReportKO: (who) => {
          // ONLINE: tell the server the ACTUAL loser's socket id; the server
          // decides the result and broadcasts it to both clients identically.
          if (!props.online) return;
          const myId = props.selfId || "";
          const oppId = props.oppId || "";
          const loserId = who === "self" ? myId : oppId;
          props.onReportKO?.(loserId, engine.currentRound);
        },
      },
    });
    engineRef.current = engine;

    if (props.online) {
      props.registerRemoteState?.((s) => engine.setRemoteState(s));
      props.registerRemoteHit?.((d) => engine.receiveDamage(d.dmg, d.fromX, d.isSpecial));
      // Server-authoritative round result keeps both clients perfectly in sync.
      props.registerRoundResult?.((d) => {
        const myId = props.selfId || "";
        const localWon = d.winnerId === myId;
        const myRounds = d.score?.[myId] ?? (localWon ? engine.p1Rounds + 1 : engine.p1Rounds);
        // opponent's rounds = total awarded minus mine
        const oppId = Object.keys(d.score || {}).find((k) => k !== myId) || "";
        const oppRounds = d.score?.[oppId] ?? engine.p2Rounds;
        engine.applyRoundResult(localWon, myRounds, oppRounds, !!d.matchOver);
      });
    }

    engine.start();

    // unlock audio on entry (this screen is reached via a tap)
    unlockAudio();

    // try to go fullscreen + lock landscape for an app-like feel (best effort)
    (async () => {
      try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
        const orient: any = (screen as any).orientation;
        if (orient && orient.lock) await orient.lock("landscape").catch(() => {});
      } catch {
        /* fullscreen/orientation not supported or blocked — ignore */
      }
    })();

    // start the looping battle music for this arena
    startMusic(battleTrackForMap(props.mapId));

    // intro then GO
    const introT = setTimeout(() => {
      setIntro(false);
      setReady(true);
      engine.paused = false;
      Sfx.go();
    }, 2200);
    engine.paused = true;

    // HUD updater
    const hudInt = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      setHud({
        p1: Math.round((e.p1.hp / e.p1.maxHp) * 100),
        p2: Math.round((e.p2.hp / e.p2.maxHp) * 100),
        p1m: Math.round(e.p1.meter),
        p2m: Math.round(e.p2.meter),
        time: Math.ceil(e.roundTimer),
      });

      // special is usable whenever the meter is charged (can be used repeatedly)
      setSpecialReady(e.p1.meter >= 50);
      // weapon button states driven by the engine
      setWeaponState({ equipped: e.p1.weaponEquipped, thrown: e.p1.weaponThrown });
    }, 100);

    // network state push
    let netInt: any;
    if (props.online) {
      netInt = setInterval(() => {
        const e = engineRef.current;
        if (e) props.onSendState?.(e.getLocalSnapshot());
      }, 50);
    }

    // keyboard for desktop
    const keymap: Record<string, keyof InputState> = {
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
      arrowup: "jump",
      w: "jump",
      " ": "jump",
      j: "punch",
      k: "kick",
      l: "block",
      u: "special",
    };
    const kd = (e: KeyboardEvent) => {
      const k = keymap[e.key.toLowerCase()];
      if (k) {
        inputRef.current[k] = true;
        engine.setInput({ ...inputRef.current });
      }
    };
    const ku = (e: KeyboardEvent) => {
      const k = keymap[e.key.toLowerCase()];
      if (k) {
        inputRef.current[k] = false;
        engine.setInput({ ...inputRef.current });
      }
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    return () => {
      clearTimeout(introT);
      clearInterval(hudInt);
      if (netInt) clearInterval(netInt);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      engine.stop();
      stopMusic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = (partial: Partial<InputState>) => {
    inputRef.current = { ...inputRef.current, ...partial };
    engineRef.current?.setInput({ ...inputRef.current });
  };

  const f1 = getFighter(props.p1Id);
  const f2 = getFighter(props.p2Id);
  const map = getMap(props.mapId);

  return (
    <div className="fixed inset-0 z-[100] h-[100dvh] w-full overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Rotate-to-landscape hint (portrait phones only) */}
      <div className="rotate-hint absolute inset-0 z-[60] hidden flex-col items-center justify-center bg-black/90 text-center text-white">
        <div className="animate-spin-slow text-7xl">📱</div>
        <p className="mt-4 text-2xl font-black text-orange-400">ROTATE YOUR DEVICE</p>
        <p className="mt-1 text-sm text-white/70">Turn sideways for the best fighting experience</p>
      </div>

      {/* HUD */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2 sm:p-4">
        <PlayerBar
          name={props.p1Name}
          fighter={f1.name}
          color={props.p1Color}
          hp={hud.p1}
          meter={hud.p1m}
          side="left"
          wins={roundWins.p1}
          toWin={roundsToWin}
        />
        <div className="flex flex-col items-center pt-1">
          <div className="rounded-lg bg-black/70 px-3 py-1 text-2xl font-black text-white tabular-nums sm:text-3xl">
            {hud.time}
          </div>
          {totalRounds > 1 && (
            <div className="mt-1 rounded bg-orange-600/80 px-2 py-0.5 text-[10px] font-black text-white sm:text-xs">
              ROUND {curRound} / Best of {totalRounds}
            </div>
          )}
          <div className="mt-1 rounded bg-black/60 px-2 py-0.5 text-[10px] font-bold text-orange-300 sm:text-xs">
            {map.emoji} {map.name}
          </div>
        </div>
        <PlayerBar
          name={props.p2Name}
          fighter={f2.name}
          color={props.p2Color}
          hp={hud.p2}
          meter={hud.p2m}
          side="right"
          wins={roundWins.p2}
          toWin={roundsToWin}
        />
      </div>

      {/* Exit + mute buttons */}
      <div className="absolute right-2 top-20 z-30 flex gap-1 sm:top-24">
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setSoundEnabled(!next);
            setMusicEnabled(!next);
            if (!next) startMusic(battleTrackForMap(props.mapId));
          }}
          className="rounded bg-slate-700/80 px-2 py-1 text-xs font-bold text-white"
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          onClick={props.onExit}
          className="rounded bg-red-600/80 px-2 py-1 text-xs font-bold text-white"
        >
          EXIT
        </button>
      </div>

      {/* Intro VS */}
      {intro && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-6 animate-pulse">
            <FighterCard fighter={f1} color={props.p1Color} name={props.p1Name} />
            <div className="text-6xl font-black text-orange-500 drop-shadow-[0_0_20px_rgba(255,90,0,0.8)]">
              VS
            </div>
            <FighterCard fighter={f2} color={props.p2Color} name={props.p2Name} />
          </div>
        </div>
      )}
      {ready && !intro && hud.time === 99 && !roundBanner && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="animate-ping text-7xl font-black text-yellow-300 drop-shadow-[0_0_30px_rgba(255,210,0,1)]">
            FIGHT!
          </div>
        </div>
      )}

      {/* Round banner (ROUND X / round won) */}
      {roundBanner && !victory && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-black/50 px-8 py-4 text-center backdrop-blur-sm">
            <div className="bg-gradient-to-r from-yellow-300 via-orange-400 to-red-500 bg-clip-text text-4xl font-black text-transparent drop-shadow-[0_0_24px_rgba(255,150,0,0.8)] sm:text-6xl">
              {roundBanner}
            </div>
          </div>
        </div>
      )}

      {/* Touch controls */}
      {!victory && (
        <TouchControls
          onChange={handleInput}
          specialReady={specialReady}
          weaponEquipped={weaponState.equipped}
          weaponThrown={weaponState.thrown}
          weaponEmoji={getWeapon(props.p1Id).emoji}
        />
      )}

      {/* End-of-match overlay — celebration ONLY when YOU win.
          Scrollable + compact so the BACK button is always reachable, even on
          short landscape phone screens. */}
      {victory && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto py-3">
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/85" />

          {/* Always-visible BACK button pinned to the top-right as a guaranteed exit */}
          <button
            onClick={props.onExit}
            className="absolute right-3 top-3 z-10 rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white shadow-lg active:scale-95"
          >
            ⬅ LOBBY
          </button>

          <div className="relative my-auto animate-[victoryIn_0.6s_ease-out] px-3 text-center">
            {victory.winner === "p1" ? (
              <>
                <div className="text-lg font-bold tracking-[0.25em] text-yellow-300 sm:text-3xl">
                  🏆 YOU WIN 🏆
                </div>
                <div className="bg-gradient-to-r from-yellow-300 via-orange-400 to-red-500 bg-clip-text text-4xl font-black text-transparent drop-shadow-[0_0_30px_rgba(255,150,0,0.9)] sm:text-7xl">
                  VICTORY MATE!
                </div>
                <div className="text-base font-bold text-white sm:text-2xl">
                  {victory.name} is the champion
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-black tracking-[0.2em] text-red-400 sm:text-5xl">
                  💀 DEFEATED 💀
                </div>
                <div className="mt-1 text-base font-bold text-white/80 sm:text-2xl">
                  {victory.name} won the match
                </div>
                <div className="text-sm font-semibold text-white/50 sm:text-xl">
                  Better luck next time!
                </div>
              </>
            )}
            {totalRounds > 1 && (
              <div className="mt-1.5 text-sm font-black text-orange-300 sm:text-lg">
                Final Score — {props.p1Name}: {roundWins.p1} &nbsp;•&nbsp; {props.p2Name}: {roundWins.p2}
              </div>
            )}
            <div className="mt-4 flex justify-center">
              <button
                onClick={props.onExit}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-10 py-3 text-base font-black text-white shadow-lg active:scale-95 sm:text-lg"
              >
                ⬅ BACK TO LOBBY
              </button>
            </div>
          </div>
          {/* confetti only celebrates a WIN */}
          {victory.winner === "p1" && <Confetti />}
        </div>
      )}
    </div>
  );
}

function PlayerBar({
  name,
  fighter,
  color,
  hp,
  meter,
  side,
  wins = 0,
  toWin = 1,
}: {
  name: string;
  fighter: string;
  color: string;
  hp: number;
  meter: number;
  side: "left" | "right";
  wins?: number;
  toWin?: number;
}) {
  const pips = Array.from({ length: toWin });
  return (
    <div className={`flex-1 max-w-[42%] ${side === "right" ? "items-end text-right" : ""} flex flex-col`}>
      <div className={`flex items-center gap-1 ${side === "right" ? "flex-row-reverse" : ""}`}>
        <div
          className="h-5 w-5 rounded border border-white/50 sm:h-6 sm:w-6"
          style={{ background: color }}
        />
        <span className="truncate text-xs font-black text-white drop-shadow sm:text-sm">
          {name}
        </span>
        <span className="hidden text-[10px] font-bold text-white/60 sm:inline">{fighter}</span>
      </div>
      {/* Round-win pips (only when best-of > 1) */}
      {toWin > 1 && (
        <div className={`mt-0.5 flex gap-1 ${side === "right" ? "flex-row-reverse" : ""}`}>
          {pips.map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full border ${
                i < wins
                  ? "border-yellow-300 bg-yellow-400 shadow-[0_0_6px_rgba(255,210,0,0.9)]"
                  : "border-white/30 bg-black/40"
              }`}
            />
          ))}
        </div>
      )}
      {/* HP */}
      <div
        className={`mt-1 h-4 w-full overflow-hidden rounded border-2 border-black/60 bg-red-950 sm:h-5 ${
          side === "right" ? "flex justify-end" : ""
        }`}
      >
        <div
          className="h-full bg-gradient-to-r from-yellow-400 via-green-400 to-green-500 transition-all duration-200"
          style={{ width: `${hp}%` }}
        />
      </div>
      {/* Meter */}
      <div
        className={`mt-0.5 h-2 w-full overflow-hidden rounded bg-blue-950 ${
          side === "right" ? "flex justify-end" : ""
        }`}
      >
        <div
          className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
          style={{ width: `${meter}%` }}
        />
      </div>
    </div>
  );
}

function FighterCard({ fighter, color, name }: { fighter: any; color: string; name: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white/40 text-5xl shadow-2xl sm:h-32 sm:w-32"
        style={{ background: `radial-gradient(circle at 30% 25%, ${color}, ${color}66)` }}
      >
        {fighter.emoji}
      </div>
      <div className="mt-2 text-lg font-black text-white">{name}</div>
      <div className="text-xs font-bold text-orange-300">{fighter.name}</div>
    </div>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 50 });
  const colors = ["#ffce3b", "#ff5b3b", "#3bd0ff", "#ff3bd0", "#3bff8a"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((_, i) => (
        <div
          key={i}
          className="absolute h-2 w-2 rounded-sm"
          style={{
            left: `${Math.random() * 100}%`,
            top: "-10px",
            background: colors[i % colors.length],
            animation: `confettiFall ${2 + Math.random() * 3}s linear ${Math.random() * 2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
