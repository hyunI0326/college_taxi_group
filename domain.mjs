export const regions = {
  cityhall: { lat: 37.5663, lng: 126.9779 },
  gwanghwamun: { lat: 37.5716, lng: 126.9769 },
  seoulstation: { lat: 37.5547, lng: 126.9707 },
};

// Initial metropolitan-area university list; campus identity can be added when enrollment verification is introduced.
export const universities = [
  '가천대학교', '가톨릭대학교', '강남대학교', '건국대학교', '경기대학교', '경인교육대학교', '경희대학교', '고려대학교',
  '광운대학교', '국민대학교', '단국대학교', '대진대학교', '덕성여자대학교', '동국대학교', '동덕여자대학교', '명지대학교',
  '삼육대학교', '상명대학교', '서강대학교', '서경대학교', '서울과학기술대학교', '서울교육대학교', '서울대학교', '서울시립대학교',
  '서울여자대학교', '성결대학교', '성공회대학교', '성균관대학교', '성신여자대학교', '세종대학교', '수원대학교', '숙명여자대학교',
  '숭실대학교', '신한대학교', '아주대학교', '안양대학교', '연세대학교', '용인대학교', '을지대학교', '이화여자대학교',
  '인천대학교', '인하대학교', '중앙대학교', '차의과학대학교', '총신대학교', '추계예술대학교', '한국공학대학교', '한국교통대학교',
  '한국성서대학교', '한국외국어대학교', '한국항공대학교', '한성대학교', '한세대학교', '한신대학교', '한양대학교', '협성대학교',
  '홍익대학교', '평택대학교', '경동대학교', '중부대학교', '서울장신대학교', '아신대학교', '칼빈대학교', '한국체육대학교',
  '인천가톨릭대학교', '청운대학교', '한경국립대학교', '한국예술종합학교', '서울기독대학교', '서울한영대학교',
].sort((a, b) => a.localeCompare(b, 'ko'));

export function requireUniversity(party, user) {
  if (!party.university || party.university !== user.university) throw new HttpError(403, '본인 대학의 파티만 이용할 수 있습니다.');
}

export function requireRules(user) {
  if (!user.termsAcceptedAt) throw new HttpError(403, '파티 이용 규칙에 동의해 주세요.');
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function cleanText(value, min, max, label) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (cleaned.length < min || cleaned.length > max || /[\x00-\x1f\x7f]/.test(cleaned)) {
    throw new HttpError(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return cleaned;
}

export function requireChatMember(party, user) {
  requireUniversity(party, user);
  if (!party.members.some((member) => member.id === user.id)) throw new HttpError(403, '파티원만 채팅할 수 있습니다.');
  if (Date.parse(party.departureAt) <= Date.now() - 7 * 86_400_000) throw new HttpError(410, '채팅 이용 기간이 끝났습니다.');
}

export function chatCursor(value) {
  if (value === null) return null;
  const cursor = Number(value);
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(cursor)) throw new HttpError(400, '메시지 위치를 확인해 주세요.');
  return cursor;
}

export function chatText(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\r\n?/g, '\n') : '';
  if (!text || text.length > 500 || /[\x00-\x09\x0b-\x1f\x7f]/.test(text)) {
    throw new HttpError(400, '메시지는 1~500자로 입력해 주세요.');
  }
  return text;
}

export function removeAccountFromParty(party, userId, randomId) {
  const index = party.members.findIndex((member) => member.id === userId);
  if (index < 0) return party;
  if (index === 0) {
    party.title = '파티장이 탈퇴한 파티';
    party.meeting.note = '';
  }
  if (party.fare === null) {
    party.members.splice(index, 1);
    if (!party.members.length) return null;
  } else {
    party.members[index] = { id: `deleted-${randomId}`, name: '탈퇴한 사용자', avatarUrl: null };
  }
  return party;
}

export function distance(a, b) {
  const rad = Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * rad;
  const deltaLng = (b.lng - a.lng) * rad;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(deltaLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

export function splitFare(fare, count) {
  if (!Number.isSafeInteger(fare) || fare < 0 || !Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('Invalid fare or participant count');
  }
  const base = Math.floor(fare / count);
  return Array.from({ length: count }, (_, index) => base + (index < fare % count ? 1 : 0));
}

export function publicParty(party) {
  return {
    ...party,
    members: party.members.map(({ id, name, avatarUrl }) => ({ id, name, avatarUrl: avatarUrl ?? null })),
    shares: party.fare === null ? null : splitFare(party.fare, party.members.length),
  };
}
