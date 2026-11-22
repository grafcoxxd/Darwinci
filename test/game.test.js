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
