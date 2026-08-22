"""Strip the Pi to WiFi + USB + SPI only, and fix the SPI bug.

Corrects a real defect first: config.txt shipped with `#dtparam=spi=on`, i.e.
commented out. An earlier check of mine used a plain substring test, which
matched the text inside the comment and wrongly reported SPI as enabled. The
AS3935 is on SPI, so the detector could not have read the sensor at all.

All matching here is comment-aware: a key is only "set" if it appears at the
start of a line, optionally indented, with no leading '#'.

Applied per the operator's decision:
  SPI            ON   - the AS3935 sensor bus, non-negotiable
  UART           OFF  - no Campbell logger will be connected
  pulse mirror   OFF  - GPIO19 exists to mirror IRQ pulses to a CR1000X
                        Campbell logger, so it is redundant too
  HDMI, audio, camera, DSI, Bluetooth, LED   OFF
  WiFi + USB gadget                          ON

    python deploy/_minimise_pi.sh.py D:/
"""
from __future__ import annotations

import difflib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BOOT = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/")
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
BAK = Path("backups") / f"sdcard-minimise-{STAMP}"

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


def is_set(text: str, key: str, value: str | None = None) -> bool:
    """True only if key is active (not commented) at the start of a line."""
    pat = rf"^[ \t]*{re.escape(key)}\s*=\s*"
    if value is not None:
        pat += rf"{re.escape(value)}\s*$"
    return re.search(pat, text, re.M) is not None


if not (BOOT / "config.txt").is_file():
    sys.exit(f"{BOOT} is not a Pi boot partition.")

BAK.mkdir(parents=True, exist_ok=True)
for n in ("config.txt", "cmdline.txt", "network-config"):
    if (BOOT / n).is_file():
        shutil.copy2(BOOT / n, BAK / n)
say(f"originals -> {BAK}")

# ------------------------------------------------------------------ config.txt
section("1. config.txt")
p = BOOT / "config.txt"
before = p.read_text(encoding="utf-8", errors="replace")
cfg = before

# The single most important line. It ships commented out.
if is_set(cfg, "dtparam", "spi=on") or is_set(cfg, "dtparam=spi", "on"):
    pass
if re.search(r"^[ \t]*dtparam=spi=on\s*$", cfg, re.M):
    say("  dtparam=spi=on already active")
else:
    if re.search(r"^[ \t]*#\s*dtparam=spi=on\s*$", cfg, re.M):
        cfg = re.sub(r"^[ \t]*#\s*dtparam=spi=on\s*$", "dtparam=spi=on", cfg,
                     count=1, flags=re.M)
        say("  UNCOMMENTED dtparam=spi=on   <-- the AS3935 bus, was disabled")
    else:
        cfg = cfg.rstrip("\n") + "\ndtparam=spi=on\n"
        say("  added dtparam=spi=on")

# UART off: drop the line entirely rather than set it to 0, so nothing re-reads
# a stale value. This also removes the serial console.
if re.search(r"^[ \t]*enable_uart=1\s*$", cfg, re.M):
    cfg = re.sub(r"^[ \t]*enable_uart=1\s*\n", "", cfg, flags=re.M)
    say("  removed enable_uart=1 (no Campbell logger)")
else:
    say("  enable_uart not set, nothing to remove")

# Retune the stock defaults for a headless field unit.
SWAPS = [
    (r"^[ \t]*dtparam=audio=on\s*$", "dtparam=audio=off", "audio off"),
    (r"^[ \t]*camera_auto_detect=1\s*$", "camera_auto_detect=0", "camera probe off"),
    (r"^[ \t]*display_auto_detect=1\s*$", "display_auto_detect=0", "DSI probe off"),
    (r"^[ \t]*max_framebuffers=2\s*$", "max_framebuffers=1", "one framebuffer"),
    (r"^[ \t]*dtoverlay=vc4-kms-v3d\s*$", "dtoverlay=vc4-kms-v3d,no-hdmi",
     "HDMI output off (KMS-safe method)"),
]
for pat, repl, why in SWAPS:
    if re.search(pat, cfg, re.M):
        cfg = re.sub(pat, repl, cfg, count=1, flags=re.M)
        say(f"  {repl:<38} {why}")
    elif re.search(rf"^[ \t]*{re.escape(repl)}\s*$", cfg, re.M):
        say(f"  already: {repl}")

# gpu_mem: minimum split frees RAM on a 512 MB board.
if not re.search(r"^[ \t]*gpu_mem=", cfg, re.M):
    cfg = cfg.rstrip("\n") + "\ngpu_mem=16\n"
    say("  added gpu_mem=16")
else:
    say("  gpu_mem already set")

# Collapse the duplicated [all] headers left by the earlier edit.
cfg = re.sub(r"\[all\]\s*\n\s*\n# --- GWLD1 lightning detector ---\n\[all\]\n",
             "# --- GWLD1 lightning detector ---\n[all]\n", cfg)

if cfg != before:
    p.write_text(cfg, encoding="utf-8")
    say()
    say("  diff:")
    for d in difflib.unified_diff(before.splitlines(), cfg.splitlines(),
                                  "before", "after", lineterm="", n=1):
        if d.startswith(("+++", "---", "@@")):
            continue
        if d.startswith(("+", "-")):
            say(f"    {d}")
else:
    say("  no change needed")

# ----------------------------------------------------------------- cmdline.txt
section("2. cmdline.txt - drop the serial console")
cp = BOOT / "cmdline.txt"
raw = cp.read_text(encoding="utf-8", errors="replace")
toks = raw.split()
drop = [t for t in toks if t.startswith("console=serial")]
if drop:
    toks = [t for t in toks if not t.startswith("console=serial")]
    cp.write_text(" ".join(toks) + "\n", encoding="utf-8")
    say(f"  removed {drop} (UART is off, so it pointed at a dead device)")
else:
    say("  no serial console parameter present")
say(f"  console left: {[t for t in toks if t.startswith('console=')]}")
say(f"  single line : {len(cp.read_text(encoding='utf-8').strip().splitlines()) == 1}")

# -------------------------------------------------------------- network-config
section("3. network-config - WiFi + USB only")
np_ = BOOT / "network-config"
if np_.is_file():
    nc = np_.read_text(encoding="utf-8", errors="replace")
    if re.search(r"^\s{4}eth0:", nc, re.M):
        # Remove the eth0 stanza. A Pi Zero W has no ethernet, so it is inert,
        # but the request was WiFi and USB only.
        out, skip = [], False
        for line in nc.splitlines():
            if re.match(r"^\s{4}eth0:", line):
                skip = True
                continue
            if skip:
                if re.match(r"^\s{4}\S", line) or re.match(r"^\s{0,2}\S", line):
                    skip = False
                else:
                    continue
            out.append(line)
        np_.write_text("\n".join(out) + "\n", encoding="utf-8")
        say("  removed the eth0 stanza (no ethernet hardware on a Zero W)")
    else:
        say("  no eth0 stanza")
    nc = np_.read_text(encoding="utf-8", errors="replace")
    say(f"  usb0 present : {'usb0' in nc}")
    say(f"  wlan0 present: {'wlan0' in nc}")
    say(f"  eth0 present : {'eth0' in nc}")

# ------------------------------------------------------- lightning_config.json
section("4. lightning_config.json - disable the Campbell outputs")
for target in (BOOT / "gwld1-deploy" / "lightning_config.json",
               Path("RPiZero SD Card/gwld1-deploy/lightning_config.json"),
               Path("Lightning Detector/detector/lightning_config.json")):
    if not target.is_file():
        say(f"  skip (absent): {target}")
        continue
    data = json.loads(target.read_text(encoding="utf-8"))
    changed = []
    for key in ("campbell_uart_enabled", "pulse_mirror_enabled"):
        if data.get(key) is not False:
            data[key] = False
            changed.append(key)
    if changed:
        target.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")
        say(f"  {target}")
        for k in changed:
            say(f"      {k} -> false")
    else:
        say(f"  already off: {target}")

# ---------------------------------------------------------------- verification
section("5. Verify (comment-aware)")
cfg = (BOOT / "config.txt").read_text(encoding="utf-8", errors="replace")
EXPECT_ON = ["dtparam=spi=on", "dtoverlay=disable-bt",
             "dtparam=act_led_trigger=none", "dtparam=act_led_activelow=off",
             "dtoverlay=dwc2,dr_mode=peripheral", "arm_freq=800",
             "dtparam=audio=off", "camera_auto_detect=0",
             "display_auto_detect=0", "max_framebuffers=1",
             "dtoverlay=vc4-kms-v3d,no-hdmi", "gpu_mem=16"]
EXPECT_OFF = ["enable_uart=1"]
ok = True
for line in EXPECT_ON:
    present = re.search(rf"^[ \t]*{re.escape(line)}\s*$", cfg, re.M) is not None
    ok &= present
    say(f"  {'ok ' if present else 'MISSING':<8} {line}")
for line in EXPECT_OFF:
    absent = re.search(rf"^[ \t]*{re.escape(line)}\s*$", cfg, re.M) is None
    ok &= absent
    say(f"  {'ok ' if absent else 'STILL SET':<8} {line} (should be absent)")

section("Result")
say("  Enabled : SPI (AS3935), WiFi, USB gadget")
say("  Disabled: UART, Bluetooth, HDMI, audio, camera, DSI, ACT LED,")
say("            Campbell UART output, CR1000X pulse mirror, ethernet stanza")
say()
if ok:
    say("  All checks pass. Eject the card and boot.")
else:
    say("  Something is off above - review before booting.")
say()
say("  NOTE: with UART off there is no serial console, and with HDMI off there")
say("  is no display. Recovery is SSH over WiFi, or the USB gadget at")
say("  192.168.7.2, which works even when WiFi does not.")
say(f"  originals: {BAK}")

Path("backups").mkdir(exist_ok=True)
Path("backups/_minimise_pi.txt").write_text("\n".join(log), encoding="utf-8")
