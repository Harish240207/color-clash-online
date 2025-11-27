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

const colorOverlay = document.getElementById("color-picker-overlay");
const colorButtons = document.querySelectorAll("#color-picker-overlay .color-btn");

let timerInterval = null;
let pendingWildIndex = null;
let pendingWildSourceEl = null;

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

// pick the correct PNG file for a card
function getCardImagePath(card) {
  if (card.type === "NUMBER") {
    return `cards/${card.color}_${card.value}.png`;
  }
  if (card.type === "SKIP") {
    return `cards/${card.color}_skip.png`;
  }
  if (card.type === "REVERSE") {
    return `cards/${card.color}_reverse.png`;
  }
  if (card.type === "DRAW_TWO") {
    return `cards/${card.color}_draw2.png`;
  }
  if (card.type === "WILD") {
    return "cards/wild.png";
  }
  if (card.type === "WILD_DRAW_FOUR") {
    return "cards/wild_draw4.png";
  }
  return "cards/wild.png"; // fallback
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
    topCardDiv.className = "card big-card";
    const imgPath = getCardImagePath(topCard);

    topCardDiv.innerHTML = `<img src="${imgPath}" alt="" class="card-img" />`;

    // small pop animation
    topCardDiv.classList.remove("top-card-pop");
    void topCardDiv.offsetWidth;
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
    const player = currentRoom.players[currentTurnIndex];
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
    btn.className = "card hand-card";

    const imgPath = getCardImagePath(card);
    btn.innerHTML = `<img src="${imgPath}" alt="" class="card-img" />`;

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

      if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") {
        // open color picker
        pendingWildIndex = index;
        pendingWildSourceEl = btn;
        openColorPicker();
      } else {
        animateCardToCenter(btn);
        socket.emit("playCard", { cardIndex: index });
      }
    });

    handCardsDiv.appendChild(btn);
  });
}

// ===== COLOR PICKER =====
function openColorPicker() {
  if (!colorOverlay) return;
  colorOverlay.classList.remove("hidden");
}

function closeColorPicker() {
  if (!colorOverlay) return;
  colorOverlay.classList.add("hidden");
  pendingWildIndex = null;
  pendingWildSourceEl = null;
}

colorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const chosenColor = btn.dataset.color;
    if (pendingWildIndex == null || !pendingWildSourceEl) {
      closeColorPicker();
      return;
    }
    animateCardToCenter(pendingWildSourceEl);
    socket.emit("playCard", {
      cardIndex: pendingWildIndex,
      chosenColor
    });
    closeColorPicker();
  });
});

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
