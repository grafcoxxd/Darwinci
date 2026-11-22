const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const session = {
  code: localStorage.getItem("ss_code") || "",
  playerId: localStorage.getItem("ss_player") || "",
  character: localStorage.getItem("ss_character") || "fox",
  socket: null,
  room: null,
  color: "#151927",
  width: 4,
  drawing: false,
  points: [],
  canvas: null,
  context: null,
  tab: "create"
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const characters = [
  { id: "fox", icon: "🦊", label: "Fuchs", color: "#ef8354" },
  { id: "frog", icon: "🐸", label: "Frosch", color: "#67c587" },
  { id: "cat", icon: "🐱", label: "Katze", color: "#c7a3ed" },
  { id: "panda", icon: "🐼", label: "Panda", color: "#dfe4ea" },
  { id: "ghost", icon: "👻", label: "Geist", color: "#91c8f6" },
  { id: "robot", icon: "🤖", label: "Roboter", color: "#f4bd4c" },
  { id: "wizard", icon: "🧙", label: "Magier", color: "#f08ad1" },
  { id: "unicorn", icon: "🦄", label: "Einhorn", color: "#81dfd3" }
];

function renderCharacters() {
  $("#character-picker").innerHTML = characters.map((character) => `
    <button class="character-option ${session.character === character.id ? "selected" : ""}"
      type="button" title="${character.label}" aria-label="${character.label}" data-character="${character.id}">
      ${character.icon}
    </button>`).join("");
  $$("[data-character]").forEach((button) => button.addEventListener("click", () => {
    session.character = button.dataset.character;
    localStorage.setItem("ss_character", session.character);
    renderCharacters();
    if (session.room?.phase === "lobby") session.socket.emit("lobby:update-profile", { character: session.character });
  }));
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.classList.add("hidden"), 4500);
}

function connect() {
  if (!window.io) {
    toast("Der Echtzeit-Client konnte nicht geladen werden. Bitte neu laden.");
    return;
  }
  session.socket = io({ reconnection: true, reconnectionDelayMax: 5000 });
  session.socket.on("connect", () => {
    session.socket.emit("session:join", { code: session.code, playerId: session.playerId }, (result) => {
      if (result?.error) leaveSession();
    });
  });
  session.socket.on("room:state", (state) => {
    session.room = state;
    $("#entry").classList.add("hidden");
    $("#game").classList.remove("hidden");
    renderGame();
  });
  session.socket.on("error:message", toast);
  session.socket.on("session:invalid", leaveSession);
  session.socket.io.on("reconnect_attempt", () => toast("Verbindung unterbrochen – versuche wieder beizutreten…"));
}

function leaveSession() {
  session.code = "";
  session.playerId = "";
  session.room = null;
  localStorage.removeItem("ss_code");
  localStorage.removeItem("ss_player");
  if (session.socket) session.socket.disconnect();
  session.socket = null;
  $("#game").classList.add("hidden");
  $("#entry").classList.remove("hidden");
}

async function enterLobby(event) {
  event.preventDefault();
  const submit = $("#entry-submit");
  submit.disabled = true;
  try {
    const name = $("#player-name").value.trim();
    const isJoin = session.tab === "join";
    const code = $("#lobby-code").value.trim().toUpperCase();
    if (isJoin && code.length !== 5) throw new Error("Bitte einen fünfstelligen Lobby-Code eingeben.");
    const url = isJoin ? `/api/lobbies/${encodeURIComponent(code)}/join` : "/api/lobbies";
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, character: session.character })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Lobby konnte nicht geöffnet werden.");
    session.code = result.code;
    session.playerId = result.playerId;
    localStorage.setItem("ss_code", result.code);
    localStorage.setItem("ss_player", result.playerId);
    connect();
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
}

function formatTime(deadline) {
  if (!deadline) return "–:––";
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
}

function phaseText(phase) {
  return ({
    lobby: "Lobby", drawing: "Zeichenphase", guessing: "Lösungswort",
    voting: "Abstimmung", result: "Auflösung", gameover: "Spielende"
  })[phase] || phase;
}

function renderPlayerList(room) {
  return `<div class="player-list">${room.players.map((player) => `
    <div class="player ${!player.alive ? "dead" : ""} ${!player.connected ? "offline" : ""}">
      <div class="avatar" style="background:${player.character.color}24">${player.character.icon}</div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(player.name)} ${player.id === room.hostId ? '<span class="crown">♛</span>' : ""}</div>
        <div class="player-detail">${!player.alive ? "Ausgeschieden" : player.sittingOut ? "Setzt aus" : player.id === room.drawerId ? "Zeichnet gerade" : player.connected ? (room.phase === "gameover" && player.role ? player.role === "saboteur" ? "Saboteur" : "Gut" : "Bereit") : "Getrennt · kehrt zurück"}</div>
      </div>
      <span class="status-dot ${player.connected ? "" : "offline"}"></span>
    </div>`).join("")}</div>`;
}

function renderSettings(room) {
  const s = room.settings;
  const isHost = room.hostId === room.me;
  return `<form id="settings-form" class="settings-grid">
    <label class="setting-row">Saboteure<select name="saboteurCount" ${!isHost ? "disabled" : ""}>${[1, 2, 3].map(n => `<option value="${n}" ${s.saboteurCount === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="setting-row">Zeichenzeit<select name="drawTime" ${!isHost ? "disabled" : ""}>${[30, 45, 60, 90, 120].map(n => `<option value="${n}" ${s.drawTime === n ? "selected" : ""}>${n} Sekunden</option>`).join("")}</select></label>
    <label class="setting-row">Einschränkungen<select name="difficulty" ${!isHost ? "disabled" : ""}>
      <option value="easy" ${s.difficulty === "easy" ? "selected" : ""}>Sanft</option><option value="medium" ${s.difficulty === "medium" ? "selected" : ""}>Mittel</option><option value="hard" ${s.difficulty === "hard" ? "selected" : ""}>Fies</option>
    </select></label>
    <label class="setting-row">Wort-Paket<select name="wordPack" ${!isHost ? "disabled" : ""}>${room.wordPacks.map(pack => `<option value="${pack.id}" ${s.wordPack === pack.id ? "selected" : ""}>${pack.label}</option>`).join("")}</select></label>
    <label class="setting-row custom-words ${["custom", "mix"].includes(s.wordPack) ? "" : "hidden"}">Eigene Wörter<textarea name="customWords" rows="4" placeholder="Ein Begriff pro Zeile oder mit Kommas getrennt" ${!isHost ? "disabled" : ""}>${escapeHtml(s.customWords)}</textarea></label>
    <label class="setting-row">Auflösung<select name="revealTiming" ${!isHost ? "disabled" : ""}><option value="immediate" ${s.revealTiming === "immediate" ? "selected" : ""}>Nach jeder Abstimmung</option><option value="end" ${s.revealTiming === "end" ? "selected" : ""}>Erst am Spielende</option></select></label>
    <label class="setting-row">Ausscheiden<select name="eliminationMode" ${!isHost ? "disabled" : ""}><option value="classic" ${s.eliminationMode === "classic" ? "selected" : ""}>Bis zum Ende raus</option><option value="sitout" ${s.eliminationMode === "sitout" ? "selected" : ""}>Nur nächste Runde aussetzen</option></select></label>
    <label class="setting-row">Siegbedingung<select name="winMode" ${!isHost ? "disabled" : ""}><option value="roles" ${s.winMode === "roles" ? "selected" : ""}>Alle Saboteure enttarnen</option><option value="score" ${s.winMode === "score" ? "selected" : ""}>Zielpunktzahl</option><option value="rounds" ${s.winMode === "rounds" ? "selected" : ""}>Rundenmaximum</option></select></label>
    <label class="setting-row ${s.winMode === "score" ? "" : "hidden"}">Zielpunktzahl<input type="number" min="1" max="20" name="targetScore" value="${s.targetScore}" ${!isHost ? "disabled" : ""}></label>
    <label class="setting-row ${s.winMode === "rounds" ? "" : "hidden"}">Maximale Runden<input type="number" min="1" max="30" name="maxRounds" value="${s.maxRounds}" ${!isHost ? "disabled" : ""}></label>
  </form>`;
}

function lobbyView(room) {
  const isHost = room.hostId === room.me;
  const warnings = room.players.length < 4 ? "Noch mindestens 4 Spieler nötig" :
    room.settings.saboteurCount > Math.floor((room.players.length - 1) / 2) ? "Zu viele Saboteure für diese Lobby" : "Alle bereit für den Start";
  return `
    <aside class="sidebar panel"><h3>Spieler · ${room.players.length}/12</h3>${renderPlayerList(room)}</aside>
    <section class="main-stage panel">
      <div class="lobby-hero">
        <span class="eyebrow">LOBBY IST OFFEN</span><h2>Die Runde versammelt sich</h2>
        <p>Teilt den Lobby-Code oder den Link. Charaktere sind rein optisch.</p>
        <div class="lobby-code">${room.code}</div>
        <div class="waiting-seats">${room.players.slice(0, 8).map(player => `<div class="waiting-seat"><div class="avatar" style="background:${player.character.color}24">${player.character.icon}</div><b>${escapeHtml(player.name)}</b></div>`).join("")}
          ${Array.from({ length: Math.max(0, 4 - room.players.length) }, () => '<div class="waiting-seat"><span class="empty-seat">+</span></div>').join("")}
        </div>
        <p class="${room.players.length >= 4 ? "success-text" : "danger-text"}">${warnings}</p>
        ${isHost ? '<button id="start-game" class="primary">Spiel starten <span>→</span></button>' : '<p class="hint">Der Host startet das Spiel.</p>'}
      </div>
    </section>
    <aside class="sidebar panel"><h3>Lobby-Regeln</h3>${renderSettings(room)}
      <p class="hint">Änderungen werden direkt für alle gespeichert.</p>
    </aside>`;
}

function rolePanel(room) {
  const me = room.players.find((p) => p.id === room.me);
  const evil = room.myRole === "saboteur";
  return `<div class="role-card ${evil ? "saboteur" : "good"}">
    <span class="eyebrow">${evil ? "GEHEIME ROLLE" : "DEINE ROLLE"}</span>
    <h3>${evil ? "🕶 Saboteur" : "✦ Gut"}</h3>
    <p>${evil ? "Du kennst das Wort. Sorge glaubwürdig dafür, dass die Gruppe falsch liegt." : "Arbeite mit den Guten zusammen und enttarne die Saboteure."}</p>
    ${!me.alive ? '<p class="danger-text">Du bist ausgeschieden, kannst aber weiter zusehen.</p>' : me.sittingOut ? '<p class="danger-text">Du setzt diese Runde aus.</p>' : ""}
  </div>`;
}

function canvasView(room) {
  const isDrawer = room.drawerId === room.me;
  const drawer = room.players.find((player) => player.id === room.drawerId);
  const secret = room.word ? `<div class="role-card"><span>GEHEIMES WORT</span><div class="secret-word">${escapeHtml(room.word)}</div>${room.constraint ? `<p>Einschränkung: <strong>${escapeHtml(room.constraint)}</strong></p>` : ""}</div>` : "";
  return `<section class="main-stage panel">
    <span class="eyebrow">RUNDE ${room.round}</span>
    <h2>${escapeHtml(drawer?.name || "Jemand")} ${isDrawer ? "– du zeichnest" : "zeichnet jetzt"}</h2>
    ${isDrawer ? `<div class="canvas-tools"><span class="hint">Werkzeug</span>${["#151927", "#ef4444", "#3b82f6", "#22c55e", "#f59e0b"].map((color) => `<button class="color-swatch ${session.color === color ? "selected" : ""}" data-color="${color}" style="background:${color}" aria-label="Farbe ${color}"></button>`).join("")}
      <select id="stroke-width" class="width-select"><option value="2" ${session.width === 2 ? "selected" : ""}>Fein</option><option value="4" ${session.width === 4 ? "selected" : ""}>Mittel</option><option value="8" ${session.width === 8 ? "selected" : ""}>Dick</option></select>
      <button id="clear-canvas" class="secondary">Löschen</button></div>` : ""}
    <div class="canvas-wrap"><canvas id="drawing-canvas" class="${isDrawer ? "" : "canvas-disabled"}"></canvas></div>
    ${isDrawer ? '<div class="action-bar"><button id="finish-drawing" class="primary">Zeichnung abgeben <span>→</span></button></div>' : '<p class="hint">Diskutiert im Voice-Chat, was dargestellt werden könnte.</p>'}
  </section>
  <aside class="sidebar panel"><h3>Deine Information</h3>${rolePanel(room)}${secret}
    <p class="hint">Punktestand: <strong>${room.score}</strong> richtige Wörter</p>
  </aside>`;
}

function guessingView(room) {
  return `<section class="main-stage panel">
    <div class="guess-box"><span class="eyebrow">WORT DER GRUPPE</span><h2>Einigt euch auf genau eine Lösung</h2>
      <p class="result-copy">Der Begriff bleibt vorerst geheim – erst nach der Abstimmung wird je nach Lobby-Regel aufgelöst.</p>
      ${room.canGuess ? `<form id="guess-form"><input id="guess-input" maxlength="50" placeholder="Euer endgültiges Lösungswort" required><button class="primary">Einloggen →</button></form>` : '<p class="hint">Wartet auf die gemeinsame Lösung.</p>'}
      <p class="hint">Jeder aktive Spieler außer dem Zeichner kann die Einigung einloggen.</p>
    </div>
  </section><aside class="sidebar panel"><h3>Deine Information</h3>${rolePanel(room)}</aside>`;
}

function votingView(room) {
  const eligible = room.players.filter((p) => p.alive && !p.sittingOut && p.id !== room.me);
  return `<section class="main-stage panel"><div class="result">
    <span class="eyebrow">EURE LÖSUNG</span><h2>${escapeHtml(room.guess)}</h2>
    <p class="result-copy">Wer hat die Runde beeinflusst? Eure Stimmen bleiben verdeckt.</p>
    <div class="vote-grid">${eligible.map((player) => `<button class="vote-player" data-vote="${player.id}" ${room.hasVoted ? "disabled" : ""}>
      <div class="avatar" style="background:${player.character.color}24">${player.character.icon}</div><strong>${escapeHtml(player.name)}</strong></button>`).join("")}</div>
    <p class="hint">Abgegeben: ${room.votesCast} von ${room.activeVoters}${room.hasVoted ? " · Deine Stimme ist gespeichert." : ""}</p>
  </div></section><aside class="sidebar panel"><h3>Deine Information</h3>${rolePanel(room)}<p class="hint">Das Wort wird erst nach Abschluss aller Stimmen ausgewertet.</p></aside>`;
}

function resultView(room) {
  const result = room.lastResult;
  return `<section class="main-stage panel"><div class="result">
    <div class="big-icon">${result.tie ? "🤝" : "🚪"}</div>
    <span class="eyebrow">RUNDE ${room.round} BEENDET</span>
    <h2>${result.ejectedName ? `${escapeHtml(result.ejectedName)} verlässt die Runde` : "Unentschieden"}</h2>
    <p class="result-copy">${result.tie ? "Gleichstand: Niemand wurde entfernt." : room.settings.eliminationMode === "sitout" ? "Dieser Spieler setzt die nächste Runde aus." : "Ist damit ein Saboteur enttarnt?"}</p>
    <div class="result-cards">
      <div class="result-card"><span>Eure Lösung</span><strong>${escapeHtml(result.guess)}</strong></div>
      <div class="result-card"><span>Das Wort war</span><strong>${result.word ? escapeHtml(result.word) : "noch geheim"}</strong></div>
      <div class="result-card"><span>Ergebnis</span><strong class="${result.correct === null ? "" : result.correct ? "success-text" : "danger-text"}">${result.correct === null ? "Verdeckt" : result.correct ? "Richtig ✓" : "Falsch ✕"}</strong></div>
    </div>
    ${room.hostId === room.me ? '<button id="next-round" class="primary">Nächste Runde <span>→</span></button>' : '<p class="hint">Der Host startet die nächste Runde.</p>'}
  </div></section><aside class="sidebar panel"><h3>Deine Information</h3>${rolePanel(room)}<p class="hint">Gesamtpunktzahl: <strong>${room.score}</strong></p></aside>`;
}

function gameoverView(room) {
  const result = room.lastResult;
  const goodWon = result.winner === "good";
  return `<section class="main-stage panel"><div class="result">
    <div class="big-icon">${goodWon ? "🏆" : "🕶️"}</div><span class="eyebrow">SPIEL BEENDET</span>
    <h2>${goodWon ? "Die Guten haben gewonnen!" : "Die Saboteure gewinnen!"}</h2>
    <p class="result-copy">Nach ${room.round} Runden und ${room.score} richtigen Wörtern stehen die geheimen Rollen fest.</p>
    <div class="reveal-list">${room.pendingReveal.map(item => `<div class="reveal-row"><span>Runde ${item.round}: <strong>${escapeHtml(item.word)}</strong></span><span class="${item.correct ? "success-text" : "danger-text"}">${item.correct ? "✓ richtig" : `✕ ${escapeHtml(item.guess)}`}</span></div>`).join("")}</div>
    ${room.hostId === room.me ? '<button id="reset-game" class="primary">Zurück in die Lobby <span>→</span></button>' : '<p class="hint">Der Host öffnet gleich die Lobby.</p>'}
  </div></section><aside class="sidebar panel"><h3>Rollen enthüllt</h3>${renderPlayerList(room)}</aside>`;
}

function renderGame() {
  const room = session.room;
  if (!room) return;
  const stage = room.phase === "lobby" ? lobbyView(room) :
    room.phase === "drawing" ? canvasView(room) :
    room.phase === "guessing" ? guessingView(room) :
    room.phase === "voting" ? votingView(room) :
    room.phase === "result" ? resultView(room) : gameoverView(room);
  $("#game").innerHTML = `<div class="game-shell">
    <header class="game-header panel"><div><h2>Darwinci</h2><div class="lobby-code">LOBBY ${room.code}</div></div>
      <div class="phase-pill"><strong>${phaseText(room.phase)}</strong> ${room.round ? `· Runde ${room.round}` : ""}</div>
      <div class="timer" id="phase-timer">${formatTime(room.deadline)}</div>
    </header>
    ${room.phase !== "lobby" && room.phase !== "gameover" ? `<aside class="sidebar panel"><h3>Spieler · ${room.players.filter(p => p.alive).length} aktiv</h3>${renderPlayerList(room)}</aside>` : ""}
    ${stage}
  </div>`;
  bindGameControls();
  if (room.phase === "drawing") setupCanvas();
}

function bindGameControls() {
  const room = session.room;
  $("#start-game")?.addEventListener("click", () => session.socket.emit("game:start"));
  $("#settings-form")?.addEventListener("change", (event) => {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    session.socket.emit("lobby:update-settings", data);
    if (data.eliminationMode === "sitout" && data.winMode === "roles") {
      toast("Beim Aussetzen-Modus bitte Punkte- oder Rundenziel als Siegbedingung wählen.");
    }
  });
  $("#next-round")?.addEventListener("click", () => session.socket.emit("game:next"));
  $("#reset-game")?.addEventListener("click", () => session.socket.emit("game:reset"));
  $("#finish-drawing")?.addEventListener("click", () => session.socket.emit("drawing:finish"));
  $("#guess-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    session.socket.emit("guess:submit", { guess: $("#guess-input").value });
  });
  $$("[data-vote]").forEach((button) => button.addEventListener("click", () => {
    session.socket.emit("vote:cast", { targetId: button.dataset.vote });
  }));
}

function setupCanvas() {
  const canvas = $("#drawing-canvas");
  const context = canvas.getContext("2d");
  session.canvas = canvas;
  session.context = context;
  resizeCanvas();
  redraw();
  if (session.room.drawerId !== session.room.me) return;
  $$("[data-color]").forEach((button) => button.addEventListener("click", () => {
    session.color = button.dataset.color;
    $$("[data-color]").forEach((item) => item.classList.toggle("selected", item === button));
  }));
  $("#stroke-width")?.addEventListener("change", (event) => { session.width = Number(event.target.value); });
  $("#clear-canvas")?.addEventListener("click", () => session.socket.emit("drawing:clear"));
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
}

function resizeCanvas() {
  if (!session.canvas) return;
  const rect = session.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  session.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  session.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  session.context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function redraw() {
  if (!session.canvas || !session.room) return;
  const rect = session.canvas.getBoundingClientRect();
  session.context.clearRect(0, 0, rect.width, rect.height);
  session.context.fillStyle = "#fff";
  session.context.fillRect(0, 0, rect.width, rect.height);
  for (const stroke of session.room.drawing || []) drawStroke(stroke, rect);
  if (session.drawing && session.points.length) {
    drawStroke({ color: session.color, width: session.width, points: session.points }, rect);
  }
}

function drawStroke(stroke, rect) {
  if (!stroke.points.length) return;
  const context = session.context;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x * rect.width, first.y * rect.height, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first.x * rect.width, first.y * rect.height);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x * rect.width, point.y * rect.height);
  context.stroke();
}

function pointerPoint(event) {
  const rect = session.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function pointerDown(event) {
  if (session.room.drawerId !== session.room.me || session.room.phase !== "drawing") return;
  session.canvas.setPointerCapture(event.pointerId);
  session.drawing = true;
  session.points = [pointerPoint(event)];
  redraw();
}

function pointerMove(event) {
  if (!session.drawing) return;
  session.points.push(pointerPoint(event));
  if (session.points.length > 1000) session.points.splice(1, 1);
  redraw();
}

function pointerUp() {
  if (!session.drawing) return;
  session.drawing = false;
  const points = session.points;
  session.points = [];
  session.socket.emit("drawing:stroke", { color: session.color, width: session.width, points });
}

$$("[data-tab]").forEach((button) => button.addEventListener("click", () => {
  session.tab = button.dataset.tab;
  $$("[data-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
  const joining = session.tab === "join";
  $("#code-field").classList.toggle("hidden", !joining);
  $("#lobby-code").required = joining;
  $("#entry-submit").innerHTML = `${joining ? "Lobby beitreten" : "Lobby erstellen"} <span>→</span>`;
}));
$("#entry-form").addEventListener("submit", enterLobby);
window.addEventListener("resize", () => {
  if (!session.canvas) return;
  resizeCanvas();
  redraw();
});
setInterval(() => {
  if (session.room) {
    const timer = $("#phase-timer");
    if (timer) timer.textContent = formatTime(session.room.deadline);
  }
}, 250);

renderCharacters();
if (session.code && session.playerId) connect();
