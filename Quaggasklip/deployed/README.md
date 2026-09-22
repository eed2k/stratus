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

| Signal | Pi | Route | CR300 |
|---|---|---|---|
| Lightning records | BCM 14 | Terminal 2 Click `TX` | C2 |
| Strike pulse | BCM 19 | header pin 35 | P_SW |
| Ground | GND | Terminal 2 Click `GND` | G |

BCM 14 is the Pi's hardware UART TX, which is what mikroBUS socket 2 brings out
as its `TX` pin, so the Terminal 2 Click `TX` terminal is the correct one.
Confirmed against the shield's own pin chart.

The detector does not use the UART peripheral. It builds the 9600 baud 8N1
waveform in software with pigpio `wave_add_serial`, and pyserial is not installed
on the unit at all. Because the kernel would otherwise hold BCM 14 in ALT5 for
the console and fight pigpio for it, the serial console has been removed:

- `cmdline.txt` no longer carries `console=serial0,115200`, only `console=tty1`
- `serial-getty@ttyS0` is masked

After that change the pin reads `mode=1 OUTPUT level=1` under pigpio, which is a
UART line correctly idling high. The cost is losing the serial console as a
last-resort way in, which is acceptable now that Tailscale and WiFi SSH both
work, and it is reversible from `cmdline.txt.bak-*` on the boot partition.

This unit previously transmitted on BCM 26, described in the detector source as
an "accessible pin on lower header". Either pin works, since the waveform is
software generated, but BCM 14 is what is physically wired.

Record formats, CR LF terminated:

- `L,<distance_km>,<energy>` where distance is -1 when the strike could not be ranged
- `H,<cpu_temp_c>,<rssi_dbm>`

## The CR300 read that stored nothing

Worth recording because it cost a long afternoon and looks exactly like a cut
cable.

The logger program called:

```crbasic
SerialInRecord (ComC2_Rx, LastRecord, 0, 0, 3338, BytesReturned, 10)
```

With `BeginWord` 0, the `NBytes` parameter becomes the number of bytes to keep
*before* the EndWord. Passing 0 for both therefore asks the logger to store zero
bytes. It finds each record, consumes it from the buffer, stores nothing, and
returns `BytesReturned` 0 every time. Records were arriving and being discarded
in silence.

The symptom set is indistinguishable from a disconnected wire: `BytesReturned` 0,
`ParseErrorCount` 0 because the `If BytesReturned > 0` guard never runs,
`StrikeCount` 0 and `LastRecord` empty. The one clue was `ParseErrorCount` also
sitting at 0, since a genuinely connected-but-garbled line raises parse errors.

The fix follows Campbell's own example and keys each read on its first letter,
with a local read pointer per stream so the two do not compete for one position
in the buffer:

```crbasic
SerialInRecord (ComC2_Rx, StrikeBody, BW_LIGHTNING, 0, CRLF, StrikeBytes, 110)
SerialInRecord (ComC2_Rx, HealthBody, BW_HEALTH,    0, CRLF, HealthBytes, 110)
```

`BW_LIGHTNING` is `&H4C` for `L` and `BW_HEALTH` is `&H48` for `H`. The letter is
consumed as the BeginWord, so `StrikeBody` receives `,40,1234567` and `SplitStr`
in numeric mode treats the leading comma as a delimiter.

The program now also keeps `SerialOpenOK` from `SerialOpen`'s return value and
`BytesWaiting` from `SerialInChk`, both live only and never sampled into a table.
`SerialInChk` returns -1 for a port that was never opened, so between them a
refused port, a dead cable and a framing fault are now three distinguishable
states instead of one silent zero. `tests/check_cr300.py` fails the build if any
`SerialInRecord` ever uses BeginWord 0 again.

## Site noise

This location has a high EMI background, which matters when reading anything the
sensor reports.

With disturbers unmasked and the noise floor at 2, it produced 47 disturber
events in 90 seconds. At the production noise floor of 5 it still raises
`INT_NOISE_HIGH` interrupts, logged as `Noise level too high`.

It also produced a false `LIGHTNING` event at 496 kHz-class energy, 468973, which
reached the admin panel as an alert, while the bench profile had `min_strikes` at
1 and the validation buffer disabled. That is exactly what those two guards exist
to prevent:

- `min_strikes` 5 requires five events before the sensor raises a lightning
  interrupt at all
- the validation buffer discards a batch sitting entirely at 1 km with no
  corroborating storm context, logging `[FILTERED-EMI]`

Never leave `min_strikes` at 1 or `validation_buffer_enabled` false on this unit
outside a supervised bench session. `deployed/qk_bench_profile.sh` switches both
ways and refuses to run if `irq_pin` or `tune_cap` have drifted from their
measured values.

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
