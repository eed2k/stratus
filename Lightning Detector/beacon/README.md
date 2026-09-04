# Stratus Lightning Beacon Controller

A secondary Raspberry Pi with a relay HAT that polls the cloud panel and drives
panel-mount pilot lights and a buzzer. It is completely independent of the
detector unit and only makes **outbound** HTTPS requests, so it needs no inbound
access and no changes to the client firewall.

## Behavior

| Indicator | Meaning |
|-----------|---------|
| GREEN | Detector unit ONLINE (recent heartbeat) |
| RED   | Detector unit OFFLINE, cloud unreachable, or controller dead (fail-safe) |
| AMBER (flashes 1 Hz for 25 s) + BUZZER (5 s) | A strike within 10 km occurred. 1-hour cool-down before it can sound again. |

The alarm sequence: on a fresh strike within the alarm radius (10 km), the amber
lamp flickers once per second for 25 seconds and the 12 V buzzer rings for the
first 5 seconds. Further strikes within the next hour do not re-trigger it
(1-hour cool-down).

## Relay channels (3 channels)

| Channel | Default GPIO (BCM) | Drives |
|---------|--------------------|--------|
| CH1 (SPDT) | 26 | GREEN / RED change-over |
| CH2 | 20 | AMBER lamp |
| CH3 | 21 | 12 V buzzer |

(These match a Waveshare RPi Relay Board. For a different board, edit the GPIO
numbers in `beacon_config.json`.)

## Wiring

**CH1 - GREEN/RED, fail-safe change-over (one SPDT relay):**
```
12V+ ──► CH1 COM
         CH1 NO  ──► GREEN lamp ──► 12V-
         CH1 NC  ──► RED lamp   ──► 12V-
```
The software energises CH1 **only** while the cloud confirms the unit online. On
power loss, crash, or loss of cloud contact, the relay drops out → RED. A dead
beacon can never show GREEN.

**CH2 - AMBER lamp:**
```
12V+ ──► CH2 COM ──► CH2 NO ──► AMBER lamp ──► 12V-
```

**CH3 - 12 V buzzer:**
```
12V+ ──► CH3 COM ──► CH3 NO ──► BUZZER ──► 12V-
```

Amber and buzzer are on separate channels because their durations differ
(amber 25 s, buzzer 5 s).

## Power
```
12V PSU ──┬──► 12V→5V buck (USB out) ──► Pi power input  (powers Pi + relay HAT)
          └──► 12V+ rail ──► relay COM terminals ──► lamps / buzzer
```
Power the Pi through its normal USB power input from the buck output (do not
inject 5 V on the GPIO pins). One 12 V supply feeds everything.

## Hardware
- Raspberry Pi Zero 2 W (on the client network: WiFi or USB-Ethernet)
- 3-channel relay HAT with SPDT relays (e.g. Waveshare RPi Relay Board)
- GREEN + RED + AMBER 12 V panel-mount LED pilot lamps
- 12 V buzzer
- 12 V PSU + 12 V→5 V buck converter (USB output)

> If your relay board is **active-LOW** (GPIO LOW energises the relay), set
> `"relay_active_high": false` in `beacon_config.json`.

## Install on the beacon Pi
```bash
# copy this folder to /home/gwld1/beacon, then:
sudo apt install -y python3-rpi.gpio
sudo cp /home/gwld1/beacon/beacon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now beacon.service
journalctl -u beacon.service -f      # watch it poll
```

## Configuration (`beacon_config.json`)

| Key | Meaning |
|-----|---------|
| `state_url` | Cloud beacon-state endpoint |
| `auth_token` | Shared secret (same token the detector uses) |
| `poll_interval_s` | How often to query the cloud (default 4 s) |
| `fail_timeout_s` | No successful poll for this long → RED (default 30 s) |
| `relay_active_high` | `true` for Waveshare-style boards, `false` for active-LOW |
| `gpio_online` / `gpio_amber` / `gpio_buzzer` | BCM pins for CH1 / CH2 / CH3 |
| `lightning_fresh_window_s` | Only fire if the strike is at most this old (default 120 s) |
| `lightning_cooldown_s` | Cool-down between alarm sequences (default 3600 s) |
| `amber_seconds` | Amber flicker duration (default 25 s) |
| `amber_flash_hz` | Flash rate (1 = once per second) |
| `buzzer_seconds` | Buzzer ring duration (default 5 s) |

## Thresholds set on the cloud (server side)
- `UNIT_ACTIVE_THRESHOLD_MIN` - minutes before a missed heartbeat = OFFLINE
- `BEACON_LIGHTNING_KM` - alarm radius (default 10 km)
- `BEACON_ALLCLEAR_MIN` - window for the convenience `lightning_active` flag
