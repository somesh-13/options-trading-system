"""One-shot migration: SQLite trades.db + JSON cache → Postgres + Mongo.

Usage (inside the portfolio-api container, with Postgres/Mongo reachable):

    python -m scripts.migrate_sqlite_to_stores \\
        --sqlite /legacy/trades.db \\
        --cache  /legacy/.cache

Or via the Makefile wrapper:

    make migrate

The script is idempotent — re-running skips rows already present.
Postgres tables receive bulk-INSERT with ON CONFLICT DO NOTHING; Mongo
collections receive upserts keyed on the natural primary key.

Tables migrated to Postgres (target schema in parens):
    trades                    → journal.trades
    agent_signals             → journal.agent_signals
    agent_memory              → journal.agent_memory
    signal_outcomes           → journal.signal_outcomes
    engine_log                → journal.engine_log
    robinhood_activity        → portfolio.robinhood_activity
    robinhood_live_snapshot   → portfolio.robinhood_live_snapshot
    analytics_report_run      → portfolio.analytics_report_run
    notifications             → portfolio.notifications
    ir_filing                 → ir.ir_filing

Collections migrated to Mongo:
    option_chain_snapshot     ← SQLite table (one doc per row)
    sec_facts                 ← .cache/sec/facts/{CIK}.json
    sec_statements            ← .cache/sec/statements/{TICKER}.json
    sec_filings_insights      ← .cache/sec/insights/{TICKER}.json
    sec_llm_extracts          ← .cache/sec/llm_extracts/*.json
    sec_contract_extracts     ← .cache/sec/contract_extracts/{TICKER}.json
    finra_short_interest      ← .cache/finra/{TICKER}.json
    sp500_universe            ← .cache/sec/universe/sp500.json
    sec_ticker_map            ← .cache/sec/company_tickers.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("migrate")


# ---------------------------------------------------------------------------
# Postgres targets
# ---------------------------------------------------------------------------

# (sqlite_table, target_pg_schema_table, primary_key, columns_in_order)
TABLE_MAP: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("trades", "journal.trades", "id", (
        "id", "order_id", "timestamp", "symbol", "asset_class", "side", "qty",
        "order_type", "limit_price", "filled_price", "filled_qty", "status",
        "signal_source", "signal_data", "related_trade_id", "realized_pnl",
        "notes", "created_at", "updated_at",
    )),
    ("agent_signals", "journal.agent_signals", "signal_id", (
        "signal_id", "ticker", "timestamp", "agent_id", "signal_type",
        "confidence", "iv_hv_ratio", "keltner_position", "regime",
        "recommended_strategy", "strike", "expiry", "premium",
        "confluence_score", "metadata", "created_at",
    )),
    ("agent_memory", "journal.agent_memory", "memory_id", (
        "memory_id", "agent_id", "ticker", "memory_type", "content",
        "timestamp", "quality_score", "signal_id",
    )),
    ("signal_outcomes", "journal.signal_outcomes", "outcome_id", (
        "outcome_id", "signal_id", "outcome_timestamp", "entry_price",
        "exit_price", "pnl", "pnl_pct", "outcome", "exit_reason",
    )),
    ("engine_log", "journal.engine_log", "id", (
        "id", "timestamp", "event_type", "ticker", "details", "trade_id",
    )),
    ("robinhood_activity", "portfolio.robinhood_activity", "row_hash", (
        "row_hash", "activity_date", "process_date", "settle_date", "instrument",
        "description", "trans_code", "quantity", "price", "amount",
        "source_file", "account", "ingested_at",
    )),
    ("robinhood_live_snapshot", "portfolio.robinhood_live_snapshot", "snapshot_id", (
        "snapshot_id", "fetched_at", "account", "payload_json", "stale", "error",
    )),
    ("analytics_report_run", "portfolio.analytics_report_run", "run_id", (
        "run_id", "created_at", "account", "ticker_count", "payload_json", "notes",
    )),
    ("notifications", "portfolio.notifications", "id", (
        "id", "ticker", "alert_type", "severity", "title", "body",
        "metadata", "created_at", "dismissed_at",
    )),
    ("ir_filing", "ir.ir_filing", "item_hash", (
        "item_hash", "ticker", "source", "item_type", "title", "publisher",
        "link", "published_at", "body_excerpt", "thesis", "confidence",
        "rationale", "classifier", "classified_at", "fetched_at", "raw_json",
    )),
]

# JSON columns we should let Postgres parse (the SQLite values are TEXT).
JSON_COLUMNS = {
    "signal_data", "metadata", "payload_json", "raw_json",
}


def _coerce_row(table: str, columns: tuple[str, ...], row: sqlite3.Row) -> tuple:
    """Map SQLite row into a tuple Postgres can ingest."""
    out: list[Any] = []
    for col in columns:
        val = row[col] if col in row.keys() else None
        if val is None:
            out.append(None)
            continue
        # SQLite booleans live as integers; Postgres column for `stale` is BOOLEAN.
        if table == "robinhood_live_snapshot" and col == "stale":
            out.append(bool(val))
            continue
        # JSON columns — leave as text so asyncpg lets the JSONB type cast it.
        if col in JSON_COLUMNS and isinstance(val, str):
            # Pass through; will be cast via ::jsonb in the INSERT.
            out.append(val)
            continue
        out.append(val)
    return tuple(out)


async def _migrate_pg(sqlite_path: Path, dsn: str) -> dict[str, int]:
    import asyncpg

    conn_sqlite = sqlite3.connect(str(sqlite_path))
    conn_sqlite.row_factory = sqlite3.Row

    log.info("Connecting to Postgres: %s", _dsn_redacted(dsn))
    pg = await asyncpg.connect(dsn=_to_asyncpg_dsn(dsn))
    counts: dict[str, int] = {}
    try:
        for src, dst, pk, cols in TABLE_MAP:
            try:
                rows = list(conn_sqlite.execute(f"SELECT * FROM {src}"))
            except sqlite3.OperationalError as exc:
                log.warning("SQLite table %s missing, skipping (%s)", src, exc)
                counts[dst] = 0
                continue

            if not rows:
                log.info("%s: 0 rows, skipping", src)
                counts[dst] = 0
                continue

            payload = [_coerce_row(src, cols, r) for r in rows]
            placeholders = ", ".join(
                (f"${i+1}::jsonb" if col in JSON_COLUMNS else f"${i+1}")
                for i, col in enumerate(cols)
            )
            stmt = (
                f"INSERT INTO {dst} ({', '.join(cols)}) "
                f"VALUES ({placeholders}) "
                f"ON CONFLICT ({pk}) DO NOTHING"
            )
            inserted = 0
            async with pg.transaction():
                for row in payload:
                    res = await pg.execute(stmt, *row)
                    # asyncpg returns "INSERT 0 1" / "INSERT 0 0" depending on conflict
                    if res.endswith(" 1"):
                        inserted += 1
            counts[dst] = inserted
            log.info("%s → %s: %d inserted (out of %d source rows)", src, dst, inserted, len(rows))
    finally:
        await pg.close()
        conn_sqlite.close()
    return counts


# ---------------------------------------------------------------------------
# Mongo targets
# ---------------------------------------------------------------------------

async def _migrate_option_chain(sqlite_path: Path, mongo_uri: str) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient
    from pymongo import UpdateOne

    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = list(conn.execute("SELECT * FROM option_chain_snapshot"))
    except sqlite3.OperationalError as exc:
        log.warning("option_chain_snapshot missing, skipping (%s)", exc)
        return 0
    finally:
        conn.close()

    if not rows:
        return 0

    client = AsyncIOMotorClient(mongo_uri)
    coll = client["vegaedge"]["option_chain_snapshot"]
    ops = [
        UpdateOne(
            {
                "ticker": r["ticker"],
                "snapshot_at": r["snapshot_at"],
                "expiration": r["expiration"],
                "strike": r["strike"],
                "side": r["side"],
            },
            {"$set": {k: r[k] for k in r.keys()}},
            upsert=True,
        )
        for r in rows
    ]
    res = await coll.bulk_write(ops, ordered=False)
    client.close()
    return res.upserted_count + res.modified_count


async def _migrate_json_cache(cache_root: Path, mongo_uri: str) -> dict[str, int]:
    from motor.motor_asyncio import AsyncIOMotorClient

    if not cache_root.exists():
        log.info("Cache dir %s missing, skipping JSON cache migration", cache_root)
        return {}

    cache_map = [
        ("sec_facts",             cache_root / "sec/facts",             "*.json", "cik"),
        ("sec_statements",        cache_root / "sec/statements",        "*.json", "ticker"),
        ("sec_filings_insights",  cache_root / "sec/insights",          "*.json", "ticker"),
        ("sec_llm_extracts",      cache_root / "sec/llm_extracts",      "*.json", "accession_id"),
        ("sec_contract_extracts", cache_root / "sec/contract_extracts", "*.json", "ticker"),
        ("finra_short_interest",  cache_root / "finra",                 "*.json", "ticker"),
    ]
    single_docs = [
        ("sec_ticker_map",  cache_root / "sec/company_tickers.json"),
        ("sp500_universe",  cache_root / "sec/universe/sp500.json"),
    ]

    client = AsyncIOMotorClient(mongo_uri)
    db = client["vegaedge"]
    counts: dict[str, int] = {}
    try:
        for coll_name, dir_path, pattern, key_field in cache_map:
            if not dir_path.exists():
                counts[coll_name] = 0
                continue
            n = 0
            coll = db[coll_name]
            for path in dir_path.glob(pattern):
                try:
                    doc = json.loads(path.read_text())
                except (json.JSONDecodeError, OSError) as exc:
                    log.warning("skipped %s: %s", path, exc)
                    continue
                if not isinstance(doc, dict):
                    doc = {"value": doc}
                # Derive key from filename if not present in the doc.
                key_val = doc.get(key_field) or path.stem
                doc.setdefault(key_field, key_val)
                doc["_source_path"] = str(path)
                await coll.update_one({key_field: key_val}, {"$set": doc}, upsert=True)
                n += 1
            counts[coll_name] = n
            log.info("%s: %d docs imported from %s", coll_name, n, dir_path)

        for coll_name, path in single_docs:
            if not path.exists():
                counts[coll_name] = 0
                continue
            try:
                doc = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError) as exc:
                log.warning("skipped %s: %s", path, exc)
                counts[coll_name] = 0
                continue
            wrap = {"name": coll_name, "_source_path": str(path), "data": doc}
            await db[coll_name].update_one({"name": coll_name}, {"$set": wrap}, upsert=True)
            counts[coll_name] = 1
            log.info("%s: 1 doc imported from %s", coll_name, path)
    finally:
        client.close()
    return counts


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dsn_redacted(dsn: str) -> str:
    if "@" not in dsn:
        return dsn
    head, tail = dsn.split("@", 1)
    if "//" in head and ":" in head.split("//", 1)[1]:
        scheme_user = head.split(":")[0:-1]
        return ":".join(scheme_user) + ":***@" + tail
    return dsn


def _to_asyncpg_dsn(dsn: str) -> str:
    """Convert ``postgresql+asyncpg://...`` (SQLAlchemy form) to pure asyncpg form."""
    return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", default="/app/trades.db", help="Path to SQLite trades.db")
    parser.add_argument("--cache",  default="/app/.cache",   help="Path to JSON cache root")
    parser.add_argument("--pg-dsn", default=os.getenv("WORKER_PG_DSN") or os.getenv("DATABASE_URL"),
                        help="Postgres DSN (defaults to WORKER_PG_DSN)")
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI"),
                        help="Mongo URI (defaults to MONGO_URI)")
    parser.add_argument("--skip-pg",    action="store_true", help="Skip Postgres migration")
    parser.add_argument("--skip-mongo", action="store_true", help="Skip Mongo migration")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    sqlite_path = Path(args.sqlite)
    cache_root = Path(args.cache)

    if not sqlite_path.exists():
        log.error("SQLite file not found: %s", sqlite_path)
        return 2

    pg_counts: dict[str, int] = {}
    mongo_counts: dict[str, int] = {}

    if not args.skip_pg:
        if not args.pg_dsn:
            log.error("No Postgres DSN provided (pass --pg-dsn or set WORKER_PG_DSN)")
            return 2
        pg_counts = await _migrate_pg(sqlite_path, args.pg_dsn)

    if not args.skip_mongo:
        if not args.mongo_uri:
            log.error("No Mongo URI provided (pass --mongo-uri or set MONGO_URI)")
            return 2
        oc = await _migrate_option_chain(sqlite_path, args.mongo_uri)
        mongo_counts = {"option_chain_snapshot": oc}
        mongo_counts.update(await _migrate_json_cache(cache_root, args.mongo_uri))

    log.info("=== Migration summary ===")
    for tbl, n in pg_counts.items():
        log.info("  pg  %-40s %d", tbl, n)
    for coll, n in mongo_counts.items():
        log.info("  mg  %-40s %d", coll, n)

    failed = any(v < 0 for v in [*pg_counts.values(), *mongo_counts.values()])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
