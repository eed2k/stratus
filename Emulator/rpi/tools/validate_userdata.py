# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Bench card check: validates the cloud-init user-data before staging.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
"""Validate the cloud-init user-data before it goes anywhere near the card.

A YAML error here is expensive: cloud-init would fail to create emulator1, and
with no network and no other account there would be no way into the box short of
reimaging. So parse it, then assert on the fields that must survive intact.
"""
import os
import sys

try:
    import yaml
except ImportError:
    print("pyyaml not installed locally, cannot validate. Install it first:")
    print("  python -m pip install pyyaml")
    sys.exit(2)

# This file lives at Emulator/rpi/tools/, so the user-data sits one level up in
# boot/. Derived rather than hardcoded so it works from any checkout.
PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "boot", "user-data"))
ORIGINAL_HASH = "$y$jB5$9NHPHRa9LZnNodaRt7ZGb/$/2PcKIjuFz369VUhODvH81Ak5g7hSsjtBQQw/XJ.IM5"
ORIGINAL_KEY = ("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOxe24Ihqo4ZRqAOZAyWTdbEN"
                "2YfA0PZfFOxSwU1xUq6")

raw = open(PATH, encoding="utf-8").read()

failures = []


def check(label, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if not ok:
        failures.append(label)


check("starts with the #cloud-config header",
      raw.splitlines()[0].strip() == "#cloud-config",
      repr(raw.splitlines()[0][:40]))
check("no literal tab characters", "\t" not in raw,
      "tabs: %d" % raw.count("\t"))

try:
    doc = yaml.safe_load(raw)
    check("parses as YAML", True, "top-level keys: %d" % len(doc))
except Exception as exc:  # noqa: BLE001
    check("parses as YAML", False, str(exc))
    print("\nRESULT: FAIL - do not write this to the card")
    sys.exit(1)

check("hostname preserved", doc.get("hostname") == "lightningemulator1",
      repr(doc.get("hostname")))
check("timezone preserved", doc.get("timezone") == "Africa/Johannesburg",
      repr(doc.get("timezone")))
check("manage_etc_hosts preserved", doc.get("manage_etc_hosts") is True)
check("ssh_pwauth still false", doc.get("ssh_pwauth") is False)
check("apt.preserve_sources_list preserved",
      doc.get("apt", {}).get("preserve_sources_list") is True)
check("keyboard layout za preserved",
      doc.get("keyboard", {}).get("layout") == "za")

user = doc.get("user") or {}
check("user name is emulator1", user.get("name") == "emulator1", repr(user.get("name")))
check("shell preserved", user.get("shell") == "/bin/bash")
check("lock_passwd false so console login works", user.get("lock_passwd") is False)
check("password hash byte-for-byte identical", user.get("passwd") == ORIGINAL_HASH)
check("hash was not mangled by YAML escaping",
      user.get("passwd", "").count("$") == 4,
      "dollar signs: %d (expected 4)" % user.get("passwd", "").count("$"))
check("ssh key preserved",
      user.get("ssh_authorized_keys") == [ORIGINAL_KEY])

check("packages key removed", "packages" not in doc,
      "present: %s" % ("packages" in doc))

runcmd = doc.get("runcmd") or []
check("runcmd has 4 entries", len(runcmd) == 4, "got %d" % len(runcmd))
flat = [" ".join(c) if isinstance(c, list) else str(c) for c in runcmd]
for i, c in enumerate(flat):
    print("        runcmd[%d]: %s" % (i, c[:110]))
check("ssh enable retained", any("enable --now ssh" in c for c in flat))
check("rfkill unblock retained", any("rfkill unblock wifi" in c for c in flat))
check("rfkill loop retained", any(":wlan" in c for c in flat))
check("installer invoked through bash",
      any("bash /boot/firmware/emulator/install.sh" in c for c in flat))
check("installer output is logged",
      any("/var/log/lightning-emulator-install.log" in c for c in flat))
check("installer cannot abort cloud-init",
      any("install.sh" in c and "|| true" in c for c in flat))

print()
if failures:
    print("RESULT: FAIL - do not write this to the card")
    for f in failures:
        print("  - " + f)
    sys.exit(1)
print("RESULT: PASS - safe to write to the card")
