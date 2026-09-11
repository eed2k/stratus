#!/bin/bash
# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  QUAGGASKLIP unit installer. Run once over SSH after an Imager flash.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
#  This installs the QUAGGASKLIP detector onto a Pi that was flashed with
#  Raspberry Pi Imager (user quaggasklip, hostname as3935Quaggasklip, WiFi and
#  SSH key already set). It is NOT the cloud-init model the Glencore card used:
#  it runs from its own directory, so scp this whole folder to the Pi and run
#
#      sudo bash quaggasklip-deploy/install.sh
#
#  Idempotent. Boot-config edits are applied only when missing and each file is
#  backed up first. A REBOOT is required the first time, because SPI and the
#  UART are enabled here rather than by Imager.
#
#  ISOLATION: this bundle is QUAGGASKLIP only. It shares nothing with the
#  Glencore (gwld1) unit: different user, home, station_id, panel tenant and
#  ingest token. Do not copy files between the two bundles.
# =========================================================================
set -uo pipefail

SERVICE_USER="quaggasklip"
HOME_DIR="/home/${SERVICE_USER}"
UNIT="lightning-detector.service"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
REBOOT_NEEDED=0

log() { echo "[quaggasklip-install] $*"; logger -t quaggasklip-install "$*" 2>/dev/null || true; }
die() { log "ERROR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
log "source: $SRC_DIR"

# --- Boot config location (Bookworm moved it to /boot/firmware) --------------
if [ -f /boot/firmware/config.txt ]; then
  BOOT_CONFIG=/boot/firmware/config.txt; BOOT_CMDLINE=/boot/firmware/cmdline.txt
elif [ -f /boot/config.txt ]; then
  BOOT_CONFIG=/boot/config.txt; BOOT_CMDLINE=/boot/cmdline.txt
else
  die "cannot find config.txt in /boot/firmware or /boot"
fi
log "boot config: ${BOOT_CONFIG}"

# --- Service user ------------------------------------------------------------
# Imager creates quaggasklip. Create it as a fallback so the installer also
# works on an image without Imager customization.
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  log "user ${SERVICE_USER} exists"
else
  useradd --create-home --shell /bin/bash "${SERVICE_USER}" \
    || die "could not create ${SERVICE_USER}"
  log "created user ${SERVICE_USER}"
fi
# spi and gpio for the sensor, dialout so the serial console user is unaffected.
for grp in spi gpio dialout; do
  getent group "${grp}" >/dev/null 2>&1 && usermod -aG "${grp}" "${SERVICE_USER}" \
    && log "added ${SERVICE_USER} to ${grp}"
done

# --- SSH key -----------------------------------------------------------------
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${HOME_DIR}/.ssh"
AUTH="${HOME_DIR}/.ssh/authorized_keys"
touch "$AUTH"; chmod 600 "$AUTH"
if [ -f "${SRC_DIR}/authorized_keys" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    grep -qxF "$line" "$AUTH" 2>/dev/null || echo "$line" >> "$AUTH"
  done < "${SRC_DIR}/authorized_keys"
fi
chown "${SERVICE_USER}:${SERVICE_USER}" "$AUTH"

# --- Packages ----------------------------------------------------------------
# lightning_detector.py imports RPi.GPIO and spidev; the Campbell bit-bang and
# the strike pulse use pigpio. Install ONLY what is missing.
#
# Do NOT force classic python3-rpi.gpio. On Raspberry Pi OS Trixie the working
# provider of the RPi.GPIO API is python3-rpi-lgpio, a drop-in on top of lgpio
# whose edge detection works on the 6.x kernel. Classic RPi.GPIO's
# add_event_detect fails on this kernel, and the two packages conflict, so
# force-installing classic would remove rpi-lgpio and silently break the AS3935
# interrupt. Verified on this unit: rpi-lgpio is installed and add_event_detect
# succeeds. If RPi.GPIO already imports, leave the provider exactly as it is.
export DEBIAN_FRONTEND=noninteractive
need=""
python3 -c 'import RPi.GPIO' 2>/dev/null || need="$need python3-rpi-lgpio"
python3 -c 'import spidev'   2>/dev/null || need="$need python3-spidev"
python3 -c 'import pigpio'   2>/dev/null || need="$need python3-pigpio"
command -v pigpiod >/dev/null 2>&1       || need="$need pigpio"
if [ -n "$need" ]; then
  log "installing missing packages:$need"
  apt-get update -y >/dev/null 2>&1 || log "WARN apt-get update failed (no network?)"
  # shellcheck disable=SC2086
  apt-get install -y --no-install-recommends $need >/dev/null 2>&1 \
    && log "packages installed" \
    || log "WARN install failed; fix connectivity then: apt-get install -y$need"
else
  log "all hardware Python packages already present"
fi
# Fail loudly now rather than crash-loop after reboot.
if python3 -c 'import RPi.GPIO, spidev' 2>/dev/null; then
  log "verified: RPi.GPIO + spidev import OK"
else
  log "ERROR: RPi.GPIO or spidev not importable - the detector will not run"
fi

# --- Boot config: SPI + serial console UART + USB gadget ---------------------
# Imager does not enable these. Without SPI the unit boots, joins WiFi, posts
# heartbeats and detects nothing, so this is the single most important section.
ensure_cfg() {  # ensure_cfg <exact-line> <description>
  local line="$1" desc="$2"
  if grep -qxF "${line}" "${BOOT_CONFIG}"; then
    log "already set: ${desc}"; return
  fi
  cp -n "${BOOT_CONFIG}" "${BOOT_CONFIG}.bak-${STAMP}" 2>/dev/null || true
  printf '\n# added by quaggasklip install.sh %s\n%s\n' "${STAMP}" "${line}" >> "${BOOT_CONFIG}"
  log "added: ${desc}  (${line})"
  REBOOT_NEEDED=1
}
ensure_cfg "dtparam=spi=on"                 "SPI enabled (AS3935 in socket 1, CE0 = spidev0.0)"
ensure_cfg "enable_uart=1"                  "serial console kept as the recovery path"
ensure_cfg "dtoverlay=dwc2,dr_mode=peripheral" "USB gadget for maintenance over the data port"
# Power basics. The aggressive tuning (governor, deeper underclock) lives in
# pi_lowpower.sh, and Bluetooth/LED/WiFi in pi_harden_power_rugged.sh.
ensure_cfg "gpu_mem=16"                     "minimum GPU split"
ensure_cfg "camera_auto_detect=0"           "no camera probing"
ensure_cfg "display_auto_detect=0"          "no display probing"
ensure_cfg "max_framebuffers=1"             "one framebuffer, headless"
ensure_cfg "arm_freq=800"                   "underclocked for a solar site"
# Turn HDMI off at the KMS overlay if it is present and not already set.
if grep -qE '^\s*dtoverlay=vc4-kms-v3d\s*$' "${BOOT_CONFIG}"; then
  cp -n "${BOOT_CONFIG}" "${BOOT_CONFIG}.bak-${STAMP}" 2>/dev/null || true
  sed -i 's/^\s*dtoverlay=vc4-kms-v3d\s*$/dtoverlay=vc4-kms-v3d,no-hdmi/' "${BOOT_CONFIG}"
  log "set: HDMI off (dtoverlay=vc4-kms-v3d,no-hdmi)"; REBOOT_NEEDED=1
fi
# USB gadget ethernet module, on the kernel command line (must stay one line).
if [ -f "${BOOT_CMDLINE}" ] && ! grep -q 'modules-load=dwc2,g_ether' "${BOOT_CMDLINE}"; then
  cp -n "${BOOT_CMDLINE}" "${BOOT_CMDLINE}.bak-${STAMP}" 2>/dev/null || true
  sed -i 's/rootwait/rootwait modules-load=dwc2,g_ether/' "${BOOT_CMDLINE}"
  log "added modules-load=dwc2,g_ether to cmdline"; REBOOT_NEEDED=1
fi

# --- Project files -----------------------------------------------------------
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${HOME_DIR}" "${HOME_DIR}/lightning_data"
copy_in() {  # copy_in <file> [mode]
  local f="$1" mode="${2:-0644}"
  [ -f "${SRC_DIR}/${f}" ] || { log "note: ${f} not in bundle, skipping"; return; }
  install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m "${mode}" "${SRC_DIR}/${f}" "${HOME_DIR}/${f}"
}
copy_in lightning_detector.py       0755
copy_in send_test_heartbeat.py      0755
copy_in calibrate_scan.py           0755
copy_in campbell_pin_probe.py       0755
copy_in pi_harden_power_rugged.sh   0755
copy_in pi_lowpower.sh              0755
copy_in install_tailscale_pi.sh     0755

# The config carries the panel token, so it is written only if absent and is
# readable only by the service user. Re-running the installer never clobbers it.
if [ -f "${HOME_DIR}/lightning_config.json" ]; then
  log "keeping existing lightning_config.json (holds the token)"
else
  install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0600 \
    "${SRC_DIR}/lightning_config.json" "${HOME_DIR}/lightning_config.json"
  log "installed lightning_config.json (mode 0600)"
fi

# --- Service -----------------------------------------------------------------
install -m 0644 "${SRC_DIR}/${UNIT}" "/etc/systemd/system/${UNIT}" || die "could not install ${UNIT}"
systemctl daemon-reload
systemctl enable pigpiod >/dev/null 2>&1 || true
systemctl start pigpiod  >/dev/null 2>&1 || true
systemctl enable "${UNIT}" >/dev/null 2>&1 && log "enabled ${UNIT}"

if [ "${REBOOT_NEEDED}" -eq 1 ]; then
  # SPI is not on the bus until the reboot, so starting now would only
  # crash-loop. Enabled above, so it comes up by itself after the reboot.
  log "service enabled but NOT started: reboot first so SPI and the UART are live"
else
  systemctl restart "${UNIT}" 2>/dev/null || true
  log "service started"
fi

# --- What is left to do ------------------------------------------------------
echo
echo "============================================================"
echo " QUAGGASKLIP install done. Remaining steps, in order:"
echo "============================================================"
if [ "${REBOOT_NEEDED}" -eq 1 ]; then
  echo " 1. REBOOT so SPI and the UART come up:   sudo reboot"
else
  echo " 1. No reboot needed: SPI and the UART were already enabled."
fi
cat <<'STEPS'

 2. After reboot, confirm the sensor bus and a clean start:
      ls /dev/spidev0.0
      systemctl status lightning-detector
      sudo journalctl -u lightning-detector | grep "calibration PASSED"

 3. Prove the panel link (returns HTTP 200 / {"status":"ok"}):
      python3 /home/quaggasklip/send_test_heartbeat.py

 4. Only once the detector is confirmed working, apply the field hardening.
    It disables SSH password login, so make sure key login already works or
    you can be locked out:
      sudo bash /home/quaggasklip/pi_harden_power_rugged.sh

 5. Optional low-power tuning (HDMI off, governor pinned), after step 4:
      sudo bash /home/quaggasklip/pi_lowpower.sh
STEPS
echo
log "install complete"
