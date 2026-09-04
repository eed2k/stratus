/*
 * AS3935 lightning emulator - Arduino Nano + MikroElektronika Thunder EMU Click.
 *
 * PROCESS
 *   1. Host writes a 20-sample decaying profile to the Click's MCP4725 DAC.
 *   2. DAC output drives an inductor, emitting an RF burst.
 *   3. Burst repeats (3 - mode) times: CLOSE 3, MID 2, FAR 1.
 *   4. 10 ms tail, then DAC parked powered-down at 0.
 *   5. AS3935 receives the burst and derives its own distance and energy.
 *
 * TIMING
 *   I2C 100 kHz. One 2-byte write = ~280 us bus time.
 *   Inter-sample delay 22 us. Sample period ~300 us. Burst ~6 ms.
 *
 * DAC PROTOCOL
 *   MCP4725 at 0x60, or 0x61 when strapped.
 *   Fast-mode write, 2 bytes:
 *     byte0 = mode | ((value >> 8) & 0x0F)
 *     byte1 = value & 0xFF
 *   mode 0x00 = normal, 0x10 = powered down through 1k.
 *
 * WIRING
 *   A4  -> SDA
 *   A5  -> SCL
 *   D6  -> RST                  Click thunder LED
 *   D2  -> button to GND        CLOSE
 *   D3  -> button to GND        MID
 *   D4  -> button to GND        FAR
 *   D5  -> button to GND        STORM sequence
 *   D13 -> on-board LED         activity
 *   AN, PWM, INT: not connected. These are the Click's own buttons, wired as
 *   host inputs. The Click cannot emit a burst on its own.
 *
 * LEVELS
 *   Nano is 5 V. Click is 3.3 V unless its voltage jumper selects 5 V.
 *   3.3 V board: power from 3V3, level-shift SDA and SCL.
 *
 * RANGE
 *   Emulator coil to sensor antenna: 5 to 15 cm.
 */

#include <Wire.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// MCP4725 address candidates, probed in order at boot.
static const uint8_t DAC_ADDR_PRIMARY = 0x60;
static const uint8_t DAC_ADDR_ALT = 0x61;
static uint8_t dacAddr = DAC_ADDR_PRIMARY;   // resolved in setup()

// DAC fast-mode command bits.
static const uint8_t DAC_FAST_NORMAL = 0x00;
static const uint8_t DAC_FAST_PDOWN_1K = 0x10;

// Emulation modes. Burst count is 3 - mode.
static const uint8_t MODE_CLOSE = 0;
static const uint8_t MODE_MID = 1;
static const uint8_t MODE_FAR = 2;

// Pins.
static const uint8_t PIN_BTN_CLOSE = 2;
static const uint8_t PIN_BTN_MID = 3;
static const uint8_t PIN_BTN_FAR = 4;
static const uint8_t PIN_BTN_STORM = 5;
static const uint8_t PIN_EMU_LED = 6;    // mikroBUS RST
static const uint8_t PIN_STATUS = 13;    // on-board LED

// Debounce window, and minimum interval between two accepted presses.
static const unsigned long DEBOUNCE_MS = 40;
static const unsigned long RETRIGGER_LOCKOUT_MS = 400;

// I2C timeout. Bounds a transfer if SDA is held low.
static const uint32_t I2C_TIMEOUT_US = 3000;

// Vendor DAC profile: 20 samples, 12-bit, decaying.
static const uint16_t THUNDER_PROFILE[20] = {
  1030, 730, 520, 370, 270, 200, 150, 110, 90, 70,
  60, 50, 45, 43, 40, 37, 35, 33, 32, 31
};

// ---------------------------------------------------------------------------
// DAC
// ---------------------------------------------------------------------------

/* One fast-mode write. Returns true on ACK. Value clamped to 12 bits. */
static bool dacWrite(uint8_t mode, uint16_t value) {
  if (value > 0x0FFF) {
    value = 0x0FFF;
  }
  Wire.beginTransmission(dacAddr);
  Wire.write((uint8_t)(mode | ((value >> 8) & 0x0F)));
  Wire.write((uint8_t)(value & 0xFF));
  return Wire.endTransmission() == 0;
}

/* Zero-length write: does a device ACK this address? */
static bool dacPresentAt(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

/* Probe 0x60 then 0x61. Sets dacAddr. False if neither answers. */
static bool dacFind() {
  if (dacPresentAt(DAC_ADDR_PRIMARY)) { dacAddr = DAC_ADDR_PRIMARY; return true; }
  if (dacPresentAt(DAC_ADDR_ALT))     { dacAddr = DAC_ADDR_ALT;     return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Emulation
// ---------------------------------------------------------------------------

/* Emit one strike.
   (3 - mode) bursts of the 20-sample profile, 22 us between samples,
   10 ms tail, then park the DAC powered down at 0. */
static bool generateThunder(uint8_t mode) {
  if (mode > MODE_FAR) {
    return false;
  }
  bool ok = true;
  uint8_t bursts = 3 - mode;

  digitalWrite(PIN_EMU_LED, HIGH);
  digitalWrite(PIN_STATUS, HIGH);

  while (bursts--) {
    for (uint8_t i = 0; i < 20; i++) {
      ok &= dacWrite(DAC_FAST_NORMAL, THUNDER_PROFILE[i]);
      delayMicroseconds(22);
    }
  }

  delay(10);
  ok &= dacWrite(DAC_FAST_PDOWN_1K, 0x0000);

  digitalWrite(PIN_EMU_LED, LOW);
  digitalWrite(PIN_STATUS, LOW);
  return ok;
}

static const char *modeName(uint8_t mode) {
  switch (mode) {
    case MODE_CLOSE: return "CLOSE";
    case MODE_MID:   return "MID";
    case MODE_FAR:   return "FAR";
    default:         return "?";
  }
}

/* Emit one strike and log it. No ACK means nothing was emitted. */
static void fire(uint8_t mode, const char *why) {
  bool ok = generateThunder(mode);
  Serial.print(F("[emu] "));
  Serial.print(why);
  Serial.print(F(" -> "));
  Serial.print(modeName(mode));
  Serial.print(F(" ("));
  Serial.print(3 - mode);
  Serial.print(F(" burst"));
  Serial.print((3 - mode) == 1 ? F(")") : F("s)"));
  if (!ok) {
    Serial.print(F("  ** DAC DID NOT ACK - nothing emitted **"));
  }
  Serial.println();
}

/* Block until STORM has been released for DEBOUNCE_MS. */
static void waitForStormRelease() {
  unsigned long stableSince = 0;
  while (true) {
    if (digitalRead(PIN_BTN_STORM) == HIGH) {
      if (stableSince == 0) {
        stableSince = millis();
      } else if (millis() - stableSince >= DEBOUNCE_MS) {
        return;
      }
    } else {
      stableSince = 0;
    }
    delay(5);
  }
}

/* Wait `ms`. Returns true early if STORM is pressed again. */
static bool waitOrAbort(unsigned long ms) {
  unsigned long start = millis();
  unsigned long downSince = 0;
  while (millis() - start < ms) {
    if (digitalRead(PIN_BTN_STORM) == LOW) {
      if (downSince == 0) {
        downSince = millis();
      } else if (millis() - downSince >= DEBOUNCE_MS) {
        waitForStormRelease();
        return true;
      }
    } else {
      downSince = 0;
    }
    delay(5);
  }
  return false;
}

/* Scripted storm: 9 strikes, far to close then receding, 3 s apart.
   Waits for release first so the starting press is not read as an abort.
   A second STORM press stops it. */
static void stormSequence() {
  static const uint8_t script[] = {
    MODE_FAR, MODE_FAR, MODE_MID, MODE_MID, MODE_CLOSE,
    MODE_CLOSE, MODE_CLOSE, MODE_MID, MODE_FAR
  };
  const uint8_t steps = sizeof(script) / sizeof(script[0]);

  Serial.println(F("[emu] storm sequence: approaching, then receding"));
  Serial.println(F("[emu] press STORM again to stop"));

  waitForStormRelease();

  for (uint8_t i = 0; i < steps; i++) {
    Serial.print(F("[emu]   step "));
    Serial.print(i + 1);
    Serial.print('/');
    Serial.print(steps);
    Serial.print(F(": "));
    fire(script[i], "storm");

    if (i + 1 < steps && waitOrAbort(3000)) {
      Serial.println(F("[emu] storm sequence stopped"));
      return;
    }
  }
  Serial.println(F("[emu] storm sequence complete"));
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

struct Button {
  uint8_t pin;
  uint8_t stable;                          // last debounced level
  bool timing;                             // a level change is being timed
  unsigned long changedAt;                 // when the raw level moved
  bool everFired;                          // has fired at least once
  unsigned long firedAt;                   // when it last fired
};

static Button buttons[4] = {
  { PIN_BTN_CLOSE, HIGH, false, 0, false, 0 },
  { PIN_BTN_MID,   HIGH, false, 0, false, 0 },
  { PIN_BTN_FAR,   HIGH, false, 0, false, 0 },
  { PIN_BTN_STORM, HIGH, false, 0, false, 0 },
};

/* True once per press: falling edge, debounced, past the lockout.
   `timing` marks an in-progress debounce; `everFired` exempts the first
   press from the lockout comparison. */
static bool pressed(Button &b) {
  unsigned long now = millis();
  uint8_t raw = digitalRead(b.pin);

  if (raw != b.stable) {
    if (!b.timing) {
      b.timing = true;
      b.changedAt = now;
    } else if (now - b.changedAt >= DEBOUNCE_MS) {
      b.stable = raw;
      b.timing = false;
      if (raw == LOW &&
          (!b.everFired || (now - b.firedAt) >= RETRIGGER_LOCKOUT_MS)) {
        b.everFired = true;
        b.firedAt = now;
        return true;
      }
    }
  } else {
    b.timing = false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Setup and loop
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(PIN_BTN_CLOSE, INPUT_PULLUP);
  pinMode(PIN_BTN_MID, INPUT_PULLUP);
  pinMode(PIN_BTN_FAR, INPUT_PULLUP);
  pinMode(PIN_BTN_STORM, INPUT_PULLUP);
  pinMode(PIN_EMU_LED, OUTPUT);
  pinMode(PIN_STATUS, OUTPUT);
  digitalWrite(PIN_EMU_LED, LOW);
  digitalWrite(PIN_STATUS, LOW);

  Wire.begin();
  Wire.setClock(100000);
  Wire.setWireTimeout(I2C_TIMEOUT_US, true);   // true: reset the peripheral

  delay(50);

  Serial.println();
  Serial.println(F("=== AS3935 lightning emulator ==="));
  Serial.println(F("Arduino Nano + Thunder EMU Click"));
  if (dacFind()) {
    Serial.print(F("DAC found at 0x"));
    Serial.print(dacAddr, HEX);
    Serial.println();
    dacWrite(DAC_FAST_PDOWN_1K, 0x0000);       // park while idle
  } else {
    Serial.println(F("DAC NOT RESPONDING at 0x60 or 0x61."));
    Serial.println(F("  SDA on A4, SCL on A5, common GND, power present."));
    Serial.println(F("  A 3.3 V-only Click needs 3V3 and level-shifted I2C."));
  }

  Serial.println();
  Serial.println(F("Buttons to GND:"));
  Serial.println(F("  D2 CLOSE   D3 MID   D4 FAR   D5 STORM"));
  Serial.println(F("Serial: c m f s"));
  Serial.println(F("Coil to sensor antenna: 5 to 15 cm."));
  Serial.println(F("SMS alerts must be OFF on the panel before testing."));
  Serial.println();
}

void loop() {
  if (pressed(buttons[0])) fire(MODE_CLOSE, "button CLOSE");
  if (pressed(buttons[1])) fire(MODE_MID, "button MID");
  if (pressed(buttons[2])) fire(MODE_FAR, "button FAR");
  if (pressed(buttons[3])) stormSequence();

  // One character per pass, so a pasted string cannot queue several sequences.
  if (Serial.available() > 0) {
    int c = Serial.read();
    switch (c) {
      case 'c': case 'C': fire(MODE_CLOSE, "serial"); break;
      case 'm': case 'M': fire(MODE_MID, "serial"); break;
      case 'f': case 'F': fire(MODE_FAR, "serial"); break;
      case 's': case 'S':
        stormSequence();
        while (Serial.available() > 0) Serial.read();   // discard stale input
        break;
      default: break;
    }
  }
}
