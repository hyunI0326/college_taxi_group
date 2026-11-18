CREATE TABLE IF NOT EXISTS accounts (
  login_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  university TEXT NOT NULL,
  avatar_url TEXT,
  password_hash TEXT NOT NULL
);
ALTER TABLE sessions ADD COLUMN login_id TEXT;
ALTER TABLE sessions ADD COLUMN university TEXT;
ALTER TABLE parties ADD COLUMN university TEXT;
CREATE INDEX IF NOT EXISTS parties_university_departure ON parties(university, departure_at);
