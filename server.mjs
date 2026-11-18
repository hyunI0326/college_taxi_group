import { createServer } from 'node:http';
import { randomUUID, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { universities, HttpError, cleanText, splitFare, publicParty, requireUniversity, requireChatMember, chatCursor, chatText, removeAccountFromParty, requireRules } from './domain.mjs';
import { kakaoProfile } from './kakao-profile.mjs';
import { accountInput, passwordHash, verifyPassword } from './auth.mjs';

export { splitFare } from './domain.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_FILE || join(root, 'data', 'taxi-pot.json');
const db = existsSync(dataFile)
  ? JSON.parse(readFileSync(dataFile, 'utf8'))
  : { sessions: {}, parties: [] };
db.messages ??= [];
db.blocks ??= [];
db.reports ??= [];
db.accounts = Object.assign(Object.create(null), db.accounts);
const partyCount = db.parties.length;
db.parties = db.parties.filter((party) => Date.parse(party.departureAt) > Date.now() - 7 * 86_400_000);
const activePartyIds = new Set(db.parties.map((party) => party.id));
const messageCount = db.messages.length;
db.messages = db.messages.filter((message) => activePartyIds.has(message.partyId));
db.reports = db.reports.filter((report) => Date.parse(report.createdAt) > Date.now() - 90 * 86_400_000);
if (db.messages.length !== messageCount || db.parties.length !== partyCount) save();

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
  const user = token ? db.sessions[token] : null;
  const account = user && db.accounts[user.loginId];
  return account && !account.suspendedAt && account.id === user.id && account.university === user.university
    ? { id: account.id, loginId: user.loginId, name: account.name, university: account.university, avatarUrl: account.avatarUrl ?? null, termsAcceptedAt: account.termsAcceptedAt ?? null }
    : null;
}

function requireUser(req) {
  const user = userOf(req);
  if (!user) throw new HttpError(401, '로그인한 뒤 이용해 주세요.');
  return user;
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
  '/privacy.html': ['privacy.html', 'text/html; charset=utf-8'],
  '/delete-account.html': ['delete-account.html', 'text/html; charset=utf-8'],
  '/community.html': ['community.html', 'text/html; charset=utf-8'],
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
    if (path === '/api/universities' && req.method === 'GET') {
      send(res, 200, { universities });
      return;
    }
    if (path === '/api/register' && req.method === 'POST') {
      const { loginId, password, name, university, acceptedRules } = await bodyOf(req);
      const id = accountInput(loginId, password);
      if (acceptedRules !== true) throw new HttpError(400, '이용 규칙에 동의해 주세요.');
      if (!universities.includes(university)) throw new HttpError(400, '수도권 대학을 목록에서 선택해 주세요.');
      if (db.accounts[id]) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
      const user = { id: randomUUID(), loginId: id, name: cleanText(name, 2, 12, '닉네임'), university, avatarUrl: null, termsAcceptedAt: Date.now() };
      db.accounts[id] = { id: user.id, name: user.name, avatarUrl: null, passwordHash: await passwordHash(password, webcrypto), university, termsAcceptedAt: user.termsAcceptedAt };
      const token = randomUUID();
      db.sessions[token] = user;
      save();
      send(res, 201, { user }, { 'Set-Cookie': `taxi_pot=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      return;
    }
    if (path === '/api/login' && req.method === 'POST') {
      const { loginId, password } = await bodyOf(req);
      const id = accountInput(loginId, password);
      const account = db.accounts[id];
      if (!account || !(await verifyPassword(password, account.passwordHash, webcrypto))) throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
      if (account.suspendedAt) throw new HttpError(403, '이용이 제한된 계정입니다. 운영자에게 문의해 주세요.');
      const user = { id: account.id, loginId: id, name: account.name, university: account.university, avatarUrl: account.avatarUrl ?? null, termsAcceptedAt: account.termsAcceptedAt ?? null };
      const token = randomUUID();
      db.sessions[token] = user;
      save();
      send(res, 200, { user }, { 'Set-Cookie': `taxi_pot=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      return;
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const token = req.headers.cookie?.match(/(?:^|;\s*)taxi_pot=([a-f0-9-]+)/)?.[1];
      if (token) delete db.sessions[token];
      save();
      send(res, 200, { ok: true }, { 'Set-Cookie': 'taxi_pot=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return;
    }
    if (path === '/api/accept-rules' && req.method === 'POST') {
      const user = requireUser(req);
      const { acceptedRules } = await bodyOf(req);
      if (acceptedRules !== true) throw new HttpError(400, '이용 규칙에 동의해 주세요.');
      db.accounts[user.loginId].termsAcceptedAt = Date.now();
      save();
      send(res, 200, { ok: true });
      return;
    }
    if (path === '/api/account' && req.method === 'DELETE') {
      const { loginId, password } = await bodyOf(req);
      const id = accountInput(loginId, password);
      const account = db.accounts[id];
      if (!account || !(await verifyPassword(password, account.passwordHash, webcrypto))) throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
      db.parties = db.parties.map((party) => removeAccountFromParty(party, account.id, randomUUID())).filter(Boolean);
      const activeIds = new Set(db.parties.map((party) => party.id));
      db.messages = db.messages.filter((message) => message.senderId !== account.id && activeIds.has(message.partyId));
      db.reports = db.reports.filter((report) => report.reporterId !== account.id && report.reportedId !== account.id);
      db.blocks = db.blocks.filter((block) => block.blockerId !== account.id && block.blockedId !== account.id);
      for (const [token, session] of Object.entries(db.sessions)) if (session.id === account.id) delete db.sessions[token];
      delete db.accounts[id];
      save();
      send(res, 200, { ok: true }, { 'Set-Cookie': 'taxi_pot=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return;
    }
    if (path === '/api/session' && req.method === 'POST') {
      const { name } = await bodyOf(req);
      const current = requireUser(req);
      requireRules(current);
      const user = { ...current, name: cleanText(name, 2, 12, '닉네임'), avatarUrl: null };
      Object.assign(current, user);
      Object.assign(db.accounts[user.loginId], { name: user.name, avatarUrl: null });
      for (const party of db.parties) {
        const member = party.members.find((item) => item.id === user.id);
        if (member) Object.assign(member, user);
      }
      save();
      send(res, 200, { user });
      return;
    }
    if (path === '/api/session/kakao' && req.method === 'POST') {
      const { accessToken } = await bodyOf(req);
      const profile = await kakaoProfile(accessToken, process.env.KAKAO_APP_ID);
      const current = requireUser(req);
      requireRules(current);
      const user = { ...current, ...profile };
      Object.assign(current, user);
      Object.assign(db.accounts[user.loginId], profile);
      for (const party of db.parties) {
        const member = party.members.find((item) => item.id === user.id);
        if (member) Object.assign(member, user);
      }
      save();
      send(res, 200, { user });
      return;
    }
    if (path === '/api/blocks' && req.method === 'GET') {
      const user = requireUser(req);
      send(res, 200, { blockedIds: db.blocks.filter((block) => block.blockerId === user.id).map((block) => block.blockedId) });
      return;
    }
    if (path === '/api/blocks' && req.method === 'POST') {
      const user = requireUser(req);
      const { partyId, blockedUserId } = await bodyOf(req);
      const party = partyById(partyId);
      requireUniversity(party, user);
      if (!party.members.some((member) => member.id === blockedUserId) || blockedUserId === user.id) throw new HttpError(400, '차단할 파티원을 확인해 주세요.');
      if (!db.blocks.some((block) => block.blockerId === user.id && block.blockedId === blockedUserId)) db.blocks.push({ blockerId: user.id, blockedId: blockedUserId });
      save();
      send(res, 200, { ok: true });
      return;
    }
    const unblockMatch = path.match(/^\/api\/blocks\/([a-f0-9-]+)$/);
    if (unblockMatch && req.method === 'DELETE') {
      const user = requireUser(req);
      db.blocks = db.blocks.filter((block) => block.blockerId !== user.id || block.blockedId !== unblockMatch[1]);
      save();
      send(res, 200, { ok: true });
      return;
    }
    if (path === '/api/reports' && req.method === 'POST') {
      const user = requireUser(req);
      const { partyId, reportedUserId, messageId, reason } = await bodyOf(req);
      const party = partyById(partyId);
      requireUniversity(party, user);
      if (!party.members.some((member) => member.id === reportedUserId) || reportedUserId === user.id) throw new HttpError(400, '신고 대상을 확인해 주세요.');
      if (messageId !== null && messageId !== undefined) {
        const message = db.messages.find((item) => item.id === messageId && item.partyId === partyId);
        if (!message || message.senderId !== reportedUserId) throw new HttpError(400, '신고할 메시지를 확인해 주세요.');
      }
      db.reports.push({ id: (db.lastReportId = (db.lastReportId ?? 0) + 1), reporterId: user.id, reportedId: reportedUserId, partyId, messageId: messageId ?? null, reason: cleanText(reason, 2, 500, '신고 사유'), createdAt: new Date().toISOString() });
      save();
      send(res, 201, { ok: true });
      return;
    }
    if (path === '/api/parties' && req.method === 'GET') {
      const user = requireUser(req);
      const now = Date.now();
      const parties = db.parties
        .filter((party) => party.university === user.university && (Date.parse(party.departureAt) > now || (party.members.some((member) => member.id === user.id) && Date.parse(party.departureAt) > now - 7 * 86_400_000)))
        .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt))
        .map(publicParty);
      send(res, 200, { parties });
      return;
    }
    if (path === '/api/parties' && req.method === 'POST') {
      const user = requireUser(req);
      requireRules(user);
      const input = await bodyOf(req);
      if (!Number.isInteger(input.seats) || input.seats < 2 || input.seats > 4) throw new HttpError(400, '정원은 2~4명으로 설정해 주세요.');
      const departure = Date.parse(input.departureAt);
      if (!Number.isFinite(departure) || departure <= Date.now() || departure > Date.now() + 14 * 86_400_000) {
        throw new HttpError(400, '출발 시간은 지금부터 14일 이내로 설정해 주세요.');
      }
      const lat = input.meeting?.lat;
      const lng = input.meeting?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new HttpError(400, '지도에서 올바른 집결지를 골라 주세요.');
      }
      const party = {
        id: randomUUID(),
        region: 'metro', university: user.university,
        title: cleanText(input.title, 2, 40, '파티 제목'),
        departureAt: new Date(departure).toISOString(),
        seats: input.seats,
        meeting: { lat, lng, note: cleanText(input.meeting.note || '', 0, 80, '집결지 설명') },
        members: [user],
        fare: null,
        createdAt: new Date().toISOString(),
      };
      db.parties.push(party);
      save();
      send(res, 201, { party: publicParty(party) });
      return;
    }
    const chatMatch = path.match(/^\/api\/parties\/([a-f0-9-]+)\/messages$/);
    if (chatMatch && ['GET', 'POST'].includes(req.method)) {
      const user = requireUser(req);
      const party = partyById(chatMatch[1]);
      requireChatMember(party, user);
      if (req.method === 'GET') {
        const after = chatCursor(url.searchParams.get('after'));
        const blocked = new Set(db.blocks.filter((block) => block.blockerId === user.id).map((block) => block.blockedId));
        const messages = db.messages.filter((message) => message.partyId === party.id && (after === null || message.id > after) && !blocked.has(message.senderId));
        const page = after === null ? messages.slice(-100) : messages.slice(0, 100);
        send(res, 200, { messages: page.map(({ partyId, ...message }) => message), nextAfter: page.at(-1)?.id ?? after });
        return;
      }
      requireRules(user);
      const { body } = await bodyOf(req);
      const cleaned = chatText(body);
      const message = {
        id: db.lastMessageId = (db.lastMessageId ?? db.messages.at(-1)?.id ?? 0) + 1,
        partyId: party.id, senderId: user.id, senderName: party.members.find((member) => member.id === user.id).name,
        body: cleaned, createdAt: new Date().toISOString(),
      };
      db.messages.push(message);
      save();
      const { partyId, ...publicMessage } = message;
      send(res, 201, { message: publicMessage });
      return;
    }
    const match = path.match(/^\/api\/parties\/([a-f0-9-]+)\/(join|leave|fare|complete|cancel)$/);
    if (match && req.method === 'POST') {
      const user = requireUser(req);
      const party = partyById(match[1]);
      requireUniversity(party, user);
      const action = match[2];
      if (action === 'join') {
        requireRules(user);
        if (party.fare !== null || Date.parse(party.departureAt) <= Date.now()) throw new HttpError(409, '모집이 끝난 파티입니다.');
        if (party.members.some((member) => member.id === user.id)) throw new HttpError(409, '이미 참여 중인 파티입니다.');
        if (party.members.length >= party.seats) throw new HttpError(409, '정원이 찼습니다.');
        if (party.members.some((member) => db.blocks.some((block) => (block.blockerId === user.id && block.blockedId === member.id) || (block.blockerId === member.id && block.blockedId === user.id)))) throw new HttpError(403, '차단 관계가 있는 파티에는 참여할 수 없습니다.');
        party.members.push(user);
      } else if (action === 'leave') {
        if (party.fare !== null) throw new HttpError(409, '정산이 시작된 파티에서는 나갈 수 없습니다.');
        if (party.members[0].id === user.id) throw new HttpError(403, '파티장은 파티 취소를 이용해 주세요.');
        const index = party.members.findIndex((member) => member.id === user.id);
        if (index < 0) throw new HttpError(403, '참여 중인 파티가 아닙니다.');
        party.members.splice(index, 1);
      } else if (action === 'fare') {
        requireRules(user);
        if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 택시비를 입력할 수 있습니다.');
        if (party.completedAt) throw new HttpError(409, '이미 마친 파티의 택시비는 수정할 수 없습니다.');
        if (party.members.length < 2) throw new HttpError(409, '참여자가 2명 이상이어야 정산할 수 있습니다.');
        const { fare } = await bodyOf(req);
        if (!Number.isSafeInteger(fare) || fare < 1 || fare > 500_000) throw new HttpError(400, '택시비는 1~500,000원으로 입력해 주세요.');
        party.fare = fare;
      } else if (action === 'complete') {
        requireRules(user);
        if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 이용을 마칠 수 있습니다.');
        if (party.completedAt) throw new HttpError(409, '이미 마친 파티입니다.');
        if (party.fare === null) throw new HttpError(409, '택시비를 계산한 뒤 이용을 마쳐 주세요.');
        party.completedAt = new Date().toISOString();
      } else if (action === 'cancel') {
        if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 취소할 수 있습니다.');
        if (party.fare !== null) throw new HttpError(409, '정산이 시작된 파티는 취소할 수 없습니다.');
        db.parties.splice(db.parties.indexOf(party), 1);
        db.messages = db.messages.filter((message) => message.partyId !== party.id);
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
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`대택구: http://${host}:${port}`));
}
