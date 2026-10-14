import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_FILE || join(root, 'data', 'taxi-pot.json');
const regions = {
  cityhall: { lat: 37.5663, lng: 126.9779 },
  gwanghwamun: { lat: 37.5716, lng: 126.9769 },
  seoulstation: { lat: 37.5547, lng: 126.9707 },
};
const db = existsSync(dataFile)
  ? JSON.parse(readFileSync(dataFile, 'utf8'))
  : { sessions: {}, parties: [] };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function save() {
  mkdirSync(dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(db, null, 2));
  renameSync(temp, dataFile);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'JSON 요청만 사용할 수 있습니다.');
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new HttpError(413, '요청이 너무 큽니다.');
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* invalid JSON */ }
  throw new HttpError(400, '요청 내용을 확인해 주세요.');
}

function userOf(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)taxi_pot=([a-f0-9-]+)/)?.[1];
  return token ? db.sessions[token] : null;
}

function requireUser(req) {
  const user = userOf(req);
  if (!user) throw new HttpError(401, '먼저 닉네임을 등록해 주세요.');
  return user;
}

function text(value, min, max, label) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (cleaned.length < min || cleaned.length > max || /[\x00-\x1f\x7f]/.test(cleaned)) {
    throw new HttpError(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return cleaned;
}

function distance(a, b) {
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

function publicParty(party) {
  return {
    ...party,
    shares: party.fare === null ? null : splitFare(party.fare, party.members.length),
  };
}

function partyById(id) {
  const party = db.parties.find((item) => item.id === id);
  if (!party) throw new HttpError(404, '파티를 찾을 수 없습니다.');
  return party;
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && staticFiles[path]) {
      const [file, contentType] = staticFiles[path];
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      res.end(readFileSync(join(root, 'public', file)));
      return;
    }
    if (path === '/api/me' && req.method === 'GET') {
      send(res, 200, { user: userOf(req) });
      return;
    }
    if (path === '/api/session' && req.method === 'POST') {
      const { name } = await bodyOf(req);
      const user = { id: randomUUID(), name: text(name, 2, 12, '닉네임') };
      const token = randomUUID();
      db.sessions[token] = user;
      save();
      send(res, 201, { user }, { 'Set-Cookie': `taxi_pot=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      return;
    }
    if (path === '/api/parties' && req.method === 'GET') {
      const region = url.searchParams.get('region');
      if (!regions[region]) throw new HttpError(400, '지역을 확인해 주세요.');
      const now = Date.now();
      const user = userOf(req);
      const parties = db.parties
        .filter((party) => party.region === region && (Date.parse(party.departureAt) > now || (user && party.members.some((member) => member.id === user.id) && Date.parse(party.departureAt) > now - 7 * 86_400_000)))
        .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt))
        .map(publicParty);
      send(res, 200, { parties });
      return;
    }
    if (path === '/api/parties' && req.method === 'POST') {
      const user = requireUser(req);
      const input = await bodyOf(req);
      if (!regions[input.region]) throw new HttpError(400, '지역을 확인해 주세요.');
      if (!Number.isInteger(input.seats) || input.seats < 2 || input.seats > 4) throw new HttpError(400, '정원은 2~4명으로 설정해 주세요.');
      const departure = Date.parse(input.departureAt);
      if (!Number.isFinite(departure) || departure <= Date.now() || departure > Date.now() + 14 * 86_400_000) {
        throw new HttpError(400, '출발 시간은 지금부터 14일 이내로 설정해 주세요.');
      }
      const lat = input.meeting?.lat;
      const lng = input.meeting?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || distance(regions[input.region], { lat, lng }) > 1_200) {
        throw new HttpError(400, '선택한 지역에서 1.2km 안의 집결지를 지도에서 골라 주세요.');
      }
      const party = {
        id: randomUUID(),
        region: input.region,
        title: text(input.title, 2, 40, '파티 제목'),
        departureAt: new Date(departure).toISOString(),
        seats: input.seats,
        meeting: { lat, lng, note: text(input.meeting.note || '', 0, 80, '집결지 설명') },
        members: [user],
        fare: null,
        createdAt: new Date().toISOString(),
      };
      db.parties.push(party);
      save();
      send(res, 201, { party: publicParty(party) });
      return;
    }
    const match = path.match(/^\/api\/parties\/([a-f0-9-]+)\/(join|leave|fare|cancel)$/);
    if (match && req.method === 'POST') {
      const user = requireUser(req);
      const party = partyById(match[1]);
      const action = match[2];
      if (action === 'join') {
        if (party.fare !== null || Date.parse(party.departureAt) <= Date.now()) throw new HttpError(409, '모집이 끝난 파티입니다.');
        if (party.members.some((member) => member.id === user.id)) throw new HttpError(409, '이미 참여 중인 파티입니다.');
        if (party.members.length >= party.seats) throw new HttpError(409, '정원이 찼습니다.');
        party.members.push(user);
      } else if (action === 'leave') {
        if (party.fare !== null) throw new HttpError(409, '정산이 시작된 파티에서는 나갈 수 없습니다.');
        if (party.members[0].id === user.id) throw new HttpError(403, '파티장은 파티 취소를 이용해 주세요.');
        const index = party.members.findIndex((member) => member.id === user.id);
        if (index < 0) throw new HttpError(403, '참여 중인 파티가 아닙니다.');
        party.members.splice(index, 1);
      } else if (action === 'fare') {
        if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 택시비를 입력할 수 있습니다.');
        if (party.members.length < 2) throw new HttpError(409, '참여자가 2명 이상이어야 정산할 수 있습니다.');
        const { fare } = await bodyOf(req);
        if (!Number.isSafeInteger(fare) || fare < 1 || fare > 500_000) throw new HttpError(400, '택시비는 1~500,000원으로 입력해 주세요.');
        party.fare = fare;
      } else if (action === 'cancel') {
        if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 취소할 수 있습니다.');
        if (party.fare !== null) throw new HttpError(409, '정산이 시작된 파티는 취소할 수 없습니다.');
        db.parties.splice(db.parties.indexOf(party), 1);
        save();
        send(res, 200, { ok: true });
        return;
      }
      save();
      send(res, 200, { party: publicParty(party) });
      return;
    }
    throw new HttpError(404, '페이지를 찾을 수 없습니다.');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(error);
    send(res, error.status || 500, { error: error.status ? error.message : '서버 오류가 발생했습니다.' });
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`택시팟: http://localhost:${port}`));
}
