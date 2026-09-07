#!/bin/bash
# =========================================================================
#
#  Stratus Wall Dashboard Kiosk
#  BeagleBone wifi provisioning.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
# =============================================================================
# Connect a BeagleBone Black to Wi-Fi via a USB dongle.
#
# BeagleBone Debian images vary in which network manager they ship, so this
# script detects the one present and uses it. Run as root:
#
#   sudo ./setup-wifi.sh "MyNetwork" "MyPassword"
#
# For a cellular (MTN) USB modem instead of Wi-Fi, see the README: the command
# is a one-liner with nmcli/ModemManager and the APN "internet".
# =============================================================================
set -euo pipefail

SSID="${1:-}"
PSK="${2:-}"

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root: sudo ./setup-wifi.sh SSID PASSWORD" >&2
    exit 1
fi
if [ -z "$SSID" ]; then
    echo "Usage: sudo ./setup-wifi.sh \"SSID\" \"PASSWORD\"" >&2
    exit 1
fi

echo "==> Looking for a wireless interface..."
ip link show 2>/dev/null | awk -F': ' '/wl/{print "    found "$2}' || true

if command -v nmcli >/dev/null 2>&1; then
    echo "==> Using NetworkManager (nmcli)"
    nmcli radio wifi on || true
    nmcli device wifi rescan || true
    nmcli device wifi connect "$SSID" password "$PSK"
    nmcli connection modify "$SSID" connection.autoconnect yes || true
    echo "==> Connected. Address:"; ip -4 addr show | awk '/inet /{print "    "$2}'
    exit 0
fi

if command -v connmanctl >/dev/null 2>&1; then
    echo "==> Using connman (connmanctl)"
    echo "    connman is interactive. Run these commands:"
    cat <<EOF
      connmanctl
        enable wifi
        scan wifi
        services                 # note the wifi_..._managed_psk id for "$SSID"
        agent on
        connect wifi_XXXX_managed_psk
        # enter the passphrase when prompted
        quit
EOF
    echo "    Then it reconnects automatically on boot."
    exit 0
fi

# Fall back to wpa_supplicant + the classic Debian interfaces file.
echo "==> Using wpa_supplicant fallback"
WIFI_IF=$(ls /sys/class/net | grep -E '^wl' | head -1 || true)
if [ -z "$WIFI_IF" ]; then
    echo "No wireless interface found. Is the USB dongle plugged in and supported?" >&2
    echo "Check: lsusb ; dmesg | grep -i firmware" >&2
    exit 1
fi
mkdir -p /etc/wpa_supplicant
wpa_passphrase "$SSID" "$PSK" > "/etc/wpa_supplicant/wpa_supplicant-$WIFI_IF.conf"
chmod 600 "/etc/wpa_supplicant/wpa_supplicant-$WIFI_IF.conf"
systemctl enable "wpa_supplicant@$WIFI_IF" 2>/dev/null || true
systemctl restart "wpa_supplicant@$WIFI_IF" 2>/dev/null || true
if command -v dhclient >/dev/null 2>&1; then
    dhclient "$WIFI_IF" || true
fi
echo "==> Configured $WIFI_IF for $SSID. Address:"; ip -4 addr show "$WIFI_IF" | awk '/inet /{print "    "$2}'
