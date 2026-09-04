#!/usr/bin/env bash
# =============================================================================
# GWLD1 Pi Zero W - low power optimization
#
#   sudo bash pi_lowpower.sh
#
# Separate from pi_harden_power_rugged.sh on purpose: that script's job is
# security and crash-recovery, and it is already audited. This one only touches
# power, so it can be reviewed, re-run and reverted on its own.
#
# Idempotent. Changes to config.txt need a reboot to take effect; everything
# else applies immediately.
#
# HONEST EXPECTATIONS on a Pi Zero W, measured at 5 V input:
#
#   baseline, headless, WiFi idle          ~120 mA   (0.60 W)
#   HDMI off                                -25 mA   <- biggest single win
#   Bluetooth off (already done)             -10 mA
#   ACT LED off (already done)                -5 mA
#   GPU minimum + no display stack          -5 mA
#   governor pinned low                    -5..15 mA
#   WiFi power-save on (see the tradeoff)  -20..30 mA
#
# Realistic result: roughly 75-90 mA (0.38-0.45 W) with power-save off, or
# 55-70 mA with it on. Do not trust these numbers blindly - measure with an
# inline USB meter, because your WiFi signal strength dominates the average.
#
# What this deliberately does NOT do: suspend, sleep or halt the CPU. The
# detector must stay awake to service AS3935 interrupts within 2 seconds.
# =============================================================================
set -euo pipefail

# --- toggles ----------------------------------------------------------------
# WiFi power-save. pi_harden_power_rugged.sh deliberately sets this OFF because
# it fixed intermittent connection drops. Turning it on is the single largest
# remaining saving, but it can add latency to heartbeats and SSH. Default is to
# respect the existing choice and change nothing.
#   keep = leave as-is | on = save power | off = force responsive
WIFI_POWERSAVE="${WIFI_POWERSAVE:-keep}"

# Pin the CPU to its lowest frequency instead of scaling on demand. Safe for
# this workload: the detector is interrupt-driven and idles almost all the time.
PIN_GOVERNOR="${PIN_GOVERNOR:-1}"

# Drop arm_freq from 800 to 700 MHz. Small extra saving. Off by default because
# it is a bigger behavioral change than the rest.
DEEP_UNDERCLOCK="${DEEP_UNDERCLOCK:-0}"

# avahi-daemon provides the .local name you use for SSH. Disabling it saves a
# small amount of power and stops constant mDNS broadcasts, at the cost of
# having to reach the unit by IP. Off by default.
DISABLE_AVAHI="${DISABLE_AVAHI:-0}"

BOOT_CFG="/boot/firmware/config.txt"
[ -f "$BOOT_CFG" ] || BOOT_CFG="/boot/config.txt"

log()  { echo -e "\n=== $* ==="; }
info() { echo "    $*"; }
warn() { echo "!!  $*" >&2; }

[ "$(id -u)" -eq 0 ] || { warn "Run with sudo."; exit 1; }
[ -f "$BOOT_CFG" ] || { warn "No config.txt found."; exit 1; }

REBOOT_NEEDED=0

# -----------------------------------------------------------------------------
log "0/6  Before"
info "config: $BOOT_CFG"
if command -v vcgencmd >/dev/null 2>&1; then
  info "arm clock : $(vcgencmd measure_clock arm 2>/dev/null | cut -d= -f2)"
  info "core temp : $(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)"
  info "throttled : $(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)"
fi
GOV_NOW="$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown)"
info "governor  : $GOV_NOW"
info "wifi ps   : $(/sbin/iw dev wlan0 get power_save 2>/dev/null | awk '{print $NF}' || echo unknown)"

# -----------------------------------------------------------------------------
log "1/6  HDMI off (the one the old script could not do)"
# tvservice and vcgencmd display_power were removed when Raspberry Pi OS moved
# to full KMS, which is why pi_harden_power_rugged.sh logs "skipping" and leaves
# HDMI powered. The supported headless approach is the no-hdmi parameter on the
# KMS overlay. xrandr is not an alternative: it blanks the output without
# reducing draw.
if grep -qE '^\s*dtoverlay=vc4-kms-v3d,no-hdmi' "$BOOT_CFG"; then
  info "already set: dtoverlay=vc4-kms-v3d,no-hdmi"
elif grep -qE '^\s*dtoverlay=vc4-kms-v3d' "$BOOT_CFG"; then
  sed -i 's/^\s*dtoverlay=vc4-kms-v3d.*$/dtoverlay=vc4-kms-v3d,no-hdmi/' "$BOOT_CFG"
  info "changed to dtoverlay=vc4-kms-v3d,no-hdmi"
  REBOOT_NEEDED=1
else
  echo "dtoverlay=vc4-kms-v3d,no-hdmi" >> "$BOOT_CFG"
  info "added dtoverlay=vc4-kms-v3d,no-hdmi"
  REBOOT_NEEDED=1
fi
warn "After this, a monitor on the HDMI port shows nothing. Debug over SSH, or"
warn "the serial console which is already enabled (console=serial0,115200)."

# -----------------------------------------------------------------------------
log "2/6  Trim the boot configuration"
set_cfg() {
  local line="$1"
  # The key is everything before the LAST '=', not the first. For
  # "dtparam=audio=off" that gives "dtparam=audio", so the replace cannot touch
  # dtparam=spi=on or the act_led entries. Using the first '=' would make the
  # key "dtparam" and wipe every dtparam line, including the SPI bus the AS3935
  # depends on.
  local key="${line%=*}"
  # dtoverlay is additive: several unrelated overlays legitimately coexist, so
  # it is only ever appended when the exact line is absent, never rewritten.
  if [ "${line%%=*}" = "dtoverlay" ]; then
    if grep -qxF "$line" "$BOOT_CFG"; then
      info "already: $line"
    else
      echo "$line" >> "$BOOT_CFG"
      info "added: $line"
      REBOOT_NEEDED=1
    fi
    return
  fi
  if grep -qxF "$line" "$BOOT_CFG"; then
    info "already: $line"
  elif grep -qE "^[[:space:]]*${key}=" "$BOOT_CFG"; then
    sed -i "s|^[[:space:]]*${key}=.*$|${line}|" "$BOOT_CFG"
    info "set: $line"
    REBOOT_NEEDED=1
  else
    echo "$line" >> "$BOOT_CFG"
    info "added: $line"
    REBOOT_NEEDED=1
  fi
}
set_cfg "camera_auto_detect=0"      # no camera; skip probing and its overlay
set_cfg "display_auto_detect=0"     # no DSI display
set_cfg "disable_splash=1"          # no rainbow splash, marginally faster boot
set_cfg "dtparam=audio=off"         # analogue audio block off
set_cfg "gpu_mem=16"                # minimum GPU split; frees RAM on a 512 MB Pi
set_cfg "max_framebuffers=1"        # one framebuffer is enough headless

if [ "$DEEP_UNDERCLOCK" = "1" ]; then
  set_cfg "arm_freq=700"
  info "deep underclock enabled (800 -> 700 MHz)"
else
  info "arm_freq left at its current value (set DEEP_UNDERCLOCK=1 for 700 MHz)"
fi

# -----------------------------------------------------------------------------
log "3/6  Pin the CPU governor"
# The Pi Zero W scales between 700 MHz and its arm_freq ceiling. Pinning to the
# bottom removes the ramp-up entirely. The detector spends nearly all its time
# blocked waiting on a GPIO interrupt, so it does not need the headroom.
if [ "$PIN_GOVERNOR" = "1" ]; then
  cat > /etc/systemd/system/cpu-powersave.service <<'EOF'
[Unit]
Description=Pin CPU governor to powersave (lightning detector, low power)
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
# Not every kernel exposes the powersave governor; fall back to conservative,
# and never fail the unit over it.
ExecStart=/bin/sh -c 'for c in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do \
  [ -w "$c" ] || continue; \
  if grep -q powersave "$(dirname $c)/scaling_available_governors" 2>/dev/null; then \
    echo powersave > "$c"; \
  fi; \
done; true'

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now cpu-powersave.service >/dev/null 2>&1 || true
  info "governor now: $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown)"
else
  info "skipped (PIN_GOVERNOR=0)"
fi

# -----------------------------------------------------------------------------
log "4/6  Stop services this unit does not use"
# Only genuinely unused things. Deliberately NOT touched:
#   pigpiod, lightning-detector, ssh, NetworkManager/wpa_supplicant  - required
#   systemd-timesyncd    - events need correct timestamps after an outage
#   fail2ban, ufw        - security
#   apt-daily timers     - unattended-upgrades depends on them, and the power
#                          cost of a brief periodic run is negligible
#   dphys-swapfile       - swap is a safety net on 512 MB; losing it risks an
#                          OOM kill of the detector, which is worse than the
#                          few SD writes it costs
for svc in triggerhappy ModemManager cups cups-browsed \
           bluetooth hciuart getty@tty1 man-db.timer; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
    if systemctl is-enabled "$svc" >/dev/null 2>&1 || \
       systemctl is-active "$svc" >/dev/null 2>&1; then
      systemctl disable --now "$svc" >/dev/null 2>&1 && info "disabled $svc" \
        || info "could not disable $svc (ignored)"
    else
      info "already off: $svc"
    fi
  fi
done

if [ "$DISABLE_AVAHI" = "1" ]; then
  systemctl disable --now avahi-daemon avahi-daemon.socket >/dev/null 2>&1 || true
  warn "avahi disabled: lightning-detector-gwld1.local will stop resolving."
  warn "Reach the unit by IP, or over the USB gadget at 192.168.7.2."
else
  info "avahi-daemon kept (needed for .local); set DISABLE_AVAHI=1 to drop it"
fi

# -----------------------------------------------------------------------------
log "5/6  WiFi power-save"
case "$WIFI_POWERSAVE" in
  on)
    # Overrides the wifi-tune unit written by the hardening script, which forces
    # power_save off. Writing a drop-in keeps that file intact.
    install -d -m 0755 /etc/systemd/system/wifi-tune.service.d
    cat > /etc/systemd/system/wifi-tune.service.d/10-powersave.conf <<'EOF'
# Low-power override: re-enable WiFi power saving after wifi-tune disables it.
[Service]
ExecStartPost=-/sbin/iw dev wlan0 set power_save on
EOF
    systemctl daemon-reload
    /sbin/iw dev wlan0 set power_save on 2>/dev/null || true
    info "power_save ON  (saves 20-30 mA average)"
    warn "Heartbeats and SSH may feel slower. The hardening script turned this"
    warn "off to fix intermittent drops, so watch for those returning."
    ;;
  off)
    rm -f /etc/systemd/system/wifi-tune.service.d/10-powersave.conf
    systemctl daemon-reload
    /sbin/iw dev wlan0 set power_save off 2>/dev/null || true
    info "power_save OFF (responsive, costs 20-30 mA)"
    ;;
  *)
    info "left unchanged: $(/sbin/iw dev wlan0 get power_save 2>/dev/null | awk '{print $NF}' || echo unknown)"
    info "set WIFI_POWERSAVE=on for the biggest remaining saving"
    ;;
esac
info "TX power: $(/sbin/iw dev wlan0 info 2>/dev/null | awk '/txpower/{print $2, $3}' || echo unknown)"
info "(already reduced to ~10 dBm by pi_harden_power_rugged.sh)"

# -----------------------------------------------------------------------------
log "6/6  Result"
echo
echo "  Applied. Verify after rebooting:"
echo
echo "    vcgencmd measure_clock arm      # expect ~700000000 with the governor pinned"
echo "    vcgencmd get_throttled         # 0x0 means no undervoltage or throttling"
echo "    cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
echo "    iw dev wlan0 get power_save"
echo "    systemctl status lightning-detector"
echo
echo "  Real consumption needs an inline USB power meter between the supply and"
echo "  the Pi. Software cannot measure input current on a Zero W."
echo
echo "  Check the detector still works after the reboot, since HDMI, GPU memory"
echo "  and the clock all changed:"
echo
echo "    python3 /home/gwld1/send_test_heartbeat.py"
echo "    journalctl -u lightning-detector -n 40"
echo
if [ "$REBOOT_NEEDED" = "1" ]; then
  echo "  REBOOT REQUIRED for the config.txt changes:  sudo reboot"
else
  echo "  No reboot needed; nothing in config.txt changed."
fi
echo
echo "  To revert: remove the added lines from $BOOT_CFG, then"
echo "    sudo systemctl disable --now cpu-powersave.service"
echo "    sudo rm -f /etc/systemd/system/wifi-tune.service.d/10-powersave.conf"
