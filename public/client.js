/* ============================================================
   CLIENT-SIDE GAME LOGIC FOR COLOR CLASH ONLINE
   ============================================================ */

const socket = io();

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let myPlayerId = null;
let currentRoom = null;

let guestName = null;
let selectedAvatar = null;    // emoji or base64 image
let pendingWildIndex = null;
let pendingSourceEl = null;
let unoArmed = false;

let timerInterval = null;

/* ============================================================
   ELEMENTS
   ============================================================ */

// Login / avatar / join
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

// Game screen
const gameScreen = document.getElementById("game-screen");
const roomInfo = document.getElementById("room-info");

const playersList = document.getElementById("players-list");
const statusText = document.getElementById("status-text");
const turnTimer = document.getElementById("turn-timer");

const topCardDiv = document.getElementById("top-card");

const seatTop = document.getElementById("seat-top");
const seatLeft = document.getElementById("seat-left");
const seatRight = document.getElementById("seat-right");
const seatBottom = document.getElementById("seat-bottom");

const startButton = document.getElementById("start-button");
const drawButton = document.getElementById("draw-button");
const unoButton = document.getElementById("uno-button");

const handCardsDiv = document.getElementById("hand-cards");
const teammateHandsDiv = document.getElementById("teammate-hands");

const errorMessage = document.getElementById("error-message");
const infoMessage = document.getElementById("info-message");

// Wild color picker
const colorOverlay = document.getElementById("color-picker-overlay");
const colorButtons = document.querySelectorAll(".color-btn");

// Leaderboard
const leaderboardOverlay = document.getElementById("leaderboard-overlay");
const leaderboardList = document.getElementById("leaderboard-list");
const leaderboardClose = document.getElementById("leaderboard-close");

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */

function setError(msg) {
  errorMessage.textContent = msg || "";
}
function setInfo(msg) {
  infoMessage.textContent = msg || "";
}

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

function getCardImage(card) {
  if (!card) return "cards/wild.png";

  const color = (card.color || "").toLowerCase(); // defensive: handle case issues
  const value = card.value;

  if (card.type === "NUMBER") return `cards/${color}_${value}.png`;
  if (card.type === "SKIP") return `cards/${color}_skip.png`;
  if (card.type === "REVERSE") return `cards/${color}_reverse.png`;
  if (card.type === "DRAW_TWO") return `cards/${color}_draw2.png`;
  if (card.type === "WILD") return "cards/wild.png";
  if (card.type === "WILD_DRAW_FOUR") return "cards/wild_draw4.png";
  return "cards/wild.png";
}


function canPlay(card, topCard) {
  if (!topCard) return true;
  if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") return true;
  if (card.color === topCard.color) return true;
  if (card.type === "NUMBER" && topCard.type === "NUMBER" && card.value === topCard.value) return true;
  if (card.type === topCard.type && card.type !== "NUMBER") return true;
  return false;
}

/* ============================================================
   GUEST LOGIN + AVATAR SELECT
   ============================================================ */

// 1) Generate guest ID
guestBtn.addEventListener("click", () => {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  guestName = `Guest#${randomNum}`;

  nameInput.value = guestName;

  avatarSelectPanel.classList.remove("hidden");
  joinPanel.classList.remove("hidden");
  setInfo("Select an avatar and join a room.");
});

// 2) Select emoji avatar
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

// 3) Upload photo
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
  if (!guestName) {
    joinError.textContent = "Please enter a name.";
    return;
  }

  if (!selectedAvatar) {
    joinError.textContent = "Choose an emoji or upload photo.";
    return;
  }
  if (!roomCode) {
    joinError.textContent = "Enter room code.";
    return;
  }

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
  renderRoom();
});

socket.on("errorMessage", msg => {
  setError(msg);
});

socket.on("gameOver", data => {
  showLeaderboard(data);
});

/* ============================================================
   RENDERING
   ============================================================ */

function renderRoom() {
  if (!currentRoom) return;

  renderPlayers();
  renderSeats();
  renderTopCard();
  renderHand();
  renderTeammates();
  updateActions();
  updateTimer();
}

/* ---------- Players Panel ---------- */
function renderPlayers() {
  playersList.innerHTML = "";

  currentRoom.players.forEach((p, index) => {
    const li = document.createElement("li");

    // Avatar
    const av = document.createElement("div");
    av.className = "player-avatar-small";
    if (p.avatar.type === "emoji") {
      av.innerHTML = `<div style="font-size:24px">${p.avatar.value}</div>`;
    } else {
      av.innerHTML = `<img src="${p.avatar.value}" />`;
    }

    // Name + info
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.appendChild(av);

    const name = document.createElement("span");
    name.textContent = p.name;
    if (p.id === myPlayerId) name.textContent += " (You)";
    left.appendChild(name);

    // Coins
    const right = document.createElement("span");
    right.textContent = `💰 ${p.coins}`;

    // Highlight if turn
    if (currentRoom.started && index === currentRoom.currentTurnIndex) {
      li.classList.add("player-turn");
    }
    if (p.id === myPlayerId) li.classList.add("player-me");
    if (p.isHost) {
      const hostTag = document.createElement("span");
      hostTag.textContent = "HOST";
      hostTag.className = "player-host-tag";
      left.appendChild(hostTag);
    }

    li.appendChild(left);
    li.appendChild(right);
    playersList.appendChild(li);
  });
}

/* ---------- Seats ---------- */
function renderSeats() {
  seatTop.innerHTML = "";
  seatBottom.innerHTML = "";
  seatLeft.innerHTML = "";
  seatRight.innerHTML = "";

  const arr = currentRoom.players;
  const myIndex = arr.findIndex(p => p.id === myPlayerId);

  let ordered = [];
  if (myIndex === -1) {
    ordered = arr.slice(0, 4);
  } else {
    ordered.push(arr[myIndex]);
    for (let i = 1; i < arr.length && ordered.length < 4; i++) {
      ordered.push(arr[(myIndex + i) % arr.length]);
    }
  }

  const seats = [seatBottom, seatTop, seatRight, seatLeft];

  ordered.forEach((p, i) => {
    const seat = seats[i];
    if (!seat) return;

    const wrap = document.createElement("div");
    wrap.className = "seat-wrapper";

    // avatar
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

    wrap.appendChild(av);
    wrap.appendChild(name);

    if (currentRoom.currentTurnIndex >= 0 &&
        arr[currentRoom.currentTurnIndex].id === p.id) {
      wrap.style.boxShadow = "0 0 0 2px #38bdf8";
    }

    seat.appendChild(wrap);
  });
}

/* ---------- Top Card ---------- */
function renderTopCard() {
  const pile = currentRoom.discardPile;
  const top = pile.length ? pile[pile.length - 1] : null;

  if (!top) {
    topCardDiv.innerHTML = "";
    return;
  }

  topCardDiv.innerHTML = `
    <img src="${getCardImage(top)}" class="card-img"/>
  `;

  if (top.type === "WILD" || top.type === "WILD_DRAW_FOUR") {
    const c = top.color;
    if (["red","yellow","green","blue"].includes(c)) {
      const dot = document.createElement("div");
      dot.className = `wild-color-indicator wild-${c}`;
      topCardDiv.appendChild(dot);
    }
  }
}

/* ---------- Hand ---------- */
function renderHand() {
  handCardsDiv.innerHTML = "";
  const me = currentRoom.players.find(p => p.id === myPlayerId);
  if (!me) return;

  const top = currentRoom.discardPile[currentRoom.discardPile.length-1];

  me.hand.forEach((card, i) => {
    const btn = document.createElement("button");
    btn.className = "card hand-card";
    btn.innerHTML = `<img src="${getCardImage(card)}" class="card-img"/>`;

    btn.addEventListener("click", () => {
      if (!isMyTurn()) return setError("Not your turn.");
      if (!canPlay(card, top)) return setError("Can't play that.");

      setError("");

      if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") {
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

/* ---------- Teammate Hands ---------- */
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

/* ---------- Actions ---------- */
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

/* ---------- Timer ---------- */
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
   ACTION HANDLERS
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

/* ---------- Wild Color Picker ---------- */
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
   LEADERBOARD
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
   ANIMATION
   ============================================================ */

function animateCard(sourceEl) {
  if (!sourceEl || !topCardDiv) return;

  const src = sourceEl.getBoundingClientRect();
  const dest = topCardDiv.getBoundingClientRect();

  const clone = sourceEl.cloneNode(true);
  clone.classList.add("flying-card");
  clone.style.position = "fixed";
  clone.style.left = src.left + "px";
  clone.style.top = src.top + "px";
  clone.style.width = src.width + "px";
  clone.style.height = src.height + "px";
  clone.style.zIndex = 9999;
  document.body.appendChild(clone);

  const dx = dest.left + dest.width / 2 - (src.left + src.width / 2);
  const dy = dest.top + dest.height / 2 - (src.top + src.height / 2);

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.9) rotate(8deg)`;
    clone.style.opacity = "0.8";
  });

  clone.addEventListener("transitionend", () => clone.remove());
}

/* ============================================================
   ORIENTATION: SHOW OVERLAY IN PORTRAIT
   ============================================================ */
const rotateOverlay = document.getElementById("rotate-overlay");

function checkOrientation() {
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  if (isPortrait) {
    rotateOverlay.classList.remove("hidden");
  } else {
    rotateOverlay.classList.add("hidden");
  }
}

/* ============================================================
   FULLSCREEN BUTTON (MOBILE FRIENDLY)
   ============================================================ */
fullscreenButton.addEventListener("click", () => {
  const elem = document.documentElement; // whole page

  if (!document.fullscreenElement && elem.requestFullscreen) {
    elem.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
});


// initial + listeners
checkOrientation();
window.addEventListener("resize", checkOrientation);
window.addEventListener("orientationchange", checkOrientation);
