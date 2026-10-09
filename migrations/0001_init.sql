-- 0001_init: the initial schema. Data model and the reasons behind it:
-- REQUIREMENTS.md section 3.
--
-- IF NOT EXISTS is deliberate here (only here): databases created before
-- migrations existed already have these tables, and this file must apply to
-- them as a no-op so that only the ledger row is recorded. New migrations
-- (0002 and later) are plain DDL.
--
-- Statement rule (see CUSTOMIZE.md): a statement ends with ";" at the end of
-- a line. Do not put ";" anywhere else (no triggers).

CREATE TABLE IF NOT EXISTS item_types (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	active     INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- Usage places of an assignment (office / home / ...). Not the storage
-- location of an unassigned item, which is free text on the item.
CREATE TABLE IF NOT EXISTS places (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	active     INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- An item never stores who holds it: the assignment row with
-- returned_on IS NULL is the current holder.
CREATE TABLE IF NOT EXISTS items (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	asset_tag        TEXT NOT NULL UNIQUE,
	name             TEXT NOT NULL,
	type_id          INTEGER REFERENCES item_types (id),
	serial_no        TEXT,
	purchased_on     TEXT,
	storage_location TEXT,
	note             TEXT,
	suspended_reason TEXT CHECK (suspended_reason IN ('repair', 'broken', 'lost', 'other')),
	suspended_note   TEXT,
	version          INTEGER NOT NULL DEFAULT 1,
	created_at       TEXT NOT NULL,
	updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_type ON items (type_id);

CREATE INDEX IF NOT EXISTS idx_items_name ON items (name);

-- One row per hand-over. user_name / user_email are snapshots taken when the
-- item was issued, so the history stays readable after the person leaves the
-- workspace directory.
CREATE TABLE IF NOT EXISTS assignments (
	id               TEXT PRIMARY KEY,
	item_id          INTEGER NOT NULL REFERENCES items (id),
	user_id          TEXT NOT NULL,
	user_name        TEXT NOT NULL,
	user_email       TEXT,
	place_id         INTEGER REFERENCES places (id),
	place_name       TEXT,
	issued_on        TEXT NOT NULL,
	due_on           TEXT,
	note             TEXT,
	issued_by_id     TEXT NOT NULL,
	issued_by_name   TEXT NOT NULL,
	returned_on      TEXT,
	return_kind      TEXT CHECK (return_kind IN ('returned', 'collected')),
	returned_by_id   TEXT,
	returned_by_name TEXT,
	return_note      TEXT,
	pending_return   INTEGER NOT NULL DEFAULT 0,
	replaced_by      TEXT,
	version          INTEGER NOT NULL DEFAULT 1,
	created_at       TEXT NOT NULL,
	updated_at       TEXT NOT NULL
);

-- The double-assignment guarantee: at most one open assignment per item.
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignments_open_item
	ON assignments (item_id) WHERE returned_on IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments (user_id, returned_on);

CREATE INDEX IF NOT EXISTS idx_assignments_item ON assignments (item_id, issued_on);

-- History. Item and person fields are snapshots for the same reason as on
-- assignments. detail is a JSON object (diffs, reason, note).
CREATE TABLE IF NOT EXISTS events (
	id                TEXT PRIMARY KEY,
	at                TEXT NOT NULL,
	kind              TEXT NOT NULL CHECK (kind IN
		('create', 'edit', 'issue', 'return', 'suspend', 'resume', 'correct')),
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

CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);

CREATE INDEX IF NOT EXISTS idx_events_item ON events (item_id, at);

CREATE INDEX IF NOT EXISTS idx_events_subject ON events (subject_user_id, at);

-- Attachment metadata. The bytes live in the platform file store under
-- file_key (src/lib/server/attachments.ts).
CREATE TABLE IF NOT EXISTS attachments (
	id               TEXT PRIMARY KEY,
	item_id          INTEGER NOT NULL REFERENCES items (id),
	file_key         TEXT NOT NULL,
	file_name        TEXT NOT NULL,
	content_type     TEXT NOT NULL,
	size             INTEGER NOT NULL,
	uploaded_by_id   TEXT NOT NULL,
	uploaded_by_name TEXT NOT NULL,
	created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments (item_id, created_at);
