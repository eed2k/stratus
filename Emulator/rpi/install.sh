#!/bin/bash
# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Installer: service unit, I2C, user groups and script deployment.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
# Install the AS3935 lightning emulator on a Raspberry Pi OS Lite box.
#
# Fully offline and idempotent. Run it as many times as you like:
#
#   sudo /boot/firmware/emulator/install.sh
#
# NOTHING IS DOWNLOADED. The emulator's two third-party imports, smbus2 and
# gpiozero, are already on Raspberry Pi OS Lite: pi-gen stage2 installs
# python3-smbus2, python3-gpiozero and python3-rpi-lgpio as standard. That is
# what makes a WiFi-less bench box workable, and it is why this script verifies
# the imports rather than trying to apt-get them.
set -u

BOOT_DIR="/boot/firmware"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="/opt/lightning-emulator"
SERVICE="lightning-emulator.service"
DEFAULTS="/etc/default/lightning-emulator"
EMU_USER="emulator1"

fail=0
note()  { printf '  %s\n' "$*"; }
ok()    { printf 'OK    %s\n' "$*"; }
warn()  { printf 'WARN  %s\n' "$*"; }
bad()   { printf 'FAIL  %s\n' "$*"; fail=$((fail + 1)); }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo:  sudo $0" >&2
  exit 1
fi

echo "=== AS3935 lightning emulator, offline install ==="
echo "source: $SRC_DIR"
echo

# ---------------------------------------------------------------------------
# 1. Payload
# ---------------------------------------------------------------------------
echo "--- script ---"
if [ ! -f "$SRC_DIR/lightning_emulator.py" ]; then
  bad "lightning_emulator.py not found in $SRC_DIR"
else
  install -d -m 0755 "$DEST_DIR"
  # Compare before copying so re-running does not needlessly restart the
  # service on an unchanged file.
  if [ -f "$DEST_DIR/lightning_emulator.py" ] && \
     cmp -s "$SRC_DIR/lightning_emulator.py" "$DEST_DIR/lightning_emulator.py"; then
    ok "lightning_emulator.py already current"
    script_changed=0
  else
    install -m 0755 "$SRC_DIR/lightning_emulator.py" "$DEST_DIR/lightning_emulator.py"
    ok "installed $DEST_DIR/lightning_emulator.py"
    script_changed=1
  fi
  python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" \
    "$DEST_DIR/lightning_emulator.py" 2>/dev/null \
    && ok "script parses" || bad "script does not parse"
fi

# ---------------------------------------------------------------------------
# 2. Dependencies: verify, never install
# ---------------------------------------------------------------------------
echo
echo "--- dependencies (expected preinstalled, nothing is downloaded) ---"
for mod in smbus2 gpiozero; do
  if python3 -c "import $mod" 2>/dev/null; then
    ok "python3 -c 'import $mod'"
  else
    bad "$mod missing. Unexpected on Pi OS Lite. With no network you will need"
    note "the .deb side-loaded: python3-$mod"
  fi
done
# gpiozero is useless without a pin backend. rpi-lgpio presents itself as
# RPi.GPIO, so this is the import that proves the backend is really there.
if python3 -c "import RPi.GPIO" 2>/dev/null; then
  ok "pin backend present (RPi.GPIO via rpi-lgpio)"
else
  warn "no RPi.GPIO backend. gpiozero may still find lgpio or native."
fi

# ---------------------------------------------------------------------------
# 3. I2C
# ---------------------------------------------------------------------------
echo
echo "--- I2C ---"
CONFIG_TXT="$BOOT_DIR/config.txt"
[ -f "$CONFIG_TXT" ] || CONFIG_TXT="/boot/config.txt"

reboot_needed=0
if [ ! -f "$CONFIG_TXT" ]; then
  bad "no config.txt found at $BOOT_DIR/config.txt or /boot/config.txt"
else
  # An active setting is an uncommented dtparam line. The stock image ships the
  # line commented out, so a plain grep for the string matches and would make
  # this look already done.
  if grep -Eq '^[[:space:]]*dtparam=i2c_arm=on' "$CONFIG_TXT"; then
    ok "i2c_arm already enabled in $CONFIG_TXT"
  else
    cp -n "$CONFIG_TXT" "$CONFIG_TXT.bak-emulator" 2>/dev/null || true
    if grep -Eq '^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on' "$CONFIG_TXT"; then
      sed -i 's/^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on.*/dtparam=i2c_arm=on/' "$CONFIG_TXT"
      ok "uncommented dtparam=i2c_arm=on"
    else
      printf '\n# Added by the lightning emulator installer.\ndtparam=i2c_arm=on\n' >> "$CONFIG_TXT"
      ok "appended dtparam=i2c_arm=on"
    fi
    reboot_needed=1
  fi

  # The emulator documents its timing against a 100 kHz bus, which is also the
  # default, so this is belt and braces rather than a change of behaviour.
  if grep -Eq '^[[:space:]]*dtparam=i2c_arm_baudrate=' "$CONFIG_TXT"; then
    ok "i2c_arm_baudrate already set: $(grep -Eo 'i2c_arm_baudrate=[0-9]+' "$CONFIG_TXT" | head -1)"
  else
    printf 'dtparam=i2c_arm_baudrate=100000\n' >> "$CONFIG_TXT"
    ok "appended dtparam=i2c_arm_baudrate=100000"
    reboot_needed=1
  fi
fi

# i2c-dev gives us /dev/i2c-N. On current images it is autoloaded, but make it
# explicit so a fresh boot cannot come up without it.
if [ -d /etc/modules-load.d ]; then
  if [ -f /etc/modules-load.d/i2c-emulator.conf ]; then
    ok "i2c-dev module-load entry present"
  else
    echo "i2c-dev" > /etc/modules-load.d/i2c-emulator.conf
    ok "wrote /etc/modules-load.d/i2c-emulator.conf"
  fi
fi
modprobe i2c-dev 2>/dev/null || true

if compgen -G "/dev/i2c-*" > /dev/null; then
  ok "device nodes: $(echo /dev/i2c-*)"
else
  warn "no /dev/i2c-* yet. Expected before the first reboot."
  reboot_needed=1
fi

# ---------------------------------------------------------------------------
# 4. Groups
# ---------------------------------------------------------------------------
echo
echo "--- user and groups ---"
if id "$EMU_USER" >/dev/null 2>&1; then
  ok "user $EMU_USER exists"
  for grp in i2c gpio spi; do
    if ! getent group "$grp" >/dev/null 2>&1; then
      warn "group $grp does not exist, skipping"
      continue
    fi
    if id -nG "$EMU_USER" | tr ' ' '\n' | grep -qx "$grp"; then
      ok "$EMU_USER already in $grp"
    else
      usermod -aG "$grp" "$EMU_USER" && ok "added $EMU_USER to $grp" \
        || bad "could not add $EMU_USER to $grp"
    fi
  done
  note "Group changes apply on next login. The service picks them up from"
  note "SupplementaryGroups regardless, so it does not need a logout."
else
  bad "user $EMU_USER not found. Change EMU_USER at the top of this script,"
  note "or check that cloud-init finished: cloud-init status --long"
fi

# ---------------------------------------------------------------------------
# 5. Service
# ---------------------------------------------------------------------------
echo
echo "--- service ---"
if [ ! -f "$DEFAULTS" ]; then
  cat > "$DEFAULTS" <<'EOF'
# Extra flags for lightning-emulator.service. --headless is already in the unit.
#
#   --storm-on-hold   hold FAR for 1.5s to run the 9 strike storm sequence.
#                     FAR then fires on release rather than on press.
#   --pace loop       per sample writes with a 22 us gap, matching the Arduino
#                     sketch, instead of one batched ioctl per burst.
#   --pins C,M,F,LED  override the pin map if the shield is not a MIKROE-1513.
#
EMU_ARGS=""
EOF
  ok "wrote $DEFAULTS"
else
  ok "$DEFAULTS already present, left alone"
fi

if [ ! -f "$SRC_DIR/$SERVICE" ]; then
  bad "$SERVICE not found in $SRC_DIR"
else
  if [ -f "/etc/systemd/system/$SERVICE" ] && \
     cmp -s "$SRC_DIR/$SERVICE" "/etc/systemd/system/$SERVICE"; then
    ok "$SERVICE already current"
  else
    install -m 0644 "$SRC_DIR/$SERVICE" "/etc/systemd/system/$SERVICE"
    ok "installed /etc/systemd/system/$SERVICE"
  fi
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1 && ok "enabled $SERVICE" \
    || bad "could not enable $SERVICE"

  if [ "$reboot_needed" -eq 1 ]; then
    note "Not starting it now: I2C only comes up after a reboot."
  elif [ "${script_changed:-0}" -eq 1 ] || ! systemctl is-active --quiet "$SERVICE"; then
    systemctl restart "$SERVICE" 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet "$SERVICE"; then
      ok "$SERVICE running"
    else
      warn "$SERVICE not active. Is the Click seated?"
      note "systemctl status $SERVICE"
      note "journalctl -u $SERVICE -n 40 --no-pager"
    fi
  else
    ok "$SERVICE already running"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "=== summary ==="
if [ "$fail" -ne 0 ]; then
  echo "$fail check(s) FAILED. Read the FAIL lines above before going further."
fi
if [ "$reboot_needed" -eq 1 ]; then
  echo "REBOOT REQUIRED to bring up I2C:  sudo reboot"
  echo "After the reboot:"
else
  echo "Next:"
fi
cat <<EOF
  i2cdetect -y 1                 expect 0x60 (or 0x61) for the Click's MCP4725
  systemctl status lightning-emulator
  journalctl -u lightning-emulator -f

  Buttons on the Click fire the strikes: CLOSE, MID, FAR.

  To drive it by hand instead, stop the service so it releases the pins:
    sudo systemctl stop lightning-emulator
    python3 $DEST_DIR/lightning_emulator.py               interactive
    python3 $DEST_DIR/lightning_emulator.py --probe-buttons
    python3 $DEST_DIR/lightning_emulator.py --fire close

  Coil to sensor antenna: 5 to 15 cm.
  Turn SMS alerts OFF on the panel before testing.
EOF

[ "$fail" -eq 0 ] || exit 1
exit 0
