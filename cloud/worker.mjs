import { universities, HttpError, cleanText, publicParty, requireUniversity, requireChatMember, chatCursor, chatText, removeAccountFromParty, requireRules } from '../domain.mjs';
import { kakaoProfile } from '../kakao-profile.mjs';
import { accountInput, passwordHash, verifyPassword } from '../auth.mjs';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function bodyOf(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'JSON 요청만 사용할 수 있습니다.');
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.length > 16_384) {
        await reader.cancel();
        throw new HttpError(413, '요청이 너무 큽니다.');
      }
    }
    raw += decoder.decode();
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* invalid JSON */ }
  throw new HttpError(400, '요청 내용을 확인해 주세요.');
}

async function userOf(request, db) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)taxi_pot=([a-f0-9-]+)/)?.[1];
  if (!token) return null;
  return db.prepare('SELECT s.id, s.login_id AS loginId, s.name, s.university, s.avatar_url AS avatarUrl, a.terms_accepted_at AS termsAcceptedAt FROM sessions s JOIN accounts a ON a.id = s.id AND a.university = s.university AND a.suspended_at IS NULL WHERE s.token = ? AND s.expires_at > ?')
    .bind(token, Date.now()).first();
}

async function updatePartyProfiles(db, user) {
  const rows = await db.prepare('SELECT id, data FROM parties WHERE departure_at > ?')
    .bind(Date.now() - 7 * 86_400_000).all();
  for (const row of rows.results) {
    if (!JSON.parse(row.data).members.some((member) => member.id === user.id)) continue;
    for (let attempt = 0; attempt < 4; attempt++) {
      let record;
      try { record = await partyById(db, row.id); }
      catch (error) { if (error.status === 404) break; throw error; }
      const { party, version } = record;
      if (!party.members.some((member) => member.id === user.id)) break;
      party.members = party.members.map((member) => member.id === user.id ? user : member);
      const result = await db.prepare('UPDATE parties SET data = ?, version = version + 1 WHERE id = ? AND version = ?')
        .bind(JSON.stringify(party), row.id, version).run();
      if (result.meta.changes === 1) break;
    }
  }
}

async function requireUser(request, db) {
  const user = await userOf(request, db);
  if (!user) throw new HttpError(401, '로그인한 뒤 이용해 주세요.');
  return user;
}

async function partyById(db, id) {
  const row = await db.prepare('SELECT data, version FROM parties WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, '파티를 찾을 수 없습니다.');
  return { party: JSON.parse(row.data), version: row.version };
}

export default {
  async scheduled(_controller, env) {
    const cutoff = Date.now() - 7 * 86_400_000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM messages WHERE party_id IN (SELECT id FROM parties WHERE departure_at < ?)').bind(cutoff),
      env.DB.prepare('DELETE FROM parties WHERE departure_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(new Date(Date.now() - 90 * 86_400_000).toISOString()),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    ]);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const db = env.DB;
    try {
      if (path === '/api/me' && request.method === 'GET') {
        return json({ user: await userOf(request, db) });
      }
      if (path === '/api/universities' && request.method === 'GET') return json({ universities });
      if (path === '/api/register' && request.method === 'POST') {
        const { loginId, password, name, university, acceptedRules } = await bodyOf(request);
        const id = accountInput(loginId, password);
        if (acceptedRules !== true) throw new HttpError(400, '이용 규칙에 동의해 주세요.');
        if (!universities.includes(university)) throw new HttpError(400, '수도권 대학을 목록에서 선택해 주세요.');
        const user = { id: crypto.randomUUID(), loginId: id, name: cleanText(name, 2, 12, '닉네임'), university, avatarUrl: null, termsAcceptedAt: Date.now() };
        const hash = await passwordHash(password, crypto);
        const inserted = await db.prepare('INSERT OR IGNORE INTO accounts (login_id, id, name, university, password_hash, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, user.id, user.name, university, hash, user.termsAcceptedAt).run();
        if (!inserted.meta.changes) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
        const token = crypto.randomUUID();
        await db.prepare('INSERT INTO sessions (token, id, login_id, name, university, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(token, user.id, id, user.name, university, Date.now() + 30 * 86_400_000).run();
        return json({ user }, 201, { 'Set-Cookie': `taxi_pot=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` });
      }
      if (path === '/api/login' && request.method === 'POST') {
        const { loginId, password } = await bodyOf(request);
        const id = accountInput(loginId, password);
        const account = await db.prepare('SELECT id, name, university, avatar_url AS avatarUrl, password_hash AS passwordHash, terms_accepted_at AS termsAcceptedAt, suspended_at AS suspendedAt FROM accounts WHERE login_id = ?').bind(id).first();
        if (!account || !(await verifyPassword(password, account.passwordHash, crypto))) throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
        if (account.suspendedAt) throw new HttpError(403, '이용이 제한된 계정입니다. 운영자에게 문의해 주세요.');
        const user = { id: account.id, loginId: id, name: account.name, university: account.university, avatarUrl: account.avatarUrl, termsAcceptedAt: account.termsAcceptedAt };
        const token = crypto.randomUUID();
        await db.prepare('INSERT INTO sessions (token, id, login_id, name, university, avatar_url, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(token, user.id, id, user.name, user.university, user.avatarUrl, Date.now() + 30 * 86_400_000).run();
        return json({ user }, 200, { 'Set-Cookie': `taxi_pot=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` });
      }
      if (path === '/api/logout' && request.method === 'POST') {
        const token = request.headers.get('cookie')?.match(/(?:^|;\s*)taxi_pot=([a-f0-9-]+)/)?.[1];
        if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        return json({ ok: true }, 200, { 'Set-Cookie': 'taxi_pot=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
      }
      if (path === '/api/accept-rules' && request.method === 'POST') {
        const user = await requireUser(request, db);
        const { acceptedRules } = await bodyOf(request);
        if (acceptedRules !== true) throw new HttpError(400, '이용 규칙에 동의해 주세요.');
        await db.prepare('UPDATE accounts SET terms_accepted_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
        return json({ ok: true });
      }
      if (path === '/api/account' && request.method === 'DELETE') {
        const { loginId, password } = await bodyOf(request);
        const id = accountInput(loginId, password);
        const account = await db.prepare('SELECT id, password_hash AS passwordHash FROM accounts WHERE login_id = ?').bind(id).first();
        if (!account || !(await verifyPassword(password, account.passwordHash, crypto))) throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
        const rows = await db.prepare('SELECT id FROM parties WHERE data LIKE ?').bind(`%${account.id}%`).all();
        for (const row of rows.results) {
          let saved = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            const { party, version } = await partyById(db, row.id);
            if (!party.members.some((member) => member.id === account.id)) { saved = true; break; }
            const changed = removeAccountFromParty(party, account.id, crypto.randomUUID());
            const result = changed
              ? await db.prepare('UPDATE parties SET data = ?, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(changed), row.id, version).run()
              : await db.prepare('DELETE FROM parties WHERE id = ? AND version = ?').bind(row.id, version).run();
            if (result.meta.changes === 1) { saved = true; break; }
          }
          if (!saved) throw new HttpError(409, '파티가 변경되었습니다. 다시 시도해 주세요.');
        }
        await db.batch([
          db.prepare('DELETE FROM messages WHERE sender_id = ? OR party_id NOT IN (SELECT id FROM parties)').bind(account.id),
          db.prepare('DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?').bind(account.id, account.id),
          db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').bind(account.id, account.id),
          db.prepare('DELETE FROM sessions WHERE id = ?').bind(account.id),
          db.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id),
        ]);
        return json({ ok: true }, 200, { 'Set-Cookie': 'taxi_pot=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
      }
      if (path === '/api/session' && request.method === 'POST') {
        const { name } = await bodyOf(request);
        const current = await requireUser(request, db);
        requireRules(current);
        const user = { ...current, name: cleanText(name, 2, 12, '닉네임'), avatarUrl: null };
        await db.prepare('UPDATE accounts SET name = ?, avatar_url = NULL WHERE id = ?').bind(user.name, user.id).run();
        await db.prepare('UPDATE sessions SET name = ?, avatar_url = NULL WHERE id = ?').bind(user.name, user.id).run();
        await updatePartyProfiles(db, user);
        return json({ user });
      }
      if (path === '/api/session/kakao' && request.method === 'POST') {
        const current = await requireUser(request, db);
        requireRules(current);
        const { accessToken } = await bodyOf(request);
        const profile = await kakaoProfile(accessToken, env.KAKAO_APP_ID);
        const user = { ...current, ...profile };
        await db.prepare('UPDATE accounts SET name = ?, avatar_url = ? WHERE id = ?').bind(user.name, user.avatarUrl, user.id).run();
        await db.prepare('UPDATE sessions SET name = ?, avatar_url = ? WHERE id = ?').bind(user.name, user.avatarUrl, user.id).run();
        await updatePartyProfiles(db, user);
        return json({ user });
      }
      if (path === '/api/blocks' && request.method === 'GET') {
        const user = await requireUser(request, db);
        const rows = await db.prepare('SELECT blocked_id AS blockedId FROM blocks WHERE blocker_id = ?').bind(user.id).all();
        return json({ blockedIds: rows.results.map((row) => row.blockedId) });
      }
      if (path === '/api/blocks' && request.method === 'POST') {
        const user = await requireUser(request, db);
        const { partyId, blockedUserId } = await bodyOf(request);
        const { party } = await partyById(db, partyId);
        requireUniversity(party, user);
        if (!party.members.some((member) => member.id === blockedUserId) || blockedUserId === user.id) throw new HttpError(400, '차단할 파티원을 확인해 주세요.');
        await db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').bind(user.id, blockedUserId).run();
        return json({ ok: true });
      }
      const unblockMatch = path.match(/^\/api\/blocks\/([a-f0-9-]+)$/);
      if (unblockMatch && request.method === 'DELETE') {
        const user = await requireUser(request, db);
        await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(user.id, unblockMatch[1]).run();
        return json({ ok: true });
      }
      if (path === '/api/reports' && request.method === 'POST') {
        const user = await requireUser(request, db);
        const { partyId, reportedUserId, messageId, reason } = await bodyOf(request);
        const { party } = await partyById(db, partyId);
        requireUniversity(party, user);
        if (!party.members.some((member) => member.id === reportedUserId) || reportedUserId === user.id) throw new HttpError(400, '신고 대상을 확인해 주세요.');
        if (messageId !== null && messageId !== undefined) {
          if (!Number.isSafeInteger(messageId)) throw new HttpError(400, '신고할 메시지를 확인해 주세요.');
          const message = await db.prepare('SELECT sender_id AS senderId FROM messages WHERE id = ? AND party_id = ?').bind(messageId, partyId).first();
          if (!message || message.senderId !== reportedUserId) throw new HttpError(400, '신고할 메시지를 확인해 주세요.');
        }
        await db.prepare('INSERT INTO reports (reporter_id, reported_id, party_id, message_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(user.id, reportedUserId, partyId, messageId ?? null, cleanText(reason, 2, 500, '신고 사유'), new Date().toISOString()).run();
        return json({ ok: true }, 201);
      }
      if (path === '/api/parties' && request.method === 'GET') {
        const user = await requireUser(request, db);
        const now = Date.now();
        const rows = await db.prepare('SELECT data FROM parties WHERE university = ? AND departure_at > ? ORDER BY departure_at')
          .bind(user.university, now - 7 * 86_400_000).all();
        const parties = rows.results.map((row) => JSON.parse(row.data))
          .filter((party) => Date.parse(party.departureAt) > now || party.members.some((member) => member.id === user?.id))
          .map(publicParty);
        return json({ parties });
      }
      if (path === '/api/parties' && request.method === 'POST') {
        const user = await requireUser(request, db);
        requireRules(user);
        const input = await bodyOf(request);
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
          id: crypto.randomUUID(), region: 'metro', university: user.university, title: cleanText(input.title, 2, 40, '파티 제목'),
          departureAt: new Date(departure).toISOString(), seats: input.seats,
          meeting: { lat, lng, note: cleanText(input.meeting.note || '', 0, 80, '집결지 설명') },
          members: [user], fare: null, createdAt: new Date().toISOString(),
        };
        await db.prepare('INSERT INTO parties (id, region, university, departure_at, data) VALUES (?, ?, ?, ?, ?)')
          .bind(party.id, party.region, party.university, departure, JSON.stringify(party)).run();
        return json({ party: publicParty(party) }, 201);
      }
      const chatMatch = path.match(/^\/api\/parties\/([a-f0-9-]+)\/messages$/);
      if (chatMatch && ['GET', 'POST'].includes(request.method)) {
        const user = await requireUser(request, db);
        const { party } = await partyById(db, chatMatch[1]);
        requireChatMember(party, user);
        if (request.method === 'GET') {
          const after = chatCursor(url.searchParams.get('after'));
          const rows = after === null
            ? await db.prepare('SELECT id, sender_id AS senderId, sender_name AS senderName, body, created_at AS createdAt FROM messages WHERE party_id = ? ORDER BY id DESC LIMIT 100').bind(party.id).all()
            : await db.prepare('SELECT id, sender_id AS senderId, sender_name AS senderName, body, created_at AS createdAt FROM messages WHERE party_id = ? AND id > ? ORDER BY id LIMIT 100').bind(party.id, after).all();
          const blocks = await db.prepare('SELECT blocked_id AS blockedId FROM blocks WHERE blocker_id = ?').bind(user.id).all();
          const blocked = new Set(blocks.results.map((row) => row.blockedId));
          const messages = after === null ? rows.results.reverse() : rows.results;
          return json({ messages: messages.filter((message) => !blocked.has(message.senderId)), nextAfter: messages.at(-1)?.id ?? after });
        }
        requireRules(user);
        const { body } = await bodyOf(request);
        const message = { senderId: user.id, senderName: party.members.find((member) => member.id === user.id).name, body: chatText(body), createdAt: new Date().toISOString() };
        const result = await db.prepare('INSERT INTO messages (party_id, sender_id, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(party.id, message.senderId, message.senderName, message.body, message.createdAt).run();
        return json({ message: { id: result.meta.last_row_id, ...message } }, 201);
      }
      const match = path.match(/^\/api\/parties\/([a-f0-9-]+)\/(join|leave|fare|complete|cancel)$/);
      if (match && request.method === 'POST') {
        const user = await requireUser(request, db);
        const action = match[2];
        const input = action === 'fare' ? await bodyOf(request) : null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const { party, version } = await partyById(db, match[1]);
          requireUniversity(party, user);
          if (action === 'join') {
            requireRules(user);
            if (party.fare !== null || Date.parse(party.departureAt) <= Date.now()) throw new HttpError(409, '모집이 끝난 파티입니다.');
            if (party.members.some((member) => member.id === user.id)) throw new HttpError(409, '이미 참여 중인 파티입니다.');
            if (party.members.length >= party.seats) throw new HttpError(409, '정원이 찼습니다.');
            for (const member of party.members) {
              const blocked = await db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
                .bind(user.id, member.id, member.id, user.id).first();
              if (blocked) throw new HttpError(403, '차단 관계가 있는 파티에는 참여할 수 없습니다.');
            }
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
            if (!Number.isSafeInteger(input.fare) || input.fare < 1 || input.fare > 500_000) throw new HttpError(400, '택시비는 1~500,000원으로 입력해 주세요.');
            party.fare = input.fare;
          } else if (action === 'complete') {
            requireRules(user);
            if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 이용을 마칠 수 있습니다.');
            if (party.completedAt) throw new HttpError(409, '이미 마친 파티입니다.');
            if (party.fare === null) throw new HttpError(409, '택시비를 계산한 뒤 이용을 마쳐 주세요.');
            party.completedAt = new Date().toISOString();
          } else {
            if (party.members[0].id !== user.id) throw new HttpError(403, '파티장만 취소할 수 있습니다.');
            if (party.fare !== null) throw new HttpError(409, '정산이 시작된 파티는 취소할 수 없습니다.');
          }
          const result = action === 'cancel'
            ? await db.prepare('DELETE FROM parties WHERE id = ? AND version = ?').bind(party.id, version).run()
            : await db.prepare('UPDATE parties SET data = ?, version = version + 1 WHERE id = ? AND version = ?')
              .bind(JSON.stringify(party), party.id, version).run();
          if (result.meta.changes === 1) {
            if (action === 'cancel') {
              await db.prepare('DELETE FROM messages WHERE party_id = ?').bind(party.id).run();
              return json({ ok: true });
            }
            return json({ party: publicParty(party) });
          }
        }
        throw new HttpError(409, '파티가 변경되었습니다. 다시 시도해 주세요.');
      }
      throw new HttpError(404, '페이지를 찾을 수 없습니다.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      return json({ error: error.status ? error.message : '서버 오류가 발생했습니다.' }, error.status || 500);
    }
  },
};
