"""Test setup for the detector.

The detector imports hardware modules (spidev, RPi.GPIO, pigpio) at import
time, which are absent on a development machine. We inject lightweight stubs
into sys.modules so the pure logic (CPU load parsing, telemetry payloads) can
be imported and tested off-target.
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


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
        # Minimal constants/functions used at import and setup time.
        for name in ("BCM", "OUT", "IN", "RISING", "FALLING", "HIGH", "LOW",
                     "PUD_UP", "PUD_DOWN"):
            setattr(gpio, name, 0)
        for fn in ("setmode", "setup", "output", "input", "add_event_detect",
                   "remove_event_detect", "cleanup", "setwarnings"):
            setattr(gpio, fn, lambda *a, **k: None)
        rpi.GPIO = gpio
        sys.modules["RPi"] = rpi
        sys.modules["RPi.GPIO"] = gpio

    if "pigpio" not in sys.modules:
        pig = types.ModuleType("pigpio")
        pig.pi = lambda *a, **k: types.SimpleNamespace(
            connected=False, set_mode=lambda *a, **k: None,
            wave_clear=lambda *a, **k: None)
        pig.OUTPUT = 0
        sys.modules["pigpio"] = pig


_install_hw_stubs()
