# Flashing the GWLD1 detector Pi from scratch

For the **Raspberry Pi Zero W** running the AS3935 lightning detector.

Read the two hard constraints first. Getting either wrong produces a Pi that
looks fine but never works.

---

## Two things that will break it

**1. It must be a 32-bit image.** The Zero W is ARMv6. Every 64-bit Raspberry Pi
OS image needs ARMv8 (Zero 2 W, Pi 3 or newer) and will not boot here. In
Raspberry Pi Imager the 32-bit builds are under *Raspberry Pi OS (other)*.

**2. The username must be `gwld1`.** Not `pi`, not your name. The service unit
hardcodes it and there is no way around it without editing several files:

```ini
User=gwld1
WorkingDirectory=/home/gwld1
ExecStart=/usr/bin/python3 /home/gwld1/lightning_detector.py
```

`install.sh` also waits for `/home/gwld1` to exist and gives up after 180
seconds if it never appears.

---

## Which image

The card you have now reports:

```
Raspberry Pi reference 2026-06-18   (pi-gen, stage4)
```

stage4 is the **full desktop** build. It works, but it is heavy for 512 MB of
RAM and a single ARMv6 core on a headless field unit.

**Recommended: Raspberry Pi OS Lite (32-bit).** Less to update, less to go
wrong, noticeably lighter. `install.sh` now installs the GPIO packages that Lite
omits, so this is safe.

If you would rather change nothing, use the same 32-bit desktop image. Both work.

---

## Step 1 — Flash with Raspberry Pi Imager 2.0

Imager 2.0 is a six-screen wizard. Download it from
<https://www.raspberrypi.com/software/>.

**Screen 1 — Raspberry Pi Device:** `Raspberry Pi Zero`

Choosing the device first matters: Imager then filters the OS list to images
that actually run on ARMv6, which is the simplest way to avoid picking a 64-bit
build by mistake.

**Screen 2 — Operating System:** `Raspberry Pi OS (other)` →
`Raspberry Pi OS Lite (32-bit)`

**Screen 3 — Storage:** your SD card. Check the reported size matches the card,
not another drive.

**Screen 4 — Configure your system:**

| Field | Value |
| --- | --- |
| Hostname | `lightning-detector` |
| Username | `gwld1` — mandatory, see above |
| Password | your choice |
| Wireless LAN SSID | your site SSID (the current one is in `network-config`) |
| Wireless LAN password | the site passphrase |
| Wireless LAN country | `ZA` |
| Time zone | `Africa/Johannesburg` |
| Keyboard layout | `za` |
| Enable SSH | yes, **public-key only** |
| Public key | paste the single line from `gwld1-deploy/authorized_keys` |
| Raspberry Pi Connect | leave **off** |

The key in `gwld1-deploy/authorized_keys` (ed25519, comment `stratus-deploy`) is
the same one as `%USERPROFILE%\.ssh\pi_gwld1.pub`, so pasting either works and
`ssh -i` with your existing private key will be accepted.

Leave Raspberry Pi Connect off — it is a third remote-access channel you do not
need alongside SSH and Tailscale, and it phones home continuously.

If this screen offers **interface options**, enable **SPI** and the **serial
port (hardware, not console)**. If it does not, Step 2 sets them anyway; doing
both is harmless.

**Screen 5 — Write:** confirm the erase warning.

**Screen 6 — Done.** Remove and re-insert the card so Windows mounts the boot
partition, which appears as **`bootfs`**.

---

## Step 2 — Hardware settings (do not skip)

Imager does **not** configure the sensor interfaces. A default `config.txt`
gives you a Pi that boots and is reachable but cannot talk to the AS3935 at all.

Append to the end of **`config.txt`** on `bootfs`:

```ini
[all]
# --- AS3935 sensor bus (NOT optional) ---
dtparam=spi=on

# --- serial console, recovery path only ---
# Independent of the Campbell output, which is a bit-banged UART on GPIO26
# driven by pigpio and controlled from lightning_config.json.
enable_uart=1

# --- power: radios and peripherals this unit does not use ---
dtoverlay=disable-bt
dtparam=act_led_trigger=none
dtparam=act_led_activelow=off
dtparam=audio=off
camera_auto_detect=0
display_auto_detect=0
gpu_mem=16
max_framebuffers=1
arm_freq=800

# --- USB gadget for maintenance over the data port ---
dtoverlay=dwc2,dr_mode=peripheral
```

And change the existing KMS overlay line from `dtoverlay=vc4-kms-v3d` to:

```ini
dtoverlay=vc4-kms-v3d,no-hdmi
```

**Check `dtparam=spi=on` is not commented out.** A stock image ships it as
`#dtparam=spi=on`. Enabling SPI in Imager's interface options does *not* always
uncomment it, and a substring search will match the commented text and mislead
you. Grep for it anchored:

```bash
grep -E '^[[:space:]]*dtparam=spi=on' config.txt
```

Without SPI the Pi boots, joins WiFi, posts heartbeats and detects nothing.

What each does, so you can judge changes later:

- `dtparam=spi=on` — the AS3935 is on SPI. Without it the detector cannot read
  the sensor.
- `enable_uart=1` — serial line to the Campbell logger.
- `dtoverlay=disable-bt` — Bluetooth off, saves power on a solar site.
- `act_led_*` — activity LED off, saves a little more power.
- `dtoverlay=dwc2,dr_mode=peripheral` — puts the USB port in device mode so the
  Pi appears as a network adapter to your laptop.
- `arm_freq=800` — underclocked from 1000 MHz for lower power and heat.

Then edit **`cmdline.txt`** and add this to the existing text:

```
modules-load=dwc2,g_ether
```

**`cmdline.txt` must stay a single line.** A newline anywhere in it stops the
Pi booting. Add the parameter with a space, do not press Enter.

---

## Step 3 — Copy the deploy bundle

Copy the whole **`gwld1-deploy`** folder to the root of `bootfs`.

Confirm it contains all ten files:

```
authorized_keys              install_tailscale_pi.sh    lightning-detector.service
calibrate_scan.py            lightning_config.json      pi_harden_power_rugged.sh
install.sh                   lightning_detector.py      README.txt
send_test_heartbeat.py
```

There must be **no `.installed` file**. That marker makes `install.sh` exit
immediately, and it is the single most common reason a re-deploy appears to do
nothing.

---

## Step 4 — First boot and install

Boot the Pi and give it two or three minutes to expand the filesystem, join
WiFi and create the user.

**Connect over WiFi**, which Imager has already configured:

```bash
ssh -i %USERPROFILE%\.ssh\pi_gwld1 gwld1@lightning-detector.local
```

If `.local` does not resolve, find the address in your router's client list, or
`ping lightning-detector`.

> **Why not USB?** The fixed `192.168.7.2` address on the USB gadget comes from
> cloud-init's `network-config`. With Imager's customisation there is no
> cloud-init, so `g_ether` loads but `usb0` gets no IPv4 address and the laptop
> cannot reach it. WiFi is the path of least resistance for first contact.
>
> To restore the USB address afterwards, over SSH (Raspberry Pi OS uses
> NetworkManager):
>
> ```bash
> sudo nmcli con add type ethernet ifname usb0 con-name usb0-static \
>   ip4 192.168.7.2/24
> sudo nmcli con mod usb0-static ipv4.method manual
> sudo nmcli con up usb0-static
> ```
>
> Then set your laptop's RNDIS adapter to `192.168.7.1 / 255.255.255.0`, no
> gateway, and `ssh gwld1@192.168.7.2` works as before. Worth doing: it gives
> you a way in when WiFi is down, which on a remote site is exactly when you
> need one.

Run the deploy once:

```bash
sudo bash /boot/firmware/gwld1-deploy/install.sh
journalctl -t gwld1-deploy --no-pager
```

That installs the GPIO dependencies, copies the project into `/home/gwld1`,
installs and starts the service, and applies the hardening script. It is
idempotent, so re-running it is safe.

> On older images the boot partition is `/boot` rather than `/boot/firmware`.
> `install.sh` detects both, so use whichever path exists.

---

## Step 5 — Verify

```bash
systemctl status lightning-detector
python3 /home/gwld1/send_test_heartbeat.py
```

Expect `HTTP 200` and `{"status":"ok"}`. The script diagnoses failures: 401 is a
token mismatch, 404 a wrong path, 422 a bad payload, and it prints connectivity
checks when the host cannot be reached.

Then watch the real thing:

```bash
sudo journalctl -u lightning-detector -f
```

Look for `System ready - listening for lightning events...` followed by
`Heartbeat webhook sent`. A restart posts a heartbeat immediately rather than an
hour later, because startup deliberately backdates the timer.

Finally, check the panel:

```
https://adminpanel.stratusweather.co.za/gwld1/stations
```

The unit appears as **GLENCORE WONDERKOP**, already assigned to the gwld1
client. Heartbeats are telemetry only and cannot trigger an SMS.

> Do not change `station_id` in `lightning_config.json` without assigning the
> new name on the panel first. The panel files an unrecognised unit under the
> platform tenant, where it stays invisible to this client — it will look like
> the heartbeat vanished even though it returned 200.

---

## Alternative: keep cloud-init

Your existing card seeds cloud-init from the boot partition rather than using
Imager's customisation. Raspberry Pi OS does now support this, but it is the
more fragile of the two routes, and there is a known bug where cloud-init runs
before the boot volume is mounted and fails to read `meta-data`.

If you want it anyway, skip Imager's Edit Settings and instead copy these to
`bootfs` alongside `gwld1-deploy`:

```
user-data        users, packages, timezone, and the runcmd that calls install.sh
meta-data        instance-id
network-config   WiFi credentials, and usb0 fixed at 192.168.7.2
```

and add to `cmdline.txt` (still one line):

```
ds=nocloud;i=gwld1-usbgadget-20260821
```

**The instance-id must match in both places.** Cloud-init runs `runcmd` once per
instance-id, so to make it deploy again you change the date in *both*
`cmdline.txt` and `meta-data`, and delete `.installed`. Changing only one of the
three is why a re-deploy silently does nothing.

On a fresh card none of that applies — the id has never been seen, so it runs.

---

## After it is running

| What | Where |
| --- | --- |
| Service state | `systemctl status lightning-detector` |
| Detector log | `journalctl -u lightning-detector -f` |
| Deploy log | `journalctl -t gwld1-deploy` |
| Hardening log | `/var/log/gwld1-harden.log` |
| Strike data | `/home/gwld1/lightning_data` |
| Live config | `/home/gwld1/lightning_config.json` |

Note that `pi_harden_power_rugged.sh` **disables SSH password authentication**.
Keep `.ssh/pi_gwld1` safe; after hardening runs, the key is the only way in
apart from a serial console.

Optional remote access from anywhere is staged at
`/home/gwld1/install_tailscale_pi.sh` — see
`Lightning Detector/remote_access/REMOTE_ACCESS.md`.
