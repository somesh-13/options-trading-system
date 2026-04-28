#!/usr/bin/env python3
"""Ingest all Robinhood activity CSVs under `hood reports/` into sqlite.

Idempotent — rows are keyed by sha1 hash of their content fields. Re-running
against the same files inserts zero new rows.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, Iterable

HERE = Path(__file__).resolve().parent
BACKEND_SRC = HERE.parent / "src"
sys.path.insert(0, str(BACKEND_SRC))

from robinhood.database import ensure_schema, get_conn  # noqa: E402
from robinhood.parser import ActivityRow, iter_activity_rows  # noqa: E402

APP_ROOT = HERE.parent.parent
REPORTS_DIR = APP_ROOT / "hood reports"

# Trans codes that only appear on a margin-enabled taxable brokerage account.
# If any row in a file carries one of these codes the whole file is classified
# as `brokerage`; otherwise the file is assumed to be a Robinhood Roth IRA
# (IRAs don't support margin, ACH transfers, or Gold subscriptions).
_BROKERAGE_MARKERS = {"MTM", "GOLD", "GDBP", "FUTSWP", "GMPC", "ACH"}


def _classify_account(rows: Iterable[ActivityRow]) -> str:
    """Return 'brokerage' or 'roth_ira' for a set of parsed rows."""
    for r in rows:
        if r.trans_code in _BROKERAGE_MARKERS:
            return "brokerage"
    return "roth_ira"


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


def _backfill_accounts(file_to_account: Dict[str, str]) -> int:
    """Backfill `account` for rows inserted before the column existed."""
    conn = get_conn()
    updated = 0
    for source, account in file_to_account.items():
        cur = conn.execute(
            "UPDATE robinhood_activity SET account = ? WHERE source_file = ? AND (account IS NULL OR account = '')",
            (account, source),
        )
        updated += cur.rowcount
    conn.commit()
    return updated


def ingest(reports_dir: Path = REPORTS_DIR) -> Dict[str, int]:
    """Ingest all CSVs in `reports_dir`. Returns counters."""
    ensure_schema()
    existing = _existing_hashes()

    csv_paths = sorted(
        p for p in reports_dir.glob("*.csv")
        if not p.name.startswith("._")  # skip macOS metadata
    )

    # First pass — parse + classify each file.
    file_to_account: Dict[str, str] = {}
    file_rows: Dict[str, list] = {}
    total_rows = 0
    for path in csv_paths:
        parsed = list(iter_activity_rows(path))
        file_rows[path.name] = parsed
        file_to_account[path.name] = _classify_account(parsed)
        total_rows += len(parsed)

    # Second pass — insert new rows with the account tag.
    new_pairs: list = []
    for name, parsed in file_rows.items():
        account = file_to_account[name]
        for row in parsed:
            if row.row_hash in existing:
                continue
            new_pairs.append((row, account))
            existing.add(row.row_hash)
    inserted = _insert_rows(new_pairs)

    backfilled = _backfill_accounts(file_to_account)

    return {
        "files_read": len(csv_paths),
        "total_rows": total_rows,
        "inserted": inserted,
        "skipped": total_rows - inserted,
        "backfilled": backfilled,
        "accounts": file_to_account,
    }


if __name__ == "__main__":
    import json
    result = ingest()
    print(json.dumps(result, indent=2))
