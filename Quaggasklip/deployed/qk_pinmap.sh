#!/bin/bash
# Report which GPIO does what on this unit, read from the live config and the live
# pin modes rather than from documentation.
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
echo "=== CONFIG ==="
python3 - <<'PY'
import json
with open("/home/quaggasklip/lightning_config.json") as f:
    c = json.load(f)
print("  irq_pin              %s   AS3935 interrupt, an INPUT to the Pi" % c["irq_pin"])
print("  pulse_mirror_pin     %s   strike pulse OUT to the logger" % c["pulse_mirror_pin"])
print("  pulse_mirror_width_ms %s" % c["pulse_mirror_width_ms"])
print("  campbell_uart_tx_pin %s   serial records OUT to the logger" % c["campbell_uart_tx_pin"])
PY

echo
echo "=== LIVE PIN MODES ==="
python3 - <<'PY'
import pigpio
pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  no pigpiod")
names = {0: "INPUT", 1: "OUTPUT", 2: "ALT5", 3: "ALT4",
         4: "ALT0", 5: "ALT1", 6: "ALT2", 7: "ALT3"}
roles = {
    6:  "AS3935 IRQ in, from the sensor",
    14: "Campbell serial out, to C2",
    19: "strike pulse out, to P_SW",
    26: "retired, was the serial pin before the move to 14",
}
for g in (6, 14, 19, 26):
    m = pi.get_mode(g)
    print("  GPIO %-3d %-8s level=%d   %s"
          % (g, names.get(m, "?"), pi.read(g), roles[g]))
pi.stop()
PY

echo
echo "=== BANNER, as the detector reports itself ==="
sudo journalctl -u lightning-detector -b --no-pager 2>&1 \
  | grep -E "IRQ Pin|Pulse Mirror|Campbell UART" | tail -3
