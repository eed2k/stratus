/*
 * Lightning emulator: Arduino Nano + MikroElektronika Thunder EMU Click.
 *
 * Fires synthetic lightning at the AS3935 detector so the whole chain can be
 * exercised on the bench: sensor interrupt, distance and energy, heartbeat,
 * alert evaluation, the admin panel's storm display, and the beacon lamps.
 *
 * WHY THE CLICK'S OWN BUTTONS ARE NOT USED
 * ----------------------------------------
 * The EMU Click cannot generate a strike by itself. Its CLOSE, MID and FAR pins
 * (mikroBUS AN, PWM, INT) are INPUTS to the host: three buttons the host is
 * expected to poll. The waveform is produced entirely by the host writing a
 * timed profile to the board's I2C DAC, which drives an inductor.
 *
 * So triggering from Nano-side buttons needs no hardware modification and no
 * signal interception. AN, PWM and INT are simply left unwired, and the buttons
 * below are read instead. Nothing on the Click can fire without us.
 *
 * WAVEFORM FIDELITY
 * -----------------
 * The profile, the 22 us inter-sample delay, the burst count and the power-down
 * tail all reproduce the vendor driver's thunderemu_generate_thunder(). The I2C
 * bus is left at 100 kHz on purpose: a 2-byte fast write takes about 280 us at
 * that speed, which is far longer than the 22 us delay, so bus time is what
 * actually sets the envelope timing. Raising the clock to 400 kHz would compress
 * the waveform roughly threefold and change what the sensor sees.
 *
 * WIRING
 * ------
 *   A4  -> SDA   (I2C data, fixed on the Nano)
 *   A5  -> SCL   (I2C clock, fixed on the Nano)
 *   D6  -> RST   (the Click's thunder LED, driven by the host)
 *   D2  -> push button to GND: CLOSE
 *   D3  -> push button to GND: MID
 *   D4  -> push button to GND: FAR
 *   D5  -> push button to GND: STORM sequence
 *   D13 -> on-board LED, activity
 *   AN / PWM / INT: intentionally NOT connected.
 *
 * Check the Click's voltage jumper before powering it. MIKROE boards are built
 * around 3.3 V logic and not all are 5 V tolerant; the Nano is a 5 V part. If
 * the board is 3.3 V only, power it from 3V3 and level-shift SDA and SCL.
 *
 * Keep the coils within about 15 cm: the vendor's profile is calibrated for that
 * range and the sensor will not register anything much beyond it.
 */

#include <Wire.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// MCP4725-class DAC on the Click. 0x60 is the default; the board may offer 0x61.
static const uint8_t DAC_ADDR = 0x60;

// Fast-mode write, normal operation. The upper nibble carries the mode bits.
static const uint8_t DAC_FAST_NORMAL = 0x00;
// Fast-mode write, powered down through a 1 k resistor. Used to park the output
// after a burst so the coil is not left driven.
static const uint8_t DAC_FAST_PDOWN_1K = 0x10;

// Emulation modes. The burst count is 3 - mode, so CLOSE is the strongest.
static const uint8_t MODE_CLOSE = 0;
static const uint8_t MODE_MID = 1;
static const uint8_t MODE_FAR = 2;

// Pins.
static const uint8_t PIN_BTN_CLOSE = 2;
static const uint8_t PIN_BTN_MID = 3;
static const uint8_t PIN_BTN_FAR = 4;
static const uint8_t PIN_BTN_STORM = 5;
static const uint8_t PIN_EMU_LED = 6;    // mikroBUS RST: the Click's own LED
static const uint8_t PIN_STATUS = 13;    // Nano on-board LED

// Button handling. 40 ms settles a typical tactile switch; the lockout stops a
// single press from queueing several strikes, which would confuse the panel's
// event history far more than it would test it.
static const unsigned long DEBOUNCE_MS = 40;
static const unsigned long RETRIGGER_LOCKOUT_MS = 400;

// Vendor DAC profile: a decaying envelope, 20 samples of 12-bit data.
// Calibrated by the vendor for up to ~15 cm between inductors.
static const uint16_t THUNDER_PROFILE[20] = {
  1030, 730, 520, 370, 270, 200, 150, 110, 90, 70,
  60, 50, 45, 43, 40, 37, 35, 33, 32, 31
};

// ---------------------------------------------------------------------------
// DAC
// ---------------------------------------------------------------------------

/* One fast-mode write to the DAC. Returns true if the device acknowledged.
   A silent failure here looks exactly like "the sensor ignored my strike", so
   the result is checked and surfaced rather than discarded. */
static bool dacWrite(uint8_t mode, uint16_t value) {
  if (value > 0x0FFF) {
    value = 0x0FFF;                       // 12-bit device; clamp, do not wrap
  }
  Wire.beginTransmission(DAC_ADDR);
  Wire.write((uint8_t)(mode | ((value >> 8) & 0x0F)));
  Wire.write((uint8_t)(value & 0xFF));
  return Wire.endTransmission() == 0;
}

/* Is the DAC actually there? Called at boot so a wiring fault is reported once,
   clearly, instead of being mistaken later for an unresponsive sensor. */
static bool dacPresent() {
  Wire.beginTransmission(DAC_ADDR);
  return Wire.endTransmission() == 0;
}

// ---------------------------------------------------------------------------
// Emulation
// ---------------------------------------------------------------------------

/* Emit one emulated strike.
   Mirrors the vendor's generate_thunder(): 3 - mode bursts of the 20-sample
   profile with a 22 us gap between samples, a 10 ms tail, then park the DAC
   powered down at minimum. */
static bool generateThunder(uint8_t mode) {
  if (mode > MODE_FAR) {
    return false;
  }
  bool ok = true;
  uint8_t bursts = 3 - mode;

  digitalWrite(PIN_EMU_LED, HIGH);        // the Click's thunder LED
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
    // Worth stating plainly: no ACK means nothing was emitted at all, which is
    // a wiring or address fault, not a rejected waveform.
    Serial.print(F("  ** DAC DID NOT ACK - nothing was emitted **"));
  }
  Serial.println();
}

/* Wait for the STORM button to be released, so the press that started the
   sequence is not immediately mistaken for a request to stop it. */
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
      stableSince = 0;                     // still held, or bouncing
    }
    delay(5);
  }
}

/* Wait `ms`, returning early and true if the STORM button is pressed again.
   Used for the gaps between steps so a second press aborts the sequence. */
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

/* A scripted approaching-then-receding storm.
 *
 * Useful because it walks the sensor through several distance bands in one
 * press, which is what actually exercises the panel's proximity grouping and
 * the beacon's re-arming. The gaps are seconds, not milliseconds: the AS3935
 * needs time between events, and the panel's alert cooldown is meant to be
 * observed rather than bypassed.
 *
 * Press STORM again at any point to stop early.
 */
static void stormSequence() {
  static const uint8_t script[] = {
    MODE_FAR, MODE_FAR, MODE_MID, MODE_MID, MODE_CLOSE,
    MODE_CLOSE, MODE_CLOSE, MODE_MID, MODE_FAR
  };
  const uint8_t steps = sizeof(script) / sizeof(script[0]);

  Serial.println(F("[emu] storm sequence: approaching, then receding"));
  Serial.println(F("[emu] press STORM again to stop early"));

  // The button that got us here is almost certainly still down. Without this
  // the first gap would see it held and abort after a single step.
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
  unsigned long changedAt;                 // when the raw level last moved
  unsigned long firedAt;                   // when it last triggered
};

static Button buttons[4] = {
  { PIN_BTN_CLOSE, HIGH, 0, 0 },
  { PIN_BTN_MID,   HIGH, 0, 0 },
  { PIN_BTN_FAR,   HIGH, 0, 0 },
  { PIN_BTN_STORM, HIGH, 0, 0 },
};

/* True once per press, on the falling edge, after debouncing and lockout. */
static bool pressed(Button &b) {
  unsigned long now = millis();
  uint8_t raw = digitalRead(b.pin);

  if (raw != b.stable) {
    if (b.changedAt == 0) {
      b.changedAt = now;
    } else if (now - b.changedAt >= DEBOUNCE_MS) {
      b.stable = raw;
      b.changedAt = 0;
      if (raw == LOW && (now - b.firedAt) >= RETRIGGER_LOCKOUT_MS) {
        b.firedAt = now;
        return true;
      }
    }
  } else {
    b.changedAt = 0;
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
  // Left at the vendor's standard speed on purpose. See the header comment:
  // bus time, not the 22 us delay, is what sets the waveform timing.
  Wire.setClock(100000);

  delay(50);

  Serial.println();
  Serial.println(F("=== AS3935 lightning emulator ==="));
  Serial.println(F("Arduino Nano + Thunder EMU Click"));
  Serial.print(F("DAC at 0x"));
  Serial.print(DAC_ADDR, HEX);
  if (dacPresent()) {
    Serial.println(F(": present"));
    // Park the output so the coil is not driven while idle.
    dacWrite(DAC_FAST_PDOWN_1K, 0x0000);
  } else {
    Serial.println(F(": NOT RESPONDING"));
    Serial.println(F("  Check: SDA on A4, SCL on A5, VCC and GND, and whether"));
    Serial.println(F("  the board is strapped to 0x61 instead of 0x60."));
    Serial.println(F("  Also confirm the board's voltage jumper: a 3.3 V-only"));
    Serial.println(F("  Click needs 3V3 power and level-shifted I2C."));
  }

  Serial.println();
  Serial.println(F("Buttons (to GND):"));
  Serial.println(F("  D2 CLOSE   D3 MID   D4 FAR   D5 STORM sequence"));
  Serial.println(F("Serial also accepts: c, m, f, s"));
  Serial.println(F("Keep the coils within ~15 cm of the detector antenna."));
  Serial.println(F("Confirm SMS alerts are OFF on the panel before testing."));
  Serial.println();
}

void loop() {
  if (pressed(buttons[0])) fire(MODE_CLOSE, "button CLOSE");
  if (pressed(buttons[1])) fire(MODE_MID, "button MID");
  if (pressed(buttons[2])) fire(MODE_FAR, "button FAR");
  if (pressed(buttons[3])) stormSequence();

  // Serial shortcuts, handy when the rig is on a desk next to the laptop.
  // The buttons remain the primary interface.
  while (Serial.available() > 0) {
    int c = Serial.read();
    switch (c) {
      case 'c': case 'C': fire(MODE_CLOSE, "serial"); break;
      case 'm': case 'M': fire(MODE_MID, "serial"); break;
      case 'f': case 'F': fire(MODE_FAR, "serial"); break;
      case 's': case 'S': stormSequence(); break;
      default: break;                      // ignore newlines and stray bytes
    }
  }
}
