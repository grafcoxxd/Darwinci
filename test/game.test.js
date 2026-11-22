const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../src/game");

function createReadyRoom() {
  const room = game.newRoom("Alice", "fox");
  game.addPlayer(room, "Bob", "frog");
  game.addPlayer(room, "Cara", "cat");
  game.addPlayer(room, "Dino", "ghost");
  return room;
}

test("hides secret role and target word from ordinary good players", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const drawer = room.players.find((player) => player.id === room.game.drawerId);
  const viewer = room.players.find((player) => player.role === "good" && player.id !== drawer.id);
  const state = game.publicState(room, viewer.id);

  assert.equal(state.word, null);
  assert.equal(state.myRole, "good");
  assert.ok(state.players.every((player) => player.id === viewer.id || player.role === null));
  assert.equal(state.constraint, null);
});

test("shows target word to saboteurs and constraint only to drawer", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const saboteur = room.players.find((player) => player.role === "saboteur");
  const drawer = room.players.find((player) => player.id === room.game.drawerId);
  const saboteurState = game.publicState(room, saboteur.id);
  const drawerState = game.publicState(room, drawer.id);

  assert.equal(saboteurState.word, room.game.word);
  assert.equal(drawerState.word, room.game.word);
  assert.equal(drawerState.constraint, room.game.constraint);
  assert.equal(
    saboteurState.constraint,
    saboteur.id === drawer.id ? room.game.constraint : null
  );
});

test("enforces drawing tool limits and rejects stale round marks", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const constraint = {
    id: "test-limit",
    label: "Maximal 1 Linie",
    tools: ["line"],
    limits: { line: 1 }
  };
  room.game.constraint = constraint;
  const drawer = room.game.drawerId;
  const mark = {
    roundId: room.game.roundId,
    type: "line",
    color: "#151927",
    width: 4,
    from: { x: 0.1, y: 0.1 },
    to: { x: 0.8, y: 0.8 }
  };
  game.addDrawingItem(room, drawer, mark);
  assert.throws(() => game.addDrawingItem(room, drawer, mark), /Kontingent/);
  assert.throws(
    () => game.addDrawingItem(room, drawer, { ...mark, roundId: "old-round" }),
    /alten Runde/
  );
});

test("new rounds receive a new canvas identity and empty drawing", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const firstRoundId = room.game.roundId;
  room.drawing.push({ type: "line", color: "#151927", width: 4 });

  game.finishDrawing(room);
  game.startRound(room);

  assert.notEqual(room.game.roundId, firstRoundId);
  assert.equal(room.drawing.length, 0);
});

test("rejects disallowed tools and correction controls", () => {
  const room = createReadyRoom();
  game.startGame(room);
  room.game.constraint = {
    id: "strict-test",
    label: "Nur Linie, ohne Korrektur",
    tools: ["line"],
    allowClear: false,
    allowUndo: false
  };

  assert.throws(() => game.addDrawingItem(room, room.game.drawerId, {
    roundId: room.game.roundId,
    type: "ellipse",
    color: "#151927",
    width: 4,
    from: { x: 0.1, y: 0.1 },
    to: { x: 0.8, y: 0.8 }
  }), /nicht erlaubt/);
  assert.throws(
    () => game.clearDrawing(room, room.game.drawerId, room.game.roundId),
    /verboten/
  );
  assert.throws(
    () => game.undoDrawing(room, room.game.drawerId, room.game.roundId),
    /verboten/
  );
});

test("preserves complete long freehand strokes", () => {
  const room = createReadyRoom();
  game.startGame(room);
  room.game.constraint = {
    id: "pen-test",
    label: "Freihand",
    tools: ["pen"]
  };
  const points = Array.from({ length: 3000 }, (_, index) => ({
    x: 0.05 + (index % 1000) / 1000 * 0.9,
    y: 0.5 + Math.sin(index / 25) * 0.3
  }));
  game.addDrawingItem(room, room.game.drawerId, {
    roundId: room.game.roundId,
    type: "pen",
    color: "#151927",
    width: 12,
    points
  });

  const stored = room.drawing[0].points;
  assert.equal(stored.length, 3000);
  assert.deepEqual(stored[0], points[0]);
  assert.deepEqual(stored.at(-1), points.at(-1));
  assert.ok(stored.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("random geometry restrictions distribute exactly five forms", () => {
  const distributions = new Set();
  const room = createReadyRoom();
  for (let index = 0; index < 20; index += 1) {
    room.settings.difficulty = "medium";
    game.startRound(room);
    if (room.game.constraint.kind === "random-geometry") {
      const total = Object.values(room.game.constraint.limits).reduce((sum, value) => sum + value, 0);
      assert.equal(total, 5);
      distributions.add(Object.values(room.game.constraint.limits).join("-"));
    }
  }
  assert.ok(distributions.size >= 1);
});

test("never assigns multi-lift stroke restrictions", () => {
  const room = createReadyRoom();
  room.settings.difficulty = "hard";
  for (let index = 0; index < 30; index += 1) {
    game.startRound(room);
    if (room.game.constraint.tools.includes("pen")) {
      assert.equal(room.game.constraint.limits.pen, 1);
      assert.equal(room.game.constraint.allowUndo, false);
      assert.equal(room.game.constraint.allowClear, false);
    }
  }
});

test("records one hidden vote result and reveals game roles at game over", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const guesser = room.players.find((player) => player.id !== room.game.drawerId && player.role === "good");
  game.finishDrawing(room);
  game.submitGuess(room, guesser.id, room.game.word);

  const saboteur = room.players.find((player) => player.role === "saboteur");
  for (const voter of room.players) {
    const target = voter.id === saboteur.id
      ? room.players.find((player) => player.id !== voter.id).id
      : saboteur.id;
    game.castVote(room, voter.id, target);
  }
  game.resolveVoting(room);

  assert.equal(room.game.lastResult.correct, true);
  assert.equal(room.game.lastResult.ejectedId, saboteur.id);
  assert.equal(room.phase, "gameover");
  assert.equal(room.game.lastResult.winner, "good");
  assert.ok(game.publicState(room, guesser.id).players.every((player) => player.role));
});

test("constrains lobby settings to supported values", () => {
  const settings = game.sanitizeSettings({
    saboteurCount: 100,
    drawTime: 7,
    difficulty: "impossible",
    targetScore: -5,
    maxRounds: 1000
  });

  assert.equal(settings.saboteurCount, 3);
  assert.equal(settings.drawTime, 60);
  assert.equal(settings.difficulty, "medium");
  assert.equal(settings.maxRounds, 30);
});

test("scales the automatic target score with lobby size", () => {
  const room = createReadyRoom();
  game.startGame(room);
  assert.equal(game.publicState(room, room.players[0].id).targetScore, 4);

  game.resetToLobby(room);
  for (let index = 0; index < 4; index += 1) game.addPlayer(room, `Extra ${index}`, "fox");
  game.startGame(room);
  assert.equal(game.publicState(room, room.players[0].id).targetScore, 6);
});

test("lets lobby players leave and transfers host ownership", () => {
  const room = createReadyRoom();
  const oldHost = room.hostId;
  const nextHost = room.players[1].id;
  game.leaveRoom(room, oldHost);

  assert.equal(room.hostId, nextHost);
  assert.ok(room.players.every((player) => player.id !== oldHost));
});

test("allows leaving an active game and transfers host ownership", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const nextHost = room.players[1].id;
  game.leaveRoom(room, room.hostId);

  assert.equal(room.hostId, nextHost);
  assert.equal(room.players.length, 3);
});

test("keeps the target score fixed and hidden with delayed reveals", () => {
  const room = createReadyRoom();
  room.settings.revealTiming = "end";
  game.startGame(room);
  assert.equal(room.settings.targetScore, 4);
  room.players[3].alive = false;

  const state = game.publicState(room, room.players[0].id);
  assert.equal(state.targetScore, 4);
  assert.equal(state.score, null);
});

test("allows the host to configure a custom target score", () => {
  const room = createReadyRoom();
  room.settings = game.sanitizeSettings({
    ...room.settings,
    targetScore: 7
  }, room.settings);

  assert.equal(room.settings.targetScore, 7);
  assert.equal(room.settings.targetScoreCustom, true);
  game.addPlayer(room, "Ella", "panda");
  assert.equal(room.settings.targetScore, 7);
});

test("supports a single-player test round", () => {
  const room = game.newRoom("Solo", "fox");
  game.startGame(room);
  const player = room.players[0];

  assert.equal(player.role, "good");
  assert.equal(game.publicState(room, player.id).canGuess, false);
  game.finishDrawing(room);
  assert.equal(game.publicState(room, player.id).canGuess, true);
  game.submitGuess(room, player.id, room.game.word);

  assert.equal(room.phase, "gameover");
  assert.equal(room.game.lastResult.winner, "good");
});

test("lets disconnected players resume with their original name", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const player = room.players[1];
  player.connected = false;

  assert.equal(game.addPlayer(room, player.name, "ghost"), player.id);
  assert.equal(room.players.length, 4);
});
