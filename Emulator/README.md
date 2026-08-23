# Lightning Emulator (Arduino Nano + Thunder EMU Click)

Bench rig for injecting synthetic lightning into the AS3935 detector so the whole
chain can be tested end to end: sensor interrupt, distance and energy, heartbeat,
alert evaluation, the admin panel's storm display, and the beacon lamps.

Every strike is fired from **push buttons wired to the Nano**. The Thunder EMU
Click's own buttons are left unwired and unused.

---

## The one thing worth knowing before you wire anything

The EMU Click does not generate a pulse when you press its buttons. Its
`CLOSE`, `MID` and `FAR` pins are **inputs to the host MCU** — they are just
three buttons the host is expected to poll. The emulated strike is produced
entirely by the host writing a timed 12-bit profile to the board's I2C DAC,
which drives an inductor.

That is why this requirement needs no hardware modification at all. You do not
have to intercept, disable or desolder anything: simply leave `AN`, `PWM` and
`INT` unconnected and read your own buttons instead. The Click cannot fire on its
own, because nothing on the board is capable of generating the waveform.

Verified against the vendor driver, [Thunder EMU Click on
LibStock](https://libstock.mikroe.com/projects/view/5463/thunder-emu-click) and
the mikroSDK source in
[MikroElektronika/mikrosdk_click_v2](https://github.com/MikroElektronika/mikrosdk_click_v2)
(`clicks/thunderemu`). Content was rephrased for compliance with licensing
restrictions.

---

## What the firmware reproduces

The vendor's `thunderemu_generate_thunder()` is reproduced exactly:

| Aspect | Value |
|---|---|
| DAC | MCP4725-class, I2C, 12-bit, address `0x60` (alt `0x61`) |
| Write | Fast-mode: `byte0 = mode \| (value >> 8) & 0x0F`, `byte1 = value & 0xFF` |
| Profile | 20 samples, decaying: `1030, 730, 520, 370, 270, 200, 150, 110, 90, 70, 60, 50, 45, 43, 40, 37, 35, 33, 32, 31` |
| Inter-sample delay | 22 us |
| Bursts | `3 - mode`, so CLOSE = 3, MID = 2, FAR = 1 |
| Tail | 10 ms, then DAC to minimum with the 1 k power-down mode |
| I2C speed | 100 kHz (vendor default: `I2C_MASTER_SPEED_STANDARD`) |

**The 100 kHz is deliberate, not lazy.** A 2-byte fast write at 100 kHz occupies
roughly 280 us of bus time, which dwarfs the 22 us delay between samples. The
transfer time is therefore what actually sets the envelope's timing, so raising
the bus to 400 kHz would compress the waveform by roughly a factor of three and
change what the AS3935 sees. If strikes stop being recognised after you touch
`Wire.setClock()`, that is the first thing to put back.

---

## Wiring

The Nano's I2C pins are fixed: `A4 = SDA`, `A5 = SCL`.

| Nano | Thunder EMU Click (mikroBUS) | Purpose |
|---|---|---|
| A4 | SDA | I2C data to the DAC |
| A5 | SCL | I2C clock |
| D6 | RST | Click's on-board thunder LED (host-driven) |
| 5V or 3V3 | VCC | see the voltage note below |
| GND | GND | common ground |
| _not connected_ | AN | Click's own CLOSE button, deliberately unused |
| _not connected_ | PWM | Click's own MID button, deliberately unused |
| _not connected_ | INT | Click's own FAR button, deliberately unused |

Push buttons, each wired from the pin to **GND** (the firmware enables the
internal pull-ups, so no external resistors are needed):

| Nano | Button | Fires |
|---|---|---|
| D2 | CLOSE | 3 bursts, strongest, reads as a nearby strike |
| D3 | MID | 2 bursts |
| D4 | FAR | 1 burst, weakest, reads as a distant strike |
| D5 | STORM | scripted approaching storm: far to close, then receding |
| D13 | on-board LED | activity indicator |

### Voltage: check this before powering up

**I could not confirm the Thunder EMU Click's logic-level tolerance from the
vendor documentation, so do not take 5 V on faith.** MIKROE Click boards are
designed around 3.3 V logic and only some are 5 V tolerant. The Nano is a 5 V
part.

Check the board for a `VCC SEL` jumper or a "3.3 V / 5 V" marking:

- **Jumper present, set to 5 V** — wire `5V` to `VCC` and connect I2C directly.
- **3.3 V only** — power `VCC` from the Nano's `3V3` pin and put a bidirectional
  I2C level shifter on SDA and SCL, or use a 3.3 V board (Nano 33 IoT, Nano
  Every at 3.3 V, or a Pi) instead.

Driving 5 V into a 3.3 V-only I2C input can damage the DAC. If in doubt, the
3.3 V wiring is safe on both.

### Coil spacing

The vendor calibrated the DAC profile for **up to about 15 cm between the
inductors**. Beyond that the field is too weak and the AS3935 will simply not
register anything. If nothing is detected, close the gap before changing code.

---

## Flashing

Arduino IDE or `arduino-cli`, no external libraries needed (`Wire` ships with
the core):

```bash
arduino-cli compile --fqbn arduino:avr:nano arduino/lightning_emulator
arduino-cli upload  --fqbn arduino:avr:nano -p COM5 arduino/lightning_emulator
```

Open the serial monitor at **115200 baud**. Each press logs what was fired.

---

## Using it

1. Power the detector and confirm it is running (`AS3935 calibration PASSED` in
   its log).
2. Place the EMU Click's coil within ~15 cm of the detector's antenna.
3. Press a button. The Nano logs the burst; the detector should log an interrupt.
4. Check the panel: a strike inside the alert radius creates an event, which the
   dashboard's storm display groups into its proximity band.

### About the distance the detector reports

Pressing CLOSE does not command "1 km". The three modes vary the emitted energy,
and the AS3935 derives its own distance from what it receives. The reported
distance therefore depends on coil spacing, orientation and local noise as much
as on the mode. Expect CLOSE to land in a nearer band than FAR, but do not
expect a specific kilometre figure, and do not treat the emulator as a
calibration reference. It tests the pipeline, not the accuracy of the sensor.

Some presses will produce nothing at all. That is normal: the AS3935 runs a
disturber-rejection algorithm and will discard a waveform it does not accept as
lightning. A press that yields no interrupt is not necessarily a fault.

---

## Alert safety

Injecting a strike inside the alert radius exercises the **real** alert path. If
SMS alerts are enabled and recipients are configured, a test strike can send real
messages to real people.

Before bench testing, confirm on the panel dashboard that **SMS alerts are OFF**.
Strikes are still recorded and still appear on the dashboard and in reports with
alerts off, so you lose nothing by testing that way.

---

## Files

```
arduino/lightning_emulator/lightning_emulator.ino    firmware
README.md                                            this file
```
