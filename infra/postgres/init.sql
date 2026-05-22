-- VegaEdge Postgres bootstrap
-- Runs once at first container startup via /docker-entrypoint-initdb.d/.
-- Mirrors the SQLite schema in backend/trades.db at cutover time.

\connect vegaedge

-- ---------------------------------------------------------------------------
-- Schemas (one per logical owner — keeps grants tidy)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS journal;
CREATE SCHEMA IF NOT EXISTS portfolio;
CREATE SCHEMA IF NOT EXISTS ir;

-- ---------------------------------------------------------------------------
-- Roles (least-privilege per service)
-- Passwords are sourced from env (see infra/postgres/roles.sql.template).
-- For local-only HTTP bring-up we just create the roles; passwords are set
-- by the entrypoint script using POSTGRES_* env vars.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pricing_ro')   THEN CREATE ROLE pricing_ro   LOGIN PASSWORD 'pricing_ro_pw';   END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_rw')      THEN CREATE ROLE data_rw      LOGIN PASSWORD 'data_rw_pw';      END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_rw') THEN CREATE ROLE portfolio_rw LOGIN PASSWORD 'portfolio_rw_pw'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'llm_ro')       THEN CREATE ROLE llm_ro       LOGIN PASSWORD 'llm_ro_pw';       END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw')    THEN CREATE ROLE worker_rw    LOGIN PASSWORD 'worker_rw_pw';    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- journal.* — trade journal, agent signals, outcomes, engine log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal.trades (
    id              BIGSERIAL PRIMARY KEY,
    order_id        TEXT,
    timestamp       TIMESTAMPTZ NOT NULL,
    symbol          TEXT NOT NULL,
    asset_class     TEXT NOT NULL DEFAULT 'option',
    side            TEXT NOT NULL,
    qty             INTEGER NOT NULL,
    order_type      TEXT NOT NULL DEFAULT 'limit',
    limit_price     DOUBLE PRECISION,
    filled_price    DOUBLE PRECISION,
    filled_qty      INTEGER DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'submitted',
    signal_source   TEXT NOT NULL DEFAULT 'manual',
    signal_data     JSONB,
    related_trade_id BIGINT REFERENCES journal.trades(id),
    realized_pnl    DOUBLE PRECISION,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol        ON journal.trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp     ON journal.trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status        ON journal.trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_signal_source ON journal.trades(signal_source);

CREATE TABLE IF NOT EXISTS journal.agent_signals (
    signal_id            TEXT PRIMARY KEY,
    ticker               TEXT NOT NULL,
    timestamp            TIMESTAMPTZ NOT NULL,
    agent_id             TEXT NOT NULL,
    signal_type          TEXT NOT NULL,
    confidence           DOUBLE PRECISION NOT NULL,
    iv_hv_ratio          DOUBLE PRECISION,
    keltner_position     TEXT,
    regime               TEXT,
    recommended_strategy TEXT,
    strike               DOUBLE PRECISION,
    expiry               DATE,
    premium              DOUBLE PRECISION,
    confluence_score     DOUBLE PRECISION NOT NULL,
    metadata             JSONB,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_signals_ticker_ts   ON journal.agent_signals(ticker, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_signals_confluence  ON journal.agent_signals(confluence_score DESC);

CREATE TABLE IF NOT EXISTS journal.agent_memory (
    memory_id     BIGSERIAL PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    ticker        TEXT NOT NULL,
    memory_type   TEXT NOT NULL CHECK (memory_type IN ('SIGNAL','REGIME','EARNINGS_OUTCOME','IV_PERCENTILE')),
    content       TEXT NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL,
    quality_score DOUBLE PRECISION DEFAULT 0.5,
    signal_id     TEXT REFERENCES journal.agent_signals(signal_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_agent_ticker_ts ON journal.agent_memory(agent_id, ticker, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memory_signal_id       ON journal.agent_memory(signal_id);

CREATE TABLE IF NOT EXISTS journal.signal_outcomes (
    outcome_id        BIGSERIAL PRIMARY KEY,
    signal_id         TEXT NOT NULL REFERENCES journal.agent_signals(signal_id),
    outcome_timestamp TIMESTAMPTZ NOT NULL,
    entry_price       DOUBLE PRECISION NOT NULL,
    exit_price        DOUBLE PRECISION,
    pnl               DOUBLE PRECISION,
    pnl_pct           DOUBLE PRECISION,
    outcome           TEXT CHECK (outcome IN ('WIN','LOSS','OPEN','EXPIRED')),
    exit_reason       TEXT CHECK (exit_reason IN ('EXPIRY','STOP_LOSS','TAKE_PROFIT','MANUAL'))
);
CREATE INDEX IF NOT EXISTS idx_outcomes_signal_id ON journal.signal_outcomes(signal_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome   ON journal.signal_outcomes(outcome);

CREATE TABLE IF NOT EXISTS journal.engine_log (
    id          BIGSERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ NOT NULL,
    event_type  TEXT NOT NULL,
    ticker      TEXT,
    details     TEXT,
    trade_id    BIGINT REFERENCES journal.trades(id)
);
CREATE INDEX IF NOT EXISTS idx_engine_log_timestamp  ON journal.engine_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_engine_log_event_type ON journal.engine_log(event_type);

-- ---------------------------------------------------------------------------
-- portfolio.* — brokerage holdings, notifications, analytics snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio.robinhood_activity (
    row_hash      TEXT PRIMARY KEY,
    activity_date DATE NOT NULL,
    process_date  DATE,
    settle_date   DATE,
    instrument    TEXT,
    description   TEXT,
    trans_code    TEXT NOT NULL,
    quantity      DOUBLE PRECISION,
    price         DOUBLE PRECISION,
    amount        DOUBLE PRECISION,
    source_file   TEXT,
    account       TEXT,
    ingested_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rh_activity_date ON portfolio.robinhood_activity(activity_date);
CREATE INDEX IF NOT EXISTS idx_rh_instrument    ON portfolio.robinhood_activity(instrument);
CREATE INDEX IF NOT EXISTS idx_rh_trans_code    ON portfolio.robinhood_activity(trans_code);
CREATE INDEX IF NOT EXISTS idx_rh_account       ON portfolio.robinhood_activity(account);

CREATE TABLE IF NOT EXISTS portfolio.robinhood_live_snapshot (
    snapshot_id  BIGSERIAL PRIMARY KEY,
    fetched_at   TIMESTAMPTZ NOT NULL,
    account      TEXT,
    payload_json JSONB NOT NULL,
    stale        BOOLEAN DEFAULT FALSE,
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rh_snap_fetched ON portfolio.robinhood_live_snapshot(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_rh_snap_account ON portfolio.robinhood_live_snapshot(account);

CREATE TABLE IF NOT EXISTS portfolio.analytics_report_run (
    run_id       BIGSERIAL PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL,
    account      TEXT,
    ticker_count INTEGER,
    payload_json JSONB NOT NULL,
    notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_run_created ON portfolio.analytics_report_run(created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio.notifications (
    id           BIGSERIAL PRIMARY KEY,
    ticker       TEXT NOT NULL,
    alert_type   TEXT NOT NULL,
    severity     TEXT NOT NULL DEFAULT 'info',
    title        TEXT NOT NULL,
    body         TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dismissed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_active ON portfolio.notifications(dismissed_at, ticker, alert_type);

-- ---------------------------------------------------------------------------
-- ir.* — investor-relations scrapes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ir.ir_filing (
    item_hash      TEXT PRIMARY KEY,
    ticker         TEXT NOT NULL,
    source         TEXT NOT NULL,
    item_type      TEXT,
    title          TEXT NOT NULL,
    publisher      TEXT,
    link           TEXT,
    published_at   TIMESTAMPTZ,
    body_excerpt   TEXT,
    thesis         TEXT,
    confidence     DOUBLE PRECISION,
    rationale      TEXT,
    classifier     TEXT,
    classified_at  TIMESTAMPTZ,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_json       JSONB
);
CREATE INDEX IF NOT EXISTS idx_ir_ticker_published ON ir.ir_filing(ticker, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ir_thesis           ON ir.ir_filing(thesis);
CREATE INDEX IF NOT EXISTS idx_ir_fetched          ON ir.ir_filing(fetched_at DESC);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- pricing_ro: read-only across all schemas (for vol-surface joins, backtest history)
GRANT USAGE ON SCHEMA journal, portfolio, ir TO pricing_ro, llm_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA journal, portfolio, ir TO pricing_ro, llm_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA journal, portfolio, ir GRANT SELECT ON TABLES TO pricing_ro, llm_ro;

-- data_rw: full rights on ir.*
GRANT USAGE, CREATE ON SCHEMA ir TO data_rw;
GRANT ALL ON ALL TABLES IN SCHEMA ir TO data_rw;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ir TO data_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA ir GRANT ALL ON TABLES TO data_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA ir GRANT ALL ON SEQUENCES TO data_rw;
-- read on journal so it can resolve cross-references
GRANT USAGE ON SCHEMA journal TO data_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA journal TO data_rw;

-- portfolio_rw: full rights on portfolio.* + write on journal.trades
GRANT USAGE, CREATE ON SCHEMA portfolio TO portfolio_rw;
GRANT ALL ON ALL TABLES IN SCHEMA portfolio TO portfolio_rw;
GRANT ALL ON ALL SEQUENCES IN SCHEMA portfolio TO portfolio_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA portfolio GRANT ALL ON TABLES TO portfolio_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA portfolio GRANT ALL ON SEQUENCES TO portfolio_rw;
GRANT USAGE ON SCHEMA journal TO portfolio_rw;
GRANT SELECT, INSERT, UPDATE ON journal.trades, journal.engine_log TO portfolio_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA journal TO portfolio_rw;

-- worker_rw: full rights everywhere (scheduler writes outcomes, signals, logs)
GRANT USAGE, CREATE ON SCHEMA journal, portfolio, ir TO worker_rw;
GRANT ALL ON ALL TABLES IN SCHEMA journal, portfolio, ir TO worker_rw;
GRANT ALL ON ALL SEQUENCES IN SCHEMA journal, portfolio, ir TO worker_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA journal GRANT ALL ON TABLES TO worker_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA portfolio GRANT ALL ON TABLES TO worker_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA ir GRANT ALL ON TABLES TO worker_rw;
