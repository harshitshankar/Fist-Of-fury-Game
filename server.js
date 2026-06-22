/**
 * FIST OF FURY — Game Server
 * --------------------------------------------------------------
 * A single Node.js web service that:
 *   1. Serves the built React front-end (the `dist/` folder).
 *   2. Serves privacy.html.
 *   3. Runs a Socket.IO server for real-time multiplayer:
 *        - Create / join rooms by 5-6 char code
 *        - Rooms hold EXACTLY 2 players ("room full" rejection)
 *        - Ready-up + synchronized countdown + match start
 *        - State sync, hit events, and text chat relay
 *        - WebRTC signaling relay for peer-to-peer VOICE chat
 *
 * Deploy on Render as ONE web service:
 *   Build Command:  npm install && npm run build
 *   Start Command:  node server.js
 * --------------------------------------------------------------
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, copyFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3001;

// ---------- Static hosting ----------
const distPath = path.join(__dirname, "dist");
const indexFile = path.join(distPath, "index.html");

// Warn loudly if the front-end hasn't been built yet (common cause of a blank page).
if (!existsSync(indexFile)) {
  console.warn(
    "\n⚠️  dist/index.html not found. Run `npm run build` first, then `node server.js`.\n"
  );
}

// Ensure privacy.html is also available inside dist/ (for static hosts / PWABuilder).
try {
  const privSrc = path.join(__dirname, "privacy.html");
  const privDest = path.join(distPath, "privacy.html");
  if (existsSync(privSrc) && existsSync(distPath) && !existsSync(privDest)) {
    copyFileSync(privSrc, privDest);
  }
} catch {
  /* non-fatal */
}

// Ensure about.html is also available inside dist/ (for static hosts / PWABuilder).
try {
  const aboutSrc = path.join(__dirname, "about.html");
  const aboutDest = path.join(distPath, "about.html");
  if (existsSync(aboutSrc) && existsSync(distPath) && !existsSync(aboutDest)) {
    copyFileSync(aboutSrc, aboutDest);
  }
} catch {
  /* non-fatal */
}

app.use(express.static(distPath));

// privacy policy (required for Play Store / app stores)
app.get("/privacy.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "privacy.html"));
});

// about page (rich textual content for AdSense approval + SEO)
app.get(["/about", "/about.html"], (_req, res) => {
  res.sendFile(path.join(__dirname, "about.html"));
});

app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// SPA fallback -> index.html
// NOTE: Express 5 no longer accepts a bare "*" path string, so we use a
// catch-all middleware instead (works on Express 4 AND 5).
app.use((req, res) => {
  if (!existsSync(indexFile)) {
    res
      .status(200)
      .send(
        "<h1>Fist of Fury</h1><p>The game hasn't been built yet.<br>Run <code>npm run build</code> then restart <code>node server.js</code>.</p>"
      );
    return;
  }
  res.sendFile(indexFile);
});

// ---------- Room state ----------
/**
 * rooms: Map<code, {
 *   code, mapId, hostId,
 *   players: Map<socketId, {id,name,fighterId,color,ready,isHost}>,
 *   started: bool
 * }>
 */
const rooms = new Map();
const MAX_PLAYERS = 2;

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    fighterId: p.fighterId,
    color: p.color,
    ready: p.ready,
    isHost: p.isHost,
  }));
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", {
    players: publicPlayers(room),
    mapId: room.mapId,
    rounds: room.rounds,
  });
}

function tryStart(room) {
  if (room.players.size === MAX_PLAYERS && [...room.players.values()].every((p) => p.ready) && !room.started) {
    room.started = true;
    let n = 3;
    io.to(room.code).emit("room:countdown", n);
    const iv = setInterval(() => {
      n -= 1;
      io.to(room.code).emit("room:countdown", n);
      if (n <= 0) {
        clearInterval(iv);
        // reset server-authoritative round state for the new match
        room.score = {};
        [...room.players.keys()].forEach((id) => (room.score[id] = 0));
        room.round = 1;
        room.matchDone = false;
        room.resolving = false;
        io.to(room.code).emit("match:start", { mapId: room.mapId, rounds: room.rounds });
      }
    }, 1000);
  }
}

io.on("connection", (socket) => {
  let currentRoom = null;

  const leave = () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.players.delete(socket.id);
      socket.leave(currentRoom);
      socket.to(currentRoom).emit("player:left");
      if (room.players.size === 0) {
        rooms.delete(currentRoom);
      } else {
        // promote remaining player to host, reset ready & started
        const remaining = [...room.players.values()][0];
        if (remaining) remaining.isHost = true;
        room.hostId = remaining ? remaining.id : null;
        room.started = false;
        room.players.forEach((p) => (p.ready = false));
        broadcastRoom(room);
      }
      currentRoom = null;
    }
  };

  // ---- CREATE ----
  socket.on("room:create", ({ name, fighterId, color, mapId, code, rounds }) => {
    let roomCode = (code || genCode()).toUpperCase();
    // if exists, make a unique one
    while (rooms.has(roomCode)) roomCode = genCode();

    const room = {
      code: roomCode,
      mapId: mapId || "dojo",
      rounds: [1, 3, 5].includes(rounds) ? rounds : 3,
      hostId: socket.id,
      players: new Map(),
      started: false,
    };
    room.players.set(socket.id, {
      id: socket.id,
      name: name || "Host",
      fighterId: fighterId || "blaze",
      color: color || "#ff5b3b",
      ready: false,
      isHost: true,
    });
    rooms.set(roomCode, room);
    currentRoom = roomCode;
    socket.join(roomCode);
    socket.emit("room:joined", {
      code: roomCode,
      isHost: true,
      players: publicPlayers(room),
      mapId: room.mapId,
      rounds: room.rounds,
    });
  });

  // ---- JOIN ----
  socket.on("room:join", ({ name, fighterId, color, code }) => {
    const roomCode = (code || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("room:notfound");
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      // ROOM ALREADY FULL — must wait until someone leaves
      socket.emit("room:full");
      return;
    }
    room.players.set(socket.id, {
      id: socket.id,
      name: name || "Guest",
      fighterId: fighterId || "frost",
      color: color || "#3bd0ff",
      ready: false,
      isHost: false,
    });
    currentRoom = roomCode;
    socket.join(roomCode);
    socket.emit("room:joined", {
      code: roomCode,
      isHost: false,
      players: publicPlayers(room),
      mapId: room.mapId,
      rounds: room.rounds,
    });
    broadcastRoom(room);
  });

  // ---- LOADOUT changes in lobby ----
  socket.on("player:loadout", ({ fighterId, color, mapId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) {
      if (fighterId) p.fighterId = fighterId;
      if (color) p.color = color;
    }
    if (mapId && p && p.isHost) room.mapId = mapId;
    broadcastRoom(room);
  });

  // ---- READY ----
  socket.on("player:ready", (ready) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) p.ready = !!ready;
    broadcastRoom(room);
    tryStart(room);
  });

  // ---- Gameplay relay ----
  socket.on("p:state", (st) => {
    if (currentRoom) socket.to(currentRoom).emit("opp:state", st);
  });
  socket.on("p:hit", (d) => {
    if (currentRoom) socket.to(currentRoom).emit("opp:hit", d);
  });

  // ---- Server-authoritative ROUND result ----
  // A client reports a KO ("loserId" = the socket id of the player who lost).
  // The server accepts only the FIRST report per round, updates the score, and
  // broadcasts the identical result to BOTH players so they stay perfectly synced.
  socket.on("round:ko", ({ loserId, round }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.score === undefined) {
      room.score = {};
      room.round = 1;
      room.matchDone = false;
    }
    // ignore stale/duplicate reports for a round already resolved.
    // NOTE: we intentionally do NOT reject on round-number mismatch — the
    // `resolving` lock already prevents double-counting, and being lenient on
    // the round number avoids any chance of a stuck/desynced match if the two
    // clients' local counters drift slightly.
    if (room.matchDone) return;
    if (room.resolving) return;
    room.resolving = true;

    const ids = [...room.players.keys()];
    const winnerId = ids.find((id) => id !== loserId) || ids[0];
    room.score[winnerId] = (room.score[winnerId] || 0) + 1;

    const roundsToWin = Math.floor((room.rounds || 3) / 2) + 1;
    const matchOver = room.score[winnerId] >= roundsToWin;

    io.to(currentRoom).emit("round:result", {
      winnerId,
      loserId,
      round: room.round,
      score: room.score,
      matchOver,
      nextRound: room.round + 1,
    });

    if (matchOver) {
      room.matchDone = true;
    } else {
      room.round += 1;
      // allow the next KO report after both clients have reset
      setTimeout(() => { room.resolving = false; }, 2600);
    }
  });

  // ---- Server-coordinated BEAM CLASH (button-smash) ----
  // A client whose beams overlapped reports "clash:detect". The server starts
  // the clash on BOTH clients at once, collects each player's mash power, and
  // after a fixed duration broadcasts the winner so both see the same result.
  socket.on("clash:detect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.clashActive) return;
    room.clashActive = true;
    room.clashMash = {}; // socketId -> mash power
    [...room.players.keys()].forEach((id) => (room.clashMash[id] = 0));

    io.to(currentRoom).emit("clash:start");

    // judge the clash after ~2.5 seconds of mashing
    if (room.clashTimer) clearTimeout(room.clashTimer);
    room.clashTimer = setTimeout(() => {
      const ids = [...room.players.keys()];
      let winnerId = ids[0];
      let best = -1;
      ids.forEach((id) => {
        const v = room.clashMash[id] || 0;
        if (v > best) { best = v; winnerId = id; }
      });
      io.to(currentRoom).emit("clash:result", { winnerId });
      room.clashActive = false;
      room.clashMash = {};
    }, 2500);
  });

  socket.on("clash:mash", (power) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.clashActive || !room.clashMash) return;
    // accumulate mash power (each tap increments; this is fairer than storing max)
    const v = Number(power) || 0;
    room.clashMash[socket.id] = v; // client already accumulates; just take latest
    // relay this player's mash count to their OPPONENT so both clients
    // can move the orb in sync — eliminates the position desync between mobile & web
    socket.to(currentRoom).emit("clash:oppmash", v);
  });

  // ---- Chat ----
  socket.on("chat:send", (text) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.players.get(socket.id);
    const clean = String(text || "").slice(0, 200);
    if (!clean.trim()) return;
    io.to(currentRoom).emit("chat:msg", {
      from: socket.id,
      name: p ? p.name : "?",
      text: clean,
      ts: Date.now(),
    });
  });

  // ---- WebRTC voice signaling relay ----
  socket.on("voice:offer", (offer) => {
    if (currentRoom) socket.to(currentRoom).emit("voice:offer", offer);
  });
  socket.on("voice:answer", (answer) => {
    if (currentRoom) socket.to(currentRoom).emit("voice:answer", answer);
  });
  socket.on("voice:ice", (cand) => {
    if (currentRoom) socket.to(currentRoom).emit("voice:ice", cand);
  });

  socket.on("room:leave", leave);
  socket.on("disconnect", leave);
});

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

httpServer.listen(PORT, () => {
  // If you see this exact line in the Render logs, the NEW server.js is live.
  console.log("🥊 FIST OF FURY server v2 (Express5-safe routing) running on port " + PORT);
});
