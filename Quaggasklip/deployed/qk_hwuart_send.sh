#!/bin/bash
# Send the record through the Pi's HARDWARE UART instead of pigpio.
#
# WHY THIS IS WORTH DOING
# Every test so far has transmitted with pigpio's wave_add_serial, a software
# bit-bang. The bit timing measured correctly, 105 us against 104.167 nominal, but
# that only proves the edges are where they should be on the Pi's own pad. It does
# not exercise the UART peripheral, and it is not how Campbell's guidance or any
# normal Pi-to-logger link works. This uses /dev/ttyS0 and the real UART, which is
# an entirely independent transmit path.
#
# The prerequisites are already satisfied on this unit: enable_uart=1 is set, the
# serial login shell is disabled, and serial-getty@ttyS0 is masked, so nothing
# competes for the port.
#
# ONE THING HAS TO BE UNDONE FIRST
# pigpio has been holding GPIO 14 as a plain OUTPUT, which overrides the pin's
# ALT0 UART function. The kernel driver will not get the pin back until that is
# released, so the mode is set to ALT0 explicitly before sending, and the detector
# is stopped so pigpio does not reclaim it mid-test.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

COUNT=${1:-3}

restore() {
  echo
  echo "=== RESTARTING lightning-detector ==="
  echo "    it will set GPIO 14 back to a pigpio output on startup"
  sudo systemctl start lightning-detector
  sleep 8
  echo -n "  active: "; systemctl is-active lightning-detector
}
trap restore EXIT

echo "=== PREREQUISITES ==="
echo -n "  enable_uart in config.txt : "; grep -c "enable_uart=1" /boot/firmware/config.txt
echo -n "  serial-getty@ttyS0        : "; systemctl is-enabled serial-getty@ttyS0 2>&1
echo -n "  /dev/serial0 points to    : "; readlink -f /dev/serial0 2>&1
echo -n "  anyone holding ttyS0      : "; (sudo fuser /dev/ttyS0 2>&1 || echo "nobody")

echo
echo "=== STOPPING lightning-detector, releasing GPIO 14 from pigpio ==="
sudo systemctl stop lightning-detector
sleep 3

sudo python3 - <<'PY'
import pigpio
pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")
print("  GPIO 14 mode before: %d  (1 = plain OUTPUT, pigpio holding it)"
      % pi.get_mode(14))
# ALT0 is the UART function on GPIO 14 and 15 for this SoC.
pi.set_mode(14, pigpio.ALT0)
print("  GPIO 14 mode after : %d  (4 = ALT0, the UART peripheral has it)"
      % pi.get_mode(14))
pi.stop()
PY

echo
echo "=== CONFIGURE THE PORT: 9600 8N1, raw ==="
sudo stty -F /dev/ttyS0 9600 cs8 -cstopb -parenb -crtscts raw -echo
sudo stty -F /dev/ttyS0 -a | head -2

echo
echo "=== SEND $COUNT RECORDS THROUGH THE HARDWARE UART ==="
for i in $(seq 1 "$COUNT"); do
  printf 'L,40,1234567\r\n' | sudo tee /dev/ttyS0 > /dev/null
  echo "  $i  sent L,40,1234567 via /dev/ttyS0"
  sleep 1
done

echo
echo "=== READ ON THE CR300 ==="
echo "  MaxBytesWaiting  above 0 means bytes reached C2"
echo "  StrikeCount      3 means the whole path works"
echo "  StrikeBody       ,40,1234567"
echo
echo "  If the hardware UART lands where pigpio did not, the fault was the"
echo "  software bit-bang and the detector should be moved to pyserial on"
echo "  /dev/ttyS0. If neither lands, the transmit path is not the problem."
