import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer } from '../server.js';

test('createServer returns an http server', () => {
  const server = createServer();
  assert.ok(server instanceof http.Server);
  server.close();
});
