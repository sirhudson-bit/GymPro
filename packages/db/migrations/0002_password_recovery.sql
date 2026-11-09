-- 0002: بازیابی رمز عبور (کد بازیابی + توکن پشتیبانی) و ردیابی تغییر رمز

ALTER TABLE users ADD COLUMN recovery_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_used_at TEXT;
ALTER TABLE users ADD COLUMN recovery_issued_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

CREATE INDEX IF NOT EXISTS ix_users_recovery ON users(id) WHERE recovery_hash IS NOT NULL;
