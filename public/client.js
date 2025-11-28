/* ============================================================
   CLIENT-SIDE GAME LOGIC FOR COLOR CLASH ONLINE
   (Updated for Galaxy UI + Circular Layout)
   ============================================================ */

const socket = io();

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let myPlayerId = null;
let currentRoom = null;

let guestName = null;
let selectedAvatar = null;
let pendingWildIndex = null;
let pendingSourceEl = null;
let unoArmed = false;

let timerInterval = null;

let useCircular = false; // <-- TRUE when 3+ players

/* ============================================================
   ELEMENTS
   ============================================================ */

// Login
const nameInput = document.getElementById("name-input");
const loginScreen = document.getElementById("login-screen");
const guestBtn = document.getElementById("guest-login-btn");
const avatarSelectPanel = document.getElementById("avatar-select");
const joinPanel = document.getElementById("join-panel");
const fullscreenButton = document.getElementById("fullscreen-button");

const emojiGrid = document.getElementById("emoji-grid");
const avatarUpload = document.getElementById("avatar-upload");
const avatarPreview = document.getElementById("avatar-preview");

const roomCodeInput = document.getElementById("room-code-input");
const joinButton = document.getElementById("join-button");
const joinError = document.getElementById("join-error");

// Game UI
const gameScreen = document.getElementById("game-screen");
const roomInfo = document.getElementById("room-info");

const playersList = document.getElementById("players-list");

const statusText = document.getElementById("status-text");
const turnTimer = document.getElementById("turn-timer");

const topCardDiv = document.getElementById("top-card");

// Classic seats
const seatTop = document.getElementById("seat-top");
const seatLeft = document.getElementById("seat-left");
const seatRight = document.getElementById("seat-right");
const seatBottom = document.getElementById("seat-bottom");

// Circular layout
const playersRing = document.getElementById("players-ring");

// Table + center
const centerCardArea = document.getElementById("center-card-area");

const startButton = document.getElementById("start-button");
const drawButton = document.getElementById("draw-button");
const unoButton = document.getElementById("uno-button");

const handCardsDiv = document.getElementById("hand-cards");
const teammateHandsDiv = document.getElementById("teammate-hands");

// Chat
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatEmojiButtons = document.querySelectorAll(".chat-emoji");

// Messages
const errorMessage = document.getElementById("error-message");
const infoMessage = document.getElementById("info-message");

// Wild picker
const colorOverlay = document.getElementById("color-picker-overlay");
const colorButtons = document.querySelectorAll(".color-btn");

// Leaderboard
const leaderboardOverlay = document.getElementById("leaderboard-overlay");
const leaderboardList = document.getElementById("leaderboard-list");
const leaderboardClose = document.getElementById("leaderboard-close");

// Rotate overlay
const rotateOverlay = document.getElementById("rotate-overlay");

/* ============================================================
   HELPERS
   ============================================================ */
function setError(msg) { errorMessage.textContent = msg || ""; }
function setInfo(msg) { infoMessage.textContent = msg || ""; }

function isMyTurn() {
  if (!currentRoom) return false;
  const idx = currentRoom.players.findIndex(p => p.id === myPlayerId);
  return idx !== -1 && idx === currentRoom.currentTurnIndex && currentRoom.started;
}

function isHost() {
  if (!currentRoom) return false;
  const me = currentRoom.players.find(p => p.id === myPlayerId);
  return me && me.isHost;
}

/* ============================================================
   IMAGE RESOLVER
   ============================================================ */
function getCardImage(card) {
  if (!card) return "cards/wild.png";

  const color = (card.color || "").toLowerCase();
  const value = card.value;

  if (card.type === "NUMBER") return `cards/${color}_${value}.png`;
  if (card.type === "SKIP") return `cards/${color}_skip.png`;
  if (card.type === "REVERSE") return `cards/${color}_reverse.png`;
  if (card.type === "DRAW_TWO") return `cards/${color}_draw2.png`;
  if (card.type === "WILD") return "cards/wild.png";
  if (card.type === "WILD_DRAW_FOUR") return "cards/wild_draw4.png";

  return "cards/wild.png";
}

/* ============================================================
   GUEST LOGIN
   ============================================================ */

guestBtn.addEventListener("click", () => {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  guestName = `Guest#${randomNum}`;
  nameInput.value = guestName;

  avatarSelectPanel.classList.remove("hidden");
  joinPanel.classList.remove("hidden");
  setInfo("Select an avatar and join a room.");
});

/* Emoji selection */
emojiGrid.innerHTML = "";
["😀","😎","🤖","👽","🐱","🐶","🦊","🦁","👺","👻","🐵","🦉"].forEach(em => {
  const span = document.createElement("span");
  span.textContent = em;
  span.addEventListener("click", () => {
    selectedAvatar = { type: "emoji", value: em };
    avatarPreview.innerHTML = `<div style="font-size:80px">${em}</div>`;
  });
  emojiGrid.appendChild(span);
});

/* Avatar upload */
avatarUpload.addEventListener("change", () => {
  const file = avatarUpload.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    selectedAvatar = { type: "image", value: reader.result };
    avatarPreview.innerHTML = `<img src="${reader.result}"/>`;
  };
  reader.readAsDataURL(file);
});

/* ============================================================
   JOIN ROOM
   ============================================================ */
joinButton.addEventListener("click", () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  guestName = nameInput.value.trim();

  if (!guestName) return joinError.textContent = "Enter a name.";
  if (!selectedAvatar) return joinError.textContent = "Choose an avatar.";
  if (!roomCode) return joinError.textContent = "Enter room code.";

  joinError.textContent = "";

  socket.emit("joinRoom", {
    roomCode,
    name: guestName,
    avatar: selectedAvatar
  });
});

/* ============================================================
   SOCKET EVENTS
   ============================================================ */
socket.on("joinedRoom", ({ roomCode, playerId }) => {
  myPlayerId = playerId;
  loginScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  roomInfo.textContent = `Room: ${roomCode}`;
});

socket.on("gameState", room => {
  currentRoom = room;

  // SWITCH LAYOUT
  useCircular = currentRoom.players.length >= 3;

  renderRoom();
});

socket.on("errorMessage", msg => setError(msg));
socket.on("gameOver", data => showLeaderboard(data));

socket.on("chatMessage", ({ from, text }) => {
  const row = document.createElement("div");
  row.className = "chat-message";

  const nameSpan = document.createElement("span");
  nameSpan.className = "chat-name";
  nameSpan.textContent = from + ":";

  const textSpan = document.createElement("span");
  textSpan.className = "chat-text";
  textSpan.textContent = text;

  row.appendChild(nameSpan);
  row.appendChild(textSpan);
  chatMessages.appendChild(row);

  chatMessages.scrollTop = chatMessages.scrollHeight;
});

/* ============================================================
   RENDER ROOM
   ============================================================ */
function renderRoom() {
  if (!currentRoom) return;

  renderPlayersList();
  renderTopCard();
  renderHand();
  renderTeammates();
  updateActions();
  updateTimer();

  if (useCircular) {
    renderCircularLayout();
    hideClassicSeats();
  } else {
    showClassicSeats();
    renderSeats();
  }
}

/* ============================================================
   1. PLAYERS PANEL (left side)
   ============================================================ */
function renderPlayersList() {
  playersList.innerHTML = "";

  currentRoom.players.forEach((p, index) => {
    const li = document.createElement("li");

    /* Avatar */
    const av = document.createElement("div");
    av.className = "player-avatar-small";
    if (p.avatar.type === "emoji") {
      av.innerHTML = `<div style="font-size:24px">${p.avatar.value}</div>`;
    } else {
      av.innerHTML = `<img src="${p.avatar.value}"/>`;
    }

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.appendChild(av);

    const name = document.createElement("span");
    name.textContent = p.name + (p.id === myPlayerId ? " (You)" : "");
    left.appendChild(name);

    const right = document.createElement("span");
    right.textContent = `💰 ${p.coins}`;

    if (currentRoom.started && index === currentRoom.currentTurnIndex)
      li.classList.add("player-turn");
    if (p.id === myPlayerId) li.classList.add("player-me");

    if (p.isHost) {
      const tag = document.createElement("span");
      tag.className = "player-host-tag";
      tag.textContent = "HOST";
      left.appendChild(tag);
    }

    li.appendChild(left);
    li.appendChild(right);
    playersList.appendChild(li);
  });
}

/* ============================================================
   2A. CLASSIC SEAT RENDERING (2 players)
   ============================================================ */
function renderSeats() {
  seatTop.innerHTML = "";
  seatBottom.innerHTML = "";
  seatLeft.innerHTML = "";
  seatRight.innerHTML = "";

  const arr = currentRoom.players;
  const meIndex = arr.findIndex(p => p.id === myPlayerId);

  let ordered = [];
  if (meIndex === -1) {
    ordered = arr.slice(0, 4);
  } else {
    ordered.push(arr[meIndex]);
    for (let i = 1; i < arr.length && ordered.length < 4; i++) {
      ordered.push(arr[(meIndex + i) % arr.length]);
    }
  }

  const seats = [seatBottom, seatTop, seatRight, seatLeft];

  ordered.forEach((p, i) => {
    const seat = seats[i];
    if (!seat) return;

    const wrap = document.createElement("div");
    wrap.className = "seat-wrapper";

    const av = document.createElement("div");
    av.className = "seat-avatar";
    if (p.avatar.type === "emoji") {
      av.innerHTML = `<div style="font-size:32px">${p.avatar.value}</div>`;
    } else {
      av.innerHTML = `<img src="${p.avatar.value}"/>`;
    }

    const name = document.createElement("div");
    name.className = "seat-name";
    name.textContent = p.name;

    const count = document.createElement("div");
    count.className = "seat-card-count";
    const n = Array.isArray(p.hand) ? p.hand.length : p.handSize;
    count.textContent = p.id === myPlayerId ? `Your cards: ${n}` : `${n} card${n === 1 ? "" : "s"}`;

    if (arr[currentRoom.currentTurnIndex].id === p.id)
      wrap.style.boxShadow = "0 0 0 2px #38bdf8";

    wrap.appendChild(av);
    wrap.appendChild(name);
    wrap.appendChild(count);
    seat.appendChild(wrap);
  });
}

function hideClassicSeats() {
  seatTop.style.display = "none";
  seatLeft.style.display = "none";
  seatRight.style.display = "none";
  seatBottom.style.display = "none";
}
function showClassicSeats() {
  seatTop.style.display = "";
  seatLeft.style.display = "";
  seatRight.style.display = "";
  seatBottom.style.display = "";
}

/* ============================================================
   2B. CIRCULAR GALAXY LAYOUT (3+ players)
   ============================================================ */
function renderCircularLayout() {
  playersRing.innerHTML = "";

  const arr = currentRoom.players;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  const radius = Math.min(cx, cy) - 150;

  arr.forEach((p, index) => {
    const angle = (2 * Math.PI * index) / arr.length;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    /* Bubble */
    const bubble = document.createElement("div");
    bubble.className = "player-bubble";

    if (p.avatar.type === "emoji") {
      bubble.textContent = p.avatar.value;
    } else {
      bubble.innerHTML = `<img src="${p.avatar.value}"/>`;
    }

    bubble.style.left = (x - 45) + "px";
    bubble.style.top = (y - 45) + "px";

    if (arr[currentRoom.currentTurnIndex].id === p.id) {
      bubble.classList.add("turn");
    }

    /* Name */
    const name = document.createElement("div");
    name.className = "player-name-tag";
    name.textContent = (p.id === myPlayerId ? "(You) " : "") + p.name;
    name.style.left = (x - 60) + "px";
    name.style.top = (y + 50) + "px";

    /* Card count */
    const n = Array.isArray(p.hand) ? p.hand.length : p.handSize;
    const count = document.createElement("div");
    count.className = "player-cardcount";
    count.textContent = `${n} cards`;
    count.style.left = (x - 65) + "px";
    count.style.top = (y + 70) + "px";

    playersRing.appendChild(bubble);
    playersRing.appendChild(name);
    playersRing.appendChild(count);
  });
}

/* ============================================================
   3. TOP CARD — STACKED STYLE
   ============================================================ */
function renderTopCard() {
  centerCardArea.innerHTML = "";

  const pile = currentRoom.discardPile;
  const top = pile[pile.length - 1];
  if (!top) return;

  /* STACKS */
  const stack2 = document.createElement("div");
  stack2.className = "stack2";
  centerCardArea.appendChild(stack2);

  const stack1 = document.createElement("div");
  stack1.className = "stack1";
  centerCardArea.appendChild(stack1);

  /* TOP CARD */
  const card = document.createElement("div");
  card.className = "card big-card";
  card.innerHTML = `<img src="${getCardImage(top)}" class="card-img"/>`;

  if (top.type === "WILD" || top.type === "WILD_DRAW_FOUR") {
    if (["red","yellow","green","blue"].includes(top.color)) {
      const dot = document.createElement("div");
      dot.className = `wild-color-indicator wild-${top.color}`;
      card.appendChild(dot);
    }
  }

  centerCardArea.appendChild(card);
}

/* ============================================================
   4. HAND (Curved)
   ============================================================ */
function renderHand() {
  handCardsDiv.innerHTML = "";

  const me = currentRoom.players.find(p => p.id === myPlayerId);
  if (!me) return;

  const top = currentRoom.discardPile[currentRoom.discardPile.length - 1];

  me.hand.forEach((card, i) => {
    const btn = document.createElement("button");
    btn.className = "card hand-card";
    btn.innerHTML = `<img src="${getCardImage(card)}" class="card-img"/>`;

    btn.addEventListener("click", () => {
      if (!isMyTurn()) return setError("Not your turn.");
      if (!canPlay(card, top)) return setError("Can't play that.");
      setError("");

      if (card.type.includes("WILD")) {
        pendingWildIndex = i;
        pendingSourceEl = btn;
        colorOverlay.classList.remove("hidden");
      } else {
        animateCard(btn);
        socket.emit("playCard", { cardIndex: i });
      }
    });

    handCardsDiv.appendChild(btn);
  });
}

/* ============================================================
   5. TEAMMATES
   ============================================================ */
function renderTeammates() {
  teammateHandsDiv.innerHTML = "";
  const me = currentRoom.players.find(p => p.id === myPlayerId);
  if (!me || me.team == null) return;

  const mates = currentRoom.players.filter(
    p => p.id !== myPlayerId && p.team === me.team
  );

  mates.forEach(p => {
    const row = document.createElement("div");
    row.className = "teammate-hand-row";

    const label = document.createElement("div");
    label.className = "teammate-hand-label";
    label.textContent = `${p.name}'s cards`;
    row.appendChild(label);

    const cardsDiv = document.createElement("div");
    cardsDiv.className = "teammate-hand-cards";

    p.hand.forEach(card => {
      const el = document.createElement("div");
      el.className = "card teammate-card";
      el.innerHTML = `<img src="${getCardImage(card)}" class="card-img"/>`;
      cardsDiv.appendChild(el);
    });

    row.appendChild(cardsDiv);
    teammateHandsDiv.appendChild(row);
  });
}

/* ============================================================
   6. ACTIONS
   ============================================================ */
startButton.addEventListener("click", () => {
  if (!isHost()) return setError("Only host can start.");
  socket.emit("startGame");
});

drawButton.addEventListener("click", () => {
  if (!isMyTurn()) return setError("Not your turn.");
  socket.emit("drawCard");
});

unoButton.addEventListener("click", () => {
  const me = currentRoom.players.find(p => p.id === myPlayerId);
  if (!me || me.hand.length !== 2) return;
  unoArmed = true;
  socket.emit("pressUno");
  setInfo("UNO activated!");
});

function updateActions() {
  const myTurn = isMyTurn();
  const me = currentRoom.players.find(p => p.id === myPlayerId);

  startButton.disabled = !isHost() || currentRoom.started;
  drawButton.disabled = !myTurn;

  if (!currentRoom.started) {
    statusText.textContent = `Waiting for host to start. Players: ${currentRoom.players.length}`;
  } else if (myTurn) {
    statusText.textContent = "Your turn!";
  } else {
    const p = currentRoom.players[currentRoom.currentTurnIndex];
    statusText.textContent = `Waiting for ${p.name}...`;
  }

  // UNO button
  if (me && me.hand.length === 2 && myTurn) {
    unoButton.disabled = false;
    unoButton.classList.add("uno-active");
  } else {
    unoButton.disabled = true;
    unoButton.classList.remove("uno-active");
    unoArmed = false;
  }
}

/* ============================================================
   7. TIMER
   ============================================================ */
function updateTimer() {
  if (timerInterval) clearInterval(timerInterval);

  if (!currentRoom.started || !currentRoom.turnDeadline) {
    turnTimer.textContent = "";
    return;
  }

  const update = () => {
    const ms = currentRoom.turnDeadline - Date.now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    turnTimer.textContent = `Time left: ${s}s`;
  };

  update();
  timerInterval = setInterval(update, 300);
}

/* ============================================================
   8. WILD COLOR PICKER
   ============================================================ */
colorButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const color = btn.dataset.color;

    animateCard(pendingSourceEl);
    socket.emit("playCard", {
      cardIndex: pendingWildIndex,
      chosenColor: color
    });

    pendingWildIndex = null;
    pendingSourceEl = null;
    colorOverlay.classList.add("hidden");
  });
});

/* ============================================================
   9. CHAT
   ============================================================ */
function sendChat() {
  const text = (chatInput.value || "").trim();
  if (!text) return;

  socket.emit("chatMessage", { text });
  chatInput.value = "";
}
chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChat();
  }
});
chatEmojiButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    chatInput.value += btn.textContent;
    chatInput.focus();
  });
});

/* ============================================================
   10. LEADERBOARD
   ============================================================ */
function showLeaderboard(data) {
  leaderboardOverlay.classList.remove("hidden");
  leaderboardList.innerHTML = "";

  data.standings.forEach(entry => {
    const row = document.createElement("div");
    row.className = "leaderboard-entry";
    if (entry.isWinner) row.classList.add("winner-entry");

    const av = document.createElement("div");
    av.className = "lb-avatar";
    if (entry.avatar.type === "emoji") {
      av.innerHTML = `<div style="font-size:40px">${entry.avatar.value}</div>`;
    } else {
      av.innerHTML = `<img src="${entry.avatar.value}"/>`;
    }

    const name = document.createElement("div");
    name.innerHTML = `<strong>${entry.name}</strong><br>💰${entry.coins}`;

    row.appendChild(av);
    row.appendChild(name);
    leaderboardList.appendChild(row);
  });
}

leaderboardClose.addEventListener("click", () => {
  leaderboardOverlay.classList.add("hidden");
});

/* ============================================================
   11. ANIMATION — Card Fly
   ============================================================ */
function animateCard(sourceEl) {
  if (!sourceEl || !centerCardArea) return;

  const src = sourceEl.getBoundingClientRect();
  const dest = centerCardArea.getBoundingClientRect();

  const clone = sourceEl.cloneNode(true);
  clone.classList.add("flying-card");
  clone.style.position = "fixed";
  clone.style.left = src.left + "px";
  clone.style.top = src.top + "px";
  clone.style.width = src.width + "px";
  clone.style.height = src.height + "px";
  clone.style.zIndex = 9999;
  clone.style.transition = "transform 0.35s ease, opacity 0.35s ease";

  document.body.appendChild(clone);

  const dx = dest.left + dest.width / 2 - (src.left + src.width / 2);
  const dy = dest.top + dest.height / 2 - (src.top + src.height / 2);

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.8) rotate(8deg)`;
    clone.style.opacity = "0.4";
  });

  clone.addEventListener("transitionend", () => clone.remove());
}

/* ============================================================
   12. ORIENTATION WARNING
   ============================================================ */
function checkOrientation() {
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  rotateOverlay.classList.toggle("hidden", !isPortrait);
}

checkOrientation();
window.addEventListener("resize", checkOrientation);
window.addEventListener("orientationchange", checkOrientation);

/* ============================================================
   13. FULLSCREEN
   ============================================================ */
fullscreenButton.addEventListener("click", () => {
  const elem = document.documentElement;
  if (!document.fullscreenElement && elem.requestFullscreen) {
    elem.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
});
