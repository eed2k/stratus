# Quaggasklip (Metron) lightning detector

Third AS3935 detector site. A Raspberry Pi Zero W or Zero 2 W with a MikroE
Pi 2 Click Shield: a **Thunder Click** in mikroBUS socket 1 reads lightning, and a
**Terminal 2 Click** in socket 2 carries the results to a Campbell CR300 or
CR1000 datalogger over UART. Strikes also go to the Stratus admin panel, which
owns all alerting.

This unit never sends an SMS or an e-mail. It posts to the panel; the panel
decides who hears about it.

---

## Hardware

| Item | Part |
|---|---|
| Computer | Raspberry Pi Zero W or Zero 2 W |
| Shield | MikroE Pi 2 Click Shield |
| Socket 1 | Thunder Click - AS3935 lightning sensor |
| Socket 2 | Terminal 2 Click - UART to the datalogger |

### Pin map

Taken from the Pi 2 Click Shield schematic. Both mikroBUS sockets share SPI0 and
are told apart only by chip select, because CE0 and CE1 are the Pi's only
hardware CS lines.

| mikroBUS pin | Socket 1 (Thunder / AS3935) | Socket 2 (Terminal 2) |
|---|---|---|
| AN | GPIO4 | GPIO13 |
| RST | GPIO5 | GPIO19 |
| **CS** | **GPIO8 = CE0 = `spidev 0.0`** | **GPIO7 = CE1 = `spidev 0.1`** |
| SCK | GPIO11 *(shared)* | GPIO11 *(shared)* |
| MISO | GPIO9 *(shared)* | GPIO9 *(shared)* |
| MOSI | GPIO10 *(shared)* | GPIO10 *(shared)* |
| PWM | GPIO18 | GPIO17 |
| **INT** | **GPIO6** | **GPIO26** |
| RX | GPIO15 *(shared)* | GPIO15 *(shared)* |
| TX | GPIO14 *(shared)* | GPIO14 *(shared)* |
| SCL | GPIO3 *(shared)* | GPIO3 *(shared)* |
| SDA | GPIO2 *(shared)* | GPIO2 *(shared)* |

So on this unit the sensor is `spidev 0.0` with its interrupt on **GPIO6**.

Three consequences worth knowing before wiring anything:

- **These are Pi 2 shield numbers and do not transfer to a Pi 3 shield.** The
  Pi 3 shield adds an onboard MCP3204 ADC which takes GPIO19, 20 and 21 for SPI1
  and GPIO16 for its chip select, and its socket 2 interrupt is GPIO12. Confirm
  the interrupt on the assembled unit with `find_irq_pin.py` rather than trusting
  any table, including this one. A wrong interrupt pin gives a detector that
  starts cleanly, logs nothing, and reports itself healthy.
- **GPIO12 is connected to nothing on a Pi 2 shield.** It is a plausible-looking
  value that silently cannot work, so if `irq_pin` is ever 12 on this hardware
  the detector will never see a strike.
- **Only socket 2's pins can reach a wire.** Socket 1 has the Thunder Click
  seated on it, so GPIO4, 5 and 18 terminate under that board with no screw
  terminal. Anything that has to leave the enclosure must be on a socket 2 pin.

Not routed to either socket, so free for other use: GPIO12, 16, 20, 21, 22, 23,
24, 25, 27.

### Wiring to the logger

Everything leaves from the Terminal 2 Click's screw terminals, so one cable runs
to the logger. The Click breaks socket 2 out across two 9-position blocks, one per
side of the mikroBUS socket:

| Block | Terminals | mikroBUS pins |
|---|---|---|
| left | AN, RST, CS, SCK, MISO, MOSI, 3V3, GND | 1 to 8 |
| right | GND, 5V, SDA, SCL, RX, TX, INT, PWM | 9 to 16 |

**Wire by the silkscreen label, never by counting positions.** The signal names
are printed beside the terminals. Block position numbers are a different scheme
and an earlier revision of these notes stated them wrongly.

| Terminal 2 Click | Socket 2 pin | CR300 | Purpose |
|---|---|---|---|
| `TX` | GPIO14 | C2 | ASCII records, Pi to logger |
| `GND` (either block) | - | G | common ground, **required** |
| `RST` | GPIO19 | P_SW | one pulse per strike, optional |
| `RX` | GPIO15 | - | leave open, the logger never transmits |

`TX` is mikroBUS pin 14 and is the host's transmit output, so it carries the Pi's
outgoing records. It must go to **C2**, because that is the terminal the logger
program opens for receive with `ComC2_Rx`. Nothing listens on C1.

Ground is not optional. Without a shared reference the receiver sees noise
instead of data, and the only symptom is a rising `ParseErrorCount`.

**On the strike pulse pin.** It has to be a socket 2 pin to reach a terminal, and
GPIO19 is socket 2's RST, so it comes out on the terminal labelled `RST`
(mikroBUS pin 2, left block). That matches what the CR300 program's header says.
GPIO17 is the other candidate, socket 2's PWM on the terminal labelled `PWM`, and
it is the more natural name for a pulse output; if you move to it, update the
logger program's comment as well so the two do not drift apart. GPIO18 is **not**
an option on this build despite being the obvious "socket 1 PWM": socket 1 is
where the Thunder Click sits, so GPIO18 has no terminal to land on.

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
H,<cpu_temp_c>,<rssi_dbm>     status - DISABLED on this unit, see below
```

`distance_km` is `-1` when the storm is out of range (beyond about 40 km).
`energy` is the sensor's own 21-bit comparative figure - useful for ranking
strikes against each other, not a measurement in joules.

The format is byte-for-byte what the GWLD1 unit sends, on purpose: a CRBasic
program written for that site reads this one without modification. It was not
"improved" for that reason alone.

### The logger records lightning, the panel records health

`campbell_heartbeat_enabled` is **`false`**. The `H` status record is not sent to
the logger at all. Detector health goes to the admin panel, which already
receives it on the panel heartbeat and is the system of record for whether a unit
is alive. Putting the same fact in two places is how the two end up disagreeing.

The consequence, stated rather than hidden: **the logger cannot tell a quiet sky
from a dead detector**, because both produce zero `L` records. That question is
now answered by the panel alone. If you ever want the logger to answer it too,
set `campbell_heartbeat_enabled` to `true` and add an `H` branch back to the
logger program.

`campbell/QK_CR300_Lightning.CR300` therefore stores only distance, energy and
the independent pulse count. It accepts a record only when it begins `L,` - two
characters, so a corrupted line like `LL,1,2` cannot have its numbers logged as a
real strike - and counts anything else in `ParseErrorCount` without storing it.
That holds even if the status record is re-enabled on the Pi.

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
| `irq_pin` | `6` | **Confirm with `find_irq_pin.py`.** Never 12: GPIO12 reaches neither socket |
| `spi_device` | `0` | CE0 = socket 1, where the Thunder Click sits. 1 only if it moves to socket 2 |
| `station_id` | `QUAGGASKLIP` | Must match the panel exactly |
| `alert_webhook_token` | `""` | Per-site secret, never shared |
| `tune_cap` | `0` | Antenna tuning, 0-15, 8 pF per step |
| `noise_floor` | `4` | Raise if the log fills with NOISE events |
| `watchdog_thresh` | `4` | Raise if it fills with DISTURBER events |
| `campbell_transport` | `serial` | `bitbang` only if the UART cannot be freed |
| `pulse_mirror_enabled` | `false` | Enable if the logger counts pulses on P_SW |
| `test_mode_poll_enabled` | `true` | Whether the unit asks the panel about test mode |
| `test_mode_poll_interval` | `60` | Seconds between polls |
| `test_mode_max_s` | `3600` | Local ceiling on a test window, 60 min. Cannot be raised past an hour |

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

## Test mode (commissioning)

Commissioning means proving the whole path: sensor, interrupt, POST, event row on
the panel. Waiting for a thunderstorm is not a commissioning plan, and the AS3935
will not fire on a bench without a spark source. Test mode is how that gets done.

A Stratus Admin switches it on **per detector** on the platform console's
Detectors page (`/units`), for up to 60 minutes. Client logins cannot see or use
it.

While it is on, this unit:

- reports disturbers instead of discarding them, and forwards each one to the
  panel as a 0 km event. A disturber is something a technician can produce on
  demand, so it is what proves the path. 0 km because a disturber genuinely has
  no distance, and inventing a plausible one would put a figure in the client's
  history that nothing measured
- drops `min_strikes` to 1, so a single event fires
- bypasses the interference guard and the validation buffer, which would
  otherwise discard exactly the pattern a bench test produces

The panel records everything that arrives, tags it as a test, and **sends no SMS
for that detector while the window is open, including for a genuine strike**. That
is why the window is short and why it is not a client-facing control.

Four independent things end it:

| Ends it | How |
|---|---|
| The local deadline | A monotonic deadline inside the process. Nothing has to run for it to expire |
| The panel | Its own ceiling, and its own stored expiry |
| A restart | The deadline is in memory only, never written to disk |
| An unreachable panel | A failed poll changes nothing, so the deadline runs down and the test ends |

The unit **asks**; the panel never tells. It polls
`GET .../api/v1/detector/config?station_id=...` once a minute over the same
outbound HTTPS it already uses, so nothing new listens on the detector. The reply
carries a remaining time, not an expiry, so no agreement about clocks or time
zones is needed and a unit with a wrong clock still stops on schedule.

Both ceilings are enforced independently and the lower one wins, so neither a
panel-side mistake nor anything else able to answer that URL can hold the unit in
a state where it filters nothing.

The log says exactly what is happening, at warning level in both directions:

```bash
journalctl -u quaggasklip | grep "TEST MODE"
```

Every unit logs `Test mode: off` at boot, because the state cannot survive a
restart.

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


## Remote access (Tailscale)

The unit sits on whatever network the site provides, usually behind NAT with no
public address. Tailscale puts it on a private mesh so it can be reached from
anywhere without port forwarding or a VPN concentrator.

```bash
sudo bash tailscale_setup.sh --authkey tskey-auth-xxxxx --advertise-tags=tag:lds
sudo bash tailscale_setup.sh --status          # read-only, no sudo needed
```

Then from any machine on the tailnet:

```bash
ssh quaggasklip@quaggasklip-lds       # MagicDNS
ssh quaggasklip@100.x.y.z             # or the Tailscale IP
```

Tailscale SSH is enabled, so access is governed by tailnet ACLs rather than by
keys or passwords held on the unit.

### Why a tarball and not apt

**A Pi Zero W is ARMv6.** The `armhf` apt package is built for ARMv7, so the
packaged `tailscaled` dies immediately with `Illegal instruction`
([tailscale#6778](https://github.com/tailscale/tailscale/issues/6778)). This build
supports a Zero W *or* a Zero 2 W, which are ARMv6 and ARMv8, so the script reads
`uname -m` at run time and fetches the matching static build:

| `uname -m` | Board | Build |
|---|---|---|
| `armv6l` | Pi Zero W | `arm` |
| `armv7l` | Zero 2 W, 32-bit OS | `arm` |
| `aarch64` | Zero 2 W, 64-bit OS | `arm64` |

One code path for both removes any chance of quietly installing an ARMv7 binary
on an ARMv6 chip. If the daemon still fails to start, the script greps the journal
for `illegal instruction` so that failure names itself instead of looking like a
network fault.

Tradeoff: no automatic apt upgrades. Re-run the script to upgrade; it compares
versions and only replaces the binaries when they differ.

### Two things only the admin console can do

**Tag the node, or it goes dark after about 180 days.** A node's key expires by
default and the unit then drops off the tailnet. On something mounted on a pole
that is an expensive way to find out. Tagged devices have no key expiry, so define
a tag such as `tag:lds` in the ACL policy with yourself as owner and pass
`--advertise-tags=tag:lds`. The script warns if the node ends up with an expiring
key, but it cannot fix that from the device side.

**Approve the subnet route** if you use `--advertise-lan`. That advertises the
unit's own LAN, which is also how you would reach the CR300's web interface
remotely. Advertised routes stay inactive until approved.

`--accept-dns=false` is deliberate. The detector resolves the panel's hostname
over the site uplink, and rewriting `/etc/resolv.conf` on an appliance is a good
way to break something that was working.

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
| Events arriving on the panel but no SMS sent | Test mode may be on. Check `/units`, or `grep "TEST MODE"` in the log |
| Disturbers suddenly appearing as 0 km events | Test mode is on. It ends by itself; end it sooner from `/units` |

`find_irq_pin.py` also proves the sensor answers over SPI, so it is the right
first call for almost any "it sees nothing" report.

---

## Files

```
quaggasklip_detector.py       the detector
quaggasklip_config.json       per-site settings (holds the panel token, mode 0600)
find_irq_pin.py               identifies socket 1's interrupt GPIO
check_campbell_link.py        loopback / send / listen check for the UART
as3935_bench_cal.py           tune-cap calibration and register sweep
run_bench_cal.sh              wrapper: stops the detector, restores it on any exit
tailscale_setup.sh            remote access, architecture-aware
quaggasklip.service           systemd unit
install.sh                    installer
requirements.txt              Python dependencies
campbell/QK_CR300_Lightning.CR300   logger program
tests/                        off-target tests, no hardware needed
tests/check_cr300.py          static review of the logger program
tests/test_cr300_parse.py     Pi to CR300 record contract
tests/test_test_mode.py       every way the commissioning test window can end
```

## Tests

```bash
cd Quaggasklip
python3 -m pytest tests/test_quaggasklip.py tests/test_test_mode.py -q

# The other two are standalone scripts, not pytest modules:
python3 tests/check_cr300.py            # static review of the logger program
python3 tests/test_cr300_parse.py       # Pi to CR300 record contract
python3 tests/test_antenna_guard.py     # the antenna retune guard
```

86 pytest tests plus 211 checks in the three scripts, none needing hardware:
`spidev`, `RPi.GPIO`, `serial` and `pigpio` are stubbed in `tests/conftest.py`,
the same approach the GWLD1 detector's tests use. They cover the on-wire record
format the CR300 parses, the socket-2 pin defaults, config validation, panel URL
derivation, alert gating, both filters, and every way test mode can end.

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
