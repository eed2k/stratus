# Lightning Emulator (Raspberry Pi Zero 2 W + Thunder EMU Click)

Bench rig for injecting synthetic lightning into the AS3935 detector so the whole
chain can be tested end to end: sensor interrupt, distance and energy, heartbeat,
alert evaluation, the admin panel's storm display, and the beacon lamps.

Every strike is fired from the **Thunder EMU Click's own three push buttons**.
Nothing is hand-wired and no external parts are needed: the Click drops into the
mikroBUS socket and its buttons arrive on the socket's `AN`, `PWM` and `INT` pins.

---

## The one thing worth knowing before you start

The EMU Click does not generate a pulse when you press its buttons. Its `CLOSE`,
`MID` and `FAR` pins are **inputs to the host** and nothing on the board can
produce the waveform. The emulated strike comes entirely from the host writing a
timed 12-bit profile to the board's I2C DAC, which drives an inductor.

That is why using the Click's buttons needs no hardware modification at all. You
do not have to intercept, disable or desolder anything. You read three pins and
fire the DAC yourself.

Verified against the vendor driver, [Thunder EMU Click on
LibStock](https://libstock.mikroe.com/projects/view/5463/thunder-emu-click) and
the mikroSDK source in
[MikroElektronika/mikrosdk_click_v2](https://github.com/MikroElektronika/mikrosdk_click_v2)
(`clicks/thunderemu`). Content was rephrased for compliance with licensing
restrictions.

---

## Hardware

| Item | Part |
|---|---|
| Computer | Raspberry Pi Zero 2 W |
| Shield | MikroE Pi click shield (MIKROE-1513), one mikroBUS socket |
| Click | Thunder EMU Click |

The shield mounts on the Pi's first 26 header pins, so only GPIOs on pins 1 to 26
are in play. That matters: it is why `RST` cannot be GPIO5, which does not exist
on a 26-pin header.

### Pin map

| mikroBUS | net | Pi pin | BCM | Role | Direction |
|---|---|---|---|---|---|
| AN | DIG | 15 | **GPIO22** | CLOSE button | input, pull-up |
| PWM | PWM | 12 | **GPIO18** | MID button | input, pull-up |
| INT | INT | 11 | **GPIO17** | FAR button | input, pull-up |
| RST | RST | 7 | **GPIO4** | thunder LED | output |
| SDA | SDA | 3 | GPIO2 | I2C to the DAC | `/dev/i2c-1` |
| SCL | SCL | 5 | GPIO3 | I2C to the DAC | `/dev/i2c-1` |

Read off the vendor schematic, which labels the header by physical pin rather
than by BCM number. The decode checks itself: all eight fixed nets land exactly
where a 26-pin Raspberry Pi header puts them (`SDA` 3, `SCL` 5, `TX` 8, `RX` 10,
`MOSI` 19, `MISO` 21, `SCK` 23, `CS` 24), so the four pins that matter here come
off the same verified table.

Two oddities worth knowing:

- **`AN` is labelled `DIG` on this shield.** There is no ADC on the board, so the
  analog pin is wired straight to a plain GPIO. That is exactly what makes reading
  the `CLOSE` button on it possible at all.
- **`RST` is GPIO4, not GPIO5.** GPIO5 is on pin 29, outside this shield's reach.

### Confirm it before you trust it

The map above is for this shield. Other shields disagree: the two-socket Pi 2
shield puts socket 1's `INT` on GPIO6 and socket 2's on GPIO26, so neither is
GPIO17. A wrong pin gives a rig that starts cleanly, reports itself healthy and
never fires, which is the same failure mode `find_irq_pin.py` exists for on the
detector side.

So on a new board, run this first:

```bash
python3 rpi/lightning_emulator.py --probe-buttons
```

Press `CLOSE`, then `MID`, then `FAR`, one at a time. It watches every pin a Pi
shield plausibly uses for `AN`, `PWM`, `INT` or `RST`, names the one that moved,
and prints a ready-to-paste `--pins` line if your board differs from the default.

---

## Buttons

### Active low

Pressed reads as 0. Confirmed from the vendor example, which fires on
`!thunderemu_get_close_pin()`. The Pi's internal pull-up is enabled, which is
correct whether or not the board also pulls up.

### There are three buttons, not four

`CLOSE`, `MID` and `FAR` map one-to-one onto the three modes, which leaves nothing
spare for the scripted storm. So the storm runs from the keyboard instead:

| Trigger | What it does |
|---|---|
| Click `CLOSE` | 3 bursts, strongest, reads as a nearby strike |
| Click `MID` | 2 bursts |
| Click `FAR` | 1 burst, weakest, reads as a distant strike |
| keyboard `c` `m` `f` | the same three, from the console |
| keyboard `s` | the scripted storm: 9 strikes, approaching then receding |
| any Click button during a storm | stops the storm rather than firing |

If you want the storm hands-free, `--storm-on-hold` adds it to a long press
(1.5 s) of `FAR`. `FAR` then fires on release instead of on press, so a hold does
not fire a strike and a storm. It is opt-in because it makes one button behave
differently from the other two.

### Behaviour copied from the vendor driver

- **500 ms lockout after a burst.** The vendor sleeps 500 ms after a successful
  strike, and that delay gates its whole poll loop, so the lockout here is global
  rather than per button. A second press inside the window is dropped.
- **Nearest range wins.** The vendor polls `CLOSE`, then `MID`, then `FAR` with
  `else if`, so a simultaneous press resolves to the nearest. Reproduced.
- **The DAC is parked powered-down** through the 1 k resistor whenever idle, so
  the coil is not driven between strikes.

---

## What the software reproduces

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
change what the AS3935 sees. If strikes stop being recognised after you touch the
bus speed, that is the first thing to put back.

### Why the Pi version is not a line-for-line port

The reference profile is 20 samples with a ~22 us gap. At 100 kHz a sample is
roughly 300 us and a burst about 6 ms.

A Python loop would add per-call syscall overhead of the same order as the gap
itself, and worse, the scheduler can preempt between samples and insert a gap
measured in *milliseconds*. A burst stretched like that stops looking like
lightning to the AS3935's rejection algorithm, and it fails intermittently, which
is the worst kind of fault to chase.

So the Pi hands each whole burst to the kernel in **one `i2c_rdwr` ioctl**: 20
messages issued back-to-back by the I2C driver with no return to userspace
between them. Python overhead and preemption both disappear. The cost is losing
the 22 us gap, about 7% of the sample period, which is far less error than a
single scheduler hiccup would cause.

`--pace loop` reproduces the Arduino timing literally, for comparison. If the
sensor recognises one mode and not the other, that is worth knowing, and finding
that out is what this rig is for.

It also takes `SCHED_FIFO` for the few milliseconds of a burst when run with
`sudo`, and warns and carries on when it cannot.

---

## Setup and use

```bash
sudo raspi-config nonint do_i2c 0
sudo apt install -y python3-smbus2 python3-gpiozero python3-lgpio
sudo usermod -aG i2c,gpio "$USER"      # log out and back in

python3 rpi/lightning_emulator.py --probe-buttons   # first run, find the pins
python3 rpi/lightning_emulator.py                   # interactive
sudo python3 rpi/lightning_emulator.py              # + SCHED_FIFO, tighter timing
python3 rpi/lightning_emulator.py --fire close      # one shot, for scripts
python3 rpi/lightning_emulator.py --pace loop       # Arduino-identical timing
python3 rpi/lightning_emulator.py --pins 22,18,17,4 # explicit CLOSE,MID,FAR,LED
```

If the DAC is not found, `i2cdetect -y 1` should show a device at `0x60` (or
`0x61`).

### Coil spacing

The vendor states an effective range of **5 to 15 cm** between the emulator coil
and the sensor antenna. Note the lower bound as well as the upper: the profile is
calibrated for that window. Outside it the AS3935 registers nothing, so if a
press does nothing, adjust the gap before changing code.

The vendor also suggests keeping both Click boards away from their host boards to
reduce board noise, which affects the sensor and the emulator alike.

### Do not share the detector's Pi

Give the emulator its own Pi and its own shield. The buses do not clash, since
the detector is on SPI and the emulator on I2C, but GPIO18 is both this shield's
`PWM` and the Quaggasklip detector's strike pulse mirror, and claiming a pin
another process is driving fights it. On a bench rig that costs time chasing a
fault that is not real.

---

## Using it

1. Power the detector and confirm it is running (`AS3935 calibration PASSED` in
   its log).
2. Place the EMU Click's coil within ~15 cm of the detector's antenna.
3. Press a Click button. The emulator logs the burst; the detector should log an
   interrupt.
4. Check the panel: a strike inside the alert radius creates an event, which the
   dashboard's storm display groups into its proximity band.

### About the distance the detector reports

Pressing CLOSE does not command "1 km". The three modes vary the emitted energy,
and the AS3935 derives its own distance from what it receives. The reported
distance therefore depends on coil spacing, orientation and local noise as much
as on the mode. Expect CLOSE to land in a nearer band than FAR, but do not expect
a specific kilometre figure, and do not treat the emulator as a calibration
reference. It tests the pipeline, not the accuracy of the sensor.

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

## The Arduino Nano alternative

`arduino/lightning_emulator/` is a second host for the same Click, kept for the
case where no Pi is free. It differs in two ways worth knowing.

**It still reads four external push buttons, not the Click's.** On the Nano there
is no mikroBUS socket, so the Click is hand-wired either way, and wiring three
jumpers to `AN`, `PWM` and `INT` is the same effort as wiring three buttons. The
Pi is where the Click's own buttons pay off, because the socket does the wiring
for you. The Nano sketch also keeps a fourth button for the storm, which the
three-button Click cannot offer.

**Check the voltage before powering up.** The Nano is a 5 V part. MIKROE Click
boards are designed around 3.3 V logic and only some are 5 V tolerant, and I could
not confirm this board's tolerance from the vendor documentation, so do not take
5 V on faith. Look for a `VCC SEL` jumper or a "3.3 V / 5 V" marking:

- **Jumper present, set to 5 V:** wire `5V` to `VCC` and connect I2C directly.
- **3.3 V only:** power `VCC` from the Nano's `3V3` pin and put a bidirectional
  I2C level shifter on SDA and SCL, or use a 3.3 V board instead.

Driving 5 V into a 3.3 V-only I2C input can damage the DAC. If in doubt, the
3.3 V wiring is safe on both.

### Nano wiring

`A4 = SDA`, `A5 = SCL`, fixed by the part.

| Nano | Thunder EMU Click | Purpose |
|---|---|---|
| A4 | SDA | I2C data to the DAC |
| A5 | SCL | I2C clock |
| D6 | RST | the Click's thunder LED |
| 5V or 3V3 | VCC | see the voltage note above |
| GND | GND | common ground |
| D2 | - | button to GND: CLOSE |
| D3 | - | button to GND: MID |
| D4 | - | button to GND: FAR |
| D5 | - | button to GND: STORM |

Each button has one leg to its Nano pin and the other to **GND**. No resistors,
no `5V`: the firmware uses `pinMode(pin, INPUT_PULLUP)`. All four ground legs
share the same rail as the Click's `GND`. A 4-pin tactile switch is the same
contact twice, so use one leg from each diagonal pair and orientation cannot be
wrong. Nothing is wired to `D13`, which is the on-board LED.

### Nano build

```bash
arduino-cli compile --fqbn arduino:avr:nano         arduino/lightning_emulator
# 6438 bytes flash (20%), 558 bytes RAM (27%), no warnings from the sketch

arduino-cli compile --fqbn arduino:samd:nano_33_iot arduino/lightning_emulator
# 15744 bytes flash (6%), 4204 bytes RAM (12%)

arduino-cli upload --fqbn arduino:avr:nano -p COM5 arduino/lightning_emulator
```

Serial monitor at **115200 baud**. Each press logs what was fired.

Nano Every (`arduino:megaavr:nona4809`) should build for the same reason the
Nano 33 IoT does, but that core is not installed here so it has not been compiled
and is not claimed.

`Wire.setWireTimeout()` exists only in the classic AVR core, not in the SAMD core
the Nano 33 IoT uses nor the megaavr core the Nano Every uses, so the firmware
compiles that one call out by architecture and prints a note on the serial line
saying the I2C timeout is not armed. Nothing else differs and the pin map is
identical. On an AVR core older than 1.8.1, which predates the timeout API and
cannot be detected from a macro, build with `-DEMU_NO_I2C_TIMEOUT` or update the
core.

Sources: the Arduino AVR core's
[Wire.h](https://github.com/arduino/ArduinoCore-avr/blob/master/libraries/Wire/src/Wire.h)
declares `setWireTimeout` and publishes no feature macro for it, and Arduino forum
threads confirm it is missing on
[Nano Every / megaavr](https://forum.arduino.cc/t/no-wire-setwiretimeout-on-nano-every/1250383)
and was
[added to the AVR branch only](https://forum.arduino.cc/t/wire-setwiretimeout-does-not-exist-for-arduino-due/1037030).
Content was rephrased for compliance with licensing restrictions.

---

## Files

```
rpi/lightning_emulator.py                            Pi Zero 2 W host, Click buttons
arduino/lightning_emulator/lightning_emulator.ino    Nano host, external buttons
README.md                                            this file
```

Both reproduce the vendor driver's `thunderemu_generate_thunder()`: the same
20-sample profile, the same `3 - mode` burst count, the same 10 ms tail and
power-down. The Pi version's two-byte fast-mode encoding was checked against the
vendor formula across every mode and every profile value, including clamping.
