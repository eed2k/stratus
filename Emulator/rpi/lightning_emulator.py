   #!/usr/bin/env python3
"""AS3935 lightning emulator - Raspberry Pi Zero 2 W + Thunder EMU Click.

PROCESS
  1. Host writes a 20-sample decaying profile to the Click's MCP4725 DAC.
  2. DAC output drives an inductor, emitting an RF burst.
  3. Burst repeats (3 - mode) times: CLOSE 3, MID 2, FAR 1.
  4. 10 ms tail, then DAC parked powered-down at 0.
  5. AS3935 receives the burst and derives its own distance and energy.

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

WIRING (BCM, physical pin in brackets)
  GPIO2  [3]   -> SDA
  GPIO3  [5]   -> SCL
  3V3    [1]   -> 3.3V                Click power
  GND    [6]   -> GND
  GPIO17 [11]  -> RST                 Click thunder LED
  GPIO5  [29]  -> button to GND       CLOSE
  GPIO6  [31]  -> button to GND       MID
  GPIO13 [33]  -> button to GND       FAR
  GPIO19 [35]  -> button to GND       STORM sequence
  AN, PWM, INT: not connected. These are the Click's own buttons, wired as host
  inputs. The Click cannot emit a burst on its own.

LEVELS
  Pi GPIO is 3.3 V, matching the Click. No level shifter.

RANGE
  Emulator coil to sensor antenna: 5 to 15 cm.

SETUP
  sudo raspi-config nonint do_i2c 0
  sudo apt install -y python3-smbus2 python3-gpiozero python3-lgpio
  sudo usermod -aG i2c,gpio "$USER"      # log out and back in

USAGE
  python3 lightning_emulator.py                  interactive
  sudo python3 lightning_emulator.py             + SCHED_FIFO
  python3 lightning_emulator.py --fire close     one shot
  python3 lightning_emulator.py --pace loop      Arduino timing
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

# 20 samples, 12-bit, decaying.
THUNDER_PROFILE = (
    1030, 730, 520, 370, 270, 200, 150, 110, 90, 70,
    60, 50, 45, 43, 40, 37, 35, 33, 32, 31,
)

SAMPLE_GAP_S = 22e-6                # inter-sample delay, loop pacing only
BURST_TAIL_S = 0.010                # tail before parking the DAC
MAX_RDWR_MSGS = 42                  # I2C_RDWR_IOCTL_MAX_MSGS
I2C_BUS = 1                         # /dev/i2c-1

# GPIO, BCM numbering.
PIN_LED = 17
PIN_BTN = {MODE_CLOSE: 5, MODE_MID: 6, MODE_FAR: 13}
PIN_BTN_STORM = 19

DEBOUNCE_S = 0.04
RETRIGGER_LOCKOUT_S = 0.4

# Scripted storm: 9 strikes, far to close then receding.
STORM_SCRIPT = (MODE_FAR, MODE_FAR, MODE_MID, MODE_MID, MODE_CLOSE,
                MODE_CLOSE, MODE_CLOSE, MODE_MID, MODE_FAR)
STORM_GAP_S = 3.0

# SCHED_FIFO priority, 1..99.
RT_PRIORITY = 10


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
            return False
        finally:
            if self.led is not None:
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
        print("[emu] press STORM again, or Ctrl-C, to stop")
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
# Buttons
# ---------------------------------------------------------------------------

def build_buttons(emu: Emulator):
    """Claim the LED and button GPIOs. Returns (buttons, led).

    gpiozero debounces via bounce_time. A per-mode lockout drops a second
    trigger inside RETRIGGER_LOCKOUT_S. A second STORM press sets a stop flag
    that the running sequence polls.
    """
    try:
        from gpiozero import Button, DigitalOutputDevice
    except ImportError:
        print("[emu] gpiozero not installed, buttons disabled")
        return None, None

    try:
        led = DigitalOutputDevice(PIN_LED, initial_value=False)
    except Exception as exc:                # noqa: BLE001
        print(f"[emu] GPIO{PIN_LED} unavailable for the Click LED ({exc})")
        led = None

    last_fire = {}
    storm_state = {"running": False, "stop": False}

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
            b = Button(pin, pull_up=True, bounce_time=DEBOUNCE_S)
            b.when_pressed = guard(mode)
            buttons.append(b)

        storm_btn = Button(PIN_BTN_STORM, pull_up=True, bounce_time=DEBOUNCE_S)

        def on_storm():
            if storm_state["running"]:
                storm_state["stop"] = True
                return
            storm_state["running"] = True
            storm_state["stop"] = False
            try:
                emu.storm(stop_requested=lambda: storm_state["stop"])
            finally:
                storm_state["running"] = False
                storm_state["stop"] = False

        storm_btn.when_pressed = on_storm
        buttons.append(storm_btn)
    except Exception as exc:                # noqa: BLE001
        print(f"[emu] button GPIOs unavailable ({exc})")
        return None, led

    return buttons, led


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description="AS3935 lightning emulator, Raspberry Pi + Thunder EMU Click")
    ap.add_argument("--pace", choices=("batched", "loop"), default="batched",
                    help="batched: one ioctl per burst. "
                         "loop: one write per sample plus a 22 us gap.")
    ap.add_argument("--fire", choices=("close", "mid", "far", "storm"),
                    help="fire once and exit")
    ap.add_argument("--bus", type=int, default=I2C_BUS, help="I2C bus number")
    ap.add_argument("--no-buttons", action="store_true",
                    help="keyboard only, claim no GPIO")
    args = ap.parse_args()

    print("=== AS3935 lightning emulator ===")
    print("Raspberry Pi + Thunder EMU Click")

    dac = Dac(args.bus)
    addr = dac.find()
    if addr is None:
        print("DAC NOT RESPONDING at 0x60 or 0x61.")
        print("  SDA on GPIO2 [3], SCL on GPIO3 [5], 3V3, common GND.")
        print("  Check:  ls /dev/i2c-*   and   i2cdetect -y 1")
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

    buttons = None
    if not args.no_buttons:
        buttons, led = build_buttons(emu)
        emu.led = led

    print()
    if buttons:
        print(f"Buttons to GND: GPIO{PIN_BTN[MODE_CLOSE]} CLOSE   "
              f"GPIO{PIN_BTN[MODE_MID]} MID   "
              f"GPIO{PIN_BTN[MODE_FAR]} FAR   "
              f"GPIO{PIN_BTN_STORM} STORM")
    print("Keyboard: c m f s, q to quit")
    print("Coil to sensor antenna: 5 to 15 cm.")
    print("SMS alerts must be OFF on the panel before testing.")
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
                print("  c m f s, q to quit")
    except KeyboardInterrupt:
        print()
    finally:
        # Park the DAC and release the pins.
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
