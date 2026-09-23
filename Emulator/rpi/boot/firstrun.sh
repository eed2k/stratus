#!/bin/bash
# Reinstall the emulator with the fixed systemd unit, then verify and report.
#
# WHAT WAS WRONG
# The unit had WorkingDirectory=/opt/lightning-emulator while running as
# emulator1. That directory is root-owned, and the lgpio C library creates its
# notification FIFOs (.lgd-nfy*) in the process working directory, so lgpio could
# not start:
#   xCreatePipe: Can't set permissions (436) for /opt/lightning-emulator/.lgd-nfy0
# gpiozero then fell through lgpio, rpigpio and pigpio to NativeFactory, all three
# button pins failed with EINVAL, and the script exited 1 because nothing could
# fire a strike. The Click, the DAC and I2C were all fine throughout: the earlier
# report confirmed "DAC found at 0x60 on /dev/i2c-1".
#
# The fixed unit uses RuntimeDirectory=lightning-emulator, giving
# /run/lightning-emulator owned by the service user.
#
# Runs once via systemd.run in cmdline.txt, then disarms itself. Writes its
# findings to the FAT partition so they can be read in a card reader.
set -u

BOOTDIR=/boot/firmware
DIAG=$BOOTDIR/diag
LOG=$DIAG/firstrun.log

mkdir -p "$DIAG"
exec > >(tee -a "$LOG") 2>&1

say() { echo "[firstrun2] $*"; }

say "start $(date -Is 2>/dev/null || date)"

# ------------------------------------------------------------ reinstall service
if [ -f "$BOOTDIR/emulator/install.sh" ]; then
  say "running installer with the fixed unit"
  bash "$BOOTDIR/emulator/install.sh" \
    > /var/log/lightning-emulator-install.log 2>&1 \
    || say "installer returned $?"
  cp -f /var/log/lightning-emulator-install.log "$DIAG/" 2>/dev/null || true
else
  say "installer missing at $BOOTDIR/emulator/install.sh"
fi

# Belt and braces: make sure the unit that is actually installed has the fix,
# in case install.sh copied an older copy from somewhere else.
UNIT=/etc/systemd/system/lightning-emulator.service
if [ -f "$UNIT" ] && ! grep -q "RuntimeDirectory=lightning-emulator" "$UNIT"; then
  say "installed unit lacks RuntimeDirectory, patching it directly"
  sed -i 's|^WorkingDirectory=.*|RuntimeDirectory=lightning-emulator\nWorkingDirectory=/run/lightning-emulator\nEnvironment=LG_WD=/run/lightning-emulator|' "$UNIT"
fi

systemctl daemon-reload
systemctl enable lightning-emulator >/dev/null 2>&1
systemctl restart lightning-emulator
sleep 10

say "service: $(systemctl is-active lightning-emulator 2>/dev/null)"

# ------------------------------------------------------------------ wlan0 hunt
# wlan0 did not exist at all in the previous report: absent from ip addr and from
# nmcli. That is a driver or firmware matter rather than a NetworkManager config
# one, so capture the evidence instead of guessing.
{
  echo "=== date ==="; date -Is 2>/dev/null || date
  echo
  echo "=== EMULATOR SERVICE ==="
  systemctl status lightning-emulator --no-pager 2>&1 | head -20
  echo
  echo "=== EMULATOR JOURNAL (this boot) ==="
  journalctl -u lightning-emulator -b --no-pager 2>&1 | tail -45
  echo
  echo "=== working dir and lgpio files ==="
  ls -ld /run/lightning-emulator 2>&1
  ls -la /run/lightning-emulator 2>&1
  echo
  echo "=== unit file, service section ==="
  sed -n '/^\[Service\]/,/^\[Install\]/p' /etc/systemd/system/lightning-emulator.service 2>&1 \
    | grep -vE '^\s*#|^\s*$'
  echo
  echo "=== WLAN0 INVESTIGATION ==="
  echo "-- interfaces"; ip -brief link
  echo "-- wireless drivers loaded"; lsmod | grep -iE 'brcmfmac|brcmutil|cfg80211|8021' || echo "  none"
  echo "-- dmesg brcm/wlan/firmware"
  dmesg 2>/dev/null | grep -iE 'brcm|wlan|firmware|sdio' | tail -25 || echo "  nothing"
  echo "-- firmware files present"
  ls -1 /lib/firmware/brcm/ 2>/dev/null | grep -iE '43436|43430|43455|cyfmac|brcmfmac' | head -15 \
    || echo "  no brcm firmware directory"
  echo "-- rfkill"; command -v rfkill >/dev/null && rfkill list || echo "  rfkill not installed"
  echo "-- nmcli"; nmcli -f DEVICE,TYPE,STATE,CONNECTION dev 2>&1
  nmcli -f NAME,TYPE,DEVICE con 2>&1
  echo "-- netplan rendered by cloud-init"
  cat /etc/netplan/*.yaml 2>/dev/null || echo "  none"
  echo
  echo "=== I2C ==="
  ls -l /dev/i2c* 2>&1
  python3 - <<'PY' 2>&1
try:
    from smbus2 import SMBus
    with SMBus(1) as b:
        found = []
        for a in range(0x03, 0x78):
            try:
                b.write_quick(a)
                found.append(hex(a))
            except Exception:
                pass
    print("i2c scan bus 1:", found or "nothing")
except Exception as e:
    print("i2c scan failed:", e)
PY
} > "$DIAG/boot-report2.txt" 2>&1

say "report written to $DIAG/boot-report2.txt"

CL=$BOOTDIR/cmdline.txt
if [ -f "$CL" ]; then
  sed -i 's| systemd\.run=[^ ]*||g; s| systemd\.run_success_action=[^ ]*||g; s| systemd\.unit=[^ ]*||g' "$CL"
  say "cmdline.txt disarmed"
fi

sync
say "done"
sleep 2
