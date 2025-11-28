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

// Rooms: Map<roomCode, { players, deck, discardPile, started, currentTurnIndex, turnDeadline }>
const rooms = new Map();

// Keep timers per room so we can cancel when needed
const roomTimers = new Map();

// ============================================================
//  UTILITIES
// ============================================================

function generateRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      letters[Math.floor(Math.random() * letters.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

// Create a fresh deck (simple example - you can replace with full game logic)
function createDeck() {
  const colors = ["red", "yellow", "green", "blue"];
  const values = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2", "wild", "wild4"];
  const deck = [];

  for (const color of colors) {
    for (const value of values) {
      // Example: remove color for wilds
      if (value.startsWith("wild")) {
        deck.push({ color: "wild", value });
      } else {
        deck.push({ color, value });
      }
    }
  }

  // Duplicate some cards for bigger deck
  const extra = deck.map(card => ({ ...card }));
  return shuffle([...deck, ...extra]);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealInitialCards(deck, count) {
  const hand = deck.splice(0, count);
  return hand;
}

function nextPlayerIndex(room, skipCount = 1) {
  const numPlayers = room.players.length;
  if (numPlayers === 0) return 0;
  room.currentTurnIndex = (room.currentTurnIndex + skipCount) % numPlayers;
}

function getPublicRoomState(room) {
  return {
    started: room.started,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      handSize: p.hand.length,
      isHost: p.isHost
    })),
    discardTop: room.discardPile[room.discardPile.length - 1] || null,
    currentTurnIndex: room.currentTurnIndex,
    turnDeadline: room.turnDeadline || null
  };
}

function broadcastState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const publicState = getPublicRoomState(room);
  io.to(roomCode).emit("roomState", publicState);

  // Also send each player their own hand privately
  for (const player of room.players) {
    io.to(player.id).emit("yourHand", player.hand);
  }
}

// ============================================================
//  TURN TIMER
// ============================================================

function startTurnTimer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const duration = 30000; // 30 seconds
  room.turnDeadline = Date.now() + duration;
  broadcastState(roomCode);

  // Clear any existing timer for this room
  if (roomTimers.has(roomCode)) {
    clearTimeout(roomTimers.get(roomCode));
  }

  const timer = setTimeout(() => {
    forceAutoMove(roomCode);
  }, duration);

  roomTimers.set(roomCode, timer);
}

function clearTurnTimer(roomCode) {
  if (roomTimers.has(roomCode)) {
    clearTimeout(roomTimers.get(roomCode));
    roomTimers.delete(roomCode);
  }
}

function forceAutoMove(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.players.length === 0) return;

  const currentPlayer = room.players[room.currentTurnIndex];
  if (!currentPlayer) return;

  // Simple auto-move: draw one card
  if (room.deck.length === 0) {
    reshuffleFromDiscard(room);
  }

  if (room.deck.length > 0) {
    const drawn = room.deck.shift();
    currentPlayer.hand.push(drawn);
  }

  nextPlayerIndex(room);
  room.turnDeadline = null;
  broadcastState(roomCode);
  startTurnTimer(roomCode);
}

function reshuffleFromDiscard(room) {
  if (room.discardPile.length <= 1) return;
  const top = room.discardPile.pop();
  room.deck = shuffle(room.discardPile);
  room.discardPile = [top];
}

// ============================================================
//  SOCKET.IO
// ============================================================

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  socket.on("createRoom", ({ name }, callback) => {
    const roomCode = generateRoomCode();
    const room = {
      players: [],
      deck: createDeck(),
      discardPile: [],
      started: false,
      currentTurnIndex: 0,
      turnDeadline: null
    };

    const player = {
      id: socket.id,
      name: name || "Player",
      seat: "bottom",
      hand: [],
      isHost: true
    };

    // Deal initial cards for host
    player.hand = dealInitialCards(room.deck, 7);
    room.players.push(player);
    rooms.set(roomCode, room);

    socket.join(roomCode);
    broadcastState(roomCode);

    console.log(`Room ${roomCode} created by ${socket.id}`);

    if (callback) callback({ roomCode, success: true });
  });

  socket.on("joinRoom", ({ name, roomCode }, callback) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      if (callback) callback({ success: false, error: "Room not found" });
      return;
    }

    if (room.started) {
      if (callback) callback({ success: false, error: "Game already started" });
      return;
    }

    if (room.players.length >= 4) {
      if (callback) callback({ success: false, error: "Room is full" });
      return;
    }

    const takenSeats = room.players.map(p => p.seat);
    const allSeats = ["bottom", "right", "top", "left"];
    const freeSeat = allSeats.find(s => !takenSeats.includes(s)) || "bottom";

    const player = {
      id: socket.id,
      name: name || "Player",
      seat: freeSeat,
      hand: [],
      isHost: false
    };

    player.hand = dealInitialCards(room.deck, 7);
    room.players.push(player);

    socket.join(roomCode);
    broadcastState(roomCode);

    console.log(`Player ${socket.id} joined room ${roomCode}`);

    if (callback) callback({ success: true, roomCode });
  });

  socket.on("startGame", ({ roomCode }, callback) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      if (callback) callback({ success: false, error: "Room not found" });
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      if (callback) callback({ success: false, error: "Only host can start" });
      return;
    }

    if (room.players.length < 2) {
      if (callback) callback({ success: false, error: "Need at least 2 players" });
      return;
    }

    if (room.started) {
      if (callback) callback({ success: false, error: "Game already started" });
      return;
    }

    // Flip first card to discard
    if (room.deck.length === 0) {
      room.deck = createDeck();
    }
    const firstCard = room.deck.shift();
    room.discardPile.push(firstCard);

    room.started = true;
    room.currentTurnIndex = 0;
    broadcastState(roomCode);
    startTurnTimer(roomCode);

    console.log(`Game started in room ${roomCode}`);

    if (callback) callback({ success: true });
  });

  socket.on("playCard", ({ roomCode, cardIndex }, callback) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room || !room.started) {
      if (callback) callback({ success: false, error: "Game not started" });
      return;
    }

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) {
      if (callback) callback({ success: false, error: "Player not in room" });
      return;
    }

    if (playerIndex !== room.currentTurnIndex) {
      if (callback) callback({ success: false, error: "Not your turn" });
      return;
    }

    const player = room.players[playerIndex];
    if (cardIndex < 0 || cardIndex >= player.hand.length) {
      if (callback) callback({ success: false, error: "Invalid card index" });
      return;
    }

    const card = player.hand[cardIndex];
    const top = room.discardPile[room.discardPile.length - 1];

    // Simple validation: color must match or value must match or card is wild
    const valid =
      card.color === "wild" ||
      card.color === top.color ||
      card.value === top.value;

    if (!valid) {
      if (callback) callback({ success: false, error: "Card not playable" });
      return;
    }

    // Play card
    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);

    // Check win
    if (player.hand.length === 0) {
      io.to(roomCode).emit("gameOver", {
        winnerId: player.id,
        winnerName: player.name
      });
      clearTurnTimer(roomCode);
      room.started = false;
      room.turnDeadline = null;
      broadcastState(roomCode);
      if (callback) callback({ success: true });
      return;
    }

    // Handle special cards (simple version)
    let skipCount = 1;

    if (card.value === "skip") {
      skipCount = 2;
    } else if (card.value === "reverse") {
      room.players.reverse();
      room.currentTurnIndex =
        room.players.findIndex(p => p.id === player.id) ?? 0;
      skipCount = 1;
    } else if (card.value === "draw2") {
      const targetIndex = (room.currentTurnIndex + 1) % room.players.length;
      const target = room.players[targetIndex];
      for (let i = 0; i < 2; i++) {
        if (room.deck.length === 0) reshuffleFromDiscard(room);
        if (room.deck.length > 0) {
          const drawn = room.deck.shift();
          target.hand.push(drawn);
        }
      }
    } else if (card.value === "wild4") {
      const targetIndex = (room.currentTurnIndex + 1) % room.players.length;
      const target = room.players[targetIndex];
      for (let i = 0; i < 4; i++) {
        if (room.deck.length === 0) reshuffleFromDiscard(room);
        if (room.deck.length > 0) {
          const drawn = room.deck.shift();
          target.hand.push(drawn);
        }
      }
    }

    nextPlayerIndex(room, skipCount);
    clearTurnTimer(roomCode);
    startTurnTimer(roomCode);
    broadcastState(roomCode);

    if (callback) callback({ success: true });
  });

  socket.on("drawCard", ({ roomCode }, callback) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room || !room.started) {
      if (callback) callback({ success: false, error: "Game not started" });
      return;
    }

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) {
      if (callback) callback({ success: false, error: "Player not in room" });
      return;
    }

    if (playerIndex !== room.currentTurnIndex) {
      if (callback) callback({ success: false, error: "Not your turn" });
      return;
    }

    const player = room.players[playerIndex];

    if (room.deck.length === 0) {
      reshuffleFromDiscard(room);
    }

    if (room.deck.length === 0) {
      if (callback) callback({ success: false, error: "No cards left" });
      return;
    }

    const drawn = room.deck.shift();
    player.hand.push(drawn);

    // After drawing, move to next player
    nextPlayerIndex(room);
    clearTurnTimer(roomCode);
    startTurnTimer(roomCode);
    broadcastState(roomCode);

    if (callback) callback({ success: true });
  });

  socket.on("chatMessage", ({ roomCode, message }) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const msg = {
      from: player.name,
      text: message,
      time: Date.now()
    };

    io.to(roomCode).emit("chatMessage", msg);
  });

  socket.on("leaveRoom", ({ roomCode }) => {
    roomCode = (roomCode || "").toUpperCase();
    handlePlayerLeave(socket.id, roomCode);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // Find any room this player was in
    const roomCode = findRoomByPlayer(socket.id);
    if (roomCode) {
      handlePlayerLeave(socket.id, roomCode);
    }
  });
});

// ============================================================
//  ROOM & PLAYER HELPERS
// ============================================================

function handlePlayerLeave(socketId, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const idx = room.players.findIndex(p => p.id === socketId);
  if (idx === -1) return;

  const wasHost = room.players[idx].isHost;
  room.players.splice(idx, 1);

  // Reassign host if needed
  if (wasHost && room.players.length > 0) {
    room.players[0].isHost = true;
  }

  // If room is empty, clear timer & delete
  if (room.players.length === 0) {
    clearTurnTimer(roomCode);
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} deleted (empty)`);
    return;
  }

  // Adjust currentTurnIndex if needed
  if (room.started) {
    if (idx < room.currentTurnIndex) {
      room.currentTurnIndex -= 1;
    } else if (idx === room.currentTurnIndex) {
      if (room.currentTurnIndex >= room.players.length) {
        room.currentTurnIndex = 0;
      }
      clearTurnTimer(roomCode);
      startTurnTimer(roomCode);
    }
  }

  broadcastState(roomCode);
}

function findRoomByPlayer(socketId) {
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
