# Infrastructure

Brings up the trading dashboard stack (Next.js frontend + FastAPI backend + PostgreSQL) on the local Docker daemon.

## Layout

```
infra/
├── terraform/   # kreuzwerker/docker — builds images, creates network/volume, runs containers
└── ansible/     # installs Docker + Terraform on the host, then runs terraform apply
```

## Port map

| Service   | Host port | Container port |
|-----------|-----------|----------------|
| frontend  | 3000      | 8080           |
| backend   | 8000      | 8080           |
| postgres  | 5432      | 5432           |

## Path A — Ansible-driven (recommended)

```bash
cd infra/ansible

# One-time: install required collections
ansible-galaxy collection install -r requirements.yml

# Secrets are passed in via env vars (never committed)
export POSTGRES_PASSWORD='change-me'
export ALPACA_API_KEY='...'
export ALPACA_SECRET_KEY='...'
export GEMINI_API_KEY='...'

# Ask for sudo on the host-prep play; Terraform play runs unprivileged
ansible-playbook -i inventory.ini playbook.yml --ask-become-pass
```

Re-running is idempotent: Ansible skips installed packages and Terraform reconciles only drifted resources.

## Path B — Terraform only (host already has Docker)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars to fill in postgres_password + API keys
terraform init
terraform apply
```

## Verifying the stack

```bash
docker ps                                   # 3 containers: trading-frontend/backend/db
curl -fsS http://localhost:8000/health      # FastAPI health endpoint
curl -fsS http://localhost:3000 | head      # Next.js HTML
docker exec trading-db pg_isready -U trading
```

## Tearing down

```bash
cd infra/terraform
terraform destroy
```

This removes the three containers, the `trading-net` bridge, and the `trading-pgdata` volume.

## Notes

- The app currently reads/writes SQLite (`backend/trades.db`). The PostgreSQL container is provisioned and exposed via `DATABASE_URL` but the backend code has not yet been migrated to use it.
- `terraform.tfvars` is gitignored. Commit `terraform.tfvars.example` only.
- Rebuilding an image: `terraform apply -replace=docker_image.backend` (or `.frontend`).
