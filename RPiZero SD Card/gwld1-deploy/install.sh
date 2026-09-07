#!/bin/bash
# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  Boot-partition installer, run once per instance by cloud-init.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
# Auto-deploy for GWLD1, triggered by cloud-init runcmd (once per instance-id).
set -uo pipefail

BOOT=""
[ -d /boot/firmware/gwld1-deploy ] && BOOT=/boot/firmware
[ -d /boot/gwld1-deploy ] && BOOT=/boot
[ -n "$BOOT" ] || exit 0

DEPLOY="$BOOT/gwld1-deploy"
MARKER="$DEPLOY/.installed"
[ -f "$MARKER" ] && exit 0

log() { echo "[gwld1-deploy] $*"; logger -t gwld1-deploy "$*"; }
log "starting deploy from $DEPLOY"

# Wait for the gwld1 home to exist (cloud-init users module).
for _ in $(seq 1 90); do [ -d /home/gwld1 ] && break; sleep 2; done
[ -d /home/gwld1 ] || { log "ERROR: /home/gwld1 missing"; exit 1; }

# --- SSH key for remote access ---
install -d -m 700 -o gwld1 -g gwld1 /home/gwld1/.ssh
AUTH=/home/gwld1/.ssh/authorized_keys
touch "$AUTH"; chmod 600 "$AUTH"
if [ -f "$DEPLOY/authorized_keys" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    grep -qxF "$line" "$AUTH" 2>/dev/null || echo "$line" >> "$AUTH"
  done < "$DEPLOY/authorized_keys"
fi
chown gwld1:gwld1 "$AUTH"

# --- Tailscale: left alone on purpose ---
#
# An earlier version of this script purged Tailscale. That has been removed,
# because uninstalling it here would destroy remote access to a unit on a site
# that is not easy to reach, and this deploy can be re-run at any time.
#
# Tailscale is NOT installed automatically: enrolling a device needs a tagged
# auth key, which must not be baked into an SD card that leaves your hands.
# The installer is copied to /home/gwld1 below; run it once, by hand:
#
#   sudo TS_AUTHKEY='tskey-auth-...' bash /home/gwld1/install_tailscale_pi.sh
#
# See Lightning Detector/remote_access/REMOTE_ACCESS.md for the tailnet policy
# that restricts SSH to admin@stratusweather.co.za.
log "tailscale left untouched (install manually if wanted)"

# --- Python and GPIO dependencies ---
# lightning_detector.py hard-requires RPi.GPIO (it exits 1 without it) and
# spidev, and the service unit depends on pigpiod. The full desktop image ships
# all three; Raspberry Pi OS Lite does not, so a from-scratch Lite flash would
# leave the service crash-looping with an import error.
#
# Best effort on purpose: if WiFi is not up yet the install fails, which is
# logged rather than fatal. The service has Restart=always with
# StartLimitIntervalSec=0, so it recovers by itself once the packages land.
need=""
python3 -c 'import RPi.GPIO' 2>/dev/null || need="$need python3-rpi.gpio"
python3 -c 'import spidev'   2>/dev/null || need="$need python3-spidev"
command -v pigpiod >/dev/null 2>&1       || need="$need pigpio"
if [ -n "$need" ]; then
  log "installing missing dependencies:$need"
  apt-get update -y >/dev/null 2>&1 || log "WARN apt-get update failed"
  # shellcheck disable=SC2086
  if apt-get install -y --no-install-recommends $need >/dev/null 2>&1; then
    log "dependencies installed"
  else
    log "WARN dependency install failed (no network?). Fix connectivity then run:"
    log "     sudo apt-get install -y$need"
  fi
else
  log "dependencies already present"
fi

# --- Project files ---
cp "$DEPLOY/lightning_detector.py" /home/gwld1/
cp "$DEPLOY/lightning_config.json" /home/gwld1/
[ -f "$DEPLOY/calibrate_scan.py" ] && cp "$DEPLOY/calibrate_scan.py" /home/gwld1/
# On-demand panel heartbeat test, so liveness can be verified without waiting
# for the hourly webhook.
[ -f "$DEPLOY/send_test_heartbeat.py" ] && cp "$DEPLOY/send_test_heartbeat.py" /home/gwld1/
# Staged for manual use; needs an auth key, so it is never run automatically.
[ -f "$DEPLOY/install_tailscale_pi.sh" ] && cp "$DEPLOY/install_tailscale_pi.sh" /home/gwld1/
# Low-power tuning. Staged but NOT run automatically: it disables HDMI, shrinks
# the GPU split and pins the clock, so it should be applied only after the
# detector is confirmed working. Running both at once makes a fault ambiguous.
[ -f "$DEPLOY/pi_lowpower.sh" ] && cp "$DEPLOY/pi_lowpower.sh" /home/gwld1/
cp "$DEPLOY/pi_harden_power_rugged.sh" /home/gwld1/
chmod +x /home/gwld1/pi_harden_power_rugged.sh
chown gwld1:gwld1 /home/gwld1/lightning_detector.py /home/gwld1/lightning_config.json /home/gwld1/pi_harden_power_rugged.sh
[ -f /home/gwld1/calibrate_scan.py ] && chown gwld1:gwld1 /home/gwld1/calibrate_scan.py
[ -f /home/gwld1/send_test_heartbeat.py ] && chown gwld1:gwld1 /home/gwld1/send_test_heartbeat.py
[ -f /home/gwld1/install_tailscale_pi.sh ] && chown gwld1:gwld1 /home/gwld1/install_tailscale_pi.sh
[ -f /home/gwld1/pi_lowpower.sh ] && chown gwld1:gwld1 /home/gwld1/pi_lowpower.sh
install -d -o gwld1 -g gwld1 /home/gwld1/lightning_data

# --- Detector service ---
cp "$DEPLOY/lightning-detector.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable pigpiod 2>/dev/null || true
systemctl start pigpiod 2>/dev/null || true
systemctl enable lightning-detector.service
systemctl restart lightning-detector.service 2>/dev/null || true
log "detector service enabled"

# --- Security/power/rugged hardening ---
if [ -s /home/gwld1/.ssh/authorized_keys ]; then
  bash /home/gwld1/pi_harden_power_rugged.sh >> /var/log/gwld1-harden.log 2>&1 || true
  log "hardening done (see /var/log/gwld1-harden.log)"
fi

touch "$MARKER"
log "deploy complete"