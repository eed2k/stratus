"""SSH to the detector Pi and verify the whole chain end to end.

    python deploy/check_detector.py [host]

Defaults to the address discovered on the LAN. Uses the existing ed25519 key, so
nothing new is installed on the Pi.

The only thing that writes anywhere is the heartbeat test, which is telemetry:
the panel records liveness and a CPU sample and never raises an alert, so it
cannot send an SMS.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOST = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.5"
USER = "gwld1"
KEY = Path(os.environ["USERPROFILE"]) / ".ssh" / "pi_gwld1"

out: list[str] = []
checks: list[tuple[bool, str, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((ok, label, detail))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<46} {detail}")


client: paramiko.SSHClient | None = None


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if not KEY.is_file():
        raise SystemExit(f"private key not found: {KEY}")
    last = None
    for loader in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey):
        try:
            pkey = loader.from_private_key_file(str(KEY))
            c.connect(HOST, username=USER, pkey=pkey, timeout=25,
                      look_for_keys=False, allow_agent=False)
            return c
        except paramiko.PasswordRequiredException:
            raise SystemExit(f"{KEY} is passphrase-protected; unlock it first.")
        except Exception as exc:
            last = exc
    raise SystemExit(f"could not connect to {USER}@{HOST}: {last}")


def run(cmd: str, timeout: int = 90) -> str:
    assert client is not None
    _i, o, e = client.exec_command(cmd, timeout=timeout)
    a = o.read().decode(errors="replace")
    b = e.read().decode(errors="replace")
    o.channel.recv_exit_status()
    return (a + ("\n" + b if b.strip() else "")).strip()


def main() -> None:
    global client
    say("#" * 76)
    say(f"# Detector check: {USER}@{HOST}")
    say("#" * 76)
    client = connect()
    say(f"  connected with {KEY.name}")

    section("1. Identity and uptime")
    say("  " + run("hostname; uptime; cat /proc/device-tree/model 2>/dev/null | tr -d '\\0'; echo"))

    section("2. SPI - the AS3935 bus (shipped commented out, so this is the one)")
    spid = run("ls -1 /dev/spidev* 2>/dev/null || echo NONE")
    say("  " + spid.replace("\n", "\n  "))
    ck("spidev0.0" in spid, "/dev/spidev0.0 exists", "SPI enabled" if "spidev0.0" in spid
       else "SPI NOT enabled - detector cannot read the sensor")
    cfg = run("grep -E '^[[:space:]]*dtparam=spi=on' /boot/firmware/config.txt "
              "|| grep -E '^[[:space:]]*dtparam=spi=on' /boot/config.txt || echo MISSING")
    ck("dtparam=spi=on" in cfg, "config.txt has an active dtparam=spi=on", cfg.strip())

    section("3. Deploy log")
    dep = run("journalctl -t gwld1-deploy --no-pager -n 40 2>/dev/null || echo NOLOG")
    say("  " + dep.replace("\n", "\n  ") if dep.strip() else "  (empty)")
    ck("deploy complete" in dep, "install.sh reached 'deploy complete'")
    ck("WARN dependency install failed" not in dep, "dependency install did not fail")

    section("4. Python dependencies the detector hard-requires")
    for mod, pkg in (("RPi.GPIO", "python3-rpi.gpio"), ("spidev", "python3-spidev")):
        r = run(f"python3 -c 'import {mod}; print(\"ok\")' 2>&1")
        ck(r.strip().endswith("ok"), f"import {mod}", r.strip()[:60] or f"install {pkg}")
    r = run("command -v pigpiod >/dev/null && echo yes || echo no")
    ck(r.strip() == "yes", "pigpiod installed", r.strip())
    r = run("systemctl is-active pigpiod 2>/dev/null || true")
    ck(r.strip() == "active", "pigpiod running", r.strip())

    section("5. Detector service")
    st = run("systemctl is-active lightning-detector 2>/dev/null || true")
    en = run("systemctl is-enabled lightning-detector 2>/dev/null || true")
    ck(st.strip() == "active", "lightning-detector active", st.strip())
    ck(en.strip() == "enabled", "enabled at boot", en.strip())
    say()
    say("  last 30 log lines:")
    say("  " + run("journalctl -u lightning-detector --no-pager -n 30 2>/dev/null "
                   "|| echo '(no journal access)'").replace("\n", "\n  "))

    section("6. Detector configuration on the Pi")
    for key in ("station_id", "alert_webhook_url", "campbell_uart_enabled",
                "pulse_mirror_enabled", "heartbeat_webhook_interval"):
        v = run(f"grep '\"{key}\"' /home/gwld1/lightning_config.json || echo missing")
        say(f"    {v.strip()}")
    url = run("grep alert_webhook_url /home/gwld1/lightning_config.json")
    ck("adminpanel.stratusweather.co.za/gwld1" in url,
       "webhook points at the live panel",
       "dynv6 (dead host)" if "dynv6" in url else "correct")

    section("7. Peripherals that should be OFF")
    bt = run("systemctl is-active bluetooth 2>/dev/null || echo inactive")
    ck(bt.strip() != "active", "bluetooth off", bt.strip())
    kms = run("grep -E '^[[:space:]]*dtoverlay=vc4-kms' "
              "/boot/firmware/config.txt || echo none")
    uart = run("grep -E '^[[:space:]]*enable_uart' "
               "/boot/firmware/config.txt || echo absent")
    gov = run("cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor "
              "2>/dev/null || echo n/a")
    clk = run("vcgencmd measure_clock arm 2>/dev/null | cut -d= -f2 || echo n/a")
    tmp = run("vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || echo n/a")
    say(f"    hdmi/kms overlay: {kms.strip()}")
    say(f"    uart (console)  : {uart.strip()}")
    say(f"    governor        : {gov.strip()}")
    say(f"    arm clock       : {clk.strip()}")
    say(f"    core temp       : {tmp.strip()}")
    thr = run("vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo n/a")
    ck(thr.strip() in ("0x0", "n/a"), "no undervoltage or throttling", thr.strip())

    section("8. Send a heartbeat to the panel now")
    say("  Telemetry only - the panel records liveness and a CPU sample and")
    say("  never dispatches an alert, so this cannot send an SMS.")
    say()
    hb = run("python3 /home/gwld1/send_test_heartbeat.py 2>&1 || true", timeout=120)
    say("  " + hb.replace("\n", "\n  "))
    ck("HTTP 200" in hb, "panel accepted the heartbeat",
       "200" if "HTTP 200" in hb else "see output above")

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks) - len(bad)} of {len(checks)} checks passed")
    if bad:
        say()
        for _, label, detail in bad:
            say(f"    FAIL  {label}  {detail}")
    else:
        say("  The detector is installed, reading the sensor bus, running, and")
        say("  reporting to the panel.")

    client.close()
    Path("backups").mkdir(exist_ok=True)
    Path("backups/_detector_check.txt").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except SystemExit as e:
        say(str(e))
        Path("backups/_detector_check.txt").write_text("\n".join(out), encoding="utf-8")
        raise
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_detector_check.txt").write_text(
            "\n".join(out) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
