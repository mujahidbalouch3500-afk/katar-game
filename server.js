const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const db = new Database('katar.db');
const JWT_SECRET = 'katar-secret-2024-change-this';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123'; // Change this!

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DB Setup ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player1 TEXT NOT NULL,
    player2 TEXT,
    winner TEXT,
    status TEXT DEFAULT 'waiting',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME
  );
`);

// ─── Auth Middleware ─────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token nahi mila' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token galat hai' }); }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token nahi mila' });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ error: 'Admin access chahiye' });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'Token galat hai' }); }
}

// ─── Auth Routes ─────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username aur password dono dein' });
  if (username.length < 3) return res.status(400).json({ error: 'Username 3 harf se zyada ho' });
  if (password.length < 4) return res.status(400).json({ error: 'Password 4 harf se zyada ho' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    const token = jwt.sign({ username, role: 'player' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Yeh username le liya gaya hai' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ token, username: 'admin', role: 'admin' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Username ya password galat hai' });
  const token = jwt.sign({ username, role: 'player' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, role: 'player' });
});

// ─── Admin Routes ─────────────────────────────────────────────
app.get('/api/admin/players', adminMiddleware, (req, res) => {
  const players = db.prepare('SELECT id, username, created_at FROM users ORDER BY created_at DESC').all();
  res.json(players);
});

app.get('/api/admin/games', adminMiddleware, (req, res) => {
  const games = db.prepare('SELECT * FROM games ORDER BY started_at DESC LIMIT 100').all();
  res.json(games);
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const totalPlayers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalGames = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
  const activeGames = db.prepare("SELECT COUNT(*) as c FROM games WHERE status='playing'").get().c;
  const completedGames = db.prepare("SELECT COUNT(*) as c FROM games WHERE status='finished'").get().c;
  res.json({ totalPlayers, totalGames, activeGames, completedGames });
});

app.delete('/api/admin/players/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Game State ───────────────────────────────────────────────
const waitingPlayers = [];
const activeGames = {};

const MILLS = [
  [0,1,2],[3,4,5],[6,7,8],[15,16,17],[18,19,20],[21,22,23],
  [9,10,11],[12,13,14],
  [0,9,21],[3,10,18],[6,11,15],[1,4,7],[16,19,22],[8,12,17],
  [2,13,23],[5,14,20]
];
const ADJACENT = {
  0:[1,9],1:[0,2,4],2:[1,13],3:[4,10],4:[1,3,5,7],5:[4,13],
  6:[7,11],7:[4,6,8],8:[7,12],9:[0,10,21],10:[3,9,11,18],
  11:[6,10,15],12:[8,13,16],13:[2,5,12,14,23],14:[13,19],
  15:[11,16],16:[12,15,17],17:[16,19],18:[10,19],
  19:[14,17,18,22],20:[19,23],21:[9,22],22:[19,21,23],23:[2,13,20,22]
};

function checkMill(board, idx, player) {
  return MILLS.some(m => m.includes(idx) && m.every(i => board[i] === player));
}
function countPieces(board, p) { return board.filter(v => v === p).length; }
function allInMill(board, player) {
  return board.every((v, i) => v !== player || checkMill(board, i, player));
}
function hasValidMove(board, player) {
  return board.some((v, i) => {
    if (v !== player) return false;
    return ADJACENT[i].some(j => board[j] === 0);
  });
}

function createGame(p1socket, p2socket, p1name, p2name) {
  const gameId = Date.now().toString();
  const dbGame = db.prepare('INSERT INTO games (player1, player2, status) VALUES (?, ?, ?)').run(p1name, p2name, 'playing');
  const state = {
    gameId, dbGameId: dbGame.lastInsertRowid,
    board: Array(24).fill(0),
    hand: [9, 9],
    phase: [1, 1],
    current: 0,
    mustRemove: false,
    selected: -1,
    players: [{ socket: p1socket, name: p1name }, { socket: p2socket, name: p2name }],
    over: false
  };
  activeGames[gameId] = state;
  p1socket.join(gameId);
  p2socket.join(gameId);
  p1socket.gameId = gameId;
  p2socket.gameId = gameId;
  p1socket.playerIndex = 0;
  p2socket.playerIndex = 1;
  emitState(gameId);
  return gameId;
}

function emitState(gameId) {
  const g = activeGames[gameId];
  if (!g) return;
  const payload = {
    board: g.board, hand: g.hand, phase: g.phase,
    current: g.current, mustRemove: g.mustRemove,
    players: g.players.map(p => p.name), over: g.over,
    winner: g.winner
  };
  io.to(gameId).emit('state', payload);
}

function endGame(gameId, winner) {
  const g = activeGames[gameId];
  if (!g) return;
  g.over = true;
  g.winner = winner;
  db.prepare("UPDATE games SET status='finished', winner=?, ended_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(winner, g.dbGameId);
  emitState(gameId);
  setTimeout(() => { delete activeGames[gameId]; }, 30000);
}

// ─── Socket.io ────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token nahi mila'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { next(new Error('Token galat')); }
});

io.on('connection', (socket) => {
  console.log('Connected:', socket.user.username);

  socket.on('find_game', () => {
    const username = socket.user.username;
    const already = waitingPlayers.findIndex(w => w.user.username === username);
    if (already !== -1) waitingPlayers.splice(already, 1);

    if (waitingPlayers.length > 0) {
      const opponent = waitingPlayers.shift();
      createGame(opponent, socket, opponent.user.username, username);
    } else {
      waitingPlayers.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('cancel_find', () => {
    const idx = waitingPlayers.indexOf(socket);
    if (idx !== -1) waitingPlayers.splice(idx, 1);
    socket.emit('cancelled');
  });

  socket.on('move', (data) => {
    const gameId = socket.gameId;
    const g = activeGames[gameId];
    if (!g || g.over) return;
    if (g.current !== socket.playerIndex) return;

    const { type, from, to } = data;
    const p = g.current + 1;
    const opp = p === 1 ? 2 : 1;

    if (g.mustRemove) {
      if (g.board[to] !== opp) return;
      const oppAllMill = allInMill(g.board, opp);
      if (!oppAllMill && checkMill(g.board, to, opp)) return;
      g.board[to] = 0;
      g.mustRemove = false;
      const oppPieces = countPieces(g.board, opp);
      const oppIdx = g.current === 0 ? 1 : 0;
      if ((g.phase[oppIdx] >= 2 && oppPieces < 3) || (g.phase[oppIdx] === 1 && oppPieces < 3 && g.hand[oppIdx] === 0)) {
        return endGame(gameId, g.players[g.current].name);
      }
      if (g.phase[oppIdx] >= 2 && oppPieces === 3) g.phase[oppIdx] = 3;
      g.current = g.current === 0 ? 1 : 0;
      emitState(gameId); return;
    }

    if (g.phase[g.current] === 1) {
      if (g.board[to] !== 0) return;
      g.board[to] = p;
      g.hand[g.current]--;
      if (g.hand[g.current] === 0) g.phase[g.current] = 2;
      if (checkMill(g.board, to, p)) { g.mustRemove = true; emitState(gameId); return; }
      g.current = g.current === 0 ? 1 : 0;
      emitState(gameId); return;
    }

    if (g.phase[g.current] === 2) {
      if (g.board[from] !== p || g.board[to] !== 0) return;
      if (!ADJACENT[from].includes(to)) return;
      g.board[from] = 0; g.board[to] = p;
      if (checkMill(g.board, to, p)) { g.mustRemove = true; emitState(gameId); return; }
      const nextIdx = g.current === 0 ? 1 : 0;
      if (!hasValidMove(g.board, opp) && g.phase[nextIdx] === 2) {
        return endGame(gameId, g.players[g.current].name);
      }
      g.current = g.current === 0 ? 1 : 0;
      emitState(gameId); return;
    }

    if (g.phase[g.current] === 3) {
      if (g.board[from] !== p || g.board[to] !== 0) return;
      g.board[from] = 0; g.board[to] = p;
      if (checkMill(g.board, to, p)) { g.mustRemove = true; emitState(gameId); return; }
      g.current = g.current === 0 ? 1 : 0;
      emitState(gameId); return;
    }
  });

  socket.on('disconnect', () => {
    const idx = waitingPlayers.indexOf(socket);
    if (idx !== -1) waitingPlayers.splice(idx, 1);
    const gameId = socket.gameId;
    if (gameId && activeGames[gameId] && !activeGames[gameId].over) {
      const g = activeGames[gameId];
      const otherIdx = socket.playerIndex === 0 ? 1 : 0;
      const other = g.players[otherIdx];
      endGame(gameId, other.name);
      io.to(gameId).emit('opponent_left');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Katar server chal raha hai port ${PORT} par`));
