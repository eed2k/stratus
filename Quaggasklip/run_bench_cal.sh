#!/bin/bash
# ===========================================================================
#  Run the AS3935 bench calibration check with the detector safely stopped.
#
#  WHY THIS WRAPPER EXISTS
#    as3935_bench_cal.py needs exclusive use of SPI and the interrupt line, so
#    the detector service has to be stopped first. Do that by hand and a crash,
#    a Ctrl+C or a closed SSH session leaves a lightning detector switched off,
#    with nothing to say so. The trap below restarts it on every exit path.
#
#  USAGE
#    sudo ./run_bench_cal.sh              # report only
#    sudo ./run_bench_cal.sh --sweep      # plus the 16-step TUNE_CAP sweep
#    Any other arguments are passed straight through to as3935_bench_cal.py.
#
#  Nothing is written to the sensor or the config unless you pass --commit.
# ===========================================================================
set -uo pipefail

# The unit is called quaggasklip.service, which is what install.sh installs.
# Candidates are listed because this script was previously hardcoded to
# "lightning-detector", a name that does not exist on this unit, and the
# consequence was worse than a failed command:
#
#   systemctl is-active --quiet <nonexistent>  exits non-zero, exactly as it does
#   for a unit that exists but is stopped. So WAS_ACTIVE stayed "no", the script
#   printed a reassuring "not running", and then ran the calibration while the
#   REAL detector service still held /dev/spidev0.0 and the GPIO6 interrupt.
#   The calibration cannot work under those conditions, and nothing said why.
#
# So resolve the name against installed units, and treat "no unit found at all"
# as a hard error rather than as "stopped".
SERVICE=""
for candidate in quaggasklip quaggasklip-detector lightning-detector; do
    if systemctl list-unit-files "${candidate}.service" >/dev/null 2>&1 \
       && systemctl cat "${candidate}.service" >/dev/null 2>&1; then
        SERVICE="$candidate"
        break
    fi
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="${HERE}/as3935_bench_cal.py"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo $0 $*" >&2
    exit 1
fi

if [ ! -f "$TOOL" ]; then
    echo "Cannot find ${TOOL}" >&2
    exit 1
fi

if [ -z "$SERVICE" ]; then
    echo "Could not find the detector's systemd unit." >&2
    echo "Looked for: quaggasklip, quaggasklip-detector, lightning-detector" >&2
    echo >&2
    echo "Refusing to continue. If the detector is running under another name it" >&2
    echo "still holds SPI and the interrupt line, and the calibration would return" >&2
    echo "nonsense without saying why. Find the real name and set SERVICE:" >&2
    echo "  systemctl list-units --type=service | grep -i -e quagga -e lightning" >&2
    exit 1
fi
echo "Detector service: ${SERVICE}.service"

# Only restart what we actually stopped. If the service was already down when we
# arrived, leave it down: that is someone else's deliberate state.
WAS_ACTIVE=no
if systemctl is-active --quiet "$SERVICE"; then
    WAS_ACTIVE=yes
fi

restore() {
    local rc=$?
    echo
    if [ "$WAS_ACTIVE" = yes ]; then
        echo "Restarting ${SERVICE}..."
        if systemctl start "$SERVICE"; then
            sleep 2
            if systemctl is-active --quiet "$SERVICE"; then
                echo "${SERVICE} is running again."
            else
                echo "WARNING: ${SERVICE} did not come back up." >&2
                echo "         systemctl status ${SERVICE}" >&2
                echo "         journalctl -u ${SERVICE} -n 50" >&2
            fi
        else
            echo "WARNING: could not restart ${SERVICE}. THE DETECTOR IS DOWN." >&2
        fi
    else
        echo "${SERVICE} was not running before this check, so it was left alone."
    fi
    exit $rc
}
# EXIT covers a normal finish and set -e; INT and TERM cover Ctrl+C and a killed
# session. HUP covers the SSH connection dropping.
trap restore EXIT INT TERM HUP

if [ "$WAS_ACTIVE" = yes ]; then
    echo "Stopping ${SERVICE} so it releases SPI and the interrupt line..."
    systemctl stop "$SERVICE"
    # Give it a moment to close /dev/spidev and free the GPIO.
    sleep 2
else
    echo "${SERVICE} is not running."
fi

echo
python3 "$TOOL" "$@"
