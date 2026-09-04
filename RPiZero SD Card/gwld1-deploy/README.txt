GWLD1 Lightning Detector - SD card deploy bundle
================================================

This folder lives on the Pi boot partition. Cloud-init runs install.sh, which
copies everything to /home/gwld1, installs the systemd service and applies the
hardening script.


WHAT CHANGED IN THIS REVISION
-----------------------------
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
