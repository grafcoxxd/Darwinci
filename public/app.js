const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const session = {
  code: sessionStorage.getItem("ss_code") || "",
  playerId: sessionStorage.getItem("ss_player") || "",
  character: localStorage.getItem("ss_character") || "fox",
  socket: null,
  room: null,
  color: "#151927",
  width: 4,
  tool: "pen",
  drawing: false,
  points: [],
  draftFrom: null,
  draftTo: null,
  guessDraft: "",
  roundId: null,
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
    if (session.room?.roundId !== state.roundId) {
      session.drawing = false;
      session.points = [];
      session.draftFrom = null;
      session.draftTo = null;
      session.canvas = null;
      session.context = null;
      session.guessDraft = "";
    }
    session.room = state;
    $("#entry").classList.add("hidden");
    $("#game").classList.remove("hidden");
    renderGame();
  });
  session.socket.on("error:message", toast);
  session.socket.on("session:invalid", leaveSession);
  session.socket.on("lobby:left", () => leaveSession());
  session.socket.io.on("reconnect_attempt", () => toast("Verbindung unterbrochen – versuche wieder beizutreten…"));
}

function leaveSession() {
  session.code = "";
  session.playerId = "";
  session.room = null;
  sessionStorage.removeItem("ss_code");
  sessionStorage.removeItem("ss_player");
  if (session.socket) session.socket.disconnect();
  session.socket = null;
  $("#app").classList.remove("game-active");
  $(".brand").classList.remove("hidden");
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
    sessionStorage.setItem("ss_code", result.code);
    sessionStorage.setItem("ss_player", result.playerId);
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
        <div class="player-detail">${!player.alive ? "Ausgeschieden" : player.sittingOut ? "Setzt aus" : player.id === room.drawerId ? "Zeichnet gerade"         : player.left ? "Verlassen" : player.connected ? (room.phase === "gameover" && player.role ? player.role === "saboteur" ? "Saboteur" : "Gut" : "Bereit") : "Getrennt · kehrt zurück"}</div>
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
    <label class="setting-row score-target">Benötigte Punkte<input type="number" name="targetScore" min="1" max="20" value="${room.targetScore}" ${!isHost ? "disabled" : ""}><small>Empfehlung für ${room.players.length} Spieler: ${room.recommendedTargetScore} Punkte. 1 richtiges Wort = 1 Punkt.</small></label>
    <details class="advanced-settings" ${s.revealTiming !== "immediate" || s.eliminationMode !== "classic" || s.winMode === "rounds" ? "open" : ""}>
      <summary>Weitere Regeln <span>⌄</span></summary>
      <div class="advanced-grid">
        <label class="setting-row">Auflösung<select name="revealTiming" ${!isHost ? "disabled" : ""}><option value="immediate" ${s.revealTiming === "immediate" ? "selected" : ""}>Nach jeder Abstimmung</option><option value="end" ${s.revealTiming === "end" ? "selected" : ""}>Erst am Spielende</option></select></label>
        <label class="setting-row">Ausscheiden<select name="eliminationMode" ${!isHost ? "disabled" : ""}><option value="classic" ${s.eliminationMode === "classic" ? "selected" : ""}>Bis zum Ende raus</option><option value="sitout" ${s.eliminationMode === "sitout" ? "selected" : ""}>Nur nächste Runde aussetzen</option></select></label>
        <label class="setting-row">Siegbedingung<select name="winMode" ${!isHost ? "disabled" : ""}><option value="score" ${s.winMode !== "rounds" ? "selected" : ""}>Punktsieg oder Enttarnung</option><option value="rounds" ${s.winMode === "rounds" ? "selected" : ""}>Zusätzlich mit Rundenmaximum</option></select></label>
        <label class="setting-row ${s.winMode === "rounds" ? "" : "hidden"}">Maximale Runden<input type="number" min="1" max="30" name="maxRounds" value="${s.maxRounds}" ${!isHost ? "disabled" : ""}></label>
      </div>
    </details>
  </form>`;
}

function lobbyView(room) {
  const isHost = room.hostId === room.me;
  const maxSaboteurs = room.players.length < 3 ? 0 : Math.floor((room.players.length - 1) / 2);
  const warnings = room.settings.saboteurCount > maxSaboteurs
    ? `${room.players.length < 3 ? "Testmodus" : "Hinweis"}: Es werden ${maxSaboteurs} Saboteure verteilt.`
    : "Alle bereit für den Start";
  return `
    <aside class="sidebar lobby-players panel"><div class="sidebar-heading"><div><span class="eyebrow">RAUMBELEGUNG</span><h3>Spieler</h3></div><strong class="count-badge">${room.players.length}/12</strong></div>${renderPlayerList(room)}</aside>
    <section class="main-stage lobby-main panel">
      <div class="lobby-hero">
        <span class="eyebrow">LOBBY IST OFFEN</span><h2>Die Runde versammelt sich</h2>
        <p>Teilt den Code und wartet, bis alle bereit sind.</p>
        <button class="invite-code" data-copy-code title="Lobby-Code kopieren"><span>LOBBY-CODE</span><strong>${room.code}</strong><b>⧉</b></button>
        <div class="waiting-seats">${room.players.slice(0, 8).map(player => `<div class="waiting-seat"><div class="avatar" style="background:${player.character.color}24">${player.character.icon}</div><b>${escapeHtml(player.name)}</b></div>`).join("")}
          ${Array.from({ length: Math.max(0, 4 - room.players.length) }, () => '<div class="waiting-seat"><span class="empty-seat">+</span></div>').join("")}
        </div>
        <div class="ready-strip ${room.settings.saboteurCount > maxSaboteurs ? "warning" : ""}"><span class="status-dot"></span><span>${warnings}</span></div>
        ${isHost ? '<button id="start-game" class="primary start-button">Runde starten <span>→</span></button>' : '<div class="waiting-host">Der Host startet die Runde</div>'}
      </div>
    </section>
    <aside class="sidebar lobby-settings panel"><div class="sidebar-heading"><div><span class="eyebrow">KONFIGURATION</span><h3>Spielregeln</h3></div><span class="save-indicator">● Gespeichert</span></div>${renderSettings(room)}
      <p class="hint">${isHost ? "Du änderst die Regeln für alle." : "Nur der Host kann Regeln ändern."}</p>
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
  const constraint = room.constraint;
  if (constraint && !constraint.tools.includes(session.tool)) session.tool = constraint.tools[0];
  const tools = [
    { id: "pen", icon: "✎", label: "Freihand" },
    { id: "line", icon: "╱", label: "Linie" },
    { id: "ellipse", icon: "○", label: "Ellipse" },
    { id: "rectangle", icon: "□", label: "Rechteck" }
  ];
  const usage = room.drawingUsage || {};
  const toolHtml = isDrawer && constraint ? tools.filter((tool) => constraint.tools.includes(tool.id)).map((tool) => {
    const limit = constraint.limits?.[tool.id];
    const remaining = limit === undefined ? null : Math.max(0, limit - (usage[tool.id] || 0));
    const exhausted = remaining === 0 || (constraint.maxItems && room.drawing.length >= constraint.maxItems);
    return `<button class="tool-button ${session.tool === tool.id ? "selected" : ""}" data-tool="${tool.id}" ${exhausted ? "disabled" : ""} title="${tool.label}">
      <b>${tool.icon}</b><span>${tool.label}</span>${remaining === null ? "" : `<small>${remaining} übrig</small>`}
    </button>`;
  }).join("") : "";
  const color = constraint?.fixedColor || session.color;
  const secret = room.word ? `<div class="role-card secret-card"><span class="eyebrow">${isDrawer ? "GEHEIMES WORT" : "DEIN WISSEN"}</span><div class="secret-word">${escapeHtml(room.word)}</div>${constraint ? `<p class="constraint-copy">${escapeHtml(constraint.label)}</p>` : ""}</div>` : "";
  return `<section class="main-stage canvas-stage panel">
    <div class="stage-title-row"><div><span class="eyebrow">ZEICHNUNG · RUNDE ${room.round}</span><h2>${isDrawer ? "Du bist am Stift" : `${escapeHtml(drawer?.name || "Jemand")} zeichnet`}</h2></div><div class="drawer-chip"><span>${isDrawer ? "✎" : drawer?.character.icon || "✎"}</span>${isDrawer ? "Zeichner" : "Zuschauen"}</div></div>
    ${isDrawer ? `<div class="drawing-toolbar"><div class="tool-palette">${toolHtml}</div><div class="canvas-tools">${["#151927", "#ef4444", "#3b82f6", "#22c55e", "#f59e0b"].map((swatch) => `<button class="color-swatch ${color === swatch ? "selected" : ""}" data-color="${swatch}" ${constraint.fixedColor && swatch !== constraint.fixedColor ? "disabled" : ""} style="background:${swatch}" aria-label="Farbe ${swatch}"></button>`).join("")}
      <select id="stroke-width" class="width-select" aria-label="Strichbreite"><option value="2" ${session.width === 2 ? "selected" : ""}>2 px</option><option value="4" ${session.width === 4 ? "selected" : ""}>4 px</option><option value="8" ${session.width === 8 ? "selected" : ""}>8 px</option></select>
      ${constraint.allowUndo === false ? "" : '<button id="undo-canvas" class="secondary icon-button" title="Letzte Form rückgängig" aria-label="Rückgängig">↶</button>'}
      ${constraint.allowClear === false ? "" : '<button id="clear-canvas" class="secondary" aria-label="Leinwand löschen">Leeren</button>'}</div></div>
      <div class="constraint-strip"><b>⚡ Einschränkung</b><span>${escapeHtml(constraint.label)}</span></div>` : ""}
    <div class="canvas-wrap"><canvas id="drawing-canvas" class="${isDrawer ? "" : "canvas-disabled"}"></canvas></div>
    <div class="canvas-footer">${isDrawer ? '<span>Wenn du fertig bist, kann die Gruppe raten.</span><button id="finish-drawing" class="primary finish-button">Zeichnung abgeben <span>→</span></button>' : '<span class="live-indicator">● LIVE</span><span>Diskutiert über Voice-Chat und einigt euch auf eure Vermutung.</span>'}</div>
  </section>
  <aside class="sidebar mission-sidebar panel"><div class="sidebar-heading"><div><span class="eyebrow">DEINE MISSION</span><h3>Geheime Infos</h3></div></div>${rolePanel(room)}${secret}
    <div class="score-card"><span>Punktestand</span><strong>${room.score === null ? "?" : `${room.score} / ${room.targetScore}`}</strong><small>${room.score === null ? "Bis zur Auflösung verdeckt" : "richtige Wörter für den Gruppensieg"}</small></div>
  </aside>`;
}

function guessingView(room) {
  return `<section class="main-stage decision-stage panel">
    <div class="guess-box"><div class="decision-icon">?</div><span class="eyebrow">GEMEINSAME LÖSUNG</span><h2>Welches Wort sucht die Gruppe?</h2>
      <p class="result-copy">Sprecht euch ab und meldet genau einen Begriff an. Ob er richtig ist, bleibt zunächst geheim.</p>
      ${room.canGuess ? `<form id="guess-form"><input id="guess-input" maxlength="50" value="${escapeHtml(session.guessDraft)}" placeholder="Euer endgültiges Lösungswort" autocomplete="off" required><button class="primary">Einloggen →</button></form>` : '<p class="hint">Wartet auf die gemeinsame Lösung.</p>'}
      <p class="decision-note">Jede aktive Person außer dem Zeichner kann den abgestimmten Begriff einloggen.</p>
    </div>
  </section><aside class="sidebar mission-sidebar panel"><div class="sidebar-heading"><div><span class="eyebrow">DEINE MISSION</span><h3>Geheime Infos</h3></div></div>${rolePanel(room)}</aside>`;
}

function votingView(room) {
  const eligible = room.players.filter((p) => p.alive && !p.sittingOut && p.id !== room.me);
  return `<section class="main-stage decision-stage panel"><div class="vote-stage">
    <span class="eyebrow">EURE EINGELOGGTE LÖSUNG</span><div class="locked-guess">„${escapeHtml(room.guess)}“</div>
    <h2>Wen haltet ihr für verdächtig?</h2><p class="result-copy">Wählt eine Person. Eure Stimmen bleiben bis zur Auswertung verdeckt.</p>
    <div class="vote-grid">${eligible.map((player) => `<button class="vote-player" data-vote="${player.id}" ${room.hasVoted ? "disabled" : ""}>
      <div class="avatar" style="background:${player.character.color}24">${player.character.icon}</div><div><strong>${escapeHtml(player.name)}</strong><span>Als Saboteur verdächtigen</span></div></button>`).join("")}</div>
    <div class="vote-progress"><strong>${room.votesCast} / ${room.activeVoters}</strong> Stimmen abgegeben${room.hasVoted ? " · Deine Stimme ist gespeichert" : ""}</div>
  </div></section><aside class="sidebar mission-sidebar panel"><div class="sidebar-heading"><div><span class="eyebrow">DEINE MISSION</span><h3>Geheime Infos</h3></div></div>${rolePanel(room)}<p class="hint">Erst wenn alle abgestimmt haben, wird ausgewertet.</p></aside>`;
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
    <p class="result-copy">Nach ${room.round} Runden und ${room.score} von ${room.targetScore} richtigen Wörtern stehen die geheimen Rollen fest.</p>
    <div class="reveal-list">${room.pendingReveal.map(item => `<div class="reveal-row"><span>Runde ${item.round}: <strong>${escapeHtml(item.word)}</strong></span><span class="${item.correct ? "success-text" : "danger-text"}">${item.correct ? "✓ richtig" : `✕ ${escapeHtml(item.guess)}`}</span></div>`).join("")}</div>
    ${room.hostId === room.me ? '<button id="reset-game" class="primary">Zurück in die Lobby <span>→</span></button>' : '<p class="hint">Der Host öffnet gleich die Lobby.</p>'}
  </div></section><aside class="sidebar panel"><h3>Rollen enthüllt</h3>${renderPlayerList(room)}</aside>`;
}

function renderGame() {
  const room = session.room;
  if (!room) return;
  const activeInput = document.activeElement;
  const restoreGuessFocus = activeInput?.id === "guess-input" && room.phase === "guessing";
  if (restoreGuessFocus) session.guessDraft = activeInput.value;
  const stage = room.phase === "lobby" ? lobbyView(room) :
    room.phase === "drawing" ? canvasView(room) :
    room.phase === "guessing" ? guessingView(room) :
    room.phase === "voting" ? votingView(room) :
    room.phase === "result" ? resultView(room) : gameoverView(room);
  $("#app").classList.add("game-active");
  $(".brand").classList.add("hidden");
  $("#game").innerHTML = `<div class="game-shell phase-${room.phase}">
    <header class="game-header panel"><div class="game-brand"><span class="brand-mark">✦</span><div><strong>Darwinci</strong><button data-copy-code class="inline-code">LOBBY ${room.code}</button></div></div>
      <div class="phase-track"><div class="phase-current"><span>${phaseText(room.phase)}</span><strong>${room.round ? `Runde ${room.round}` : "Lobby"}</strong></div><div class="phase-steps"><span class="${room.phase === "drawing" ? "active" : ""}">Zeichnen</span><i></i><span class="${room.phase === "guessing" ? "active" : ""}">Raten</span><i></i><span class="${room.phase === "voting" ? "active" : ""}">Abstimmen</span></div></div>
      <div class="header-actions"><div class="goal-stat"><span>ZIEL</span><strong>${room.score === null ? "?" : room.score}/${room.targetScore}</strong></div><div class="timer" id="phase-timer"><span>ZEIT</span><strong>${formatTime(room.deadline)}</strong></div><button id="leave-room" class="secondary compact" aria-label="Lobby verlassen">Verlassen</button></div>
    </header>
    ${room.phase !== "lobby" && room.phase !== "gameover" ? `<aside class="sidebar panel"><h3>Spieler · ${room.players.filter(p => p.alive).length} aktiv</h3>${renderPlayerList(room)}</aside>` : ""}
    ${stage}
  </div>`;
  bindGameControls();
  if (room.phase === "drawing") setupCanvas();
  const guessInput = $("#guess-input");
  if (guessInput && restoreGuessFocus) {
    guessInput.value = session.guessDraft;
    guessInput.focus();
    guessInput.setSelectionRange(session.guessDraft.length, session.guessDraft.length);
  }
}

function bindGameControls() {
  const room = session.room;
  $("#start-game")?.addEventListener("click", () => session.socket.emit("game:start"));
  $$("[data-copy-code]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast(`Lobby-Code ${room.code} kopiert.`);
    } catch {
      toast(`Lobby-Code: ${room.code}`);
    }
  }));
  $("#leave-room")?.addEventListener("click", () => {
    if (room.phase !== "lobby" && !confirm("Das laufende Spiel wirklich verlassen? Du wirst als ausgeschieden gewertet.")) return;
    session.socket.emit("lobby:leave");
  });
  $("#settings-form")?.addEventListener("change", (event) => {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    session.socket.emit("lobby:update-settings", data);
  });
  $("#next-round")?.addEventListener("click", () => session.socket.emit("game:next"));
  $("#reset-game")?.addEventListener("click", () => session.socket.emit("game:reset"));
  $("#finish-drawing")?.addEventListener("click", () => session.socket.emit("drawing:finish"));
  $("#guess-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    session.socket.emit("guess:submit", { guess: $("#guess-input").value });
    session.guessDraft = "";
  });
  $("#guess-input")?.addEventListener("input", (event) => {
    session.guessDraft = event.target.value;
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
  session.roundId = session.room.roundId;
  if (!session.room.constraint?.tools.includes(session.tool)) {
    session.tool = session.room.constraint?.tools[0] || "pen";
  }
  if (session.room.constraint?.fixedColor) session.color = session.room.constraint.fixedColor;
  else if (session.room.constraint?.singleColor && session.room.drawing.length) session.color = session.room.drawing[0].color;
  resizeCanvas();
  redraw();
  if (session.room.drawerId !== session.room.me) return;
  $$("[data-tool]").forEach((button) => button.addEventListener("click", () => {
    session.tool = button.dataset.tool;
    $$("[data-tool]").forEach((item) => item.classList.toggle("selected", item === button));
  }));
  $$("[data-color]").forEach((button) => button.addEventListener("click", () => {
    session.color = button.dataset.color;
    $$("[data-color]").forEach((item) => item.classList.toggle("selected", item === button));
  }));
  $("#stroke-width")?.addEventListener("change", (event) => { session.width = Number(event.target.value); });
  $("#clear-canvas")?.addEventListener("click", () => session.socket.emit("drawing:clear", { roundId: session.roundId }));
  $("#undo-canvas")?.addEventListener("click", () => session.socket.emit("drawing:undo", { roundId: session.roundId }));
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", cancelPointer);
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
  const hideExisting = session.room.drawerId === session.room.me && session.room.constraint?.hideExisting;
  if (!hideExisting) {
    for (const stroke of session.room.drawing || []) drawShape(stroke, rect);
  }
  if (session.drawing && session.points.length) {
    const preview = {
      type: session.tool,
      color: session.color,
      width: session.width,
      points: session.points,
      from: session.draftFrom,
      to: session.draftTo
    };
    drawShape(mirrorPreview(preview), rect);
  }
}

function drawShape(shape, rect) {
  const context = session.context;
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = shape.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (shape.type === "pen") {
    if (!shape.points?.length) return;
    const first = shape.points[0];
    if (shape.points.length === 1) {
      context.beginPath();
      context.arc(first.x * rect.width, first.y * rect.height, shape.width / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(first.x * rect.width, first.y * rect.height);
    for (const point of shape.points.slice(1)) context.lineTo(point.x * rect.width, point.y * rect.height);
    context.stroke();
    return;
  }
  if (!shape.from || !shape.to) return;
  const x1 = shape.from.x * rect.width;
  const y1 = shape.from.y * rect.height;
  const x2 = shape.to.x * rect.width;
  const y2 = shape.to.y * rect.height;
  context.beginPath();
  if (shape.type === "line") {
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
  } else if (shape.type === "ellipse") {
    context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
  } else if (shape.type === "rectangle") {
    context.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }
  context.stroke();
}

function mirrorPreview(shape) {
  if (!session.room.constraint?.mirrorX) return shape;
  const mirrorPoint = (point) => point && ({ ...point, x: 1 - point.x });
  return {
    ...shape,
    points: shape.points?.map(mirrorPoint),
    from: mirrorPoint(shape.from),
    to: mirrorPoint(shape.to)
  };
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
  const point = pointerPoint(event);
  session.points = [point];
  session.draftFrom = point;
  session.draftTo = point;
  redraw();
}

function pointerMove(event) {
  if (!session.drawing) return;
  const point = pointerPoint(event);
  session.draftTo = point;
  if (session.tool === "pen") {
    session.points.push(point);
    if (session.points.length > 1000) session.points.splice(1, 1);
  }
  redraw();
}

function pointerUp() {
  if (!session.drawing) return;
  session.drawing = false;
  const mark = {
    roundId: session.roundId,
    type: session.tool,
    color: session.color,
    width: session.width,
    points: session.tool === "pen" ? session.points : undefined,
    from: session.tool === "pen" ? undefined : session.draftFrom,
    to: session.tool === "pen" ? undefined : session.draftTo
  };
  session.points = [];
  session.draftFrom = null;
  session.draftTo = null;
  session.socket.emit("drawing:mark", mark);
}

function cancelPointer() {
  session.drawing = false;
  session.points = [];
  session.draftFrom = null;
  session.draftTo = null;
  redraw();
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
    if (timer) {
      const value = timer.querySelector("strong");
      if (value) value.textContent = formatTime(session.room.deadline);
    }
  }
}, 250);

renderCharacters();
if (session.code && session.playerId) connect();
