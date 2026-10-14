import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('파티 생성, 참여, 권한, 정산 흐름', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taxi-pot-test-'));
  process.env.DATA_FILE = join(directory, 'db.json');
  const { server, splitFare } = await import('../server.mjs');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, cookie) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const host = await request('/api/session', { name: '파티장' });
  const guest = await request('/api/session', { name: '등교러' });
  const other = await request('/api/session', { name: '삼등분' });
  const payload = {
    region: 'cityhall', title: '아침 등교 팟', departureAt: new Date(Date.now() + 3_600_000).toISOString(),
    seats: 3, meeting: { lat: 37.5663, lng: 126.9779, note: '시청역 5번 출구' },
  };
  assert.equal((await request('/api/parties', { ...payload, meeting: { ...payload.meeting, lat: 37.6 } }, host.cookie)).status, 400);
  const created = await request('/api/parties', payload, host.cookie);
  assert.equal(created.status, 201);
  const id = created.data.party.id;
  assert.equal((await request(`/api/parties/${id}/fare`, { fare: 10001 }, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${id}/join`, {}, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${id}/join`, {}, other.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${id}/join`, {}, other.cookie)).status, 409);
  const settled = await request(`/api/parties/${id}/fare`, { fare: 10001 }, host.cookie);
  assert.equal(settled.status, 200);
  assert.deepEqual(settled.data.party.shares, [3334, 3334, 3333]);
  assert.equal(splitFare(10001, 3).reduce((sum, share) => sum + share, 0), 10001);
  assert.equal((await request(`/api/parties/${id}/leave`, {}, guest.cookie)).status, 409);
  assert.equal((await request(`/api/parties/${id}/cancel`, {}, host.cookie)).status, 409);
  assert.equal((await request('/api/parties?region=cityhall', undefined, guest.cookie)).data.parties.length, 1);
  const second = await request('/api/parties', { ...payload, title: '다른 등교 팟' }, host.cookie);
  const secondId = second.data.party.id;
  assert.equal((await request(`/api/parties/${secondId}/join`, {}, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/leave`, {}, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/cancel`, {}, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${secondId}/cancel`, {}, host.cookie)).status, 200);
  assert.equal((await request('/api/parties?region=cityhall', undefined, host.cookie)).data.parties.length, 1);
});
