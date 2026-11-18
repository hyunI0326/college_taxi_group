import test from 'node:test';
import assert from 'node:assert/strict';
import { kakaoProfile } from '../kakao-profile.mjs';

test('카카오 토큰의 앱 ID와 사용자 ID를 검증한 뒤 동의한 프로필만 사용한다', async () => {
  const fetcher = async (url) => new Response(JSON.stringify(url.endsWith('access_token_info')
    ? { id: 123, app_id: 456 }
    : { id: 123, kakao_account: { profile: { nickname: '등교러', thumbnail_image_url: 'http://k.kakaocdn.net/avatar.jpg' } } }));
  assert.deepEqual(await kakaoProfile('a'.repeat(30), '456', fetcher), {
    name: '등교러', avatarUrl: 'https://k.kakaocdn.net/avatar.jpg',
  });
  await assert.rejects(kakaoProfile('a'.repeat(30), '999', fetcher), { status: 403 });
  await assert.rejects(kakaoProfile('short', '456', fetcher), { status: 400 });
  const wrongPerson = async (url) => new Response(JSON.stringify(url.endsWith('access_token_info')
    ? { id: 123, app_id: 456 }
    : { id: 999, kakao_account: { profile: { nickname: '다른 사람' } } }));
  await assert.rejects(kakaoProfile('a'.repeat(30), '456', wrongPerson), { status: 401 });
});
