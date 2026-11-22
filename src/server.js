require("dotenv").config();
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const helmet = require("helmet");
const { Server } = require("socket.io");
const game = require("./game");
const store = require("./store");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: false, maxHttpBufferSize: 250000 });
const publicDir = path.join(__dirname, "..", "public");

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:"]
    }
  }
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDir));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "darwinci" });
});

app.get("/api/config", (_request, response) => {
  response.json({
    characters: game.CHARACTERS,
    defaultSettings: require("./game").sanitizeSettings()
  });
});

app.post("/api/lobbies", async (request, response) => {
  try {
    const room = game.newRoom(request.body?.name, request.body?.character);
    if (!room.players[0].name) return response.status(400).json({ error: "Bitte einen Namen eingeben." });
    while (await store.getRoom(room.code)) room.code = randomCode();
    await store.saveRoom(room);
    response.status(201).json({ code: room.code, playerId: room.hostId });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/lobbies/:code/join", async (request, response) => {
  const code = String(request.params.code).trim().toUpperCase();
  try {
    let playerId;
    await store.withRoom(code, async (room) => {
      playerId = game.addPlayer(room, request.body?.name, request.body?.character);
    });
    response.status(201).json({ code, playerId });
  } catch (error) {
    const status = error.message === "Lobby nicht gefunden." ? 404 : 400;
    response.status(status).json({ error: error.message });
  }
});

app.get("*", (_request, response) => response.sendFile(path.join(publicDir, "index.html")));

const activeSockets = new Map();
const tickingRooms = new Set();

function roomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

async function mutateAndBroadcast(code, action) {
  const room = await store.withRoom(code, action);
  broadcastRoom(room);
  return room;
}

function broadcastRoom(room) {
  for (const socket of io.sockets.sockets.values()) {
    const data = activeSockets.get(socket.id);
    if (data?.code !== room.code) continue;
    try {
      socket.emit("room:state", game.publicState(room, data.playerId));
    } catch {
      socket.emit("session:invalid");
      socket.disconnect();
    }
  }
}

function socketAction(socket, callback) {
  return async (payload = {}) => {
    const session = activeSockets.get(socket.id);
    if (!session) return socket.emit("error:message", "Bitte zuerst einer Lobby beitreten.");
    try {
      await callback(session, payload);
    } catch (error) {
      socket.emit("error:message", error.message || "Die Aktion konnte nicht ausgeführt werden.");
    }
  };
}

function requireHost(room, playerId) {
  if (room.hostId !== playerId) throw new Error("Nur der Host kann das ändern.");
}

io.on("connection", (socket) => {
  socket.on("session:join", async ({ code, playerId } = {}, done) => {
    try {
      const normalizedCode = roomCode(code);
      const room = await store.withRoom(normalizedCode, async (state) => {
        const player = state.players.find((entry) => entry.id === playerId);
        if (!player) throw new Error("Sitzung nicht gefunden.");
        player.connected = true;
      });
      socket.join(normalizedCode);
      activeSockets.set(socket.id, { code: normalizedCode, playerId });
      socket.emit("room:state", game.publicState(room, playerId));
      broadcastRoom(room);
      done?.({ ok: true });
    } catch (error) {
      done?.({ error: error.message });
    }
  });

  socket.on("lobby:update-settings", socketAction(socket, async (session, settings) => {
    await mutateAndBroadcast(session.code, async (room) => {
      requireHost(room, session.playerId);
      if (room.phase !== "lobby") throw new Error("Einstellungen können nur in der Lobby geändert werden.");
      room.settings = game.sanitizeSettings(settings, room.settings);
    });
  }));

  socket.on("lobby:update-profile", socketAction(socket, async (session, profile) => {
    await mutateAndBroadcast(session.code, async (room) => {
      if (room.phase !== "lobby") throw new Error("Der Charakter kann während des Spiels nicht geändert werden.");
      const player = room.players.find((item) => item.id === session.playerId);
      player.character = game.CHARACTERS.some((item) => item.id === profile.character)
        ? profile.character : player.character;
    });
  }));

  socket.on("lobby:leave", socketAction(socket, async (session) => {
    const room = await store.withRoom(session.code, async (state) => {
      game.leaveRoom(state, session.playerId);
    });
    activeSockets.delete(socket.id);
    if (room.players.length === 0) {
      await store.deleteRoom(room.code);
    } else {
      broadcastRoom(room);
    }
    socket.emit("lobby:left", { code: room.code });
    socket.leave(room.code);
  }));

  socket.on("game:start", socketAction(socket, async (session) => {
    await mutateAndBroadcast(session.code, async (room) => {
      requireHost(room, session.playerId);
      game.startGame(room);
    });
  }));

  socket.on("drawing:mark", socketAction(socket, async (session, mark) => {
    await mutateAndBroadcast(session.code, async (room) => {
      game.addDrawingItem(room, session.playerId, mark);
    });
  }));

  socket.on("drawing:clear", socketAction(socket, async (session, payload) => {
    await mutateAndBroadcast(session.code, async (room) => {
      game.clearDrawing(room, session.playerId, payload.roundId);
    });
  }));

  socket.on("drawing:undo", socketAction(socket, async (session, payload) => {
    await mutateAndBroadcast(session.code, async (room) => {
      game.undoDrawing(room, session.playerId, payload.roundId);
    });
  }));

  socket.on("drawing:finish", socketAction(socket, async (session) => {
    await mutateAndBroadcast(session.code, async (room) => {
      if (room.game.drawerId !== session.playerId) throw new Error("Nur der Zeichner kann abgeben.");
      game.finishDrawing(room);
    });
  }));

  socket.on("guess:submit", socketAction(socket, async (session, { guess }) => {
    await mutateAndBroadcast(session.code, async (room) => {
      game.submitGuess(room, session.playerId, guess);
    });
  }));

  socket.on("vote:cast", socketAction(socket, async (session, { targetId }) => {
    await mutateAndBroadcast(session.code, async (room) => {
      game.castVote(room, session.playerId, targetId);
      const active = room.players.filter((p) => p.alive && !p.sittingOut).length;
      if (Object.keys(room.game.votes).length >= active) game.resolveVoting(room);
    });
  }));

  socket.on("game:next", socketAction(socket, async (session) => {
    await mutateAndBroadcast(session.code, async (room) => {
      requireHost(room, session.playerId);
      if (room.phase !== "result") throw new Error("Die nächste Runde ist noch nicht bereit.");
      room.game.deadline = null;
      game.startRound(room);
    });
  }));

  socket.on("game:reset", socketAction(socket, async (session) => {
    await mutateAndBroadcast(session.code, async (room) => {
      requireHost(room, session.playerId);
      game.resetToLobby(room);
    });
  }));

  socket.on("disconnect", async () => {
    const session = activeSockets.get(socket.id);
    activeSockets.delete(socket.id);
    if (!session) return;
    const anotherConnection = [...activeSockets.values()].some(
      (entry) => entry.code === session.code && entry.playerId === session.playerId
    );
    if (anotherConnection) return;
    try {
      const room = await store.withRoom(session.code, async (state) => {
        const player = state.players.find((item) => item.id === session.playerId);
        if (player) player.connected = false;
      });
      if (room.phase === "lobby" && room.players.every((player) => !player.connected)) {
        await store.deleteRoom(room.code);
      } else {
        broadcastRoom(room);
      }
    } catch (error) {
      console.error("Fehler beim Abmelden:", error.message);
    }
  });
});

setInterval(async () => {
  if (tickingRooms.size) return;
  for (const room of await store.listRooms()) {
    if (
      room.phase === "lobby" &&
      room.players.every((player) => !player.connected) &&
      Date.now() - room.updatedAt > 60_000
    ) {
      await store.deleteRoom(room.code);
      continue;
    }
    if (!["drawing", "guessing", "voting", "result"].includes(room.phase)) continue;
    tickingRooms.add(room.code);
    try {
      let changed = false;
      const updated = await store.withRoom(room.code, async (current) => {
        changed = game.advanceTimers(current);
      });
      if (changed) broadcastRoom(updated);
      if (updated.phase === "lobby") tickingRooms.delete(room.code);
    } catch (error) {
      console.error(`Timerfehler in ${room.code}:`, error.message);
    } finally {
      tickingRooms.delete(room.code);
    }
  }
}, 1000).unref();

const port = Number(process.env.PORT) || 3000;
store.initStore()
  .then(() => server.listen(port, () => console.log(`Darwinci läuft auf Port ${port}`)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

async function shutdown() {
  server.close();
  await store.closeStore();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
