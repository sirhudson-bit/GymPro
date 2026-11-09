-- GymPro — migration 0001: initial schema
-- هدف: اسکیمای سازگار با سینک آینده (UUIDv7 + branch_id + outbox + version + soft delete)
-- قواعد ثابت این فایل:
--   * همه PKها TEXT با UUIDv7 (مرتب‌شدنی بر اساس زمان، بدون برخورد در سینک)
--   * همه پول‌ها INTEGER و بر حسب «ریال» (هیچ FLOAT برای مبلغ)
--   * همه زمان‌ها TEXT ISO-8601 در UTC با میلی‌ثانیه: 2026-11-07T06:30:00.000Z
--   * همه جداول دامنه: created_at, updated_at, deleted_at, version
--   * حذف همیشه نرم است؛ هیچ DELETE فیزیکی در لایه Repository مجاز نیست
--   * FK ها با PRAGMA foreign_keys=ON اجرا می‌شوند

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ─────────────────────────────────────────────────────────────
-- زیرساخت
-- ─────────────────────────────────────────────────────────────

-- schema_migrations و دستگاه‌ها: جدول schema_migrations توسط migrate() ساخته می‌شود
-- (قبل از اجرای این فایل) تا checksum هر مایگریشن قابل ثبت باشد.

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL UNIQUE,
  label         TEXT,
  app_version   TEXT,
  is_local      INTEGER NOT NULL DEFAULT 1 CHECK (is_local IN (0,1)),
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE branches (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  gender_type   TEXT NOT NULL DEFAULT 'mixed' CHECK (gender_type IN ('men','women','mixed')),
  currency_unit TEXT NOT NULL DEFAULT 'IRR' CHECK (currency_unit IN ('IRR','IRT')),
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tehran',
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_branches_code ON branches(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_branches_single_default ON branches(is_default) WHERE is_default = 1 AND deleted_at IS NULL;

CREATE TABLE settings (
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (branch_id, key)
);

-- ─────────────────────────────────────────────────────────────
-- کاربران، نقش‌ها، حسابرسی
-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  username        TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','manager','receptionist','trainer')),
  password_hash   TEXT NOT NULL,           -- bcrypt (cost 12)
  pin_hash        TEXT,                    -- PIN 4 رقمی، bcrypt
  must_change_pin INTEGER NOT NULL DEFAULT 0 CHECK (must_change_pin IN (0,1)),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_users_username ON users(branch_id, username) WHERE deleted_at IS NULL;

CREATE TABLE login_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  device_id   TEXT REFERENCES devices(id),
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT,
  end_reason  TEXT CHECK (end_reason IN ('logout','idle_lock','window_closed','forced')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_login_sessions_user ON login_sessions(user_id, started_at);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  actor_user_id TEXT REFERENCES users(id),
  device_id     TEXT REFERENCES devices(id),
  action        TEXT NOT NULL,             -- member.create / payment.void / stock.adjust ...
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_audit_entity ON audit_logs(entity, entity_id, created_at);
CREATE INDEX ix_audit_actor ON audit_logs(actor_user_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- اعضا و کارت‌ها
-- ─────────────────────────────────────────────────────────────

CREATE TABLE members (
  id               TEXT PRIMARY KEY,
  branch_id        TEXT NOT NULL REFERENCES branches(id),
  member_no        INTEGER NOT NULL,          -- شماره عضویت خوانا، فقط برای نمایش/چاپ
  full_name        TEXT NOT NULL,
  mobile           TEXT NOT NULL,             -- تنها شناسه تماس؛ E.164 محلی: 09xxxxxxxxx
  gender           TEXT CHECK (gender IN ('male','female')),
  birth_date       TEXT,                      -- YYYY-MM-DD میلادی (تبدیل شمسی در UI)
  national_id      TEXT,                      -- اختیاری: فقط اگر باشگاه واقعاً لازم دارد
  photo_path       TEXT,                      -- مسیر نسبی در /data/photos (نه blob)
  address          TEXT,
  emergency_name   TEXT,
  emergency_mobile TEXT,
  joined_at        TEXT NOT NULL,
  notes            TEXT,
  consent_at       TEXT,                      -- تاریخ اخذ رضایت ثبت داده (الزام حقوقی)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','blocked')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_members_mobile ON members(branch_id, mobile) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_members_no ON members(branch_id, member_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_members_name ON members(branch_id, full_name) WHERE deleted_at IS NULL;
CREATE INDEX ix_members_birth ON members(branch_id, birth_date);

CREATE TABLE member_cards (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL REFERENCES branches(id),
  member_id      TEXT NOT NULL REFERENCES members(id),
  token_hash     TEXT NOT NULL,               -- sha256 توکن QR؛ توکن خام هرگز ذخیره نمی‌شود
  barcode_value  TEXT NOT NULL,               -- Code128 قابل چاپ
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lost','revoked','expired')),
  issued_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at     TEXT,
  revoke_reason  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_member_cards_token ON member_cards(token_hash);
CREATE UNIQUE INDEX ux_member_cards_barcode ON member_cards(barcode_value);
CREATE INDEX ix_member_cards_member ON member_cards(member_id, status);

-- ─────────────────────────────────────────────────────────────
-- تعرفه‌ها، قراردادها، فریز
-- ─────────────────────────────────────────────────────────────

CREATE TABLE plans (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL REFERENCES branches(id),
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('time','session','hybrid','vip','guest')),
  duration_days  INTEGER,
  session_count  INTEGER,
  price_irr      INTEGER NOT NULL CHECK (price_irr >= 0),
  vat_rate_bp    INTEGER NOT NULL DEFAULT 0 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  trainer_id     TEXT REFERENCES trainers(id),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_plans_branch ON plans(branch_id, is_active);

CREATE TABLE contracts (
  id               TEXT PRIMARY KEY,
  branch_id        TEXT NOT NULL REFERENCES branches(id),
  member_id        TEXT NOT NULL REFERENCES members(id),
  plan_id          TEXT NOT NULL REFERENCES plans(id),
  contract_no      INTEGER NOT NULL,
  start_date       TEXT NOT NULL,             -- YYYY-MM-DD (تاریخ محلی باشگاه)
  end_date         TEXT NOT NULL,
  sessions_total   INTEGER,
  sessions_used    INTEGER NOT NULL DEFAULT 0,
  list_price_irr   INTEGER NOT NULL,
  discount_irr     INTEGER NOT NULL DEFAULT 0,
  discount_reason  TEXT,
  discount_code    TEXT,
  approved_by      TEXT REFERENCES users(id),
  freeze_days_used INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending','active','expired','frozen','cancelled')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_contracts_no ON contracts(branch_id, contract_no);
CREATE INDEX ix_contracts_member ON contracts(member_id, status);
CREATE INDEX ix_contracts_end ON contracts(branch_id, end_date) WHERE status = 'active';

CREATE TABLE membership_freezes (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  contract_id   TEXT NOT NULL REFERENCES contracts(id),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  days          INTEGER NOT NULL CHECK (days > 0),
  reason        TEXT NOT NULL,
  approved_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_freezes_contract ON membership_freezes(contract_id);

-- ─────────────────────────────────────────────────────────────
-- مالی دستی (بدون درگاه)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE cash_sessions (
  id                TEXT PRIMARY KEY,
  branch_id         TEXT NOT NULL REFERENCES branches(id),
  opened_by         TEXT NOT NULL REFERENCES users(id),
  opened_at         TEXT NOT NULL,
  opening_float_irr INTEGER NOT NULL DEFAULT 0,
  closed_by         TEXT REFERENCES users(id),
  closed_at         TEXT,
  expected_irr      INTEGER,
  counted_irr       INTEGER,
  difference_irr    INTEGER,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reopened')),
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_cash_open ON cash_sessions(branch_id) WHERE status = 'open' AND deleted_at IS NULL;

CREATE TABLE payments (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  member_id       TEXT NOT NULL REFERENCES members(id),
  contract_id     TEXT REFERENCES contracts(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  receipt_no      INTEGER NOT NULL,
  amount_irr      INTEGER NOT NULL CHECK (amount_irr <> 0),
  method          TEXT NOT NULL CHECK (method IN ('cash','card_to_card','cheque','installment','wallet')),
  paid_at         TEXT NOT NULL,
  reference       TEXT,                        -- شماره پیگیری کارت‌به‌کارت
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason     TEXT,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_payments_receipt ON payments(branch_id, receipt_no);
CREATE INDEX ix_payments_member ON payments(member_id, paid_at);
CREATE INDEX ix_payments_session ON payments(cash_session_id);

CREATE TABLE installments (
  id               TEXT PRIMARY KEY,
  branch_id        TEXT NOT NULL REFERENCES branches(id),
  payment_id       TEXT NOT NULL REFERENCES payments(id),
  seq              INTEGER NOT NULL,
  due_date         TEXT NOT NULL,
  amount_irr       INTEGER NOT NULL CHECK (amount_irr > 0),
  paid_amount_irr  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue','written_off')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_installments_seq ON installments(payment_id, seq);
CREATE INDEX ix_installments_due ON installments(branch_id, due_date, status);

CREATE TABLE cheques (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  payment_id    TEXT NOT NULL REFERENCES payments(id),
  cheque_no     TEXT NOT NULL,
  bank_name     TEXT NOT NULL,
  account_holder TEXT,
  due_date      TEXT NOT NULL,
  amount_irr    INTEGER NOT NULL CHECK (amount_irr > 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','bounced','returned')),
  settled_at    TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_cheques_due ON cheques(branch_id, due_date, status);

CREATE TABLE wallet_transactions (
  id                TEXT PRIMARY KEY,
  branch_id         TEXT NOT NULL REFERENCES branches(id),
  member_id         TEXT NOT NULL REFERENCES members(id),
  direction         TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_irr        INTEGER NOT NULL CHECK (amount_irr > 0),
  balance_after_irr INTEGER NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('topup','renewal','pos_sale','refund','adjustment')),
  ref_entity        TEXT,
  ref_id            TEXT,
  note              TEXT,
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_wallet_member ON wallet_transactions(member_id, created_at);

CREATE TABLE expenses (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  category        TEXT NOT NULL,
  amount_irr      INTEGER NOT NULL CHECK (amount_irr > 0),
  paid_at         TEXT NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('cash','card_to_card','cheque','bank')),
  payee           TEXT,
  document_no     TEXT,
  note            TEXT,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_expenses_paid ON expenses(branch_id, paid_at);

-- ─────────────────────────────────────────────────────────────
-- تردد و سانس‌ها
-- ─────────────────────────────────────────────────────────────

CREATE TABLE shifts (
  id           TEXT PRIMARY KEY,
  branch_id    TEXT NOT NULL REFERENCES branches(id),
  name         TEXT NOT NULL,
  weekday_mask INTEGER NOT NULL DEFAULT 127 CHECK (weekday_mask BETWEEN 0 AND 127), -- بیت 0=شنبه
  start_time   TEXT NOT NULL,                 -- HH:MM محلی
  end_time     TEXT NOT NULL,
  capacity     INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE checkins (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  member_id       TEXT NOT NULL REFERENCES members(id),
  contract_id     TEXT REFERENCES contracts(id),
  shift_id        TEXT REFERENCES shifts(id),
  checked_in_at   TEXT NOT NULL,
  checked_out_at  TEXT,
  method          TEXT NOT NULL CHECK (method IN ('barcode','qr_webcam','manual','kiosk')),
  is_override     INTEGER NOT NULL DEFAULT 0 CHECK (is_override IN (0,1)),
  override_reason TEXT,
  override_by     TEXT REFERENCES users(id),
  device_id       TEXT REFERENCES devices(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_checkins_member_day ON checkins(member_id, checked_in_at);
CREATE INDEX ix_checkins_branch_day ON checkins(branch_id, checked_in_at);

-- ─────────────────────────────────────────────────────────────
-- مربیان، کلاس‌ها، برنامه تمرینی، آنالیز بدنی
-- ─────────────────────────────────────────────────────────────

CREATE TABLE trainers (
  id                TEXT PRIMARY KEY,
  branch_id         TEXT NOT NULL REFERENCES branches(id),
  user_id           TEXT REFERENCES users(id),
  full_name         TEXT NOT NULL,
  mobile            TEXT,
  specialty         TEXT,
  commission_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (commission_rate_bp BETWEEN 0 AND 10000),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE trainer_commissions (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  trainer_id    TEXT NOT NULL REFERENCES trainers(id),
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  base_irr      INTEGER NOT NULL DEFAULT 0,
  amount_irr    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','paid')),
  paid_at       TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_commissions_period ON trainer_commissions(trainer_id, period_start, period_end);

CREATE TABLE classes (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  trainer_id TEXT REFERENCES trainers(id),
  name       TEXT NOT NULL,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  capacity   INTEGER NOT NULL DEFAULT 10 CHECK (capacity > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE class_enrollments (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  class_id    TEXT NOT NULL REFERENCES classes(id),
  member_id   TEXT NOT NULL REFERENCES members(id),
  enrolled_at TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','attended','no_show')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_enrollment ON class_enrollments(class_id, member_id) WHERE status = 'active';

CREATE TABLE exercises (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  muscle_group TEXT,
  equipment    TEXT,
  description  TEXT,
  media_path   TEXT,
  is_global    INTEGER NOT NULL DEFAULT 1 CHECK (is_global IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE workout_programs (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  trainer_id TEXT REFERENCES trainers(id),
  title      TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  version    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_programs_member ON workout_programs(member_id, start_date);

CREATE TABLE workout_items (
  id           TEXT PRIMARY KEY,
  branch_id    TEXT NOT NULL REFERENCES branches(id),
  program_id   TEXT NOT NULL REFERENCES workout_programs(id),
  exercise_id  TEXT REFERENCES exercises(id),
  day_index    INTEGER NOT NULL DEFAULT 0,
  order_index  INTEGER NOT NULL DEFAULT 0,
  sets         INTEGER,
  reps         TEXT,                          -- "12" یا "8-10"
  weight_kg    REAL,
  rest_seconds INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_workout_items_program ON workout_items(program_id, day_index, order_index);

CREATE TABLE body_measurements (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  member_id     TEXT NOT NULL REFERENCES members(id),
  measured_at   TEXT NOT NULL,
  weight_kg     REAL,
  height_cm     REAL,
  body_fat_pct  REAL,
  muscle_mass_kg REAL,
  waist_cm      REAL,
  chest_cm      REAL,
  arm_cm        REAL,
  thigh_cm      REAL,
  measured_by   TEXT REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_measurements_member ON body_measurements(member_id, measured_at);

-- ─────────────────────────────────────────────────────────────
-- بوفه / انبار / کمد
-- ─────────────────────────────────────────────────────────────

CREATE TABLE products (
  id                 TEXT PRIMARY KEY,
  branch_id          TEXT NOT NULL REFERENCES branches(id),
  sku                TEXT,
  name               TEXT NOT NULL,
  unit               TEXT NOT NULL DEFAULT 'عدد',
  price_irr          INTEGER NOT NULL CHECK (price_irr >= 0),
  cost_irr           INTEGER NOT NULL DEFAULT 0,
  stock_qty          INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 3,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_products_sku ON products(branch_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE sales (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  member_id       TEXT REFERENCES members(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  sale_no         INTEGER NOT NULL,
  subtotal_irr    INTEGER NOT NULL DEFAULT 0,
  discount_irr    INTEGER NOT NULL DEFAULT 0,
  total_irr       INTEGER NOT NULL DEFAULT 0,
  method          TEXT NOT NULL CHECK (method IN ('cash','card_to_card','wallet','credit')),
  sold_at         TEXT NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_sales_no ON sales(branch_id, sale_no);

CREATE TABLE sale_items (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL REFERENCES branches(id),
  sale_id        TEXT NOT NULL REFERENCES sales(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  unit_price_irr INTEGER NOT NULL,
  line_total_irr INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_sale_items_sale ON sale_items(sale_id);

CREATE TABLE inventory_movements (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  qty_delta   INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('purchase','sale','adjustment','return','damage','opening')),
  ref_entity  TEXT,
  ref_id      TEXT,
  note        TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_inventory_product ON inventory_movements(product_id, created_at);

CREATE TABLE lockers (
  id                TEXT PRIMARY KEY,
  branch_id         TEXT NOT NULL REFERENCES branches(id),
  code              TEXT NOT NULL,
  monthly_price_irr INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','rented','broken')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_lockers_code ON lockers(branch_id, code) WHERE deleted_at IS NULL;

CREATE TABLE locker_rentals (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  locker_id   TEXT NOT NULL REFERENCES lockers(id),
  member_id   TEXT NOT NULL REFERENCES members(id),
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  amount_irr  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','expired')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_locker_active ON locker_rentals(locker_id) WHERE status = 'active' AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- باشگاه مشتریان، پیامک
-- ─────────────────────────────────────────────────────────────

CREATE TABLE loyalty_events (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  points     INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('checkin','streak','birthday','referral','redeem','manual')),
  ref_entity TEXT,
  ref_id     TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  version    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_loyalty_member ON loyalty_events(member_id, created_at);

CREATE TABLE sms_queue (
  id           TEXT PRIMARY KEY,
  branch_id    TEXT NOT NULL REFERENCES branches(id),
  member_id    TEXT REFERENCES members(id),
  mobile       TEXT NOT NULL,
  template     TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at      TEXT,
  provider_ref TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_sms_status ON sms_queue(status, scheduled_at);

-- ─────────────────────────────────────────────────────────────
-- پشتیبانی (آفلاین-اول)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE support_tickets (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  created_by      TEXT NOT NULL REFERENCES users(id),
  remote_id       TEXT,                       -- شناسه تیکت روی سرور پشتیبانی
  subject         TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('install','license','billing','bug','howto','data','other')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','queued','sent','answered','closed')),
  last_message_at TEXT,
  unread_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_tickets_status ON support_tickets(branch_id, status);

CREATE TABLE support_messages (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  ticket_id   TEXT NOT NULL REFERENCES support_tickets(id),
  direction   TEXT NOT NULL CHECK (direction IN ('out','in')),
  body        TEXT NOT NULL,
  remote_id   TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  sent_at     TEXT,
  received_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_messages_ticket ON support_messages(ticket_id, created_at);

CREATE TABLE support_attachments (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  ticket_id   TEXT REFERENCES support_tickets(id),
  message_id  TEXT REFERENCES support_messages(id),
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  rel_path    TEXT NOT NULL,                  -- نسبت به /data/attachments
  checksum    TEXT NOT NULL,
  upload_state TEXT NOT NULL DEFAULT 'local' CHECK (upload_state IN ('local','uploaded','failed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────────────────────────
-- لایسنس، آپدیت، بکاپ
-- ─────────────────────────────────────────────────────────────

CREATE TABLE license_state (
  id                       TEXT PRIMARY KEY,
  machine_id               TEXT NOT NULL,
  license_key              TEXT,
  edition                  TEXT NOT NULL DEFAULT 'trial' CHECK (edition IN ('trial','basic','pro','enterprise')),
  features_json            TEXT NOT NULL DEFAULT '[]',
  issued_at                TEXT,
  update_entitlement_until TEXT,
  max_activations          INTEGER NOT NULL DEFAULT 1,
  activations_used         INTEGER NOT NULL DEFAULT 0,
  signature                TEXT,              -- Ed25519 روی canonical payload
  license_json             TEXT,              -- بدنه امضاشده، برای verify مجدد
  status                   TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','tampered','deactivated')),
  last_seen_at             TEXT,              -- ضد دستکاری ساعت
  activated_at             TEXT,
  deactivated_at           TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at               TEXT,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_license_machine ON license_state(machine_id) WHERE deleted_at IS NULL;

CREATE TABLE trial_state (
  id              TEXT PRIMARY KEY,
  machine_id      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  clock_rollbacks INTEGER NOT NULL DEFAULT 0,
  members_created INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','expired','locked','converted')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_trial_machine ON trial_state(machine_id) WHERE deleted_at IS NULL;

CREATE TABLE update_history (
  id             TEXT PRIMARY KEY,
  from_version   TEXT,
  to_version     TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'stable',
  manifest_json  TEXT NOT NULL,
  signature      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('downloaded','installed','verified_failed','rolled_back')),
  applied_at     TEXT,
  failure_reason TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE backups (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('manual','daily','pre_migration','pre_restore')),
  file_name  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_backups_created ON backups(created_at);

-- ─────────────────────────────────────────────────────────────
-- سینک آینده: Transactional Outbox
-- ─────────────────────────────────────────────────────────────

CREATE TABLE outbox (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  op             TEXT NOT NULL CHECK (op IN ('create','update','delete','restore')),
  payload_json   TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  happened_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at        TEXT,
  acked_at       TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
CREATE INDEX ix_outbox_pending ON outbox(branch_id, created_at) WHERE acked_at IS NULL;
CREATE UNIQUE INDEX ux_outbox_dedupe ON outbox(entity, entity_id, entity_version);

CREATE TABLE sync_cursors (
  entity     TEXT PRIMARY KEY,
  cursor     TEXT,
  synced_at  TEXT
);

-- ─────────────────────────────────────────────────────────────
-- Seed حداقلی (شعبه پیش‌فرض؛ بقیه داده‌ها از Setup Wizard)
-- ─────────────────────────────────────────────────────────────

INSERT INTO branches (id, code, name, gender_type, is_default)
VALUES ('0192f1c4-0000-7000-8000-000000000001', 'MAIN', 'شعبه اصلی', 'mixed', 1);
