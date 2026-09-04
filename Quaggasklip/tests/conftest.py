"""Test setup for the Quaggasklip detector.

The program imports hardware modules (spidev, RPi.GPIO, serial, pigpio) at
import time, and none of them exist on a development machine. Lightweight stubs
are injected into sys.modules before the import so the pure logic - record
formatting, config validation, URL derivation, payload construction - can be
tested off-target.

Same approach as Lightning Detector/detector/tests/conftest.py, extended with a
serial stub because this unit uses the hardware UART.
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class FakeSerial:
    """Records what was written and replays a queued read buffer.

    Behaves enough like pyserial for CampbellLink: write/flush/in_waiting/read,
    plus a `fail_writes` switch so the failure path can be tested without
    unplugging anything.
    """

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        self.written = bytearray()
        self.to_read = bytearray()
        self.closed = False
        self.flushed = 0
        self.fail_writes = False

    # --- pyserial surface used by CampbellLink ---
    def write(self, data):
        if self.fail_writes:
            raise OSError("simulated write failure")
        self.written.extend(data)
        return len(data)

    def flush(self):
        self.flushed += 1

    @property
    def in_waiting(self):
        return len(self.to_read)

    def read(self, n):
        chunk = bytes(self.to_read[:n])
        del self.to_read[:n]
        return chunk

    def reset_input_buffer(self):
        self.to_read.clear()

    def reset_output_buffer(self):
        pass

    def close(self):
        self.closed = True

    # --- test helpers ---
    def feed(self, text):
        """Queue bytes as though the logger had sent them."""
        self.to_read.extend(text.encode("ascii"))

    def text(self):
        """Everything written so far, as a string."""
        return self.written.decode("ascii", "replace")


def _install_hw_stubs():
    if "spidev" not in sys.modules:
        spidev = types.ModuleType("spidev")
        spidev.SpiDev = lambda *a, **k: types.SimpleNamespace(
            open=lambda *a, **k: None, close=lambda: None,
            xfer2=lambda *a, **k: [0, 0], max_speed_hz=0, mode=0)
        sys.modules["spidev"] = spidev

    if "RPi" not in sys.modules:
        rpi = types.ModuleType("RPi")
        gpio = types.ModuleType("RPi.GPIO")
        for name in ("BCM", "OUT", "IN", "RISING", "FALLING", "HIGH", "LOW",
                     "PUD_UP", "PUD_DOWN"):
            setattr(gpio, name, 0)
        for fn in ("setmode", "setup", "output", "input", "add_event_detect",
                   "remove_event_detect", "cleanup", "setwarnings"):
            setattr(gpio, fn, lambda *a, **k: None)
        rpi.GPIO = gpio
        sys.modules["RPi"] = rpi
        sys.modules["RPi.GPIO"] = gpio

    if "serial" not in sys.modules:
        ser = types.ModuleType("serial")
        ser.Serial = FakeSerial
        ser.EIGHTBITS = 8
        ser.PARITY_NONE = "N"
        ser.STOPBITS_ONE = 1
        sys.modules["serial"] = ser

    if "pigpio" not in sys.modules:
        pig = types.ModuleType("pigpio")
        pig.pi = lambda *a, **k: types.SimpleNamespace(
            connected=False, set_mode=lambda *a, **k: None,
            write=lambda *a, **k: None, wave_clear=lambda *a, **k: None)
        pig.OUTPUT = 0
        sys.modules["pigpio"] = pig


_install_hw_stubs()
