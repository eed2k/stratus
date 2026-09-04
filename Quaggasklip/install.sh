#!/bin/bash
# =============================================================================
#  Quaggasklip (Metron) lightning detector - installer
# =============================================================================
#
#  Prepares a Raspberry Pi Zero W or Zero 2 W for the detector:
#    - installs the Python hardware packages
#    - enables SPI               (the AS3935 in mikroBUS socket 2)
#    - frees the hardware UART   (the Terminal 2 Click in mikroBUS socket 1)
#    - creates the service user and its groups
#    - copies the program and installs the systemd unit
#
#  Idempotent: safe to re-run. Boot-config edits are applied only when missing,
#  and each one is backed up before it is touched.
#
#  A REBOOT IS REQUIRED the first time, because freeing the UART means taking it
#  away from the serial console and from Bluetooth. The script says so at the end
#  rather than rebooting on its own.
#
#  Usage:  sudo ./install.sh
# =============================================================================

set -uo pipefail

SERVICE_USER="quaggasklip"
HOME_DIR="/home/${SERVICE_USER}"
UNIT="quaggasklip.service"
MARKER="${HOME_DIR}/.installed"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
REBOOT_NEEDED=0

log() {
    echo "[install] $*"
    logger -t quaggasklip-install "$*" 2>/dev/null || true
}

die() {
    log "ERROR: $*"
    exit 1
}

[ "$(id -u)" -eq 0 ] || die "run with sudo"

# -----------------------------------------------------------------------------
#  Where the boot config lives
# -----------------------------------------------------------------------------
#  Bookworm and later moved it to /boot/firmware. Editing the wrong one is a
#  silent no-op that leaves the UART unavailable, so resolve it rather than
#  assume.
if [ -f /boot/firmware/config.txt ]; then
    BOOT_CONFIG=/boot/firmware/config.txt
    BOOT_CMDLINE=/boot/firmware/cmdline.txt
elif [ -f /boot/config.txt ]; then
    BOOT_CONFIG=/boot/config.txt
    BOOT_CMDLINE=/boot/cmdline.txt
else
    die "cannot find config.txt in /boot/firmware or /boot"
fi
log "boot config: ${BOOT_CONFIG}"

# -----------------------------------------------------------------------------
#  Packages
# -----------------------------------------------------------------------------
#  Distribution packages, not pip: these are built against the running kernel
#  and Bookworm's externally-managed environment refuses a global pip install.
log "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || log "apt-get update failed, continuing with what is cached"
apt-get install -y -qq \
    python3 python3-spidev python3-rpi.gpio python3-serial \
    || log "one or more packages failed to install; check before starting"

# pigpio is only needed for the bit-bang fallback transport. Best effort.
apt-get install -y -qq python3-pigpio pigpio >/dev/null 2>&1 \
    || log "pigpio not installed (only needed for campbell_transport=bitbang)"

# -----------------------------------------------------------------------------
#  Boot config: SPI on, UART free
# -----------------------------------------------------------------------------
ensure_config_line() {
    # ensure_config_line <line> <description>
    local line="$1" desc="$2"
    if grep -qxF "${line}" "${BOOT_CONFIG}"; then
        log "already set: ${desc}"
        return
    fi
    cp -n "${BOOT_CONFIG}" "${BOOT_CONFIG}.bak-${STAMP}" 2>/dev/null || true
    printf '\n# added by quaggasklip install.sh %s\n%s\n' "${STAMP}" "${line}" \
        >> "${BOOT_CONFIG}"
    log "added: ${desc}  (${line})"
    REBOOT_NEEDED=1
}

# The AS3935 is on SPI0. Both mikroBUS sockets share it; only chip select differs.
ensure_config_line "dtparam=spi=on" "SPI enabled"

# Hand the UART pins to the Pi rather than leaving them idle.
ensure_config_line "enable_uart=1" "hardware UART enabled"

# On a Zero W / Zero 2 W, Bluetooth owns the good PL011 UART and /dev/serial0
# points at the mini-UART, whose baud rate follows the VPU core clock and so
# drifts when the clock scales. Releasing Bluetooth moves /dev/serial0 onto the
# PL011 and the link becomes stable at 9600. This unit has no use for Bluetooth.
ensure_config_line "dtoverlay=disable-bt" "Bluetooth disabled, PL011 freed"

# The serial console holds the same port the logger needs.
if [ -f "${BOOT_CMDLINE}" ]; then
    if grep -qE 'console=(serial0|ttyAMA0|ttyS0)[^ ]*' "${BOOT_CMDLINE}"; then
        cp -n "${BOOT_CMDLINE}" "${BOOT_CMDLINE}.bak-${STAMP}" 2>/dev/null || true
        sed -i -E 's/console=(serial0|ttyAMA0|ttyS0)[^ ]*[ ]?//g' "${BOOT_CMDLINE}"
        log "removed the serial console from ${BOOT_CMDLINE}"
        REBOOT_NEEDED=1
    else
        log "already set: no serial console on the UART"
    fi
fi

# The getty would re-open the port even with the kernel console removed.
for svc in serial-getty@ttyAMA0.service serial-getty@ttyS0.service \
           serial-getty@serial0.service hciuart.service; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
        systemctl disable --now "${svc}" >/dev/null 2>&1 \
            && log "disabled ${svc}" || true
    fi
done

# -----------------------------------------------------------------------------
#  Service user
# -----------------------------------------------------------------------------
if id "${SERVICE_USER}" >/dev/null 2>&1; then
    log "user ${SERVICE_USER} exists"
else
    useradd --create-home --shell /usr/sbin/nologin "${SERVICE_USER}" \
        || die "could not create ${SERVICE_USER}"
    log "created user ${SERVICE_USER}"
fi

# spi and gpio for the sensor, dialout for /dev/serial0.
for grp in spi gpio dialout; do
    if getent group "${grp}" >/dev/null 2>&1; then
        usermod -aG "${grp}" "${SERVICE_USER}" && log "added to group ${grp}"
    else
        log "group ${grp} does not exist on this image, skipping"
    fi
done

# -----------------------------------------------------------------------------
#  Program files
# -----------------------------------------------------------------------------
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" \
    "${HOME_DIR}" "${HOME_DIR}/lightning_data"

for f in quaggasklip_detector.py find_irq_pin.py check_campbell_link.py \
         requirements.txt README.md; do
    if [ -f "${SRC_DIR}/${f}" ]; then
        install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0644 \
            "${SRC_DIR}/${f}" "${HOME_DIR}/${f}"
    else
        log "WARNING: ${f} missing from ${SRC_DIR}"
    fi
done
chmod 0755 "${HOME_DIR}/quaggasklip_detector.py" \
           "${HOME_DIR}/find_irq_pin.py" \
           "${HOME_DIR}/check_campbell_link.py" 2>/dev/null || true

# The config carries the panel token, so it is never overwritten once placed and
# is readable only by the service user.
if [ -f "${HOME_DIR}/quaggasklip_config.json" ]; then
    log "keeping the existing quaggasklip_config.json (it holds the token)"
else
    install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0600 \
        "${SRC_DIR}/quaggasklip_config.json" \
        "${HOME_DIR}/quaggasklip_config.json"
    log "installed quaggasklip_config.json - set alert_webhook_token before use"
fi

if [ -d "${SRC_DIR}/campbell" ]; then
    install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${HOME_DIR}/campbell"
    install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0644 \
        "${SRC_DIR}/campbell/"* "${HOME_DIR}/campbell/" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
#  systemd unit
# -----------------------------------------------------------------------------
install -m 0644 "${SRC_DIR}/${UNIT}" "/etc/systemd/system/${UNIT}" \
    || die "could not install ${UNIT}"
systemctl daemon-reload
systemctl enable "${UNIT}" >/dev/null 2>&1 && log "enabled ${UNIT}"

# Not started here. The IRQ pin has to be confirmed first, and a detector
# running on the wrong pin looks healthy while seeing nothing.
log "service enabled but NOT started - see the steps below"

touch "${MARKER}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${MARKER}"

# -----------------------------------------------------------------------------
#  What is left to do
# -----------------------------------------------------------------------------
echo
echo "============================================================"
echo " Installed. Remaining steps, in order:"
echo "============================================================"
if [ "${REBOOT_NEEDED}" -eq 1 ]; then
    echo
    echo " 1. REBOOT. The UART and SPI changes need it."
    echo "      sudo reboot"
else
    echo
    echo " 1. No reboot needed: SPI and the UART were already configured."
fi
cat <<'STEPS'

 2. Confirm which GPIO carries the sensor interrupt. Socket 2's INT is
    GPIO12 on the Pi 3 shield and GPIO19 on the Pi 2 shield, so this is
    not a guess worth making:
      sudo python3 /home/quaggasklip/find_irq_pin.py
    Put the answer in /home/quaggasklip/quaggasklip_config.json as "irq_pin".

 3. Check the logger link. Jumper TX to RX on the Terminal 2 Click first:
      sudo -u quaggasklip python3 /home/quaggasklip/check_campbell_link.py --loopback
    Then remove the jumper, wire TX to the CR300's C2 and GND to G, and:
      sudo -u quaggasklip python3 /home/quaggasklip/check_campbell_link.py --send

 4. Set the panel token in /home/quaggasklip/quaggasklip_config.json:
      "alert_webhook_token": "<the value held by the admin panel>"
      "alert_webhook_enabled": true
    Do not reuse another site's token.

 5. Start it and watch:
      sudo systemctl start quaggasklip
      journalctl -u quaggasklip -f

 6. Tune the antenna once, on site:
      the daily 06:00 check adjusts the tuning capacitor one step at a time,
      so give it a few days, or set tune_cap directly if it is already known.
STEPS
echo
log "install complete"
