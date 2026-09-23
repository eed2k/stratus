#!/usr/bin/env python3
"""Stop the detector sending health records to the Campbell logger.

Health belongs to the admin panel. The deployed build had no way to switch the
Campbell status string off, only an interval capped at one day, so this adds a
proper flag defaulted off. The admin panel webhook is left untouched.
"""
import json
import shutil
import subprocess
import sys
import time

PATH = "/home/quaggasklip/lightning_detector.py"
CFG = "/home/quaggasklip/lightning_config.json"

EDITS = [
    (
        "        self.CAMPBELL_HEARTBEAT_INTERVAL = 600   # 10 minutes\n",
        "        self.CAMPBELL_HEARTBEAT_ENABLED = False  # health goes to the panel\n"
        "        self.CAMPBELL_HEARTBEAT_INTERVAL = 600\n",
    ),
    (
        '        "CAMPBELL_HEARTBEAT_INTERVAL": (int, 60, 86400),\n',
        '        "CAMPBELL_HEARTBEAT_ENABLED": (bool, None, None),\n'
        '        "CAMPBELL_HEARTBEAT_INTERVAL": (int, 60, 86400),\n',
    ),
    (
        "        campbell_due = (now - self._last_campbell_heartbeat\n"
        "                        >= self.config.CAMPBELL_HEARTBEAT_INTERVAL)\n",
        "        campbell_due = (self.config.CAMPBELL_HEARTBEAT_ENABLED\n"
        "                        and now - self._last_campbell_heartbeat\n"
        "                        >= self.config.CAMPBELL_HEARTBEAT_INTERVAL)\n",
    ),
    (
        '        """Drive periodic health tasks: local log, Campbell status string\n'
        '        (every 10 min) and the hourly admin-panel liveness webhook."""\n',
        '        """Drive periodic health tasks: local log and the hourly\n'
        '        admin-panel liveness webhook. No health is sent to the logger."""\n',
    ),
]

src = open(PATH, encoding="utf-8").read()

if "CAMPBELL_HEARTBEAT_ENABLED" in src:
    print("  flag already present, checking config only")
else:
    for n, (old, new) in enumerate(EDITS, 1):
        c = src.count(old)
        if c != 1:
            sys.exit("  edit %d matched %d times, expected 1. Nothing written.\n"
                     "  anchor: %r" % (n, c, old[:70]))
        src = src.replace(old, new)
    compile(src, PATH, "exec")
    backup = PATH + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(PATH, backup)
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print("  patched %d edits, backup %s" % (len(EDITS), backup))

with open(CFG, encoding="utf-8") as f:
    cfg = json.load(f)
cfg["campbell_heartbeat_enabled"] = False
cfg["campbell_heartbeat_interval"] = 86400
cfg["campbell_uart_invert"] = True
with open(CFG, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, sort_keys=True)
    f.write("\n")

for k in ("campbell_heartbeat_enabled", "campbell_heartbeat_interval",
          "campbell_uart_invert", "campbell_uart_tx_pin", "campbell_uart_baud",
          "heartbeat_webhook_interval", "irq_pin", "tune_cap",
          "pulse_mirror_pin"):
    print("  %-28s = %s" % (k, cfg.get(k)))

subprocess.run(["systemctl", "restart", "lightning-detector"], check=False)
time.sleep(12)
out = subprocess.run(
    ["journalctl", "-u", "lightning-detector", "--since", "-40s", "--no-pager"],
    capture_output=True, text=True).stdout
print("  --- startup ---")
for line in out.splitlines():
    if any(k in line for k in ("Campbell", "IRQ Pin", "Traceback", "rror",
                               "nvalid")):
        print("  " + line.split("]: ")[-1])
print("  active: ", end="")
print(subprocess.run(["systemctl", "is-active", "lightning-detector"],
                     capture_output=True, text=True).stdout.strip())
