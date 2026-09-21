=========================================================================

  Stratus AS3935 Lightning Emulator
  Bench card notes.

  Property of METRON (PTY) LTD | Inteltronics
  Developed by L.J. Esterhuizen, Inteltronics

=========================================================================

AS3935 LIGHTNING EMULATOR - BENCH CARD
======================================

What this is
------------
A Raspberry Pi Zero 2 W that radiates emulated lightning bursts so LDS detector
units can be tested on the bench. It generates signals and nothing else. It does
not connect to WiFi, the panel or any cloud service, and it is not meant to.

Hardware
--------
  Raspberry Pi Zero 2 W
  MikroE Pi Click Shield, single mikroBUS socket   (MIKROE-1513)
  Thunder EMU Click, in that socket

Strikes are fired from the three buttons ON THE CLICK ITSELF: CLOSE, MID, FAR.
Nothing is hand wired and there are no external buttons.

Pin map (BCM), MIKROE-1513
--------------------------
  mikroBUS  Pi pin  BCM      role
  AN (DIG)  15      GPIO22   CLOSE button, input, pull-up
  PWM       12      GPIO18   MID button,   input, pull-up
  INT       11      GPIO17   FAR button,   input, pull-up
  RST        7      GPIO4    thunder LED,  output
  SDA        3      GPIO2    I2C
  SCL        5      GPIO3    I2C

Buttons are ACTIVE LOW. Pressed reads 0.

This map is for the SINGLE socket shield only. The two socket Pi 2 Click Shield
used on the Quaggasklip detector is wired differently, so do not carry these
numbers across.

First boot
----------
Everything is already staged. Put the card in, power up, and wait.

  hostname   lightningemulator1
  user       emulator1
  password   1234567890

On first boot cloud-init runs /boot/firmware/emulator/install.sh, which copies
the script to /opt/lightning-emulator, installs the systemd service and adds
emulator1 to the i2c and gpio groups. I2C is already enabled in config.txt on
this card, so no extra reboot is needed.

Installer log:  /var/log/lightning-emulator-install.log

Nothing is downloaded at any point. smbus2, gpiozero and the rpi-lgpio pin
backend all ship with Raspberry Pi OS Lite, which is what lets this work with no
network.

The LEDs, and what they are
---------------------------
Three LEDs matter. Taken from the Thunder EMU Click v100 schematic, so the
designators below are the ones silkscreened on the board.

  PI, green ACT LED (on the Pi Zero 2 W itself)
      Boot and SD card activity. Flickers irregularly while booting. Settles to
      mostly off once running. A REPEATING COUNTED PATTERN means a boot failure,
      see the flash codes further down.

  LD1, marked PWR (on the Click, next to jumper JP1)
      Plain power indicator, 470R via R1 off the selected VCC rail. Lights the
      moment the shield has power and stays lit. It says nothing about software.
      If LD1 is dark the Click is not seated or the shield has no power, and
      nothing else in this file will help until that is fixed.

  LD2, marked LIGHTNING (on the Click)
      The thunder indicator, 1k via R7, driven from mikroBUS RST, which is GPIO4.
      ACTIVE HIGH: the vendor driver's led_enable drives the pin high. This is
      the one the emulator software controls, and it is the only feedback the
      software can give you without a screen.

The three buttons are SW1 CLOSE, SW2 MID and SW3 FAR. Each has its own 10k
pull-up to VCC (R9, R10, R11) and a 100n debounce capacitor (C12, C13, C14) on
the board, which is why they read ACTIVE LOW: pressing pulls the line to ground.
The Pi's internal pull-up is also enabled, which is harmless in parallel.

Two jumpers:
  JP1  VCC SEL   3V3 or 5V board supply
  JP2  ADDR SEL  I2C address, 0x60 or 0x61. Either is fine, the software probes
                 both, so this one cannot be set wrongly.

What to look for on LD2, with no screen
---------------------------------------
LD2 LIGHTNING has been made to mean something specific:

  THREE BLINKS a few minutes after power up
      The service armed and the buttons are live. This is the signal to wait for.
      It does not appear until cloud-init has finished, so on a Zero 2 W give it
      2 to 3 minutes and one self-reboot.

  ONE FLASH when you press CLOSE, MID or FAR
      That strike was emitted. The flash is deliberately stretched to about
      120 ms: a strike itself is only 16 to 28 ms, which is too brief to see
      reliably. The stretch happens after the coil is parked, so it does not
      affect what the detector receives.

  NO THREE BLINKS AT ALL
      The service did not start. Almost always the Click is not seated, or I2C is
      not up. This is the one fault the LED cannot narrow down on its own.

  THREE BLINKS, but a button does nothing
      The service is running, so the fault is the button pin map or that one
      button. Not the service, and not I2C.

That split is the point of the startup blink: it separates "never started" from
"started but wrong pin", which otherwise look identical from the outside.

Note the vendor's own demo lights LD2 only for the length of the strike, so on a
stock driver this LED is nearly impossible to see. The 120 ms hold is a
deliberate departure from the reference for that reason.

Pi green ACT LED flash codes
---------------------------
A repeating counted pattern from the Pi's own green LED is a boot failure, not
activity. The pattern is a number of LONG flashes, then SHORT flashes, repeating
after about a two second gap.

  long  short  meaning
   0      3    generic boot failure
   0      4    start*.elf not found
   0      7    kernel image not found
   0      8    SDRAM failure
   0      9    insufficient SDRAM
   0     10    in HALT state
   2      1    partition not FAT
   2      2    could not read the partition
   2      3    extended partition not FAT
   4      4    unsupported board type
   4      5    fatal firmware error
   4      6    power failure type A
   4      7    power failure type B

Source: Raspberry Pi LED warning flash codes.

For this card the ones worth knowing are 0+4 and 0+7, which would mean the boot
partition contents are damaged, and 4+4, which would mean the card was written
for a different model. Any of those three is a reimage, not a config problem.

With a screen and keyboard (mini-HDMI plus USB), the detail is there too:

  i2cdetect -y 1                       expect 0x60, or 0x61 if strapped
  systemctl status lightning-emulator
  journalctl -u lightning-emulator -f
  cat /var/log/lightning-emulator-install.log

Driving it by hand
------------------
The service holds the GPIO pins, so stop it first or the pins will not be free:

  sudo systemctl stop lightning-emulator
  python3 /opt/lightning-emulator/lightning_emulator.py                 interactive
  python3 /opt/lightning-emulator/lightning_emulator.py --probe-buttons
  python3 /opt/lightning-emulator/lightning_emulator.py --fire close
  sudo systemctl start lightning-emulator

Interactive keys: c = close, m = mid, f = far, s = storm, q = quit.

What the buttons do
-------------------
Each button is one range. The range sets how many RF bursts go out, which is what
the detector reads its distance from:

  SW1  CLOSE   3 bursts   GPIO22, mikroBUS AN
  SW2  MID     2 bursts   GPIO18, mikroBUS PWM
  SW3  FAR     1 burst    GPIO17, mikroBUS INT

Rules, all copied from the vendor driver's behaviour:

  Press to fire         Fires on press, not release.
  Nearest wins          Hold two at once and you get the nearer range. The vendor
                        polls CLOSE, then MID, then FAR with else-if, so a
                        simultaneous press resolves to CLOSE.
  500 ms lockout        One global lockout, not per button. Anything inside
                        500 ms of the last strike is dropped. The vendor sleeps
                        500 ms after a burst, which gates its whole poll loop,
                        so this matches.
  40 ms debounce        In software, on top of the board's 10k and 100n.
  Any press stops a     While the storm sequence is running, a press stops it
  running storm         instead of firing a strike.

The storm sequence is 9 strikes, 3 seconds apart, working in and back out again:
FAR FAR MID MID CLOSE CLOSE CLOSE MID FAR.

The Click has three buttons and there are three ranges, so there is no spare
button for the storm. By default it is keyboard only. See --storm-on-hold below
to put it on a button.

Button configurations available
-------------------------------
Set these in /etc/default/lightning-emulator as EMU_ARGS, then:

  sudo systemctl restart lightning-emulator

  (default, no flags)
      Three buttons, three ranges, fire on press. Storm not reachable from the
      buttons.

  --storm-on-hold
      Hold SW3 FAR for 1.5 s to run the nine strike storm. Holding it again stops
      it. The tradeoff: FAR then fires on RELEASE rather than on press, because
      otherwise a hold would fire a FAR strike and then start a storm. CLOSE and
      MID are unchanged.

  --pins CLOSE,MID,FAR,LED
      Override the pin map. Default for this shield is 22,18,17,4. Only needed if
      the shield is not a MIKROE-1513. Four distinct BCM numbers, 0 to 27.

  --no-buttons
      Claim no GPIO at all, keyboard only. Useful if something else on the box
      holds the pins.

  --pace loop
      Per sample DAC writes with a 22 us busy-wait between them, matching the
      Arduino sketch exactly. The default, batched, sends a whole burst in one
      ioctl so the kernel issues all 20 writes back to back with no Python or
      scheduler jitter. Default is the better waveform; use loop only to
      reproduce the Arduino timing.

  --bus N
      I2C bus number. Default 1, which is correct for this shield.

Not for the service, run by hand:

  --probe-buttons        Name the GPIO behind each button empirically. Press
                         CLOSE, then MID, then FAR, one at a time. Prints a
                         ready-to-paste --pins line.
  --probe-seconds N      How long to listen. Default 30.
  --fire close|mid|far|storm    One shot, then exit.
  --headless             Buttons only, never read the keyboard. Already in the
                         unit, and assumed whenever stdin is not a TTY.

Using it
--------
  Emulator coil to detector antenna: 5 to 15 cm.
  TURN SMS ALERTS OFF ON THE PANEL BEFORE TESTING, or the bench will send real
  alerts to real recipients.

If nothing fires
----------------
Use the startup blink to decide which half of the problem you have.

  No three blinks:
  1. Is the Click properly seated in the socket?
  2. i2cdetect -y 1 shows nothing  ->  I2C or the board, not the software.
     Confirm: grep i2c_arm /boot/firmware/config.txt
  3. journalctl -u lightning-emulator -n 40 --no-pager

  Three blinks, but pressing does nothing:
  4. Wrong pin map. Stop the service so it releases the pins, then run
     --probe-buttons; it prints a ready-to-paste --pins line, which goes in
     /etc/default/lightning-emulator.
  5. If the LED flashes on a press but the detector sees nothing, the emulator is
     working and the problem is the gap or the detector. Check the 5 to 15 cm
     spacing first.

A wrong pin map gives a rig that starts cleanly, reports itself healthy and
never fires. That is the trap worth knowing about, and the startup blink is what
makes it distinguishable without a screen.
