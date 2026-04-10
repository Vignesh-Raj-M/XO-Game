const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const pathToLeaderboard = path.join(__dirname, 'leaderboard.json');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname)));

const rooms = new Map(); // roomCode -> { board, currentPlayer, players: {X: socket.id, O: socket.id}, scores: {X:0, O:0}, active: true }

const winningConditions = [
  [0,1,2], [3,4,5], [6,7,8],
  [0,3,6], [1,4,7], [2,5,8],
  [0,4,8], [2,4,6]
];

function generateRoomCode() {
  return Math.floor(Math.random() * 9000 + 1000).toString();
}

function checkWin(board, player) {
  return winningConditions.some(([a,b,c]) => board[a] === player && board[b] === player && board[c] === player);
}

function isDraw(board) {
  return board.every(cell => cell !== '');
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (nickname) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms.has(code));
    rooms.set(code, {
      board: ['', '', '', '', '', '', '', '', ''],
      currentPlayer: 'X',
      players: { X: socket.id, XNick: nickname || 'Anonymous' },
      scores: { X: 0, O: 0 },
      active: true
    });
    socket.join(code);
    socket.emit('roomCreated', code);
  });

  socket.on('submitName', (data) => {
    const { name } = data;
    let leaderboard = [];
    try {
      const data = fs.readFileSync(pathToLeaderboard, 'utf8');
      leaderboard = JSON.parse(data);
    } catch (e) {
      leaderboard = [];
    }
    const entry = leaderboard.find(e => e.name === name);
    if (entry) {
      entry.wins++;
    } else {
      leaderboard.push({ name, wins: 1 });
    }
    fs.writeFileSync(pathToLeaderboard, JSON.stringify(leaderboard, null, 2));
    const top10 = leaderboard.sort((a,b) => b.wins - a.wins).slice(0,10);
    io.emit('leaderboardUpdate', top10);
  });

  socket.on('joinRoom', (data) => {
    const { code, nickname } = data;
    const room = rooms.get(code);
    if (!room || !room.players.X || room.players.O || !room.active) {
      socket.emit('joinError', 'Room full or invalid');
      return;
    }
    socket.join(code);
    room.players.O = socket.id;
    room.players.ONick = nickname || 'Anonymous';
    room.currentPlayer = 'X';
    io.to(code).emit('roomReady', code, room.currentPlayer);
    socket.emit('playerAssigned', 'O');
    io.to(code).emit('roomUpdate', room);
  });

  socket.on('makeMove', (data) => {
    const { code, index } = data;
    const room = rooms.get(code);
    const playerSymbol = room.players.X === socket.id ? 'X' : 'O';
    if (!room || !room.active || room.board[index] !== '' || room.currentPlayer !== playerSymbol) return;

    room.board[index] = room.currentPlayer;
    const win = checkWin(room.board, room.currentPlayer);
    const draw = isDraw(room.board);

    if (win || draw) {
      if (win) room.scores[room.currentPlayer]++;
      room.active = false;
      io.to(code).emit('gameOver', { win, draw, winner: win ? room.currentPlayer : null, scores: room.scores });
      if (win) {
        const winnerSocket = room.players[room.currentPlayer];
        io.to(winnerSocket).emit('requestName');
      }
    } else {
      room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';
      io.to(code).emit('roomUpdate', room);
    }
  });

  socket.on('resetGame', (code) => {
    const room = rooms.get(code);
    if (room && (room.players.X === socket.id || room.players.O === socket.id)) {
      room.board = ['', '', '', '', '', '', '', '', ''];
      room.currentPlayer = 'X';
      room.active = true;
      io.to(code).emit('roomUpdate', room);
    }
  });

  socket.on('disconnect', () => {
    // Cleanup rooms if empty
    for (let [code, room] of rooms) {
      if (room.players.X === socket.id || room.players.O === socket.id) {
        room.active = false;
        io.to(code).emit('roomInactive');
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// Load initial leaderboard
let leaderboard = [];
try {
  const data = fs.readFileSync(pathToLeaderboard, 'utf8');
  leaderboard = JSON.parse(data);
  const top10 = leaderboard.sort((a,b) => b.wins - a.wins).slice(0,10);
  io.emit('leaderboardUpdate', top10);
} catch (e) {
  io.emit('leaderboardUpdate', []);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

