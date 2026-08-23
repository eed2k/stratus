#!/usr/bin/env bash
#
# Install the Stratus beacon on a Raspberry Pi Zero W / Zero 2 W.
#
#   sudo bash install.sh
#
# Idempotent: safe to re-run after editing beacon.py. It will not overwrite an
# existing /etc/stratus-beacon.env, so your token survives a reinstall.
set -euo pipefail

APP_DIR=/opt/stratus-beacon
ENV_FILE=/etc/stratus-beacon.env
UNIT=/etc/systemd/system/stratus-beacon.service
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

echo "== dependencies =="
# gpiozero needs a backend. lgpio works on current Pi OS including Bookworm,
# where RPi.GPIO no longer works on every kernel. Both are installed so
# gpiozero can pick whichever is available.
apt-get update -qq
apt-get install -y --no-install-recommends \
  python3 python3-gpiozero python3-lgpio

echo "== application =="
install -d -m 755 "$APP_DIR"
install -m 755 "$SRC/beacon.py" "$APP_DIR/beacon.py"

echo "== configuration =="
if [[ -f "$ENV_FILE" ]]; then
  echo "  $ENV_FILE exists, leaving it alone (your token is safe)"
else
  install -m 600 "$SRC/beacon.env.example" "$ENV_FILE"
  echo "  created $ENV_FILE (mode 600)"
  echo "  EDIT IT NOW and set BEACON_TOKEN and BEACON_STATION_ID."
fi

echo "== service =="
install -m 644 "$SRC/stratus-beacon.service" "$UNIT"
systemctl daemon-reload
systemctl enable stratus-beacon.service

echo
echo "Installed."
echo
echo "Next:"
echo "  1. sudo nano $ENV_FILE          # set BEACON_TOKEN, BEACON_STATION_ID"
echo "  2. sudo systemctl restart stratus-beacon"
echo "  3. journalctl -u stratus-beacon -f"
echo
echo "To check the wiring without waiting for real events:"
echo "  sudo systemctl stop stratus-beacon"
echo "  sudo BEACON_DRY_RUN=false python3 $APP_DIR/beacon.py   # Ctrl-C to stop"
echo
echo "A red lamp at start-up is correct: the beacon shows its fail state until"
echo "the panel confirms the detector is reporting in."
