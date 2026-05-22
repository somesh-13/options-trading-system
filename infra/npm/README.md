# Nginx Proxy Manager — VegaEdge Setup

NPM is the only thing the host exposes. It sits in front of the frontend and
the 5 backend services, routing by URL path. A failed backend service shows
up as a `502` on its prefix but never takes down the others.

## First-time bring-up

1. `just up` (or `docker compose up -d`)
2. Visit **http://localhost:81**
3. Log in with the default creds:
   - Email: `admin@example.com`
   - Password: `changeme`
4. NPM forces a password change on first login. Use anything; this is local-only.

## Create the proxy hosts

Add **one** proxy host that listens on `localhost` (or `*`) and uses NPM's
"Custom locations" feature to route by path. The default location is the
catch-all for the frontend.

### Proxy Host → Details tab

| Field | Value |
|---|---|
| Domain Names | `localhost` (or `*` to accept any Host header) |
| Scheme | `http` |
| Forward Hostname / IP | `frontend` |
| Forward Port | `8080` |
| Block Common Exploits | ✅ |
| Websockets Support | ✅ (needed for `/ws/*`) |

### Proxy Host → Custom locations tab

Click **Add location** five times. Each gets a `location` path, a custom
nginx config for path rewriting, and an upstream:

| Define location | Scheme | Forward Hostname / IP | Forward Port |
|---|---|---|---|
| `/api/pricing/`     | http | `pricing-api`   | 8080 |
| `/api/mispricing/`  | http | `pricing-api`   | 8080 |
| `/api/backtest/`    | http | `pricing-api`   | 8080 |
| `/api/replay/`      | http | `pricing-api`   | 8080 |
| `/api/risk/`        | http | `pricing-api`   | 8080 |
| `/api/hedge/`       | http | `pricing-api`   | 8080 |
| `/api/strategy/`    | http | `pricing-api`   | 8080 |
| `/api/market/`      | http | `data-api`      | 8080 |
| `/api/sec/`         | http | `data-api`      | 8080 |
| `/api/etf/`         | http | `data-api`      | 8080 |
| `/api/ir/`          | http | `data-api`      | 8080 |
| `/api/macro-news/`  | http | `data-api`      | 8080 |
| `/api/sentiment/`   | http | `data-api`      | 8080 |
| `/api/scanner/`     | http | `data-api`      | 8080 |
| `/api/flow/`        | http | `data-api`      | 8080 |
| `/api/robinhood/`   | http | `portfolio-api` | 8080 |
| `/api/auth/`        | http | `portfolio-api` | 8080 |
| `/api/notifications/` | http | `portfolio-api` | 8080 |
| `/api/analytics/`   | http | `portfolio-api` | 8080 |
| `/api/execution/`   | http | `portfolio-api` | 8080 |
| `/api/portfolio/`   | http | `portfolio-api` | 8080 |
| `/api/journal/`     | http | `portfolio-api` | 8080 |
| `/api/engine/`      | http | `portfolio-api` | 8080 |
| `/ws/`              | http | `portfolio-api` | 8080 |
| `/api/agents/`      | http | `llm-api`       | 8080 |
| `/api/regime/`      | http | `llm-api`       | 8080 |
| `/api/signals/`     | http | `llm-api`       | 8080 |

For each, click the **gear icon** on the location row and paste:

```nginx
proxy_pass_request_headers on;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

5. Save.

## Verify

From the host:

```bash
curl -s http://localhost/api/pricing/health | jq .
curl -s http://localhost/api/market/health  | jq .
curl -s http://localhost/api/robinhood/health | jq .
curl -s http://localhost/api/agents/health | jq .
# Each returns: {"service": "...", "postgres": "ok", "redis": "ok", "mongo": "ok"}

curl -I http://localhost/                  # frontend (Next.js)
```

## Failure isolation drill

```bash
docker compose stop data-api
curl -s http://localhost/api/pricing/health    # still 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/market/HOOD/price  # 502
docker compose start data-api
```

## Access log

NPM access logs are bind-mounted to `infra/npm/logs/`. Each request line
records the upstream — so to see who answered a request, grep that:

```bash
tail -f infra/npm/logs/proxy-host-1_access.log
```

## TLS (later)

When you're ready for a real domain + Let's Encrypt, point DNS at the host,
add the domain to the proxy host, and use NPM's "SSL" tab to request a cert.
Nothing in the app stack needs to change.
