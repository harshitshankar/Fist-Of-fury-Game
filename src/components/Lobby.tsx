import { useEffect, useRef, useState } from "react";
import { FIGHTERS } from "../game/characters";
import { MAPS } from "../game/maps";
import {
  unlockAudio,
  startMusic,
  stopMusic,
  setMusicEnabled,
  isMusicEnabled,
} from "../game/audio";

export interface LobbyConfig {
  name: string;
  color: string;
  fighterId: string;
  mapId: string;
  voice: boolean;
  rounds: number;
}

interface Props {
  onCreate: (cfg: LobbyConfig, code: string) => void;
  onJoin: (cfg: LobbyConfig, code: string) => void;
  onSolo: (cfg: LobbyConfig) => void;
  error: string | null;
  connecting: boolean;
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Lobby({ onCreate, onJoin, onSolo, error, connecting }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#ff5b3b");
  const [code, setCode] = useState("");
  const [voice, setVoice] = useState(true);
  const [fighterId, setFighterId] = useState(FIGHTERS[0].id);
  const [mapId, setMapId] = useState(MAPS[0].id);
  const [rounds, setRounds] = useState(3);
  const [musicOn, setMusicOn] = useState(isMusicEnabled());
  const startedRef = useRef(false);

  // Start menu music on the first user interaction (browsers block autoplay).
  useEffect(() => {
    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      unlockAudio();
      if (isMusicEnabled()) startMusic("menu");
    };
    window.addEventListener("pointerdown", begin, { once: true });
    window.addEventListener("keydown", begin, { once: true });
    return () => {
      window.removeEventListener("pointerdown", begin);
      window.removeEventListener("keydown", begin);
      stopMusic(); // stop menu music when leaving the lobby (e.g. into a fight)
    };
  }, []);

  const cfg = (): LobbyConfig => ({ name: name.trim() || "Fighter", color, fighterId, mapId, voice, rounds });

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#0a0a2e] via-[#1a1040] to-[#2a0a3e] px-4 py-6 text-white">
      <div className="mx-auto max-w-md space-y-5 pb-16">
        {/* Title */}
        <div className="text-center">
          <h1 className="bg-gradient-to-r from-yellow-300 via-orange-500 to-red-600 bg-clip-text text-4xl font-black text-transparent drop-shadow-[0_0_20px_rgba(255,90,0,0.6)] sm:text-5xl">
            ⚡ FIST OF FURY ⚡
          </h1>
          <p className="mt-1 text-xs font-bold tracking-widest text-orange-300/80">
            ONLINE FIGHTING ARENA
          </p>
          <button
            onClick={() => {
              const next = !musicOn;
              setMusicOn(next);
              setMusicEnabled(next);
              if (next) startMusic("menu");
            }}
            className="mx-auto mt-2 flex items-center gap-2 rounded-full border border-orange-400/40 bg-black/40 px-4 py-1.5 text-sm font-bold text-orange-200 active:scale-95"
          >
            {musicOn ? "🎵 Music: ON" : "🔇 Music: OFF"}
          </button>
        </div>

        {/* Headphones banner */}
        <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 p-3 text-center shadow-[0_0_25px_rgba(255,140,0,0.5)]">
          <p className="text-lg font-black tracking-wide">🎧 USE HEADPHONES / EARPHONES 🎧</p>
          <p className="text-sm font-semibold text-white/90">For zero voice issues and crystal-clear audio!</p>
        </div>

        {error && (
          <div className="animate-pulse rounded-xl border-2 border-red-500 bg-red-950/80 p-3 text-center text-sm font-bold text-red-200">
            ⛔ {error}
          </div>
        )}

        {/* Name */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Name"
          maxLength={14}
          className="w-full rounded-2xl border-2 border-orange-500 bg-black/70 px-5 py-4 text-2xl font-semibold text-white outline-none placeholder:text-white/40"
        />

        {/* Character color */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-xl font-black">Character Color:</span>
          <label className="relative cursor-pointer rounded-xl border-2 border-orange-500 bg-black/70 p-1.5">
            <span
              className="block h-10 w-20 rounded"
              style={{ background: color }}
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>

        {/* Room code + dice */}
        <div className="flex items-center justify-center gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="ROOM CODE"
            maxLength={6}
            className="flex-1 rounded-2xl border-2 border-orange-500 bg-black/70 px-5 py-4 text-2xl font-black tracking-widest text-white outline-none placeholder:text-white/30"
          />
          <button
            onClick={() => setCode(randomCode())}
            title="Random code"
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-600 text-3xl shadow active:scale-95"
          >
            🎲
          </button>
        </div>

        {/* Voice chat */}
        <label className="flex cursor-pointer items-center justify-center gap-3">
          <input
            type="checkbox"
            checked={voice}
            onChange={(e) => setVoice(e.target.checked)}
            className="h-7 w-7 accent-blue-500"
          />
          <span className="text-xl font-bold">🎙️ Enable Voice Chat</span>
        </label>

        {/* Rounds (best-of) */}
        <div>
          <h2 className="mb-2 text-center text-xl font-black text-orange-400">Rounds (Best of):</h2>
          <div className="flex justify-center gap-3">
            {[1, 3, 5].map((r) => (
              <button
                key={r}
                onClick={() => setRounds(r)}
                className={`flex-1 rounded-xl border-2 py-3 text-center transition ${
                  rounds === r
                    ? "border-orange-400 bg-orange-500/20 scale-105"
                    : "border-white/10 bg-black/40"
                }`}
              >
                <div className="text-2xl font-black">{r}</div>
                <div className="text-[10px] font-bold text-white/60">
                  {r === 1 ? "Single" : `First to ${Math.floor(r / 2) + 1}`}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Character roster */}
        <div>
          <h2 className="mb-2 text-center text-xl font-black text-orange-400">
            Select Fighter <span className="text-sm text-white/50">({FIGHTERS.length})</span>
          </h2>
          <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
            {FIGHTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFighterId(f.id)}
                className={`flex flex-col items-center rounded-xl border-2 p-2 transition ${
                  fighterId === f.id
                    ? "border-orange-400 bg-orange-500/20 scale-105"
                    : "border-white/10 bg-black/40"
                }`}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl"
                  style={{ background: `radial-gradient(circle at 30% 25%, ${f.color}, ${f.color}66)` }}
                >
                  {f.emoji}
                </div>
                <span className="mt-1 text-[10px] font-black">{f.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-white/60">
            {(() => {
              const f = FIGHTERS.find((x) => x.id === fighterId)!;
              return `${f.title} • ${f.style} • Special: ${f.special}`;
            })()}
          </p>
        </div>

        {/* Map select */}
        <div>
          <h2 className="mb-2 text-center text-xl font-black text-orange-500">
            Select Map <span className="text-sm text-white/50">({MAPS.length})</span>
          </h2>
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
            {MAPS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMapId(m.id)}
                className={`relative overflow-hidden rounded-xl border-2 p-3 text-center transition ${
                  mapId === m.id ? "border-orange-400 scale-105" : "border-white/10"
                }`}
                style={{ background: `linear-gradient(135deg, ${m.sky[0]}, ${m.sky[1]})` }}
              >
                <div className="text-2xl">{m.emoji}</div>
                <div className="mt-1 text-[10px] font-black">{m.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 pt-2">
          <button
            disabled={connecting}
            onClick={() => onCreate(cfg(), code || randomCode())}
            className="w-full rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 py-4 text-xl font-black shadow-lg active:scale-95 disabled:opacity-50"
          >
            🛡️ CREATE ROOM
          </button>
          <button
            disabled={connecting || !code}
            onClick={() => onJoin(cfg(), code)}
            className="w-full rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 py-4 text-xl font-black shadow-lg active:scale-95 disabled:opacity-40"
          >
            ⚔️ JOIN ROOM
          </button>
          <button
            onClick={() => onSolo(cfg())}
            className="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 py-4 text-xl font-black shadow-lg active:scale-95"
          >
            🤖 PLAY vs CPU
          </button>
        </div>

        <p className="pt-2 text-center text-xs text-white/40">
          Share your ROOM CODE with a friend to fight online. One creates, one joins —
          rooms hold exactly 2 players.
        </p>
      </div>
    </div>
  );
}
