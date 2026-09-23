#!/usr/bin/env python3
# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Raspberry Pi Zero 2 W host for the Thunder EMU Click: injects synthetic
#  strikes for bench testing of LDS detector units.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
"""AS3935 lightning emulator - Raspberry Pi Zero 2 W + Thunder EMU Click.

Strikes are fired from the Click's OWN three push buttons. Nothing is
hand-wired: the Click drops into the single mikroBUS socket on the Pi Click
Shield and the buttons come through on that socket's AN, PWM and INT pins.

PROCESS
  1. Host writes a 20-sample decaying profile to the Click's MCP4725 DAC.
  2. DAC output drives an inductor, emitting an RF burst.
  3. Burst repeats (3 - mode) times: CLOSE 3, MID 2, FAR 1.
  4. 10 ms tail, then DAC parked powered-down at 0.
  5. AS3935 receives the burst and derives its own distance and energy.

  The Click cannot fire on its own. Its buttons are plain inputs for the host to
  read; the waveform is produced entirely by the host writing to the DAC. So
  "use the Click's buttons" is a software change only, with no board
  modification and no external parts.

THE CLICK HAS THREE BUTTONS, NOT FOUR
  CLOSE, MID and FAR map one-to-one onto the three modes, which leaves no button
  for the scripted storm. Storm therefore runs from the keyboard ('s') or
  --fire storm. Pass --storm-on-hold to also get it from holding FAR.

BUTTON POLARITY
  Active low, confirmed against the vendor example, which fires on
  !thunderemu_get_close_pin(). Pressed = 0. The Pi's internal pull-up is
  enabled, which is correct whether or not the board also pulls up.

PIN MAP (BCM), MikroE Pi click shield (MIKROE-1513)
  One mikroBUS socket, so one set of pins and nothing to choose.

    mikroBUS  net   Pi pin  BCM      role    direction
    AN        DIG   15      GPIO22   CLOSE   input, pull-up
    PWM       PWM   12      GPIO18   MID     input, pull-up
    INT       INT   11      GPIO17   FAR     input, pull-up
    RST       RST    7      GPIO4    LED     output
    SDA       SDA    3      GPIO2    I2C     /dev/i2c-1
    SCL       SCL    5      GPIO3    I2C     /dev/i2c-1

  Taken from the vendor schematic, which labels the header by physical pin
  rather than by BCM number. The decode is self-checking: all eight fixed nets
  (SDA 3, SCL 5, TX 8, RX 10, MOSI 19, MISO 21, SCK 23, CS 24) land exactly
  where the 26-pin Raspberry Pi header puts them, so the four pins that matter
  here are read off the same table.

  Two of these are worth knowing:
    AN is named DIG on this shield. There is no ADC on the board, so the analog
    pin is just wired to a plain GPIO, which is what makes reading the Click's
    CLOSE button on it work at all.
    RST is GPIO4, not GPIO5. GPIO5 is not on a 26-pin header, and this shield
    only uses pins 1-26.

  This map does NOT carry over to other shields. The two-socket Pi 2 shield puts
  socket 1's INT on GPIO6 and socket 2's on GPIO26, so neither is GPIO17. If you
  swap shields, check before running:

    python3 lightning_emulator.py --probe-buttons

  A wrong pin gives a rig that starts cleanly, reports itself healthy and never
  fires, which is the same trap find_irq_pin.py exists for on the detector side.

SHARING THE DETECTOR'S PI
  Don't. Give the emulator its own Pi and its own shield. The buses do not
  clash, since the detector is on SPI and the emulator on I2C, but GPIO18 is
  both this shield's PWM and the Quaggasklip detector's strike pulse mirror, and
  claiming a pin another process is driving fights it. On a bench rig that costs
  time chasing a fault that is not real. Two boards is the cheap way out.

TIMING
  I2C 100 kHz. One 2-byte write = ~280 us bus time. Sample period ~300 us.
  Burst ~6 ms.

  Two pacing modes:
    batched (default)  one i2c_rdwr ioctl per burst. The kernel issues all 20
                       messages back-to-back without returning to userspace.
                       No 22 us gap; no Python or scheduler jitter either.
    loop               one write per call plus a 22 us busy-wait, matching the
                       Arduino sketch. Subject to syscall overhead and
                       preemption.

  Linux i2c-dev caps one ioctl at 42 messages (I2C_RDWR_IOCTL_MAX_MSGS), so
  bursts are sent one ioctl each.

  SCHED_FIFO is held for the duration of a burst where permitted (root or
  CAP_SYS_NICE), otherwise normal scheduling is used.

DAC PROTOCOL
  MCP4725 at 0x60, or 0x61 when strapped.
  Fast-mode write, 2 bytes:
    byte0 = mode | ((value >> 8) & 0x0F)
    byte1 = value & 0xFF
  mode 0x00 = normal, 0x10 = powered down through 1k.

LEVELS
  Pi GPIO is 3.3 V, matching the Click. No level shifter.

RANGE
  Emulator coil to sensor antenna: 5 to 15 cm.

DEPENDENCIES: NOTHING TO INSTALL
  This runs on a stock Raspberry Pi OS Lite with no network, which matters
  because the emulator is a bench instrument and is never given WiFi.

  Both third-party imports are already on the image. pi-gen stage2, which is
  what "Lite" is built from, installs python3-smbus2, python3-gpiozero and
  python3-rpi-lgpio as standard, along with gpiod and python3-libgpiod. So there
  is no apt step and no wheel to side-load: an offline Pi can run this as
  shipped.

  rpi-lgpio is the pin backend. It presents itself as RPi.GPIO, so gpiozero
  finds it through its rpigpio pin factory without being told to.

  The one thing the image does NOT do is enable I2C. That is a config.txt
  change, which is why install.sh sets it.

SETUP
  Handled by install.sh, which is offline and idempotent:
    sudo /boot/firmware/emulator/install.sh

  It enables I2C in config.txt, puts emulator1 in the i2c and gpio groups,
  installs the script to /opt/lightning-emulator and enables the service.
  Enabling I2C needs one reboot.

USAGE
  python3 lightning_emulator.py --probe-buttons    FIRST RUN: find the pins
  python3 lightning_emulator.py                    interactive, Click buttons live
  sudo python3 lightning_emulator.py               + SCHED_FIFO
  python3 lightning_emulator.py --pins 22,18,17,4  CLOSE,MID,FAR,LED
  python3 lightning_emulator.py --fire close       one shot
  python3 lightning_emulator.py --pace loop        Arduino timing
  python3 lightning_emulator.py --storm-on-hold    hold FAR to run the storm
  python3 lightning_emulator.py --headless         buttons only, no keyboard

  Headless is what the systemd service uses, and it is assumed automatically
  whenever stdin is not a TTY.
"""
from __future__ import annotations

import argparse
import errno
import os
import sys
import time

# ---------------------------------------------------------------------------
# Vendor constants
# ---------------------------------------------------------------------------

DAC_ADDRESSES = (0x60, 0x61)        # probed in order

DAC_FAST_NORMAL = 0x00              # fast-mode write, normal operation
DAC_FAST_PDOWN_1K = 0x10            # fast-mode write, powered down via 1k

MODE_CLOSE, MODE_MID, MODE_FAR = 0, 1, 2
MODE_NAMES = {MODE_CLOSE: "CLOSE", MODE_MID: "MID", MODE_FAR: "FAR"}

# Vendor example polls CLOSE, then MID, then FAR with else-if, so a simultaneous
# press resolves to the nearest range. Reproduced in _higher_priority_held().
MODE_PRIORITY = (MODE_CLOSE, MODE_MID, MODE_FAR)

# 20 samples, 12-bit, decaying.
THUNDER_PROFILE = (
    1030, 730, 520, 370, 270, 200, 150, 110, 90, 70,
    60, 50, 45, 43, 40, 37, 35, 33, 32, 31,
)

SAMPLE_GAP_S = 22e-6                # inter-sample delay, loop pacing only
BURST_TAIL_S = 0.010                # tail before parking the DAC
MAX_RDWR_MSGS = 42                  # I2C_RDWR_IOCTL_MAX_MSGS
I2C_BUS = 1                         # /dev/i2c-1

# ---------------------------------------------------------------------------
# Pin map, BCM numbering. MikroE Pi click shield (MIKROE-1513), one mikroBUS
# socket. The Click's buttons arrive on AN (CLOSE), PWM (MID) and INT (FAR);
# its thunder LED is driven on RST. See the PIN MAP note in the module
# docstring for the schematic decode.
# ---------------------------------------------------------------------------

CLICK_PINS = {"an": 22, "pwm": 18, "int": 17, "rst": 4}

# Pins another process on the same Pi may already be driving.
PIN_WARNINGS = {
    18: "GPIO18 is also the Quaggasklip detector's strike pulse mirror "
        "(pulse_mirror_pin)",
    4:  "GPIO4 is the 1-Wire default pin, so a w1-gpio overlay would fight the "
        "thunder LED",
}

# Pins a Pi Click shield plausibly routes to AN, PWM, INT or RST, across the
# single-socket MIKROE-1513 and the two-socket Pi 2 shield. Used by
# --probe-buttons so an unexpected shield still turns up rather than reporting
# "not found".
#
# Excluded on purpose:
#   2, 3      I2C, and the DAC is on it
#   8         CS / CE0
#   9, 10, 11 SPI0
#   14, 15    UART
PROBE_CANDIDATES = {
    4:  "MIKROE-1513 RST (LED, an output here - should not move)",
    5:  "Pi 2 shield socket 1 RST",
    6:  "Pi 2 shield socket 1 INT",
    12: "spare GPIO",
    13: "Pi 2 shield socket 2 AN",
    17: "MIKROE-1513 INT (FAR)  /  Pi 2 shield socket 2 PWM",
    18: "MIKROE-1513 PWM (MID)  /  Pi 2 shield socket 1 PWM",
    19: "Pi 2 shield socket 2 RST",
    22: "MIKROE-1513 AN as DIG (CLOSE)",
    23: "spare GPIO",
    24: "spare GPIO",
    25: "spare GPIO",
    26: "Pi 2 shield socket 2 INT",
    27: "spare GPIO",
}

# What --probe-buttons should conclude. Pressed button -> the pin we expect.
EXPECTED_BY_ROLE = (("CLOSE", "an"), ("MID", "pwm"), ("FAR", "int"))

DEBOUNCE_S = 0.04
# Vendor example sleeps 500 ms after a successful burst. That delay gates the
# whole poll loop, so the lockout here is global rather than per mode.
RETRIGGER_LOCKOUT_S = 0.5
STORM_HOLD_S = 1.5                  # --storm-on-hold: hold FAR this long

# Scripted storm: 9 strikes, far to close then receding.
STORM_SCRIPT = (MODE_FAR, MODE_FAR, MODE_MID, MODE_MID, MODE_CLOSE,
                MODE_CLOSE, MODE_CLOSE, MODE_MID, MODE_FAR)
STORM_GAP_S = 3.0

# SCHED_FIFO priority, 1..99.
RT_PRIORITY = 10

# How long to hold the Click's thunder LED lit after a strike.
#
# A whole strike is only 16 to 28 ms depending on mode, so an LED lit for exactly
# that long is a flicker at the edge of perception. On a headless bench rig this
# LED is the ONLY feedback there is, so the flash is stretched to something a
# person can actually see. Applied after the DAC is parked, so it cannot affect
# the emitted waveform, and it is far inside RETRIGGER_LOCKOUT_S so it cannot
# swallow a press either.
LED_MIN_FLASH_S = 0.12

# Triple blink at startup, so "nothing happens when I press a button" can be told
# apart from "the service never started".
LED_READY_BLINKS = 3


def fast_write_bytes(mode: int, value: int) -> bytes:
    """Two bytes of an MCP4725 fast-mode write. Value clamped to 12 bits."""
    value = max(0, min(0x0FFF, int(value)))
    return bytes(((mode | ((value >> 8) & 0x0F)) & 0xFF, value & 0xFF))


# ---------------------------------------------------------------------------
# DAC
# ---------------------------------------------------------------------------

class Dac:
    """MCP4725 on the Click, over /dev/i2c-N."""

    def __init__(self, bus_no: int = I2C_BUS) -> None:
        try:
            from smbus2 import SMBus, i2c_msg
        except ImportError:
            raise SystemExit(
                "smbus2 not installed:  sudo apt install -y python3-smbus2")
        self._i2c_msg = i2c_msg
        try:
            self.bus = SMBus(bus_no)
        except FileNotFoundError:
            raise SystemExit(
                f"/dev/i2c-{bus_no} missing. Enable I2C:  "
                "sudo raspi-config nonint do_i2c 0")
        except PermissionError:
            raise SystemExit(
                f"No permission for /dev/i2c-{bus_no}:  "
                'sudo usermod -aG i2c "$USER"')
        self.addr: int | None = None

    def find(self) -> int | None:
        """Probe each address with a zero-length write. Sets self.addr."""
        for addr in DAC_ADDRESSES:
            try:
                self.bus.write_quick(addr)
                self.addr = addr
                return addr
            except OSError:
                continue
        return None

    def write(self, mode: int, value: int) -> None:
        """One fast-mode write."""
        payload = fast_write_bytes(mode, value)
        self.bus.i2c_rdwr(self._i2c_msg.write(self.addr, payload))

    def write_burst_batched(self, values) -> None:
        """One burst per ioctl. Messages are issued back-to-back by the kernel."""
        msgs = [self._i2c_msg.write(self.addr, fast_write_bytes(DAC_FAST_NORMAL, v))
                for v in values]
        for i in range(0, len(msgs), MAX_RDWR_MSGS):
            self.bus.i2c_rdwr(*msgs[i:i + MAX_RDWR_MSGS])

    def write_burst_paced(self, values) -> None:
        """One write per sample, then a 22 us busy-wait.

        Busy-wait rather than sleep: time.sleep() cannot resolve 22 us.
        """
        for v in values:
            self.write(DAC_FAST_NORMAL, v)
            end = time.perf_counter() + SAMPLE_GAP_S
            while time.perf_counter() < end:
                pass

    def park(self) -> None:
        """Power the output down so the coil is not driven while idle."""
        try:
            self.write(DAC_FAST_PDOWN_1K, 0)
        except OSError:
            pass

    def close(self) -> None:
        try:
            self.park()
        finally:
            try:
                self.bus.close()
            except Exception:               # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------

class Realtime:
    """Context manager: SCHED_FIFO while active, previous policy on exit.

    Falls back to normal scheduling if the process lacks the privilege. The
    warning is printed once.
    """

    def __init__(self) -> None:
        self.available = hasattr(os, "sched_setscheduler")
        self.warned = False

    def __enter__(self):
        self._restore = None
        if not self.available:
            return self
        try:
            prev = os.sched_getscheduler(0)
            prev_param = os.sched_getparam(0)
            os.sched_setscheduler(0, os.SCHED_FIFO, os.sched_param(RT_PRIORITY))
            self._restore = (prev, prev_param)
        except (PermissionError, OSError) as exc:
            if not self.warned:
                self.warned = True
                if getattr(exc, "errno", None) in (errno.EPERM, errno.EACCES):
                    print("[emu] SCHED_FIFO not permitted, using normal scheduling")
                else:
                    print(f"[emu] SCHED_FIFO unavailable ({exc})")
        return self

    def __exit__(self, *_exc):
        if self._restore is not None:
            try:
                os.sched_setscheduler(0, self._restore[0], self._restore[1])
            except OSError:
                pass
        return False


# ---------------------------------------------------------------------------
# Emulator
# ---------------------------------------------------------------------------

class Emulator:
    def __init__(self, dac: Dac, led=None, paced: bool = False) -> None:
        self.dac = dac
        self.led = led
        self.paced = paced
        self.rt = Realtime()

    def generate(self, mode: int) -> bool:
        """Emit one strike: (3 - mode) bursts, 10 ms tail, park the DAC."""
        if mode not in MODE_NAMES:
            return False
        bursts = 3 - mode
        if self.led is not None:
            self.led.on()
        try:
            with self.rt:
                for _ in range(bursts):
                    if self.paced:
                        self.dac.write_burst_paced(THUNDER_PROFILE)
                    else:
                        self.dac.write_burst_batched(THUNDER_PROFILE)
            time.sleep(BURST_TAIL_S)
            self.dac.write(DAC_FAST_PDOWN_1K, 0)
            return True
        except OSError as exc:
            # No ACK: nothing was emitted.
            print(f"[emu] ** I2C write failed ({exc}) - nothing emitted **")
            # Park on the way out. A write can fail part way through a burst, and
            # without this the DAC would be left holding whatever sample it got
            # to, driving the coil until the next strike. park() swallows its own
            # OSError, so a dead bus cannot turn this into a second exception.
            self.dac.park()
            return False
        finally:
            if self.led is not None:
                # Stretch the flash to something visible. See LED_MIN_FLASH_S.
                # Safe here: by this point the DAC is parked on both the success
                # and the failure path, so the delay cannot reach the waveform.
                time.sleep(LED_MIN_FLASH_S)
                self.led.off()

    def fire(self, mode: int, why: str) -> None:
        """Emit one strike and log it."""
        ok = self.generate(mode)
        bursts = 3 - mode
        print(f"[emu] {why} -> {MODE_NAMES[mode]} "
              f"({bursts} burst{'' if bursts == 1 else 's'})"
              f"{'' if ok else '  ** FAILED **'}")

    def storm(self, stop_requested=lambda: False) -> None:
        """Run STORM_SCRIPT with STORM_GAP_S between strikes."""
        print(f"[emu] storm sequence: approaching, then receding "
              f"({len(STORM_SCRIPT)} strikes)")
        print("[emu] press any Click button, or Ctrl-C, to stop")
        for i, mode in enumerate(STORM_SCRIPT):
            self.fire(mode, f"storm step {i + 1}/{len(STORM_SCRIPT)}")
            if i + 1 >= len(STORM_SCRIPT):
                break
            end = time.monotonic() + STORM_GAP_S
            while time.monotonic() < end:
                if stop_requested():
                    print("[emu] storm sequence stopped")
                    return
                time.sleep(0.05)
        print("[emu] storm sequence complete")


# ---------------------------------------------------------------------------
# Click buttons
# ---------------------------------------------------------------------------

class ClickButtons:
    """The Thunder EMU Click's own CLOSE, MID and FAR buttons.

    Active low with the Pi's internal pull-up. gpiozero debounces via
    bounce_time; a global lockout matching the vendor's 500 ms post-burst delay
    drops anything closer than that. While a storm is running, any press stops
    it instead of firing.
    """

    def __init__(self, emu: Emulator, pins: dict, storm_on_hold: bool = False):
        self.emu = emu
        self.pins = pins
        self.storm_on_hold = storm_on_hold
        self.buttons: dict[int, object] = {}
        self.led = None
        self._last_fire = 0.0
        self._storm = {"running": False, "stop": False}
        self._held = False

    # -- wiring ------------------------------------------------------------

    def claim(self) -> bool:
        """Claim the LED and the three button pins. False if gpiozero is absent."""
        try:
            from gpiozero import Button, DigitalOutputDevice
        except ImportError:
            print("[emu] gpiozero not installed, Click buttons disabled")
            print("      sudo apt install -y python3-gpiozero python3-lgpio")
            return False

        rst = self.pins["rst"]
        try:
            self.led = DigitalOutputDevice(rst, initial_value=False)
        except Exception as exc:            # noqa: BLE001
            print(f"[emu] GPIO{rst} unavailable for the Click thunder LED ({exc})")
            self.led = None
        self.emu.led = self.led

        wanted = ((MODE_CLOSE, self.pins["an"]),
                  (MODE_MID, self.pins["pwm"]),
                  (MODE_FAR, self.pins["int"]))

        for mode, pin in wanted:
            try:
                b = Button(pin, pull_up=True, bounce_time=DEBOUNCE_S)
            except Exception as exc:        # noqa: BLE001
                print(f"[emu] GPIO{pin} unavailable for the "
                      f"{MODE_NAMES[mode]} button ({exc})")
                print("      Another process may hold it. On the detector Pi, "
                      "see the sharing note at the top of this file.")
                continue
            if mode == MODE_FAR and self.storm_on_hold:
                # Long press starts the storm, so FAR fires on release instead
                # of on press. Otherwise a hold would fire FAR and then a storm.
                b.hold_time = STORM_HOLD_S
                b.hold_repeat = False
                b.when_held = self._on_hold_far
                b.when_released = self._on_release_far
            else:
                b.when_pressed = self._make_handler(mode)
            self.buttons[mode] = b

        return bool(self.buttons)

    # -- behaviour ---------------------------------------------------------

    def _higher_priority_held(self, mode: int) -> bool:
        """True if a nearer-range button is also down, per the vendor else-if."""
        for other in MODE_PRIORITY:
            if other == mode:
                return False
            b = self.buttons.get(other)
            if b is not None and b.is_pressed:
                return True
        return False

    def _accept(self, mode: int) -> bool:
        """Apply the storm-stop, priority and lockout rules."""
        if self._storm["running"]:
            self._storm["stop"] = True
            return False
        if self._higher_priority_held(mode):
            return False
        now = time.monotonic()
        if now - self._last_fire < RETRIGGER_LOCKOUT_S:
            return False
        self._last_fire = now
        return True

    def _make_handler(self, mode: int):
        def handler():
            if self._accept(mode):
                self.emu.fire(mode, f"Click {MODE_NAMES[mode]} button")
        return handler

    def _on_hold_far(self):
        self._held = True
        if self._storm["running"]:
            self._storm["stop"] = True
            return
        self.run_storm("held FAR")

    def _on_release_far(self):
        if self._held:
            self._held = False          # the hold already did something
            return
        if self._accept(MODE_FAR):
            self.emu.fire(MODE_FAR, "Click FAR button")

    def run_storm(self, why: str) -> None:
        if self._storm["running"]:
            self._storm["stop"] = True
            return
        self._storm["running"] = True
        self._storm["stop"] = False
        print(f"[emu] storm triggered by {why}")
        try:
            self.emu.storm(stop_requested=lambda: self._storm["stop"])
        finally:
            self._storm["running"] = False
            self._storm["stop"] = False
            self._last_fire = time.monotonic()

    # -- operator feedback -------------------------------------------------

    def ready_signal(self) -> None:
        """Blink the thunder LED so an operator with no console knows we armed.

        This earns its keep on a headless rig. The LED is the only feedback the
        board gives, so without a startup signal "nothing happens when I press a
        button" is ambiguous between three quite different faults: the service
        never started, the service is running but the pin map is wrong, or the
        Click is not seated. A triple blink at start rules out the first, which is
        the one you cannot otherwise see without a console.

        Failure here is not worth aborting for: it is a diagnostic aid, not part
        of emitting a strike.
        """
        if self.led is None:
            return
        try:
            for _ in range(LED_READY_BLINKS):
                self.led.on()
                time.sleep(LED_MIN_FLASH_S)
                self.led.off()
                time.sleep(LED_MIN_FLASH_S)
        except Exception as exc:                # noqa: BLE001
            print(f"[emu] could not blink the ready signal ({exc})")

    # -- teardown ----------------------------------------------------------

    def describe(self) -> str:
        if not self.buttons:
            return ""
        parts = [f"{MODE_NAMES[m]} GPIO{self.buttons[m].pin.number}"
                 for m in MODE_PRIORITY if m in self.buttons]
        return "Click buttons: " + "   ".join(parts)

    def close(self) -> None:
        for b in self.buttons.values():
            try:
                b.close()
            except Exception:               # noqa: BLE001
                pass
        if self.led is not None:
            try:
                self.led.off()
                self.led.close()
            except Exception:               # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# Button pin finder
# ---------------------------------------------------------------------------

def probe_buttons(seconds: float = 30.0) -> int:
    """Name the pin behind each Click button, empirically.

    Claims every pin a Pi Click shield plausibly routes to a mikroBUS AN, PWM,
    INT or RST, holds them high with the internal pull-up, and reports each one
    that goes low. Press the buttons one at a time, in order, and it prints a
    ready-to-paste --pins line.
    """
    try:
        from gpiozero import Button
    except ImportError:
        print("gpiozero not installed:  sudo apt install -y python3-gpiozero "
              "python3-lgpio")
        return 1

    print("Thunder EMU Click button finder")
    print("  Press CLOSE, then MID, then FAR, one at a time, in that order.")
    print("  Each press should name exactly one pin.")
    print(f"  Listening for {seconds:.0f}s. Ctrl-C to stop early.\n")

    claimed = {}
    for pin, label in sorted(PROBE_CANDIDATES.items()):
        try:
            claimed[pin] = Button(pin, pull_up=True, bounce_time=DEBOUNCE_S)
        except Exception as exc:            # noqa: BLE001
            print(f"  GPIO{pin:<2} skipped, unavailable ({exc}) - {label}")

    if not claimed:
        print("No candidate pin could be claimed. Is another service holding "
              "them? Stop the detector first:")
        print("  sudo systemctl stop lightning-detector")
        return 1

    resting_low = [p for p, b in claimed.items() if b.is_pressed]
    if resting_low:
        print("  Note: GPIO" + ", GPIO".join(str(p) for p in sorted(resting_low))
              + " already reads low with nothing pressed.")
        print("  That pin is driven by something else, or the Click is not "
              "seated. Presses on it cannot be told apart from its resting "
              "state.\n")

    seen: dict[int, int] = {}
    order: list[int] = []               # first-press order, so we can name roles
    state = {p: b.is_pressed for p, b in claimed.items()}
    end = time.monotonic() + seconds
    try:
        while time.monotonic() < end:
            for pin, b in claimed.items():
                now_pressed = b.is_pressed
                if now_pressed and not state[pin]:
                    if pin not in seen:
                        order.append(pin)
                    seen[pin] = seen.get(pin, 0) + 1
                    print(f"  GPIO{pin:<2} went LOW  <- {PROBE_CANDIDATES[pin]}")
                state[pin] = now_pressed
            time.sleep(0.01)
    except KeyboardInterrupt:
        print()
    finally:
        for b in claimed.values():
            try:
                b.close()
            except Exception:               # noqa: BLE001
                pass

    print("\nResult")
    if not seen:
        print("  Nothing moved. Things to check, in order:")
        print("   1. The Thunder EMU Click is fully seated in a mikroBUS socket.")
        print("   2. The shield is powered - the Click needs 3.3V from the socket.")
        print("   3. You are pressing the Click's own buttons, not the sensor "
              "board's.")
        print("   4. No other service holds these pins "
              "(sudo systemctl stop lightning-detector).")
        return 1

    for i, pin in enumerate(order):
        print(f"  {i + 1}. GPIO{pin:<2} {seen[pin]} press(es)  "
              f"{PROBE_CANDIDATES[pin]}")

    default = [CLICK_PINS["an"], CLICK_PINS["pwm"], CLICK_PINS["int"]]
    if len(order) == 3:
        if order == default:
            print("\n  This is the built-in MIKROE-1513 map "
                  f"(CLOSE {order[0]}, MID {order[1]}, FAR {order[2]}). "
                  "No --pins needed.")
        else:
            print(f"\n  Taking the press order as CLOSE, MID, FAR:")
            print(f"    CLOSE GPIO{order[0]}   MID GPIO{order[1]}   "
                  f"FAR GPIO{order[2]}")
            print("  Run with:")
            print(f"    --pins {order[0]},{order[1]},{order[2]},"
                  f"{CLICK_PINS['rst']}")
            print(f"  The last number is RST, the thunder LED. It is an output, "
                  f"so pressing cannot find it;")
            print(f"  GPIO{CLICK_PINS['rst']} is the MIKROE-1513 value. Change "
                  "it if your shield differs.")
    else:
        print(f"\n  Saw {len(order)} distinct pin(s), expected 3. Press each "
              "button once, in the order")
        print("  CLOSE, MID, FAR, and give it a moment between presses.")
        if len(order) > 3:
            print("  More than three suggests contact bounce on one button or a "
                  "pin floating.")
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description="AS3935 lightning emulator, Raspberry Pi Zero 2 W + "
                    "Thunder EMU Click. Fired from the Click's own buttons.")
    ap.add_argument("--pins", metavar="CLOSE,MID,FAR,LED",
                    help="override the BCM pin map, four comma-separated "
                         "numbers. Default for the MIKROE-1513 shield is "
                         f"{CLICK_PINS['an']},{CLICK_PINS['pwm']},"
                         f"{CLICK_PINS['int']},{CLICK_PINS['rst']}. "
                         "Use --probe-buttons to find yours.")
    ap.add_argument("--pace", choices=("batched", "loop"), default="batched",
                    help="batched: one ioctl per burst. "
                         "loop: one write per sample plus a 22 us gap.")
    ap.add_argument("--fire", choices=("close", "mid", "far", "storm"),
                    help="fire once and exit")
    ap.add_argument("--bus", type=int, default=I2C_BUS, help="I2C bus number")
    ap.add_argument("--no-buttons", action="store_true",
                    help="keyboard only, claim no GPIO")
    ap.add_argument("--headless", action="store_true",
                    help="never read the keyboard, just service the Click "
                         "buttons until terminated. Implied when stdin is not "
                         "a TTY, which is how it runs under systemd.")
    ap.add_argument("--storm-on-hold", action="store_true",
                    help=f"hold FAR for {STORM_HOLD_S:g}s to run the storm "
                         "sequence. FAR then fires on release.")
    ap.add_argument("--probe-buttons", action="store_true",
                    help="report which GPIO each Click button is on, then exit")
    ap.add_argument("--probe-seconds", type=float, default=30.0,
                    help="how long --probe-buttons listens (default 30)")
    args = ap.parse_args()

    if args.probe_buttons:
        return probe_buttons(args.probe_seconds)

    pins = dict(CLICK_PINS)
    if args.pins:
        parts = [p.strip() for p in args.pins.split(",")]
        if len(parts) != 4:
            ap.error("--pins needs exactly four numbers: CLOSE,MID,FAR,LED")
        try:
            nums = [int(p) for p in parts]
        except ValueError:
            ap.error(f"--pins must be four BCM numbers, got {args.pins!r}")
        if len(set(nums)) != 4:
            ap.error(f"--pins has a repeated pin: {args.pins!r}")
        for n in nums:
            if not 0 <= n <= 27:
                ap.error(f"--pins: GPIO{n} is not a BCM pin on this header")
        pins = dict(zip(("an", "pwm", "int", "rst"), nums))

    print("=== AS3935 lightning emulator ===")
    print("Raspberry Pi Zero 2 W + Thunder EMU Click")
    print("Pi click shield (MIKROE-1513), one mikroBUS socket"
          f"{'' if not args.pins else '  [pins overridden]'}")
    print(f"  CLOSE GPIO{pins['an']}   MID GPIO{pins['pwm']}   "
          f"FAR GPIO{pins['int']}   LED GPIO{pins['rst']}")

    for role, pin in pins.items():
        why = PIN_WARNINGS.get(pin)
        if why:
            print(f"[emu] note: {why}.")

    dac = Dac(args.bus)
    addr = dac.find()
    if addr is None:
        print("DAC NOT RESPONDING at 0x60 or 0x61.")
        print("  The Click is not talking. Check it is seated in the socket, "
              "that the shield has power,")
        print("  and that I2C is on:  ls /dev/i2c-*   and   i2cdetect -y 1")
        return 1
    print(f"DAC found at 0x{addr:02X} on /dev/i2c-{args.bus}")
    print(f"Pacing: {args.pace}")
    dac.park()

    emu = Emulator(dac, led=None, paced=(args.pace == "loop"))

    if args.fire:
        try:
            if args.fire == "storm":
                emu.storm()
            else:
                emu.fire({"close": MODE_CLOSE, "mid": MODE_MID,
                          "far": MODE_FAR}[args.fire], "command line")
        finally:
            dac.close()
        return 0

    clicks = None
    if not args.no_buttons:
        clicks = ClickButtons(emu, pins, storm_on_hold=args.storm_on_hold)
        if not clicks.claim():
            clicks = None

    print()
    if clicks is not None:
        print(clicks.describe())
        if args.storm_on_hold:
            print(f"Hold FAR for {STORM_HOLD_S:g}s to run the storm sequence.")
        else:
            print("The Click has three buttons, so the storm sequence runs "
                  "from the keyboard.")
    else:
        print("No Click buttons claimed, keyboard only.")
    # Under systemd there is no controlling terminal, so input() raises EOFError
    # on the first call and the old loop treated that as "quit". The service
    # would start, park the DAC and exit within milliseconds, looking for all the
    # world like a clean run. Detect the condition up front instead: with no TTY
    # the only sensible mode is to sit on the button callbacks.
    headless = args.headless or not sys.stdin.isatty()

    if headless:
        if clicks is None:
            print("Headless with no Click buttons claimed: nothing could fire "
                  "a strike, so there is no reason to keep running.")
            print("  Check the pin map with --probe-buttons, or pass --fire to "
                  "send a single burst.")
            dac.close()
            return 1
        print("Headless: the Click buttons are live, the keyboard is not read.")
        print("Coil to sensor antenna: 5 to 15 cm.")
        print("SMS alerts must be OFF on the panel before testing.")
        # Three blinks on the Click's thunder LED. On a headless rig this is the
        # only sign the operator gets that the service armed, so it matters more
        # here than the log line next to it.
        clicks.ready_signal()
        print(f"[emu] ready, thunder LED blinked {LED_READY_BLINKS}x", flush=True)
        try:
            while True:
                # gpiozero services the buttons on its own threads, so this one
                # only has to stay alive and stay out of the way.
                time.sleep(3600)
        except KeyboardInterrupt:
            print()
        finally:
            dac.close()
            clicks.close()
            print("[emu] stopped, DAC parked")
        return 0

    print("Keyboard: c m f s, q to quit")
    print("Coil to sensor antenna: 5 to 15 cm.")
    print("SMS alerts must be OFF on the panel before testing.")
    # Also blinked interactively, which doubles as a check that the LED pin is
    # right before anyone relies on it headless.
    if clicks is not None:
        clicks.ready_signal()
    print()

    try:
        while True:
            try:
                line = input("> ").strip().lower()
            except EOFError:
                break
            if not line:
                continue
            key = line[0]
            if key == "q":
                break
            if key == "c":
                emu.fire(MODE_CLOSE, "keyboard")
            elif key == "m":
                emu.fire(MODE_MID, "keyboard")
            elif key == "f":
                emu.fire(MODE_FAR, "keyboard")
            elif key == "s":
                if clicks is not None:
                    clicks.run_storm("keyboard")
                else:
                    emu.storm()
            else:
                print("  c m f s, q to quit")
    except KeyboardInterrupt:
        print()
    finally:
        # Park the DAC and release the pins.
        dac.close()
        if clicks is not None:
            clicks.close()
        print("[emu] stopped, DAC parked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
