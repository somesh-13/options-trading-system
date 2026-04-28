terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "docker" {
  host = "unix:///var/run/docker.sock"
}

locals {
  project_root = abspath("${path.module}/../..")
  backend_root = abspath("${path.module}/../../backend")
}

resource "docker_network" "app" {
  name = "trading-net"
}

resource "docker_volume" "pgdata" {
  name = "trading-pgdata"
}

resource "docker_image" "postgres" {
  name         = "postgres:16-alpine"
  keep_locally = true
}

resource "docker_image" "backend" {
  name = "trading-backend:local"

  build {
    context    = local.backend_root
    dockerfile = "Dockerfile"
  }

  triggers = {
    dir_sha1 = sha1(join("", [for f in fileset(local.backend_root, "src/**") : filesha1("${local.backend_root}/${f}")]))
  }
}

resource "docker_image" "frontend" {
  name = "trading-frontend:local"

  build {
    context    = local.project_root
    dockerfile = "Dockerfile"
    build_args = {
      NEXT_PUBLIC_PRICING_API_URL = "http://localhost:8000"
    }
  }

  triggers = {
    package_sha1 = filesha1("${local.project_root}/package.json")
  }
}

resource "docker_container" "db" {
  name  = "trading-db"
  image = docker_image.postgres.image_id

  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=${var.postgres_user}",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=${var.postgres_db}",
  ]

  ports {
    internal = 5432
    external = 5432
  }

  volumes {
    volume_name    = docker_volume.pgdata.name
    container_path = "/var/lib/postgresql/data"
  }

  networks_advanced {
    name = docker_network.app.name
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U ${var.postgres_user} -d ${var.postgres_db}"]
    interval = "10s"
    timeout  = "5s"
    retries  = 5
  }
}

resource "docker_container" "backend" {
  name  = "trading-backend"
  image = docker_image.backend.image_id

  restart = "unless-stopped"

  env = [
    "DATABASE_URL=postgresql://${var.postgres_user}:${var.postgres_password}@trading-db:5432/${var.postgres_db}",
    "ALPACA_API_KEY=${var.alpaca_api_key}",
    "ALPACA_SECRET_KEY=${var.alpaca_secret_key}",
    "ALPACA_BASE_URL=${var.alpaca_base_url}",
    "GEMINI_API_KEY=${var.gemini_api_key}",
    "GOOGLE_API_KEY=${var.gemini_api_key}",
  ]

  ports {
    internal = 8080
    external = 8000
  }

  networks_advanced {
    name = docker_network.app.name
  }

  depends_on = [docker_container.db]
}

resource "docker_container" "frontend" {
  name  = "trading-frontend"
  image = docker_image.frontend.image_id

  restart = "unless-stopped"

  env = [
    "NEXT_PUBLIC_PRICING_API_URL=http://localhost:8000",
    "ALPACA_API_KEY=${var.alpaca_api_key}",
    "ALPACA_SECRET_KEY=${var.alpaca_secret_key}",
    "ALPACA_BASE_URL=${var.alpaca_base_url}",
  ]

  ports {
    internal = 8080
    external = 3000
  }

  networks_advanced {
    name = docker_network.app.name
  }

  depends_on = [docker_container.backend]
}
