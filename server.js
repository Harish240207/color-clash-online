/* ============================================================
   SERVER — COLOR CLASH ONLINE
   Only modification: Correct SKIP rule
   ============================================================ */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* ============================================================
   GAME STATE
   ============================================================ */

let rooms = {};   // { roomCode: { players:[], deck:[], discardPile:[], currentTurnIndex, started, turnDeadline } }

/* ============================================================
   HELPERS
   ============================================================ */

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function shuffle(arr) {
  let a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  const colors = ["red", "yellow", "green", "blue"];
  const deck = [];

  colors.forEach(color => {
    for (let n = 0; n <= 9; n++) {
      deck.push({ type: "NUMBER", color, value: n });
      if (n !== 0) deck.push({ type: "NUMBER", color, value: n });
    }

    deck.push({ type: "SKIP", color, value: "skip" });
    deck.push({ type: "SKIP", color, value: "skip" });
    deck.push({ type: "REVERSE", color, value: "reverse" });
    deck.push({ type: "REVERSE", color, value: "reverse" });
    deck.push({ type: "DRAW_TWO", color, value: "+2" });
    deck.push({ type: "DRAW_TWO", color, value: "+2" });
  });

  deck.push({ type: "WILD", color: "wild", value: "wild" });
  deck.push({ type: "WILD", color: "wild", value: "wild" });
  deck.push({ type: "WILD_DRAW_FOUR", color: "wild", value: "+4" });
  deck.push({ type: "WILD_DRAW_FOUR", color: "wild", value: "+4" });

  return shuffle(deck);
}

function reshuffle(room) {
  if (room.discardPile.length < 2) return;
  const top = room.discardPile.pop();
  room.deck = shuffle(room.discardPile);
  room.discardPile = [top];
}

function nextTurn(room, skip = 1) {
  room.currentTurnIndex = (room.currentTurnIndex + skip) % room.players.length;
}

function sendRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const publicData = {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
      avatar: p.avatar,
      handSize: p.hand.length,
      isHost: p.isHost,
      team: p.team
    })),
    discardPile: room.discardPile,
    currentTurnIndex: room.currentTurnIndex,
    started: room.started,
    turnDeadline: room.turnDeadline
  };

  io.to(roomCode).emit("gameState", publicData);

  // send private hands
  room.players.forEach(p => {
    io.to(p.id).emit("gameState", {
      ...publicData,
      players: publicData.players,
      myHand: p.hand
    });
  });
}

function startTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.turnDeadline = Date.now() + 30000;

  setTimeout(() => {
    const currentP = room.players[room.currentTurnIndex];

    // auto draw
    if (room.deck.length === 0) reshuffle(room);
    if (room.deck.length > 0) currentP.hand.push(room.deck.shift());

    nextTurn(room, 1);
    startTurnTimer(roomCode);
    sendRoomState(roomCode);
  }, 30000);
}

/* ============================================================
   SOCKET CONNECTIONS
   ============================================================ */

io.on("connection", socket => {

  /* ------------------------------------------------------------
     JOIN ROOM
     ------------------------------------------------------------ */
  socket.on("joinRoom", ({ roomCode, name, avatar }) => {
    roomCode = roomCode.trim().toUpperCase();

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        deck: makeDeck(),
        discardPile: [],
        currentTurnIndex: 0,
        started: false,
        turnDeadline: null
      };
    }

    const room = rooms[roomCode];

    const player = {
      id: socket.id,
      name,
      avatar,
      coins: 0,
      hand: [],
      team: null,
      isHost: room.players.length === 0
    };

    // deal 7
    for (let i = 0; i < 7; i++) {
      if (room.deck.length === 0) reshuffle(room);
      player.hand.push(room.deck.shift());
    }

    room.players.push(player);
    socket.join(roomCode);

    // place first card if not started
    if (!room.started && room.discardPile.length === 0) {
      room.discardPile.push(room.deck.shift());
    }

    socket.emit("joinedRoom", { roomCode, playerId: socket.id });
    sendRoomState(roomCode);
  });

  /* ------------------------------------------------------------
     START GAME
     ------------------------------------------------------------ */
  socket.on("startGame", () => {
    const roomCode = Object.keys(rooms).find(code =>
      rooms[code].players.some(p => p.id === socket.id)
    );
    if (!roomCode) return;

    const room = rooms[roomCode];
    const me = room.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;

    room.started = true;
    startTurnTimer(roomCode);
    sendRoomState(roomCode);
  });

  /* ------------------------------------------------------------
     DRAW CARD
     ------------------------------------------------------------ */
  socket.on("drawCard", () => {
    const roomCode = Object.keys(rooms).find(code =>
      rooms[code].players.some(p => p.id === socket.id)
    );
    if (!roomCode) return;

    const room = rooms[roomCode];
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== room.currentTurnIndex) return;

    if (room.deck.length === 0) reshuffle(room);
    if (room.deck.length > 0)
      room.players[idx].hand.push(room.deck.shift());

    nextTurn(room, 1);
    startTurnTimer(roomCode);
    sendRoomState(roomCode);
  });

  /* ------------------------------------------------------------
     PLAY CARD  (includes updated SKIP rule)
     ------------------------------------------------------------ */
  socket.on("playCard", ({ cardIndex, chosenColor }) => {
    const roomCode = Object.keys(rooms).find(code =>
      rooms[code].players.some(p => p.id === socket.id)
    );
    if (!roomCode) return;

    const room = rooms[roomCode];

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentTurnIndex) return;

    const player = room.players[playerIndex];
    const card = player.hand[cardIndex];
    if (!card) return;

    // play it
    player.hand.splice(cardIndex, 1);

    // apply chosen color for wild
    if (card.type === "WILD" || card.type === "WILD_DRAW_FOUR") {
      if (chosenColor)
        card.color = chosenColor.toLowerCase();
    }

    room.discardPile.push(card);

    /* ============================================================
       CORRECT SKIP RULE (your requested logic)
       ============================================================ */
    if (card.type === "SKIP") {
      // skip next player entirely
      nextTurn(room, 2);
    }

    else if (card.type === "REVERSE") {
      room.players.reverse();
      room.currentTurnIndex = room.players.findIndex(p => p.id === player.id);
      nextTurn(room, 1);
    }

    else if (card.type === "DRAW_TWO") {
      const nextIndex = (room.currentTurnIndex + 1) % room.players.length;
      const target = room.players[nextIndex];
      for (let i = 0; i < 2; i++) {
        if (room.deck.length === 0) reshuffle(room);
        if (room.deck.length === 0) break;
        target.hand.push(room.deck.shift());
      }
      nextTurn(room, 2);
    }

    else if (card.type === "WILD_DRAW_FOUR") {
      const nextIndex = (room.currentTurnIndex + 1) % room.players.length;
      const target = room.players[nextIndex];
      for (let i = 0; i < 4; i++) {
        if (room.deck.length === 0) reshuffle(room);
        if (room.deck.length === 0) break;
        target.hand.push(room.deck.shift());
      }
      nextTurn(room, 2);
    }

    else {
      nextTurn(room, 1);
    }

    startTurnTimer(roomCode);
    sendRoomState(roomCode);
  });

  /* ------------------------------------------------------------
     CHAT
     ------------------------------------------------------------ */
  socket.on("chatMessage", ({ text }) => {
    const roomCode = Object.keys(rooms).find(code =>
      rooms[code].players.some(p => p.id === socket.id)
    );
    if (!roomCode) return;

    const room = rooms[roomCode];
    const p = room.players.find(p => p.id === socket.id);

    io.to(roomCode).emit("chatMessage", {
      from: p.name,
      text
    });
  });

  /* ------------------------------------------------------------
     DISCONNECT
     ------------------------------------------------------------ */
  socket.on("disconnect", () => {
    const roomCode = Object.keys(rooms).find(code =>
      rooms[code].players.some(p => p.id === socket.id)
    );
    if (!roomCode) return;

    const room = rooms[roomCode];
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[roomCode];
      return;
    }

    sendRoomState(roomCode);
  });

});

/* ============================================================
   START SERVER
   ============================================================ */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
