const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ===== GAME CONSTANTS =====
const COLORS = ["red", "blue", "green", "yellow"];
const TYPES = {
  NUMBER: "NUMBER",
  SKIP: "SKIP",
  REVERSE: "REVERSE",
  DRAW_TWO: "DRAW_TWO",
  WILD: "WILD",
  WILD_DRAW_FOUR: "WILD_DRAW_FOUR"
};

const MAX_PLAYERS_PER_ROOM = 10;
const CARDS_PER_PLAYER = 7;
const TURN_MS = 15_000; // 15 seconds per turn

// rooms: Map<roomCode, roomObject>
const rooms = new Map();
// timers: roomCode -> { timeoutId, deadline }
const roomTimers = new Map();

// ===== UTILS =====
function createDeck() {
  const d = [];

  COLORS.forEach((color) => {
    d.push(createCard(color, TYPES.NUMBER, 0));
    for (let n = 1; n <= 9; n++) {
      d.push(createCard(color, TYPES.NUMBER, n));
      d.push(createCard(color, TYPES.NUMBER, n));
    }
    for (let i = 0; i < 2; i++) {
      d.push(createCard(color, TYPES.SKIP));
      d.push(createCard(color, TYPES.REVERSE));
      d.push(createCard(color, TYPES.DRAW_TWO));
    }
  });

  for (let i = 0; i < 4; i++) {
    d.push(createCard("wild", TYPES.WILD));
    d.push(createCard("wild", TYPES.WILD_DRAW_FOUR));
  }

  return shuffle(d);
}

function createCard(color, type, value = null) {
  return {
    id: Math.random().toString(36).slice(2),
    color,
    type,
    value
  };
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getRoom(roomCode) {
  return rooms.get(roomCode);
}

function createRoom(roomCode) {
  const room = {
    code: roomCode,
    players: [],
    deck: [],
    discardPile: [],
    currentTurnIndex: 0,
    direction: 1,
    started: false
  };
  rooms.set(roomCode, room);
  return room;
}

function drawCard(room, player) {
  if (room.deck.length === 0) {
    if (room.discardPile.length > 1) {
      const top = room.discardPile.pop();
      room.deck = shuffle(room.discardPile);
      room.discardPile = [top];
    }
  }
  if (room.deck.length === 0) {
    return null;
  }
  const card = room.deck.pop();
  player.hand.push(card);
  return card;
}

function getTopCard(room) {
  return room.discardPile[room.discardPile.length - 1];
}

function canPlay(card, topCard) {
  if (!topCard) return true;

  if (card.type === TYPES.WILD || card.type === TYPES.WILD_DRAW_FOUR) {
    return true;
  }

  if (card.color === topCard.color) return true;

  if (
    card.type === TYPES.NUMBER &&
    topCard.type === TYPES.NUMBER &&
    card.value === topCard.value
  ) {
    return true;
  }

  if (card.type === topCard.type && card.type !== TYPES.NUMBER) {
    return true;
  }

  return false;
}

function getNextPlayerIndex(room, steps = 1) {
  const num = room.players.length;
  if (num === 0) return 0;
  return (room.currentTurnIndex + room.direction * steps + num) % num;
}

function goToNextPlayer(room, steps = 1) {
  room.currentTurnIndex = getNextPlayerIndex(room, steps);
}

// ===== TURN TIMER =====
function clearTurnTimer(roomCode) {
  const data = roomTimers.get(roomCode);
  if (data && data.timeoutId) clearTimeout(data.timeoutId);
  roomTimers.delete(roomCode);
}

function startTurnTimer(room) {
  const code = room.code;
  clearTurnTimer(code);

  const deadline = Date.now() + TURN_MS;

  const timeoutId = setTimeout(() => {
    const r = getRoom(code);
    if (!r || !r.started || r.players.length === 0) return;

    const player = r.players[r.currentTurnIndex];
    if (!player) return;

    // timeout: auto-draw 1 card and pass turn
    drawCard(r, player);
    goToNextPlayer(r, 1);
    startTurnTimer(r);
    broadcastGameState(r);
  }, TURN_MS);

  roomTimers.set(code, { timeoutId, deadline });
}

function getTurnDeadline(roomCode) {
  const data = roomTimers.get(roomCode);
  return data ? data.deadline : null;
}

// ===== BROADCAST =====
function broadcastGameState(room) {
  const deadline = getTurnDeadline(room.code);
  const publicState = {
    ...room,
    turnDeadline: deadline
  };
  io.to(room.code).emit("gameState", publicState);
}

function removePlayerFromRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const room = getRoom(roomCode);
  if (!room) return;

  const index = room.players.findIndex((p) => p.id === socket.id);
  if (index === -1) return;

  room.players.splice(index, 1);

  if (room.currentTurnIndex >= room.players.length) {
    room.currentTurnIndex = 0;
  }

  if (room.players.length === 0) {
    clearTurnTimer(roomCode);
    rooms.delete(roomCode);
  } else {
    if (!room.players.some((p) => p.isHost)) {
      room.players[0].isHost = true;
    }
    broadcastGameState(room);
  }
}

// ===== SOCKET.IO LOGIC =====
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("joinRoom", ({ roomCode, playerName }) => {
    roomCode = (roomCode || "").trim().toUpperCase();
    if (!roomCode || !playerName) {
      socket.emit("errorMessage", "Room code and name are required.");
      return;
    }

    let room = getRoom(roomCode);
    if (!room) {
      room = createRoom(roomCode);
    }

    if (room.started) {
      socket.emit("errorMessage", "Game already started in this room.");
      return;
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit(
        "errorMessage",
        "Room is full. Max players: " + MAX_PLAYERS_PER_ROOM
      );
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: playerName,
      hand: [],
      isHost: room.players.length === 0
    };

    room.players.push(newPlayer);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    socket.emit("joinedRoom", {
      roomCode,
      playerId: socket.id
    });

    broadcastGameState(room);
  });

  socket.on("startGame", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.isHost) {
      socket.emit("errorMessage", "Only the host can start the game.");
      return;
    }

    if (room.started) {
      socket.emit("errorMessage", "Game already started.");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("errorMessage", "Need at least 2 players to start.");
      return;
    }

    room.deck = createDeck();
    room.discardPile = [];
    room.currentTurnIndex = 0;
    room.direction = 1;

    room.players.forEach((p) => {
      p.hand = [];
    });

    for (let i = 0; i < CARDS_PER_PLAYER; i++) {
      room.players.forEach((p) => drawCard(room, p));
    }

    let firstCard;
    do {
      firstCard = room.deck.pop();
    } while (
      firstCard.type === TYPES.WILD ||
      firstCard.type === TYPES.WILD_DRAW_FOUR
    );
    room.discardPile.push(firstCard);

    room.started = true;
    startTurnTimer(room);
    broadcastGameState(room);
  });

  socket.on("playCard", ({ cardIndex }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room || !room.started) return;

    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;

    if (playerIndex !== room.currentTurnIndex) {
      socket.emit("errorMessage", "Not your turn.");
      return;
    }

    const player = room.players[playerIndex];
    if (
      typeof cardIndex !== "number" ||
      cardIndex < 0 ||
      cardIndex >= player.hand.length
    ) {
      socket.emit("errorMessage", "Invalid card.");
      return;
    }

    const card = player.hand[cardIndex];
    const topCard = getTopCard(room);

    if (!canPlay(card, topCard)) {
      socket.emit("errorMessage", "You cannot play that card.");
      return;
    }

    // remove from hand
    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);

    // wild color choose (simple auto choice)
    if (card.type === TYPES.WILD || card.type === TYPES.WILD_DRAW_FOUR) {
      const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
      player.hand.forEach((c) => {
        if (COLORS.includes(c.color)) counts[c.color]++;
      });
      let bestColor = "red";
      let bestCount = -1;
      for (const c of COLORS) {
        if (counts[c] > bestCount) {
          bestCount = counts[c];
          bestColor = c;
        }
      }
      card.color = bestColor;
    }

    // Apply effects
    let extraSteps = 0;
    if (card.type === TYPES.SKIP) {
      extraSteps = 1;
    } else if (card.type === TYPES.REVERSE) {
      room.direction *= -1;
    } else if (card.type === TYPES.DRAW_TWO) {
      const nextIndex = getNextPlayerIndex(room);
      const nextPlayer = room.players[nextIndex];
      drawCard(room, nextPlayer);
      drawCard(room, nextPlayer);
      extraSteps = 1;
    } else if (card.type === TYPES.WILD_DRAW_FOUR) {
      const nextIndex = getNextPlayerIndex(room);
      const nextPlayer = room.players[nextIndex];
      for (let i = 0; i < 4; i++) {
        drawCard(room, nextPlayer);
      }
      extraSteps = 1;
    }

    // win check
    if (player.hand.length === 0) {
      io.to(room.code).emit("gameOver", {
        winnerId: player.id,
        winnerName: player.name
      });
      room.started = false;
      clearTurnTimer(room.code);
      broadcastGameState(room);
      return;
    }

    // next player
    goToNextPlayer(room, 1 + extraSteps);
    startTurnTimer(room);
    broadcastGameState(room);
  });

  socket.on("drawCard", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room || !room.started) return;

    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;

    if (playerIndex !== room.currentTurnIndex) {
      socket.emit("errorMessage", "Not your turn.");
      return;
    }

    const player = room.players[playerIndex];
    const topBeforeDraw = getTopCard(room);

    // draw ONE card
    const drawn = drawCard(room, player);

    if (!drawn) {
      // no card to draw -> just pass
      goToNextPlayer(room, 1);
      startTurnTimer(room);
      broadcastGameState(room);
      return;
    }

    // if drawn card is playable on previous top card, auto-play it
    if (canPlay(drawn, topBeforeDraw)) {
      // remove drawn from hand (it should be last)
      const idx = player.hand.findIndex((c) => c.id === drawn.id);
      if (idx !== -1) {
        player.hand.splice(idx, 1);
      }
      room.discardPile.push(drawn);

      // if wild, choose color automatically
      if (
        drawn.type === TYPES.WILD ||
        drawn.type === TYPES.WILD_DRAW_FOUR
      ) {
        const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
        player.hand.forEach((c) => {
          if (COLORS.includes(c.color)) counts[c.color]++;
        });
        let bestColor = "red";
        let bestCount = -1;
        for (const c of COLORS) {
          if (counts[c] > bestCount) {
            bestCount = counts[c];
            bestColor = c;
          }
        }
        drawn.color = bestColor;
      }

      // apply effects like in playCard
      let extraSteps = 0;
      if (drawn.type === TYPES.SKIP) {
        extraSteps = 1;
      } else if (drawn.type === TYPES.REVERSE) {
        room.direction *= -1;
      } else if (drawn.type === TYPES.DRAW_TWO) {
        const nextIndex = getNextPlayerIndex(room);
        const nextPlayer = room.players[nextIndex];
        drawCard(room, nextPlayer);
        drawCard(room, nextPlayer);
        extraSteps = 1;
      } else if (drawn.type === TYPES.WILD_DRAW_FOUR) {
        const nextIndex = getNextPlayerIndex(room);
        const nextPlayer = room.players[nextIndex];
        for (let i = 0; i < 4; i++) {
          drawCard(room, nextPlayer);
        }
        extraSteps = 1;
      }

      // win check (if player had 1 card before draw & auto-play)
      if (player.hand.length === 0) {
        io.to(room.code).emit("gameOver", {
          winnerId: player.id,
          winnerName: player.name
        });
        room.started = false;
        clearTurnTimer(room.code);
        broadcastGameState(room);
        return;
      }

      // go to next player after auto-play
      goToNextPlayer(room, 1 + extraSteps);
    } else {
      // drawn card not playable: keep in hand, just pass turn
      goToNextPlayer(room, 1);
    }

    startTurnTimer(room);
    broadcastGameState(room);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    removePlayerFromRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});
