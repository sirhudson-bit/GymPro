-- 0006: وضعیت دستگاه‌هایی که با ADMS به برنامه وصل می‌شوند
CREATE TABLE IF NOT EXISTS adms_seen (
  sn          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  table_name  TEXT NOT NULL DEFAULT '',
  count       INTEGER NOT NULL DEFAULT 0
);
