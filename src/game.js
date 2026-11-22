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
  winMode: "roles",
  targetScore: 5,
  maxRounds: 8
};

const CONSTRAINTS = {
  easy: ["Nur eine Farbe", "Nur gerade Linien", "Ohne Buchstaben und Zahlen", "Mit weniger als 12 Formen"],
  medium: ["Maximal 8 Striche", "Kein Radiergummi", "Nur Kreise und Linien", "Ohne Absetzen (außer einmal)"],
  hard: ["Nur 5 Striche", "Nur mit der schwachen Hand", "Nur Rechtecke, keine Kurven", "30 Sekunden: dann Stift weg", "Ohne Ansehen der Leinwand"]
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

function sanitizeSettings(input = {}) {
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
  settings.winMode = ["roles", "rounds", "score"].includes(input.winMode) ? input.winMode : "roles";
  settings.targetScore = clampInt(input.targetScore, 1, 20, 5);
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
    connected: true,
    role: null,
    alive: true,
    sittingOut: false,
    joinedAt: Date.now()
  };
}

function addPlayer(room, name, character) {
  if (room.phase !== "lobby") throw new Error("Das Spiel hat bereits begonnen.");
  if (room.players.length >= 12) throw new Error("Diese Lobby ist voll.");
  const cleanName = normalizeName(name);
  if (!cleanName) throw new Error("Bitte einen Namen eingeben.");
  if (room.players.some((player) => player.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error("Dieser Name ist in der Lobby schon vergeben.");
  }
  const id = createId();
  room.players.push(newPlayer(id, cleanName, character));
  return id;
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
  if (room.hostId !== room.players[0]?.id && !room.players.some((p) => p.id === room.hostId)) {
    room.hostId = room.players[0]?.id || null;
  }
  if (room.players.length < 4) throw new Error("Für ein Spiel werden mindestens 4 Spieler benötigt.");
  const maxSaboteurs = Math.floor((room.players.length - 1) / 2);
  if (room.settings.saboteurCount > maxSaboteurs) {
    throw new Error(`Mit ${room.players.length} Spielern sind maximal ${maxSaboteurs} Saboteure sinnvoll.`);
  }
  if (room.settings.eliminationMode === "sitout" && room.settings.winMode === "roles") {
    throw new Error("Beim Aussetzen-Modus bitte Punkte- oder Rundenziel als Siegbedingung wählen.");
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
  shuffled.slice(0, room.settings.saboteurCount).forEach((player) => { player.role = "saboteur"; });
  room.round = 0;
  room.score = 0;
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
  const constraint = constraints[crypto.randomInt(constraints.length)];

  room.round += 1;
  room.phase = "drawing";
  room.drawing = [];
  room.game.drawerId = drawer.id;
  room.game.word = word;
  room.game.constraint = constraint;
  room.game.guess = "";
  room.game.correct = null;
  room.game.votes = {};
  room.game.voteStartedAt = null;
  room.game.deadline = Date.now() + room.settings.drawTime * 1000;
  room.game.usedWords.push(word);
}

function submitGuess(room, playerId, guess) {
  if (room.phase !== "guessing" || playerId === room.game.drawerId) {
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
}

function finishDrawing(room) {
  if (room.phase !== "drawing") return;
  room.phase = "guessing";
  room.game.deadline = Date.now() + 60_000;
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
  if (room.settings.winMode === "score" && room.score >= room.settings.targetScore) return "good";
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
    votes: {}, voteStartedAt: null, deadline: null, usedWords: [], pendingReveal: []
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
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    score: room.score,
    settings: room.settings,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      character: CHARACTERS.find((item) => item.id === player.character) || CHARACTERS[0],
      connected: player.connected,
      alive: player.alive,
      sittingOut: player.sittingOut,
      role: room.phase === "gameover" || player.id === viewerId ? player.role : null
    })),
    me: viewerId,
    myRole: viewer.role,
    drawerId: room.game.drawerId,
    constraint: viewerId === room.game.drawerId ? room.game.constraint : null,
    word: showWord ? room.game.word : null,
    guess: room.game.guess,
    deadline: room.game.deadline,
    canGuess: room.phase === "guessing" && viewerId !== room.game.drawerId && viewer.alive && !viewer.sittingOut,
    hasVoted: Boolean(room.game.votes[viewerId]),
    votesCast: Object.keys(room.game.votes).length,
    activeVoters: room.players.filter((p) => p.alive && !p.sittingOut).length,
    drawing: room.drawing,
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
  addPlayer, advanceTimers, castVote, CHARACTERS, finishDrawing, newRoom,
  publicState, resetToLobby, resolveVoting, sanitizeSettings, startGame, submitGuess
};
