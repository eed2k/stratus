GWLD1 Lightning Detector - deploy bundle
========================================

Property of METRON (PTY) LTD | Inteltronics

This is the GLENCORE WONDERKOP (gwld1) unit only. It is fully isolated from the
Quaggasklip detector: different service user, home directory, station_id, panel
tenant and ingest token. Nothing here is shared with that unit, and files must
not be copied between the two bundles.

This unit is AS3935 only. It has NO Campbell logger and NO Terminal 2 Click, so
the Campbell UART and the strike-pulse mirror are both disabled in
lightning_config.json (campbell_uart_enabled false, pulse_mirror_enabled false).


DEPLOYMENT MODEL
----------------
This bundle lives on the Pi boot partition. Cloud-init runs install.sh once per
instance-id, which copies everything to /home/gwld1, installs the systemd
service and applies the hardening script.


HARDWARE ON THIS UNIT
---------------------
Raspberry Pi Zero W on a MikroE Click Shield:

  socket 1   AS3935 lightning sensor. SPI (CE0 = spidev0.0), interrupt BCM 17.

That is the whole sensing chain. There is no second Click and no wired output to
a datalogger on this unit; alerts leave over WiFi to the admin panel only.


PANEL INTEGRATION
-----------------
station_id is GLENCORE WONDERKOP and the webhook is

    https://adminpanel.stratusweather.co.za/gwld1/api/v1/lightning

The detector derives the heartbeat and calibration endpoints from that by
swapping the last path segment. The tenant slug in the path (gwld1) selects the
client panel.

Authentication is a per-site token in the X-Auth-Token header. This unit has its
OWN token, held in lightning_config.json (never committed) and matched on the
panel for the gwld1 tenant. It is NOT the Quaggasklip token. Do not reuse one
site's token for the other; that is the whole point of keeping them isolated.

A detector files itself under the platform tenant on its first heartbeat and is
invisible to the client panel until an admin assigns it. Do not change
station_id without assigning the new name on the panel first.


VERIFY THE HEARTBEAT REACHES THE PANEL
--------------------------------------
On the Pi:

    python3 /home/gwld1/send_test_heartbeat.py

Expect HTTP 200 and {"status":"ok"}. The script explains any failure: 401 is a
token mismatch, 404 a wrong path, 422 a bad payload, and it prints connectivity
checks if the host cannot be reached.

    systemctl status lightning-detector
    sudo journalctl -u lightning-detector -f | grep -i heartbeat

Look for "Heartbeat webhook sent". A restart posts one immediately, because
startup backdates the timer so the unit shows ACTIVE without waiting an hour.

Then check the panel under Stations:

    https://adminpanel.stratusweather.co.za/gwld1/stations

A heartbeat is telemetry only. The panel records liveness and a CPU sample and
never raises an alert, so testing this cannot send an SMS.


USB CONNECTION TO PC (Pi Zero W)
--------------------------------
1. Use the INNER USB port (labeled USB, not PWR) with a DATA cable.
2. Boot the Pi with this SD card.
3. Windows shows an "RNDIS" network adapter.
4. Set that adapter to a manual IP: 192.168.7.1 / 255.255.255.0, no gateway.
5. SSH to the Pi:
     ssh -i %USERPROFILE%\.ssh\pi_gwld1 gwld1@192.168.7.2

The hardening script disables SSH password authentication, so keep the key in
.ssh/pi_gwld1. The authorized_keys in this folder is installed for you.


TAILSCALE (optional, for access from anywhere)
----------------------------------------------
Not installed automatically: enrolling a device needs a tagged auth key, and an
SD card that leaves your hands must not carry one. Staged at
/home/gwld1/install_tailscale_pi.sh. Generate a key with the tag tag:detector,
then:

    sudo TS_AUTHKEY='tskey-auth-...' bash /home/gwld1/install_tailscale_pi.sh

This Pi is ARMv6, so the script installs the static ARM build. Full notes in
Lightning Detector/remote_access/REMOTE_ACCESS.md.


NOTE ON THE SHARED CAMPBELL TOOLING
-----------------------------------
lightning_detector.py is the same program used by the Quaggasklip unit, so the
Campbell UART and pulse-mirror code is present but dormant here (disabled by
config). campbell_pin_probe.py ships for parity but is not used on this unit,
which has no Campbell logger.


AFTER BOOT
----------
- Detector service:  systemctl status lightning-detector
- Deploy log:        journalctl -t gwld1-deploy
- Hardening log:     /var/log/gwld1-harden.log
- Data directory:    /home/gwld1/lightning_data
