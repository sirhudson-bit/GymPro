-- 0007: وضعیت ثبت اثر انگشت هر عضو روی هر دستگاه
-- (تمپلیت روی دستگاه می‌ماند؛ اینجا فقط «چه کسی ثبت شد و کِی» نگه داشته می‌شود)
ALTER TABLE bio_user_map ADD COLUMN enrolled_at TEXT;
ALTER TABLE bio_user_map ADD COLUMN enrolled_by TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS ix_bio_user_map_enrolled ON bio_user_map(device_id, enrolled_at);
