# Remote access to the lightning detector

Admin-only remote access to the GWLD1 AS3935 Pi, over Tailscale, restricted to
`admin@stratusweather.co.za`.

Files here:

| File | What it is |
| --- | --- |
| `tailscale-policy.hujson` | The tailnet access policy. Paste into the Tailscale admin console. |
| `install_tailscale_pi.sh` | Idempotent installer to run on the Pi with `sudo`. |
| `validate_policy.py` | Checks the policy parses and grants nothing wider than intended. |

---

## Recommendation

**Tailscale, with Tailscale SSH, and the Pi enrolled as a tagged device.**

The reasoning, specific to this unit:

- **It works from behind the site's router with no port forwarding.** The Pi
  sits on site WiFi through a modem you do not fully control. Tailscale builds
  an outbound WireGuard connection and does NAT traversal, falling back to a
  relay when a direct path is not possible. Nothing inbound has to be opened,
  and it survives the site being behind carrier-grade NAT.
- **Nothing is exposed to the public internet.** Compare this with the previous
  `gwld1-admin.dynv6.net` approach, which meant a dynamic DNS name pointing at
  the site with a forwarded port. There is no public listener at all now.
- **Access is per-identity, not per-key.** You grant a person, not a key file.
  Tailscale SSH issues short-lived credentials based on who signed in, so there
  are no private keys to copy to admin laptops and none to chase when someone
  leaves. Sessions are attributable in the admin console audit log.
- **It will not expire on you.** The Pi is enrolled as a *tagged* device, and
  [tagged devices do not have node-key expiry](https://tailscale.com/blog/tagged-key-expiry).
  A user-enrolled device would disconnect after the tailnet's expiry period and
  you would need physical access to a unit at a remote site to recover it. This
  is the single most important detail in the whole setup.
- **It is free at this scale.** The Personal plan covers up to 6 users and 50
  tagged devices ([Tailscale docs](https://tailscale.com/kb/1114/pi-hole)), and
  Tailscale SSH policies plus groups and tags are available on
  [all plans](https://tailscale.com/kb/1337/acl-syntax). Confirm current limits
  on Tailscale's pricing page before you rely on them.

Content was rephrased for compliance with licensing restrictions.

---

## Read this before you start: the identity catch

You asked for access limited to the `admin@stratusweather.co.za` email address.
That is exactly how the policy is written, but there is a prerequisite:

> Tailscale is not an identity provider and does not support signing up with a
> plain email address. There are no Tailscale passwords.
> - [Supported SSO identity providers](https://tailscale.com/kb/1013/sso-providers/)

So `admin@stratusweather.co.za` only works as a Tailscale identity if that
address is backed by a login provider. Pick one of these:

1. **Google Workspace or Microsoft 365 on `stratusweather.co.za`** - if the
   mailbox already lives on either, you are done. Sign in with it and the
   identity Tailscale sees is literally `admin@stratusweather.co.za`, which is
   what the policy expects. No policy edit needed.
2. **A Google account created against that address** - Google lets you create
   an account using an existing non-Gmail address. Sign in to Tailscale with
   Google and the identity is again `admin@stratusweather.co.za`. Free, and no
   policy edit needed. Worth ten minutes to test before committing.
3. **Custom OIDC** - supported, and the free plan allows it for up to three
   users, but it requires publishing a WebFinger endpoint on the domain to
   prove control. More setup than this job warrants unless you already run an
   identity provider.
4. **Accept a different identity** - sign in with GitHub or a passkey and the
   identity becomes `you@github` or `you@passkey`, *not* the email address. This
   works fine, but you must then change the one line in
   `tailscale-policy.hujson` under `group:lds-admin` to match. Least friction,
   at the cost of the login not being the branded address.

Options 1 and 2 satisfy your requirement as stated. If neither is available and
you specifically want an email-address gate with no identity provider at all,
see *Alternatives* at the bottom - Cloudflare Access can do email one-time-PIN
without an IdP, and that is the one area where it genuinely beats Tailscale.

**Also**: create the tailnet by signing in *as the admin account itself*.
Whoever creates it becomes Owner. If you create it with a personal account,
that account will be Owner but will not be in `group:lds-admin`, so it will not
get SSH to the detector. It could still edit the policy to grant itself access,
but starting as the right identity avoids the confusion.

---

## What the policy actually allows

Deny-by-default. The entire granted surface is:

```
group:lds-admin  ->  tag:detector  ->  tcp:22 only
```

- `group:lds-admin` currently contains one member: `admin@stratusweather.co.za`.
- `tag:detector` is the Pi. Only members of `group:lds-admin` may apply that
  tag, so an unrelated machine cannot claim to be a detector and inherit its
  access.
- Port 22 and nothing else. The detector runs no HTTP service, so there is
  nothing else on it to reach, and a one-entry port list means a service added
  later is not exposed by accident.
- Tailscale SSH is set to `check` with a 12-hour period, so an admin re-confirms
  their identity in a browser twice a day. Change `check` to `accept` if you
  find that annoying; you lose the periodic proof of presence.
- SSH is permitted as the `gwld1` user only, not `root`. That mirrors the
  `PermitRootLogin no` decision already made in
  `detector/pi_harden_power_rugged.sh`. `gwld1` has sudo, so it can do
  everything you need.

Everything else in the tailnet is denied, including detector-to-anything.

Validate before you paste:

```bash
python validate_policy.py tailscale-policy.hujson
```

---

## Setup

### 1. Create the tailnet and apply the policy

1. Sign in at <https://login.tailscale.com> using the identity you chose above.
2. Go to **Access controls**, replace the contents with
   `tailscale-policy.hujson`, and **Save**.

   The default policy in a new tailnet is far more permissive than this one, so
   do this before enrolling anything. If Save is rejected, run
   `validate_policy.py` first; if the `grants` block specifically is refused,
   the file contains a commented-out `acls` equivalent to fall back to.

### 2. Generate a tagged auth key

**Settings → Keys → Generate auth key**:

- Set **Tags** to `tag:detector`. This is what makes the device non-expiring.
- Tick **Pre-approved** if device approval is enabled on the tailnet.
- Single-use is fine for one Pi. Make it reusable if you are enrolling several.

Copy the key. It is shown once.

### 3. Install on the Pi

Copy this folder to the Pi and run:

```bash
sudo TS_AUTHKEY='tskey-auth-...' bash install_tailscale_pi.sh
```

Or omit the key and be prompted for it, so it stays out of your shell history:

```bash
sudo bash install_tailscale_pi.sh
```

The script is idempotent, so re-running it is safe, and re-running is also how
you upgrade Tailscale on this hardware.

Two things it does that are worth knowing about:

- **It installs from the static ARM tarball, not apt.** The Pi Zero W is ARMv6.
  There is no official Tailscale build for ARMv6, and the Debian/Raspbian armhf
  packages are compiled for ARMv7 and will not run. The static 32-bit ARM
  tarball is the route that works. The trade-off is that apt will not patch
  Tailscale for you - re-run this script periodically.
- **It sets `--accept-dns=false`.** The detector resolves
  `adminpanel.stratusweather.co.za` to post strikes, heartbeats and
  calibrations. Letting Tailscale rewrite `/etc/resolv.conf` on an unattended
  remote unit introduces a way for that posting to break for reasons that have
  nothing to do with lightning. The Pi keeps its own resolver and simply does
  not use MagicDNS names.

It does not touch `lightning-detector.service`, the AS3935 wiring, pigpiod, or
your existing SSH setup, and it verifies the detector is still running before it
exits.

### 4. Confirm the enrolment

In **Machines**, the new device should show `tag:detector` and key expiry
**Disabled**. If the tag is missing, the auth key was generated without it - 
regenerate with the tag and re-run the installer.

### 5. Onboard the admin

**Users → Invite users**, send to `admin@stratusweather.co.za`. They install
Tailscale on their laptop and sign in with the provider from the identity
section above.

### 6. Connect

```bash
tailscale ssh gwld1@gwld1-detector
```

Then the usual:

```bash
sudo systemctl status lightning-detector
sudo journalctl -u lightning-detector -f
sudo systemctl restart lightning-detector
```

---

## Adding another admin

Add their login to `group:lds-admin` in the policy and Save:

```hujson
"groups": {
  "group:lds-admin": [
    "admin@stratusweather.co.za",
    "second.admin@stratusweather.co.za",
  ],
},
```

Invite them under **Users** if they are not already in the tailnet. Nothing
changes on the Pi. That is the whole point of granting to a group.

## Revoking access

- **Someone leaves**: remove them from `group:lds-admin` and Save. Effective
  across the tailnet almost immediately. Also suspend or delete the user under
  **Users** so they cannot re-enroll devices.
- **Lost or stolen laptop**: **Machines → that device → Remove**. Its node key
  is revoked straight away, so the device loses access even if it is still
  powered on and signed in.
- **Pi replaced or decommissioned**: remove the device under **Machines**. If
  the auth key was reusable, revoke it under **Settings → Keys** as well.

## Enable the policy tests once you are live

`tailscale-policy.hujson` ends with a commented-out `tests` and `sshTests`
block. They are commented out because tests fail if they reference a user who
is not yet in the tailnet, which would block your very first Save.

Once the admin has accepted the invite and the Pi is online, uncomment them.
They then act as a tripwire: a future edit that accidentally widens access, or
that drops the detector rule, gets rejected at Save time instead of failing
silently. Cheap insurance on a policy you will touch rarely and therefore not
remember well.

---

## Alternatives considered

**Cloudflare Tunnel + Cloudflare Access.** The one thing it does better:
Access can gate on a bare email address using a one-time PIN, with no identity
provider at all, which is precisely the sticking point in the identity section
above. Against it: SSH through Access needs either `cloudflared` configured as a
`ProxyCommand` on every admin machine or the browser-rendered terminal, so it is
clumsier than `tailscale ssh`; and it puts a second always-on daemon on a
512 MB ARMv6 Pi whose 32-bit ARM builds are not guaranteed to run on ARMv6 and
would need testing. Reasonable second choice, and the right choice if you cannot
get an identity provider behind that mailbox.

**Reverse SSH tunnel to the existing Vultr VPS.** `autossh` on the Pi holding a
reverse tunnel to `139.84.242.126`, admins hopping through the VPS. No third
party involved, very little running on the Pi, and the VPS is in Johannesburg so
latency is low. Against it: access control collapses to "who can SSH to the
VPS", so you are back to managing key files with no per-admin identity or audit
trail; the tunnel needs babysitting to survive network drops; and it makes the
VPS a single point of failure for reaching site. Worth keeping in your back
pocket as a **fallback path** alongside Tailscale rather than instead of it.

**Plain WireGuard with the VPS as hub.** Same shape as the option above, with
manual key distribution and no identity layer. More work than Tailscale for a
strictly worse result at this scale.

**Public port forward plus dynamic DNS** - the previous `gwld1-admin.dynv6.net`
arrangement. Puts an SSH listener on the public internet at a site you do not
control. Not recommended, and it is the thing this setup replaces.

---

## Operational notes

- **Cost on the Pi.** `tailscaled` adds roughly 40-60 MB RSS. On 512 MB with
  the detector running this is acceptable, but it is not free. The installer
  prints `free -h` before and after so you can see the real number on your
  unit rather than trusting an estimate. If memory gets tight, that is a signal
  to move to a Pi Zero 2 W rather than to drop the VPN.
- **Throughput** on an ARMv6 core is modest, because encryption happens in
  userspace. Irrelevant for SSH and log tailing, which is all this is for.
- **Your LAN fallback is intact.** Key-based SSH on the local network is
  untouched. Keep it. If Tailscale ever misbehaves, that is how you recover
  without a site visit being the only option.
- **Updates.** Re-run `install_tailscale_pi.sh` to move to the current stable
  release. It skips the download when already current, so it is cheap to run.
- **Firewall.** `ufw allow in on tailscale0` is applied by the installer and is
  already present in `detector/pi_harden_power_rugged.sh`, so the two scripts
  can run in either order.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `tailscale up` fails mentioning tags | Auth key was generated without `tag:detector`, or the signed-in user is not a tag owner. Regenerate the key with the tag set. |
| Device appears but with no tag | Same cause. Regenerate the key with the tag and re-run the installer. |
| Device shows as "needs approval" | Device approval is on for the tailnet. Approve it under **Machines**, or tick Pre-approved when generating the key. |
| `tailscale ssh` refused | Both parts of the policy are required. Confirm the `grants` entry for `tcp:22` *and* the `ssh` rule are present, and that your login is in `group:lds-admin`. |
| Connects but rejects the username | Policy permits `gwld1` only. Use `gwld1@`, not `root@` or `pi@`. |
| Daemon will not start | `journalctl -u tailscaled -n 50`. Most likely `/dev/net/tun` is missing; the installer loads the module and persists it via `/etc/modules-load.d/tun.conf`. |
| Pi fell off the tailnet after months | Should not happen on a tagged device. Check **Machines** for key expiry showing Enabled, which means the tag did not apply. |
| Detector stopped posting after install | Should not be related; the installer sets `--accept-dns=false` specifically to avoid it. Verify with `getent hosts adminpanel.stratusweather.co.za` and `journalctl -u lightning-detector -n 50`. |
