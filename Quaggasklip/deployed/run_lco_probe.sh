#!/bin/bash
# Run the LCO probe with the detector stopped, and guarantee the detector is
# brought back whatever happens.
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

restore() {
  echo
  echo "=== RESTARTING lightning-detector ==="
  sudo systemctl start lightning-detector
  sleep 8
  systemctl is-active lightning-detector
  sudo journalctl -u lightning-detector -n 12 --no-pager | tail -12
}
trap restore EXIT

echo "=== STOPPING lightning-detector (SPI and IRQ pin must be free) ==="
sudo systemctl stop lightning-detector
sleep 3
systemctl is-active lightning-detector || true
echo

echo "=== PROBE ==="
sudo python3 /tmp/as3935_lco_probe.py
