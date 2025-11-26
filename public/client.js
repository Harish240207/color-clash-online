const socket = io();

let myPlayerId = null;
let currentRoom = null;

const joinScreen = document.getElementById("join-screen");
const gameScreen = document.getElementById("game-screen");

const roomCodeInput = document.getElementById("room-code-input");
const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-button");
const joinError = document.getElementById("join-error");

const roomInfo = document.getElementById("room-info");
const playersList = document.getElementById("players-list");
const statusText = document.getElementById("status-text");
const topCardDiv = document.getElementById("top-card");

const startButton = document.getElementById("start-button");
const drawButton = document.getElementById("draw-button");
const passButton = document.getElementById("pass-button");

const handCardsDiv = document.getElementById("hand-cards");

const errorMessageDiv = document.getElementById("error-message");
const infoMessageDiv = document.getElementById("info-message");

// ===== helpers =====
function formatCardLabel(card) {
  switch (card.type) {
    case "NUMBER":
      return card.value;
    case "SKIP":
      return "⏭";
    case "REVERSE":
      return "🔄";
    case "DRAW_TWO":
      return "+2";
    case "WILD":
      return "★";
    case "WILD_DRAW_FOUR":
      return "+4";
    default:
      return "?";
  }
}

// client-side version of canPlay (same as server)
function canPlayClient(card, topCard) {
  if (!topCard) return true;

  if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") {
    return true;
  }

  if (card.color === topCard.color) return true;

  if (
    card.type === "NUMBER" &&
    topCard.type === "NUMBER" &&
    card.value === topCard.value
  ) {
    return true;
  }

  if (card.type === topCard.type && card.type !== "NUMBER") {
    return true;
  }

  return false;
}

function setError(msg) {
  errorMessageDiv.textContent = msg || "";
}

function setInfo(msg) {
  infoMessageDiv.textContent = msg || "";
}

function isMyTurn() {
  if (!currentRoom || !currentRoom.players) return false;
  const idx = currentRoom.players.findIndex((p) => p.id === myPlayerId);
  return idx !== -1 && idx === currentRoom.currentTurnIndex && currentRoom.started;
}

function isHost() {
  if (!currentRoom || !currentRoom.players) return false;
  const me = currentRoom.players.find((p) => p.id === myPlayerId);
  return !!(me && me.isHost);
}

// ===== JOIN FLOW =====
joinButton.addEventListener("click", () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();

  if (!roomCode || !name) {
    joinError.textContent = "Enter room code and name.";
    return;
  }
  joinError.textContent = "";
  socket.emit("joinRoom", { roomCode, playerName: name });
});

// ===== SOCKET EVENTS =====
socket.on("joinedRoom", ({ roomCode, playerId }) => {
  myPlayerId = playerId;
  setError("");
  setInfo("");

  joinScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  roomInfo.textContent = "Room: " + roomCode;
});

socket.on("gameState", (room) => {
  currentRoom = room;
  renderRoom();
});

socket.on("errorMessage", (msg) => {
  setError(msg);
});

socket.on("gameOver", ({ winnerId, winnerName }) => {
  if (winnerId === myPlayerId) {
    setInfo("🎉 You win!");
  } else {
    setInfo("🏆 " + winnerName + " wins!");
  }
});

// ===== RENDERING =====
function renderRoom() {
  if (!currentRoom) return;

  // --- players list ---
  playersList.innerHTML = "";
  currentRoom.players.forEach((p, index) => {
    const li = document.createElement("li");
    const leftSpan = document.createElement("span");
    const rightSpan = document.createElement("span");

    leftSpan.textContent = p.name;
    if (p.id === myPlayerId) {
      leftSpan.textContent += " (You)";
      li.classList.add("player-me");
    }

    if (p.isHost) {
      const hostTag = document.createElement("span");
      hostTag.textContent = "HOST";
      hostTag.className = "player-host-tag";
      leftSpan.appendChild(hostTag);
    }

    rightSpan.textContent = `Cards: ${p.hand.length}`;

    if (index === currentRoom.currentTurnIndex && currentRoom.started) {
      li.classList.add("player-turn");
    }

    li.appendChild(leftSpan);
    li.appendChild(rightSpan);
    playersList.appendChild(li);
  });

  // --- top card ---
  const topCard =
    currentRoom.discardPile[currentRoom.discardPile.length - 1] || null;

  if (topCard) {
    // add color class so background shows color
    topCardDiv.className = "card big-card " + (topCard.color || "");
    const colorLabel =
      !topCard.color || topCard.color === "wild"
        ? "ANY"
        : topCard.color.toUpperCase();

    topCardDiv.innerHTML = `
      <div class="card-content">
        <div class="card-symbol">${formatCardLabel(topCard)}</div>
        <div class="card-color-label">${colorLabel}</div>
      </div>
    `;
  } else {
    topCardDiv.className = "card big-card";
    topCardDiv.textContent = "";
  }

  // --- hand + buttons ---
  renderHand(topCard);

  const myTurn = isMyTurn();
  const me = currentRoom.players.find((p) => p.id === myPlayerId);
  let canPlayAny = false;
  if (me && topCard) {
    canPlayAny = me.hand.some((c) => canPlayClient(c, topCard));
  }

  if (!currentRoom.started) {
    statusText.textContent =
      "Waiting for host to start. Players: " + currentRoom.players.length;
  } else if (myTurn) {
    if (canPlayAny) {
      statusText.textContent =
        "Your turn: tap a card to play, or draw instead.";
    } else {
      statusText.textContent =
        "You have no playable card. Draw a card or pass.";
    }
  } else {
    const player = currentRoom.players[currentRoom.currentTurnIndex];
    statusText.textContent =
      "Waiting for " + (player ? player.name : "player") + "...";
  }

  startButton.disabled = !isHost() || currentRoom.started;
  drawButton.disabled = !myTurn;
  // cannot pass if you still have a playable card
  passButton.disabled = !myTurn || canPlayAny;
}

function renderHand(topCard) {
  handCardsDiv.innerHTML = "";
  if (!currentRoom) return;
  const me = currentRoom.players.find((p) => p.id === myPlayerId);
  if (!me) return;

  me.hand.forEach((card, index) => {
    const btn = document.createElement("button");
    btn.className = "card hand-card " + (card.color || "");
    btn.innerHTML = `
      <div class="card-content">
        <div class="card-symbol">${formatCardLabel(card)}</div>
        <div class="card-color-label">${
          card.color ? card.color.toUpperCase() : ""
        }</div>
      </div>
    `;
    btn.addEventListener("click", () => {
      if (!isMyTurn()) {
        setError("It's not your turn.");
        return;
      }
      if (!canPlayClient(card, topCard)) {
        setError("You can't play that card.");
        return;
      }
      setError("");
      socket.emit("playCard", { cardIndex: index });
    });
    handCardsDiv.appendChild(btn);
  });
}

// ===== BUTTON ACTIONS =====
startButton.addEventListener("click", () => {
  if (!isHost()) {
    setError("Only the host can start.");
    return;
  }
  setError("");
  socket.emit("startGame");
});

drawButton.addEventListener("click", () => {
  if (!isMyTurn()) {
    setError("Not your turn.");
    return;
  }
  setError("");
  socket.emit("drawCard");
});

passButton.addEventListener("click", () => {
  if (!isMyTurn()) {
    setError("Not your turn.");
    return;
  }
  setError("");
  socket.emit("passTurn");
});
