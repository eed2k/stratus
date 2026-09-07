#!/bin/bash
# =========================================================================
#
#  Stratus Wall Dashboard Kiosk
#  BeagleBone installer: boots the board into a full-screen dashboard over
#  HDMI.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
# =============================================================================
# Stratus BeagleBone kiosk installer.
#
# Run once on the BeagleBone Black, as root (sudo), after it has network access:
#   sudo ./install.sh
#
# It installs a minimal X + Chromium stack (no desktop environment), copies the
# kiosk launcher into /opt/stratus-kiosk, installs the config and the systemd
# service, and enables the service so the board boots straight into the
# dashboard on the HDMI output.
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root: sudo ./install.sh" >&2
    exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="/opt/stratus-kiosk"
KIOSK_USER="${KIOSK_USER:-debian}"

echo "==> Installing packages (X server, Chromium, helpers)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# chromium is named 'chromium' on Debian 11/12; older images use
# 'chromium-browser'. Try the first that resolves.
CHROME_PKG=""
for pkg in chromium chromium-browser; do
    if apt-get install -y --no-install-recommends "$pkg" 2>/dev/null; then
        CHROME_PKG="$pkg"; break
    fi
done
if [ -z "$CHROME_PKG" ]; then
    echo "Could not install a Chromium package automatically." >&2
    echo "Install one manually (apt-get install chromium) and re-run." >&2
    exit 1
fi
apt-get install -y --no-install-recommends \
    xserver-xorg xinit x11-xserver-utils xterm unclutter ca-certificates

echo "==> Installing kiosk files into $DEST"
install -d "$DEST"
install -m 0755 "$HERE/start-kiosk.sh" "$DEST/start-kiosk.sh"

echo "==> Installing configuration"
if [ ! -f /etc/stratus-kiosk.env ]; then
    install -m 0644 "$HERE/kiosk.env.example" /etc/stratus-kiosk.env
    echo "    Wrote /etc/stratus-kiosk.env - EDIT IT and set STRATUS_KIOSK_URL."
else
    echo "    /etc/stratus-kiosk.env already exists, left unchanged."
fi

echo "==> Installing systemd service"
# Substitute the kiosk user into the unit if it differs from the default.
sed "s/^User=debian/User=${KIOSK_USER}/; s/^Group=debian/Group=${KIOSK_USER}/" \
    "$HERE/stratus-kiosk.service" > /etc/systemd/system/stratus-kiosk.service

# Allow the kiosk user to start X on the console.
if [ -f /etc/X11/Xwrapper.config ]; then
    sed -i 's/^allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config || true
    grep -q '^needs_root_rights' /etc/X11/Xwrapper.config \
        || echo 'needs_root_rights=yes' >> /etc/X11/Xwrapper.config
else
    printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config
fi

systemctl daemon-reload
systemctl enable stratus-kiosk.service

echo
echo "==> Done."
echo "    1. Edit the URL:   sudo nano /etc/stratus-kiosk.env"
echo "    2. Connect Wi-Fi:  sudo $HERE/setup-wifi.sh   (or see README.md)"
echo "    3. Start now:      sudo systemctl start stratus-kiosk"
echo "    4. Or reboot and it comes up on the HDMI screen automatically."
echo "    Logs:              journalctl -u stratus-kiosk -f"
