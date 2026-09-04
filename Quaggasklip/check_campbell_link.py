#!/usr/bin/env python3
# ===========================================================================
#  Campbell UART link checker
# ===========================================================================
#
#  Confirms the Terminal 2 Click path works before the detector is trusted with
#  it, and produces exactly the records the CRBasic program expects, so the
#  logger's tables can be watched filling up.
#
#  MODES
#    --loopback   TX and RX jumpered together on the Terminal 2 Click screw
#                 terminals. Proves the Pi's UART is alive and correctly
#                 configured with no logger present. Do this first, on the bench.
#    --send       Send one L record and one H record to a connected logger, then
#                 report anything it says back.
#    --listen     Print whatever arrives, for watching a logger that transmits.
#
#  USAGE
#      python3 check_campbell_link.py --loopback
#      python3 check_campbell_link.py --send
#      python3 check_campbell_link.py --listen --seconds 30
#
#  Sends nothing anywhere except the serial port.
# ===========================================================================

import argparse
import sys
import time

try:
    import serial
except ImportError:
    sys.exit("pyserial not available. Install with: sudo apt install python3-serial")


def open_port(port, baud, write_timeout):
    """Open the UART with the settings the CRBasic side expects: 9600 8N1."""
    try:
        return serial.Serial(port=port, baudrate=baud,
                             bytesize=serial.EIGHTBITS,
                             parity=serial.PARITY_NONE,
                             stopbits=serial.STOPBITS_ONE,
                             timeout=0, write_timeout=write_timeout)
    except Exception as e:
        print("Could not open %s: %s" % (port, e))
        print()
        print("The usual causes, in order:")
        print("  1. The serial console still owns the port.")
        print("       sudo raspi-config  ->  Interface Options  ->  Serial Port")
        print("       login shell over serial: NO,  hardware enabled: YES")
        print("  2. enable_uart=1 is missing from /boot/firmware/config.txt")
        print("     (older images: /boot/config.txt).")
        print("  3. This user is not in the dialout group:")
        print("       sudo usermod -aG dialout $USER   (then log out and back in)")
        sys.exit(1)


def drain(ser, seconds):
    """Collect and return whatever arrives within `seconds`."""
    buf = bytearray()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            waiting = ser.in_waiting
            if waiting:
                buf.extend(ser.read(waiting))
        except Exception as e:
            print("  read error: %s" % e)
            break
        time.sleep(0.02)
    return bytes(buf)


def main():
    ap = argparse.ArgumentParser(description="Check the Campbell UART link.")
    ap.add_argument("--port", default="/dev/serial0")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--write-timeout", type=float, default=0.5)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--loopback", action="store_true",
                      help="TX jumpered to RX: proves the UART itself works")
    mode.add_argument("--send", action="store_true",
                      help="send one strike record and one status record")
    mode.add_argument("--listen", action="store_true",
                      help="print everything received")
    args = ap.parse_args()

    print("Campbell link check on %s @ %d baud 8N1" % (args.port, args.baud))
    ser = open_port(args.port, args.baud, args.write_timeout)
    print("Port open.")
    print()

    try:
        if args.loopback:
            # A distinctive payload, so a stale byte in the buffer cannot be
            # mistaken for a successful loopback.
            probe = "LOOPBACK-%d\r\n" % int(time.time())
            try:
                ser.reset_input_buffer()
            except Exception:
                pass
            print("Sending: %s" % probe.strip())
            ser.write(probe.encode("ascii"))
            ser.flush()
            got = drain(ser, 2.0).decode("ascii", "replace")
            print("Received: %s" % (got.strip() or "(nothing)"))
            print()
            if probe.strip() in got:
                print("PASS - the UART transmits and receives.")
                print("       Remove the jumper and wire TX to the logger's RX.")
                return 0
            print("FAIL - the sent line did not come back.")
            print("Check that TX and RX are jumpered on the Terminal 2 Click,")
            print("and that the port really is the hardware UART: on a Zero W")
            print("/dev/serial0 is the mini-UART unless dtoverlay=disable-bt")
            print("is set, and the mini-UART's baud rate drifts with the core")
            print("clock.")
            return 1

        if args.send:
            # Byte-for-byte what the detector sends, so the logger's parser is
            # exercised exactly as it will be in service.
            for record in ("L,7,850000\r\n", "H,44.5,-61\r\n"):
                print("Sending: %s" % record.strip())
                ser.write(record.encode("ascii"))
                ser.flush()
                time.sleep(0.3)
            print()
            print("Sent. On the logger, expect LightningRecordCount to increase")
            print("by one and LastLightningDistanceKm to read 7.")
            print()
            print("Listening %.0fs for any reply..." % args.seconds)
            got = drain(ser, args.seconds).decode("ascii", "replace")
            print("Received: %s" % (got.strip() or "(nothing, which is normal:"
                                                  " the logger program does not"
                                                  " reply)"))
            return 0

        print("Listening %.0fs..." % args.seconds)
        got = drain(ser, args.seconds).decode("ascii", "replace")
        if got.strip():
            for line in got.splitlines():
                if line.strip():
                    print("  %s" % line.strip())
        else:
            print("  (nothing received)")
        return 0
    finally:
        try:
            ser.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
