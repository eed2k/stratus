"""Validate the staged emulator bench card before it is booted.

Malformed cloud-config does not raise an error the user ever sees: cloud-init
skips it, the Pi boots, and the rig looks healthy while nothing was provisioned.
So check it here, where a failure is visible.

Property of METRON (PTY) LTD | Inteltronics
Developed by L.J. Esterhuizen, Inteltronics
"""
import re
import sys
from pathlib import Path

CARD = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/")
BENCH_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIK1cQ1n3+aa3AYpnUaraJgqeVG/keqbpuzyv1Qmij/ot"
EMULATOR_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIK1cQ1n3+aa3AYpnUaraJgqeVG/keqbpuzyv1Qmij/ot"

passed = failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    globals().__setitem__("passed" if ok else "failed",
                          (passed + 1) if ok else (failed + 1))


ud = (CARD / "user-data").read_text(errors="replace")
nc = (CARD / "network-config").read_text(errors="replace")
cfg = (CARD / "config.txt").read_text(errors="replace")
cl = (CARD / "cmdline.txt").read_text(errors="replace")

print("=== cloud-config parses ===")
try:
    import yaml
    doc = yaml.safe_load(ud)
    ck("user-data is valid YAML", isinstance(doc, dict))
    ck("user-data starts with the cloud-config header",
       ud.lstrip().startswith("#cloud-config"),
       "cloud-init ignores the file without it")
    keys = (doc.get("user") or {}).get("ssh_authorized_keys") or []
    ck("exactly one authorised key", len(keys) == 1, "found %d" % len(keys))
    ck("it is the dedicated bench key", any(BENCH_KEY in k for k in keys))
    ck("the emulator key is gone", not any(EMULATOR_KEY in k for k in keys))
    ck("password auth stays off over SSH", doc.get("ssh_pwauth") is False,
       "the password remains the console fallback")
    ck("the user is still emulator1",
       (doc.get("user") or {}).get("name") == "emulator1")
    ck("the password hash was left intact",
       bool((doc.get("user") or {}).get("passwd")),
       "this is the only way in if the key is wrong")
    run = doc.get("runcmd") or []
    flat = " ".join(str(x) for x in run)
    ck("ssh is enabled on boot", "systemctl" in flat and "ssh" in flat)
    ck("install.sh is invoked", "install.sh" in flat)
    ck("the install log is captured",
       "lightning-emulator-install.log" in flat)

    ndoc = yaml.safe_load(nc)
    ck("network-config is valid YAML", isinstance(ndoc, dict))
    eth = ((ndoc.get("network") or {}).get("ethernets") or {}).get("usb0") or {}
    ck("usb0 is defined", bool(eth))
    ck("usb0 has a static address",
       any(a.startswith("10.55.0.1/") for a in (eth.get("addresses") or [])),
       str(eth.get("addresses")))
    ck("usb0 is optional", eth.get("optional") is True,
       "otherwise the Pi stalls at boot with no cable plugged in")
    ck("no DHCP on usb0", eth.get("dhcp4") is False,
       "there is no DHCP server on a gadget link")
except ImportError:
    print("SKIP  PyYAML not installed, falling back to text checks")
    ck("user-data starts with the cloud-config header",
       ud.lstrip().startswith("#cloud-config"))
    ck("exactly one authorised key",
       len(re.findall(r"ssh-(?:ed25519|rsa) AAAA", ud)) == 1)
    ck("it is the dedicated bench key", BENCH_KEY in ud)
    ck("the emulator key is gone", EMULATOR_KEY not in ud)
    ck("usb0 is defined", "usb0" in nc)
    ck("usb0 has a static address", "10.55.0.1/24" in nc)
    ck("no tab characters in the YAML",
       "\t" not in ud and "\t" not in nc,
       "tabs make cloud-init reject the file")

print()
print("=== boot configuration ===")
ck("dwc2 in peripheral mode", "dtoverlay=dwc2,dr_mode=peripheral" in cfg)

# The overlay has to be under [all], not inside a model-specific block, or it
# applies to a board this is not and silently does nothing.
section = "[all]"
for line in cfg.splitlines():
    s = line.strip()
    if s.startswith("[") and s.endswith("]"):
        section = s
    if s == "dtoverlay=dwc2,dr_mode=peripheral":
        break
ck("the overlay sits under [all]", section == "[all]",
   "found under %s" % section)

ck("I2C is still enabled", "dtparam=i2c_arm=on" in cfg,
   "the DAC is on I2C, so this is not optional")
ck("I2C is still at 100 kHz", "i2c_arm_baudrate=100000" in cfg,
   "400 kHz would compress the waveform about threefold")

cl1 = cl.strip()
ck("cmdline is a single line", "\n" not in cl1)
ck("g_ether is requested", "modules-load=dwc2,g_ether" in cl1)
ck("root is intact", "root=PARTUUID=" in cl1)
ck("rootfstype is intact", "rootfstype=ext4" in cl1)
ck("the instance id was rewritten",
   "i=rpi-imager-" not in cl1 and "ds=nocloud;i=emulator-usb-" in cl1,
   "a fresh id is what makes cloud-init run install.sh again")
ck("not the detector card", "3f606ee6-02" not in cl1)

print()
print("=== payload still on the card ===")
for f in ("install.sh", "lightning_emulator.py",
          "lightning-emulator.service", "README.txt"):
    ck("emulator/%s present" % f, (CARD / "emulator" / f).is_file())

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
