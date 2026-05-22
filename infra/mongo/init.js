// VegaEdge Mongo bootstrap — runs once at first container start
// (placed in /docker-entrypoint-initdb.d/, executed by mongo:7 entrypoint).
//
// Creates the collections we expect and adds indexes so queries from
// data-api / llm-api don't full-scan.

db = db.getSiblingDB("vegaedge");

// ---------------------------------------------------------------------------
// option_chain_snapshot — replaces SQLite option_chain_snapshot
// ---------------------------------------------------------------------------
db.createCollection("option_chain_snapshot", { capped: false });
db.option_chain_snapshot.createIndex({ ticker: 1, snapshot_at: -1 });
db.option_chain_snapshot.createIndex({ ticker: 1, expiration: 1, strike: 1, side: 1, snapshot_at: -1 });

// ---------------------------------------------------------------------------
// SEC EDGAR-derived caches (replace backend/.cache/sec/*)
// ---------------------------------------------------------------------------
db.createCollection("sec_facts");
db.sec_facts.createIndex({ cik: 1 }, { unique: true });

db.createCollection("sec_statements");
db.sec_statements.createIndex({ ticker: 1 }, { unique: true });

db.createCollection("sec_filings_insights");
db.sec_filings_insights.createIndex({ ticker: 1 }, { unique: true });

db.createCollection("sec_llm_extracts");
db.sec_llm_extracts.createIndex({ accession_id: 1 }, { unique: true });

db.createCollection("sec_contract_extracts");
db.sec_contract_extracts.createIndex({ ticker: 1 }, { unique: true });

db.createCollection("sec_ticker_map");        // single doc, keyed by name
db.createCollection("sp500_universe");        // single doc

// ---------------------------------------------------------------------------
// FINRA short-interest snapshots (replace backend/.cache/finra/*)
// ---------------------------------------------------------------------------
db.createCollection("finra_short_interest");
db.finra_short_interest.createIndex({ ticker: 1, settlement_date: -1 });

print("vegaedge Mongo collections + indexes initialized");
