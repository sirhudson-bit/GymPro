-- 0005: افزودن «اثر انگشت» به روش‌های تردد (بازسازی جدول، چون SQLite CHECK را تغییر نمی‌دهد)
PRAGMA foreign_keys = OFF;

CREATE TABLE checkins_new (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  member_id       TEXT NOT NULL REFERENCES members(id),
  contract_id     TEXT REFERENCES contracts(id),
  shift_id        TEXT REFERENCES shifts(id),
  checked_in_at   TEXT NOT NULL,
  checked_out_at  TEXT,
  method          TEXT NOT NULL CHECK (method IN ('barcode','qr_webcam','manual','kiosk','fingerprint')),
  is_override     INTEGER NOT NULL DEFAULT 0 CHECK (is_override IN (0,1)),
  override_reason TEXT,
  override_by     TEXT REFERENCES users(id),
  device_id       TEXT REFERENCES devices(id),
  source_device_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);

INSERT INTO checkins_new (id, branch_id, member_id, contract_id, shift_id, checked_in_at, checked_out_at, method,
  is_override, override_reason, override_by, device_id, source_device_id, created_at, updated_at, deleted_at, version)
SELECT id, branch_id, member_id, contract_id, shift_id, checked_in_at, checked_out_at, method,
  is_override, override_reason, override_by, device_id, source_device_id, created_at, updated_at, deleted_at, version
FROM checkins;

DROP TABLE checkins;
ALTER TABLE checkins_new RENAME TO checkins;

CREATE INDEX ix_checkins_member_day ON checkins(member_id, checked_in_at);
CREATE INDEX ix_checkins_branch_day ON checkins(branch_id, checked_in_at);
CREATE INDEX ix_checkins_source_device ON checkins(source_device_id);
