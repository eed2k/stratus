# Lightning Beacon (Pi Zero W + relay HAT + 12 V indicator lamps)

A secondary indicator unit. Three 12 V lamps show, at a glance and from a
distance, whether the lightning detection system is working and whether lightning
is close:

| Lamp | Meaning |
|---|---|
| **Green** | the detector is reporting in |
| **Red** | the detector is not reporting in, or the panel cannot be reached |
| **Orange** | flickers 1 s on / 1 s off for 10 s when a new strike lands inside the configured alert distance |

The Pi polls the admin panel over outbound HTTPS. Nothing needs to reach the Pi,
so it works behind NAT with no port forwarding and no inbound firewall rules.

---

## No panel changes were needed

The panel already exposes exactly this. `GET /api/v1/beacon/state` was built for
a beacon unit and returns:

```json
{
  "unit_online": true,
  "last_seen_age_s": 412,
  "lightning_active": false,
  "last_strike_age_s": null,
  "last_strike_km": null,
  "alerts_enabled": false,
  "lightning_radius_km": 10,
  "lightning_window_min": 30,
  "server_time": "2026-08-22T22:41:09+02:00"
}
```

Authentication is the same `X-Auth-Token` header the detector already uses, and
strikes are pre-filtered to the panel's configured alert radius
(`BEACON_LIGHTNING_KM`, currently **10 km**). So the beacon does not decide what
counts as close: the panel does, and changing it in one place changes it for the
alerts and the lamps together.

---

## Two design decisions to be aware of

### It fails to red, never to green

If the panel is unreachable, the beacon does not know whether the detector is
alive. Green would assert something unsupported, and on a lamp whose whole
purpose is to say "the lightning warning system is working", a false green is the
one failure mode that can actually put somebody in danger. So unknown is treated
as not-online: red on, green off.

`BEACON_FAIL_STATE=dark` will show nothing instead, which is at least honestly
ambiguous. There is deliberately no option to fail to green.

A consequence worth expecting: **a red lamp at power-on is correct.** The beacon
shows its fail state until the first successful poll.

### The orange burst fires per strike, not for the whole window

The endpoint's `lightning_active` flag stays true for the panel's all-clear
window, 30 minutes by default. That is the right meaning for "conditions are
dangerous", but it would leave the lamp flickering for half an hour.

So the beacon derives each strike's absolute timestamp from
`server_time - last_strike_age_s` and fires one 10 s burst per newly seen
timestamp. A further strike mid-burst restarts it, so ongoing activity keeps the
lamp going without bursts overlapping.

The derived timestamp is used as the identity rather than the age (which changes
every poll) or the distance and energy (which two separate strikes can easily
share).

On start-up, a strike that is already older than the burst duration is logged and
skipped, so rebooting mid-storm does not announce old news as new.

---

## Hardware

- Raspberry Pi Zero W or Zero 2 W (either works; the Zero 2 W is simply faster to
  boot)
- 3-channel relay HAT, opto-isolated
- 3 × 12 V indicator lamps: green, red, orange
- 12 V supply for the lamps, plus 5 V for the Pi

### Wiring

Default BCM pins, all overridable in the env file:

| Signal | BCM | Relay channel |
|---|---|---|
| Green | 17 | CH1 |
| Red | 27 | CH2 |
| Orange | 22 | CH3 |

Each relay switches the **12 V feed** to its lamp. The Pi and the lamps share a
ground reference but the 12 V never touches the Pi: that is the point of the
relay HAT.

Most opto-isolated HATs energize the coil on a **LOW** output, which is the
default (`BEACON_RELAY_ACTIVE_LOW=true`). If your lamps come on when they should
be off, flip that setting rather than rewiring.

> **12 V and mains wiring.** The relay contacts may be rated for mains, but this
> design only expects 12 V DC lamps. If you intend to switch anything at mains
> potential, that is electrical work with its own regulations and is outside what
> this document covers.

---

## Install

```bash
git clone https://github.com/eed2k/stratus.git
cd stratus/Beacon
sudo bash install.sh

sudo nano /etc/stratus-beacon.env      # set BEACON_TOKEN and BEACON_STATION_ID
sudo systemctl restart stratus-beacon
journalctl -u stratus-beacon -f
```

`install.sh` is idempotent and will not overwrite an existing
`/etc/stratus-beacon.env`, so your token survives a reinstall.

### Configuration

See `beacon.env.example` for the annotated list. The two that matter:

- **`BEACON_TOKEN`** must match `ALERT_WEBHOOK_TOKEN` on the panel. If the panel
  has a token set and this is blank or wrong, every poll returns HTTP 401 and the
  beacon sits on its fail state. The log names a 401 explicitly for this reason,
  because on the lamps it looks identical to an outage.
- **`BEACON_STATION_ID`** scopes the reply to one detector's client. Leave it
  blank only while a single client is live: without it the answer spans every unit
  on the panel, so another client's detector could hold your green lamp on.

---

## Testing

Check the wiring without waiting for weather:

```bash
sudo systemctl stop stratus-beacon
sudo BEACON_DEBUG=true python3 /opt/stratus-beacon/beacon.py
```

`BEACON_DRY_RUN=true` runs the poller with no GPIO at all, which is useful for
checking the panel connection from a laptop.

To exercise the orange lamp end to end, use the bench rig in `../Emulator` to
inject a strike inside the alert radius. Confirm **SMS alerts are OFF** on the
panel dashboard first: an emulated strike inside the radius runs the real alert
path, and with alerts on and recipients configured it can send real messages to
real people. Strikes are still recorded with alerts off, so the lamps and the
dashboard still respond.

Verifying each lamp individually, with the service stopped:

```bash
sudo systemctl stop stratus-beacon
python3 - <<'PY'
from gpiozero import DigitalOutputDevice
from time import sleep
for name, pin in (("green", 17), ("red", 27), ("orange", 22)):
    d = DigitalOutputDevice(pin, active_high=False, initial_value=False)
    print(name); d.on(); sleep(2); d.off(); d.close()
PY
```

---

## Files

```
beacon.py                 poller and lamp driver
beacon.env.example        annotated configuration template
stratus-beacon.service    systemd unit
install.sh                installer
README.md                 this file
```
