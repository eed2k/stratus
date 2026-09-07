#!/bin/bash
# =========================================================================
#
#  Stratus Wall Dashboard Kiosk
#  BeagleBone kiosk launcher.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
# =============================================================================
# Stratus kiosk launcher (runs inside an X session started by stratus-kiosk.service)
#
# Responsibilities:
#   - stop the screen ever blanking or sleeping (a wall display must stay on)
#   - hide the mouse cursor
#   - wait for the network so the first load is not an error page
#   - launch Chromium full screen at the configured URL
#   - relaunch it if it ever exits, so a transient crash self-heals
#
# It is deliberately a plain shell loop rather than a desktop environment: the
# BeagleBone Black has limited memory, and a full LXDE/XFCE session is wasted on
# a board whose only job is to show one page.
# =============================================================================
set -u

# Load configuration (URL etc.). Falls back to sane defaults if absent.
ENV_FILE="/etc/stratus-kiosk.env"
STRATUS_KIOSK_URL="https://stratusweather.co.za/"
STRATUS_KIOSK_NETWORK_WAIT=20
STRATUS_KIOSK_ROTATE=0
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# ---- keep the screen awake ----
xset s off || true
xset -dpms || true
xset s noblank || true

# Optional 180 degree rotation for an inverted mount.
if [ "${STRATUS_KIOSK_ROTATE:-0}" = "1" ]; then
    OUT=$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')
    [ -n "$OUT" ] && xrandr --output "$OUT" --rotate inverted || true
fi

# Hide the cursor after half a second of inactivity.
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 -root &

# ---- wait for the network ----
# A wall board over Wi-Fi or a cellular dongle is not up the instant X starts.
end=$(( $(date +%s) + ${STRATUS_KIOSK_NETWORK_WAIT:-20} ))
while [ "$(date +%s)" -lt "$end" ]; do
    if ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; then break; fi
    sleep 1
done

# ---- pick whichever Chromium binary the image ships ----
CHROME=""
for bin in chromium-browser chromium chromium-bin; do
    if command -v "$bin" >/dev/null 2>&1; then CHROME="$bin"; break; fi
done
if [ -z "$CHROME" ]; then
    echo "stratus-kiosk: no chromium binary found; install chromium first" >&2
    # Show something on screen rather than a black panel.
    command -v xmessage >/dev/null 2>&1 && \
        xmessage -center "Stratus kiosk: Chromium is not installed. Run install.sh." || sleep 30
    exit 1
fi

# A fresh profile each boot avoids the "restore pages?" bar after a power cut.
PROFILE="$(mktemp -d /tmp/stratus-kiosk-XXXXXX)"

# ---- run, and relaunch on exit ----
while true; do
    "$CHROME" \
        --kiosk \
        --incognito \
        --noerrdialogs \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-features=TranslateUI \
        --check-for-update-interval=31536000 \
        --overscroll-history-navigation=0 \
        --disable-pinch \
        --user-data-dir="$PROFILE" \
        --app="$STRATUS_KIOSK_URL" \
        "$STRATUS_KIOSK_URL"
    echo "stratus-kiosk: browser exited, relaunching in 3s" >&2
    sleep 3
done
