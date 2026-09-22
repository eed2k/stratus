# What is actually running at Quaggasklip

Property of METRON (PTY) LTD | Inteltronics
Developed by L.J. Esterhuizen, Inteltronics

The unit does not run `../quaggasklip_detector.py`. It runs an older, larger
build under different filenames, with a different service name and different
configuration keys. This directory records the deployed reality so the CR300
program and the wiring notes can be checked against something true rather than
against an aspiration.

Read this before changing anything on the unit.

## The two builds are not interchangeable

| | Deployed on the unit | In this repository |
|---|---|---|
| Detector | `/home/quaggasklip/lightning_detector.py` (94251 bytes) | `../quaggasklip_detector.py` |
| Config | `/home/quaggasklip/lightning_config.json` | `../quaggasklip_config.json` |
| Service | `lightning-detector.service` | `../quaggasklip.service` |
| Campbell keys | `campbell_uart_enabled`, `campbell_uart_tx_pin` | `campbell_enabled`, `campbell_transport` |
| Heartbeat gate | none, interval only | `campbell_heartbeat_enabled` |

Do not copy `../quaggasklip_config.json` onto the unit. Its `tune_cap` is 0 and
its `alert_webhook_enabled` is false, so the unit would lose its calibration and
stop reporting to the admin panel. The key names differ as well, and the
deployed loader logs unknown keys as warnings and skips them, so most of the
file would be silently ignored while the few keys that do match would do damage.

The deployed build is the mature one. It carries the interference guard, the
validation buffer and the storm context window. Replacing it is a project in its
own right, not a configuration change.

## Corrections applied on 22 September 2026

### irq_pin 17 to 6, the fix that made the unit work at all

The AS3935 interrupt line is on **GPIO 6**. This was measured, not inferred:
`as3935_lco_probe.py` asserts DISP_LCO on the sensor, forces the LCO divider to
128 so the output lands near 3.9 kHz, and counts edges on eighteen candidate
GPIOs at once through pigpio. Only GPIO 6 carried a clock. Every other pin,
including 17, was silent.

While `irq_pin` was 17 the detector watched a pin nothing was connected to. It
could not see a single interrupt, so it recorded no strikes, emitted no pulse to
the logger, sent no `L,` record, and measured the antenna as 0 Hz. The comment at
line 151 of the deployed detector, which claims the Click Shield routes socket 1
INT to GPIO 17, is wrong.

Proof the corrected path works, taken with disturbers briefly unmasked and the
noise floor briefly at 2:

- pigpio counted 36 rising edges on GPIO 6 in 90 seconds
- the detector wrote 47 `DISTURBER` rows to `lightning_data/lightning_2026-09-22.csv`
- the CSV timestamps match the pigpio edge times

Disturbers are logged at `logger.debug` while `LOG_LEVEL` is `INFO`, so nothing
appears in the journal for them. An empty journal is not evidence of an idle
sensor on this build.

### tune_cap 12 to 9

Swept all sixteen values on GPIO 6 with the divider at 128 and a one second
window, which gives 128 Hz of resolution:

| tune_cap | pF | resonance | error |
|---|---|---|---|
| 0 | 0 | 517120 Hz | +3.42% |
| 9 | 72 | 500992 Hz | **+0.20%** |
| 12 | 96 | 496512 Hz | -0.70% |
| 15 | 120 | 490496 Hz | -1.90% |

Every value falls inside the 3.5% band, so the antenna was never out of
tolerance and never needed correcting. 9 is simply the closest to 500 kHz.

### antenna_check_enabled true to false

The built-in daily check cannot work on this hardware and does harm when it
runs:

1. `FREQ_DIV_RATIO` defaults to 16 and is programmed to the sensor, so the LCO
   pin carries 31.25 kHz. `_measure_antenna_frequency` counts that with
   `RPi.GPIO.add_event_detect` and a Python callback, which is one edge every
   32 us on an 800 MHz ARMv6. It cannot keep up and returns 0.
2. Reading 0 Hz, the check concludes the antenna is far below tolerance and
   decrements `tune_cap` by one step, walking a correctly tuned antenna away
   from its optimum a step per day.
3. It never writes the adjustment back to the config file. There is no
   save-config path anywhere in the deployed build, so the change is lost on
   restart and cannot even hold its own result.

The admin panel recorded this happening once, on 15 September 2026:
`antenna_check, freq_hz 0, in_tolerance 0, tune_cap 12 to 11`.

Verify resonance on the bench with `as3935_lco_probe.py` instead. It is
installed at `/home/quaggasklip/as3935_lco_probe.py` with `run_lco_probe.sh`,
which stops the detector, probes, and restarts the detector from a trap so the
service comes back even if the probe fails.

### campbell_heartbeat_interval 600 to 86400

Detector health belongs to the admin panel. This build has no flag to silence
the Campbell status string and its validator caps the interval at 86400, so one
record a day is as close to off as configuration can get. The CR300 program also
recognises `H,` records and discards them without counting them as parse errors,
so nothing reaches storage either way.

## Wiring as built

Two signal wires and a ground, straight off the Pi's 40-pin header. The Click
Shield mikroBUS sockets are not in this path.

| Signal | Pi | Header pin | CR300 |
|---|---|---|---|
| Lightning records | BCM 26 | 37 | C2 |
| Strike pulse | BCM 19 | 35 | P_SW |
| Ground | GND | 39 | G |

BCM 26 is not a hardware UART pin, and that is deliberate. The detector builds
the 9600 baud 8N1 waveform in software with pigpio `wave_add_serial`, so any free
GPIO serves. pyserial is not installed on the unit. Do not move this wire to
BCM 14 expecting the hardware UART, because nothing transmits there.

Record formats, CR LF terminated:

- `L,<distance_km>,<energy>` where distance is -1 when the strike could not be ranged
- `H,<cpu_temp_c>,<rssi_dbm>`

## Behaviour on power up

The Pi Zero W has no real-time clock. It boots with whatever time was last
saved, starts the detector before DNS is available, and the first panel
heartbeat fails with `Temporary failure in name resolution`. The scheduler then
treats that attempt as spent and waits a full `heartbeat_webhook_interval`,
3600 seconds, before trying again. NTP corrects the clock part way through, so
the journal shows a jump of several hours partway down the boot sequence.

The practical effect is that a cold start can take up to an hour to appear in
the admin panel. It recovers on its own. A restart with the network already up
produces a heartbeat within three seconds.

## Access

Tailscale 1.102.4, joined untagged as `quaggasklip-lds`,
`100.103.93.118`, `quaggasklip-lds.taila9ee5b.ts.net`. Tailscale SSH is on,
`--accept-dns=false`, daemon enabled so it returns after a reboot. Nearest DERP
is Johannesburg at about 94 ms.

The node was joined with a single-use key that carried no tag authorisation, so
it is untagged and therefore subject to key expiry, currently
2027-03-21. Disable key expiry for this machine in the admin console, or define
`tag:lds` with a `tagOwners` entry and re-authenticate with a tagged key.
Otherwise the unit silently leaves the tailnet on that date.

`authorized_keys` holds exactly one key, `quaggasklip-lds-only`. Nothing from
any other site has access to this unit.
