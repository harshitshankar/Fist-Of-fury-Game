import { RoomPlayer } from "../net/useMultiplayer";
import { getFighter } from "../game/characters";
import { getMap } from "../game/maps";

interface Props {
  code: string;
  players: RoomPlayer[];
  selfId: string | null;
  mapId: string;
  countdown: number | null;
  onReady: (r: boolean) => void;
  onLeave: () => void;
}

export default function WaitingRoom({
  code,
  players,
  selfId,
  mapId,
  countdown,
  onReady,
  onLeave,
}: Props) {
  const me = players.find((p) => p.id === selfId);
  const opp = players.find((p) => p.id !== selfId);
  const map = getMap(mapId);
  const bothReady = players.length === 2 && players.every((p) => p.ready);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-[#0a0a2e] via-[#1a1040] to-[#2a0a3e] px-4 py-8 text-white">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-sm font-bold tracking-widest text-orange-300">ROOM CODE</p>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="rounded-xl border-2 border-orange-500 bg-black/60 px-6 py-2 text-4xl font-black tracking-[0.3em] text-orange-400">
              {code}
            </span>
            <button
              onClick={() => navigator.clipboard?.writeText(code)}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold"
            >
              📋
            </button>
          </div>
          <p className="mt-2 text-xs text-white/60">Share this code with a friend to fight!</p>
        </div>

        <div
          className="rounded-2xl border border-white/10 p-4 text-center"
          style={{ background: `linear-gradient(135deg, ${map.sky[0]}, ${map.sky[1]})` }}
        >
          <span className="text-3xl">{map.emoji}</span>
          <p className="font-black">{map.name}</p>
          <p className="text-xs text-white/70">{map.mood}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SlotCard player={me} label="YOU" />
          <SlotCard player={opp} label="OPPONENT" waiting />
        </div>

        {countdown !== null ? (
          <div className="text-center text-6xl font-black text-yellow-300 animate-ping">
            {countdown > 0 ? countdown : "GO!"}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => onReady(!me?.ready)}
              disabled={players.length < 2}
              className={`w-full rounded-2xl py-4 text-xl font-black shadow-lg active:scale-95 disabled:opacity-40 ${
                me?.ready
                  ? "bg-gradient-to-r from-yellow-500 to-orange-500"
                  : "bg-gradient-to-r from-green-500 to-emerald-600"
              }`}
            >
              {players.length < 2
                ? "⏳ WAITING FOR OPPONENT…"
                : me?.ready
                ? "✓ READY! (tap to cancel)"
                : "I'M READY"}
            </button>
            {bothReady && (
              <p className="text-center text-sm font-bold text-green-400 animate-pulse">
                Both fighters ready — match starting…
              </p>
            )}
            <button
              onClick={onLeave}
              className="w-full rounded-2xl bg-slate-700 py-3 font-bold active:scale-95"
            >
              ⬅ LEAVE ROOM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlotCard({
  player,
  label,
  waiting,
}: {
  player?: RoomPlayer;
  label: string;
  waiting?: boolean;
}) {
  if (!player) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-black/30">
        <div className="text-4xl opacity-40">{waiting ? "👤" : "?"}</div>
        <p className="mt-2 text-xs font-bold text-white/40">
          {waiting ? "Waiting…" : "Empty"}
        </p>
      </div>
    );
  }
  const f = getFighter(player.fighterId);
  return (
    <div
      className={`flex h-40 flex-col items-center justify-center rounded-2xl border-2 ${
        player.ready ? "border-green-400 bg-green-500/10" : "border-white/20 bg-black/40"
      }`}
    >
      <p className="text-[10px] font-black tracking-widest text-orange-300">{label}</p>
      <div
        className="my-1 flex h-16 w-16 items-center justify-center rounded-xl text-3xl"
        style={{ background: `radial-gradient(circle at 30% 25%, ${player.color}, ${player.color}66)` }}
      >
        {f.emoji}
      </div>
      <p className="text-sm font-black">{player.name}</p>
      <p className="text-[10px] text-white/60">{f.name}</p>
      <p className={`mt-1 text-xs font-bold ${player.ready ? "text-green-400" : "text-white/40"}`}>
        {player.ready ? "✓ READY" : "not ready"}
      </p>
    </div>
  );
}
