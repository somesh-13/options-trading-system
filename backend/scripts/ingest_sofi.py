#!/usr/bin/env python3
"""Ingest SoFi Invest activity CSVs under `sofi reports/` into sqlite.

Mirrors `ingest_robinhood.py` but tags every row with `account='sofi'`. Rows
are stored in the same `robinhood_activity` table — that table is now
multi-broker (the name is legacy).

Idempotent: rows are keyed by SHA-1 of their content fields, so re-running
inserts zero new rows.

⚠ The parser (`sofi_parser.iter_sofi_rows`) is not yet implemented — drop a
SoFi statement CSV in `sofi reports/` and we'll finalise the column mapping
based on the real header row.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, Iterable

HERE = Path(__file__).resolve().parent
BACKEND_SRC = HERE.parent / "src"
sys.path.insert(0, str(BACKEND_SRC))

from robinhood.database import ensure_schema, get_conn  # noqa: E402

APP_ROOT = HERE.parent.parent
REPORTS_DIR = APP_ROOT / "sofi reports"

SOFI_ACCOUNT = "sofi"


def _existing_hashes() -> set:
    cur = get_conn().execute("SELECT row_hash FROM robinhood_activity")
    return {r[0] for r in cur.fetchall()}


def _insert_rows(rows: Iterable[tuple]) -> int:
    """`rows` is pre-materialised (ActivityRow, account) tuples."""
    conn = get_conn()
    payload = [
        (
            r.row_hash, r.activity_date, r.process_date, r.settle_date,
            r.instrument, r.description, r.trans_code,
            r.quantity, r.price, r.amount, r.source_file, account,
        )
        for r, account in rows
    ]
    if not payload:
        return 0
    cur = conn.executemany(
        """
        INSERT OR IGNORE INTO robinhood_activity
          (row_hash, activity_date, process_date, settle_date, instrument,
           description, trans_code, quantity, price, amount, source_file, account)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        payload,
    )
    conn.commit()
    return cur.rowcount


def ingest(reports_dir: Path = REPORTS_DIR) -> Dict[str, int]:
    """Ingest all CSVs in `reports_dir`. Returns counters."""
    ensure_schema()

    if not reports_dir.exists():
        return {
            "files_read": 0, "total_rows": 0,
            "inserted": 0, "skipped": 0, "parser_ready": False,
        }

    csv_paths = sorted(
        p for p in reports_dir.glob("*.csv")
        if not p.name.startswith("._")  # skip macOS metadata
    )

    try:
        from robinhood.sofi_parser import iter_sofi_rows  # type: ignore
    except ImportError:
        # Parser stub not yet implemented — return file count without inserting.
        return {
            "files_read": len(csv_paths),
            "total_rows": 0,
            "inserted": 0,
            "skipped": 0,
            "parser_ready": False,
            "note": "sofi_parser not implemented — drop a sample CSV and the parser will be finalised",
        }

    existing = _existing_hashes()
    new_pairs: list = []
    total_rows = 0
    for path in csv_paths:
        for row in iter_sofi_rows(path):
            total_rows += 1
            if row.row_hash in existing:
                continue
            new_pairs.append((row, SOFI_ACCOUNT))
            existing.add(row.row_hash)

    inserted = _insert_rows(new_pairs)
    return {
        "files_read": len(csv_paths),
        "total_rows": total_rows,
        "inserted": inserted,
        "skipped": total_rows - inserted,
        "parser_ready": True,
    }


if __name__ == "__main__":
    import json
    result = ingest()
    print(json.dumps(result, indent=2))
