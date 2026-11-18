ALTER TABLE accounts ADD COLUMN terms_accepted_at INTEGER;
CREATE TABLE IF NOT EXISTS blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL, reported_id TEXT NOT NULL, party_id TEXT NOT NULL, message_id INTEGER, reason TEXT NOT NULL, created_at TEXT NOT NULL);
