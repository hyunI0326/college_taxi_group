import { HttpError, cleanText } from './domain.mjs';

export async function kakaoProfile(accessToken, appId, fetcher = fetch) {
  if (!appId) throw new HttpError(503, '서버에 카카오 앱 ID가 설정되지 않았습니다.');
  if (typeof accessToken !== 'string' || !/^[A-Za-z0-9._~-]{20,4096}$/.test(accessToken)) {
    throw new HttpError(400, '카카오 로그인 정보를 확인해 주세요.');
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  let info, account;
  try {
    const tokenResponse = await fetcher('https://kapi.kakao.com/v1/user/access_token_info', { headers });
    if (!tokenResponse.ok) throw new HttpError(401, '카카오 로그인을 다시 시도해 주세요.');
    info = await tokenResponse.json();
    if (String(info.app_id) !== String(appId)) throw new HttpError(403, '대택구 카카오 앱으로 로그인해 주세요.');
    const meResponse = await fetcher('https://kapi.kakao.com/v2/user/me', { headers });
    if (!meResponse.ok) throw new HttpError(401, '카카오 프로필을 가져오지 못했습니다.');
    account = await meResponse.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, '카카오 서버에 연결할 수 없습니다.');
  }
  if (String(info.id) !== String(account.id)) throw new HttpError(401, '카카오 계정을 확인할 수 없습니다.');
  const profile = account.kakao_account?.profile;
  if (!profile?.nickname) throw new HttpError(403, '카카오 프로필 닉네임 동의가 필요합니다.');
  const name = cleanText(profile.nickname, 1, 30, '카카오 닉네임');
  const candidate = profile.thumbnail_image_url;
  let avatarUrl = null;
  try {
    const url = new URL(candidate);
    if (['http:', 'https:'].includes(url.protocol) && /(^|\.)(kakaocdn\.net|kakao\.com)$/.test(url.hostname)) {
      url.protocol = 'https:';
      avatarUrl = url.href;
    }
  } catch { /* user did not consent to a profile photo */ }
  return { name, avatarUrl };
}
