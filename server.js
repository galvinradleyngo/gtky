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
const MAX_BODY_BYTES = 10_000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

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
    .map(([name, p]) => ({ name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function finalizeRound(room, code) {
  const results = [...room.answered.entries()].map(([name, a]) => ({
    name,
    guess: a.guess,
    correct: a.correct
  }));
  broadcastAll(code, {
    type: 'reveal',
    fact: room.currentFact,
    answer: room.currentAnswer,
    results
  });
  broadcastAll(code, { type: 'leaderboard', leaderboard: getLeaderboard(room) });
  room.status = 'reveal';
  room.currentAnswer = null;
  room.currentFact = null;
  room.lastActivity = Date.now();
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
    const code = generateCode();
    const hostToken = crypto.randomBytes(16).toString('hex');
    rooms.set(code, {
      players: new Map(),
      clients: [],
      status: 'lobby',
      currentAnswer: null,
      currentFact: null,
      answered: new Map(),
      eligibleCount: 0,
      usedFacts: new Set(),
      round: 0,
      hostToken,
      lastActivity: Date.now()
    });
    sendWithQr(req, res, code, { code, hostToken });
    return;
  }

  if (req.method === 'POST' && req.url === '/join-room') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const fact = String(body.fact || '').trim();
      if (!code || !name || !fact) {
        return send(res, 400, { error: 'code, name, and fact are required' });
      }
      if (name.length > 40) return send(res, 400, { error: 'name is too long' });
      if (fact.length > 280) return send(res, 400, { error: 'fun fact is too long' });
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      const taken = [...room.players.keys()].some(
        n => n.toLowerCase() === name.toLowerCase()
      );
      if (taken) return send(res, 400, { error: 'that name is already taken in this room' });
      room.players.set(name, { fact, score: 0 });
      room.lastActivity = Date.now();
      broadcastAll(code, { type: 'roster', players: [...room.players.keys()] });
      send(res, 200, { ok: true, name });
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
      round: room.round,
      players: [...room.players.entries()].map(([name, p]) => ({ name, score: p.score })),
      leaderboard: getLeaderboard(room)
    });
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
      if (room.status === 'question') {
        return send(res, 400, { error: 'a round is already in progress' });
      }
      const names = [...room.players.keys()];
      if (names.length < 2) {
        return send(res, 400, { error: 'need at least 2 players to start' });
      }
      let pool = names.filter(n => !room.usedFacts.has(n));
      if (pool.length === 0) {
        room.usedFacts.clear();
        pool = names;
      }
      const target = pool[Math.floor(Math.random() * pool.length)];
      room.usedFacts.add(target);
      room.currentAnswer = target;
      room.currentFact = room.players.get(target).fact;
      room.answered = new Map();
      room.eligibleCount = names.length - 1;
      room.status = 'question';
      room.round += 1;
      room.lastActivity = Date.now();
      broadcastEach(code, client => ({
        type: 'question',
        fact: room.currentFact,
        options: names,
        round: room.round,
        isSubject: client.name === target
      }));
      send(res, 200, { ok: true });
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
      if (room.status !== 'question') {
        return send(res, 400, { error: 'no round in progress' });
      }
      if (!room.players.has(name)) return send(res, 400, { error: 'unknown player' });
      if (name === room.currentAnswer) {
        return send(res, 400, { error: "you can't guess your own fact" });
      }
      if (room.answered.has(name)) {
        return send(res, 400, { error: 'you already answered this round' });
      }
      if (!room.players.has(guess)) return send(res, 400, { error: 'invalid option' });

      const answerName = room.currentAnswer;
      const correct = guess === answerName;
      if (correct) {
        room.players.get(name).score += 1;
      }
      room.answered.set(name, { guess, correct });
      room.lastActivity = Date.now();
      broadcastAll(code, {
        type: 'player-answered',
        name,
        answeredCount: room.answered.size,
        totalEligible: room.eligibleCount
      });
      if (room.answered.size >= room.eligibleCount) {
        finalizeRound(room, code);
      }
      send(res, 200, { correct, answer: answerName });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/reveal') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.hostToken !== body.hostToken) {
        return send(res, 403, { error: 'not authorized' });
      }
      if (room.status !== 'question') {
        return send(res, 400, { error: 'no round in progress' });
      }
      finalizeRound(room, code);
      send(res, 200, { ok: true });
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
      room.status = 'complete';
      room.currentAnswer = null;
      room.currentFact = null;
      room.lastActivity = Date.now();
      broadcastAll(code, { type: 'game-over', leaderboard: getLeaderboard(room) });
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
    pathname.startsWith('/join-room') ||
    pathname.startsWith('/room-state') ||
    pathname.startsWith('/events') ||
    pathname.startsWith('/start') ||
    pathname.startsWith('/answer') ||
    pathname.startsWith('/reveal') ||
    pathname.startsWith('/end')
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
      if (room.clients.length === 0 && now - room.lastActivity > ROOM_TTL_MS) {
        rooms.delete(code);
      }
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
