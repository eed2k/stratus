"""Inspect the freshly flashed boot partition without echoing any secrets.

Reports what Raspberry Pi Imager wrote so the deploy files can be merged in
rather than clobbering the user/WiFi/SSH settings it configured.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BOOT = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/")

SECRET_KEYS = ("passwd", "password", "hashed_passwd", "psk", "plain_text_passwd")


def redact(line: str) -> str:
    low = line.lower()
    for k in SECRET_KEYS:
        if k in low and (":" in line or "=" in line):
            indent = line[: len(line) - len(line.lstrip())]
            key = line.strip().split(":")[0].split("=")[0]
            return f"{indent}{key}: <redacted, {len(line.strip())} chars on this line>"
    # ssh public keys are not secret, but they are long
    if "ssh-ed25519" in line or "ssh-rsa" in line:
        m = re.search(r"(ssh-\w+)\s+(\S{10})", line)
        if m:
            return (line[: line.index(m.group(1))]
                    + f"{m.group(1)} {m.group(2)}... <public key, truncated>")
    return line.rstrip()


print("=" * 74)
print(f"Boot partition: {BOOT}")
print("=" * 74)
items = sorted(BOOT.iterdir(), key=lambda p: (p.is_dir(), p.name.lower()))
files = [p for p in items if p.is_file()]
dirs = [p for p in items if p.is_dir()]
print(f"  {len(files)} files, {len(dirs)} directories")
print()
print("  Files relevant to configuration:")
INTEREST = ("config.txt", "cmdline.txt", "user-data", "meta-data",
            "network-config", "custom.toml", "firstrun.sh", "ssh", "wpa_supplicant.conf")
for p in files:
    if p.name.lower() in INTEREST:
        print(f"    {p.name:<22} {p.stat().st_size:>7} bytes")
print()
print("  Deploy bundle present:", (BOOT / "gwld1-deploy").is_dir())

for name in ("user-data", "meta-data", "network-config"):
    p = BOOT / name
    print()
    print("=" * 74)
    print(f"{name}  {'(present)' if p.is_file() else '(ABSENT)'}")
    print("=" * 74)
    if not p.is_file():
        continue
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        print("  " + redact(line))

for name in ("cmdline.txt",):
    p = BOOT / name
    print()
    print("=" * 74)
    print(name)
    print("=" * 74)
    raw = p.read_text(encoding="utf-8", errors="replace")
    print(f"  newlines in file: {raw.count(chr(10))}  (must stay 0 or 1 trailing)")
    print("  content:")
    for tok in raw.strip().split():
        print(f"    {tok}")
    print()
    print("  has ds=nocloud      :", "ds=nocloud" in raw)
    print("  has dwc2 gadget     :", "modules-load=dwc2,g_ether" in raw)

p = BOOT / "config.txt"
print()
print("=" * 74)
print("config.txt - settings the detector needs")
print("=" * 74)
cfg = p.read_text(encoding="utf-8", errors="replace")
NEEDED = {
    "dtparam=spi=on": "SPI bus for the AS3935 sensor",
    "enable_uart=1": "serial line to the Campbell logger",
    "dtoverlay=disable-bt": "Bluetooth off (power saving)",
    "dtparam=act_led_trigger=none": "activity LED off (power saving)",
    "dtoverlay=dwc2,dr_mode=peripheral": "USB gadget mode",
    "arm_freq=800": "underclock for power and heat",
}
missing = []
for k, why in NEEDED.items():
    present = k in cfg
    if not present:
        missing.append(k)
    print(f"  {'present' if present else 'MISSING':<8}  {k:<36} {why}")
print()
print(f"  {len(missing)} of {len(NEEDED)} required settings missing")
