import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer, isRoomStale, MAX_ROOM_AGE_MS } from '../server.js';

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

async function openSSE(base, code, name) {
  const res = await fetch(`${base}/events?code=${code}&name=${encodeURIComponent(name)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next() {
      while (true) {
        const idx = buffer.indexOf('\n\n');
        if (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split('\n').find(l => l.startsWith('data: '));
          if (line) return JSON.parse(line.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close() {
      reader.cancel().catch(() => {});
    }
  };
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
    // server should still be alive
    const res2 = await fetch(base + '/');
    assert.strictEqual(res2.status, 200);
  });
});

test('create-room returns a unique code, host token and QR code', async () => {
  await withServer(async base => {
    const res = await fetch(base + '/create-room', { method: 'POST' });
    const data = await res.json();
    assert.match(data.code, /^[A-Z0-9]{4}$/);
    assert.ok(data.hostToken);
    assert.ok(data.joinUrl.includes(data.code));
    assert.ok(data.qrCode.startsWith('data:image'));
  });
});

test('short link redirects to player page with code prefilled', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code } = await create.json();
    const res = await fetch(base + `/j/${code}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/player.html?code=${code}`);
  });
});

test('join-room rejects duplicate names in the same room', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code } = await create.json();
    const first = await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });
    assert.strictEqual(first.status, 200);
    const second = await postJSON(base, '/join-room', { code, name: 'ana', fact: 'likes coffee' });
    assert.strictEqual(second.status, 400);
  });
});

test('join-room rejects missing fields and unknown rooms', async () => {
  await withServer(async base => {
    const missing = await postJSON(base, '/join-room', { code: 'AAAA', name: '', fact: 'x' });
    assert.strictEqual(missing.status, 400);
    const noRoom = await postJSON(base, '/join-room', { code: 'ZZZZ', name: 'Bo', fact: 'x' });
    assert.strictEqual(noRoom.status, 404);
  });
});

test('start requires a valid host token and at least two players', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code, hostToken } = await create.json();
    await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });

    const badToken = await postJSON(base, '/start', { code, hostToken: 'wrong' });
    assert.strictEqual(badToken.status, 403);

    const tooFewPlayers = await postJSON(base, '/start', { code, hostToken });
    assert.strictEqual(tooFewPlayers.status, 400);

    await postJSON(base, '/join-room', { code, name: 'Bo', fact: 'likes cats' });
    const ok = await postJSON(base, '/start', { code, hostToken });
    assert.strictEqual(ok.status, 200);
  });
});

test('a player cannot guess their own fact or answer twice, and scoring works', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code, hostToken } = await create.json();
    await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });
    await postJSON(base, '/join-room', { code, name: 'Bo', fact: 'likes cats' });
    await postJSON(base, '/join-room', { code, name: 'Cy', fact: 'likes dogs' });

    const names = ['Ana', 'Bo', 'Cy'];
    const streams = {};
    for (const n of names) streams[n] = await openSSE(base, code, n);

    await postJSON(base, '/start', { code, hostToken });

    const stateRes = await fetch(base + `/room-state?code=${code}`);
    const state = await stateRes.json();
    assert.strictEqual(state.status, 'question');

    let subject;
    for (const n of names) {
      const msg = await streams[n].next();
      assert.strictEqual(msg.type, 'question');
      if (msg.isSubject) subject = n;
    }
    for (const n of names) streams[n].close();
    assert.ok(subject, 'expected exactly one subject to be flagged');

    const guessers = names.filter(n => n !== subject);
    const firstGuess = await postJSON(base, '/answer', {
      code,
      name: guessers[0],
      guess: subject
    });
    const firstBody = await firstGuess.json();
    assert.strictEqual(firstBody.correct, true);

    const repeat = await postJSON(base, '/answer', {
      code,
      name: guessers[0],
      guess: subject
    });
    assert.strictEqual(repeat.status, 400);

    await postJSON(base, '/answer', { code, name: guessers[1], guess: subject });

    const finalState = await (await fetch(base + `/room-state?code=${code}`)).json();
    assert.strictEqual(finalState.status, 'reveal');
    const scorer = finalState.leaderboard.find(p => p.name === guessers[0]);
    assert.strictEqual(scorer.score, 1);
  });
});

test('end game broadcasts completion and blocks further starts without a valid token', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code, hostToken } = await create.json();
    await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });
    await postJSON(base, '/join-room', { code, name: 'Bo', fact: 'likes cats' });

    const badEnd = await postJSON(base, '/end', { code, hostToken: 'nope' });
    assert.strictEqual(badEnd.status, 403);

    const ok = await postJSON(base, '/end', { code, hostToken });
    assert.strictEqual(ok.status, 200);

    const state = await (await fetch(base + `/room-state?code=${code}`)).json();
    assert.strictEqual(state.status, 'complete');
  });
});

test('password-protected rooms reject joins with a missing or wrong password', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'letmein' })
    });
    const { code, passwordProtected } = await create.json();
    assert.strictEqual(passwordProtected, true);

    const noPassword = await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'x' });
    assert.strictEqual(noPassword.status, 403);

    const wrongPassword = await postJSON(base, '/join-room', {
      code,
      name: 'Ana',
      fact: 'x',
      password: 'nope'
    });
    assert.strictEqual(wrongPassword.status, 403);

    const rightPassword = await postJSON(base, '/join-room', {
      code,
      name: 'Ana',
      fact: 'x',
      password: 'letmein'
    });
    assert.strictEqual(rightPassword.status, 200);
  });
});

test('rooms without a password accept joins with or without a password field', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code, passwordProtected } = await create.json();
    assert.strictEqual(passwordProtected, false);
    const res = await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'x' });
    assert.strictEqual(res.status, 200);
    const res2 = await postJSON(base, '/join-room', {
      code,
      name: 'Bo',
      fact: 'x',
      password: 'whatever'
    });
    assert.strictEqual(res2.status, 200);
  });
});

test('host can delete a room; only the host token is authorized to do it', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code, hostToken } = await create.json();
    await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });

    const badToken = await postJSON(base, '/delete-room', { code, hostToken: 'wrong' });
    assert.strictEqual(badToken.status, 403);

    const ok = await postJSON(base, '/delete-room', { code, hostToken });
    assert.strictEqual(ok.status, 200);

    const gone = await fetch(base + `/room-state?code=${code}`);
    assert.strictEqual(gone.status, 404);
  });
});

test('a player can remove just their own data without affecting others', async () => {
  await withServer(async base => {
    const create = await fetch(base + '/create-room', { method: 'POST' });
    const { code } = await create.json();
    await postJSON(base, '/join-room', { code, name: 'Ana', fact: 'likes tea' });
    await postJSON(base, '/join-room', { code, name: 'Bo', fact: 'likes cats' });

    const missing = await postJSON(base, '/remove-me', { code, name: 'Nobody' });
    assert.strictEqual(missing.status, 404);

    const removed = await postJSON(base, '/remove-me', { code, name: 'Ana' });
    assert.strictEqual(removed.status, 200);

    const state = await (await fetch(base + `/room-state?code=${code}`)).json();
    assert.strictEqual(state.players.length, 1);
    assert.strictEqual(state.players[0].name, 'Bo');
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
