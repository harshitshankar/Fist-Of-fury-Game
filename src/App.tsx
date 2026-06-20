import { useEffect, useRef, useState } from "react";
import Lobby, { LobbyConfig } from "./components/Lobby";
import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import ChatPanel from "./components/ChatPanel";
import { useMultiplayer } from "./net/useMultiplayer";
import { unlockAudio } from "./game/audio";
import { FIGHTERS } from "./game/characters";

// Import the AdMob SDK components
import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';

type Phase = "lobby" | "room" | "fight" | "solo";

export default function App() {
  const mp = useMultiplayer();
  const [phase, setPhase] = useState<Phase>("lobby");
  const [cfg, setCfg] = useState<LobbyConfig | null>(null);
  const voiceStartedRef = useRef(false);

  // Track if AdMob is fully initialized
  const [isAdMobReady, setIsAdMobReady] = useState(false);

  const { state } = mp;

  // 1. Safe Initialization of AdMob and Privacy Framework at Startup
  useEffect(() => {
    const initAdMobWithConsent = async () => {
      try {
        console.log("ADS: Checking User Privacy Consent via UMP SDK...");
        
        try {
          const consentInfo = await AdMob.requestConsentInfo();
          if (consentInfo.isConsentFormAvailable && consentInfo.status === 'REQUIRED') {
            console.log("ADS: Consent required. Presenting form...");
            await AdMob.showConsentForm();
          } else {
            console.log("ADS: Consent check skipped (Not required or already gathered).");
          }
        } catch (consentError) {
          console.warn("ADS WARNING: Privacy form execution failed or bypassed:", consentError);
        }

        console.log("ADS: Initializing AdMob engine...");
        await AdMob.initialize();
        console.log("ADS: AdMob Engine initialized successfully.");
        
        await preloadInterstitialAd();

        // Safe to unlock banner requests now
        setIsAdMobReady(true);
      } catch (error) {
        console.error("ADS CRITICAL INIT ERROR:", error);
        setIsAdMobReady(true);
      }
    };
    
    initAdMobWithConsent();
  }, []);

  // 2. Control Banner Ads safely using State Tracking Synchronization
  useEffect(() => {
    if (!isAdMobReady) return;

    // Show banner in BOTH Lobby and Waiting Room menus. 
    // It will only hide when entering gameplay phases ('fight' or 'solo').
    if (phase === "lobby" || phase === "room") {
      showLobbyBanner();
    } else {
      hideActiveBanner();
    }
  }, [phase, isAdMobReady]);

  // --- AdMob Helper Functions ---
  
  const showLobbyBanner = async () => {
    try {
      console.log("ADS: Requesting Banner Display");
      await AdMob.showBanner({
        adId: 'ca-app-pub-3940256099942544/6300978111', // Safe Test Banner ID
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
      });
    } catch (err) {
      console.error("ADS ERROR (showBanner):", err);
    }
  };

  const hideActiveBanner = async () => {
    try {
      await AdMob.hideBanner();
    } catch (err) {
      console.error("ADS ERROR (hideBanner):", err);
    }
  };

  const preloadInterstitialAd = async () => {
    try {
      console.log("ADS: Preloading Interstitial Ad layout data...");
      await AdMob.prepareInterstitial({
        adId: 'ca-app-pub-3940256099942544/1033173712', // Safe Test Interstitial ID
      });
      console.log("ADS: Interstitial Ad cached and ready.");
    } catch (err) {
      console.error("ADS ERROR (prepareInterstitial):", err);
    }
  };

  const showInterstitialAd = async () => {
    try {
      console.log("ADS: Attempting to present Interstitial Ad...");
      await AdMob.showInterstitial();
      console.log("ADS: Interstitial Ad displayed successfully.");
      preloadInterstitialAd();
    } catch (err) {
      console.error("ADS ERROR (showInterstitial):", err);
      preloadInterstitialAd();
    }
  };

  const exitToLobby = async () => {
    mp.leaveRoom();
    voiceStartedRef.current = false;
    
    // Show full-screen ad
    await showInterstitialAd();
    
    // Return view state directly back to main lobby
    setPhase("lobby");

    // FIXED: Give the native interstitial overlay view window 300ms to clear out, 
    // then force-redraw the banner ad back to life at the bottom of the lobby screen.
    setTimeout(() => {
      if (isAdMobReady) {
        showLobbyBanner();
      }
    }, 300);
  };

  // When the server starts the match, transition to fight
  useEffect(() => {
    if (state.matchStarted && phase === "room") {
      setPhase("fight");
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
        onExit={exitToLobby} 
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
          selfId={state.selfId}
          oppId={opp?.id || null}
          onSendState={mp.sendState}
          onSendHit={mp.sendHit}
          onReportKO={mp.reportKO}
          registerRemoteState={mp.setOnRemoteState}
          registerRemoteHit={mp.setOnRemoteHit}
          registerRoundResult={mp.setOnRoundResult}
          onClashDetect={mp.clashDetect}
          onClashMash={mp.clashMash}
          registerClashStart={mp.setOnClashStart}
          registerClashResult={mp.setOnClashResult}
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
  const ids = FIGHTERS.map((f) => f.id).filter((i) => i !== playerId);
  return ids[Math.floor(Math.random() * ids.length)];
}