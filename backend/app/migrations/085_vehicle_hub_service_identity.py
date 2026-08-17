"""Add source identity to service visits mirrored through Vehicle Hub.

The nullable fields preserve upstream MyGarage behavior for every ordinary
service visit. A unique source/id pair makes reviewed transfers idempotent and
lets the UI keep source-owned mirrors read-only. FATAL because the model maps
these columns after this release.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

FATAL = True


def _get_fallback_engine():
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()
    inspector = inspect(engine)
    if not inspector.has_table("service_visits"):
        print("  → service_visits table absent, skipping Vehicle Hub identity")
        return
    columns = {column["name"] for column in inspector.get_columns("service_visits")}
    timestamp_type = "TIMESTAMP" if engine.dialect.name == "postgresql" else "DATETIME"
    additions = {
        "external_source": "VARCHAR(32)",
        "external_id": "VARCHAR(200)",
        "external_updated_at": timestamp_type,
        "external_fingerprint": "VARCHAR(64)",
    }
    with engine.begin() as connection:
        for name, data_type in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE service_visits ADD COLUMN {name} {data_type}"))
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_service_visits_external_identity "
                "ON service_visits(external_source, external_id)"
            )
        )
    print("  ✓ Added Vehicle Hub service-visit identity")


def downgrade():
    print("Downgrade not supported for Vehicle Hub identity columns")


if __name__ == "__main__":
    upgrade()
