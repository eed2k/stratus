# Stratus Lightning Beacon - ESP32

Property of METRON (PTY) LTD | Inteltronics

An ESP32 alternative to the Raspberry Pi beacon in `../`. It polls the
**Quaggasklip** admin panel over outbound HTTPS and drives a 4-channel
indicator board. Same safety model as the Pi version: it fails to red, never to
green.

## What each channel does

| Channel | Lamp | Driven by |
|---|---|---|
| CH1 | GREEN 12 V | `unit_online == true` (detector reporting in) |
| CH2 | RED 12 V | detector not reporting in, OR panel unreachable / unknown |
| CH3 | YELLOW 12 V | 1 s flicker for 15 s on a strike inside 10 km, then a 30 minute cooldown |
| CH4 | WIFI 12 V | blinks while connecting/offline, solid when WiFi is connected |

The green/red pair is exclusive. Yellow and the WiFi lamp are independent.

## Why ESP32 over the Nano 33 IoT

The panel is HTTPS, so the beacon does TLS on every poll. The ESP32 does WiFi
and TLS on-chip with room for the pinned CA, has a hardware watchdog, and flashes
from the same Arduino IDE. The Nano 33 IoT offloads TLS to its NINA co-processor
and keeps the trusted-root store in that module's firmware, which is more to
manage on an unattended unit for no benefit here.

## Hardware

- Any ESP32 dev module. An ESP32-WROOM-32 DevKitC is the reference.
- A **DC-capable** 4-channel switch board. Read the next line twice.

> **The board must switch 12 V DC.** Many cheap 4-channel "SSR" modules use
> AC-only solid-state relays (Omron G3MB and similar) that will not switch a
> 12 V DC lamp at all. Use a board with DC-rated SSRs (photoMOS/MOSFET output)
> or a plain 4-channel relay/MOSFET board. If the lamps never light, this is the
> first thing to check, before the code.

- Four 12 V indicator lamps (green, red, yellow, and a WiFi-status lamp).
- A 12 V supply for the lamps, and 5 V for the ESP32 (a 12 V->5 V buck, or USB on
  the bench).

## Wiring

Control side, ESP32 to the switch board:

| ESP32 pin | Board input | Channel |
|---|---|---|
| GPIO26 | IN1 | CH1 green |
| GPIO25 | IN2 | CH2 red |
| GPIO33 | IN3 | CH3 yellow |
| GPIO32 | IN4 | CH4 WiFi status |
| GND | board control GND | common ground, **required** |

- **Common ground is not optional.** The ESP32 GND and the board's control-side
  ground must be tied together or the inputs float and switch randomly.
- **Logic level.** ESP32 outputs 3.3 V. Confirm the board triggers at 3.3 V.
  Many opto-input boards do; some need 5 V. On a relay board with a `VCC`/`JD-VCC`
  jumper, remove the jumper, feed `JD-VCC` 5 V (coil/opto supply) and `VCC` 3.3 V
  (logic reference) so the 3.3 V GPIO drives the opto correctly. If in doubt add
  a level shifter.
- **Polarity.** Most opto boards switch on a LOW input. The firmware defaults to
  `ACTIVE_LOW = true`. If every lamp shows the opposite of what it should, set it
  to `false` and reflash. Bench check: with the detector active, GREEN lit, RED
  dark.

Load side, each channel switches one 12 V lamp:

```
  12 V (+) ---- lamp (+)
               lamp (-) ---- [ channel output A ]
                             [ channel output B ] ---- 12 V (-)
```

Each channel is just a switch in series with its lamp across the 12 V supply.
The switch board's isolation keeps the 12 V load side away from the ESP32.

Power:

```
  12 V supply --+--> lamps (load side of the switch board)
                +--> 12 V-to-5 V buck --> ESP32 5V / VIN
  all grounds common
```

## Configure and flash

1. Copy the secrets template and fill it in:
   ```
   cd stratus_beacon_esp32
   copy arduino_secrets.h.example arduino_secrets.h
   ```
   Set `WIFI_PASSWORD` (get it on the PC with
   `netsh wlan show profile name="4GUFI_4833" key=clear`) and
   `PANEL_AUTH_TOKEN` (the Quaggasklip tenant token). `arduino_secrets.h` is
   gitignored.

2. Board settings in the IDE: install the **esp32 by Espressif** core, pick your
   board (e.g. "ESP32 Dev Module"), 115200 monitor baud.

3. Compile and upload. Verified to build on esp32:esp32 3.3.10:
   ```
   arduino-cli compile --fqbn esp32:esp32:esp32 stratus_beacon_esp32
   arduino-cli upload  --fqbn esp32:esp32:esp32 -p COM<x> stratus_beacon_esp32
   ```

4. Open the serial monitor at 115200. Every poll logs the outcome; a strike in
   range logs the burst and cooldown.

## TLS

The panel certificate chains to **ISRG Root X1** (Let's Encrypt), which is pinned
in `ca_cert.h`. Pinning the root, not the leaf, means the beacon keeps validating
through Let's Encrypt's 90-day renewals until the root expires in 2035. The PEM
was generated from the server trust store, not hand-typed. TLS verification is
on; there is no insecure fallback by design.

## Tuning (top of the .ino)

- `LIGHTNING_KM` 10 - strike distance that arms the yellow lamp
- `FLICKER_TOTAL_MS` 15000, `FLICKER_HALF_MS` 500 - 15 s burst, 1 s cadence
- `STRIKE_COOLDOWN_MS` 30 min - quiet time after a burst
- `POLL_INTERVAL_MS` 10 s - how often the panel is polled
- `PANEL_PATH` / `STATION_ID` - change these together to point at another tenant

## Files

```
stratus_beacon_esp32/
  stratus_beacon_esp32.ino    firmware
  ca_cert.h                   pinned ISRG Root X1 (generated, do not hand-edit)
  arduino_secrets.h.example   template for WiFi + token
  arduino_secrets.h           your real secrets (gitignored)
README.md                     this file
```
