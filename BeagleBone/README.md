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

## Loading code onto the board over the USB cable

One USB cable is all you need. The BeagleBone presents itself as three things at
once: a USB network adapter, a serial console, and a small flash drive. The
network adapter is by far the easiest route, because it lets you use normal
`ssh` and `scp`.

**Step 1. Install the drivers (Windows, once only).**
Download and run the BeagleBone driver installer from
[beagleboard.org/getting-started](https://beagleboard.org/getting-started).
Reboot if it asks. Skip this on macOS and Linux.

**Step 2. Plug in and check the board answers.**
Use the small USB cable into the board's client port (the mini or micro USB
socket next to the ethernet jack), not the big USB-A socket. Wait about 30
seconds for it to boot, then from PowerShell:

```powershell
ping 192.168.7.2
```

On macOS or Linux the address is `192.168.6.2` instead. If neither answers, see
"Board is not reachable over USB" below.

**Step 3. Copy this folder onto the board.**
From the repository root on your PC:

```powershell
scp -r BeagleBone debian@192.168.7.2:/home/debian/
```

The default password on the BeagleBone images is `temppwd`. If your image asked
you to set your own password at first boot, use that one.

**Step 4. Log in and run the installer.**

```powershell
ssh debian@192.168.7.2
```

Then, on the board:

```bash
cd ~/BeagleBone
chmod +x *.sh
sudo ./install.sh
sudo nano /etc/stratus-kiosk.env     # set STRATUS_KIOSK_URL
sudo systemctl start stratus-kiosk
```

**Step 5. Updating later.** Repeat step 3 to copy the changed files, then:

```bash
sudo install -m 0755 ~/BeagleBone/start-kiosk.sh /opt/stratus-kiosk/start-kiosk.sh
sudo systemctl restart stratus-kiosk
```

### If you cannot use scp

Every BeagleBone image also mounts as a small USB drive when you plug the cable
in. You can drag files onto that drive from Explorer, and they appear on the
board under `/boot/uboot/` (older images) or the boot partition. It is easier to
use [WinSCP](https://winscp.net) with host `192.168.7.2`, user `debian`, and the
same password, which gives you a normal drag-and-drop window.

---

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

### The board will not power up at all

Work through this in order. The LEDs tell you which stage is failing, so check
them first: there is one **PWR** LED near the barrel jack and a row of **four
USR LEDs** (USR0 to USR3) near the ethernet socket.

| What you see | What it means | What to do |
| --- | --- | --- |
| PWR LED dark | No 5 V is reaching the board | Steps 1 to 3 below |
| PWR LED on, all four USR LEDs dark | Powered, but nothing is booting | Step 4 (empty or corrupt eMMC) |
| PWR on, USR0 blinking irregularly (heartbeat) | It IS booting normally | The problem is elsewhere: video, network, or the login |

**Step 1. Press the power button.** This is the one that catches everybody. The
BeagleBone has a **power button (S3)**, next to the barrel jack. If the board was
shut down in software (`sudo poweroff`) or by a previous press, it stays off with
the supply connected and looks dead. Press S3 briefly, once, and watch the PWR
LED. Do not hold it down: holding it forces a hard power-off.

**Step 2. Check the plug actually fits.** The barrel jack is
**5.5 mm outer / 2.1 mm inner, center positive**. A 2.5 mm inner-diameter plug
physically enters the socket but does not grip the center pin reliably, so the
board gets nothing or browns out intermittently. This is extremely common with
generic "5V 3A" supplies. Wiggle-test it: if the PWR LED flickers, the plug is
wrong.

**Step 3. Confirm the supply is really 5 V.** The BeagleBone Black takes **5 V
only**. A 9 V or 12 V supply with the same barrel size will damage it
permanently, and a "5 V" supply that sags under load will not boot it. Measure it
if you can. Your 5 V 3 A unit is the right rating, so the likely issue is the
plug (step 2), not the rating.

**Step 4. Powered but not booting: the eMMC is probably empty.**
This is where the SD card matters, and it is worth being blunt about:

> A BeagleBone with no SD card inserted boots from its **onboard eMMC**. That is
> normal and correct. But if the eMMC has never been flashed, or its image is
> corrupt, then with no SD card there is **nothing at all for it to boot** - and
> the board will sit there with the PWR LED on and the USR LEDs dead, looking
> broken when it is not.

To recover it you **must** use an SD card once, because that is the only way in:

1. On your PC, download a current BeagleBone Debian image and write it to a
   micro-SD card (4 GB or larger) with [balenaEtcher](https://etcher.balena.io)
   or Raspberry Pi Imager. Use an **eMMC flasher** image if you want it copied
   permanently onto the board; use a plain image if you would rather just run
   from the card.
2. Power the board **off** (unplug it).
3. Insert the SD card.
4. Hold the **BOOT button (S2)** - the one nearest the SD slot - and keep
   holding it while you reconnect power. This forces the board to boot from the
   SD card instead of the eMMC. Release after a few seconds.
5. Watch the USR LEDs. A flasher image runs the four LEDs back and forth in a
   sweeping pattern, then turns **all four on solid** when it has finished. That
   takes roughly 10 to 45 minutes. Do not interrupt it.
6. Power off, remove the SD card, power on. It now boots the freshly written
   eMMC with no card inserted.

If the PWR LED never lights with a known-good 5 V supply and a correct plug, and
pressing S3 does nothing, the board itself has most likely failed.

### The USB dongle gets no power from the USB-A port

This is the most common BeagleBone Black complaint, and in almost every case it
is one of three things, in this order of likelihood.

**1. The board is being powered from the USB cable.** This is the usual cause.
When the BBB runs off the mini/micro-USB client port, the host USB-A socket gets
little or no power budget, because the whole board is limited to what the PC
port provides. A Wi-Fi or cellular dongle draws more than what is left, so it
either never powers up or resets under load.

Fix: plug a **5V 2A (or better) barrel-jack supply** into the board. This is not
optional for a kiosk that also drives HDMI. Power the board from the barrel jack
first, then plug the dongle in.

**2. Not enough current for the dongle even on barrel-jack power.** The host port
is rated only around 500 mA, and some LTE dongles pull well over that in bursts
while they attach to the network.

Fix: use a **powered** USB hub between the board and the dongle, so the dongle
draws from the hub's own supply rather than the board's.

**3. Old U-Boot / an old image.** Older BeagleBone images shipped U-Boot and
device-tree versions with known USB host problems, including the host port not
being brought up at all. If the port is dead even on barrel-jack power with a
powered hub, update the software.

Check what you are running:

```bash
cat /etc/dogtag          # image name and date
sudo /opt/scripts/tools/version.sh | grep -E 'bootloader|kernel'
```

Update in place:

```bash
sudo apt update && sudo apt full-upgrade -y
cd /opt/scripts && sudo git pull
sudo /opt/scripts/tools/developers/update_bootloader.sh   # refreshes U-Boot
sudo reboot
```

If it is still dead after that, flash a current image to the eMMC. That rules out
firmware entirely and is usually faster than chasing it further.

**Diagnosing which stage is failing:**

```bash
lsusb                          # is the dongle enumerated at all?
dmesg | tail -40               # look for over-current / disconnect messages
dmesg | grep -i -E 'usb|firmware|over-current'
ip a                           # did a wlan/wlx interface appear?
```

- Nothing in `lsusb` and nothing in `dmesg`: it is a power problem, go back to
  points 1 and 2.
- The dongle appears in `lsusb` but there is no `wlan` interface: it is powered
  fine and the problem is a missing driver or firmware, not power. Install
  `firmware-misc-nonfree` (add `firmware-realtek` for Realtek chipsets) and
  replug.
- `dmesg` shows "over-current condition" or repeated connect/disconnect: the
  dongle is browning out the port. Use a powered hub.

### Other issues

- **Board is not reachable over USB.** Use the small client USB socket, not the
  USB-A one. Give it 30 seconds to boot. On Windows, install the drivers from
  step 1 above. Confirm a new network adapter appeared in
  `Get-NetAdapter | Where-Object InterfaceDescription -match 'Gadget|RNDIS|BeagleBone'`.
  If SSH complains that the host key changed, run
  `ssh-keygen -R 192.168.7.2` and try again.
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
