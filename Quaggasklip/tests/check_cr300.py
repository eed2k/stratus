# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  Static review of the CR300 logger program before upload.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
"""Static consistency check on QK_CR300_Lightning.CR300.

A CRBasic program cannot be unit tested without the logger, so this checks the
properties that would otherwise only surface as a silent failure in the field.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.normpath(os.path.join(HERE, "..", "campbell", "QK_CR300_Lightning.CR300"))
# Checked against the configuration that is actually on the unit, not against
# ../quaggasklip_config.json, which belongs to a build that is not deployed.
# See ../deployed/README.md.
CFG = os.path.normpath(os.path.join(HERE, "..", "deployed", "lightning_config.json"))

src = open(P, encoding="utf-8").read()
lines = src.split("\n")

# CRBasic comments start with an apostrophe. Strip them so assertions are about
# code rather than prose.
code = "\n".join(ln.split("'", 1)[0] for ln in lines if ln.split("'", 1)[0].strip())

passed = failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1


print("=== lightning only: no heartbeat anywhere in storage ===")
# The requirement: health goes to the admin panel, the logger records lightning.
# The unit still emits an H record once a day, because the deployed build has no
# flag to silence it, so the program must recognise and drop it rather than
# pretend it cannot arrive.
ck("no PiCpuTempC variable", "PiCpuTempC" not in code)
ck("no PiRssiDbm variable", "PiRssiDbm" not in code)
ck("no StatusCount variable", "StatusCount" not in code)
ck("no DetectorOnline flag", "DetectorOnline" not in code)
ck("no MinutesSinceRecord", "MinutesSinceRecord" not in code)
ck('only "L," records are accepted, checking shape not just first byte',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"L,"', code) is not None)
ck('an "H," record is recognised explicitly',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"H,"', code) is not None)
# Bound the search to the H branch itself. An unbounded scan would run straight
# past it into the final Else and find that branch's ParseErrorCount increment.
_h = re.search(r'"H,"\s*Then(.*?)(?:\n\s*Else\b|\n\s*EndIf\b)', code, re.S)
_h_branch = _h.group(1) if _h else ""
ck("the H branch does not touch ParseErrorCount",
   "HealthRecordCount" in _h_branch and "ParseErrorCount" not in _h_branch,
   "routine health traffic must not accumulate in the fault counter")
ck("the H counter is live only, never sampled into a table",
   "HealthRecordCount" in code
   and not re.search(r'Sample\s*\([^)]*HealthRecordCount', code)
   and not re.search(r'Totalize\s*\([^)]*HealthRecordCount', code))
ck("a genuinely unrecognised record is still counted",
   len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)) == 2,
   "ParseErrorCount increments: %d (expect 2: bad parse, and unrecognised)"
   % len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)))

print()
print("=== what the tables store ===")
ev = re.search(r'DataTable\s*\(\s*LightningEvents.*?EndTable', code, re.S)
ck("LightningEvents table found", ev is not None)
if ev:
    body = ev.group(0)
    ck("stores distance", "LastDistanceKm" in body)
    ck("stores energy", "LastEnergy" in body)
    ck("stores the pulse count", "PulseCountTotal" in body)
    ck("does NOT store the raw record string", "LastRecord" not in body,
       "LastRecord in the table would leak any non-lightning text into storage")
    ck("exactly 3 stored fields", len(re.findall(r'\bSample\s*\(', body)) == 3,
       "Sample() count: %d" % len(re.findall(r'\bSample\s*\(', body)))
    ck("pulse total is IEEE4, not FP2 (FP2 saturates at 7999)",
       "PulseCountTotal, IEEE4" in body)

dy = re.search(r'DataTable\s*\(\s*LightningDaily.*?EndTable', code, re.S)
ck("LightningDaily table found", dy is not None)
if dy:
    body = dy.group(0)
    ck("daily totalise is IEEE4", "PulseCountScan, IEEE4" in body)
    ck("daily has a 1 day interval", re.search(r'DataInterval\s*\(\s*0\s*,\s*1\s*,\s*Day', body) is not None)

print()
print("=== the parse, which was silently wrong before ===")
ck("Parsed is dimensioned 2", "Parsed(2) As Float" in code)
ck("SplitStr asks for 2 values",
   re.search(r'SplitStr\s*\(\s*Parsed\(1\)\s*,\s*LastRecord\s*,\s*","\s*,\s*2\s*,\s*0\s*\)', code) is not None)
ck("no Parsed(3) anywhere", "Parsed(3)" not in code)
ck("guard tests Parsed(1) and Parsed(2)",
   re.search(r'Parsed\(1\)\s*=\s*Parsed\(1\)\s+AND\s+Parsed\(2\)\s*=\s*Parsed\(2\)', code) is not None)
ck("distance comes from Parsed(1)", "LastDistanceKm = Parsed(1)" in code)
ck("energy comes from Parsed(2)", "LastEnergy = Parsed(2)" in code)
ck("-1 is excluded from closest-of-day",
   re.search(r'If\s+LastDistanceKm\s*>=\s*0\s+Then', code) is not None)

print()
print("=== pulse row cannot be lost or doubled ===")
ck("EventRowWritten declared", "Dim EventRowWritten As Boolean" in code)
ck("cleared each scan", "EventRowWritten = False" in code)
ck("set when a strike row is written", "EventRowWritten = True" in code)
ck("pulse-only row gates on EventRowWritten", "Not EventRowWritten" in code)

print()
print("=== serial and pulse configuration ===")
ck("ComC2_Rx at 9600, 8N1, 256 byte buffer",
   re.search(r'SerialOpen\s*\(\s*ComC2_Rx\s*,\s*9600\s*,\s*0\s*,\s*0\s*,\s*256\s*\)', code) is not None)
ck("buffer flushed at start", "SerialFlush (ComC2_Rx)" in code)
ck("EndWord 3338 is CR LF", "3338" in code and 0x0D0A == 3338)
ck("SerialInRecord option 10, oldest record",
   re.search(r'SerialInRecord\s*\(\s*ComC2_Rx\s*,\s*LastRecord\s*,\s*0\s*,\s*0\s*,\s*3338\s*,\s*BytesReturned\s*,\s*10\s*\)', code) is not None)
ck("PulseCount on P_SW, PConfig 2 switch closure",
   re.search(r'PulseCount\s*\(\s*PulseCountScan\s*,\s*1\s*,\s*P_SW\s*,\s*2\s*,\s*0\s*,\s*1\s*,\s*0\s*\)', code) is not None)

print()
print("=== structure ===")
for kw in ("BeginProg", "EndProg"):
    ck("%s exactly once" % kw, len(re.findall(r'^\s*%s\s*$' % kw, code, re.M)) == 1)
ck("Scan and NextScan balanced",
   len(re.findall(r'\bScan\s*\(', code)) == len(re.findall(r'\bNextScan\b', code)))
ck("DataTable and EndTable balanced",
   len(re.findall(r'\bDataTable\s*\(', code)) == len(re.findall(r'\bEndTable\b', code)))
ck("two tables", len(re.findall(r'\bDataTable\s*\(', code)) == 2)
ck("both tables are called", "CallTable LightningEvents" in code and "CallTable LightningDaily" in code)
ck("daily table called unconditionally, not behind IfTime",
   re.search(r'CallTable LightningDaily', code) is not None
   and not re.search(r'IfTime[^\n]*\n\s*CallTable LightningDaily', code))

print()
print("=== no contamination from the unit this was copied from ===")
for bad in ("GWLD1", "GLENCORE", "WONDERKOP", "Wonderkop"):
    ck("no %s reference" % bad, bad not in src)
ck("site is QUAGGASKLIP", "Site: QUAGGASKLIP" in src)
# The deployed service really is lightning-detector. A note telling the field
# technician to restart a unit called quaggasklip would simply fail.
ck("names the service that actually exists",
   "systemctl restart lightning-detector" in src
   and "systemctl restart quaggasklip" not in src)
ck("names the config file that actually exists",
   "lightning_config.json" in src and "quaggasklip_config.json" not in src)

print()
print("=== wiring notes name the real transmit pin ===")
ck("no screw-block position claims",
   not re.search(r'TB[12]\s+pin\s+\d', src))
ck("records go from BCM 26 to C2",
   re.search(r'BCM\s*26[^\n]*C2', src) is not None)
ck("the strike pulse goes from BCM 19 to P_SW",
   re.search(r'BCM\s*19[^\n]*P_SW', src) is not None)
ck("gives the physical header pins", "pin 37" in src and "pin 35" in src)
ck("warns against BCM 14 and the hardware UART",
   "BCM 14" in src and "hardware UART" in src,
   "the old note sent the wire to BCM 14, where nothing transmits")
ck("does not claim the Click socket carries these signals",
   re.search(r'(?i)sockets?\s+are\s+not\s+in\s+this\s+path', src) is not None)
ck("covers the cable screen", "screen" in src.lower())

print()
print("=== attribution and language ===")
ck("names METRON (PTY) LTD", "METRON (PTY) LTD" in src)
ck("credits L.J. Esterhuizen", "L.J. Esterhuizen" in src)
ck("pure ASCII", all(ord(c) < 128 for c in src),
   "non-ascii: %r" % [c for c in src if ord(c) >= 128][:5])
ck("no tooling references",
   not re.findall(r'(?i)\bkiro\b|\bclaude\b|\bcopilot\b|\bchatgpt\b|\bLLM\b|generated by', src))

print()
print("=== comment volume, kept to basics ===")
comment_lines = sum(1 for ln in lines if ln.strip().startswith("'"))
code_lines = sum(1 for ln in lines if ln.strip() and not ln.strip().startswith("'"))
ratio = comment_lines / max(code_lines, 1)
ck("comments no more than 1.5x the code", ratio <= 1.5,
   "%d comment / %d code lines = %.2f" % (comment_lines, code_lines, ratio))
ck("total under 200 lines", len(lines) < 200, "%d lines" % len(lines))

print()
print("=== agrees with the configuration that is on the unit ===")
import json

cfg = json.load(open(CFG, encoding="utf-8"))

ck("campbell_uart_enabled is true", cfg.get("campbell_uart_enabled") is True)
ck("campbell_uart_baud 9600 matches SerialOpen",
   cfg.get("campbell_uart_baud") == 9600)
ck("campbell_uart_tx_pin 26 matches the wiring note",
   cfg.get("campbell_uart_tx_pin") == 26, str(cfg.get("campbell_uart_tx_pin")))
ck("pulse_mirror_enabled is true, so the P_SW wire carries something",
   cfg.get("pulse_mirror_enabled") is True)
ck("pulse_mirror_pin 19 matches the wiring note",
   cfg.get("pulse_mirror_pin") == 19)
ck("pulse width exceeds one scan, so PulseCount cannot miss it",
   cfg.get("pulse_mirror_width_ms", 0) >= 25,
   "%s ms against a %s ms scan"
   % (cfg.get("pulse_mirror_width_ms"),
      (re.search(r'Const\s+SCAN_MS\s*=\s*(\d+)', code) or [None, "?"])[1]))
ck("irq_pin is 6, the pin the LCO was measured on",
   cfg.get("irq_pin") == 6,
   "17 meant the detector never saw an interrupt")
ck("tune_cap is 9, the swept optimum", cfg.get("tune_cap") == 9)
ck("the broken daily antenna check is disabled",
   cfg.get("antenna_check_enabled") is False,
   "it reads 0 Hz and walks tune_cap down a step a day")
ck("campbell heartbeat reduced to once a day",
   cfg.get("campbell_heartbeat_interval") == 86400)
ck("the panel still gets an hourly heartbeat",
   cfg.get("heartbeat_webhook_interval") == 3600)
ck("no secret committed",
   cfg.get("alert_webhook_token") == "REDACTED"
   and not cfg.get("stratus_api_key"))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
