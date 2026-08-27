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
const DEFAULT_FACTS_PER_PLAYER = 1;
const MAX_FACTS_PER_PLAYER = 10;
const MAX_FACTS_TO_PLAY_LIMIT = 50;
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
  if (pathname === '/') pathname = '/host.html';
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
    player.facts = null;
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

function validateRoundSeconds(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_ROUND_SECONDS || n > MAX_ROUND_SECONDS) {
    return {
      ok: false,
      error: `round timer must be a whole number of seconds between ${MIN_ROUND_SECONDS} and ${MAX_ROUND_SECONDS}`
    };
  }
  return { ok: true, value: n };
}

function validateFactsPerPlayer(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FACTS_PER_PLAYER) {
    return {
      ok: false,
      error: `facts per player must be a whole number between 1 and ${MAX_FACTS_PER_PLAYER}`
    };
  }
  return { ok: true, value: n };
}

function validateFactsToPlay(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > MAX_FACTS_TO_PLAY_LIMIT) {
    return {
      ok: false,
      error: `facts to play must be a whole number of at least 2 (up to ${MAX_FACTS_TO_PLAY_LIMIT})`
    };
  }
  return { ok: true, value: n };
}

function validateQuestionsPerPlayer(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FACTS_TO_PLAY_LIMIT) {
    return {
      ok: false,
      error: `questions per player must be a whole number between 1 and ${MAX_FACTS_TO_PLAY_LIMIT}`
    };
  }
  return { ok: true, value: n };
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

      const roundSecondsCheck = validateRoundSeconds(body.roundSeconds);
      if (!roundSecondsCheck.ok) return send(res, 400, { error: roundSecondsCheck.error });
      const roundSeconds = roundSecondsCheck.value ?? DEFAULT_ROUND_SECONDS;

      const factsPerPlayerCheck = validateFactsPerPlayer(body.factsPerPlayer);
      if (!factsPerPlayerCheck.ok) return send(res, 400, { error: factsPerPlayerCheck.error });
      const factsPerPlayer = factsPerPlayerCheck.value ?? DEFAULT_FACTS_PER_PLAYER;

      const factsToPlayCheck = validateFactsToPlay(body.factsToPlay);
      if (!factsToPlayCheck.ok) return send(res, 400, { error: factsToPlayCheck.error });
      const factsToPlay = factsToPlayCheck.value;

      const questionsPerPlayerCheck = validateQuestionsPerPlayer(body.questionsPerPlayer);
      if (!questionsPerPlayerCheck.ok) return send(res, 400, { error: questionsPerPlayerCheck.error });
      const questionsPerPlayer = questionsPerPlayerCheck.value;

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
        factsPerPlayer,
        factsToPlay,
        questionsPerPlayer,
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
        factsPerPlayer,
        factsToPlay,
        questionsPerPlayer,
        musicEnabled,
        passwordProtected: password.length > 0
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/update-room') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      if (room.hostToken !== body.hostToken) {
        return send(res, 403, { error: 'not authorized' });
      }
      if (room.status !== 'lobby') {
        return send(res, 400, { error: 'can only edit a game before it starts' });
      }

      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length > 60) return send(res, 400, { error: 'room name is too long' });
        room.name = name;
      }
      if (body.password !== undefined) {
        const password = String(body.password || '').trim();
        if (password.length > 60) return send(res, 400, { error: 'password is too long' });
        room.password = password;
      }
      if (body.roundSeconds !== undefined) {
        const check = validateRoundSeconds(body.roundSeconds);
        if (!check.ok) return send(res, 400, { error: check.error });
        room.roundSeconds = check.value ?? DEFAULT_ROUND_SECONDS;
      }
      if (body.factsPerPlayer !== undefined) {
        const check = validateFactsPerPlayer(body.factsPerPlayer);
        if (!check.ok) return send(res, 400, { error: check.error });
        room.factsPerPlayer = check.value ?? DEFAULT_FACTS_PER_PLAYER;
      }
      if (body.factsToPlay !== undefined) {
        const check = validateFactsToPlay(body.factsToPlay);
        if (!check.ok) return send(res, 400, { error: check.error });
        room.factsToPlay = check.value;
      }
      if (body.questionsPerPlayer !== undefined) {
        const check = validateQuestionsPerPlayer(body.questionsPerPlayer);
        if (!check.ok) return send(res, 400, { error: check.error });
        room.questionsPerPlayer = check.value;
      }
      if (body.musicEnabled !== undefined) {
        room.musicEnabled = Boolean(body.musicEnabled);
      }

      room.lastActivity = Date.now();
      sendWithQr(req, res, code, {
        code,
        roomName: room.name,
        roundSeconds: room.roundSeconds,
        factsPerPlayer: room.factsPerPlayer,
        factsToPlay: room.factsToPlay,
        questionsPerPlayer: room.questionsPerPlayer,
        musicEnabled: room.musicEnabled,
        passwordProtected: Boolean(room.password),
        icon: room.icon
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/verify-password') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').trim().toUpperCase();
      const password = String(body.password || '').trim();
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
      if (!code || !name) {
        return send(res, 400, { error: 'code and name are required' });
      }
      if (name.length > 40) return send(res, 400, { error: 'name is too long' });
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });

      const requestedIcon = String(body.icon || '');
      const playerIcon = PLAYER_ICONS.includes(requestedIcon)
        ? requestedIcon
        : PLAYER_ICONS[Math.floor(Math.random() * PLAYER_ICONS.length)];
      // Room passwords authenticate the host reopening a saved game, not
      // players joining — anyone with the code/link/QR can join freely.
      const taken = [...room.players.keys()].some(
        n => n.toLowerCase() === name.toLowerCase()
      );
      if (taken) return send(res, 400, { error: 'that name is already taken in this room' });
      // Registering just needs a name + avatar — the player shows up on the
      // host's screen immediately. Their facts (however many the room
      // requires) are submitted separately via /submit-facts right after.
      room.players.set(name, { facts: [], score: 0, icon: playerIcon });
      room.lastActivity = Date.now();
      broadcastAll(code, { type: 'roster', players: rosterList(room) });
      send(res, 200, {
        ok: true,
        name,
        playerIcon,
        icon: room.icon,
        roomName: room.name,
        roundSeconds: room.roundSeconds,
        factsPerPlayer: room.factsPerPlayer,
        factsToPlay: room.factsToPlay,
        musicEnabled: room.musicEnabled
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/submit-facts') {
    parseBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'invalid request body' });
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'room not found' });
      const player = room.players.get(name);
      if (!player) return send(res, 404, { error: 'you are not registered in this room' });
      if (room.status !== 'lobby') {
        return send(res, 400, { error: 'the game has already started' });
      }

      const rawFacts = Array.isArray(body.facts) ? body.facts : [];
      const facts = rawFacts.map(f => String(f || '').trim());
      if (facts.length !== room.factsPerPlayer) {
        return send(res, 400, {
          error: `you must submit exactly ${room.factsPerPlayer} fact${room.factsPerPlayer === 1 ? '' : 's'} about yourself`
        });
      }
      if (facts.some(f => !f)) {
        return send(res, 400, { error: 'every fact must be filled in' });
      }
      if (facts.some(f => f.length > 280)) {
        return send(res, 400, { error: 'each fact must be 280 characters or fewer' });
      }

      player.facts = facts;
      room.lastActivity = Date.now();
      send(res, 200, { ok: true });
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
      factsPerPlayer: room.factsPerPlayer,
      factsToPlay: room.factsToPlay,
      questionsPerPlayer: room.questionsPerPlayer,
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
      // Only players who've actually submitted their facts are eligible to
      // be quizzed on or receive a queue — someone who registered a name
      // but hasn't finished the facts step yet is still visible on the
      // roster, but treated like a late joiner once the round starts.
      const names = [...room.players.entries()]
        .filter(([, p]) => p.facts.length === room.factsPerPlayer)
        .map(([n]) => n);
      if (names.length < 2) {
        return send(res, 400, { error: 'need at least 2 players who have submitted their facts to start' });
      }

      // Three independent settings shape the round:
      // - "Facts to play" is a shared pool: only these players are ever
      //   asked about at all.
      // - "Facts per player" is how many facts each player submitted when
      //   joining (their personal blank count).
      // - "Questions per player" is how many questions each guesser
      //   answers. By default that's exactly one per other featured
      //   player (one of their facts, picked at random) regardless of how
      //   many facts they submitted; the host can raise it to draw more
      //   questions from the full shared pool of individual facts.
      const poolSize = room.factsToPlay ? Math.min(room.factsToPlay, names.length) : names.length;
      const pool = poolSize < names.length ? shuffle(names).slice(0, poolSize) : names;
      const subjectPool = [];
      for (const n of pool) {
        room.players.get(n).facts.forEach((_, factIndex) => subjectPool.push({ name: n, factIndex }));
      }

      room.queues = new Map();
      room.progress = new Map();
      room.answerLog = new Map();
      for (const n of names) {
        let queue;
        if (room.questionsPerPlayer) {
          const fullPool = subjectPool.filter(s => s.name !== n);
          queue = shuffle(fullPool).slice(0, Math.min(room.questionsPerPlayer, fullPool.length));
        } else {
          queue = shuffle(
            pool
              .filter(other => other !== n)
              .map(other => {
                const facts = room.players.get(other).facts;
                return { name: other, factIndex: Math.floor(Math.random() * facts.length) };
              })
          );
        }
        room.queues.set(n, queue);
        room.progress.set(n, 0);
        room.answerLog.set(n, []);
      }
      room.status = 'active';
      room.endsAt = Date.now() + room.roundSeconds * 1000;
      room.lastActivity = Date.now();

      broadcastEach(code, client => {
        const queue = room.queues.get(client.name);
        if (!queue || queue.length === 0) {
          return {
            type: 'round-started',
            endsAt: room.endsAt,
            musicEnabled: room.musicEnabled
          };
        }
        const first = queue[0];
        return {
          type: 'question',
          fact: room.players.get(first.name).facts[first.factIndex],
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
      const correct = guess === subject.name;
      if (correct) room.players.get(name).score += 1;
      room.answerLog.get(name).push({
        subject: subject.name,
        fact: room.players.get(subject.name).facts[subject.factIndex],
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
        send(res, 200, { correct, answer: subject.name, finished: true });
      } else {
        const nextSubject = queue[idx + 1];
        send(res, 200, {
          correct,
          answer: subject.name,
          finished: false,
          next: {
            fact: room.players.get(nextSubject.name).facts[nextSubject.factIndex],
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
    pathname.startsWith('/update-room') ||
    pathname.startsWith('/verify-password') ||
    pathname.startsWith('/join-room') ||
    pathname.startsWith('/submit-facts') ||
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
