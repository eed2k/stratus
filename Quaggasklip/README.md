# Quaggasklip (Metron) lightning detector

Third AS3935 detector site. A Raspberry Pi Zero W or Zero 2 W with a MikroE
Pi 3 Click Shield: a **Thunder Click** in mikroBUS socket 2 reads lightning, and a
**Terminal 2 Click** in socket 1 carries the results to a Campbell CR300 or
CR1000 datalogger over UART. Strikes also go to the Stratus admin panel, which
owns all alerting.

This unit never sends an SMS or an e-mail. It posts to the panel; the panel
decides who hears about it.

---

## Hardware

| Item | Part |
|---|---|
| Computer | Raspberry Pi Zero W or Zero 2 W |
| Shield | MikroE Pi 3 Click Shield (MIKROE-2756) |
| Socket 1 | Terminal 2 Click - UART to the datalogger |
| Socket 2 | Thunder Click - AS3935 lightning sensor |

### Pin map

Taken from the shield schematic. Both mikroBUS sockets share SPI0 and are told
apart only by chip select, because CE0 and CE1 are the Pi's only hardware CS
lines.

| mikroBUS pin | Socket 1 (Terminal 2) | Socket 2 (Thunder / AS3935) |
|---|---|---|
| AN | GPIO4 | GPIO26 |
| RST | GPIO5 | GPIO6 |
| **CS** | **GPIO8 = CE0 = `spidev 0.0`** | **GPIO7 = CE1 = `spidev 0.1`** |
| SCK | GPIO11 *(shared)* | GPIO11 *(shared)* |
| MISO | GPIO9 *(shared)* | GPIO9 *(shared)* |
| MOSI | GPIO10 *(shared)* | GPIO10 *(shared)* |
| PWM | GPIO18 | GPIO13 |
| **INT** | **GPIO17** | **GPIO12** (Pi 3 shield) / **GPIO19** (Pi 2 shield) |
| RX | GPIO15 *(shared)* | GPIO15 *(shared)* |
| TX | GPIO14 *(shared)* | GPIO14 *(shared)* |
| SCL | GPIO3 *(shared)* | GPIO3 *(shared)* |
| SDA | GPIO2 *(shared)* | GPIO2 *(shared)* |

Two consequences worth knowing before wiring anything:

- **Socket 2's INT is the one net that differs between the two shields.** The
  Pi 3 shield adds an onboard MCP3204 ADC which takes GPIO19, 20 and 21 for SPI1
  and GPIO16 for its chip select, so socket 2's interrupt moved to GPIO12.
  Confirm it on the assembled unit with `find_irq_pin.py` rather than trusting
  this table - a wrong interrupt pin gives a detector that starts cleanly, logs
  nothing, and reports itself healthy.
- **GPIO16, 19, 20 and 21 are not free** on the Pi 3 shield. The GWLD1 unit uses
  GPIO19 for its strike pulse; that pin cannot be reused here. This unit uses
  GPIO18 instead, socket 1's PWM pin, which is already on the Terminal 2 Click's
  own terminal block.

Free for other use on the Pi 3 shield: GPIO22, 23, 24, 25, 27.

### Wiring to the logger

Everything leaves from the Terminal 2 Click's screw terminals, so one cable runs
to the logger.

| Terminal 2 Click | CR300 | Purpose |
|---|---|---|
| TX (GPIO14) | C2 | ASCII records, Pi to logger |
| GND | G | common ground - **required** |
| PWM (GPIO18) | P_SW | one pulse per strike, optional |
| RX (GPIO15) | - | leave open unless the logger transmits |

Ground is not optional. Without a shared reference the receiver sees noise
instead of data, and the only symptom is a rising `ParseErrorCount`.

---

## Install

```bash
sudo ./install.sh
sudo reboot          # the UART and SPI changes need it
```

Then, in order:

```bash
# 1. Which GPIO is the sensor interrupt on?
sudo python3 /home/quaggasklip/find_irq_pin.py
#    put the answer in quaggasklip_config.json as "irq_pin"

# 2. Does the UART work at all? Jumper TX to RX on the Terminal 2 Click first.
sudo -u quaggasklip python3 /home/quaggasklip/check_campbell_link.py --loopback

# 3. Remove the jumper, wire TX->C2 and GND->G, then send real records.
sudo -u quaggasklip python3 /home/quaggasklip/check_campbell_link.py --send

# 4. Set alert_webhook_token in quaggasklip_config.json, then:
sudo systemctl start quaggasklip
journalctl -u quaggasklip -f
```

`install.sh` deliberately does not start the service. The interrupt pin has to be
confirmed first.

### What install.sh changes

- installs `python3-spidev`, `python3-rpi.gpio`, `python3-serial`
- `dtparam=spi=on` - the sensor
- `enable_uart=1` - the logger link
- `dtoverlay=disable-bt` - see below
- removes `console=serial0,…` from `cmdline.txt` and disables the serial getty
- creates the `quaggasklip` user in the `spi`, `gpio` and `dialout` groups

Each boot file is backed up as `*.bak-<timestamp>` before it is touched.

**Why Bluetooth is disabled.** On a Zero W and Zero 2 W, Bluetooth owns the
PL011 UART, which leaves `/dev/serial0` pointing at the mini-UART. The
mini-UART's baud rate follows the VPU core clock, so it drifts when the clock
scales and the logger starts seeing framing errors under load. Releasing
Bluetooth moves `/dev/serial0` onto the PL011 and the link is stable at 9600.
This unit has no use for Bluetooth.

---

## Serial protocol

9600 8N1, ASCII, CR LF terminated.

```
L,<distance_km>,<energy>      one per forwarded strike
H,<cpu_temp_c>,<rssi_dbm>     periodic, about every 10 minutes
```

`distance_km` is `-1` when the storm is out of range (beyond about 40 km).
`energy` is the sensor's own 21-bit comparative figure - useful for ranking
strikes against each other, not a measurement in joules.

This is byte-for-byte the format the GWLD1 unit sends, on purpose: a CRBasic
program written for that site reads this one without modification. It was not
"improved" for that reason alone.

`campbell/QK_CR300_Lightning.CR300` is the logger program. It differs from
GWLD1's in one respect: it reads the `H` status records as well as the `L` strike
records, so the logger can tell a quiet sky from a dead detector
(`DetectorOnline`, `MinutesSinceRecord`). GWLD1's program filtered on a
BeginWord of `L` and therefore discarded them.

### Two transports

`campbell_transport` selects how the bytes leave the Pi.

- **`serial`** (default) - the hardware UART through the Terminal 2 Click. Costs
  no CPU and is indifferent to what else the Pi is doing. This is what the
  Terminal 2 Click is for.
- **`bitbang`** - pigpio waveforms on `campbell_tx_pin`, which is how GWLD1 does
  it because it had no UART breakout. Transmit only. Kept as a fallback for a Pi
  whose `/boot` config cannot be changed; needs `pigpiod` running.

A write can never delay strike detection: the port carries a write timeout and a
stalled write is abandoned and counted rather than retried. An unplugged logger
costs a log line and nothing else.

Anything arriving on RX is logged and **never acted on**. A serial line into a
safety device is not a control channel; treating it as one would let anything
able to reach those screw terminals silence the site.

---

## Panel integration

One URL is configured and the other two endpoints are derived from it, so they
cannot end up pointing at different panels:

```
alert_webhook_url = https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/lightning
                 -> .../api/v1/heartbeat
                 -> .../api/v1/calibration
```

Authentication is a shared secret in the `X-Auth-Token` header. **Do not reuse
another site's token.** Mint a fresh one and set the same value on the panel:

```bash
openssl rand -hex 32
```

`station_id` must match the station the admin assigned to the Quaggasklip tenant,
character for character. A new detector first appears under the platform tenant
and stays hidden from client panels until it is assigned.

The panel marks a unit INACTIVE after 130 minutes of silence, so
`heartbeat_webhook_interval` has to stay well under that. The default is 3600.

---

## Configuration

`quaggasklip_config.json` overrides the defaults in `Config`. Unknown keys and
out-of-range values are logged and ignored rather than fatal, so a typo degrades
to a default instead of a dead detector.

The settings most likely to need attention:

| Key | Default | Notes |
|---|---|---|
| `irq_pin` | `12` | **Confirm with `find_irq_pin.py`.** 19 on a Pi 2 shield |
| `spi_device` | `1` | CE1 = socket 2. Use 0 only if the sensor moves to socket 1 |
| `station_id` | `QUAGGASKLIP` | Must match the panel exactly |
| `alert_webhook_token` | `""` | Per-site secret, never shared |
| `tune_cap` | `0` | Antenna tuning, 0-15, 8 pF per step |
| `noise_floor` | `4` | Raise if the log fills with NOISE events |
| `watchdog_thresh` | `4` | Raise if it fills with DISTURBER events |
| `campbell_transport` | `serial` | `bitbang` only if the UART cannot be freed |
| `pulse_mirror_enabled` | `false` | Enable if the logger counts pulses on P_SW |

Sensitivity is set slightly higher here than at GWLD1 (4 rather than 5 for noise
floor, watchdog and spike rejection). GWLD1 is a smelter site and needs the
extra rejection; Quaggasklip does not, and detects better without it. If the log
fills with NOISE or DISTURBER events, raise these before suspecting the sensor.

---

## Filtering: what reaches the panel

Two filters sit between the sensor and an alert. Both exist because a false
alert costs real money to deliver, and neither can suppress a genuine storm.

**Interference guard.** An implausibly high strike rate is the signature of RF
interference, not lightning. More than 12 strikes in 10 seconds mutes the
outbound paths for 3 minutes. The limit sits far above any real single-site
flash rate.

**Strike validation buffer.** Strikes are held 30 seconds before the panel POST,
then judged:

- a batch containing any varied-distance strike (>1 km, in range) is real storm
  geometry - forward all of it
- an all-1 km batch is forwarded only if a varied-distance strike was seen in the
  last 15 minutes, i.e. a corroborated storm has arrived overhead
- otherwise it is EMI and is discarded

The 1 km bin is where the AS3935 puts anything it cannot place, which is also
where a storm directly overhead appears - so the test is corroboration, not
distance. A real storm approaches with distant strikes first, so genuine overhead
lightning is still covered. Count is deliberately not a way through: two strikes
at 1 km with no context is still EMI.

Both filters gate **only** the outbound paths. Every strike reaches the CSV
regardless, because the local file is the durable record.

`alert_min_distance_km` exists but defaults to 0 (off) and should stay there.
Raising it discards near strikes, which on a safety system means hiding the
lightning that matters most.

---

## Operating

```bash
systemctl status quaggasklip
journalctl -u quaggasklip -f
journalctl -u quaggasklip --since today | grep LIGHTNING

ls -la /home/quaggasklip/lightning_data/         # daily CSV, 90 day retention
tail -f /home/quaggasklip/lightning_data/quaggasklip.log
```

The heartbeat line summarizes everything at a glance:

```
HEARTBEAT - CPU: 44.5 C, Uptime: 86400 s, Noise: 4, WiFi: -61 dBm (Q:52),
Campbell: up (37 sent), Strikes today: 3, Closest: 8 km
```

### Calibration

Runs by itself, and reports to the panel so the monthly report carries real
history rather than an assumed schedule:

- **RC oscillators** - on a 10 °C change in CPU temperature, or every 6 hours
- **Antenna resonance** - daily at 06:00 SAST, when the enclosure is most
  thermally stable. Measures the LCO frequency, and nudges `tune_cap` one step if
  it is outside 3.5% of 500 kHz

The detector is deaf for roughly 250 ms during the antenna check, which is why it
runs once a day at a quiet hour rather than on demand.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Starts, stays healthy, logs no strikes ever | Wrong `irq_pin`. Run `find_irq_pin.py` |
| `Could not open SPI 0.1` | SPI not enabled, or the Click is in socket 1 (`spi_device` 0) |
| `Campbell serial open failed` | Serial console still holding the port, or user not in `dialout` |
| Loopback fails | `enable_uart=1` missing, or `/dev/serial0` is still the mini-UART |
| Logger's `ParseErrorCount` climbing | No common ground, or a baud rate mismatch |
| Panel shows INACTIVE while the unit is up | `heartbeat_webhook_interval` over 130 min, or a bad token |
| Panel returns 401 | Token does not match the panel's |
| Constant NOISE events | Raise `noise_floor` toward 6 |
| Constant DISTURBER events | Raise `watchdog_thresh` and `spike_reject` |
| Strikes logged locally, never on the panel | Being filtered - grep for `FILTERED-EMI` and `interference` |

`find_irq_pin.py` also proves the sensor answers over SPI, so it is the right
first call for almost any "it sees nothing" report.

---

## Files

```
quaggasklip_detector.py       the detector
quaggasklip_config.json       per-site settings (holds the panel token, mode 0600)
find_irq_pin.py               identifies socket 2's interrupt GPIO
check_campbell_link.py        loopback / send / listen check for the UART
quaggasklip.service           systemd unit
install.sh                    installer
requirements.txt              Python dependencies
campbell/QK_CR300_Lightning.CR300   logger program
tests/                        off-target tests, no hardware needed
```

## Tests

```bash
cd Quaggasklip
python3 -m pytest tests -q
```

60 tests, no hardware required: `spidev`, `RPi.GPIO`, `serial` and `pigpio` are
stubbed in `tests/conftest.py`, the same approach the GWLD1 detector's tests use.
They cover the on-wire record format the CR300 parses, the socket-2 pin defaults,
config validation, panel URL derivation, alert gating and both filters.

---

## Relationship to the GWLD1 unit

`Lightning Detector/detector/lightning_detector.py` is the original. What is
shared is shared on purpose: the AS3935 driver, the register map, the CSV
logger, both filters, the temperature compensation and the panel payloads are
the same. Two sites behaving differently under the same weather would produce
reports nobody could compare, and the panel's distance-band summaries assume one
detector behavior across tenants.

What differs is only what the hardware forced:

| | GWLD1 | Quaggasklip |
|---|---|---|
| Sensor socket | 1 | 2 |
| SPI device | 0 (CE0) | 1 (CE1) |
| Interrupt | GPIO17 | GPIO12 |
| Logger link | pigpio bit-bang, GPIO26 | hardware UART, `/dev/serial0` |
| Pulse mirror | GPIO19 | GPIO18 |
| Noise floor / watchdog / spike | 5 / 5 / 5 | 4 / 4 / 4 |

If the register map or a filter changes in one, change it in the other.
