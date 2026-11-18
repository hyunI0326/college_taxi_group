import { HttpError } from './domain.mjs';

const iterations = 100_000; // Cloudflare Workers WebCrypto rejects PBKDF2 counts above 100000.
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value) => Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));

export function accountInput(loginId, password) {
  const id = typeof loginId === 'string' ? loginId.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{4,24}$/.test(id)) throw new HttpError(400, '아이디는 영문 소문자·숫자·밑줄 4~24자로 입력해 주세요.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, '비밀번호는 8~72자로 입력해 주세요.');
  return id;
}

export async function passwordHash(password, cryptoApi, salt = hex(cryptoApi.getRandomValues(new Uint8Array(16))), count = iterations) {
  const key = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await cryptoApi.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: count }, key, 256);
  return `${count}:${salt}:${hex(new Uint8Array(hash))}`;
}

export async function verifyPassword(password, stored, cryptoApi) {
  const parts = typeof stored === 'string' ? stored.split(':') : [];
  const [count, salt, expected] = parts.length === 2 ? [120_000, ...parts] : [Number(parts[0]), parts[1], parts[2]];
  if (![100_000, 120_000].includes(count) || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(expected || '')) return false;
  const actual = (await passwordHash(password, cryptoApi, salt, count)).split(':')[2];
  let mismatch = 0;
  for (let index = 0; index < actual.length; index++) mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}
