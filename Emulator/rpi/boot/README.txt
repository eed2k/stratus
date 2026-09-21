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

Checking it came up
-------------------
  i2cdetect -y 1                       expect 0x60, or 0x61 if strapped
  systemctl status lightning-emulator
  journalctl -u lightning-emulator -f

Then press CLOSE, MID or FAR on the Click. The journal logs every burst.

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
  1. Is the Click properly seated in the socket?
  2. i2cdetect -y 1 shows nothing  ->  I2C or the board, not the software.
     Confirm: grep i2c_arm /boot/firmware/config.txt
  3. DAC is found but no button does anything  ->  wrong pin map. Run
     --probe-buttons; it prints a ready-to-paste --pins line.
  4. journalctl -u lightning-emulator -n 40 --no-pager

A wrong pin map gives a rig that starts cleanly, reports itself healthy and
never fires. That is the trap worth knowing about.
