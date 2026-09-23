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
| Lightning records | BCM 26 | Terminal 2 Click `INT` | C2 |
| Strike pulse | BCM 19 | Terminal 2 Click `RST` | P_SW |
| Ground | GND | Terminal 2 Click `GND` | G |

Both signals come off the Terminal 2 Click in mikroBUS socket 2, which brings
socket 2 `INT` out on BCM 26 and `RST` on BCM 19. Neither pin is used for
anything else on this unit.

**Do not use the Click's `TX` terminal.** Socket 2 routes `TX` to BCM 14, the Pi's
hardware UART, which on this unit is shared with the USB HUB HAT's CP2102 bridge.
Records transmitted on BCM 14 produced nothing at C2 at all, through three
separate transmit methods. Use BCM 26 on the `INT` terminal.

Land the cable screen at the CR300 end only, on signal ground, and cut it back at
the Pi end. The shield has no earth of its own, so grounding both ends would make
the screen a ground loop conductor.

The detector does not use the UART peripheral, and pyserial is not installed on
the unit at all. It builds the 9600 baud 8N1 waveform in software with pigpio, so
any free GPIO works and the transmit pin is only a config value. Note that it uses
`wave_add_generic` rather than `wave_add_serial`, because the waveform has to be
inverted and `wave_add_serial` only emits standard TTL. See "The receive
corruption" below.

Two boot changes were made while BCM 14 was still the candidate pin. Both were
kept, because each is worth having on its own:

- The serial console was removed, so the kernel no longer holds BCM 14 in ALT5.
  `cmdline.txt` carries only `console=tty1` and `serial-getty@ttyS0` is masked.
  Reversible from `cmdline.txt.bak-*` on the boot partition.
- `dtoverlay=disable-bt`, which moves `serial0` from `ttyS0` to `ttyAMA0`. The
  mini-UART derives its baud rate from the VPU core clock, which is not pinned, so
  the rate drifts when the clock does. That is the explanation for the console
  baud drift seen earlier and written off at the time as unexplained. It also
  saves a little power.

Losing the serial console costs a last-resort way in, acceptable now that both
Tailscale and WiFi SSH work.

Record format, CR LF terminated:

- `L,<distance_km>,<energy>` where distance is -1 when the strike could not be ranged

There was also an `H,<cpu_temp_c>,<rssi_dbm>` health record. It is no longer sent:
`campbell_heartbeat_enabled` is false and the handling has been removed from the
logger program, so an `H` record arriving now counts as a parse error. That is
deliberate, because it would mean the detector is misconfigured.

There is no bearing field and no site position on the wire. The AS3935 is a
single-antenna sensor: it measures distance to the storm and energy, and it cannot
resolve direction, so a bearing field could only ever hold a fabricated number.

## What the logger stores

Distance, energy, timestamp. One row per accepted record in `LightningEvents`,
where the timestamp is the stamp CRBasic writes on every row rather than a field
of its own.

Nothing else is stored. No daily summary table, no running strike total, no
closest-of-day, no health field. All of that is derivable from the stored rows,
and the admin panel is the system of record for whether a unit is alive, so a
second copy here could only disagree with it.

The consequence is worth stating plainly: **the logger cannot tell a quiet sky
from a dead detector.** That is deliberate, and it is the panel's job.

The program keeps a small set of live-only `Public` variables for commissioning:
`SerialOpenOK`, `BytesSeenTotal`, `RecordsRead`, `StrikeCount`, `ParseErrorCount`,
`PulseCountTotal`, `LPos`, `RecLen`, `LastRecord` and `FirstRecord`. None of them
is sampled into a table, and `tests/check_cr300.py` fails the build if any ever is.

## The receive corruption

**RESOLVED on 23 September 2026. The cause was signal polarity.**

The CR300's C1/C2 control terminals use RS-232 logic, inverted with respect to
TTL: idle low, start bit high, data bits complemented. The Pi was transmitting
plain idle-high TTL, so every byte decoded wrongly while still framing at the
correct rate.

The fix is in the detector, not the wiring. `CampbellUartTx._add_wave` builds the
inverted waveform with pigpio `wave_add_generic`, because `wave_add_serial` only
emits standard TTL, and the line idles low. It is controlled by
`campbell_uart_invert` in `lightning_config.json`, and startup logs confirm it:
`Campbell UART TX enabled on GPIO 26 @ 9600 baud (inverted)`.

How it was found, because the symptom is misleading: modelling an inverting
receiver against the transmitted bit stream reproduced the observed bytes
exactly, `214 218 217 118 235` for the first five of `L,40,1234567`. Five
consecutive exact byte matches is not coincidence.

### Wrong turns, recorded so they are not repeated

- **`BytesSeenTotal` 70 for 70 bytes sent was read as proof of a healthy
  physical link.** It is not. Every transmitted byte contains exactly one start
  bit, so a receiver frames one byte per transmitted byte whether it decodes the
  levels correctly or not. The matching count proved only that something arrived.
- **Twelve clean `0x55` bytes were read as proof the line held levels.** A
  back-to-back `0x55` stream is `0 1 0 1 0 1 0 1 0 1`, a perfect square wave, and
  inverting a square wave maps it onto itself. `0x55` is the one byte pattern in
  the whole space that cannot detect an inversion. It was the worst possible
  choice of test.
- **Bytes with long runs of identical bits failing while alternating bytes
  survived** was read as a capacitance signature. It is equally the signature of
  inverted polarity, and the latter was never tested until late.
- **A DC hold test was used to conclude the conductor was open.** The test was
  invalid: a UART receive line held low is a break condition, so the receiver
  reports one or two framing errors and then waits for idle before re-syncing. It
  produces a handful of bytes whether or not the wire is connected.
- **The `InStr` change** was made on a theory of a leading byte offset. It is
  harmless and stays, but it was not the fix.

The lesson that held: measurements survived, inferences from symptoms did not.
The transmit waveform capture, the GPIO 6 pin hunt and the receiver simulation
all held up. Everything reasoned from counter values was wrong.

### What is proven working

- **The pulse path.** BCM 19 to `P_SW`, counted repeatedly, 8 and 16 in separate
  runs. This proves the Pi reaches the logger, that the ground return is sound,
  and that the logger is executing the program. It is also a genuine independent
  strike count in service, emitted before the interference guard and the
  validation buffer, so it survives both.
- **The emitted waveform.** 105 us median bit period against 104.167 nominal for
  9600, mean 104.20, measured by timestamping edges with pigpio. Baud is correct
  and cumulative error by the stop bit is under 8% of a bit.
- **The port opens.** `SerialOpenOK` reads true.

### Genuinely eliminated

| Suspect | How it was eliminated |
|---|---|
| Baud mismatch | waveform captured at the pad, self-decodes byte for byte |
| `PortPairConfig` | does not exist on a CR300, the compiler rejects it |
| `ComC1` | CR6/CR1000X spelling, does not compile here |
| `Com1` | compiles, but received nothing on this unit. Use `ComC2_Rx` |
| Ground | proven by the pulse path counting correctly |
| Pi-side transmission | all 14 bytes decode, every start and stop bit valid, 46% sampling margin |
| BCM 14 | shared with the USB HUB HAT's CP2102. Nothing arrives. Use BCM 26 |

### The false elimination that cost the most

**Logic levels were ruled out early**, on the grounds that the CR300 datasheet
lists C1/C2 as 5.0 V output and 3.3 V input, which matches what the Pi drives.
That reasoning was about *voltage* and the fault was *polarity*. The voltage was
never the problem and the levels table said nothing about idle state or sense.

Once a suspect is in a "ruled out" table it stops being reconsidered, which is
why this one survived so long. If a fault resists every remaining explanation,
re-read the eliminations and check what each one actually tested rather than what
it appeared to cover.

### Method note

The findings that held up were measurements: the GPIO 6 pin hunt and the bit
timing. The ones that wasted time were inferences from symptoms, usually with more
than one variable changed at once. Work one measurement at a time here, and state
what result would falsify an idea before testing it.

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

Keying each read on the record's first letter as a BeginWord was tried next. It
never framed anything either, even once all 70 bytes of a burst were confirmed
arriving, and it makes the read depend on the single byte a waking port is most
likely to drop. `SerialInRecord` is no longer used at all.

The read is now:

```crbasic
LastRecord = ""
SerialIn (LastRecord, ComC2_Rx, 1, LF, MAX_CHARS)
```

`TimeOut` is 1, in 0.01 s units, **not 0**: zero waits indefinitely for the
terminator and would stall the scan. `LF` is 10 as a numeric code, so the
terminator is excluded while the CR ahead of it is kept, which is what lets a
complete record be told apart from a fragment. `LastRecord` is cleared first
because `SerialIn` leaves the destination untouched when nothing arrives.

The program keeps `SerialOpenOK` from `SerialOpen`'s return value, so a port that
refused to open stays distinguishable from a dead cable, and accumulates
`SerialInChk` into `BytesSeenTotal` rather than publishing it raw.
`tests/check_cr300.py` fails the build if `SerialInRecord` ever reappears.

**A diagnosis cost paid twice:** `LastRecord` is cleared at the top of every scan,
so it reads empty almost all of the time, and asking someone to catch it in the
Public table was never going to work. `FirstRecord` latches the first non-empty
read and is never cleared. The probe goes further and publishes byte values as
numbers, because a corrupt string renders as mojibake and throws away the detail
that matters.

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
