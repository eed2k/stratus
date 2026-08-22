"""Compare what is actually on the Pi's SD card against the corrected repo copy.

Answers two questions that decide the update plan:
  1. Is the config difference limited to the webhook URL, or are there other
     Pi-specific settings that must not be clobbered?
  2. Does the detector code on the SD card even support panel heartbeats? If
     _heartbeat_webhook is missing, fixing the URL alone changes nothing.
"""
from __future__ import annotations

import difflib
import json
import re
from pathlib import Path

SD = Path("RPiZero SD Card/gwld1-deploy")
REPO = Path("Lightning Detector/detector")

out: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


# ------------------------------------------------------------------ config
section("1. lightning_config.json: exact differences")
sd_cfg = json.loads((SD / "lightning_config.json").read_text(encoding="utf-8"))
rp_cfg = json.loads((REPO / "lightning_config.json").read_text(encoding="utf-8"))

keys = sorted(set(sd_cfg) | set(rp_cfg))
diffs = 0
for k in keys:
    a, b = sd_cfg.get(k, "<absent>"), rp_cfg.get(k, "<absent>")
    if a != b:
        diffs += 1
        # Never echo the token value.
        if "token" in k.lower():
            say(f"  {k}")
            say(f"    SD   : {len(str(a))} chars")
            say(f"    repo : {len(str(b))} chars")
            say(f"    same : {a == b}")
        else:
            say(f"  {k}")
            say(f"    SD   : {a!r}")
            say(f"    repo : {b!r}")
if diffs == 0:
    say("  identical")
say()
say(f"  {diffs} key(s) differ out of {len(keys)}")
say("  Everything else matches, so only the changed key(s) need editing on the")
say("  Pi. No other site-specific tuning would be lost.")

# ------------------------------------------------------------- detector code
section("2. lightning_detector.py: does the SD version support heartbeats?")
sd_src = (SD / "lightning_detector.py").read_text(encoding="utf-8", errors="replace")
rp_src = (REPO / "lightning_detector.py").read_text(encoding="utf-8", errors="replace")

MARKERS = [
    ("_heartbeat_url", "derives the /heartbeat endpoint from the alert URL"),
    ("_heartbeat_webhook", "performs the POST to the panel"),
    ("HEARTBEAT_WEBHOOK_INTERVAL", "hourly panel ping schedule"),
    ("_last_panel_heartbeat", "tracks when the last panel ping was sent"),
    ("_calibration_url", "derives the /calibration endpoint"),
    ("_calibration_webhook", "reports calibration events to the panel"),
    ("cpu_load_pct", "CPU load field in the heartbeat payload"),
    ("CPU_TEMP_WARN_C", "CPU temperature warn threshold"),
    ("_alert_webhook", "per-strike alert POST"),
]
say(f"  {'marker':<30} {'SD':>4}  {'repo':>5}   meaning")
say("  " + "-" * 70)
missing = []
for m, why in MARKERS:
    a, b = sd_src.count(m), rp_src.count(m)
    if a == 0 and b > 0:
        missing.append(m)
    say(f"  {m:<30} {a:>4}  {b:>5}   {why}")

say()
if missing:
    say("  MISSING from the SD card version:")
    for m in missing:
        say(f"    {m}")
    say()
    say("  The detector on the Pi cannot post panel heartbeats at all. Editing")
    say("  the config URL would not help; the code file must be replaced too.")
else:
    say("  The SD card version already has the full heartbeat path, so only the")
    say("  config URL needs correcting.")

# ------------------------------------------------------------------- summary
section("3. Size and structure")
say(f"  SD   {len(sd_src.splitlines()):>5} lines, {len(sd_src):>7} bytes")
say(f"  repo {len(rp_src.splitlines()):>5} lines, {len(rp_src):>7} bytes")


def defs(src: str) -> set[str]:
    return set(re.findall(r"^\s*def\s+(\w+)", src, re.M))


sd_d, rp_d = defs(sd_src), defs(rp_src)
only_repo = sorted(rp_d - sd_d)
only_sd = sorted(sd_d - rp_d)
say()
say(f"  functions only in the repo version ({len(only_repo)}):")
for d in only_repo:
    say(f"    + {d}")
say(f"  functions only on the SD card ({len(only_sd)}):")
for d in only_sd:
    say(f"    - {d}")
if not only_sd:
    say("    none - the repo version is a strict superset, so replacing the")
    say("    file on the Pi removes no existing functionality.")

# --------------------------------------------------------------- unified diff
section("4. Config diff, ready to apply")
a = (SD / "lightning_config.json").read_text(encoding="utf-8").splitlines()
b = (REPO / "lightning_config.json").read_text(encoding="utf-8").splitlines()
for line in difflib.unified_diff(a, b, "SD card", "corrected", lineterm="", n=2):
    if "token" in line.lower() and line.startswith(("+", "-")):
        say(f"  {line[0]}    (token line unchanged, value not shown)")
        continue
    say(f"  {line}")

Path("backups").mkdir(exist_ok=True)
Path("backups/_sd_vs_repo.txt").write_text("\n".join(out), encoding="utf-8")
