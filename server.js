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

// table seats
const seatTop = document.getElementById("seat-top");
const seatLeft = document.getElementById("seat-left");
const seatRight = document.getElementById("seat-right");
const seatBottom = document.getElementById("seat-bottom");

let timerInterval = null;
let pendingWildIndex = null;
let pendingWildSourceEl = null;

// ===== card helpers =====

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

// same logic as server for client-side validation
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

// sort by color then type/value (client side, for display)
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const TYPE_ORDER = {
  NUMBER: 0,
  SKIP: 1,
  REVERSE: 2,
  DRAW_TWO: 3,
  WILD: 4,
  WILD_DRAW_FOUR: 5,
};

function compareCardsClient(a, b) {
  const ca = COLOR_ORDER[a.color] ?? 99;
  const cb = COLOR_ORDER[b.color] ?? 99;
  if (ca !== cb) return ca - cb;

  if (a.type === "NUMBER" && b.type === "NUMBER") {
    return (a.value ?? 0) - (b.value ?? 0);
  }

  const ta = TYPE_ORDER[a.type] ?? 99;
  const tb = TYPE_ORDER[b.type] ?? 99;
  return ta - tb;
}

function getTeamLabel(teamIndex) {
  if (teamIndex === 0) return "Team 1";
  if (teamIndex === 1) return "Team 2";
  return null;
}

// ===== general helpers =====

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

// ===== join flow =====

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

// ===== socket events =====

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

socket.on("gameOver", ({ winnerId, winnerName, teamIndex, teammates }) => {
  if (typeof teamIndex === "number") {
    const label = getTeamLabel(teamIndex) || "Team";
    const names = (teammates || [])
      .map((t) => (t.id === winnerId ? `${t.name} (winner)` : t.name))
      .join(", ");
    if (teammates && teammates.length > 1) {
      setInfo(`🏆 ${label} wins! Players: ${names}`);
    } else {
      setInfo(`🏆 ${label} wins! Winner: ${winnerName}`);
    }
  } else {
    if (winnerId === myPlayerId) {
      setInfo("🎉 You win!");
    } else {
      setInfo("🏆 " + winnerName + " wins!");
    }
  }

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  turnTimerDiv.textContent = "";
});

// ===== rendering =====

function renderRoom() {
  if (!currentRoom) return;

  // players list on left
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

    if (typeof p.team === "number") {
      const teamTag = document.createElement("span");
      teamTag.textContent = getTeamLabel(p.team);
      teamTag.className = "player-team-tag";
      leftSpan.appendChild(teamTag);
    }

    rightSpan.textContent = `Cards: ${p.hand.length}`;

    if (index === currentRoom.currentTurnIndex && currentRoom.started) {
      li.classList.add("player-turn");
    }

    li.appendChild(leftSpan);
    li.appendChild(rightSpan);
    playersList.appendChild(li);
  });

  // table seats
  renderSeats();

  // top card
  const topCard =
    currentRoom.discardPile && currentRoom.discardPile.length
      ? currentRoom.discardPile[currentRoom.discardPile.length - 1]
      : null;

  if (topCard) {
    topCardDiv.className = "card big-card";
    const imgPath = getCardImagePath(topCard);
    topCardDiv.innerHTML = `<img src="${imgPath}" alt="" class="card-img" />`;

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
    const player = currentRoom.players[currentRoom.currentTurnIndex];
    statusText.textContent =
      "Waiting for " + (player ? player.name : "player") + "...";
  }

  startButton.disabled = !isHost() || currentRoom.started;
  drawButton.disabled = !myTurn;

  setupTimer();
}

// seats: you = bottom, then others: top, right, left
function renderSeats() {
  if (!currentRoom || !currentRoom.players) {
    seatTop.innerHTML = "";
    seatLeft.innerHTML = "";
    seatRight.innerHTML = "";
    seatBottom.innerHTML = "";
    return;
  }

  const players = currentRoom.players;
  const myIndex = players.findIndex((p) => p.id === myPlayerId);

  const ordered = [];
  if (myIndex === -1) {
    for (let i = 0; i < players.length && ordered.length < 4; i++) {
      ordered.push({ player: players[i], index: i });
    }
  } else {
    ordered.push({ player: players[myIndex], index: myIndex });
    for (let step = 1; step < players.length && ordered.length < 4; step++) {
      const idx = (myIndex + step) % players.length;
      ordered.push({ player: players[idx], index: idx });
    }
  }

  // order of seats: bottom (you), top, right, left
  const slots = [seatBottom, seatTop, seatRight, seatLeft];
  slots.forEach((seat) => (seat.innerHTML = ""));

  ordered.forEach((entry, i) => {
    const seat = slots[i];
    if (!seat) return;

    const { player, index } = entry;
    const isMe = player.id === myPlayerId;
    const isTurn = index === currentRoom.currentTurnIndex && currentRoom.started;

    const wrapper = document.createElement("div");
    wrapper.className = "seat-wrapper" + (isTurn ? " seat-turn" : "");
    if (isMe) wrapper.classList.add("seat-me");

    const nameDiv = document.createElement("div");
    nameDiv.className = "seat-name";

    let label = player.name;
    if (isMe) label += " (You)";
    if (typeof player.team === "number") {
      label += " · " + getTeamLabel(player.team);
    }
    nameDiv.textContent = label;

    const cardsDiv = document.createElement("div");
    cardsDiv.className = "seat-cards";
    const countDiv = document.createElement("div");
    countDiv.className = "seat-card-count";
    countDiv.textContent = player.hand.length;

    const stackDiv = document.createElement("div");
    stackDiv.className = "seat-card-stack";
    const backsToShow = Math.min(3, player.hand.length);
    for (let i2 = 0; i2 < backsToShow; i2++) {
      const back = document.createElement("div");
      back.className = "seat-card-back";
      stackDiv.appendChild(back);
    }

    cardsDiv.appendChild(stackDiv);
    cardsDiv.appendChild(countDiv);
    wrapper.appendChild(nameDiv);
    wrapper.appendChild(cardsDiv);

    seat.appendChild(wrapper);
  });
}

function renderHand(topCard) {
  handCardsDiv.innerHTML = "";
  if (!currentRoom) return;
  const me = currentRoom.players.find((p) => p.id === myPlayerId);
  if (!me) return;

  // sort by color/number for display, but remember original index
  const sorted = me.hand
    .map((card, idx) => ({ card, idx }))
    .sort((a, b) => compareCardsClient(a.card, b.card));

  sorted.forEach(({ card, idx }) => {
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
        pendingWildIndex = idx; // original index in hand
        pendingWildSourceEl = btn;
        openColorPicker();
      } else {
        animateCardToCenter(btn);
        socket.emit("playCard", { cardIndex: idx });
      }
    });

    handCardsDiv.appendChild(btn);
  });
}

// ===== color picker for wilds =====

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
      chosenColor,
    });
    closeColorPicker();
  });
});

// ===== card drop animation =====

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

// ===== timer UI =====

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

// ===== buttons =====

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
