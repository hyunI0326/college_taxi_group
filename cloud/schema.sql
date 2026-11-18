CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  login_id TEXT,
  name TEXT NOT NULL,
  university TEXT,
  avatar_url TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  login_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  university TEXT NOT NULL,
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  terms_accepted_at INTEGER,
  suspended_at INTEGER
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  university TEXT,
  departure_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS parties_region_departure ON parties(region, departure_at);
CREATE INDEX IF NOT EXISTS parties_university_departure ON parties(university, departure_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_party_id ON messages(party_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  message_id INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at INTEGER
);
