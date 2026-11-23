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

test("creates mirrored live previews without changing the persisted drawing", () => {
  const room = createReadyRoom();
  game.startGame(room);
  room.game.constraint = {
    id: "live-preview",
    label: "Gespiegelt",
    tools: ["pen"],
    mirrorX: true
  };
  const before = room.drawing.length;
  const preview = game.createDrawingPreview({
    phase: "drawing",
    drawerId: room.game.drawerId,
    roundId: room.game.roundId,
    constraint: room.game.constraint,
    difficulty: room.settings.difficulty
  }, room.game.drawerId, {
    roundId: room.game.roundId,
    type: "pen",
    color: "#151927",
    width: 8,
    points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.6 }]
  });

  assert.equal(room.drawing.length, before);
  assert.deepEqual(preview.points[0], { x: 0.8, y: 0.3 });
  assert.deepEqual(preview.points[1], { x: 0.6, y: 0.6 });
});

test("assigns an agent in a two-player game and one ability per round", () => {
  const room = game.newRoom("Alice", "fox");
  game.addPlayer(room, "Bob", "frog");
  game.startGame(room);
  const agents = room.players.filter((player) => player.role === "saboteur");

  assert.equal(agents.length, 1);
  assert.ok(agents[0].ability);
  assert.equal(agents[0].abilityUsed, false);
  assert.equal(game.publicState(room, agents[0].id).myAbility.used, false);
});

test("agent abilities can only be used once and may freeze the drawer", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const agent = room.players.find((player) => player.role === "saboteur");
  agent.ability = "freeze";

  game.useAgentAbility(room, agent.id);
  assert.equal(agent.abilityUsed, true);
  assert.equal(room.game.abilityEffects.some((effect) => effect.id === "freeze"), true);
  assert.throws(() => game.useAgentAbility(room, agent.id), /bereits/);
  assert.throws(() => game.addDrawingItem(room, room.game.drawerId, {
    roundId: room.game.roundId,
    type: room.game.constraint.tools[0],
    color: "#151927",
    width: 4,
    points: [{ x: 0.1, y: 0.1 }],
    from: { x: 0.1, y: 0.1 },
    to: { x: 0.5, y: 0.5 }
  }), /blockiert/);
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

test("uses the lobby geometry shape count for random constraints", () => {
  const room = createReadyRoom();
  room.settings.geometryShapeCount = 8;
  let checked = false;
  for (let index = 0; index < 50; index += 1) {
    game.startRound(room);
    if (room.game.constraint.kind === "random-geometry") {
      const total = Object.values(room.game.constraint.limits).reduce((sum, value) => sum + value, 0);
      assert.equal(total, 8);
      assert.equal(room.game.constraint.maxItems, 8);
      checked = true;
      break;
    }
  }
  assert.equal(checked, true);
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
  while (room.phase === "drawing") {
    game.finishDrawing(room);
    const guesser = room.players.find((player) => player.id !== room.game.drawerId);
    game.submitGuess(room, guesser.id, room.game.word);
  }
  assert.equal(room.phase, "voting");

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
  assert.ok(game.publicState(room, room.players[0].id).players.every((player) => player.role));
  assert.equal(room.game.lastResult.cycleResults.length, 4);
});

test("waits for every active player to finish a drawing before voting", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const drawings = new Set();
  while (room.phase === "drawing") {
    drawings.add(room.game.drawerId);
    game.finishDrawing(room);
    const guesser = room.players.find((player) => player.id !== room.game.drawerId);
    game.submitGuess(room, guesser.id, "falsch");
    if (room.phase === "voting") break;
    assert.equal(room.phase, "drawing");
  }

  assert.equal(drawings.size, 4);
  assert.equal(room.game.cycleResults.length, 4);
  assert.equal(room.phase, "voting");
});

test("agent ability remains consumed during the next draw and renews after voting", () => {
  const room = createReadyRoom();
  game.startGame(room);
  const agent = room.players.find((player) => player.role === "saboteur");
  agent.ability = "heavy-ink";
  game.useAgentAbility(room, agent.id);
  const previousAbility = agent.ability;
  assert.equal(agent.abilityUsed, true);

  game.finishDrawing(room);
  const guesser = room.players.find((player) => player.id !== room.game.drawerId);
  game.submitGuess(room, guesser.id, room.game.word);
  assert.equal(agent.ability, previousAbility);
  assert.equal(agent.abilityUsed, true);
  assert.equal(room.game.abilityEffects.length, 0);

  while (room.phase === "drawing") {
    game.finishDrawing(room);
    game.submitGuess(
      room,
      room.players.find((player) => player.id !== room.game.drawerId).id,
      "falsch"
    );
  }
  const voters = room.players;
  game.castVote(room, voters[0].id, voters[1].id);
  game.castVote(room, voters[1].id, voters[0].id);
  game.castVote(room, voters[2].id, voters[3].id);
  game.castVote(room, voters[3].id, voters[2].id);
  game.resolveVoting(room);
  if (room.phase === "result") game.startRound(room);
  assert.equal(agent.abilityUsed, false);
  assert.notEqual(agent.ability, previousAbility);
});

test("freeze blocks only one second out of every five", () => {
  const room = createReadyRoom();
  game.startGame(room);
  room.game.abilityEffects = [{
    id: "freeze",
    startedAt: 10_000,
    expiresAt: 25_000
  }];
  const state = {
    phase: "drawing",
    drawerId: room.game.drawerId,
    roundId: room.game.roundId,
    constraint: room.game.constraint,
    difficulty: room.settings.difficulty,
    abilityEffects: room.game.abilityEffects
  };

  const originalNow = Date.now;
  try {
    Date.now = () => 10_500;
    assert.throws(() => game.createDrawingPreview(state, state.drawerId, {
      roundId: state.roundId, type: state.constraint.tools[0], width: 4, color: "#151927",
      points: [{ x: 0.1, y: 0.1 }], from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.5 }
    }), /blockiert/);
    Date.now = () => 11_500;
    assert.doesNotThrow(() => game.createDrawingPreview(state, state.drawerId, {
      roundId: state.roundId, type: state.constraint.tools[0], width: 4, color: "#151927",
      points: [{ x: 0.1, y: 0.1 }], from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.5 }
    }));
  } finally {
    Date.now = originalNow;
  }
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
