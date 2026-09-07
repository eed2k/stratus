GWLD1 Lightning Detector - SD card deploy bundle
================================================

This folder lives on the Pi boot partition. Cloud-init runs install.sh, which
copies everything to /home/gwld1, installs the systemd service and applies the
hardening script.


HARDWARE ON THIS UNIT
---------------------
Raspberry Pi Zero W on a Pi 2 Click Shield (MIKROE-1879), two mikroBUS sockets:

  socket 1   AS3935 lightning sensor. SPI, interrupt on BCM 17 (irq_pin).
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

Note that campbell_uart_enabled is false in lightning_config.json, so the
service does not drive this pin until it is switched on.


WHAT CHANGED IN THIS REVISION
-----------------------------
0. Re-tenanted to Quaggasklip. station_id is QUAGGASKLIP and the webhook is

     https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/lightning

   Only the tenant slug in the path changed. The ingest token is a single
   server-wide value and the panel resolves the client from the URL, so
   re-tenanting a detector is a URL change and nothing else. The previous file
   is kept alongside as lightning_config.json.bak-gwld1.

   A detector files itself under the platform tenant on its first heartbeat and
   is invisible to the client panel until an admin assigns it, on the platform
   console's Detectors page. Until it is assigned no alert is sent for it, by
   design: an unclaimed unit has no recipient list to consult.

1. alert_webhook_url now points at the live panel. The previous value,
   https://gwld1-admin.dynv6.net/..., no longer resolves, which is why no
   heartbeat or strike ever reached the panel:

     https://adminpanel.stratusweather.co.za/gwld1/api/v1/lightning

   The detector derives the other two endpoints from that one by swapping the
   last path segment, so /heartbeat and /calibration follow automatically.

2. send_test_heartbeat.py added - sends one heartbeat on demand instead of
   waiting up to an hour for the scheduled one.

3. lightning_detector.py updated. Adds calibration reporting to the panel
   (_calibration_url / _calibration_webhook). Nothing was removed.

4. install.sh no longer purges Tailscale. It previously uninstalled it on every
   run, which would have destroyed remote access to a unit on a remote site.

5. .installed marker deleted and the instance-id bumped, so this bundle
   actually deploys on the next boot. See below - both are required.

6. Power: the main loop no longer polls. It used to wake ten times a second,
   for the life of the installation, to look at a flag that is false almost
   always. It now sleeps in the kernel on an event the GPIO callback sets, with
   a one second idle tick (IDLE_TICK_SECONDS). A strike is handled SOONER than
   before, because the event wakes the loop at once instead of it waiting up to
   100 ms for the next poll. Everything the loop does between strikes is already
   gated on its own interval - the shortest is the validation buffer at 30 s - so
   a one second tick changes none of their behaviour, and the systemd watchdog is
   120 s so the per-tick ping has ample headroom.

7. The offline Stratus buffer is now bounded (4 MB, oldest records dropped).
   It was the one file here that could grow without limit: the CSV logs are
   purged on every date rollover, nothing purged the buffer. A site that loses
   its uplink for a season would eventually fill the card, and a full card does
   not mean "the buffer is large", it means logging, journald and the OS all stop
   being able to write - a dead unit needing a site visit. The local CSV remains
   the complete record either way; the buffer only exists to replay into Stratus.

8. campbell_pin_probe.py added. Identifies which Terminal 2 screw terminal
   carries the bit-banged Campbell TX line, and sends a test record in the
   detector's own wire format. See the hardware warning above.


HOW TO APPLY THIS BUNDLE
------------------------
Copy onto the SD card boot partition, overwriting what is there:

  gwld1-deploy\        (the whole folder)
  meta-data            (required - carries the new instance-id)

install.sh will not re-run unless BOTH of these are true:

  a) gwld1-deploy/.installed does not exist
     install.sh exits immediately if it does.

  b) meta-data has an instance-id it has not booted with before
     Cloud-init runs "runcmd" once per instance-id. Without a new value it
     never calls install.sh again, no matter what you delete.

Both are already set correctly in this bundle. If you re-deploy again later,
delete .installed AND change the instance-id date again.

Then boot the Pi and wait about two minutes.


VERIFY THE HEARTBEAT REACHES THE PANEL
--------------------------------------
On the Pi:

  python3 /home/gwld1/send_test_heartbeat.py

Expect: HTTP 200 and {"status":"ok"}. The script explains any failure -
401 is a token mismatch, 404 a wrong path, 422 a bad payload, and it prints
connectivity checks if the host cannot be reached.

  python3 /home/gwld1/send_test_heartbeat.py --dry-run   # show, send nothing

Service state and logs:

  systemctl status lightning-detector
  sudo journalctl -u lightning-detector -f | grep -i heartbeat

Look for "Heartbeat webhook sent". A restart posts one immediately, because
startup backdates the timer so the unit shows ACTIVE without waiting an hour.

Then check the panel, under Stations:

  https://adminpanel.stratusweather.co.za/gwld1/stations

The unit appears as "GLENCORE WONDERKOP", which is already assigned to the
gwld1 client. Do not change station_id in lightning_config.json without
assigning the new name on the panel first: the panel files an unrecognized
unit under the platform tenant, where it stays invisible to this client.

A heartbeat is telemetry only. The panel records liveness and a CPU sample and
never raises an alert, so testing this cannot send an SMS.


FIXING IT WITHOUT RE-FLASHING
-----------------------------
If the Pi has already booted and you only want the URL corrected, edit the live
copy directly. The file on the boot partition is only a template.

  sudo sed -i 's#https://gwld1-admin.dynv6.net/api/v1/lightning#https://adminpanel.stratusweather.co.za/gwld1/api/v1/lightning#' /home/gwld1/lightning_config.json
  grep alert_webhook_url /home/gwld1/lightning_config.json
  sudo systemctl restart lightning-detector


USB CONNECTION TO PC (Pi Zero W)
--------------------------------
1. Use the INNER USB port (labeled USB, not PWR) with a DATA cable.
2. Boot the Pi with this SD card.
3. Windows shows an "RNDIS" network adapter.
4. Set that adapter to a manual IP:
     Address: 192.168.7.1
     Netmask: 255.255.255.0
     Gateway: (leave blank)
5. SSH to the Pi:
     ssh -i %USERPROFILE%\.ssh\pi_gwld1 gwld1@192.168.7.2

Note: the hardening script disables SSH password authentication, so keep the
key in .ssh/pi_gwld1. The authorized_keys in this folder is installed for you.


TAILSCALE (optional, for access from anywhere)
----------------------------------------------
Not installed automatically, and deliberately so: enrolling a device needs a
tagged auth key, and an SD card that leaves your hands must not carry one.

The installer is staged at /home/gwld1/install_tailscale_pi.sh. Generate a key
in the Tailscale admin console with the tag tag:detector, then:

  sudo TS_AUTHKEY='tskey-auth-...' bash /home/gwld1/install_tailscale_pi.sh

This Pi is ARMv6, so there is no official Tailscale package for it; the script
installs the static ARM build, which is the route that works on a Zero W.

Apply the access policy from remote_access/tailscale-policy.hujson first, or
access will be wider than intended. Full notes in
Lightning Detector/remote_access/REMOTE_ACCESS.md.


AFTER BOOT
----------
- Detector service:  systemctl status lightning-detector
- Deploy log:        journalctl -t gwld1-deploy
- Hardening log:     /var/log/gwld1-harden.log
- Data directory:    /home/gwld1/lightning_data
