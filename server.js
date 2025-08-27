import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rooms = new Map();

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

function serveStatic(req, res) {
  let filePath = path.join(
    __dirname,
    'public',
    req.url === '/' ? 'index.html' : req.url
  );
  if (!fs.existsSync(filePath)) {
    send(res, 404, 'Not found', 'text/plain');
    return;
  }
  const ext = path.extname(filePath);
  const typeMap = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css'
  };
  send(res, 200, fs.readFileSync(filePath), typeMap[ext] || 'text/plain');
}

function collectBody(req, cb) {
  let data = '';
  req.on('data', chunk => (data += chunk));
  req.on('end', () => cb(data));
}

function broadcast(code, data) {
  const room = rooms.get(code);
  if (!room) return;
  room.clients.forEach(c => c.res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function handleAPI(req, res) {
  if (req.method === 'POST' && req.url === '/create-room') {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms.set(code, { players: new Map(), clients: [], currentAnswer: null });
    send(res, 200, { code });
    return;
  }
  if (req.method === 'POST' && req.url === '/join-room') {
    collectBody(req, data => {
      const { code, name, fact } = JSON.parse(data);
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      room.players.set(name, { fact, score: 0 });
      broadcast(code, { type: 'player-joined', name });
      send(res, 200, { ok: true });
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/events')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    const client = { res };
    room.clients.push(client);
    req.on('close', () => {
      room.clients = room.clients.filter(c => c !== client);
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/start') {
    collectBody(req, data => {
      const { code } = JSON.parse(data);
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      const entries = [...room.players.entries()];
      if (entries.length === 0)
        return send(res, 400, { error: 'no players' });
      const rand = entries[Math.floor(Math.random() * entries.length)];
      const fact = rand[1].fact;
      const options = entries.map(e => e[0]);
      room.currentAnswer = rand[0];
      broadcast(code, { type: 'question', fact, options });
      send(res, 200, { ok: true });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/answer') {
    collectBody(req, data => {
      const { code, name, guess } = JSON.parse(data);
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      const correct = room.currentAnswer === guess;
      if (correct) {
        const player = room.players.get(name);
        if (player) player.score += 1;
      }
      broadcast(code, {
        type: 'reveal',
        correct,
        answer: room.currentAnswer,
        name
      });
      const leaderboard = [...room.players.entries()]
        .map(([n, p]) => ({ name: n, score: p.score }))
        .sort((a, b) => b.score - a.score);
      broadcast(code, { type: 'leaderboard', leaderboard });
      send(res, 200, { correct });
    });
    return;
  }
  send(res, 404, { error: 'unknown endpoint' });
}

function requestListener(req, res) {
  if (
    req.url.startsWith('/create-room') ||
    req.url.startsWith('/join-room') ||
    req.url.startsWith('/events') ||
    req.url.startsWith('/start') ||
    req.url.startsWith('/answer')
  ) {
    handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
}

export function createServer() {
  return http.createServer(requestListener);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
  );
}
