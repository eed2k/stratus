#!/usr/bin/env bash
# =============================================================================
# GWLD1 lightning detector - admin-only remote access over Tailscale
#
# Run on the Pi:
#     sudo TS_AUTHKEY='tskey-auth-xxxxx' bash install_tailscale_pi.sh
# or, to be prompted for the key instead of putting it on the command line:
#     sudo bash install_tailscale_pi.sh
#
# Idempotent: safe to re-run. Re-running also upgrades Tailscale to the current
# stable release, which is the intended way to patch it on this hardware.
#
# WHY A TARBALL AND NOT apt
#   The Pi Zero W is ARMv6. Tailscale publishes no official ARMv6 package, and
#   the Debian/Raspbian armhf packages are built for ARMv7, so they will not
#   run here. The supported route on this hardware is the static 32-bit ARM
#   tarball, which is what this script installs. The trade-off is that apt will
#   not update Tailscale for you: re-run this script to pick up a new version.
#
# WHAT THIS DOES NOT TOUCH
#   lightning-detector.service, the AS3935 wiring, pigpiod, the existing SSH
#   keys, or the existing sshd configuration. Local/LAN SSH keeps working
#   exactly as before, which is your fallback if the VPN ever misbehaves.
#   The script verifies the detector is still running before it exits.
# =============================================================================
set -euo pipefail

# --- tunables ----------------------------------------------------------------
TS_TAG="${TS_TAG:-tag:detector}"
TS_HOSTNAME="${TS_HOSTNAME:-gwld1-detector}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
# Pinned fallback, used only if the version lookup cannot reach the internet.
TS_PINNED_VERSION="1.102.3"
DETECTOR_UNIT="lightning-detector.service"

log()  { echo -e "\n=== $* ==="; }
info() { echo "    $*"; }
warn() { echo "!!  $*" >&2; }
die()  { echo "!!  $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."

# -----------------------------------------------------------------------------
log "1/9  Machine and baseline"
ARCH="$(uname -m)"
info "arch:   $ARCH"
info "kernel: $(uname -r)"
if [ -r /proc/device-tree/model ]; then
  info "model:  $(tr -d '\0' < /proc/device-tree/model)"
fi
info "memory before install:"
free -h | sed 's/^/      /'

# -----------------------------------------------------------------------------
log "2/9  Collect the auth key"
# The key must be a REUSABLE-or-single-use key generated with the tag
# pre-attached (Tailscale admin console -> Settings -> Keys -> Generate auth
# key -> tick "Pre-approved" if device approval is on, and set Tags to
# tag:detector). Tagging via the key is what makes this device non-expiring.
if [ -z "$TS_AUTHKEY" ]; then
  if [ -t 0 ]; then
    printf '    Paste the Tailscale auth key (input hidden): '
    read -rs TS_AUTHKEY
    echo
  else
    die "TS_AUTHKEY is not set and there is no terminal to prompt on."
  fi
fi
case "$TS_AUTHKEY" in
  tskey-*) info "key format looks right (value not shown)" ;;
  "")      die "No auth key supplied." ;;
  *)       warn "Key does not start with 'tskey-'. Continuing, but check it." ;;
esac

# -----------------------------------------------------------------------------
log "3/9  Kernel TUN device"
# tailscaled needs /dev/net/tun. Without it, it would fall back to userspace
# networking, which cannot accept inbound SSH to the host, so the whole point
# of this exercise would be lost.
if [ ! -c /dev/net/tun ]; then
  modprobe tun || die "Could not load the tun module; kernel lacks TUN support."
fi
echo tun > /etc/modules-load.d/tun.conf
[ -c /dev/net/tun ] || die "/dev/net/tun still missing after modprobe."
info "/dev/net/tun present"

# -----------------------------------------------------------------------------
log "4/9  Work out which build to install"
case "$ARCH" in
  armv6l)         TS_ARCH="arm";   REASON="ARMv6, static tarball is the only build that runs" ;;
  armv7l|armhf)   TS_ARCH="arm";   REASON="32-bit ARM, using the static tarball for consistency" ;;
  aarch64|arm64)  TS_ARCH="arm64"; REASON="64-bit ARM" ;;
  x86_64|amd64)   TS_ARCH="amd64"; REASON="x86-64" ;;
  *)              die "Unhandled architecture '$ARCH'. Install Tailscale manually." ;;
esac
info "$REASON -> tailscale build '$TS_ARCH'"

LATEST=""
if LATEST_JSON="$(curl -fsSL --max-time 30 --retry 3 --retry-delay 3 \
                    https://pkgs.tailscale.com/stable/?mode=json 2>/dev/null)"; then
  # Pull TarballsVersion without needing jq, which is not installed by default.
  LATEST="$(printf '%s' "$LATEST_JSON" \
            | tr -d ' \t\n' \
            | sed -n 's/.*"TarballsVersion":"\([0-9][0-9.]*\)".*/\1/p')"
fi
if [ -z "$LATEST" ]; then
  LATEST="$TS_PINNED_VERSION"
  warn "Could not look up the current version; falling back to pinned $LATEST."
else
  info "current stable: $LATEST"
fi

INSTALLED=""
if command -v tailscale >/dev/null 2>&1; then
  INSTALLED="$(tailscale version 2>/dev/null | head -1 | awk '{print $1}')" || true
  info "installed:      ${INSTALLED:-unknown}"
fi

# -----------------------------------------------------------------------------
log "5/9  Install or upgrade the binaries"
if [ -n "$INSTALLED" ] && [ "$INSTALLED" = "$LATEST" ]; then
  info "already at $LATEST, skipping download"
else
  TARBALL="tailscale_${LATEST}_${TS_ARCH}.tgz"
  URL="https://pkgs.tailscale.com/stable/${TARBALL}"
  WORK="$(mktemp -d /var/tmp/tailscale-install.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$WORK'" EXIT

  info "downloading $TARBALL"
  # Long retries because site WiFi on these units is not always healthy.
  curl -fL --max-time 900 --retry 5 --retry-delay 5 --retry-connrefused \
       -o "$WORK/$TARBALL" "$URL" \
    || die "Download failed. Check the Pi's internet connectivity."

  # Best-effort integrity check. Transport is HTTPS regardless; this is an
  # extra guard, and its absence is reported rather than silently ignored.
  if curl -fsSL --max-time 60 -o "$WORK/$TARBALL.sha256" "$URL.sha256" 2>/dev/null; then
    EXPECTED="$(tr -d ' \n' < "$WORK/$TARBALL.sha256" | sed 's/[^a-f0-9].*$//')"
    ACTUAL="$(sha256sum "$WORK/$TARBALL" | awk '{print $1}')"
    if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
      die "SHA256 mismatch. Expected $EXPECTED, got $ACTUAL. Refusing to install."
    fi
    info "sha256 verified"
  else
    warn "No published sha256 for this tarball; relied on HTTPS only."
  fi

  tar -xzf "$WORK/$TARBALL" -C "$WORK"
  SRC="$WORK/tailscale_${LATEST}_${TS_ARCH}"
  [ -d "$SRC" ] || die "Unexpected tarball layout under $WORK."

  # Stop the daemon before replacing a running binary.
  systemctl stop tailscaled 2>/dev/null || true

  install -m 0755 "$SRC/tailscale"  /usr/bin/tailscale
  install -m 0755 "$SRC/tailscaled" /usr/sbin/tailscaled
  install -d -m 0700 /var/lib/tailscale
  install -m 0644 "$SRC/systemd/tailscaled.service" /etc/systemd/system/tailscaled.service
  # Only seed the defaults file; never clobber local edits on a re-run.
  if [ ! -f /etc/default/tailscaled ]; then
    install -m 0644 "$SRC/systemd/tailscaled.defaults" /etc/default/tailscaled
    info "wrote /etc/default/tailscaled"
  else
    info "kept existing /etc/default/tailscaled"
  fi
  systemctl daemon-reload
  info "installed tailscale $LATEST"
fi

# -----------------------------------------------------------------------------
log "6/9  Start the daemon"
systemctl enable tailscaled >/dev/null 2>&1 || true
systemctl restart tailscaled
for _ in $(seq 1 30); do
  if tailscale status >/dev/null 2>&1 || tailscale status 2>&1 | grep -q .; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet tailscaled || die "tailscaled did not start. Check: journalctl -u tailscaled -n 50"
info "tailscaled active"

# -----------------------------------------------------------------------------
log "7/9  Join the tailnet"
# --accept-dns=false is deliberate and important. The detector resolves
# adminpanel.stratusweather.co.za to post strikes, heartbeats and calibrations.
# Letting Tailscale rewrite /etc/resolv.conf on an unattended remote unit adds
# a way for that posting to break for reasons unrelated to lightning. The Pi
# keeps its own resolver; MagicDNS names simply are not used on this device.
#
# --accept-routes=false keeps any subnet routes advertised elsewhere in the
# tailnet from altering this unit's routing table.
NEED_UP=1
if tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; then
  if tailscale status --json 2>/dev/null | grep -q "\"$TS_TAG\""; then
    NEED_UP=0
    info "already joined and carrying $TS_TAG, leaving the session alone"
  else
    info "joined but not carrying $TS_TAG, re-running up to fix the tag"
  fi
fi

if [ "$NEED_UP" -eq 1 ]; then
  tailscale up \
    --authkey "$TS_AUTHKEY" \
    --advertise-tags="$TS_TAG" \
    --hostname="$TS_HOSTNAME" \
    --ssh \
    --accept-dns=false \
    --accept-routes=false \
    || die "tailscale up failed. Common causes: key expired, key not authorised for $TS_TAG, or device approval pending in the admin console."
  info "joined as $TS_HOSTNAME with $TS_TAG"
fi

# -----------------------------------------------------------------------------
log "8/9  Firewall"
# pi_harden_power_rugged.sh already trusts the tailscale0 interface. Repeat it
# here so this script stands alone and so ordering between the two does not
# matter.
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | head -1 | grep -qi active; then
    ufw allow in on tailscale0 >/dev/null 2>&1 || warn "Could not add the tailscale0 ufw rule."
    info "ufw: inbound on tailscale0 allowed"
  else
    info "ufw present but inactive; nothing to change"
  fi
else
  info "ufw not installed; nothing to change"
fi

# -----------------------------------------------------------------------------
log "9/9  Verify"
TS_IP="$(tailscale ip -4 2>/dev/null | head -1)" || true
info "tailnet IPv4: ${TS_IP:-<none yet>}"
echo
echo "--- tailscale status ---"
tailscale status 2>&1 | sed 's/^/      /' || true
echo
echo "--- detector still healthy? ---"
if systemctl is-active --quiet "$DETECTOR_UNIT"; then
  info "$DETECTOR_UNIT is ACTIVE (unaffected, as intended)"
else
  warn "$DETECTOR_UNIT is NOT active. This script does not touch it, so the"
  warn "cause is almost certainly pre-existing. Check: systemctl status $DETECTOR_UNIT"
fi
echo
info "memory after install:"
free -h | sed 's/^/      /'

cat <<EOF

=== Done ===

Finish these in the Tailscale admin console, once:

  1. Access controls -> paste tailscale-policy.hujson -> Save.
     Until that policy is in place, access is governed by whatever the tailnet
     default is, which is broader than you want.

  2. Machines -> ${TS_HOSTNAME} -> confirm it shows ${TS_TAG} and that key
     expiry reads "Disabled". Tagged devices are non-expiring by default; this
     is just a check that the tag actually applied.

  3. Users -> Invite users -> admin@stratusweather.co.za, and have them sign in
     from their laptop. See REMOTE_ACCESS.md if that address is not backed by
     Google Workspace, Microsoft 365 or a custom OIDC provider, because
     Tailscale cannot sign a bare email address in.

Then, from an admin laptop that has joined the tailnet:

     tailscale ssh gwld1@${TS_HOSTNAME}

Useful once connected:

     sudo systemctl status ${DETECTOR_UNIT}
     sudo journalctl -u ${DETECTOR_UNIT} -f

Your existing key-based SSH over the local network is untouched and remains the
fallback if the VPN is ever unavailable.
EOF
