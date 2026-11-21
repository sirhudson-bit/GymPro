-- 0004: دستگاه‌های اثر انگشت (ZKTeco / Suprema / Futronic) + نگاشت شناسهٔ دستگاه
-- اصل: تمپلیت اثر انگشت هرگز از دستگاه بیرون کشیده نمی‌شود؛ فقط «رکورد تردد» می‌آید.

CREATE TABLE IF NOT EXISTS bio_devices (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  brand           TEXT NOT NULL CHECK (brand IN ('zkteco','suprema','futronic')),
  label           TEXT NOT NULL,
  -- zkteco: 'tcp' (پورت 4370) یا 'adms' (دستگاه push می‌کند)
  -- suprema: 'biostar' (REST بایوستار ۲) یا 'csv'
  -- futronic: 'csv' (پوشهٔ خروجی نرم‌افزار سازنده) یا 'bridge'
  mode            TEXT NOT NULL DEFAULT 'tcp',
  host            TEXT,
  port            INTEGER,
  serial_no       TEXT,
  -- اعتبارنامه‌ها: فقط برای Suprema BioStar 2 (کاربر API)
  api_user        TEXT,
  api_secret      TEXT,
  csv_path        TEXT,
  -- 'in_out' یعنی دستگاه خودش ورود/خروج را مشخص می‌کند، 'toggle' یعنی برنامه جفت می‌کند
  punch_mode      TEXT NOT NULL DEFAULT 'toggle' CHECK (punch_mode IN ('in_out','toggle')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_sync_at    TEXT,
  last_sync_count INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_bio_devices_branch ON bio_devices(branch_id, is_active);

-- هر رکورد خام دستگاه؛ کلید یکتای طبیعی = (دستگاه، شناسهٔ کاربر، زمان، جهت)
CREATE TABLE IF NOT EXISTS bio_punches (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  device_id       TEXT NOT NULL REFERENCES bio_devices(id),
  device_user_no  TEXT NOT NULL,
  punched_at      TEXT NOT NULL,
  direction       TEXT CHECK (direction IN ('in','out')),
  dedupe_key      TEXT NOT NULL,
  member_id       TEXT REFERENCES members(id),
  checkin_id      TEXT REFERENCES checkins(id),
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','ignored','unknown_member')),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bio_punches_dedupe ON bio_punches(dedupe_key);
CREATE INDEX IF NOT EXISTS ix_bio_punches_member_day ON bio_punches(member_id, punched_at);
CREATE INDEX IF NOT EXISTS ix_bio_punches_status ON bio_punches(branch_id, status);

-- نگاشت شناسهٔ کاربر دستگاه به عضو (چون بعضی برندها شناسهٔ رشته‌ای می‌دهند)
CREATE TABLE IF NOT EXISTS bio_user_map (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  device_id       TEXT NOT NULL REFERENCES bio_devices(id),
  device_user_no  TEXT NOT NULL,
  member_id       TEXT NOT NULL REFERENCES members(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bio_user_map ON bio_user_map(device_id, device_user_no);
CREATE INDEX IF NOT EXISTS ix_bio_user_map_member ON bio_user_map(member_id);

ALTER TABLE checkins ADD COLUMN source_device_id TEXT;
