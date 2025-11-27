// ============================================================
//  SERVER FOR COLOR CLASH ONLINE
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Rooms structure:
// rooms = Map<roomCode, {
//   players: [{id,name,avatar,hand,coins,isHost,team}],
//   deck: [],
//   discardPile: [],
//   started: false,
//   currentTurnIndex: 0,
//   turnDeadline: 0
// }>
const rooms = new Map();

// ============================================================
//  CARD CREATION
// ============================================================
function createDeck() {
  const colors = ["red", "yellow", "green", "blue"];
  const deck = [];

  for (const c of colors) {
    deck.push({ type: "NUMBER", color: c, value: 0 });
    for (let v = 1; v <= 9; v++) {
      deck.push({ type: "NUMBER", color: c, value: v });
      deck.push({ type: "NUMBER", color: c, value: v });
    }
    deck.push({ type: "SKIP", color: c });
    deck.push({ type: "SKIP", color: c });
    deck.push({ type: "REVERSE", color: c });
    deck.push({ type: "REVERSE", color: c });
    deck.push({ type: "DRAW_TWO", color: c });
    deck.push({ type: "DRAW_TWO", color: c });
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ type: "WILD" });
    deck.push({ type: "WILD_DRAW_FOUR" });
  }

  shuffle(deck);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
//  SYNC GAME STATE
// ============================================================
function broadcastState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit("gameState", room);
}

// ============================================================
//  TURN TIMER
// ============================================================
function startTurnTimer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const duration = 15000; // 15 seconds
  room.turnDeadline = Date.now() + duration;
  broadcastState(roomCode);

  if (room.timer) clearTimeout(room.timer);

  room.timer = setTimeout(() => {
    forceAutoMove(roomCode);
  }, duration);
}

function forceAutoMove(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players[room.currentTurnIndex];
  if (!player) return;

  // Auto draw 1 card
  if (room.deck.length === 0) reshuffle(room);
  const drawn = room.deck.pop();
  player.hand.push(drawn);

  // Try to auto-play it
  const top = room.discardPile[room.discardPile.length - 1];
  const playable = canPlay(drawn, top);

  if (playable) {
    if (drawn.type === "WILD" || drawn.type === "WILD_DRAW_FOUR") {
      drawn.color = ["red","yellow","green","blue"][Math.floor(Math.random()*4)];
    }
    room.discardPile.push(drawn);
    player.hand.pop();
    applyCardEffect(drawn, room);
  }

  advanceTurn(roomCode);
}

// ============================================================
//  CAN PLAY RULE
// ============================================================
function canPlay(card, top) {
  if (!top) return true;
  if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") return true;
  if (card.color === top.color) return true;
  if (card.type === "NUMBER" && top.type === "NUMBER" && card.value === top.value)
    return true;
  if (card.type === top.type && card.type !== "NUMBER") return true;
  return false;
}

// ============================================================
//  CARD EFFECTS
// ============================================================
function applyCardEffect(card, room) {
  const idx = room.currentTurnIndex;

  if (card.type === "SKIP") {
    room.currentTurnIndex = (idx + 2) % room.players.length;
    return;
  }

  if (card.type === "REVERSE") {
    room.players.reverse();
    room.currentTurnIndex = room.players.length - 1 - idx;
    return;
  }

  if (card.type === "DRAW_TWO") {
    const next = (idx + 1) % room.players.length;
    drawCards(room.players[next], room, 2);
    room.currentTurnIndex = (idx + 2) % room.players.length;
    return;
  }

  if (card.type === "WILD_DRAW_FOUR") {
    const next = (idx + 1) % room.players.length;
    drawCards(room.players[next], room, 4);
    // Move turn by 2
    room.currentTurnIndex = (idx + 2) % room.players.length;
    return;
  }
}

function drawCards(player, room, count) {
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) reshuffle(room);
    player.hand.push(room.deck.pop());
  }
}

function reshuffle(room) {
  const last = room.discardPile.pop();
  room.deck = room.discardPile;
  shuffle(room.deck);
  room.discardPile = [last];
}

// ============================================================
//  ADVANCE TURN
// ============================================================
function advanceTurn(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Win check
  const winner = room.players.find(p => p.hand.length === 0);
  if (winner) return endGame(roomCode, winner.id);

  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  startTurnTimer(roomCode);
  broadcastState(roomCode);
}

// ============================================================
//  END GAME + COINS + LEADERBOARD
// ============================================================
function endGame(roomCode, winnerId) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const pot = room.players.length * 200;
  const winner = room.players.find(p => p.id === winnerId);
  if (winner) winner.coins += pot;

  const standings = room.players.map(p => ({
    id: p.id,
    name: p.name,
    coins: p.coins,
    avatar: p.avatar,
    isWinner: p.id === winnerId
  }));

  io.to(roomCode).emit("gameOver", { standings });

  room.started = false;
  room.turnDeadline = null;
  if (room.timer) clearTimeout(room.timer);

  broadcastState(roomCode);
}

// ============================================================
//  SOCKET.IO HANDLERS
// ============================================================
io.on("connection", (socket) => {

  // ---------------------------
  // JOIN ROOM
  // ---------------------------
  socket.on("joinRoom", ({ roomCode, name, avatar }) => {
    roomCode = roomCode.toUpperCase();
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, {
        players: [],
        deck: [],
        discardPile: [],
        started: false,
        currentTurnIndex: 0,
        turnDeadline: 0,
        timer: null
      });
    }

    const room = rooms.get(roomCode);

    if (room.started)
      return socket.emit("errorMessage", "Game already started.");

    const isHost = room.players.length === 0;

    const player = {
      id: socket.id,
      name,
      avatar,
      hand: [],
      coins: 10000,
      isHost,
      team: null,
      pressedUno: false
    };

    room.players.push(player);

    socket.join(roomCode);
    socket.emit("joinedRoom", { roomCode, playerId: socket.id });

    broadcastState(roomCode);
  });

  // ---------------------------
  // START GAME
  // ---------------------------
  socket.on("startGame", () => {
  const roomCode = findRoom(socket.id);
  if (!roomCode) return;

  const room = rooms.get(roomCode);

  // Only host can start
  const host = room.players.find(p => p.isHost);
  if (!host || host.id !== socket.id) {
    return socket.emit("errorMessage", "Only the host can start the game.");
  }

  // Already started?
  if (room.started) {
    return socket.emit("errorMessage", "Game already started.");
  }

  // At least 2 players
  if (room.players.length < 2) {
    return socket.emit("errorMessage", "At least 2 players are required to start.");
  }

  // ===== NORMAL START LOGIC =====
  room.deck = createDeck();
  room.discardPile = [];
  room.started = true;

  // Deduct entry fee
  room.players.forEach(p => p.coins -= 200);

  // Deal 7 cards
  room.players.forEach(p => {
    p.hand = [];
    for (let i = 0; i < 7; i++) {
      p.hand.push(room.deck.pop());
    }
  });

  // Flip first non-wild top card
  let first = room.deck.pop();
  while (first.type === "WILD" || first.type === "WILD_DRAW_FOUR") {
    room.deck.unshift(first);
    first = room.deck.pop();
  }

  room.discardPile.push(first);
  room.currentTurnIndex = 0;

  startTurnTimer(roomCode);
  broadcastState(roomCode);
});


  // ---------------------------
  // DRAW CARD
  // ---------------------------
  socket.on("drawCard", () => {
    const roomCode = findRoom(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    const idx = room.currentTurnIndex;
    if (room.players[idx].id !== socket.id) return;

    if (room.deck.length === 0) reshuffle(room);

    const card = room.deck.pop();
    room.players[idx].hand.push(card);

    // Auto play?
    const top = room.discardPile[room.discardPile.length - 1];
    if (canPlay(card, top)) {
      if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") {
        card.color = ["red","yellow","green","blue"][Math.floor(Math.random()*4)];
      }
      room.players[idx].hand.pop();
      room.discardPile.push(card);
      applyCardEffect(card, room);
      advanceTurn(roomCode);
    } else {
      advanceTurn(roomCode);
    }
  });

  // ---------------------------
  // PLAY CARD
  // ---------------------------
  socket.on("playCard", ({ cardIndex, chosenColor }) => {
    const roomCode = findRoom(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    const idx = room.currentTurnIndex;
    if (room.players[idx].id !== socket.id) return;

    const player = room.players[idx];
    const card = player.hand[cardIndex];

    const top = room.discardPile[room.discardPile.length - 1];
    if (!canPlay(card, top)) return;

    if ((card.type === "WILD" || card.type === "WILD_DRAW_FOUR") && !chosenColor)
      return;

    if (chosenColor) card.color = chosenColor;

    room.discardPile.push(card);
    player.hand.splice(cardIndex, 1);

    applyCardEffect(card, room);
    advanceTurn(roomCode);

    if (player.hand.length >= 3)
      player.pressedUno = false;
  });

  // ---------------------------
  // UNO PRESS
  // ---------------------------
  socket.on("pressUno", () => {
    const roomCode = findRoom(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.pressedUno = true;
  });

  // ---------------------------
  // DISCONNECT
  // ---------------------------
  socket.on("disconnect", () => {
    const roomCode = findRoom(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    // If host left, next player becomes host
    if (!room.players.some(p => p.isHost)) {
      room.players[0].isHost = true;
    }

    broadcastState(roomCode);
  });
});

// ============================================================
//  FIND ROOM BY SOCKET
// ============================================================
function findRoom(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (room.players.some(p => p.id === socketId)) return code;
  }
  return null;
}

// ============================================================
//  START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
