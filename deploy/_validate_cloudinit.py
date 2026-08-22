"""Validate the cloud-init YAML on the card before booting.

A syntax error in user-data means cloud-init creates no user. Combined with
ssh_pwauth: false that is a lockout with no way in short of re-flashing, so this
is worth checking before the card ever goes near the Pi.

Secrets are never printed.
"""
from __future__ import annotations

import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BOOT = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/")

try:
    import yaml
except ImportError:
    print("PyYAML not installed; install with: python -m pip install pyyaml")
    sys.exit(3)

ok = True

for name in ("user-data", "network-config"):
    p = BOOT / name
    print("=" * 70)
    print(name)
    print("=" * 70)
    if not p.is_file():
        print("  ABSENT")
        ok = False
        continue
    text = p.read_text(encoding="utf-8", errors="replace")
    # cloud-config files start with a #cloud-config comment line, which is
    # legal YAML, so no special handling is needed.
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        print(f"  INVALID YAML: {exc}")
        ok = False
        continue
    print("  YAML parses cleanly")
    if not isinstance(doc, dict):
        print(f"  unexpected top level: {type(doc).__name__}")
        ok = False
        continue
    print(f"  top-level keys: {', '.join(sorted(doc))}")

    if name == "user-data":
        users = doc.get("users") or []
        names = [u.get("name") for u in users if isinstance(u, dict)]
        print(f"  users defined: {names}")
        if "gwld1" not in names:
            print("  FAIL: no gwld1 user - the service would not run")
            ok = False
        else:
            u = next(x for x in users if x.get("name") == "gwld1")
            print(f"    has password hash : {bool(u.get('passwd'))}")
            keys = u.get("ssh_authorized_keys") or []
            print(f"    ssh keys          : {len(keys)}")
            if not keys:
                print("    FAIL: no ssh key and ssh_pwauth is false -> lockout")
                ok = False
            groups = str(u.get("groups", ""))
            for g in ("sudo", "spi", "gpio"):
                have = g in groups
                print(f"    in group {g:<5}    : {have}")
                if not have:
                    print(f"      WARNING: detector may need {g}")
        print(f"  ssh_pwauth        : {doc.get('ssh_pwauth')}")
        rc = doc.get("runcmd") or []
        print(f"  runcmd entries    : {len(rc)}")
        for entry in rc:
            print(f"    {entry}")
        if not any("install.sh" in str(e) for e in rc):
            print("  FAIL: nothing calls install.sh")
            ok = False

    if name == "network-config":
        net = doc.get("network") or {}
        eth = net.get("ethernets") or {}
        wifi = net.get("wifis") or {}
        print(f"  ethernets: {', '.join(sorted(eth))}")
        print(f"  wifis    : {', '.join(sorted(wifi))}")
        if "usb0" not in eth:
            print("  FAIL: usb0 missing")
            ok = False
        else:
            print(f"    usb0 addresses: {eth['usb0'].get('addresses')}")
        if "wlan0" not in wifi:
            print("  WARNING: no wlan0, the Pi will have no WiFi")
        else:
            aps = (wifi["wlan0"].get("access-points") or {})
            print(f"    wlan0 SSIDs configured: {len(aps)}")
    print()

print("=" * 70)
print("PASS - safe to boot" if ok else "FAIL - fix before booting")
print("=" * 70)
sys.exit(0 if ok else 1)
