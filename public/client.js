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
const turnTimerDiv = document.getElementById("turn-timer");
const topCardDiv = document.getElementById("top-card");

const startButton = document.getElementById("start-button");
const drawButton = document.getElementById("draw-button");

const handCardsDiv = document.getElementById("hand-cards");

const errorMessageDiv = document.getElementById("error-message");
const infoMessageDiv = document.getElementById("info-message");

let timerInterval = null;

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

function canPlayClient(card, topCard) {
  if (!topCard) return true;
  if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") return true;
  if (card.color === topCard.color) return true;
  if (
    card.type === "NUMBER" &&
    topCard.type === "NUMBER" &&
    card.value === topCard.value
  )
    return true;
  if (card.type === topCard.type && card.type !== "NUMBER") return true;
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
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  turnTimerDiv.textContent = "";
});

// ===== RENDERING =====
function renderRoom() {
  if (!currentRoom) return;

  // players list
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

  // top card
  const topCard =
    currentRoom.discardPile && currentRoom.discardPile.length
      ? currentRoom.discardPile[currentRoom.discardPile.length - 1]
      : null;

  if (topCard) {
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

    // small pop animation when top card changes
    topCardDiv.classList.remove("top-card-pop");
    void topCardDiv.offsetWidth; // force reflow
    topCardDiv.classList.add("top-card-pop");
  } else {
    topCardDiv.className = "card big-card";
    topCardDiv.textContent = "";
  }

  // hand
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
      statusText.textContent = "Your turn: tap a card to play, or draw 1 card.";
    } else {
      statusText.textContent = "You have no playable card. Draw 1 card.";
    }
  } else {
    const player = currentRoom.players[currentRoom.currentTurnIndex];
    statusText.textContent =
      "Waiting for " + (player ? player.name : "player") + "...";
  }

  startButton.disabled = !isHost() || currentRoom.started;
  drawButton.disabled = !myTurn;

  setupTimer();
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

      // animate this card flying to the top card position
      animateCardToCenter(btn);

      socket.emit("playCard", { cardIndex: index });
    });
    handCardsDiv.appendChild(btn);
  });
}

// ===== CARD DROP ANIMATION =====
function animateCardToCenter(sourceEl) {
  if (!topCardDiv) return;

  const srcRect = sourceEl.getBoundingClientRect();
  const destRect = topCardDiv.getBoundingClientRect();

  const clone = sourceEl.cloneNode(true);
  clone.classList.add("flying-card");
  clone.style.position = "fixed";
  clone.style.left = srcRect.left + "px";
  clone.style.top = srcRect.top + "px";
  clone.style.width = srcRect.width + "px";
  clone.style.height = srcRect.height + "px";
  clone.style.zIndex = "9999";

  document.body.appendChild(clone);

  const srcCenterX = srcRect.left + srcRect.width / 2;
  const srcCenterY = srcRect.top + srcRect.height / 2;
  const destCenterX = destRect.left + destRect.width / 2;
  const destCenterY = destRect.top + destRect.height / 2;

  const dx = destCenterX - srcCenterX;
  const dy = destCenterY - srcCenterY;

  // trigger transition
  requestAnimationFrame(() => {
    clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.9) rotate(8deg)`;
    clone.style.opacity = "0.85";
  });

  clone.addEventListener(
    "transitionend",
    () => {
      clone.remove();
    },
    { once: true }
  );
}

// ===== TIMER UI =====
function setupTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (!currentRoom || !currentRoom.started || !currentRoom.turnDeadline) {
    turnTimerDiv.textContent = "";
    return;
  }

  const update = () => {
    if (!currentRoom || !currentRoom.turnDeadline) {
      turnTimerDiv.textContent = "";
      return;
    }
    const now = Date.now();
    let remaining = currentRoom.turnDeadline - now;
    if (remaining < 0) remaining = 0;
    const seconds = Math.ceil(remaining / 1000);
    turnTimerDiv.textContent = "Time left: " + seconds + "s";
  };

  update();
  timerInterval = setInterval(update, 300);
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
