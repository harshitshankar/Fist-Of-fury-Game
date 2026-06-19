// Multiplayer + voice chat hook built on Socket.IO and WebRTC.
// Handles: create/join room by code, "room full" rejection, state sync,
// hit events, chat messages, and peer-to-peer voice.

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export interface RoomPlayer {
  id: string;
  name: string;
  fighterId: string;
  color: string;
  ready: boolean;
  isHost: boolean;
}

export interface ChatMsg {
  from: string;
  name: string;
  text: string;
  ts: number;
}

export interface MpState {
  connected: boolean;
  roomCode: string | null;
  players: RoomPlayer[];
  isHost: boolean;
  selfId: string | null;
  error: string | null;
  matchStarted: boolean;
  mapId: string;
  rounds: number;
  countdown: number | null;
  chat: ChatMsg[];
  voiceActive: boolean;
  peerSpeaking: boolean;
}

const SERVER_URL = import.meta.env.DEV ? "http://localhost:3001" : "";

export function useMultiplayer() {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const onRemoteStateRef = useRef<((s: any) => void) | null>(null);
  const onRemoteHitRef = useRef<((d: any) => void) | null>(null);
  const onRoundResultRef = useRef<((d: any) => void) | null>(null);

  const [state, setState] = useState<MpState>({
    connected: false,
    roomCode: null,
    players: [],
    isHost: false,
    selfId: null,
    error: null,
    matchStarted: false,
    mapId: "dojo",
    rounds: 3,
    countdown: null,
    chat: [],
    voiceActive: false,
    peerSpeaking: false,
  });

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const s = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      timeout: 8000,
      reconnectionAttempts: 3,
    });
    socketRef.current = s;

    s.on("connect", () =>
      setState((p) => ({ ...p, connected: true, selfId: s.id || null, error: null }))
    );

    // If we can't reach the multiplayer server, tell the user clearly.
    s.on("connect_error", () =>
      setState((p) => ({
        ...p,
        connected: false,
        error:
          "Can't reach the game server. Online play needs the server running — run `node server.js` locally or deploy to Render. (CPU mode works without a server.)",
      }))
    );
    s.on("disconnect", () =>
      setState((p) => ({ ...p, connected: false }))
    );

    s.on("room:joined", (data: { code: string; isHost: boolean; players: RoomPlayer[]; mapId: string; rounds?: number }) => {
      setState((p) => ({
        ...p,
        roomCode: data.code,
        isHost: data.isHost,
        players: data.players,
        mapId: data.mapId,
        rounds: data.rounds || p.rounds,
        error: null,
      }));
    });

    s.on("room:full", () => {
      setState((p) => ({
        ...p,
        error: "ROOM IS ALREADY FULL — wait until a player leaves or try another code.",
      }));
    });

    s.on("room:notfound", () => {
      setState((p) => ({ ...p, error: "Room not found. Check the code." }));
    });

    s.on("room:update", (data: { players: RoomPlayer[]; mapId: string; rounds?: number }) => {
      setState((p) => ({ ...p, players: data.players, mapId: data.mapId, rounds: data.rounds || p.rounds }));
    });

    s.on("room:countdown", (n: number) => {
      setState((p) => ({ ...p, countdown: n }));
    });

    s.on("match:start", (data: { mapId: string; rounds?: number }) => {
      setState((p) => ({ ...p, matchStarted: true, countdown: null, mapId: data.mapId, rounds: data.rounds || p.rounds }));
    });

    s.on("opp:state", (st: any) => {
      onRemoteStateRef.current?.(st);
    });

    s.on("opp:hit", (d: any) => {
      onRemoteHitRef.current?.(d);
    });

    s.on("round:result", (d: any) => {
      onRoundResultRef.current?.(d);
    });

    s.on("chat:msg", (m: ChatMsg) => {
      setState((p) => ({ ...p, chat: [...p.chat.slice(-40), m] }));
    });

    s.on("player:left", () => {
      setState((p) => ({
        ...p,
        chat: [...p.chat, { from: "sys", name: "System", text: "Opponent left the arena.", ts: Date.now() }],
      }));
    });

    // ---- WebRTC voice signaling ----
    s.on("voice:offer", async (offer: RTCSessionDescriptionInit) => {
      await handleVoiceOffer(offer);
    });
    s.on("voice:answer", async (answer: RTCSessionDescriptionInit) => {
      if (pcRef.current) await pcRef.current.setRemoteDescription(answer);
    });
    s.on("voice:ice", async (cand: RTCIceCandidateInit) => {
      try {
        if (pcRef.current && cand) await pcRef.current.addIceCandidate(cand);
      } catch {}
    });

    return s;
  }, []);

  const createPeer = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit("voice:ice", e.candidate);
    };
    pc.ontrack = (e) => {
      if (!remoteAudioRef.current) {
        const a = document.createElement("audio");
        a.autoplay = true;
        remoteAudioRef.current = a;
        document.body.appendChild(a);
      }
      remoteAudioRef.current.srcObject = e.streams[0];
      setState((p) => ({ ...p, voiceActive: true }));
    };
    pcRef.current = pc;
    return pc;
  }, []);

  const startVoice = useCallback(async (asCaller: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const pc = pcRef.current || createPeer();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      if (asCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("voice:offer", offer);
      }
      setState((p) => ({ ...p, voiceActive: true }));
    } catch (e) {
      setState((p) => ({ ...p, chat: [...p.chat, { from: "sys", name: "System", text: "Mic access denied — voice chat off.", ts: Date.now() }] }));
    }
  }, [createPeer]);

  const handleVoiceOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    const pc = pcRef.current || createPeer();
    if (!localStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      } catch {}
    }
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit("voice:answer", answer);
  }, [createPeer]);

  const createRoom = useCallback(
    (name: string, fighterId: string, color: string, mapId: string, code: string, rounds: number) => {
      const s = ensureSocket();
      s.emit("room:create", { name, fighterId, color, mapId, code, rounds });
    },
    [ensureSocket]
  );

  const joinRoom = useCallback(
    (name: string, fighterId: string, color: string, code: string) => {
      const s = ensureSocket();
      setState((p) => ({ ...p, error: null }));
      s.emit("room:join", { name, fighterId, color, code });
    },
    [ensureSocket]
  );

  const setReady = useCallback((ready: boolean) => {
    socketRef.current?.emit("player:ready", ready);
  }, []);

  const updateLoadout = useCallback((fighterId: string, color: string, mapId?: string) => {
    socketRef.current?.emit("player:loadout", { fighterId, color, mapId });
  }, []);

  const sendState = useCallback((st: any) => {
    socketRef.current?.emit("p:state", st);
  }, []);

  const sendHit = useCallback((d: any) => {
    socketRef.current?.emit("p:hit", d);
  }, []);

  const reportKO = useCallback((loserId: string, round: number) => {
    socketRef.current?.emit("round:ko", { loserId, round });
  }, []);

  const sendChat = useCallback((text: string) => {
    socketRef.current?.emit("chat:send", text);
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("room:leave");
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setState((p) => ({
      ...p,
      roomCode: null,
      players: [],
      matchStarted: false,
      countdown: null,
      chat: [],
      error: null,
      voiceActive: false,
    }));
  }, []);

  const setOnRemoteState = useCallback((fn: (s: any) => void) => {
    onRemoteStateRef.current = fn;
  }, []);
  const setOnRemoteHit = useCallback((fn: (d: any) => void) => {
    onRemoteHitRef.current = fn;
  }, []);
  const setOnRoundResult = useCallback((fn: (d: any) => void) => {
    onRoundResultRef.current = fn;
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    state,
    createRoom,
    joinRoom,
    setReady,
    updateLoadout,
    sendState,
    sendHit,
    reportKO,
    sendChat,
    leaveRoom,
    startVoice,
    setOnRemoteState,
    setOnRemoteHit,
    setOnRoundResult,
    clearError: () => setState((p) => ({ ...p, error: null })),
  };
}
