#!/usr/bin/env python3
"""Lightning emulator: Raspberry Pi Zero 2 W + MikroElektronika Thunder EMU Click.

Functional twin of the Arduino sketch in ../arduino/lightning_emulator. Fires
synthetic strikes at the AS3935 so the whole chain can be exercised: sensor
interrupt, distance and energy, heartbeat, alert evaluation, the panel's storm
display and the beacon lamps.

Triggered from push buttons wired to the Pi. The Click's own CLOSE/MID/FAR pins
are inputs the host is expected to poll, and the waveform comes entirely from the
host writing a timed profile to the on-board MCP4725, so those pins are left
unwired and the Click cannot fire without us.


WHY THIS IS NOT A LINE-FOR-LINE PORT OF THE SKETCH
--------------------------------------------------
On the Nano, "write a sample, wait 22 us" is exact. On Linux it is not, and the
difference matters enough to change the approach.

The reference profile is 20 samples with a ~22 us gap. At 100 kHz a 2-byte write
occupies about 280 us of bus time, so each sample is roughly 300 us and a burst
is about 6 ms. Reproducing that with a Python loop would add per-call syscall
overhead of the same order as the gap itself, and worse, the scheduler can
preempt between samples and insert a gap measured in milliseconds. A burst
stretched like that no longer looks like lightning to the AS3935's rejection
algorithm, and the failure is intermittent, which is the worst kind.

So the default mode hands the whole burst to the kernel in ONE i2c_rdwr ioctl:
20 messages issued back-to-back by the I2C driver with no return to userspace
between them. That removes both Python overhead and preemption. The cost is
losing the 22 us gap, which is about 7% of the sample period - far less error
than a single scheduler hiccup would introduce.

`--pace loop` is available to reproduce the sketch's timing literally, for
comparison. If the sensor recognises one mode and not the other, that is worth
knowing, and it is exactly the sort of thing this rig exists to find out.

The Linux i2c-dev interface caps a single ioctl at 42 messages
(I2C_RDWR_IOCTL_MAX_MSGS), so bursts are sent one ioctl each rather than all
three in one call.


THE PI IS THE EASIER HOST ELECTRICALLY
--------------------------------------
Its GPIO is 3.3 V, which is what MIKROE Click boards are designed for. Power the
Click from the Pi's 3V3 pin and wire I2C straight through: no level shifter, and
none of the 5 V risk that the Nano brings to a 3.3 V-only board.


WIRING (BCM numbering; physical pin in brackets)
------------------------------------------------
    GPIO2  [3]   -> SDA        I2C data
    GPIO3  [5]   -> SCL        I2C clock
    3V3    [1]   -> 3.3V       Click power
    GND    [6]   -> GND        common ground
    GPIO17 [11]  -> RST        the Click's thunder LED (optional)

    GPIO5  [29]  -> button to GND: CLOSE
    GPIO6  [31]  -> button to GND: MID
    GPIO13 [33]  -> button to GND: FAR
    GPIO19 [35]  -> button to GND: STORM sequence

    AN / PWM / INT: intentionally NOT connected.

No pull-up resistors: gpiozero enables the internal ones. Do not add I2C
pull-ups either, the Click has them.

Keep the coils 5 to 15 cm apart. The vendor calibrated the profile for that
window, and outside it the sensor registers nothing.


SETUP
-----
    sudo raspi-config nonint do_i2c 0        # or dtparam=i2c_arm=on
    sudo apt install -y python3-smbus2 python3-gpiozero python3-lgpio
    sudo usermod -aG i2c,gpio "$USER"        # then log out and back in
    python3 lightning_emulator.py

Running as root (or with CAP_SYS_NICE) lets it take SCHED_FIFO for the duration
of a burst, which further reduces the chance of a preemption mid-waveform. It
degrades gracefully to normal scheduling with a warning if that is refused.
"""
from __future__ import annotations

import argparse
import errno
import os
import sys
import time

# ---------------------------------------------------------------------------
# Vendor constants. Identical to the sketch and to the mikroSDK driver.
# ---------------------------------------------------------------------------

DAC_ADDRESSES = (0x60, 0x61)        # MCP4725 default, then the strapped alternate

DAC_FAST_NORMAL = 0x00              # fast-mode write, normal operation
DAC_FAST_PDOWN_1K = 0x10            # fast-mode write, powered down via 1k

MODE_CLOSE, MODE_MID, MODE_FAR = 0, 1, 2
MODE_NAMES = {MODE_CLOSE: "CLOSE", MODE_MID: "MID", MODE_FAR: "FAR"}

# Decaying envelope, 20 samples of 12-bit data, calibrated by the vendor for
# 5-15 cm between inductors.
THUNDER_PROFILE = (
    1030, 730, 520, 370, 270, 200, 150, 110, 90, 70,
    60, 50, 45, 43, 40, 37, 35, 33, 32, 31,
)

SAMPLE_GAP_S = 22e-6                # the sketch's inter-sample delay
BURST_TAIL_S = 0.010                # 10 ms before parking the DAC
MAX_RDWR_MSGS = 42                  # I2C_RDWR_IOCTL_MAX_MSGS in the kernel

I2C_BUS = 1                         # /dev/i2c-1 on every modern Pi

# GPIO, BCM numbering.
PIN_LED = 17
PIN_BTN = {MODE_CLOSE: 5, MODE_MID: 6, MODE_FAR: 13}
PIN_BTN_STORM = 19

RETRIGGER_LOCKOUT_S = 0.4
STORM_SCRIPT = (MODE_FAR, MODE_FAR, MODE_MID, MODE_MID, MODE_CLOSE,
                MODE_CLOSE, MODE_CLOSE, MODE_MID, MODE_FAR)
STORM_GAP_S = 3.0


def fast_write_bytes(mode: int, value: int) -> bytes:
    """The two bytes of an MCP4725 fast-mode write.

    Byte 0 carries the mode in its upper nibble and the top 4 data bits in its
    lower nibble; byte 1 is the low 8 bits. Clamped to 12 bits so a bad value
    saturates rather than wrapping into a different voltage.
    """
    value = max(0, min(0x0FFF, int(value)))
    return bytes(((mode | ((value >> 8) & 0x0F)) & 0xFF, value & 0xFF))


# ---------------------------------------------------------------------------
# DAC
# ---------------------------------------------------------------------------

class Dac:
    """The MCP4725 on the Click, over /dev/i2c-1."""

    def __init__(self, bus_no: int = I2C_BUS) -> None:
        try:
            from smbus2 import SMBus, i2c_msg
        except ImportError:
            raise SystemExit(
                "smbus2 is not installed.\n"
                "  sudo apt install -y python3-smbus2\n"
                "  (or: pip3 install smbus2)")
        self._i2c_msg = i2c_msg
        try:
            self.bus = SMBus(bus_no)
        except FileNotFoundError:
            raise SystemExit(
                f"/dev/i2c-{bus_no} does not exist. Enable I2C:\n"
                "  sudo raspi-config nonint do_i2c 0   (then reboot)")
        except PermissionError:
            raise SystemExit(
                f"No permission for /dev/i2c-{bus_no}.\n"
                "  sudo usermod -aG i2c \"$USER\"   (then log out and back in)")
        self.addr: int | None = None

    def find(self) -> int | None:
        """Locate the DAC at either address.

        A zero-length write is the standard presence probe: the device either
        ACKs its address or it does not. Probing only 0x60 would report a
        correctly wired but differently strapped board as absent.
        """
        for addr in DAC_ADDRESSES:
            try:
                self.bus.write_quick(addr)
                self.addr = addr
                return addr
            except OSError:
                continue
        return None

    def write(self, mode: int, value: int) -> None:
        payload = fast_write_bytes(mode, value)
        self.bus.i2c_rdwr(self._i2c_msg.write(self.addr, payload))

    def write_burst_batched(self, values) -> None:
        """Issue a whole burst in one ioctl.

        The kernel emits the messages consecutively without returning to
        userspace, so neither Python nor the scheduler can stretch the waveform
        mid-burst. This is the default for the reason in the module docstring.
        """
        msgs = [self._i2c_msg.write(self.addr, fast_write_bytes(DAC_FAST_NORMAL, v))
                for v in values]
        for i in range(0, len(msgs), MAX_RDWR_MSGS):
            self.bus.i2c_rdwr(*msgs[i:i + MAX_RDWR_MSGS])

    def write_burst_paced(self, values) -> None:
        """Reproduce the sketch's timing literally: one write, then a gap.

        Kept for comparison. Subject to Python overhead and preemption, which is
        precisely what the batched path avoids.
        """
        for v in values:
            self.write(DAC_FAST_NORMAL, v)
            # busy-wait: time.sleep() cannot resolve 22 us, and asking the
            # scheduler to wake us that soon invites a context switch.
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
            except Exception:               # noqa: BLE001 - shutdown must not raise
                pass


# ---------------------------------------------------------------------------
# Real-time scheduling
# ---------------------------------------------------------------------------

class Realtime:
    """Hold SCHED_FIFO for the duration of a burst, if permitted.

    A burst is about 6 to 18 ms. Normal scheduling usually gets through it
    untouched, but "usually" produces intermittent non-detections that look like
    a hardware fault. Raising priority for those few milliseconds removes that
    variable. Requires root or CAP_SYS_NICE; refusal is a warning, not an error,
    because the batched I2C path already does most of the work.
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
            # Priority 10 of 1..99: enough to beat normal tasks, low enough to
            # stay out of the way of kernel threads.
            os.sched_setscheduler(0, os.SCHED_FIFO, os.sched_param(10))
            self._restore = (prev, prev_param)
        except (PermissionError, OSError) as exc:
            if not self.warned:
                self.warned = True
                if getattr(exc, "errno", None) in (errno.EPERM, errno.EACCES):
                    print("[emu] note: not permitted to take SCHED_FIFO, using "
                          "normal scheduling. Run with sudo for tighter timing.")
                else:
                    print(f"[emu] note: SCHED_FIFO unavailable ({exc}).")
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
        """Emit one strike. 3 - mode bursts, then a 10 ms tail, then park.

        Same shape as the vendor's thunderemu_generate_thunder().
        """
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
            # No ACK means nothing was emitted at all: a wiring, power or address
            # fault, not a waveform the sensor chose to reject.
            print(f"[emu] ** I2C write failed ({exc}) - nothing was emitted **")
            return False
        finally:
            if self.led is not None:
                self.led.off()

    def fire(self, mode: int, why: str) -> None:
        ok = self.generate(mode)
        bursts = 3 - mode
        print(f"[emu] {why} -> {MODE_NAMES[mode]} "
              f"({bursts} burst{'' if bursts == 1 else 's'})"
              f"{'' if ok else '  ** FAILED **'}")

    def storm(self, stop_requested=lambda: False) -> None:
        print(f"[emu] storm sequence: approaching, then receding "
              f"({len(STORM_SCRIPT)} strikes)")
        print("[emu] press STORM again, or Ctrl-C, to stop early")
        for i, mode in enumerate(STORM_SCRIPT):
            self.fire(mode, f"storm step {i + 1}/{len(STORM_SCRIPT)}")
            if i + 1 >= len(STORM_SCRIPT):
                break
            # Seconds, not milliseconds: the AS3935 needs time between events and
            # the panel's alert cooldown is meant to be observed, not bypassed.
            end = time.monotonic() + STORM_GAP_S
            while time.monotonic() < end:
                if stop_requested():
                    print("[emu] storm sequence stopped")
                    return
                time.sleep(0.05)
        print("[emu] storm sequence complete")


# ---------------------------------------------------------------------------
# Buttons
# ---------------------------------------------------------------------------

def build_buttons(emu: Emulator):
    """Wire the push buttons, or return None to fall back to the keyboard.

    gpiozero debounces in the library, so there is no hand-rolled state machine
    here as there is on the Nano. `hold_time` is not used: a plain press is the
    trigger, and the per-mode lockout below stops one press queueing several
    strikes.
    """
    try:
        from gpiozero import Button, DigitalOutputDevice
    except ImportError:
        print("[emu] gpiozero not installed, buttons disabled "
              "(sudo apt install -y python3-gpiozero python3-lgpio)")
        return None, None

    try:
        led = DigitalOutputDevice(PIN_LED, initial_value=False)
    except Exception as exc:                # noqa: BLE001
        print(f"[emu] note: could not claim GPIO{PIN_LED} for the Click LED ({exc})")
        led = None

    last_fire = {}
    storm_pressed = {"flag": False}

    def guard(mode):
        def handler():
            now = time.monotonic()
            if now - last_fire.get(mode, 0.0) < RETRIGGER_LOCKOUT_S:
                return
            last_fire[mode] = now
            emu.fire(mode, f"button {MODE_NAMES[mode]}")
        return handler

    buttons = []
    try:
        for mode, pin in PIN_BTN.items():
            b = Button(pin, pull_up=True, bounce_time=0.04)
            b.when_pressed = guard(mode)
            buttons.append(b)

        storm_btn = Button(PIN_BTN_STORM, pull_up=True, bounce_time=0.04)

        def on_storm():
            if storm_pressed["flag"]:
                # Second press during a sequence is the stop request.
                storm_pressed["stop"] = True
                return
            storm_pressed["flag"] = True
            storm_pressed["stop"] = False
            try:
                emu.storm(stop_requested=lambda: storm_pressed.get("stop", False))
            finally:
                storm_pressed["flag"] = False
                storm_pressed["stop"] = False

        storm_btn.when_pressed = on_storm
        buttons.append(storm_btn)
    except Exception as exc:                # noqa: BLE001
        print(f"[emu] could not claim the button GPIOs ({exc}). "
              "Check the gpio group and that no other process holds them.")
        return None, led

    return buttons, led


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description="AS3935 lightning emulator for Raspberry Pi + Thunder EMU Click")
    ap.add_argument("--pace", choices=("batched", "loop"), default="batched",
                    help="batched (default): one ioctl per burst, immune to "
                         "scheduler jitter. loop: reproduce the Arduino timing "
                         "literally, including the 22 us gap.")
    ap.add_argument("--fire", choices=("close", "mid", "far", "storm"),
                    help="fire once and exit, for scripting")
    ap.add_argument("--bus", type=int, default=I2C_BUS, help="I2C bus number")
    ap.add_argument("--no-buttons", action="store_true",
                    help="keyboard only, do not claim any GPIO")
    args = ap.parse_args()

    print("=== AS3935 lightning emulator ===")
    print("Raspberry Pi + Thunder EMU Click")

    dac = Dac(args.bus)
    addr = dac.find()
    if addr is None:
        print("DAC NOT RESPONDING at 0x60 or 0x61.")
        print("  Check: SDA on GPIO2 [3], SCL on GPIO3 [5], 3V3, a common GND.")
        print("  Confirm I2C is enabled:  ls /dev/i2c-*")
        print("  And that something is on the bus:  i2cdetect -y 1")
        return 1
    print(f"DAC found at 0x{addr:02X} on /dev/i2c-{args.bus}")
    print(f"Pacing: {args.pace}")
    dac.park()

    emu = Emulator(dac, led=None, paced=(args.pace == "loop"))

    # One-shot mode for scripts and smoke tests.
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

    buttons = None
    if not args.no_buttons:
        buttons, led = build_buttons(emu)
        emu.led = led

    print()
    if buttons:
        print(f"Buttons (to GND): GPIO{PIN_BTN[MODE_CLOSE]} CLOSE   "
              f"GPIO{PIN_BTN[MODE_MID]} MID   "
              f"GPIO{PIN_BTN[MODE_FAR]} FAR   "
              f"GPIO{PIN_BTN_STORM} STORM")
    print("Keyboard: c = close, m = mid, f = far, s = storm, q = quit")
    print("Keep the coils 5 to 15 cm from the detector antenna.")
    print("Confirm SMS alerts are OFF on the panel before testing.")
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
                emu.storm()
            else:
                print("  c = close, m = mid, f = far, s = storm, q = quit")
    except KeyboardInterrupt:
        print()
    finally:
        # Always park the DAC and release the pins: leaving the coil driven, or
        # the LED lit, misrepresents the rig's state.
        dac.close()
        if buttons:
            for b in buttons:
                try:
                    b.close()
                except Exception:           # noqa: BLE001
                    pass
        if emu.led is not None:
            try:
                emu.led.off()
                emu.led.close()
            except Exception:               # noqa: BLE001
                pass
        print("[emu] stopped, DAC parked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
