QUAGGASKLIP Lightning Detector - deploy bundle
==============================================

Property of METRON (PTY) LTD | Inteltronics

This is the QUAGGASKLIP unit only. It is fully isolated from the Glencore
(gwld1) detector: different service user, home directory, station_id, panel
tenant and ingest token. Nothing here is shared with that unit, and files must
not be copied between the two bundles.

DEPLOYMENT MODEL
----------------
Flashed with Raspberry Pi Imager (Raspberry Pi OS Lite, 32-bit), with the user
quaggasklip, hostname as3935Quaggasklip, WiFi and the SSH key set in Imager.
This bundle is then copied to the Pi and installed over SSH:

    scp -i %USERPROFILE%\.ssh\pi_gwld1 -r quaggasklip-deploy quaggasklip@as3935Quaggasklip.local:/home/quaggasklip/
    ssh -i %USERPROFILE%\.ssh\pi_gwld1 quaggasklip@as3935Quaggasklip.local
    sudo bash /home/quaggasklip/quaggasklip-deploy/install.sh
    sudo reboot

install.sh enables SPI and the serial console UART, installs the hardware
Python packages, copies the program into /home/quaggasklip, and installs and
enables the service. It does NOT auto-run the hardening (that disables SSH
password login), and it does NOT start the detector before the reboot that SPI
needs. This is the Imager model, not the cloud-init model the Glencore card
used; there is no meta-data or instance-id to manage.


HARDWARE ON THIS UNIT
---------------------
Raspberry Pi Zero W on a Pi 2 Click Shield (MIKROE-1879), two mikroBUS sockets:

  socket 1   AS3935 lightning sensor. SPI (CE0 = spidev0.0), interrupt BCM 17.
  socket 2   Terminal 2 Click (MIKROE-4951). Serial out to the Campbell logger.

Terminal 2 Click is PASSIVE. No transceiver, no logic - it mirrors the sixteen
mikroBUS pins of its socket onto two nine-position screw terminals. The label
beside a terminal names the mikroBUS pin, not the Raspberry Pi GPIO behind it.


DO NOT WIRE THE CAMPBELL LOGGER TO THE TERMINAL MARKED "TX"
-----------------------------------------------------------
It is the obvious thing to do and it is wrong here, for two separate reasons:

  1. mikroBUS TX goes to the Pi's hardware UART0 TXD, BCM 14. On this unit that
     is the SERIAL CONSOLE: config.txt sets enable_uart=1 and keeps BCM 14/15 as
     the recovery path for a site with no display. Wiring a logger there does
     not merely fail to deliver strikes, it feeds kernel messages and a login
     prompt into the logger's serial port.

  2. The Campbell output is not the hardware UART. It is a bit-banged UART
     produced by pigpio's wave_add_serial on campbell_uart_tx_pin, BCM 26 by
     default, chosen exactly so the recovery console stays usable.

The correct terminal is whichever one carries BCM 26. Which mikroBUS pin that is
depends on the shield's routing, so identify it on the bench or on site instead
of assuming:

    sudo systemctl stop lightning-detector
    python3 campbell_pin_probe.py --toggle     # find and label the terminal
    python3 campbell_pin_probe.py --send       # send a real test record
    sudo systemctl start lightning-detector

Stop the service first. pigpio will let two writers drive one GPIO and the
result is a corrupted waveform that looks exactly like a wiring fault.

Ground the logger and the Pi together. It is the most common omission on a
first install and it makes every other symptom misleading.

campbell_uart_enabled is true in lightning_config.json, so the service drives
this pin. Expect traffic on it as soon as the detector starts.


SECOND WIRE TO THE LOGGER: THE STRIKE PULSE
-------------------------------------------
Besides the serial records, the unit mirrors every confirmed strike as one 50 ms
pulse, for the logger's pulse counter:

    Pi BCM 19, 40 pin header physical pin 35   ->   CR300 P_SW
    Pi GND,    40 pin header physical pin 39   ->   CR300 G

Set by pulse_mirror_enabled, pulse_mirror_pin and pulse_mirror_width_ms. BCM 19
is on the Pi header, not a mikroBUS pin, so the same warning applies: do not go
looking for it on a Terminal 2 screw terminal without probing for it first.

The point of this wire is that it is independent. It is driven straight from the
strike handler, so it does not depend on the serial line, the network or the
panel. The logger's pulse count and its serial strike count should track each
other, and the two diverging tells you which path broke rather than merely that
something did. Disturber and noise interrupts never produce a pulse, so the
count is strikes only.

The matching logger program is in the repository at

    Quaggasklip/campbell/QK_CR300_Lightning.CR300


PANEL INTEGRATION
-----------------
station_id is QUAGGASKLIP and the webhook is

    https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/lightning

The detector derives the heartbeat and calibration endpoints from that by
swapping the last path segment. The tenant slug in the path (quaggasklip)
selects the client panel.

Authentication is a per-site token in the X-Auth-Token header. This unit has its
OWN token, held in lightning_config.json (mode 0600) and matched on the panel
for the quaggasklip tenant. It is NOT the Glencore token. Do not reuse one site's
token for the other; that is the whole point of keeping them isolated.

A detector files itself under the platform tenant on its first heartbeat and is
invisible to the client panel until an admin assigns it on the platform console.
Until it is assigned no alert is sent for it, by design: an unclaimed unit has no
recipient list to consult.


VERIFY THE HEARTBEAT REACHES THE PANEL
--------------------------------------
On the Pi:

    python3 /home/quaggasklip/send_test_heartbeat.py

Expect HTTP 200 and {"status":"ok"}. The script explains any failure: 401 is a
token mismatch, 404 a wrong path, 422 a bad payload, and it prints connectivity
checks if the host cannot be reached.

    systemctl status lightning-detector
    sudo journalctl -u lightning-detector -f | grep -i heartbeat

Look for "Heartbeat webhook sent". A restart posts one immediately, because
startup backdates the timer so the unit shows ACTIVE without waiting an hour.

Then check the panel, under Stations:

    https://adminpanel.stratusweather.co.za/quaggasklip/stations

A heartbeat is telemetry only. The panel records liveness and a CPU sample and
never raises an alert, so testing this cannot send an SMS.


USB CONNECTION TO PC (Pi Zero W)
--------------------------------
install.sh enables the USB gadget. With Imager (no cloud-init) usb0 comes up
without an address, so set it once over SSH:

    sudo nmcli con add type ethernet ifname usb0 con-name usb0-static ip4 192.168.7.2/24
    sudo nmcli con mod usb0-static ipv4.method manual
    sudo nmcli con up usb0-static

Then on the PC, set the RNDIS adapter to 192.168.7.1 / 255.255.255.0, no gateway:

    ssh -i %USERPROFILE%\.ssh\pi_gwld1 quaggasklip@192.168.7.2

The hardening script disables SSH password authentication, so keep the key in
.ssh/pi_gwld1. The authorized_keys in this folder is installed for you.


TAILSCALE (optional, for access from anywhere)
----------------------------------------------
Not installed automatically: enrolling a device needs a tagged auth key, and an
SD card that leaves your hands must not carry one. Staged at
/home/quaggasklip/install_tailscale_pi.sh. Generate a key with the tag
tag:detector, then:

    sudo TS_AUTHKEY='tskey-auth-...' bash /home/quaggasklip/install_tailscale_pi.sh

This Pi is ARMv6, so the script installs the static ARM build. Full notes in
Lightning Detector/remote_access/REMOTE_ACCESS.md.


AFTER BOOT
----------
- Detector service:  systemctl status lightning-detector
- Detector log:      journalctl -u lightning-detector -f
- Hardening log:     /var/log/quaggasklip-harden.log  (after you run hardening)
- Data directory:    /home/quaggasklip/lightning_data
- Live config:       /home/quaggasklip/lightning_config.json
