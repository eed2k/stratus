#!/bin/bash
# Runtime power savings. No reboot, nothing that can cost network access.
#
# KEPT DELIBERATELY, do not disable these:
#   NetworkManager, wpa_supplicant  the only link to the unit
#   tailscaled                      remote access across networks
#   ssh                             fallback access
#   pigpiod                         the detector bit-bangs serial through it
#   lightning-detector              the job
#   systemd-timesyncd               no RTC on this board, clock comes from NTP
#   logrotate.timer                 stops the log filling the card
#   cloud-init*                     boot-time only, and it owns provisioning
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

DISABLE_SERVICES="
bluetooth.service
avahi-daemon.service
udisks2.service
getty@tty1.service
NetworkManager-wait-online.service
"

DISABLE_SOCKETS="
avahi-daemon.socket
"

DISABLE_TIMERS="
apt-daily.timer
apt-daily-upgrade.timer
man-db.timer
e2scrub_all.timer
dpkg-db-backup.timer
"

echo "=== BEFORE ==="
echo -n "  running services: "
systemctl list-units --type=service --state=running --no-legend --no-pager | wc -l
echo -n "  temp: "; vcgencmd measure_temp 2>/dev/null

echo
echo "=== DISABLING UNUSED UNITS ==="
for u in $DISABLE_SERVICES $DISABLE_SOCKETS $DISABLE_TIMERS; do
  if systemctl list-unit-files "$u" --no-legend --no-pager 2>/dev/null | grep -q .; then
    sudo systemctl disable --now "$u" >/dev/null 2>&1
    state=$(systemctl is-active "$u" 2>/dev/null)
    echo "  $u -> $state"
  else
    echo "  $u -> not present"
  fi
done

echo
echo "=== BLUETOOTH ==="
# The radio is already off via dtoverlay=disable-bt, so the stack had nothing to
# manage. rfkill confirms rather than assumes.
sudo rfkill block bluetooth 2>/dev/null || true
rfkill list 2>/dev/null | head -8 || echo "  rfkill unavailable"

echo
echo "=== VERIFY NOTHING ESSENTIAL DIED ==="
FAIL=0
for u in NetworkManager wpa_supplicant tailscaled ssh pigpiod lightning-detector \
         systemd-timesyncd; do
  s=$(systemctl is-active "$u" 2>/dev/null)
  printf "  %-24s %s\n" "$u" "$s"
  [ "$s" = "active" ] || FAIL=1
done

echo
echo "=== CONNECTIVITY ==="
ip -brief addr show wlan0 | sed 's/^/  /'
echo -n "  default route: "; ip route get 1.1.1.1 2>/dev/null | head -1
echo -n "  tailscale0: "; ip -brief addr show tailscale0 2>/dev/null | awk '{print $3}'
timeout 8 tailscale status 2>&1 | head -3 | sed 's/^/  /'

echo
echo "=== AFTER ==="
echo -n "  running services: "
systemctl list-units --type=service --state=running --no-legend --no-pager | wc -l
echo -n "  temp: "; vcgencmd measure_temp 2>/dev/null
echo -n "  throttled: "; vcgencmd get_throttled 2>/dev/null

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "  WARNING: an essential service is not active. Review before rebooting."
  exit 1
fi
echo
echo "  all essential services still active"
