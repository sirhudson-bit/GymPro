-- 0003: کارت عضویت — بارکد یکتا فقط برای کارت‌های فعال
-- مشکل: ایندکس یکتای سراسری روی barcode_value باعث می‌شد صدور کارت جدید برای
-- عضوی که کارت قبلی‌اش باطل شده بود با خطای UNIQUE constraint failed شکست بخورد.

DROP INDEX IF EXISTS ux_member_cards_barcode;

CREATE UNIQUE INDEX IF NOT EXISTS ux_member_cards_barcode_active
  ON member_cards(barcode_value) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_member_cards_barcode_all ON member_cards(barcode_value);
