"""Finish preparing the freshly flashed boot partition for the GWLD1 detector.

Raspberry Pi Imager 2.0 wrote a working cloud-init seed (user-data, meta-data,
network-config) and already enabled SPI. This adds the five things it cannot
know about, merging into what Imager produced rather than replacing it:

  1. config.txt   - UART, Bluetooth off, LED off, USB gadget, underclock
  2. cmdline.txt  - modules-load=dwc2,g_ether for the USB gadget
  3. user-data    - runcmd that calls install.sh on first boot
  4. network-config - static 192.168.7.2 on usb0, so USB access works
  5. gwld1-deploy - the payload itself

Originals are backed up locally first. Nothing is overwritten in place without
a copy existing under backups/.

    python deploy/_prepare_sdcard.py D:/
"""
from __future__ import annotations

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
SRC = Path("RPiZero SD Card/gwld1-deploy")
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
BAK = Path("backups") / f"sdcard-preflight-{STAMP}"

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


# --------------------------------------------------------------- sanity checks
if not (BOOT / "config.txt").is_file() or not (BOOT / "cmdline.txt").is_file():
    sys.exit(f"{BOOT} does not look like a Raspberry Pi boot partition. Aborting.")
if not SRC.is_dir():
    sys.exit(f"Deploy bundle not found at {SRC}. Aborting.")

section("0. Backing up the originals")
BAK.mkdir(parents=True, exist_ok=True)
for name in ("config.txt", "cmdline.txt", "user-data", "meta-data",
             "network-config"):
    p = BOOT / name
    if p.is_file():
        shutil.copy2(p, BAK / name)
        say(f"  saved {name}")
say(f"  -> {BAK}")

# ------------------------------------------------------------------ config.txt
section("1. config.txt")
cfg_p = BOOT / "config.txt"
cfg = cfg_p.read_text(encoding="utf-8", errors="replace")

BLOCK_MARK = "# --- GWLD1 lightning detector ---"
WANT = [
    ("enable_uart=1", "serial line to the Campbell logger"),
    ("dtoverlay=disable-bt", "Bluetooth off, saves power on a solar site"),
    ("dtparam=act_led_trigger=none", "activity LED off, saves power"),
    ("dtparam=act_led_activelow=off", "activity LED off"),
    ("dtoverlay=dwc2,dr_mode=peripheral", "USB gadget mode for maintenance"),
    ("arm_freq=800", "underclock from 1000 MHz for power and heat"),
]
if BLOCK_MARK in cfg:
    say("  block already applied, leaving alone")
else:
    add = [k for k, _ in WANT if k not in cfg]
    if not add:
        say("  every setting already present")
    else:
        lines = ["", BLOCK_MARK, "[all]"]
        for k, why in WANT:
            if k in add:
                lines.append(f"{k}")
        lines.append("# --- end GWLD1 ---")
        cfg_p.write_text(cfg.rstrip("\n") + "\n" + "\n".join(lines) + "\n",
                         encoding="utf-8")
        for k in add:
            say(f"  added {k}")
say("  note: dtparam=spi=on was already set by Imager's interface options")

# ----------------------------------------------------------------- cmdline.txt
section("2. cmdline.txt")
cmd_p = BOOT / "cmdline.txt"
raw = cmd_p.read_text(encoding="utf-8", errors="replace")
toks = raw.split()
if "modules-load=dwc2,g_ether" in raw:
    say("  already has modules-load=dwc2,g_ether")
else:
    # Insert before ds=nocloud purely for readability; position is irrelevant.
    idx = next((i for i, t in enumerate(toks) if t.startswith("ds=")), len(toks))
    toks.insert(idx, "modules-load=dwc2,g_ether")
    # Single line, no trailing newline drama: the bootloader needs one line.
    cmd_p.write_text(" ".join(toks) + "\n", encoding="utf-8")
    say("  added modules-load=dwc2,g_ether")
check = cmd_p.read_text(encoding="utf-8", errors="replace")
say(f"  line count now: {len(check.strip().splitlines())}  (must be 1)")

# ------------------------------------------------------------------- user-data
section("3. user-data - run install.sh on first boot")
ud_p = BOOT / "user-data"
ud = ud_p.read_text(encoding="utf-8", errors="replace")
RUN = "runcmd:\n- [ bash, /boot/firmware/gwld1-deploy/install.sh ]\n"
if "gwld1-deploy/install.sh" in ud:
    say("  runcmd already present")
elif "runcmd:" in ud:
    say("  WARNING: a runcmd block already exists and was NOT modified.")
    say("  Add this line to it by hand:")
    say("    - [ bash, /boot/firmware/gwld1-deploy/install.sh ]")
else:
    ud_p.write_text(ud.rstrip("\n") + "\n" + RUN, encoding="utf-8")
    say("  appended runcmd calling install.sh")

# -------------------------------------------------------------- network-config
section("4. network-config - static IP on usb0")
nc_p = BOOT / "network-config"
nc = nc_p.read_text(encoding="utf-8", errors="replace")
if "usb0" in nc:
    say("  usb0 already configured")
elif "  ethernets:" not in nc:
    say("  WARNING: no 'ethernets:' block found; not modified. Add by hand:")
    say("    usb0:")
    say("      dhcp4: false")
    say("      addresses: [192.168.7.2/24]")
    say("      optional: true")
else:
    out = []
    for line in nc.splitlines():
        out.append(line)
        if line.rstrip() == "  ethernets:":
            out += [
                "    usb0:",
                "      dhcp4: false",
                "      addresses:",
                "        - 192.168.7.2/24",
                "      optional: true",
            ]
    nc_p.write_text("\n".join(out) + "\n", encoding="utf-8")
    say("  added usb0 at 192.168.7.2/24")

# ----------------------------------------------------------------- the payload
section("5. gwld1-deploy bundle")
dest = BOOT / "gwld1-deploy"
if dest.exists():
    shutil.rmtree(dest)
    say("  removed an existing copy")
shutil.copytree(SRC, dest)
files = sorted(p.name for p in dest.iterdir() if p.is_file())
say(f"  copied {len(files)} files:")
for f in files:
    say(f"    {f}")
marker = dest / ".installed"
say(f"  .installed present: {marker.exists()}  (must be False)")

# ---------------------------------------------------------------- verification
section("6. Verify")
cfg = (BOOT / "config.txt").read_text(encoding="utf-8", errors="replace")
ok = True
for k, _ in WANT + [("dtparam=spi=on", "")]:
    present = k in cfg
    ok &= present
    say(f"  config.txt  {'ok ' if present else 'MISSING'}  {k}")
raw = (BOOT / "cmdline.txt").read_text(encoding="utf-8", errors="replace")
one_line = len(raw.strip().splitlines()) == 1
has_gadget = "modules-load=dwc2,g_ether" in raw
ds = next((t for t in raw.split() if t.startswith("ds=")), "<none>")
mid = ""
mp = BOOT / "meta-data"
if mp.is_file():
    for line in mp.read_text(encoding="utf-8").splitlines():
        if line.startswith("instance-id:"):
            mid = line.split(":", 1)[1].strip()
say(f"  cmdline.txt single line      : {one_line}")
say(f"  cmdline.txt usb gadget       : {has_gadget}")
say(f"  cmdline datasource           : {ds}")
say(f"  meta-data instance-id        : {mid}")
say(f"  ids agree                    : {mid and mid in ds}")
ud = (BOOT / "user-data").read_text(encoding="utf-8", errors="replace")
say(f"  user-data calls install.sh   : {'gwld1-deploy/install.sh' in ud}")
nc = (BOOT / "network-config").read_text(encoding="utf-8", errors="replace")
say(f"  network-config has usb0      : {'usb0' in nc}")
say(f"  bundle on card               : {dest.is_dir()} ({len(files)} files)")
ok &= one_line and has_gadget and bool(mid) and (mid in ds)
ok &= "gwld1-deploy/install.sh" in ud and "usb0" in nc

section("Result")
if ok:
    say("  Card is ready. Eject safely, put it in the Pi, and power up.")
    say("  First boot runs install.sh automatically via cloud-init.")
else:
    say("  Something above is not right - review before booting.")
say()
say(f"  originals backed up to {BAK}")

Path("backups").mkdir(exist_ok=True)
Path("backups/_prepare_sdcard.txt").write_text("\n".join(log), encoding="utf-8")
