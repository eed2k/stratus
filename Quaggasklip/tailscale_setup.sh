#!/bin/bash
# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  Tailscale setup: reach the detector from anywhere, on any network.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
# Puts the detector on a Tailscale tailnet so it can be reached for
# troubleshooting without the laptop and the unit sharing a network, and without
# port forwarding, a public IP or a VPN concentrator.
#
#   sudo bash tailscale_setup.sh --authkey tskey-auth-xxxxx
#   sudo bash tailscale_setup.sh --authkey tskey-auth-xxxxx --advertise-lan
#   sudo bash tailscale_setup.sh --status          # report only, change nothing
#
# WHY THE STATIC TARBALL AND NOT apt
#
# The apt package for armhf is built for ARMv7. A Pi Zero W is ARMv6
# (BCM2835, ARM1176JZF-S), so the packaged tailscaled dies immediately with
# "Illegal instruction". This is a known issue, tailscale/tailscale#6778, and the
# documented way round it is the static 32-bit ARM binaries.
#
# This unit's hardware is not fixed: the build supports a Zero W or a Zero 2 W,
# which are ARMv6 and ARMv8 respectively. So the architecture is detected at run
# time and the matching tarball is fetched. Using the tarball for BOTH keeps one
# code path and removes the chance of quietly installing an ARMv7 binary on an
# ARMv6 chip.
#
# The tradeoff, stated plainly: no automatic apt upgrades. Re-run this script to
# upgrade, which it handles: it compares versions and only replaces the binaries
# if they differ.
#
# TWO THINGS THAT MUST BE DONE IN THE ADMIN CONSOLE
#
#   1. TAG THE NODE, or its key expires and the unit silently drops off the
#      tailnet after about 180 days. A tagged device has no key expiry at all,
#      which is what you want for something on a pole. Define a tag such as
#      tag:lds in the ACL policy with yourself as owner, then pass
#      --advertise-tags=tag:lds below. This script warns if the node ends up
#      with an expiring key.
#
#   2. APPROVE THE SUBNET ROUTE if --advertise-lan is used. Advertised routes sit
#      unapproved until someone ticks them in the console.
#
set -u

TS_VER_URL="https://pkgs.tailscale.com/stable/?mode=json"
DL_BASE="https://pkgs.tailscale.com/stable"
INSTALL_DIR="/usr/local/bin"
UNIT="/etc/systemd/system/tailscaled.service"
DEFAULTS="/etc/default/tailscaled"
STATE_DIR="/var/lib/tailscale"
HOSTNAME_TS="quaggasklip-lds"

AUTHKEY=""
TAGS=""
ADVERTISE_LAN=0
STATUS_ONLY=0

fail=0
note() { printf '      %s\n' "$*"; }
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=$((fail + 1)); }
die()  { printf 'FATAL %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --authkey)        AUTHKEY="${2:-}"; shift 2 ;;
    --authkey=*)      AUTHKEY="${1#*=}"; shift ;;
    --advertise-tags) TAGS="${2:-}"; shift 2 ;;
    --advertise-tags=*) TAGS="${1#*=}"; shift ;;
    --advertise-lan)  ADVERTISE_LAN=1; shift ;;
    --hostname)       HOSTNAME_TS="${2:-}"; shift 2 ;;
    --hostname=*)     HOSTNAME_TS="${1#*=}"; shift ;;
    --status)         STATUS_ONLY=1; shift ;;
    -h|--help)        sed -n '12,50p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Status only
#
# Handled BEFORE the root check on purpose. `tailscale status` works perfectly
# well as an ordinary user, so demanding sudo just to look at the link would be
# friction for the one thing you want to run most often when something is wrong.
# ---------------------------------------------------------------------------
if [ "$STATUS_ONLY" -eq 1 ]; then
  echo "=== tailscale status ==="
  if command -v tailscale >/dev/null 2>&1; then
    tailscale --version 2>&1 | head -2
    echo
    tailscale status 2>&1 || true
    echo
    echo "--- this node ---"
    tailscale ip -4 2>&1 || true
    tailscale status --json 2>/dev/null \
      | grep -E '"(Self|TailscaleIPs|KeyExpiry|Tags|Online)"' | head -20 || true
    echo
    echo "--- service ---"
    systemctl is-active tailscaled 2>&1
    systemctl is-enabled tailscaled 2>&1
  else
    echo "tailscale is not installed"
  fi
  exit 0
fi

# Everything past here writes to the system.
[ "$(id -u)" -eq 0 ] || die "run with sudo"

echo "=== Tailscale setup for the Quaggasklip LDS ==="
echo

# ---------------------------------------------------------------------------
# 1. Architecture
# ---------------------------------------------------------------------------
echo "--- hardware ---"
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unknown)"
MACHINE="$(uname -m)"
note "model   : $MODEL"
note "uname -m: $MACHINE"

case "$MACHINE" in
  armv6l)          TS_ARCH="arm";   note "ARMv6: the apt package would crash here, tarball is required" ;;
  armv7l|armv8l)   TS_ARCH="arm" ;;
  aarch64|arm64)   TS_ARCH="arm64" ;;
  x86_64|amd64)    TS_ARCH="amd64" ;;
  *) die "unsupported architecture: $MACHINE" ;;
esac
ok "will install the '$TS_ARCH' build"

# ---------------------------------------------------------------------------
# 2. Internet, which Tailscale cannot do without
# ---------------------------------------------------------------------------
echo
echo "--- connectivity ---"
if ! ip route show default | grep -q .; then
  bad "no default route. Tailscale needs outbound internet to reach its"
  note "coordination server. Sort the WiFi out first."
  exit 1
fi
ok "default route present: $(ip route show default | head -1)"

if ! curl -fsS --max-time 20 -o /dev/null "https://pkgs.tailscale.com/stable/"; then
  bad "cannot reach pkgs.tailscale.com. Check DNS and the uplink:"
  note "  ping -c2 1.1.1.1    tests the link"
  note "  getent hosts pkgs.tailscale.com    tests DNS"
  exit 1
fi
ok "pkgs.tailscale.com reachable"

# ---------------------------------------------------------------------------
# 3. Version
# ---------------------------------------------------------------------------
echo
echo "--- version ---"
JSON="$(curl -fsS --max-time 25 "$TS_VER_URL" || true)"
VER="$(printf '%s' "$JSON" | tr ',' '\n' | grep -m1 '"TarballsVersion"' | cut -d'"' -f4)"
[ -n "$VER" ] || die "could not determine the current Tailscale version"
ok "latest stable: $VER"

HAVE=""
if [ -x "$INSTALL_DIR/tailscaled" ]; then
  HAVE="$("$INSTALL_DIR/tailscaled" --version 2>/dev/null | head -1 | tr -d ' ')"
  note "installed    : ${HAVE:-unknown}"
fi

if [ "$HAVE" = "$VER" ]; then
  ok "already at $VER, skipping the download"
  SKIP_INSTALL=1
else
  SKIP_INSTALL=0
fi

# ---------------------------------------------------------------------------
# 4. Fetch and install the binaries
# ---------------------------------------------------------------------------
if [ "$SKIP_INSTALL" -eq 0 ]; then
  echo
  echo "--- install ---"
  TGZ="tailscale_${VER}_${TS_ARCH}.tgz"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  note "downloading $TGZ"
  if ! curl -fsS --max-time 600 -o "$TMP/$TGZ" "$DL_BASE/$TGZ"; then
    bad "download failed: $DL_BASE/$TGZ"
    exit 1
  fi
  note "$(du -h "$TMP/$TGZ" | cut -f1) downloaded"

  tar -xzf "$TMP/$TGZ" -C "$TMP" || die "could not unpack $TGZ"
  SRC="$TMP/tailscale_${VER}_${TS_ARCH}"
  [ -d "$SRC" ] || die "unexpected tarball layout, $SRC missing"

  # Stop before replacing a running binary, otherwise the daemon keeps the old
  # inode and the version check on the next run disagrees with reality.
  if systemctl is-active --quiet tailscaled; then
    note "stopping tailscaled to replace the binaries"
    systemctl stop tailscaled
  fi

  install -m 0755 "$SRC/tailscaled" "$INSTALL_DIR/tailscaled"
  install -m 0755 "$SRC/tailscale"  "$INSTALL_DIR/tailscale"
  ok "installed tailscaled and tailscale into $INSTALL_DIR"

  # The tarball ships the unit file and defaults. Use them rather than writing
  # our own, so upstream changes are picked up on upgrade.
  if [ -f "$SRC/systemd/tailscaled.service" ]; then
    install -m 0644 "$SRC/systemd/tailscaled.service" "$UNIT"
    # The shipped unit expects the binaries in /usr/sbin; ours are in
    # /usr/local/bin, so point it at them.
    sed -i "s#/usr/sbin/tailscaled#$INSTALL_DIR/tailscaled#g" "$UNIT"
    sed -i "s#/usr/bin/tailscale#$INSTALL_DIR/tailscale#g" "$UNIT"
    ok "installed $UNIT"
  else
    bad "tarball had no systemd unit, cannot continue safely"
    exit 1
  fi

  if [ ! -f "$DEFAULTS" ] && [ -f "$SRC/systemd/tailscaled.defaults" ]; then
    install -m 0644 "$SRC/systemd/tailscaled.defaults" "$DEFAULTS"
    ok "installed $DEFAULTS"
  fi

  install -d -m 0700 "$STATE_DIR"
  systemctl daemon-reload
fi

# ---------------------------------------------------------------------------
# 5. Service
# ---------------------------------------------------------------------------
echo
echo "--- service ---"
systemctl enable tailscaled >/dev/null 2>&1 && ok "tailscaled enabled at boot" \
  || bad "could not enable tailscaled"
systemctl restart tailscaled
sleep 3
if systemctl is-active --quiet tailscaled; then
  ok "tailscaled running"
else
  bad "tailscaled did not start"
  note "journalctl -u tailscaled -n 40 --no-pager"
  # An ARMv6 box given an ARMv7 binary fails exactly here.
  if journalctl -u tailscaled -n 20 --no-pager 2>/dev/null | grep -qi 'illegal instruction'; then
    bad "ILLEGAL INSTRUCTION: wrong architecture build for this CPU."
    note "This is the ARMv6 trap. uname -m says $MACHINE."
  fi
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Join the tailnet
# ---------------------------------------------------------------------------
echo
echo "--- tailnet ---"
BACKEND="$("$INSTALL_DIR/tailscale" status --json 2>/dev/null | tr ',' '\n' | grep -m1 '"BackendState"' | cut -d'"' -f4 || true)"
note "backend state: ${BACKEND:-unknown}"

if [ "$BACKEND" = "Running" ]; then
  ok "already logged in, leaving the existing session alone"
else
  UP_ARGS="--hostname=$HOSTNAME_TS --ssh"
  # Do NOT take over the box's DNS. The detector resolves the panel hostname over
  # the normal uplink and rewriting /etc/resolv.conf on an appliance is a good way
  # to break something that was working.
  UP_ARGS="$UP_ARGS --accept-dns=false"

  if [ -n "$TAGS" ]; then
    UP_ARGS="$UP_ARGS --advertise-tags=$TAGS"
    note "tagging as $TAGS, which also removes key expiry"
  fi

  if [ "$ADVERTISE_LAN" -eq 1 ]; then
    LAN_CIDR="$(ip -4 -o addr show | awk '$2!="lo" {print $4}' | head -1)"
    if [ -n "$LAN_CIDR" ]; then
      # Turn the host address into its network, so 192.168.0.26/24 advertises
      # 192.168.0.0/24 rather than a single host.
      NET="$(python3 -c "import ipaddress,sys;print(ipaddress.ip_network('$LAN_CIDR',strict=False))" 2>/dev/null || true)"
      if [ -n "$NET" ]; then
        UP_ARGS="$UP_ARGS --advertise-routes=$NET"
        note "advertising $NET, which will also reach the CR300 on this LAN"
        note "REMEMBER to approve the route in the admin console"
      else
        warn "could not derive the network from $LAN_CIDR, skipping route advertising"
      fi
    fi
  fi

  if [ -n "$AUTHKEY" ]; then
    note "bringing the link up with the supplied auth key"
    # shellcheck disable=SC2086
    if "$INSTALL_DIR/tailscale" up --authkey="$AUTHKEY" $UP_ARGS; then
      ok "joined the tailnet"
    else
      bad "tailscale up failed with the supplied key"
      note "keys expire and are single-use unless made reusable. Generate a fresh"
      note "one at https://login.tailscale.com/admin/settings/keys"
      exit 1
    fi
  else
    warn "no --authkey given, so this needs a browser once"
    note "run this, then open the URL it prints:"
    note "  sudo $INSTALL_DIR/tailscale up $UP_ARGS"
    note "or re-run this script with --authkey tskey-auth-..."
  fi
fi

# ---------------------------------------------------------------------------
# 7. Verify
# ---------------------------------------------------------------------------
echo
echo "--- verification ---"
TSIP="$("$INSTALL_DIR/tailscale" ip -4 2>/dev/null | head -1 || true)"
if [ -n "$TSIP" ]; then
  ok "tailscale IPv4: $TSIP"
else
  warn "no Tailscale IP yet, the node is not logged in"
fi

"$INSTALL_DIR/tailscale" status 2>&1 | head -10 || true

# Key expiry is the trap for an unattended unit, so check for it explicitly.
if "$INSTALL_DIR/tailscale" status --json 2>/dev/null | grep -q '"KeyExpiry"'; then
  EXP="$("$INSTALL_DIR/tailscale" status --json 2>/dev/null | tr ',' '\n' | grep -m1 '"KeyExpiry"' | cut -d'"' -f4)"
  if [ -n "$EXP" ] && [ "$EXP" != "null" ]; then
    warn "THIS NODE'S KEY EXPIRES: $EXP"
    note "When it does, the unit drops off the tailnet and you lose remote access"
    note "to a device that may be on a pole. Fix it permanently by either:"
    note "  - tagging the node (tagged devices never expire), or"
    note "  - disabling key expiry for it in the admin console:"
    note "    https://login.tailscale.com/admin/machines"
  fi
else
  ok "no key expiry reported for this node"
fi

echo
echo "=== summary ==="
if [ "$fail" -ne 0 ]; then
  echo "$fail check(s) FAILED, read the FAIL lines above."
fi
cat <<EOF
  From any machine on the tailnet:
    ssh ${SUDO_USER:-quaggasklip}@${TSIP:-<tailscale-ip>}
    ssh ${SUDO_USER:-quaggasklip}@$HOSTNAME_TS        (if MagicDNS is on)

  Tailscale SSH is enabled, so access is governed by tailnet ACLs rather than
  by keys or passwords on this box.

  Useful:
    sudo bash tailscale_setup.sh --status
    tailscale status
    tailscale netcheck
    journalctl -u tailscaled -f
EOF

[ "$fail" -eq 0 ] || exit 1
exit 0
