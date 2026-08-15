import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
export const GAME_ICONS = [
  '🎉', '🎈', '🎯', '🎪', '🎲', '🎮', '🏆', '🚀', '🌟', '🔥',
  '🎨', '🎸', '🦄', '🐙', '🍕', '🌈', '⚡', '🧩', '🎭', '🍀'
];
export const PLAYER_ICONS = [
  '😀', '😎', '🤖', '👽', '🐱', '🐶', '🦊', '🐼', '🐨', '🐵',
  '🦁', '🐯', '🐸', '🐙', '🦄', '🐝', '🦋', '🐬', '🦉', '🦖',
  '🍩', '🍪', '🍉', '🍓', '🍒', '🥑', '🍔', '🌮', '⚽', '🏀',
  '🎸', '🎧', '🚀', '🛸', '⭐', '🌙', '🔥', '💎', '🎯', '🎨'
];
const MAX_BODY_BYTES = 10_000;
const DEFAULT_ROUND_SECONDS = 180;
const MIN_ROUND_SECONDS = 30;
const MAX_ROUND_SECONDS = 1800;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_ROOM_AGE_MS = 14 * 24 * 60 * 60 * 1000; // hard cap: nothing outlives 2 weeks

const rooms = new Map();

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 403, 'Forbidden', 'text/plain');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, 'Not found', 'text/plain');
    return;
  }
  const ext = path.extname(filePath);
  const typeMap = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  send(res, 200, fs.readFileSync(filePath), typeMap[ext] || 'application/octet-stream');
}

function parseBody(req, cb) {
  let data = '';
  let done = false;
  const finish = (err, val) => {
    if (done) return;
    done = true;
    cb(err, val);
  };
  req.on('data', chunk => {
    if (done) return;
    data += chunk;
    if (data.length > MAX_BODY_BYTES) {
      finish(new Error('payload too large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!data) return finish(null, {});
    try {
      finish(null, JSON.parse(data));
    } catch {
      finish(new Error('invalid json'));
    }
  });
  req.on('error', () => finish(new Error('request error')));
}

export function isRoomStale(room, now) {
  const idleTooLong = room.clients.length === 0 && now - room.lastActivity > ROOM_TTL_MS;
  const tooOld = now - room.createdAt > MAX_ROOM_AGE_MS;
  return idleTooLong || tooOld;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearRoomTimer(room);
  broadcastAll(code, { type: 'room-deleted' });
  room.clients.forEach(c => {
    try {
      c.res.end();
    } catch {
      // already closed
    }
  });
  rooms.delete(code);
}

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeWrite(client, payload) {
  try {
    client.res.write(payload);
  } catch {
    // client likely disconnected; the 'close' handler will clean it up
  }
}

function broadcastAll(code, data) {
  const room = rooms.get(code);
  if (!room) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  room.clients.forEach(c => safeWrite(c, payload));
}

function broadcastEach(code, buildForClient) {
  const room = rooms.get(code);
  if (!room) return;
  room.clients.forEach(c => {
    const data = buildForClient(c);
    if (data) safeWrite(c, `data: ${JSON.stringify(data)}\n\n`);
  });
}

function getLeaderboard(room) {
  return [...room.players.entries()]
    .map(([name, p]) => ({ name, score: p.score, icon: p.icon }))
    .sort((a, b) => b.score - a.score);
}

function rosterList(room) {
  return [...room.players.entries()].map(([name, p]) => ({ name, icon: p.icon }));
}

function erasePersonalData(room) {
  // Participants' fun facts are personal data; wipe them the moment the game
  // ends instead of waiting for the room's 2-week retention cap or a manual
  // delete. Names and scores stay (needed for the leaderboard/history), but
  // the fact text itself is gone from server memory for good.
  for (const player of room.players.values()) {
    player.fact = null;
  }
  for (const log of room.answerLog.values()) {
    for (const entry of log) {
      entry.fact = null;
    }
  }
}

function finalizeGame(room, code) {
  clearRoomTimer(room);
  room.status = 'complete';
  room.lastActivity = Date.now();
  const leaderboard = getLeaderboard(room);
  broadcastAll(code, { type: 'game-over', leaderboard, podium: leaderboard.slice(0, 3) });
  erasePersonalData(room);
}

function completedCount(room) {
  let count = 0;
  for (const name of room.players.keys()) {
    const queue = room.queues.get(name) || [];
    if ((room.progress.get(name) ?? 0) >= queue.length) count++;
  }
  return count;
}

function joinUrlFor(req, code) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}/j/${code}`;
}

function sendWithQr(req, res, code, base) {
  const joinUrl = joinUrlFor(req, code);
  QRCode.toDataURL(joinUrl, { margin: 1, width: 240 })
    .then(qrCode => send(res, 200, { ...base, joinUrl, qrCode }))
    .catch(() => send(res, 200, { ...base, joinUrl, qrCode: null }));
}

function handleAPI(req, res) {
  if (req.method === 'POST' && req.url === '/create-room') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const password = String(body.password || '').trim();
      if (password.length > 60) return send(res, 400, { error: 'password is too long' });
      const name = String(body.name || '').trim();
      if (name.length > 60) return send(res, 400, { error: 'room name is too long' });

      let roundSeconds = DEFAULT_ROUND_SECONDS;
      if (body.roundSeconds !== undefined && body.roundSeconds !== null && body.roundSeconds !== '') {
        const n = Number(body.roundSeconds);
        if (!Number.isInteger(n) || n < MIN_ROUND_SECONDS || n > MAX_ROUND_SECONDS) {
          return send(res, 400, {
            error: `round timer must be a whole number of seconds between ${MIN_ROUND_SECONDS} and ${MAX_ROUND_SECONDS}`
          });
        }
        roundSeconds = n;
      }
      const musicEnabled = Boolean(body.musicEnabled);

      const code = generateCode();
      const hostToken = crypto.randomBytes(16).toString('hex');
      const icon = GAME_ICONS[Math.floor(Math.random() * GAME_ICONS.length)];
      rooms.set(code, {
        players: new Map(),
        clients: [],
        status: 'lobby',
        queues: new Map(),
        progress: new Map(),
        answerLog: new Map(),
        endsAt: null,
        timer: null,
        roundSeconds,
        musicEnabled,
        hostToken,
        password,
        icon,
        name,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      sendWithQr(req, res, code, {
        code,
        hostToken,
        icon,
        roomName: name,
        roundSeconds,
        musicEnabled,
        passwordProtected: password.length > 0
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/verify-password') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').trim().toUpperCase();
      const password = String(body.password || '');
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.password && room.password !== password) {
        return send(res, 403, { error: 'incorrect password' });
      }
      send(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/join-room') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const fact = String(body.fact || '').trim();
      const password = String(body.password || '').trim();
      if (!code || !name || !fact) {
        return send(res, 400, { error: 'code, name, and fact are required' });
      }
      if (name.length > 40) return send(res, 400, { error: 'name is too long' });
      if (fact.length > 280) return send(res, 400, { error: 'fun fact is too long' });
      const requestedIcon = String(body.icon || '');
      const playerIcon = PLAYER_ICONS.includes(requestedIcon)
        ? requestedIcon
        : PLAYER_ICONS[Math.floor(Math.random() * PLAYER_ICONS.length)];
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.password && room.password !== password) {
        return send(res, 403, { error: 'incorrect room password' });
      }
      const taken = [...room.players.keys()].some(
        n => n.toLowerCase() === name.toLowerCase()
      );
      if (taken) return send(res, 400, { error: 'that name is already taken in this room' });
      room.players.set(name, { fact, score: 0, icon: playerIcon });
      room.lastActivity = Date.now();
      broadcastAll(code, { type: 'roster', players: rosterList(room) });
      send(res, 200, {
        ok: true,
        name,
        playerIcon,
        icon: room.icon,
        roomName: room.name,
        roundSeconds: room.roundSeconds,
        musicEnabled: room.musicEnabled
      });
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/room-state')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room not found' });
    sendWithQr(req, res, code, {
      code,
      status: room.status,
      endsAt: room.endsAt,
      roundSeconds: room.roundSeconds,
      musicEnabled: room.musicEnabled,
      icon: room.icon,
      roomName: room.name,
      passwordProtected: Boolean(room.password),
      players: [...room.players.entries()].map(([name, p]) => ({ name, score: p.score, icon: p.icon })),
      leaderboard: getLeaderboard(room)
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/player-history')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const hostToken = url.searchParams.get('hostToken') || '';
    const name = url.searchParams.get('name') || '';
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room not found' });
    if (room.hostToken !== hostToken) return send(res, 403, { error: 'not authorized' });
    const log = room.answerLog.get(name);
    if (!log) return send(res, 404, { error: 'no history for that player' });
    send(res, 200, { name, answers: log });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/events')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const name = url.searchParams.get('name') || null;
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    const client = { res, name };
    room.clients.push(client);
    req.on('close', () => {
      room.clients = room.clients.filter(c => c !== client);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/start') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.hostToken !== body.hostToken) {
        return send(res, 403, { error: 'not authorized' });
      }
      if (room.status === 'active') {
        return send(res, 400, { error: 'the game is already in progress' });
      }
      if (room.status === 'complete') {
        return send(res, 400, { error: 'this game has ended; create a new room to play again' });
      }
      const names = [...room.players.keys()];
      if (names.length < 2) {
        return send(res, 400, { error: 'need at least 2 players to start' });
      }

      room.queues = new Map();
      room.progress = new Map();
      room.answerLog = new Map();
      for (const n of names) {
        room.queues.set(n, shuffle(names.filter(x => x !== n)));
        room.progress.set(n, 0);
        room.answerLog.set(n, []);
      }
      room.status = 'active';
      room.endsAt = Date.now() + room.roundSeconds * 1000;
      room.lastActivity = Date.now();

      broadcastEach(code, client => {
        const queue = room.queues.get(client.name);
        if (!queue) {
          return {
            type: 'round-started',
            endsAt: room.endsAt,
            musicEnabled: room.musicEnabled
          };
        }
        return {
          type: 'question',
          fact: room.players.get(queue[0]).fact,
          options: rosterList(room),
          questionIndex: 1,
          totalQuestions: queue.length,
          endsAt: room.endsAt,
          musicEnabled: room.musicEnabled
        };
      });

      clearRoomTimer(room);
      room.timer = setTimeout(() => {
        const current = rooms.get(code);
        if (current === room && room.status === 'active') finalizeGame(room, code);
      }, room.roundSeconds * 1000 + 250);
      room.timer.unref?.();

      send(res, 200, { ok: true, endsAt: room.endsAt });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/answer') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const name = String(body.name || '');
      const guess = String(body.guess || '');
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.status !== 'active') return send(res, 400, { error: 'no round in progress' });
      if (!room.players.has(name)) return send(res, 400, { error: 'unknown player' });
      const queue = room.queues.get(name);
      const idx = room.progress.get(name);
      if (!queue || idx === undefined) {
        return send(res, 400, { error: 'you joined after this round started' });
      }
      if (idx >= queue.length) {
        return send(res, 400, { error: 'you already answered all your questions' });
      }
      if (!room.players.has(guess)) return send(res, 400, { error: 'invalid option' });

      const subject = queue[idx];
      const correct = guess === subject;
      if (correct) room.players.get(name).score += 1;
      room.answerLog.get(name).push({
        subject,
        fact: room.players.get(subject).fact,
        guess,
        correct
      });
      room.progress.set(name, idx + 1);
      room.lastActivity = Date.now();

      const finishedNow = idx + 1 >= queue.length;
      broadcastAll(code, {
        type: 'player-progress',
        name,
        finished: finishedNow,
        completedCount: completedCount(room),
        totalPlayers: room.players.size
      });

      if (completedCount(room) >= room.players.size) {
        finalizeGame(room, code);
      }

      if (finishedNow) {
        send(res, 200, { correct, answer: subject, finished: true });
      } else {
        const nextSubject = queue[idx + 1];
        send(res, 200, {
          correct,
          answer: subject,
          finished: false,
          next: {
            fact: room.players.get(nextSubject).fact,
            questionIndex: idx + 2,
            totalQuestions: queue.length
          }
        });
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/end') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.hostToken !== body.hostToken) {
        return send(res, 403, { error: 'not authorized' });
      }
      if (room.status === 'complete') {
        return send(res, 400, { error: 'this game has already ended' });
      }
      finalizeGame(room, code);
      send(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/delete-room') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.hostToken !== body.hostToken) {
        return send(res, 403, { error: 'not authorized' });
      }
      deleteRoom(code);
      send(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/remove-me') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const name = String(body.name || '').trim();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (!room.players.has(name)) return send(res, 404, { error: 'player not found' });
      room.players.delete(name);
      room.lastActivity = Date.now();
      broadcastAll(code, { type: 'roster', players: rosterList(room) });
      broadcastAll(code, { type: 'leaderboard', leaderboard: getLeaderboard(room) });
      send(res, 200, { ok: true });
    });
    return;
  }

  send(res, 404, { error: 'unknown endpoint' });
}

function requestListener(req, res) {
  const pathname = req.url.split('?')[0];
  const shortJoinMatch = req.method === 'GET' && pathname.match(/^\/j\/([A-Za-z0-9]{1,8})$/);
  if (shortJoinMatch) {
    const code = shortJoinMatch[1].toUpperCase();
    res.writeHead(302, { Location: `/player.html?code=${code}` });
    res.end();
    return;
  }
  if (
    pathname.startsWith('/create-room') ||
    pathname.startsWith('/verify-password') ||
    pathname.startsWith('/join-room') ||
    pathname.startsWith('/room-state') ||
    pathname.startsWith('/player-history') ||
    pathname.startsWith('/events') ||
    pathname.startsWith('/start') ||
    pathname.startsWith('/answer') ||
    pathname.startsWith('/end') ||
    pathname.startsWith('/delete-room') ||
    pathname.startsWith('/remove-me')
  ) {
    handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
}

export function createServer() {
  const server = http.createServer(requestListener);
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (isRoomStale(room, now)) deleteRoom(code);
    }
  }, 10 * 60 * 1000);
  sweep.unref();
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
  );
}
