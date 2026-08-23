"""Drop the service_category CHECK constraint from service_visits.

Category is now a free-form, fleet-suggested value (users can pick one of the
built-in suggestions or type their own, same as the line-item description
field) instead of a fixed five-value enum. The API no longer restricts the
value, so the DB-level CHECK is redundant and would reject any new category.

Dialect-aware, following the same live-DDL-swap approach as migration 079
(vehicle_type CHECK removal):
  * PostgreSQL — ``ALTER TABLE ... DROP CONSTRAINT`` by definition lookup.
  * SQLite — no in-place CHECK drop exists, so the table is rebuilt: the
    existing ``CREATE TABLE`` is read from sqlite_master, its
    ``service_category`` CHECK clause is stripped, and the table is rebuilt
    (create → copy → drop → rename), preserving every column/PK/default/FK.
    service_visits is an FK PARENT (service_line_items), so the rebuild runs
    with ``foreign_keys=OFF`` inside an explicit transaction, then
    re-verifies with ``foreign_key_check`` before commit.

Idempotent — skips when no service_category CHECK is present. Forward-only.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

_CHECK_RE = re.compile(
    r"(?:CONSTRAINT\s+\w+\s+)?CHECK\s*\(\s*service_category\s+IN\s*\([^)]*\)\s*\)",
    re.IGNORECASE | re.DOTALL,
)


def _strip_check(ddl: str) -> str:
    out = _CHECK_RE.sub("", ddl)
    out = re.sub(r",\s*,", ",", out)
    out = re.sub(r",\s*\)", "\n)", out)
    return out


def _get_fallback_engine():
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()
    if not inspect(engine).has_table("service_visits"):
        return
    if engine.dialect.name == "postgresql":
        _upgrade_pg(engine)
    else:
        _upgrade_sqlite(engine)


def _upgrade_pg(engine):
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'service_visits'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%service_category%'
                """
            )
        ).fetchone()
        if row:
            conn.execute(text(f'ALTER TABLE service_visits DROP CONSTRAINT "{row[0]}"'))


def _upgrade_sqlite(engine):
    with engine.connect() as conn:
        ddl = conn.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='service_visits'"
        ).scalar()
        if not ddl or not _CHECK_RE.search(ddl):
            return  # no service_category CHECK present — fresh install or already dropped
        index_sqls = [
            r[0]
            for r in conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='index' "
                "AND tbl_name='service_visits' AND sql IS NOT NULL"
            ).fetchall()
        ]

    new_ddl = _strip_check(ddl)
    new_ddl = re.sub(
        r'CREATE\s+TABLE\s+"?service_visits"?',
        'CREATE TABLE "service_visits_new"',
        new_ddl,
        count=1,
        flags=re.IGNORECASE,
    )

    raw = engine.raw_connection()
    try:
        dbapi = raw.driver_connection  # underlying sqlite3.Connection
        prev_iso = dbapi.isolation_level
        dbapi.isolation_level = None  # autocommit — we drive the transaction explicitly
        cur = dbapi.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("BEGIN")
        try:
            cur.execute("DROP TABLE IF EXISTS service_visits_new")
            cur.execute(new_ddl)
            cur.execute("INSERT INTO service_visits_new SELECT * FROM service_visits")
            cur.execute("DROP TABLE service_visits")
            cur.execute("ALTER TABLE service_visits_new RENAME TO service_visits")
            for isql in index_sqls:
                cur.execute(isql)
            violations = cur.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError(f"FK violations after service_visits rebuild: {violations}")
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise
        finally:
            cur.execute("PRAGMA foreign_keys=ON")
            dbapi.isolation_level = prev_iso
    finally:
        raw.close()


def downgrade():
    print("Downgrade not supported: re-adding a CHECK would reject any new-category rows.")


if __name__ == "__main__":
    upgrade()
