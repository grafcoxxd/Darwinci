const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");

const port = 3299;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Testserver wurde nicht bereit.");
}

function waitForState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("room:state", listener);
      reject(new Error("Erwarteter Spielzustand traf nicht ein."));
    }, 5000);
    const listener = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off("room:state", listener);
      resolve(state);
    };
    socket.on("room:state", listener);
  });
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  assert.equal(response.ok, true, result.error);
  return result;
}

async function connectPlayer(code, playerId) {
  const socket = io(baseUrl, { transports: ["websocket"], forceNew: true });
  await new Promise((resolve, reject) => {
    socket.once("connect_error", reject);
    socket.once("connect", resolve);
  });
  socket.on("error:message", (message) => {
    throw new Error(message);
  });
  const statePromise = waitForState(socket, (state) => state.code === code);
  socket.emit("session:join", { code, playerId });
  return { socket, state: await statePromise, playerId };
}

test("four clients complete a full drawing, guessing and voting round", async () => {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test", DATABASE_URL: "" },
    stdio: "ignore"
  });
  const players = [];
  try {
    await waitForServer(child);
    const host = await post("/api/lobbies", { name: "Alice", character: "fox" });
    const identities = [
      host,
      await post(`/api/lobbies/${host.code}/join`, { name: "Bob", character: "frog" }),
      await post(`/api/lobbies/${host.code}/join`, { name: "Cara", character: "cat" }),
      await post(`/api/lobbies/${host.code}/join`, { name: "Dino", character: "panda" })
    ];

    for (const identity of identities) {
      players.push(await connectPlayer(host.code, identity.playerId));
    }
    assert.equal(players[0].state.players.length, 4);

    const drawingStates = players.map((player) => waitForState(player.socket, (state) => state.phase === "drawing"));
    players[0].socket.emit("game:start");
    const drawing = await Promise.all(drawingStates);
    const drawerIndex = players.findIndex((player) => player.playerId === drawing[0].drawerId);
    assert.notEqual(drawerIndex, -1);
    assert.ok(drawing[drawerIndex].word);
    assert.ok(drawing[drawerIndex].constraint);
    assert.equal(drawing[drawerIndex].drawing.length, 0);

    const strokeState = waitForState(players[drawerIndex].socket, (state) => state.drawing.length === 1);
    players[drawerIndex].socket.emit("drawing:mark", {
      roundId: drawing[drawerIndex].roundId,
      type: drawing[drawerIndex].constraint.tools[0],
      color: "#151927",
      width: 4,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.8 }],
      from: { x: 0.2, y: 0.2 },
      to: { x: 0.7, y: 0.8 }
    });
    await strokeState;

    const guessingStates = players.map((player) => waitForState(player.socket, (state) => state.phase === "guessing"));
    players[drawerIndex].socket.emit("drawing:finish");
    await Promise.all(guessingStates);

    const guesserIndex = drawerIndex === 0 ? 1 : 0;
    const votingStates = players.map((player) => waitForState(player.socket, (state) => state.phase === "voting"));
    players[guesserIndex].socket.emit("guess:submit", { guess: drawing[drawerIndex].word });
    await Promise.all(votingStates);

    const saboteurIndex = drawing.findIndex((state) => state.myRole === "saboteur");
    assert.notEqual(saboteurIndex, -1);
    const saboteurId = players[saboteurIndex].playerId;
    const goodTargetId = players.find((player) => player.playerId !== saboteurId).playerId;
    const finalStates = players.map((player) => waitForState(player.socket, (state) => state.phase === "gameover"));
    for (const player of players) {
      player.socket.emit("vote:cast", {
        targetId: player.playerId === saboteurId ? goodTargetId : saboteurId
      });
    }
    const gameover = await Promise.all(finalStates);

    assert.equal(gameover[0].lastResult.winner, "good");
    assert.equal(gameover[0].lastResult.ejectedId, saboteurId);
    assert.ok(gameover[0].players.every((player) => player.role));
  } finally {
    for (const player of players) player.socket.disconnect();
    child.kill("SIGTERM");
  }
});
