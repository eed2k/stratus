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

SERVICE="lightning-detector"
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
