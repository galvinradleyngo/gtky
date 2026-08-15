import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer, isRoomStale, MAX_ROOM_AGE_MS, GAME_ICONS, PLAYER_ICONS } from '../server.js';

async function withServer(fn) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

function postJSON(base, url, body) {
  return fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function getJSON(base, url) {
  const res = await fetch(base + url);
  return { status: res.status, body: await res.json() };
}

async function openSSE(base, code, name) {
  const res = await fetch(`${base}/events?code=${code}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue = [];
  let waiterResolve = null;
  let closed = false;

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split('\n').find(l => l.startsWith('data: '));
          if (line) {
            queue.push(JSON.parse(line.slice(6)));
            if (waiterResolve) {
              const r = waiterResolve;
              waiterResolve = null;
              r();
            }
          }
        }
      }
    } catch {
      // reader cancelled or connection closed; fine
    }
  })();

  return {
    async next(timeoutMs = 2000) {
      if (queue.length) return queue.shift();
      const timedOut = await new Promise(resolve => {
        waiterResolve = () => resolve(false);
        setTimeout(() => resolve(true), timeoutMs);
      });
      if (timedOut) return null;
      return queue.length ? queue.shift() : null;
    },
    close() {
      if (!closed) {
        closed = true;
        reader.cancel().catch(() => {});
      }
    }
  };
}

async function createRoom(base, opts = {}) {
  const res = await postJSON(base, '/create-room', opts);
  return res.json();
}

async function joinRoom(base, code, name, fact, extra = {}) {
  const res = await postJSON(base, '/join-room', { code, name, fact, ...extra });
  return { status: res.status, body: await res.json() };
}

test('createServer returns an http server', () => {
  const server = createServer();
  assert.ok(server instanceof http.Server);
  server.close();
});

test('serves index.html at /', async () => {
  await withServer(async base => {
    const res = await fetch(base + '/');
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /Gotten to Know You/);
  });
});

test('blocks path traversal attempts', async () => {
  await withServer(async base => {
    const res = await fetch(base + '/..%2fserver.js');
    assert.notStrictEqual(res.status, 200);
  });
});

test('malformed JSON body does not crash the server', async () => {
  await withServer(async base => {
    const res = await fetch(base + '/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json'
    });
    assert.strictEqual(res.status, 400);
    const res2 = await fetch(base + '/');
    assert.strictEqual(res2.status, 200);
  });
});

test('create-room assigns a unique code, random icon, QR code, and defaults', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    assert.match(room.code, /^[A-Z0-9]{4}$/);
    assert.ok(room.hostToken);
    assert.ok(GAME_ICONS.includes(room.icon), room.icon);
    assert.strictEqual(room.roomName, '');
    assert.strictEqual(room.roundSeconds, 180);
    assert.strictEqual(room.musicEnabled, false);
    assert.strictEqual(room.passwordProtected, false);
    assert.ok(room.joinUrl.includes(room.code));
    assert.ok(room.qrCode.startsWith('data:image'));
  });
});

test('create-room accepts a custom name, round timer, and music flag', async () => {
  await withServer(async base => {
    const room = await createRoom(base, { name: 'Trivia Night', roundSeconds: 60, musicEnabled: true });
    assert.strictEqual(room.roomName, 'Trivia Night');
    assert.strictEqual(room.roundSeconds, 60);
    assert.strictEqual(room.musicEnabled, true);
  });
});

test('roundSeconds is validated to a whole number between 30 and 1800', async () => {
  await withServer(async base => {
    const tooSmall = await postJSON(base, '/create-room', { roundSeconds: 10 });
    assert.strictEqual(tooSmall.status, 400);
    const tooBig = await postJSON(base, '/create-room', { roundSeconds: 5000 });
    assert.strictEqual(tooBig.status, 400);
    const notInt = await postJSON(base, '/create-room', { roundSeconds: 61.5 });
    assert.strictEqual(notInt.status, 400);
    const ok = await postJSON(base, '/create-room', { roundSeconds: 120 });
    assert.strictEqual(ok.status, 200);
  });
});

test('short link redirects to player page with code prefilled', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    const res = await fetch(base + `/j/${room.code}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/player.html?code=${room.code}`);
  });
});

test('join-room validates fields, rejects duplicate names, and echoes room metadata', async () => {
  await withServer(async base => {
    const room = await createRoom(base, { name: 'Icebreaker', roundSeconds: 90 });

    const missing = await postJSON(base, '/join-room', { code: room.code, name: '', fact: 'x' });
    assert.strictEqual(missing.status, 400);

    const noRoom = await postJSON(base, '/join-room', { code: 'ZZZZ', name: 'Bo', fact: 'x' });
    assert.strictEqual(noRoom.status, 404);

    const first = await joinRoom(base, room.code, 'Ana', 'likes tea');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.icon, room.icon);
    assert.strictEqual(first.body.roomName, 'Icebreaker');
    assert.strictEqual(first.body.roundSeconds, 90);

    const dupe = await joinRoom(base, room.code, 'ana', 'likes coffee');
    assert.strictEqual(dupe.status, 400);
  });
});

test('join-room accepts a chosen player icon, or assigns a random valid one', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    const chosen = PLAYER_ICONS[5];
    const withIcon = await joinRoom(base, room.code, 'Ana', 'likes tea', { icon: chosen });
    assert.strictEqual(withIcon.body.playerIcon, chosen);

    const withoutIcon = await joinRoom(base, room.code, 'Bo', 'likes cats');
    assert.ok(PLAYER_ICONS.includes(withoutIcon.body.playerIcon));

    const withBogusIcon = await joinRoom(base, room.code, 'Cy', 'likes dogs', { icon: '🙈not-real' });
    assert.ok(PLAYER_ICONS.includes(withBogusIcon.body.playerIcon));

    const state = await getJSON(base, `/room-state?code=${room.code}`);
    const ana = state.body.players.find(p => p.name === 'Ana');
    assert.strictEqual(ana.icon, chosen);
    const leaderboardAna = state.body.leaderboard.find(p => p.name === 'Ana');
    assert.strictEqual(leaderboardAna.icon, chosen);
  });
});

test('password-protected rooms reject joins with a missing or wrong password', async () => {
  await withServer(async base => {
    const room = await createRoom(base, { password: 'letmein' });
    assert.strictEqual(room.passwordProtected, true);

    const noPassword = await joinRoom(base, room.code, 'Ana', 'x');
    assert.strictEqual(noPassword.status, 403);
    const wrongPassword = await joinRoom(base, room.code, 'Ana', 'x', { password: 'nope' });
    assert.strictEqual(wrongPassword.status, 403);
    const rightPassword = await joinRoom(base, room.code, 'Ana', 'x', { password: 'letmein' });
    assert.strictEqual(rightPassword.status, 200);
  });
});

test('/verify-password confirms or rejects without needing the host token', async () => {
  await withServer(async base => {
    const room = await createRoom(base, { password: 'sunshine' });

    const wrong = await postJSON(base, '/verify-password', { code: room.code, password: 'nope' });
    assert.strictEqual(wrong.status, 403);
    const missing = await postJSON(base, '/verify-password', { code: room.code });
    assert.strictEqual(missing.status, 403);
    const right = await postJSON(base, '/verify-password', { code: room.code, password: 'sunshine' });
    assert.strictEqual(right.status, 200);
    const unknownRoom = await postJSON(base, '/verify-password', { code: 'ZZZZ', password: 'x' });
    assert.strictEqual(unknownRoom.status, 404);

    const openRoom = await createRoom(base);
    const ok = await postJSON(base, '/verify-password', { code: openRoom.code, password: '' });
    assert.strictEqual(ok.status, 200);
  });
});

test('start requires a valid host token, at least two players, and blocks re-starting', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');

    const badToken = await postJSON(base, '/start', { code: room.code, hostToken: 'wrong' });
    assert.strictEqual(badToken.status, 403);

    const tooFewPlayers = await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(tooFewPlayers.status, 400);

    await joinRoom(base, room.code, 'Bo', 'likes cats');
    const ok = await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(ok.status, 200);

    const alreadyActive = await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(alreadyActive.status, 400);
  });
});

test('each player gets a personalized queue that excludes their own fact', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    const names = ['Ana', 'Bo', 'Cy'];
    for (const n of names) await joinRoom(base, room.code, n, `${n} fact`);

    const streams = {};
    for (const n of names) streams[n] = await openSSE(base, room.code, n);
    const hostStream = await openSSE(base, room.code, null);

    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });

    const hostMsg = await hostStream.next();
    assert.strictEqual(hostMsg.type, 'round-started');
    assert.ok(hostMsg.endsAt > Date.now());

    for (const n of names) {
      const msg = await streams[n].next();
      assert.strictEqual(msg.type, 'question');
      assert.strictEqual(msg.totalQuestions, 2); // every other player
      assert.notStrictEqual(msg.fact, `${n} fact`); // never asked about yourself
      const optionNames = msg.options.map(o => o.name).sort();
      assert.deepStrictEqual(optionNames, names.slice().sort());
      assert.ok(msg.options.every(o => typeof o.icon === 'string' && o.icon.length > 0));
    }
    for (const n of names) streams[n].close();
    hostStream.close();
  });
});

test('answering advances to the next personalized question with instant private feedback', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await joinRoom(base, room.code, 'Cy', 'likes dogs');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });

    // Ana's queue is some permutation of [Bo, Cy]; answer both of Ana's questions.
    const first = await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Bo' });
    assert.strictEqual(first.status, 200);
    const firstBody = await first.json();
    assert.strictEqual(firstBody.finished, false);
    assert.ok(firstBody.next);
    assert.strictEqual(firstBody.next.questionIndex, 2);
    assert.strictEqual(firstBody.next.totalQuestions, 2);

    const second = await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Cy' });
    const secondBody = await second.json();
    assert.strictEqual(secondBody.finished, true);
    assert.strictEqual(secondBody.next, undefined);

    const overAnswering = await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Bo' });
    assert.strictEqual(overAnswering.status, 400);
  });
});

test('invalid answer inputs are rejected: unknown player, unknown room, invalid guess', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });

    const unknownRoom = await postJSON(base, '/answer', { code: 'ZZZZ', name: 'Ana', guess: 'Bo' });
    assert.strictEqual(unknownRoom.status, 404);

    const unknownPlayer = await postJSON(base, '/answer', { code: room.code, name: 'Ghost', guess: 'Bo' });
    assert.strictEqual(unknownPlayer.status, 400);

    const invalidGuess = await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Nobody' });
    assert.strictEqual(invalidGuess.status, 400);
  });
});

test('a player who joins after the round starts has no queue and cannot answer', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    await joinRoom(base, room.code, 'Cy', 'likes dogs');

    const res = await postJSON(base, '/answer', { code: room.code, name: 'Cy', guess: 'Ana' });
    assert.strictEqual(res.status, 400);
  });
});

test('game auto-finalizes as soon as every player finishes their queue, with correct scoring', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');

    const anaStream = await openSSE(base, room.code, 'Ana');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    await anaStream.next(); // consume Ana's question broadcast

    // Ana's queue has exactly one question: about Bo. Guess correctly.
    const anaAns = await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Bo' });
    const anaBody = await anaAns.json();
    assert.strictEqual(anaBody.correct, true);
    assert.strictEqual(anaBody.finished, true);

    // room shouldn't be complete yet, Bo hasn't answered
    const midState = await getJSON(base, `/room-state?code=${room.code}`);
    assert.strictEqual(midState.body.status, 'active');

    // Bo guesses wrong on purpose
    const boAns = await postJSON(base, '/answer', { code: room.code, name: 'Bo', guess: 'Bo' });
    const boBody = await boAns.json();
    assert.strictEqual(boBody.correct, false);
    assert.strictEqual(boBody.finished, true);

    let finalMsg = null;
    for (let i = 0; i < 5 && !finalMsg; i++) {
      const msg = await anaStream.next();
      if (msg && msg.type === 'game-over') finalMsg = msg;
    }
    assert.ok(finalMsg, 'expected a game-over broadcast');
    assert.strictEqual(finalMsg.podium.length, 2);
    assert.strictEqual(finalMsg.leaderboard.find(p => p.name === 'Ana').score, 1);
    assert.strictEqual(finalMsg.leaderboard.find(p => p.name === 'Bo').score, 0);
    anaStream.close();

    const finalState = await getJSON(base, `/room-state?code=${room.code}`);
    assert.strictEqual(finalState.body.status, 'complete');

    const blocked = await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(blocked.status, 400);
  });
});

test('host can end the game early with /end, and cannot end it twice', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });

    const badToken = await postJSON(base, '/end', { code: room.code, hostToken: 'nope' });
    assert.strictEqual(badToken.status, 403);

    const ok = await postJSON(base, '/end', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(ok.status, 200);

    const state = await getJSON(base, `/room-state?code=${room.code}`);
    assert.strictEqual(state.body.status, 'complete');

    const again = await postJSON(base, '/end', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(again.status, 400);
  });
});

test('/player-history is host-only and reflects exactly what a player answered', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });
    await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Bo' });

    const noAuth = await fetch(base + `/player-history?code=${room.code}&name=Ana`);
    assert.strictEqual(noAuth.status, 403);

    const res = await fetch(
      base + `/player-history?code=${room.code}&hostToken=${room.hostToken}&name=Ana`
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.answers.length, 1);
    assert.strictEqual(body.answers[0].subject, 'Bo');
    assert.strictEqual(body.answers[0].guess, 'Bo');
    assert.strictEqual(body.answers[0].correct, true);

    const noHistory = await fetch(
      base + `/player-history?code=${room.code}&hostToken=${room.hostToken}&name=Ghost`
    );
    assert.strictEqual(noHistory.status, 404);
  });
});

test('participant facts are erased from server memory once the game ends', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');
    await postJSON(base, '/start', { code: room.code, hostToken: room.hostToken });

    // both players finish their (single) question each -> auto-finalizes
    await postJSON(base, '/answer', { code: room.code, name: 'Ana', guess: 'Bo' });
    await postJSON(base, '/answer', { code: room.code, name: 'Bo', guess: 'Ana' });

    const state = await getJSON(base, `/room-state?code=${room.code}`);
    assert.strictEqual(state.body.status, 'complete');

    const historyRes = await fetch(
      base + `/player-history?code=${room.code}&hostToken=${room.hostToken}&name=Ana`
    );
    const history = await historyRes.json();
    assert.strictEqual(history.answers.length, 1);
    assert.strictEqual(history.answers[0].fact, null, 'fact text should be erased after game end');
    assert.strictEqual(history.answers[0].subject, 'Bo');
    assert.strictEqual(history.answers[0].guess, 'Bo');

    // leaderboard (names + scores) should still be intact
    assert.strictEqual(state.body.leaderboard.length, 2);
  });
});

test('host can delete a room; only the host token is authorized to do it', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');

    const badToken = await postJSON(base, '/delete-room', { code: room.code, hostToken: 'wrong' });
    assert.strictEqual(badToken.status, 403);

    const ok = await postJSON(base, '/delete-room', { code: room.code, hostToken: room.hostToken });
    assert.strictEqual(ok.status, 200);

    const gone = await fetch(base + `/room-state?code=${room.code}`);
    assert.strictEqual(gone.status, 404);
  });
});

test('a player can remove just their own data without affecting others', async () => {
  await withServer(async base => {
    const room = await createRoom(base);
    await joinRoom(base, room.code, 'Ana', 'likes tea');
    await joinRoom(base, room.code, 'Bo', 'likes cats');

    const missing = await postJSON(base, '/remove-me', { code: room.code, name: 'Nobody' });
    assert.strictEqual(missing.status, 404);

    const removed = await postJSON(base, '/remove-me', { code: room.code, name: 'Ana' });
    assert.strictEqual(removed.status, 200);

    const state = await getJSON(base, `/room-state?code=${room.code}`);
    assert.strictEqual(state.body.players.length, 1);
    assert.strictEqual(state.body.players[0].name, 'Bo');
  });
});

test('two rooms running concurrently do not leak state', async () => {
  await withServer(async base => {
    const roomA = await createRoom(base);
    const roomB = await createRoom(base);
    assert.notStrictEqual(roomA.code, roomB.code);

    await joinRoom(base, roomA.code, 'Ana', 'a-fact');
    await joinRoom(base, roomA.code, 'Bo', 'b-fact');
    await joinRoom(base, roomB.code, 'Cy', 'c-fact');
    await joinRoom(base, roomB.code, 'Di', 'd-fact');

    const crossJoin = await joinRoom(base, roomB.code, 'Ana', 'x');
    assert.strictEqual(crossJoin.status, 200);

    const stateA = await getJSON(base, `/room-state?code=${roomA.code}`);
    const stateB = await getJSON(base, `/room-state?code=${roomB.code}`);
    assert.strictEqual(stateA.body.players.length, 2);
    assert.strictEqual(stateB.body.players.length, 3);

    const startA = await postJSON(base, '/start', { code: roomA.code, hostToken: roomA.hostToken });
    assert.strictEqual(startA.status, 200);
    const stateB2 = await getJSON(base, `/room-state?code=${roomB.code}`);
    assert.strictEqual(stateB2.body.status, 'lobby');
  });
});

test('room data never outlives the 2-week hard cap regardless of activity', () => {
  const now = Date.now();
  const freshButActive = {
    clients: [{ res: {} }],
    lastActivity: now,
    createdAt: now - (MAX_ROOM_AGE_MS + 1000)
  };
  assert.strictEqual(isRoomStale(freshButActive, now), true);

  const brandNewIdle = {
    clients: [],
    lastActivity: now,
    createdAt: now
  };
  assert.strictEqual(isRoomStale(brandNewIdle, now), false);
});
