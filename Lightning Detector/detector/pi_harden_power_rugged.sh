#!/usr/bin/env bash
# =============================================================================
# GWLD1 Pi Zero W - security hardening + power optimization + ruggedness
# Run on the Pi:   sudo bash pi_harden_power_rugged.sh
# Idempotent: safe to re-run. Does NOT implement CPU suspend/sleep (the
# detector must stay awake to service AS3935 interrupts).
# =============================================================================
set -euo pipefail
USER_NAME="gwld1"
SSH_PORT=22
BOOT_CFG="/boot/firmware/config.txt"
[ -f "$BOOT_CFG" ] || BOOT_CFG="/boot/config.txt"

log() { echo -e "\n=== $* ==="; }

# -----------------------------------------------------------------------------
log "SAFETY CHECK: confirm an SSH public key is installed before locking down"
KEYS="/home/${USER_NAME}/.ssh/authorized_keys"
if [ ! -s "$KEYS" ]; then
  echo "!! No authorized_keys for ${USER_NAME}. ABORTING so you are not locked out."
  echo "   Add your key first, then re-run."
  exit 1
fi
echo "OK: $(wc -l < "$KEYS") key(s) present."

# -----------------------------------------------------------------------------
log "SECURITY 1/4: UFW firewall (allow SSH + Tailscale, deny the rest)"
apt-get install -y ufw >/dev/null 2>&1 || true
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 2>/dev/null || true   # full trust over the VPN
ufw limit ${SSH_PORT}/tcp comment 'SSH rate-limited'
ufw --force enable
ufw status verbose

# -----------------------------------------------------------------------------
log "SECURITY 2/4: SSH key-only (passwords off, root login off)"
install -d -m 0755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
# Managed by GWLD1 hardening script
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 120
ClientAliveCountMax 3
EOF
# Validate config before restarting so a typo can't kill SSH.
if sshd -t; then
  systemctl restart ssh 2>/dev/null || systemctl restart sshd
  echo "OK: sshd restarted with hardened config."
else
  echo "!! sshd -t failed; reverting hardening file."
  rm -f /etc/ssh/sshd_config.d/00-hardening.conf
  exit 1
fi

# -----------------------------------------------------------------------------
log "SECURITY 3/4: fail2ban (ban brute-force SSH)"
apt-get install -y fail2ban >/dev/null 2>&1 || true
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 4
backend  = systemd

[sshd]
enabled = true
port    = ${SSH_PORT}
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status sshd || true

# -----------------------------------------------------------------------------
log "SECURITY 4/4: automatic security updates"
apt-get install -y unattended-upgrades >/dev/null 2>&1 || true
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades 2>/dev/null || true
echo "OK: unattended-upgrades enabled."

# -----------------------------------------------------------------------------
log "POWER: disable Bluetooth + on-board LED (HDMI off at boot). NO CPU sleep."
touch_cfg() { grep -qxF "$1" "$BOOT_CFG" || echo "$1" >> "$BOOT_CFG"; }
touch_cfg "dtoverlay=disable-bt"             # Bluetooth radio off
touch_cfg "dtparam=act_led_trigger=none"     # ACT LED off
touch_cfg "dtparam=act_led_activelow=off"
# Disable the Bluetooth UART service (frees power + UART)
systemctl disable --now hciuart 2>/dev/null || true
systemctl disable --now bluetooth 2>/dev/null || true
# Turn HDMI output off now and on every boot (Pi Zero saves ~25 mA headless).
if command -v tvservice >/dev/null 2>&1; then
  /usr/bin/tvservice -o 2>/dev/null || true
  cat > /etc/systemd/system/hdmi-off.service <<'EOF'
[Unit]
Description=Turn off HDMI to save power (headless)
After=multi-user.target
[Service]
Type=oneshot
ExecStart=/usr/bin/tvservice -o
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable hdmi-off.service 2>/dev/null || true
else
  echo "note: tvservice not present (KMS build) - HDMI auto-blanks; skipping."
fi

# -----------------------------------------------------------------------------
log "WiFi: reduce TX power + disable power-save (persistent on every boot)"
# Why:
#  - power-save OFF  -> responsive heartbeat/SSH (fixes intermittent drops).
#    Does NOT affect lightning detection (that runs on SPI/GPIO).
#  - lower TX power  -> the dongle sits ~4 cm from the Pi/sensor; cutting TX
#    power reduces RF energy coupled into the AS3935 (fewer EMI false strikes)
#    and the reverse-link overload at the modem. wlan0 confirmed to accept it.
#    NOTE: the Pi's *own* RX saturation is fixed by lowering the MODEM's TX
#    power in its admin portal - do that too for the full fix.
WIFI_TXPOWER_MBM=1000   # 10 dBm (=10 mW). Default ~20 dBm. Tune 600-1500 here.
cat > /etc/systemd/system/wifi-tune.service <<EOF
[Unit]
Description=Lightning unit WiFi tuning (power-save off + reduced TX power)
After=network.target sys-subsystem-net-devices-wlan0.device
[Service]
Type=oneshot
ExecStart=/sbin/iw dev wlan0 set power_save off
ExecStart=-/sbin/iw dev wlan0 set txpower fixed ${WIFI_TXPOWER_MBM}
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now wifi-tune.service 2>/dev/null || true
echo "--- wlan0 after tuning ---"
/sbin/iw dev wlan0 get power_save 2>/dev/null || true
/sbin/iw dev wlan0 info 2>/dev/null | grep -i txpower || true

# -----------------------------------------------------------------------------
log "RUGGED 1/2: detector service must auto-recover after any power loss"
SVC=/etc/systemd/system/lightning-detector.service
if [ -f "$SVC" ]; then
  # Ensure always-restart + no start-limit lockout after repeated reboots.
  grep -q 'Restart=always'            "$SVC" || sed -i '/^\[Service\]/a Restart=always' "$SVC"
  grep -q 'RestartSec='               "$SVC" || sed -i '/^Restart=always/a RestartSec=10' "$SVC"
  grep -q 'StartLimitIntervalSec='    "$SVC" || sed -i '/^\[Unit\]/a StartLimitIntervalSec=0' "$SVC"
  systemctl daemon-reload
  systemctl enable lightning-detector.service
  echo "OK: lightning-detector enabled + Restart=always."
  systemctl is-enabled lightning-detector.service || true
else
  echo "!! $SVC not found - install the service unit first."
fi

# -----------------------------------------------------------------------------
log "RUGGED 2/2: SD-card resilience against sudden power loss"
# 1) Auto-repair filesystem on boot instead of dropping to a recovery prompt.
CMDLINE="/boot/firmware/cmdline.txt"; [ -f "$CMDLINE" ] || CMDLINE="/boot/cmdline.txt"
if [ -f "$CMDLINE" ] && ! grep -q 'fsck.repair=yes' "$CMDLINE"; then
  sed -i 's/$/ fsck.repair=yes/' "$CMDLINE"
  echo "OK: fsck.repair=yes added to cmdline."
fi
# 2) Cap journald disk use + flush less aggressively (fewer SD writes).
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/00-rugged.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=50M
RuntimeMaxUse=20M
EOF
systemctl restart systemd-journald 2>/dev/null || true
# 3) Make sure time syncs on boot (events need correct timestamps after outage).
systemctl enable --now systemd-timesyncd 2>/dev/null || true

log "DONE. Reboot recommended:  sudo reboot"
echo "After reboot, verify:  systemctl status lightning-detector ufw fail2ban"
