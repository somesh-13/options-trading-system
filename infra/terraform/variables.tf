variable "postgres_user" {
  type    = string
  default = "trading"
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "postgres_db" {
  type    = string
  default = "trading"
}

variable "alpaca_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "alpaca_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "alpaca_base_url" {
  type    = string
  default = "https://paper-api.alpaca.markets/v2"
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
