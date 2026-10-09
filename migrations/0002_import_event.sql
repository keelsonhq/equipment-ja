-- 0002_import_event: history gets one more kind, 'import' (one CSV import,
-- with its counts in detail).
--
-- SQLite cannot change a CHECK constraint in place, so the events table is
-- rebuilt: new table, copy in the original order (rowid breaks ties between
-- events with the same time), swap, recreate the indexes.

CREATE TABLE events_new (
	id                TEXT PRIMARY KEY,
	at                TEXT NOT NULL,
	kind              TEXT NOT NULL CHECK (kind IN
		('create', 'edit', 'issue', 'return', 'suspend', 'resume', 'correct', 'import')),
	item_id           INTEGER,
	item_tag          TEXT,
	item_name         TEXT,
	assignment_id     TEXT,
	subject_user_id   TEXT,
	subject_user_name TEXT,
	actor_id          TEXT NOT NULL,
	actor_name        TEXT NOT NULL,
	detail            TEXT
);

INSERT INTO events_new (id, at, kind, item_id, item_tag, item_name, assignment_id,
		subject_user_id, subject_user_name, actor_id, actor_name, detail)
	SELECT id, at, kind, item_id, item_tag, item_name, assignment_id,
		subject_user_id, subject_user_name, actor_id, actor_name, detail
	FROM events ORDER BY rowid;

DROP TABLE events;

ALTER TABLE events_new RENAME TO events;

CREATE INDEX idx_events_at ON events (at);

CREATE INDEX idx_events_item ON events (item_id, at);

CREATE INDEX idx_events_subject ON events (subject_user_id, at);
