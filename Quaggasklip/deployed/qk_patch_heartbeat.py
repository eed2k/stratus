#!/usr/bin/env python3
"""Make a failed panel heartbeat retry in a minute rather than an hour.

THE DEFECT

_heartbeat_webhook swallows every exception and returns None, and the scheduler
marks the slot spent before it is called:

    if panel_due:
        self._last_panel_heartbeat = now
        self._heartbeat_webhook(...)

So a send that fails costs a full HEARTBEAT_WEBHOOK_INTERVAL, 3600 s. This is not
hypothetical: the Pi has no real-time clock and the detector routinely starts
before DNS resolves, so the first heartbeat of a cold boot fails with
"Temporary failure in name resolution" and the unit is then absent from the admin
panel for an hour. It happened on the 09:07 boot today.

WHY NOT FIX IT IN SYSTEMD INSTEAD

Ordering the service After=network-online.target would also work, but
network-online.target took 2 minutes 12 seconds to be reached on this unit's last
boot. That would leave a lightning detector blind for those two minutes on every
power-up, which is a worse trade than a one minute reporting delay.

WHAT CHANGES

  1. _heartbeat_webhook returns True on a 2xx and False otherwise. The two early
     returns become True, because a deliberately disabled webhook is not a
     failure and must not trigger retries.
  2. On False the scheduler back-dates _last_panel_heartbeat so the next attempt
     is PANEL_HEARTBEAT_RETRY_S away instead of a full interval.

Every edit is asserted before anything is written, the original is backed up, and
the result is compiled before it replaces the live file.

Property of METRON (PTY) LTD | Inteltronics
Developed by L.J. Esterhuizen, Inteltronics
"""
import datetime
import py_compile
import shutil
import sys
import tempfile
from pathlib import Path

TARGET = Path("/home/quaggasklip/lightning_detector.py")
RETRY_CONST = "PANEL_HEARTBEAT_RETRY_S"

src = TARGET.read_text()
original = src

if RETRY_CONST in src:
    sys.exit("Already patched: %s is present. Nothing to do." % RETRY_CONST)


def sub_once(text, old, new, label):
    """Replace exactly one occurrence, or refuse."""
    n = text.count(old)
    if n != 1:
        sys.exit("REFUSING: %s matched %d times, expected exactly 1." % (label, n))
    print("  ok  %s" % label)
    return text.replace(old, new, 1)


print("=== 1. add the retry constant ===")
anchor = "SAMPLE_GAP_S"
if anchor in src:
    # Sit it beside the other module-level timing constants.
    line = [ln for ln in src.splitlines() if ln.startswith(anchor)][0]
    src = sub_once(
        src,
        line,
        line
        + "\n\n"
        + "# How soon to retry the panel heartbeat after a failed send.\n"
        + "#\n"
        + "# The scheduler marks the hourly slot spent before the send is\n"
        + "# attempted, so without this a failure costs a full interval. The Pi\n"
        + "# has no RTC and this service routinely starts before DNS resolves, so\n"
        + "# the first heartbeat of a cold boot fails and the unit would otherwise\n"
        + "# be absent from the panel for an hour.\n"
        + "%s = 60" % RETRY_CONST,
        "constant added beside %s" % anchor,
    )
else:
    # Fall back to placing it before the first class definition.
    marker = "\nclass "
    idx = src.index(marker)
    src = (
        src[:idx]
        + "\n# How soon to retry the panel heartbeat after a failed send.\n"
        + "%s = 60\n" % RETRY_CONST
        + src[idx:]
    )
    print("  ok  constant added before the first class")

print()
print("=== 2. _heartbeat_webhook reports success ===")

src = sub_once(
    src,
    """        if not self.config.ALERT_WEBHOOK_ENABLED:
            return
        url = self._heartbeat_url()
        if not url:
            return
        # WiFi RSSI is intentionally NOT sent""",
    """        if not self.config.ALERT_WEBHOOK_ENABLED:
            return True
        url = self._heartbeat_url()
        if not url:
            return True
        # WiFi RSSI is intentionally NOT sent""",
    "early returns become True, a disabled webhook is not a failure",
)

src = sub_once(
    src,
    """                if 200 <= resp.status < 300:
                    self.logger.info("Heartbeat webhook sent")
                else:
                    self.logger.warning("Heartbeat webhook HTTP %d", resp.status)
        except Exception as e:
            self.logger.warning("Heartbeat webhook failed: %s", e)""",
    """                if 200 <= resp.status < 300:
                    self.logger.info("Heartbeat webhook sent")
                    return True
                self.logger.warning("Heartbeat webhook HTTP %d", resp.status)
                return False
        except Exception as e:
            self.logger.warning("Heartbeat webhook failed: %s", e)
            return False""",
    "2xx returns True, anything else returns False",
)

print()
print("=== 3. the scheduler retries instead of burning the slot ===")

src = sub_once(
    src,
    """        if panel_due:
            self._last_panel_heartbeat = now
            self._heartbeat_webhook(cpu_temp, uptime, wifi, noise)""",
    """        if panel_due:
            self._last_panel_heartbeat = now
            if not self._heartbeat_webhook(cpu_temp, uptime, wifi, noise):
                # Back-date the slot so the next attempt is a minute away rather
                # than a full interval. Without this a cold boot that starts
                # before DNS is up hides the unit from the panel for an hour.
                self._last_panel_heartbeat = (
                    now
                    - self.config.HEARTBEAT_WEBHOOK_INTERVAL
                    + %s
                )""" % RETRY_CONST,
    "failed send schedules a retry",
)

print()
print("=== 4. verify before writing ===")
checks = [
    ("constant defined", "%s = 60" % RETRY_CONST in src),
    ("returns True on 2xx", 'self.logger.info("Heartbeat webhook sent")\n                    return True' in src),
    ("returns False on exception", 'self.logger.warning("Heartbeat webhook failed: %s", e)\n            return False' in src),
    ("scheduler checks the result", "if not self._heartbeat_webhook(" in src),
    # Window has to clear the explanatory comment that sits between the guard and
    # the assignment, which is why 400 characters was not enough.
    ("retry uses the constant",
     RETRY_CONST in src.split("if not self._heartbeat_webhook(")[1][:900]),
    ("file grew, nothing truncated", len(src) > len(original)),
    ("alert webhook untouched", original.count("def _alert_webhook") == src.count("def _alert_webhook")),
]
bad = [name for name, ok in checks if not ok]
for name, ok in checks:
    print("  %s  %s" % ("ok " if ok else "BAD", name))
if bad:
    sys.exit("REFUSING to write: " + "; ".join(bad))

print()
print("=== 5. compile the candidate ===")
with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
    fh.write(src)
    candidate = fh.name
try:
    py_compile.compile(candidate, doraise=True)
    print("  ok  compiles cleanly")
except py_compile.PyCompileError as exc:
    sys.exit("REFUSING to write, the patched file does not compile:\n%s" % exc)

print()
print("=== 6. install ===")
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
backup = TARGET.with_suffix(".py.bak-heartbeat-%s" % stamp)
shutil.copy2(TARGET, backup)
print("  backup: %s" % backup)
shutil.copymode(TARGET, candidate)
shutil.move(candidate, str(TARGET))
print("  written: %s" % TARGET)
print()
print("  restore with:")
print("    cp %s %s" % (backup, TARGET))
print("    sudo systemctl restart lightning-detector")
