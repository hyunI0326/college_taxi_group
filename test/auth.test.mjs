import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { passwordHash, verifyPassword } from '../auth.mjs';

test('new and existing password hashes verify without weakening old local accounts', async () => {
  const current = await passwordHash('password123', webcrypto);
  const legacy = (await passwordHash('password123', webcrypto, '00112233445566778899aabbccddeeff', 120_000)).split(':').slice(1).join(':');
  assert.match(current, /^100000:/);
  assert.equal(await verifyPassword('password123', current, webcrypto), true);
  assert.equal(await verifyPassword('password123', legacy, webcrypto), true);
  assert.equal(await verifyPassword('wrongpassword', current, webcrypto), false);
});
