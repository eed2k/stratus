#!/usr/bin/env bash
#
# One-shot deploy for the Lightning Alert admin panel on an Ubuntu VPS.
# Run this ON THE VPS, from the panel directory, AFTER you have:
#   1. Created the Neon database and copied its pooled connection string.
#   2. Pointed your dynv6 hostname's A/AAAA record at this VPS.
#   3. Copied this folder to the VPS (e.g. /opt/lightning-panel).
#   4. Edited .env (DATABASE_URL + CLICKATELL_API_KEY at minimum).
#
# Usage:
#   sudo DOMAIN=gwld1-admin.dynv6.net bash deploy/deploy_on_vps.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:-gwld1-admin.dynv6.net}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; exit 1; }

# ------------------------------------------------------------------ preflight
[ -f .env ] || die "No .env found in $HERE. Copy .env.example to .env and edit it."

say "Preflight checks on .env"
get() { grep -E "^$1=" .env | head -n1 | cut -d= -f2- || true; }

[ -n "$(get APP_SECRET_KEY)" ]      || die "APP_SECRET_KEY is empty."
[ "$(get APP_SECRET_KEY)" != "dev-only-change-me" ] || die "APP_SECRET_KEY is the default."
secret_len=$(printf '%s' "$(get APP_SECRET_KEY)" | wc -c)
[ "$secret_len" -ge 32 ] || warn "APP_SECRET_KEY looks short ($secret_len chars); 96 hex chars recommended."

case "$(get DATABASE_URL)" in
  postgres*|postgresql*) : ;;
  *) warn "DATABASE_URL is not Postgres. For production set the Neon pooled string." ;;
esac

[ -n "$(get ALERT_WEBHOOK_TOKEN)" ] || die "ALERT_WEBHOOK_TOKEN is empty (must match the Pi)."
[ "$(get ALERT_WEBHOOK_TOKEN)" != "change-me-shared-with-pi" ] \
    || die "ALERT_WEBHOOK_TOKEN is still the placeholder; set a real value (and match it on the Pi)."

[ -n "$(get CLICKATELL_API_KEY)" ] \
    || warn "CLICKATELL_API_KEY is empty: the panel will run but NO SMS will be sent until you set it."

[ "$(get SECURE_COOKIES)" != "false" ] || warn "SECURE_COOKIES=false: only acceptable behind plain HTTP."

# ------------------------------------------------------------------ docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

say "Configuring firewall (OpenSSH, 80, 443)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  yes | ufw enable   >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ panel
say "Stopping any previous panel container"
docker compose down 2>/dev/null || true
docker rm -f lightning-alert-panel 2>/dev/null || true

say "Building and starting the panel container"
docker compose up -d --build --force-recreate
sleep 4
docker compose ps

# ------------------------------------------------------------------ caddy
if ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy (auto-HTTPS reverse proxy)"
  apt -y install debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
       | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
       | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt -y install caddy
fi

say "Writing Caddyfile for $DOMAIN"
sed "s/{\$DOMAIN}/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl restart caddy

say "Done. The panel should be live at: https://$DOMAIN"
echo    "  - Watch logs:        docker compose logs -f panel"
echo    "  - Caddy will issue a Let's Encrypt cert within ~30s (DNS must resolve here)."
echo    "  - Pi must POST to:   https://$DOMAIN/api/v1/lightning  with the same ALERT_WEBHOOK_TOKEN."
