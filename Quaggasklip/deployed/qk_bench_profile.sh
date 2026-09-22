#!/bin/bash
# Switch the detector between production tuning and bench tuning for emulator
# testing, and back again.
#
# Usage: qk_bench_profile.sh bench
#        qk_bench_profile.sh production
#
# WHY EACH CHANGE
#
#   min_strikes 5 -> 1
#       This is the AS3935 MIN_NUM_LIGH field: the number of lightning events it
#       wants before it raises an interrupt at all. At 5 the first four emulated
#       strikes produce nothing and look like a dead rig.
#
#   validation_buffer_enabled true -> false
#       _flush_validation_buffer holds strikes for 30 s and then discards any
#       batch sitting entirely at validation_emi_distance_km, which is 1 km, with
#       no corroborating storm context. An emulator 10 cm from the antenna
#       produces precisely that signature, so the panel alert would be filtered
#       as EMI and the test would look like a failure of the webhook.
#
#   interference_guard_enabled true -> false
#       More than 12 strikes in 10 s starts a 180 s cooldown during which
#       send_lightning to the Campbell logger is skipped. Easy to trip when
#       pressing buttons.
#
# DELIBERATELY UNCHANGED
#
#   mask_disturber stays true, so anything that reaches the log was classified as
#   lightning by the sensor rather than being any RF noise that happened past. It
#   is what keeps the test meaningful.
#
#   tune_cap stays 9 and irq_pin stays 6. Those are measured values, not tuning
#   preferences.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -euo pipefail

MODE=${1:-}
CFG=/home/quaggasklip/lightning_config.json
STAMP=$(date +%Y%m%d-%H%M%S)

if [ "$MODE" != "bench" ] && [ "$MODE" != "production" ]; then
  echo "usage: $0 bench|production"
  exit 2
fi

cp -a "$CFG" "$CFG.bak-$MODE-$STAMP"

python3 - "$MODE" <<'PY'
import json
import sys

mode = sys.argv[1]
path = "/home/quaggasklip/lightning_config.json"

BENCH = {
    "min_strikes": 1,
    "validation_buffer_enabled": False,
    "interference_guard_enabled": False,
}
PRODUCTION = {
    "min_strikes": 5,
    "validation_buffer_enabled": True,
    "interference_guard_enabled": True,
}

wanted = BENCH if mode == "bench" else PRODUCTION

with open(path) as f:
    cfg = json.load(f)

print("  applying the %s profile" % mode)
for key, new in wanted.items():
    print("    %-30s %s -> %s" % (key, cfg.get(key), new))
    cfg[key] = new

# These are measured, not preferences. Assert rather than set, so a mistake here
# is loud instead of silent.
for key, expect in (("irq_pin", 6), ("tune_cap", 9)):
    if cfg.get(key) != expect:
        sys.exit("REFUSING: %s is %s, expected %s. Investigate before testing."
                 % (key, cfg.get(key), expect))
print("    irq_pin 6 and tune_cap 9 confirmed intact")

with open(path, "w") as f:
    json.dump(cfg, f, indent=2, sort_keys=True)
    f.write("\n")
PY

sudo systemctl restart lightning-detector
sleep 12
echo -n "  active: "; systemctl is-active lightning-detector

echo
echo "=== BANNER ==="
sudo journalctl -u lightning-detector -n 40 --no-pager \
  | grep -E "IRQ Pin|Tune Cap|Min Strikes|Noise Floor|Mask Disturber|Pulse Mirror|Campbell UART|System ready" \
  || true

echo
echo "=== CONFIG WARNINGS ==="
sudo journalctl -u lightning-detector -n 60 --no-pager | grep -i "Config:" || echo "  none"
