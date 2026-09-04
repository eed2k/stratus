# Stratus BeagleBone Kiosk

Turn a BeagleBone Black (BBB) into a plug-and-play wall display: it boots
straight into a full-screen Stratus dashboard on an HDMI TV or monitor, and
stays on. It is a display client only. It shows a page that
`stratusweather.co.za` already serves; it does not run the weather server
itself.

This pairs naturally with the compact dashboard, which is a single,
non-scrolling screen that scales to fill whatever display it is on.

## What you need

- BeagleBone Black (or BeagleBone Green, same image).
- A **5V 2A barrel-jack power supply**. Do not power the board from a PC USB
  port for a kiosk: driving HDMI plus a USB Wi-Fi or cellular dongle draws more
  than a USB cable provides, and the board will brown out and reboot.
- Micro-HDMI to HDMI cable to the TV or monitor.
- A USB Wi-Fi dongle with a Linux-supported chipset (Ralink/MediaTek or a
  well-supported Realtek). A powered USB hub if you also need a keyboard during
  setup, since the board has a single host USB port.
- A recent BeagleBone Debian image (Bullseye or Bookworm, IoT or minimal).

## Quick start

1. Flash a BeagleBone Debian image and boot the board. Connect over SSH (the
   USB network device at `192.168.7.2`, or Ethernet).

2. Get the files onto the board (clone the repo, or copy this `BeagleBone`
   folder with `scp`), then:

   ```bash
   cd BeagleBone
   sudo ./setup-wifi.sh "YourNetwork" "YourPassword"   # see notes below
   sudo ./install.sh
   sudo nano /etc/stratus-kiosk.env                     # set STRATUS_KIOSK_URL
   sudo systemctl start stratus-kiosk
   ```

3. Reboot to confirm it comes up on the screen by itself:

   ```bash
   sudo reboot
   ```

## Setting the dashboard URL

Edit `/etc/stratus-kiosk.env` and set `STRATUS_KIOSK_URL`. Create a share link
from the station's dashboard in Stratus, then use the compact layout for a wall
board by appending `/compact`:

```
STRATUS_KIOSK_URL="https://stratusweather.co.za/shared/<SHARE_TOKEN>/compact"
```

Apply a change with `sudo systemctl restart stratus-kiosk`.

## Wi-Fi

`setup-wifi.sh` detects whichever network tool your image uses:

- **NetworkManager** (`nmcli`): fully automatic, one command.
- **connman** (`connmanctl`): the script prints the short interactive sequence
  to run (`enable wifi`, `scan wifi`, `connect ...`).
- **wpa_supplicant**: the script writes the config and brings the interface up.

Check the dongle is seen at all:

```bash
lsusb                      # is the adapter listed?
ip a                       # is there a wlan/wlx interface?
dmesg | grep -i firmware   # any missing-firmware messages?
```

If the chipset needs firmware, `sudo apt-get install firmware-misc-nonfree`
(and `firmware-realtek` for Realtek parts), then replug the dongle.

### Cellular (MTN) dongle instead of Wi-Fi

A standard MTN LTE dongle works too. Most present as a modem after
`usb-modeswitch` (shipped on the Debian images). With NetworkManager:

```bash
sudo nmcli connection add type gsm ifname "*" con-name MTN apn internet
```

Note: cellular networks put you behind carrier-grade NAT, so the board can
reach the internet (and show the dashboard) but is not reachable from outside.
That is fine here, because the kiosk only makes outbound requests.

## How it works

- `stratus-kiosk.service` starts a bare X server on `tty1` and runs
  `start-kiosk.sh` inside it. No desktop environment, to keep memory free.
- `start-kiosk.sh` disables screen blanking and DPMS, hides the cursor, waits
  for the network, then launches Chromium in `--kiosk` mode at your URL. If
  Chromium ever exits it is relaunched after a few seconds, so a glitch or a
  power blip self-heals.
- A fresh browser profile is used each boot, so there is never a
  "restore pages?" prompt after a power cut.

## Everyday commands

```bash
sudo systemctl status stratus-kiosk     # is it running?
sudo systemctl restart stratus-kiosk    # apply a URL change / reload the page
journalctl -u stratus-kiosk -f          # live logs
```

## Troubleshooting

- **Black screen or "No Signal" after boot.** Older BBB images do not always
  enable HDMI by default. Edit `/boot/uEnv.txt`, make sure the HDMI/video
  overlay is not disabled (no `disable_uboot_overlay_video=1`), and reboot.
  Confirm the cable is in the board's micro-HDMI port, not the wrong end.
- **Screen turns off after a while.** The service disables blanking, but if you
  launched Chromium by hand, run `xset s off; xset -dpms; xset s noblank`.
- **Page is an error / does not load at boot.** The network was not up yet.
  Increase `STRATUS_KIOSK_NETWORK_WAIT` in `/etc/stratus-kiosk.env`.
- **Board reboots randomly.** Almost always power. Use a 5V 2A barrel-jack
  supply, not the USB cable, especially with a Wi-Fi or cellular dongle.
- **Chromium not found.** Re-run `sudo ./install.sh`; it installs `chromium`
  (or `chromium-browser` on older images).
- **Display mounted upside down.** Set `STRATUS_KIOSK_ROTATE=1` in the env file
  and restart the service.

## Files

| File | Purpose |
| --- | --- |
| `install.sh` | Installs X + Chromium, the launcher, config, and the service. |
| `start-kiosk.sh` | The kiosk launcher (runs inside X, relaunches Chromium). |
| `stratus-kiosk.service` | systemd unit that boots the board into the kiosk. |
| `kiosk.env.example` | Copied to `/etc/stratus-kiosk.env`; holds the URL and options. |
| `setup-wifi.sh` | Connects the USB Wi-Fi dongle using whichever tool the image ships. |
