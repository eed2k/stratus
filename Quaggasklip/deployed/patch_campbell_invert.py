#!/usr/bin/env python3
"""Make the Campbell serial output use inverted (RS-232) polarity.

The CR300 control terminals expect RS-232 logic: idle low, start bit high, data
bits complemented. pigpio's wave_add_serial only emits standard TTL, so the
waveform is built with wave_add_generic instead.

Every replacement is asserted, so the file is either fully patched or untouched.
"""
import os
import shutil
import sys
import time

PATH = "/home/quaggasklip/lightning_detector.py"

EDITS = [
    # 1. Config default.
    (
        "        self.CAMPBELL_UART_BAUD = 9600\n",
        "        self.CAMPBELL_UART_BAUD = 9600\n"
        "        self.CAMPBELL_UART_INVERT = True   # CR300 C1/C2 use RS-232 logic\n",
    ),
    # 2. Validator entry.
    (
        '        "CAMPBELL_UART_BAUD":   (int, 300, 115200),\n',
        '        "CAMPBELL_UART_BAUD":   (int, 300, 115200),\n'
        '        "CAMPBELL_UART_INVERT": (bool, None, None),\n',
    ),
    # 3. Constructor signature.
    (
        "    def __init__(self, enabled, tx_pin, baud, logger):\n"
        "        self.enabled = bool(enabled)\n"
        "        self.tx_pin = int(tx_pin)\n"
        "        self.baud = int(baud)\n"
        "        self.logger = logger\n",
        "    def __init__(self, enabled, tx_pin, baud, logger, invert=True):\n"
        "        self.enabled = bool(enabled)\n"
        "        self.tx_pin = int(tx_pin)\n"
        "        self.baud = int(baud)\n"
        "        self.invert = bool(invert)\n"
        "        self.logger = logger\n",
    ),
    # 4. Construction site.
    (
        "            config.CAMPBELL_UART_BAUD,\n"
        "            self.logger\n"
        "        )\n",
        "            config.CAMPBELL_UART_BAUD,\n"
        "            self.logger,\n"
        "            config.CAMPBELL_UART_INVERT\n"
        "        )\n",
    ),
    # 5. Idle level. Inverted polarity idles low.
    (
        "            self._pi.write(self.tx_pin, 1)  # UART idle line high\n",
        "            self._pi.write(self.tx_pin, 0 if self.invert else 1)\n",
    ),
    # 6. Startup log states the polarity in use.
    (
        '                "Campbell UART TX enabled on GPIO %d @ %d baud",\n'
        "                self.tx_pin, self.baud\n",
        '                "Campbell UART TX enabled on GPIO %d @ %d baud (%s)",\n'
        '                self.tx_pin, self.baud,\n'
        '                "inverted" if self.invert else "TTL"\n',
    ),
    # 7. The waveform builder, inserted ahead of send_lightning.
    (
        "    def send_lightning(self, distance_km, energy):\n",
        "    def _add_wave(self, pi, record):\n"
        '        """Queue one record, inverting the levels when required."""\n'
        "        if not self.invert:\n"
        "            pi.wave_add_serial(self.tx_pin, self.baud, record)\n"
        "            return\n"
        "        bits = []\n"
        "        for byte in record:\n"
        "            bits.append(1)                                 # start\n"
        "            for i in range(8):\n"
        "                bits.append(0 if (byte >> i) & 1 else 1)   # data, LSB first\n"
        "            bits.append(0)                                 # stop\n"
        "        width_us = 1000000.0 / self.baud\n"
        "        mask = 1 << self.tx_pin\n"
        "        pulses = []\n"
        "        i = 0\n"
        "        while i < len(bits):\n"
        "            j = i\n"
        "            while j < len(bits) and bits[j] == bits[i]:\n"
        "                j += 1\n"
        "            hold = int(round((j - i) * width_us))\n"
        "            if bits[i]:\n"
        "                pulses.append(pigpio.pulse(mask, 0, hold))\n"
        "            else:\n"
        "                pulses.append(pigpio.pulse(0, mask, hold))\n"
        "            i = j\n"
        "        pi.wave_add_generic(pulses)\n"
        "\n"
        "    def send_lightning(self, distance_km, energy):\n",
    ),
    # 8 and 9. Both transmit paths.
    (
        "            pi.wave_add_serial(self.tx_pin, self.baud, record)"
        "  # bytes must end with real CR LF\n",
        "            self._add_wave(pi, record)\n",
    ),
    (
        "            pi.wave_add_new()\n"
        "            pi.wave_add_serial(self.tx_pin, self.baud, record)\n",
        "            pi.wave_add_new()\n"
        "            self._add_wave(pi, record)\n",
    ),
]

src = open(PATH, encoding="utf-8").read()
original = src

if "_add_wave" in src:
    sys.exit("  already patched, nothing to do")

for n, (old, new) in enumerate(EDITS, 1):
    count = src.count(old)
    if count != 1:
        sys.exit("  edit %d matched %d times, expected exactly 1. Aborting with "
                 "no changes written.\n  anchor: %r" % (n, count, old[:70]))
    src = src.replace(old, new)

compile(src, PATH, "exec")          # refuse to write a file that will not parse

backup = PATH + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(PATH, backup)
with open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("  patched %d edits" % len(EDITS))
print("  backup: %s" % backup)
print("  bytes: %d -> %d" % (len(original), len(src)))
