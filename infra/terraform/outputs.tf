output "frontend_url" {
  value = "http://localhost:3000"
}

output "backend_url" {
  value = "http://localhost:8000"
}

output "postgres_dsn" {
  value     = "postgresql://${var.postgres_user}:${var.postgres_password}@localhost:5432/${var.postgres_db}"
  sensitive = true
}
