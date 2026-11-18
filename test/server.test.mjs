import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('파티 생성, 참여, 권한, 정산 흐름', async (t) => {
  const { splitFare } = await import('../domain.mjs');
  let base = process.env.TAXIPOT_TEST_BASE;
  if (!base) {
    const directory = mkdtempSync(join(tmpdir(), 'taxi-pot-test-'));
    process.env.DATA_FILE = join(directory, 'db.json');
    const { server } = await import('../server.mjs');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function request(path, body, cookie, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/api/parties')).status, 401);
  assert.equal((await request('/api/session', { name: '우회' })).status, 401);
  assert.equal((await request('/api/register', { loginId: 'norules', password: 'password123', name: '미동의', university: '상명대학교' })).status, 400);
  assert.equal((await request('/api/register', { loginId: 'bad', password: 'password123', name: '우회', university: '부산대학교' })).status, 400);
  const host = await request('/api/register', { loginId: 'testhost', password: 'password123', name: '파티장', university: '상명대학교', acceptedRules: true });
  const guest = await request('/api/register', { loginId: 'testguest', password: 'password123', name: '등교러', university: '상명대학교', acceptedRules: true });
  const other = await request('/api/register', { loginId: 'testother', password: 'password123', name: '삼등분', university: '상명대학교', acceptedRules: true });
  const outsider = await request('/api/register', { loginId: 'outsider', password: 'password123', name: '타대생', university: '서울대학교', acceptedRules: true });
  assert.equal(host.status, 201);
  assert.equal((await request('/api/register', { loginId: 'testhost', password: 'password123', name: '중복', university: '상명대학교', acceptedRules: true })).status, 409);
  assert.equal((await request('/api/login', { loginId: 'testhost', password: 'wrongpass' })).status, 401);
  assert.equal((await request('/api/login', { loginId: 'testhost', password: 'password123' })).data.user.university, '상명대학교');
  assert.ok((await request('/api/universities')).data.universities.includes('상명대학교'));
  const payload = {
    title: '아침 등교 팟', departureAt: new Date(Date.now() + 3_600_000).toISOString(),
    seats: 3, meeting: { lat: 37.5663, lng: 126.9779, note: '시청역 5번 출구' },
  };
  assert.equal((await request('/api/parties', { ...payload, meeting: { ...payload.meeting, lat: 100 } }, host.cookie)).status, 400);
  const created = await request('/api/parties', payload, host.cookie);
  assert.equal(created.status, 201);
  const id = created.data.party.id;
  assert.equal(created.data.party.members[0].loginId, undefined);
  assert.equal(created.data.party.university, '상명대학교');
  assert.deepEqual((await request('/api/parties', undefined, outsider.cookie)).data.parties, []);
  assert.equal((await request(`/api/parties/${id}/join`, {}, outsider.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${id}/messages`, undefined, outsider.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${id}/fare`, { fare: 10000 }, outsider.cookie)).status, 403);
  if (!process.env.TAXIPOT_TEST_BASE) {
    const originalAppId = process.env.KAKAO_APP_ID;
    process.env.KAKAO_APP_ID = '456';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => String(input).startsWith('https://kapi.kakao.com/')
      ? Promise.resolve(new Response(JSON.stringify(String(input).endsWith('access_token_info')
        ? { id: 123, app_id: 456 }
        : { id: 123, kakao_account: { profile: { nickname: '카카오 파티장', thumbnail_image_url: 'https://k.kakaocdn.net/host.jpg' } } })))
      : originalFetch(input, options);
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (originalAppId === undefined) delete process.env.KAKAO_APP_ID;
      else process.env.KAKAO_APP_ID = originalAppId;
    });
    const connected = await request('/api/session/kakao', { accessToken: 'a'.repeat(30) }, host.cookie);
    assert.equal(connected.status, 200);
    assert.equal(connected.data.user.id, host.data.user.id);
    assert.equal((await request('/api/parties', undefined, host.cookie)).data.parties[0].members[0].avatarUrl, 'https://k.kakaocdn.net/host.jpg');
    const switched = await request('/api/session', { name: '닉네임 파티장' }, host.cookie);
    assert.equal(switched.data.user.id, host.data.user.id);
    assert.equal((await request('/api/parties', undefined, host.cookie)).data.parties[0].members[0].avatarUrl, null);
  }
  assert.equal((await request(`/api/parties/${id}/messages`)).status, 401);
  assert.equal((await request(`/api/parties/${id}/messages`, undefined, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${id}/fare`, { fare: 10001 }, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${id}/join`, {}, guest.cookie)).status, 200);
  const firstMessage = await request(`/api/parties/${id}/messages`, { body: '시청역 5번 출구에서 만나요' }, host.cookie);
  assert.equal(firstMessage.status, 201);
  assert.equal(firstMessage.data.message.senderId, host.data.user.id);
  if (!process.env.TAXIPOT_TEST_BASE) {
    assert.equal(JSON.parse(readFileSync(process.env.DATA_FILE, 'utf8')).messages[0].body, '시청역 5번 출구에서 만나요');
  }
  assert.deepEqual((await request(`/api/parties/${id}/messages`, undefined, guest.cookie)).data.messages.map((message) => message.body), ['시청역 5번 출구에서 만나요']);
  assert.equal((await request('/api/reports', { partyId: id, reportedUserId: host.data.user.id, messageId: firstMessage.data.message.id, reason: '부적절한 메시지' }, guest.cookie)).status, 201);
  assert.equal((await request('/api/blocks', { partyId: id, blockedUserId: host.data.user.id }, guest.cookie)).status, 200);
  assert.deepEqual((await request('/api/blocks', undefined, guest.cookie)).data.blockedIds, [host.data.user.id]);
  assert.deepEqual((await request(`/api/parties/${id}/messages`, undefined, guest.cookie)).data.messages, []);
  assert.equal((await request(`/api/blocks/${host.data.user.id}`, {}, guest.cookie, 'DELETE')).status, 200);
  assert.equal((await request(`/api/parties/${id}/messages`, undefined, guest.cookie)).data.messages.length, 1);
  const reply = await request(`/api/parties/${id}/messages`, { body: '네, 곧 도착해요' }, guest.cookie);
  assert.equal(reply.status, 201);
  assert.deepEqual((await request(`/api/parties/${id}/messages?after=${firstMessage.data.message.id}`, undefined, host.cookie)).data.messages.map((message) => message.body), ['네, 곧 도착해요']);
  assert.equal((await request(`/api/parties/${id}/messages?after=oops`, undefined, host.cookie)).status, 400);
  assert.equal((await request(`/api/parties/${id}/messages`, { body: ' '.repeat(3) }, host.cookie)).status, 400);
  assert.equal((await request(`/api/parties/${id}/messages`, { body: 'a'.repeat(501) }, host.cookie)).status, 400);
  assert.equal((await request(`/api/parties/${id}/messages`, { body: '한 줄\n두 줄' }, host.cookie)).data.message.body, '한 줄\n두 줄');
  assert.equal((await request(`/api/parties/${id}/join`, {}, other.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${id}/join`, {}, other.cookie)).status, 409);
  const settled = await request(`/api/parties/${id}/fare`, { fare: 10001 }, host.cookie);
  assert.equal(settled.status, 200);
  assert.deepEqual(settled.data.party.shares, [3334, 3334, 3333]);
  assert.equal(settled.data.party.completedAt, undefined);
  assert.equal((await request(`/api/parties/${id}/complete`, {}, guest.cookie)).status, 403);
  const completed = await request(`/api/parties/${id}/complete`, {}, host.cookie);
  assert.equal(completed.status, 200);
  assert.ok(Number.isFinite(Date.parse(completed.data.party.completedAt)));
  assert.equal((await request(`/api/parties/${id}/complete`, {}, host.cookie)).status, 409);
  assert.equal((await request(`/api/parties/${id}/fare`, { fare: 10000 }, host.cookie)).status, 409);
  assert.equal((await request('/api/parties', undefined, guest.cookie)).data.parties.find((party) => party.id === id).completedAt, completed.data.party.completedAt);
  assert.equal(splitFare(10001, 3).reduce((sum, share) => sum + share, 0), 10001);
  assert.equal((await request(`/api/parties/${id}/leave`, {}, guest.cookie)).status, 409);
  assert.equal((await request(`/api/parties/${id}/cancel`, {}, host.cookie)).status, 409);
  assert.ok((await request('/api/parties', undefined, guest.cookie)).data.parties.some((party) => party.id === id));
  const second = await request('/api/parties', { ...payload, title: '다른 등교 팟' }, host.cookie);
  const secondId = second.data.party.id;
  assert.equal((await request(`/api/parties/${secondId}/complete`, {}, host.cookie)).status, 409);
  assert.equal((await request('/api/blocks', { partyId: secondId, blockedUserId: host.data.user.id }, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/join`, {}, guest.cookie)).status, 403);
  assert.equal((await request(`/api/blocks/${host.data.user.id}`, {}, guest.cookie, 'DELETE')).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/join`, {}, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/leave`, {}, guest.cookie)).status, 200);
  assert.equal((await request(`/api/parties/${secondId}/messages`, undefined, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${secondId}/messages`, { body: '취소 전 메시지' }, host.cookie)).status, 201);
  assert.equal((await request(`/api/parties/${secondId}/cancel`, {}, guest.cookie)).status, 403);
  assert.equal((await request(`/api/parties/${secondId}/cancel`, {}, host.cookie)).status, 200);
  if (!process.env.TAXIPOT_TEST_BASE) {
    assert.ok(!JSON.parse(readFileSync(process.env.DATA_FILE, 'utf8')).messages.some((message) => message.partyId === secondId));
  }
  assert.ok(!(await request('/api/parties', undefined, host.cookie)).data.parties.some((party) => party.id === secondId));
  const concurrent = await request('/api/parties', { ...payload, title: '동시 참여 확인' }, host.cookie);
  const concurrentId = concurrent.data.party.id;
  const joined = await Promise.all([
    request(`/api/parties/${concurrentId}/join`, {}, guest.cookie),
    request(`/api/parties/${concurrentId}/join`, {}, other.cookie),
  ]);
  assert.deepEqual(joined.map((result) => result.status), [200, 200]);
  const list = await request('/api/parties', undefined, host.cookie);
  assert.equal(list.data.parties.find((party) => party.id === concurrentId).members.length, 3);
  assert.equal((await request(`/api/parties/${concurrentId}/cancel`, {}, host.cookie)).status, 200);
  assert.equal((await request('/api/account', { loginId: 'testother', password: 'wrongpass' }, undefined, 'DELETE')).status, 401);
  assert.equal((await request('/api/account', { loginId: 'testother', password: 'password123' }, undefined, 'DELETE')).status, 200);
  assert.equal((await request('/api/login', { loginId: 'testother', password: 'password123' })).status, 401);
  assert.equal((await request('/api/me', undefined, other.cookie)).data.user, null);
  const afterDeletion = (await request('/api/parties', undefined, guest.cookie)).data.parties.find((party) => party.id === id);
  assert.equal(afterDeletion.members[2].name, '탈퇴한 사용자');
  assert.equal(afterDeletion.members[2].loginId, undefined);
  assert.deepEqual(afterDeletion.shares, [3334, 3334, 3333]);
  assert.equal((await request('/api/logout', {}, host.cookie)).status, 200);
  assert.equal((await request('/api/parties', undefined, host.cookie)).status, 401);
});
