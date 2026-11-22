const crypto = require("node:crypto");

const PACKS = {
  begriffe: [
    "Leuchtturm", "Regenbogen", "Zeitmaschine", "Bäckerei", "Dinosaurier",
    "Riesenrad", "Sonnenfinsternis", "Schlafmütze", "Kaugummi", "Vulkan",
    "Schatzkarte", "Roboter", "Piratenschiff", "Wolkenkratzer", "Murmelbahn",
    "Gewitter", "Bibliothek", "Astronaut", "Schneemann", "Zaubertrick"
  ],
  filme: [
    "Harry Potter", "Star Wars", "Jurassic Park", "Titanic", "Shrek",
    "Kung Fu Panda", "Eiskönigin", "Indiana Jones", "Matrix", "Ghostbusters",
    "Fluch der Karibik", "Findet Nemo", "Arielle", "Avatar", "Inception"
  ],
  spiele: [
    "Minecraft", "Mario", "Tetris", "Pac-Man", "Pokémon", "Fortnite",
    "Among Us", "FIFA", "Sonic", "Zelda", "Monopoly", "Cluedo",
    "Werwolf", "Mensch ärgere dich nicht", "Portal"
  ]
};

const CHARACTERS = [
  { id: "fox", icon: "🦊", label: "Fuchs", color: "#ef8354" },
  { id: "frog", icon: "🐸", label: "Frosch", color: "#67c587" },
  { id: "cat", icon: "🐱", label: "Katze", color: "#c7a3ed" },
  { id: "panda", icon: "🐼", label: "Panda", color: "#dfe4ea" },
  { id: "ghost", icon: "👻", label: "Geist", color: "#91c8f6" },
  { id: "robot", icon: "🤖", label: "Roboter", color: "#f4bd4c" },
  { id: "wizard", icon: "🧙", label: "Magier", color: "#f08ad1" },
  { id: "unicorn", icon: "🦄", label: "Einhorn", color: "#81dfd3" }
];

const DEFAULT_SETTINGS = {
  saboteurCount: 1,
  drawTime: 60,
  difficulty: "medium",
  revealTiming: "immediate",
  wordPack: "begriffe",
  customWords: "",
  eliminationMode: "classic",
  winMode: "score",
  targetScore: 4,
  targetScoreCustom: false,
  maxRounds: 8
};

const CONSTRAINTS = {
  easy: [
    { id: "mono-free", label: "Nur eine Farbe – sonst freie Hand", tools: ["pen", "line", "ellipse", "rectangle"], singleColor: true },
    { id: "eight-lines", label: "Maximal 8 gerade Linien", tools: ["line"], limits: { line: 8 } },
    { id: "random-five-easy", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5 },
    { id: "six-shapes", label: "Maximal 6 Formen, keine freie Hand", tools: ["line", "ellipse", "rectangle"], maxItems: 6 }
  ],
  medium: [
    { id: "no-erase", label: "Freies Zeichnen, aber ohne Löschen oder Rückgängig", tools: ["pen", "line", "ellipse", "rectangle"], allowClear: false, allowUndo: false },
    { id: "three-line-two-ellipse", label: "Maximal 3 Linien und 2 Ellipsen", tools: ["line", "ellipse"], limits: { line: 3, ellipse: 2 } },
    { id: "random-five", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, allowClear: false },
    { id: "mirrored-five", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, mirrorX: true, allowUndo: false },
    { id: "blind-five", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, hideExisting: true, allowClear: false }
  ],
  hard: [
    { id: "random-five-hard", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, singleColor: true, allowClear: false, allowUndo: false },
    { id: "mirrored-black-five", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, mirrorX: true, fixedColor: "#151927", allowClear: false, allowUndo: false },
    { id: "blind-fast-five", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, hideExisting: true, timeFactor: 0.65, allowClear: false, allowUndo: false },
    { id: "one-stroke", label: "Ohne Absetzen: genau ein zusammenhängender Freihandstrich, ohne Korrektur", tools: ["pen"], limits: { pen: 1 }, allowClear: false, allowUndo: false },
    { id: "blind-one-stroke", label: "Ein einziger schwarzer Strich blind – du siehst nur die neue Linie während des Ziehens", tools: ["pen"], limits: { pen: 1 }, hideExisting: true, fixedColor: "#151927", allowClear: false, allowUndo: false },
    { id: "black-geometry-sprint", kind: "random-geometry", tools: ["line", "ellipse", "rectangle"], maxItems: 5, fixedColor: "#151927", timeFactor: 0.5, allowClear: false, allowUndo: false }
  ]
};

const GEOMETRY_NAMES = {
  line: ["gerade Linie", "gerade Linien"],
  ellipse: ["Ellipse", "Ellipsen"],
  rectangle: ["Rechteck", "Rechtecke"]
};

function createId(length = 22) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 18);
}

function compatibleConstraint(constraint, difficulty = "medium") {
  if (constraint && Array.isArray(constraint.tools)) return constraint;
  return {
    id: "legacy-free",
    label: typeof constraint === "string" ? constraint : "Freies Zeichnen",
    tools: ["pen", "line", "ellipse", "rectangle"],
    maxItems: difficulty === "hard" ? 8 : 12
  };
}

function materializeConstraint(template) {
  const constraint = structuredClone(template);
  if (constraint.kind !== "random-geometry") return constraint;
  const tools = constraint.tools.filter((tool) => tool !== "pen");
  const limits = Object.fromEntries(tools.map((tool) => [tool, 0]));
  for (let remaining = constraint.maxItems; remaining > 0; remaining -= 1) {
    const tool = tools[crypto.randomInt(tools.length)];
    limits[tool] += 1;
  }
  constraint.limits = limits;
  const parts = tools
    .filter((tool) => limits[tool] > 0)
    .map((tool) => `${limits[tool]} ${GEOMETRY_NAMES[tool][limits[tool] === 1 ? 0 : 1]}`);
  const extras = [
    constraint.mirrorX && "gespiegelt",
    constraint.hideExisting && "blind",
    constraint.timeFactor && `${Math.round(constraint.timeFactor * 100)} % Zeit`,
    constraint.fixedColor && "nur schwarz",
    constraint.allowUndo === false && "keine Korrektur"
  ].filter(Boolean);
  constraint.label = `${parts.join(", ")}${extras.length ? ` – ${extras.join(", ")}` : ""}`;
  return constraint;
}

function sanitizeSettings(input = {}, current = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  settings.saboteurCount = clampInt(input.saboteurCount, 1, 3, 1);
  settings.drawTime = [30, 45, 60, 90, 120].includes(Number(input.drawTime)) ? Number(input.drawTime) : 60;
  settings.difficulty = ["easy", "medium", "hard"].includes(input.difficulty) ? input.difficulty : "medium";
  settings.revealTiming = ["immediate", "end"].includes(input.revealTiming) ? input.revealTiming : "immediate";
  settings.wordPack = [...Object.keys(PACKS), "custom", "mix"].includes(input.wordPack) ? input.wordPack : "begriffe";
  settings.customWords = String(input.customWords || "")
    .split(/[,\n]/)
    .map((word) => word.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 100)
    .join("\n");
  settings.eliminationMode = ["classic", "sitout"].includes(input.eliminationMode) ? input.eliminationMode : "classic";
  settings.winMode = input.winMode === "rounds" ? "rounds" : "score";
  settings.targetScore = clampInt(input.targetScore, 1, 20, current.targetScore ?? 4);
  settings.targetScoreCustom = Boolean(current.targetScoreCustom) ||
    (input.targetScore !== undefined && Number(input.targetScore) !== Number(current.targetScore ?? settings.targetScore));
  settings.maxRounds = clampInt(input.maxRounds, 1, 30, 8);
  return settings;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function newRoom(hostName, character) {
  const hostId = createId();
  const now = Date.now();
  return {
    version: 1,
    code: createRoomCode(),
    hostId,
    phase: "lobby",
    round: 0,
    score: 0,
    players: [newPlayer(hostId, hostName, character)],
    settings: { ...DEFAULT_SETTINGS },
    game: {
      drawerId: null,
      word: null,
      constraint: null,
      guess: "",
      correct: null,
      votes: {},
      voteStartedAt: null,
      deadline: null,
      roundId: null,
      usedWords: [],
      pendingReveal: []
    },
    drawing: [],
    createdAt: now,
    updatedAt: now
  };
}

function newPlayer(id, name, character) {
  return {
    id,
    name: normalizeName(name),
    character: CHARACTERS.some((item) => item.id === character) ? character : "fox",
    connected: false,
    role: null,
    alive: true,
    sittingOut: false,
    joinedAt: Date.now()
  };
}

function addPlayer(room, name, character) {
  const cleanName = normalizeName(name);
  if (!cleanName) throw new Error("Bitte einen Namen eingeben.");
  const returningPlayer = room.players.find((player) =>
    player.name.toLowerCase() === cleanName.toLowerCase() && !player.connected
  );
  if (returningPlayer) {
    if (CHARACTERS.some((item) => item.id === character)) returningPlayer.character = character;
    return returningPlayer.id;
  }
  if (room.phase !== "lobby") {
    throw new Error("Das Spiel hat bereits begonnen. Mit demselben Namen kann nur eine getrennte Person wieder beitreten.");
  }
  if (room.players.length >= 12) throw new Error("Diese Lobby ist voll.");
  if (room.players.some((player) => player.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error("Dieser Name ist in der Lobby schon vergeben.");
  }
  const id = createId();
  room.players.push(newPlayer(id, cleanName, character));
  if (!room.hostId) room.hostId = id;
  if (!room.settings.targetScoreCustom) room.settings.targetScore = targetScoreFor(room.players.length);
  return id;
}

function leaveRoom(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index === -1) throw new Error("Spieler wurde in der Lobby nicht gefunden.");
  const [player] = room.players.splice(index, 1);
  Object.entries(room.game.votes).forEach(([voterId, targetId]) => {
    if (voterId === playerId || targetId === playerId) delete room.game.votes[voterId];
  });
  if (room.hostId === playerId) {
    room.hostId = room.players.find((item) => item.id !== playerId && item.connected && item.alive)?.id ||
      room.players.find((item) => item.id !== playerId)?.id || null;
  }
  if (!room.settings.targetScoreCustom) room.settings.targetScore = targetScoreFor(room.players.length);

  if (room.phase !== "lobby") {
    if (room.players.length === 0) return;
    if (room.game.drawerId === playerId && room.phase === "drawing") finishDrawing(room);
    const winner = determineWinner(room);
    if (winner) {
      room.phase = "gameover";
      room.game.deadline = null;
      room.game.lastResult = {
        round: room.round,
        guess: room.game.guess,
        correct: room.game.correct,
        word: room.game.word,
        winner,
        ejectedId: playerId,
        ejectedName: player.name,
        revealWord: true,
        tie: false
      };
    }
  }
}

function targetScoreFor(playerCount) {
  return Math.max(4, Math.ceil(Math.max(0, playerCount) / 2) + 2);
}

function getWords(settings) {
  if (settings.wordPack === "custom") {
    return settings.customWords.split("\n").filter(Boolean);
  }
  if (settings.wordPack === "mix") {
    return Object.values(PACKS).flat().concat(settings.customWords.split("\n").filter(Boolean));
  }
  return PACKS[settings.wordPack] || PACKS.begriffe;
}

function startGame(room) {
  if (!room.players.length) throw new Error("Die Lobby ist leer.");
  if (room.hostId !== room.players[0]?.id && !room.players.some((p) => p.id === room.hostId)) {
    room.hostId = room.players[0]?.id || null;
  }
  const words = getWords(room.settings);
  if (!words.length) throw new Error("Das gewählte Wortpaket enthält keine Wörter.");

  room.players.forEach((player) => {
    player.alive = true;
    player.sittingOut = false;
    player.role = "good";
  });
  const shuffled = [...room.players];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const maxSaboteurs = room.players.length < 3 ? 0 : Math.floor((room.players.length - 1) / 2);
  shuffled.slice(0, Math.min(room.settings.saboteurCount, maxSaboteurs))
    .forEach((player) => { player.role = "saboteur"; });
  room.round = 0;
  room.score = 0;
  if (!room.settings.targetScoreCustom) room.settings.targetScore = targetScoreFor(room.players.length);
  room.game.usedWords = [];
  room.game.pendingReveal = [];
  startRound(room);
}

function startRound(room) {
  room.players.forEach((player) => { player.sittingOut = false; });
  const candidates = room.players.filter((player) => player.alive);
  if (!candidates.length) throw new Error("Keine aktiven Spieler übrig.");
  const previousDrawer = room.game.drawerId;
  const drawerPool = candidates.filter((player) => player.id !== previousDrawer);
  const pool = drawerPool.length ? drawerPool : candidates;
  const drawer = pool[crypto.randomInt(pool.length)];
  const words = getWords(room.settings);
  const available = words.filter((word) => !room.game.usedWords.includes(word));
  const wordPool = available.length ? available : words;
  if (!available.length) room.game.usedWords = [];
  const word = wordPool[crypto.randomInt(wordPool.length)];
  const constraints = CONSTRAINTS[room.settings.difficulty];
  const constraint = materializeConstraint(constraints[crypto.randomInt(constraints.length)]);

  room.round += 1;
  room.game.roundId = createId(14);
  room.phase = "drawing";
  room.drawing = [];
  room.game.drawerId = drawer.id;
  room.game.word = word;
  room.game.constraint = structuredClone(constraint);
  room.game.guess = "";
  room.game.correct = null;
  room.game.votes = {};
  room.game.voteStartedAt = null;
  room.game.deadline = Date.now() + Math.max(10, Math.round(room.settings.drawTime * (constraint.timeFactor || 1))) * 1000;
  room.game.usedWords.push(word);
}

function submitGuess(room, playerId, guess) {
  const activePlayers = room.players.filter((player) => player.alive && !player.sittingOut);
  const isOnlyPlayer = activePlayers.length === 1 && activePlayers[0].id === playerId;
  if (room.phase !== "guessing" || (playerId === room.game.drawerId && !isOnlyPlayer)) {
    throw new Error("Jetzt kann keine Lösung eingereicht werden.");
  }
  const normalized = String(guess || "").trim().replace(/\s+/g, " ").slice(0, 50);
  if (!normalized) throw new Error("Die Lösung darf nicht leer sein.");
  room.game.guess = normalized;
  room.game.correct = normalized.localeCompare(room.game.word, "de", { sensitivity: "base" }) === 0;
  room.game.deadline = Date.now() + 60_000;
  room.phase = "voting";
  room.game.voteStartedAt = Date.now();
  room.game.votes = {};
  if (isOnlyPlayer) resolveVoting(room);
}

function finishDrawing(room) {
  if (room.phase !== "drawing") return;
  room.phase = "guessing";
  room.game.deadline = Date.now() + 60_000;
}

function drawingUsage(room) {
  return room.drawing.reduce((usage, item) => {
    usage[item.type] = (usage[item.type] || 0) + 1;
    return usage;
  }, {});
}

function addDrawingItem(room, playerId, input) {
  if (room.phase !== "drawing") throw new Error("Die Zeichenphase ist beendet.");
  if (room.game.drawerId !== playerId) throw new Error("Nur der Zeichner darf die Leinwand benutzen.");
  if (input.roundId !== room.game.roundId) throw new Error("Die Zeichnung gehört zu einer alten Runde.");
  const constraint = compatibleConstraint(room.game.constraint, room.settings.difficulty);
  room.game.constraint = constraint;
  const type = String(input.type || "");
  if (!constraint.tools.includes(type)) throw new Error(`„${type}“ ist in dieser Runde nicht erlaubt.`);
  const usage = drawingUsage(room);
  const limit = constraint.limits?.[type];
  if (limit !== undefined && (usage[type] || 0) >= limit) {
    throw new Error("Das Kontingent für dieses Werkzeug ist aufgebraucht.");
  }
  if (constraint.maxItems && room.drawing.length >= constraint.maxItems) {
    throw new Error("Das Formenlimit für diese Runde ist erreicht.");
  }
  const color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : "#151927";
  if (constraint.singleColor && room.drawing[0] && color !== room.drawing[0].color) {
    throw new Error("In dieser Runde ist nur eine Farbe erlaubt.");
  }
  if (constraint.fixedColor && color !== constraint.fixedColor) {
    throw new Error("Diese Runde erfordert die festgelegte Farbe.");
  }
  const width = Math.max(1, Math.min(32, Number(input.width) || 4));
  const clampPoint = (point) => ({
    x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
    y: Math.max(0, Math.min(1, Number(point?.y) || 0))
  });
  const item = { type, color, width, roundId: room.game.roundId };
  if (type === "pen") {
    const points = Array.isArray(input.points) ? input.points.slice(0, 5000).map(clampPoint) : [];
    if (!points.length) throw new Error("Der Strich enthält keine Punkte.");
    item.points = points;
  } else {
    item.from = clampPoint(input.from);
    item.to = clampPoint(input.to);
    if (item.from.x === item.to.x && item.from.y === item.to.y) {
      throw new Error("Ziehe die Form etwas größer.");
    }
  }
  if (constraint.mirrorX) {
    const mirror = (point) => ({ ...point, x: 1 - point.x });
    if (item.points) item.points = item.points.map(mirror);
    if (item.from) item.from = mirror(item.from);
    if (item.to) item.to = mirror(item.to);
  }
  room.drawing.push(item);
}

function clearDrawing(room, playerId, roundId) {
  if (room.phase !== "drawing" || room.game.drawerId !== playerId) {
    throw new Error("Nur der Zeichner kann während der Zeichenphase löschen.");
  }
  if (roundId !== room.game.roundId) throw new Error("Diese Leinwand gehört zu einer alten Runde.");
  if (compatibleConstraint(room.game.constraint, room.settings.difficulty).allowClear === false) {
    throw new Error("Löschen ist in dieser Runde verboten.");
  }
  room.drawing = [];
}

function createDrawingPreview(drawState, playerId, input) {
  if (drawState?.phase !== "drawing" || drawState.drawerId !== playerId) {
    throw new Error("Nur der Zeichner darf eine Live-Vorschau senden.");
  }
  if (input.roundId !== drawState.roundId) throw new Error("Die Vorschau gehört zu einer alten Runde.");
  const constraint = compatibleConstraint(drawState.constraint, drawState.difficulty);
  const type = String(input.type || "");
  if (!constraint.tools.includes(type)) throw new Error("Dieses Werkzeug ist nicht erlaubt.");
  const clampPoint = (point) => ({
    x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
    y: Math.max(0, Math.min(1, Number(point?.y) || 0))
  });
  const preview = {
    type,
    roundId: drawState.roundId,
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : "#151927",
    width: Math.max(1, Math.min(32, Number(input.width) || 4))
  };
  if (constraint.fixedColor) preview.color = constraint.fixedColor;
  if (type === "pen") {
    preview.points = Array.isArray(input.points) ? input.points.slice(0, 700).map(clampPoint) : [];
    if (!preview.points.length) throw new Error("Die Vorschau enthält keine Punkte.");
  } else {
    preview.from = clampPoint(input.from);
    preview.to = clampPoint(input.to);
  }
  if (constraint.mirrorX) {
    const mirror = (point) => ({ ...point, x: 1 - point.x });
    if (preview.points) preview.points = preview.points.map(mirror);
    if (preview.from) preview.from = mirror(preview.from);
    if (preview.to) preview.to = mirror(preview.to);
  }
  return preview;
}

function undoDrawing(room, playerId, roundId) {
  if (room.phase !== "drawing" || room.game.drawerId !== playerId) {
    throw new Error("Nur der Zeichner kann während der Zeichenphase rückgängig machen.");
  }
  if (roundId !== room.game.roundId) throw new Error("Diese Aktion gehört zu einer alten Runde.");
  if (compatibleConstraint(room.game.constraint, room.settings.difficulty).allowUndo === false) {
    throw new Error("Rückgängig ist in dieser Runde verboten.");
  }
  room.drawing.pop();
}

function castVote(room, playerId, targetId) {
  if (room.phase !== "voting") throw new Error("Aktuell findet keine Abstimmung statt.");
  const voter = room.players.find((player) => player.id === playerId && player.alive && !player.sittingOut);
  const target = room.players.find((player) => player.id === targetId && player.alive && !player.sittingOut);
  if (!voter || !target) throw new Error("Ungültige Stimme.");
  if (playerId === targetId) throw new Error("Du kannst nicht für dich selbst stimmen.");
  room.game.votes[playerId] = targetId;
}

function resolveVoting(room) {
  if (room.phase !== "voting") return;
  const counts = Object.values(room.game.votes).reduce((result, targetId) => {
    result[targetId] = (result[targetId] || 0) + 1;
    return result;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const tied = entries.length && (!entries[1] || entries[0][1] !== entries[1][1]);
  let ejected = null;
  if (tied) {
    ejected = room.players.find((player) => player.id === entries[0][0]);
  }
  if (ejected) {
    if (room.settings.eliminationMode === "sitout") ejected.sittingOut = true;
    else ejected.alive = false;
  }

  const reveal = {
    round: room.round,
    roundId: room.game.roundId,
    guess: room.game.guess,
    word: room.game.word,
    correct: room.game.correct,
    ejectedId: ejected?.id || null,
    ejectedName: ejected?.name || null,
    votes: counts,
    tie: !tied
  };
  if (room.game.correct) room.score += 1;
  room.game.pendingReveal.push(reveal);

  const winner = determineWinner(room);
  const roundEnd = Date.now() + 12_000;
  room.phase = winner ? "gameover" : "result";
  room.game.deadline = roundEnd;
  room.game.lastResult = {
    ...reveal,
    winner: winner || null,
    revealWord: room.settings.revealTiming === "immediate" || Boolean(winner)
  };
  if (winner) room.game.deadline = null;
}

function determineWinner(room) {
  const goodCount = room.players.filter((p) => p.alive && p.role === "good").length;
  const saboteurCount = room.players.filter((p) => p.alive && p.role === "saboteur").length;
  if (saboteurCount === 0) return "good";
  if (saboteurCount >= goodCount) return "saboteur";
  if (room.score >= room.settings.targetScore) return "good";
  if (room.settings.winMode === "rounds" && room.round >= room.settings.maxRounds) {
    return room.score >= Math.ceil(room.round / 2) ? "good" : "saboteur";
  }
  return null;
}

function advanceTimers(room) {
  if (!room.game.deadline || Date.now() < room.game.deadline) return false;
  if (room.phase === "drawing") finishDrawing(room);
  else if (room.phase === "guessing") {
    room.game.guess = "Keine Lösung";
    room.game.correct = false;
    room.phase = "voting";
    room.game.voteStartedAt = Date.now();
    room.game.deadline = Date.now() + 60_000;
  } else if (room.phase === "voting") resolveVoting(room);
  else if (room.phase === "result") {
    if (determineWinner(room)) {
      room.phase = "gameover";
      room.game.deadline = null;
    } else {
      startRound(room);
    }
  }
  return true;
}

function resetToLobby(room) {
  room.phase = "lobby";
  room.round = 0;
  room.score = 0;
  room.drawing = [];
  room.game = {
    drawerId: null, word: null, constraint: null, guess: "", correct: null,
    votes: {}, voteStartedAt: null, deadline: null, roundId: null, usedWords: [], pendingReveal: []
  };
  room.players.forEach((player) => {
    player.role = null;
    player.alive = true;
    player.sittingOut = false;
  });
}

function publicState(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  if (!viewer) throw new Error("Du gehörst nicht zu dieser Lobby.");
  const showWord = ["drawing", "guessing"].includes(room.phase) &&
    (viewer.role === "saboteur" || viewerId === room.game.drawerId);
  const showResultWord = room.phase === "gameover" ||
    (room.phase === "result" && room.game.lastResult?.revealWord);
  const scoreHidden = room.settings.revealTiming === "end" && room.phase !== "gameover";
  const constraint = compatibleConstraint(room.game.constraint, room.settings.difficulty);
  const targetScore = room.phase === "lobby"
    ? room.settings.targetScore
    : room.settings.targetScore;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    roundId: room.game.roundId,
    score: scoreHidden ? null : room.score,
    targetScore,
    settings: { ...room.settings, targetScore },
    recommendedTargetScore: targetScoreFor(room.players.length),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      character: CHARACTERS.find((item) => item.id === player.character) || CHARACTERS[0],
      connected: player.connected,
      alive: player.alive,
      sittingOut: player.sittingOut,
      role: room.phase === "gameover" || player.id === viewerId ? player.role : null,
      left: !player.connected && !player.alive
    })),
    me: viewerId,
    myRole: viewer.role,
    drawerId: room.game.drawerId,
    constraint: viewerId === room.game.drawerId && room.phase === "drawing" ? constraint : null,
    drawingUsage: drawingUsage(room),
    word: showWord ? room.game.word : null,
    guess: room.game.guess,
    deadline: room.game.deadline,
    canGuess: room.phase === "guessing" && viewer.alive && !viewer.sittingOut &&
      (viewerId !== room.game.drawerId || room.players.filter((player) => player.alive && !player.sittingOut).length === 1),
    hasVoted: Boolean(room.game.votes[viewerId]),
    votesCast: Object.keys(room.game.votes).length,
    activeVoters: room.players.filter((p) => p.alive && !p.sittingOut).length,
    drawing: room.drawing.map((item) => ({ type: "pen", ...item })),
    lastResult: room.game.lastResult ? {
      round: room.game.lastResult.round,
      guess: room.game.lastResult.guess,
      correct: room.settings.revealTiming === "immediate" || room.phase === "gameover"
        ? room.game.lastResult.correct : null,
      word: showResultWord ? room.game.lastResult.word : null,
      ejectedId: room.game.lastResult.ejectedId,
      ejectedName: room.game.lastResult.ejectedName,
      winner: room.game.lastResult.winner,
      tie: room.game.lastResult.tie
    } : null,
    pendingReveal: room.phase === "gameover" ? room.game.pendingReveal : [],
    characters: CHARACTERS,
    wordPacks: [
      { id: "begriffe", label: "Allgemeine Begriffe" },
      { id: "filme", label: "Filme" },
      { id: "spiele", label: "Spiele" },
      { id: "mix", label: "Alles gemischt" },
      { id: "custom", label: "Eigene Wörter" }
    ]
  };
}

module.exports = {
  addDrawingItem, addPlayer, advanceTimers, castVote, CHARACTERS, clearDrawing, createDrawingPreview,
  finishDrawing, leaveRoom, newRoom, publicState, resetToLobby, resolveVoting,
  sanitizeSettings, startGame, startRound, submitGuess, undoDrawing
};
