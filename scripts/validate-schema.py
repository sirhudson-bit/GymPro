#!/usr/bin/env python3
"""Executes the real migration and proves the constraints actually bite.

usage: python scripts/validate-schema.py [migrations/0001_init.sql]
"""
import os
import re
import sqlite3
import sys
import tempfile

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join("packages", "db", "migrations", "0001_init.sql")
sql = open(path, encoding="utf-8").read()

db_file = os.path.join(tempfile.mkdtemp(), "validate.db")
con = sqlite3.connect(db_file)
con.executescript(sql)
con.execute("PRAGMA foreign_keys = ON")

tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
indexes = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")]
fk = con.execute("PRAGMA foreign_key_check").fetchall()
integrity = con.execute("PRAGMA integrity_check").fetchone()[0]

print(f"tables={len(tables)} indexes={len(indexes)} integrity={integrity} fk_errors={len(fk)}")

BRANCH = con.execute("SELECT id FROM branches LIMIT 1").fetchone()[0]

probes = []


def expect_reject(label, statement, params=()):
    try:
        con.execute(statement, params)
        con.commit()
        probes.append((label, "FAILED — statement was accepted"))
    except sqlite3.IntegrityError as exc:
        probes.append((label, f"rejected ({exc})"))


con.execute(
    "INSERT INTO members (id, branch_id, member_no, full_name, mobile, joined_at) VALUES (?,?,?,?,?,?)",
    ("m-1", BRANCH, 1, "علی رضایی", "09120000000", "2026-01-01"),
)
probes.append(("baseline member insert", "ok"))

expect_reject(
    "duplicate mobile in same branch",
    "INSERT INTO members (id, branch_id, member_no, full_name, mobile, joined_at) VALUES (?,?,?,?,?,?)",
    ("m-2", BRANCH, 2, "رضا", "09120000000", "2026-01-01"),
)
expect_reject(
    "dangling branch_id (foreign key)",
    "INSERT INTO members (id, branch_id, member_no, full_name, mobile, joined_at) VALUES (?,?,?,?,?,?)",
    ("m-3", "no-such-branch", 3, "سارا", "09120000001", "2026-01-01"),
)
expect_reject(
    "negative plan price (CHECK)",
    "INSERT INTO plans (id, branch_id, name, kind, price_irr) VALUES (?,?,?,?,?)",
    ("p-1", BRANCH, "منفی", "time", -5),
)
expect_reject(
    "invalid contract status (CHECK)",
    "INSERT INTO contracts (id, branch_id, member_id, plan_id, contract_no, start_date, end_date, list_price_irr, status) VALUES (?,?,?,?,?,?,?,?,?)",
    ("c-1", BRANCH, "m-1", "no-plan", 1, "2026-01-01", "2026-01-30", 1000, "bogus"),
)
expect_reject(
    "zero payment amount (CHECK)",
    "INSERT INTO payments (id, branch_id, member_id, receipt_no, amount_irr, method, paid_at, created_by) VALUES (?,?,?,?,?,?,?,?)",
    ("pay-1", BRANCH, "m-1", 1, 0, "cash", "2026-01-01", "no-user"),
)
con.execute(
    "INSERT INTO outbox (id, branch_id, device_id, entity, entity_id, op, payload_json, entity_version, happened_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ("o-2", BRANCH, "d", "member", "m-1", "create", "{}", 1, "2026-01-01"),
)
expect_reject(
    "duplicate outbox revision (dedupe index)",
    "INSERT INTO outbox (id, branch_id, device_id, entity, entity_id, op, payload_json, entity_version, happened_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ("o-1", BRANCH, "d", "member", "m-1", "update", "{}", 1, "2026-01-01"),
)
con.commit()

for label, result in probes:
    print(f"  {'✓' if 'rejected' in result or result == 'ok' else '✗'} {label}: {result}")

bad = [p for p in probes if "rejected" not in p[1] and p[1] != "ok"]
print("ALL PASS" if not bad and not fk and integrity == "ok" else "FAILURES")
sys.exit(0 if not bad and not fk and integrity == "ok" else 1)
