import { useEffect, useRef, useState } from "react";
import Lobby, { LobbyConfig } from "./components/Lobby";
import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import ChatPanel from "./components/ChatPanel";
import { useMultiplayer } from "./net/useMultiplayer";
import { unlockAudio } from "./game/audio";

type Phase = "lobby" | "room" | "fight" | "solo";

export default function App() {
  const mp = useMultiplayer();
  const [phase, setPhase] = useState<Phase>("lobby");
  const [cfg, setCfg] = useState<LobbyConfig | null>(null);
  const voiceStartedRef = useRef(false);

  const { state } = mp;

  // When the server starts the match, transition to fight
  useEffect(() => {
    if (state.matchStarted && phase === "room") {
      setPhase("fight");
      // begin voice call: host is the caller
      if (cfg?.voice && !voiceStartedRef.current) {
        voiceStartedRef.current = true;
        mp.startVoice(state.isHost);
      }
    }
  }, [state.matchStarted, phase, cfg, state.isHost, mp]);

  // joined a room successfully
  useEffect(() => {
    if (state.roomCode && phase === "lobby") {
      setPhase("room");
    }
  }, [state.roomCode, phase]);

  const handleCreate = (c: LobbyConfig, code: string) => {
    unlockAudio();
    setCfg(c);
    mp.createRoom(c.name, c.fighterId, c.color, c.mapId, code, c.rounds);
  };
  const handleJoin = (c: LobbyConfig, code: string) => {
    unlockAudio();
    setCfg(c);
    mp.joinRoom(c.name, c.fighterId, c.color, code);
  };
  const handleSolo = (c: LobbyConfig) => {
    unlockAudio();
    setCfg(c);
    setPhase("solo");
  };

  const exitToLobby = () => {
    mp.leaveRoom();
    voiceStartedRef.current = false;
    setPhase("lobby");
  };

  // ---- LOBBY ----
  if (phase === "lobby") {
    return (
      <Lobby
        onCreate={handleCreate}
        onJoin={handleJoin}
        onSolo={handleSolo}
        error={state.error}
        connecting={false}
      />
    );
  }

  // ---- SOLO (vs CPU) ----
  if (phase === "solo" && cfg) {
    // pick a random CPU opponent fighter different from player
    const cpuId = pickCpu(cfg.fighterId);
    return (
      <GameScreen
        mapId={cfg.mapId}
        p1Id={cfg.fighterId}
        p2Id={cpuId}
        p1Color={cfg.color}
        p2Color="#3bd0ff"
        p1Name={cfg.name}
        p2Name="CPU"
        online={false}
        rounds={cfg.rounds}
        onExit={() => setPhase("lobby")}
      />
    );
  }

  // ---- WAITING ROOM ----
  if (phase === "room" && cfg) {
    return (
      <>
        <WaitingRoom
          code={state.roomCode || ""}
          players={state.players}
          selfId={state.selfId}
          mapId={state.mapId}
          countdown={state.countdown}
          onReady={mp.setReady}
          onLeave={exitToLobby}
        />
        <ChatPanel
          chat={state.chat}
          selfId={state.selfId}
          onSend={mp.sendChat}
          voiceActive={state.voiceActive}
          onToggleVoice={() => mp.startVoice(state.isHost)}
          voiceEnabled={cfg.voice}
        />
      </>
    );
  }

  // ---- ONLINE FIGHT ----
  if (phase === "fight" && cfg) {
    const me = state.players.find((p) => p.id === state.selfId);
    const opp = state.players.find((p) => p.id !== state.selfId);
    return (
      <>
        <GameScreen
          mapId={state.mapId}
          p1Id={me?.fighterId || cfg.fighterId}
          p2Id={opp?.fighterId || "frost"}
          p1Color={me?.color || cfg.color}
          p2Color={opp?.color || "#3bd0ff"}
          p1Name={me?.name || cfg.name}
          p2Name={opp?.name || "Opponent"}
          online
          rounds={state.rounds}
          onSendState={mp.sendState}
          onSendHit={mp.sendHit}
          registerRemoteState={mp.setOnRemoteState}
          registerRemoteHit={mp.setOnRemoteHit}
          onExit={exitToLobby}
        />
        <ChatPanel
          chat={state.chat}
          selfId={state.selfId}
          onSend={mp.sendChat}
          voiceActive={state.voiceActive}
          onToggleVoice={() => mp.startVoice(state.isHost)}
          voiceEnabled={cfg.voice}
        />
      </>
    );
  }

  return null;
}

function pickCpu(playerId: string) {
  const ids = ["blaze", "frost", "volt", "venom", "titan", "nova", "ronin", "magma"].filter(
    (i) => i !== playerId
  );
  return ids[Math.floor(Math.random() * ids.length)];
}
