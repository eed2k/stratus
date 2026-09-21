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

Checking it came up, with no screen
-----------------------------------
Watch the thunder LED on the Click. It is the only feedback the board gives, so
it has been made to mean something specific:

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

Changing the flags
------------------
Edit /etc/default/lightning-emulator, then:

  sudo systemctl restart lightning-emulator

--storm-on-hold is the useful one: hold FAR for 1.5s to run the nine strike
storm sequence. The Click only has three buttons, so without it the storm is
keyboard only.

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
