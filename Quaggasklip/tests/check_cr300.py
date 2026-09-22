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

Several checks exist because the mistake they catch was actually made, at real
cost. Those are marked, so nobody removes them as pedantry.
"""
import json
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


print("=== the read: SerialIn, not SerialInRecord ===")
# SerialInRecord keyed on a BeginWord never framed a single record, even once the
# wiring was proven and all 70 bytes of a five record burst were confirmed
# arriving. It also made the read depend on the first byte, which is the one byte
# a waking port is most likely to drop.
ck("SerialInRecord is not used at all", "SerialInRecord" not in code,
   "it never framed anything, even with the bytes confirmed arriving")
ck("the read is SerialIn on ComC2_Rx",
   re.search(r'SerialIn\s*\(\s*LastRecord\s*,\s*ComC2_Rx\s*,', code) is not None)

# THE TRAP: TimeOut is in 0.01 s units and 0 means wait indefinitely for the
# terminator or the character limit, which would stall the scan.
_si = re.search(r'SerialIn\s*\(\s*LastRecord\s*,\s*ComC2_Rx\s*,\s*([^,]+),', code)
_timeout = _si.group(1).strip() if _si else None
ck("SerialIn TimeOut is not 0", _timeout not in (None, "0"),
   "0 means wait indefinitely and would stall the scan; units are 0.01 s")
ck("TimeOut is a small non-zero wait", _timeout == "1",
   "1 = 10 ms, long enough to collect a buffered record without blocking")

ck("terminator is LF as a numeric code", re.search(r'Const\s+LF\s*=\s*10', code) is not None,
   "numeric excludes the terminator; a string would include it")
ck("the read uses the LF constant",
   re.search(r'SerialIn\s*\([^)]*,\s*LF\s*,', code) is not None)
ck("the destination is cleared before every read",
   re.search(r'LastRecord\s*=\s*""\s*\n\s*SerialIn', code) is not None,
   "SerialIn leaves Dest alone when nothing arrives, so a stale record would "
   "otherwise be reprocessed every scan")

print()
print("=== lightning only: no health in storage ===")
for bad in ("PiCpuTempC", "PiRssiDbm", "StatusCount", "DetectorOnline",
            "MinutesSinceRecord"):
    ck("no %s variable" % bad, bad not in code)
ck('only "L," is logged, checking shape not just the first byte',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"L,"', code) is not None,
   'testing only "L" would also accept a corrupted "LL,1,2"')
ck('an "H," record is recognised explicitly',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"H,"', code) is not None)

# Bound the search to the H branch. An unbounded scan runs into the final Else.
_h = re.search(r'"H,"\s*Then(.*?)(?:\n\s*Else\b|\n\s*EndIf\b)', code, re.S)
_h_branch = _h.group(1) if _h else ""
ck("the H branch does not touch ParseErrorCount",
   "HealthRecordCount" in _h_branch and "ParseErrorCount" not in _h_branch,
   "routine health traffic must not accumulate in the fault counter")
ck("the H counter is live only, never sampled into a table",
   "HealthRecordCount" in code
   and not re.search(r'Sample\s*\([^)]*HealthRecordCount', code)
   and not re.search(r'Totalize\s*\([^)]*HealthRecordCount', code))
ck("ParseErrorCount covers a bad parse and an unrecognised letter",
   len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)) == 2,
   "increments: %d (expect 2)"
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
       "a raw record in the table would leak non-lightning text into storage")
    ck("exactly 3 stored fields", len(re.findall(r'\bSample\s*\(', body)) == 3)
    ck("pulse total is IEEE4, not FP2 (FP2 saturates at 7999)",
       "PulseCountTotal, IEEE4" in body)

dy = re.search(r'DataTable\s*\(\s*LightningDaily.*?EndTable', code, re.S)
ck("LightningDaily table found", dy is not None)
if dy:
    body = dy.group(0)
    ck("daily totalise is IEEE4", "PulseCountScan, IEEE4" in body)
    ck("daily has a 1 day interval",
       re.search(r'DataInterval\s*\(\s*0\s*,\s*1\s*,\s*Day', body) is not None)

print()
print("=== the parse ===")
ck("Parsed is dimensioned 2", "Parsed(2) As Float" in code)
ck("SplitStr asks for 2 values from the record",
   re.search(r'SplitStr\s*\(\s*Parsed\(1\)\s*,\s*LastRecord\s*,\s*","\s*,\s*2\s*,\s*0\s*\)',
             code) is not None)
ck("no Parsed(3) anywhere", "Parsed(3)" not in code)
ck("guard tests Parsed(1) and Parsed(2)",
   re.search(r'Parsed\(1\)\s*=\s*Parsed\(1\)\s+AND\s+Parsed\(2\)\s*=\s*Parsed\(2\)',
             code) is not None)
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
print("=== port and pulse configuration ===")
ck("ComC2_Rx at 9600, 8N1, 256 byte buffer",
   re.search(r'SerialOpen\s*\(\s*ComC2_Rx\s*,\s*9600\s*,\s*0\s*,\s*0\s*,\s*256\s*\)',
             code) is not None,
   "measured: ComC2_Rx delivers, Com1 delivered nothing on this unit")
ck("buffer flushed at start", "SerialFlush (ComC2_Rx)" in code)
ck("does not use the CR6 spelling ComC1", "ComC1" not in code,
   "CR300 compiler: ComC1 is not defined")
ck("does not open the pair as Com1", not re.search(r'\bCom1\b', code),
   "compiles, but SerialInChk read 0 every time on this unit")
ck("does not use PortPairConfig", "PortPairConfig" not in code,
   "CR300 compiler: PortPairConfig is not defined")
ck("PulseCount on P_SW, PConfig 2 switch closure",
   re.search(r'PulseCount\s*\(\s*PulseCountScan\s*,\s*1\s*,\s*P_SW\s*,\s*2\s*,\s*0\s*,\s*1\s*,\s*0\s*\)',
             code) is not None)

print()
print("=== the link cannot fail silently ===")
ck("the SerialOpen return value is captured",
   re.search(r'SerialOpenOK\s*=\s*SerialOpen\s*\(', code) is not None,
   "discarding it makes a refused port look identical to a cut wire")
ck("buffer depth is read before it is consumed",
   re.search(r'BytesWaiting\s*=\s*SerialInChk\s*\(\s*ComC2_Rx\s*\)', code) is not None)
ck("SerialInChk is read before SerialIn consumes the buffer",
   code.index("SerialInChk") < code.index("SerialIn ("))
# A snapshot is emptied by the read in the same scan, so it cannot distinguish
# "nothing arrived" from "arrived and was consumed". A high-water mark can, and it
# is what finally proved the BCM 26 wiring delivering all 70 bytes of a burst.
ck("buffer depth is accumulated, not just sampled",
   re.search(r'MaxBytesWaiting\s*=\s*BytesWaiting', code) is not None
   and re.search(r'BytesSeenTotal\s*=\s*BytesSeenTotal\s*\+', code) is not None,
   "MaxBytesWaiting above 0 proves bytes reached C2 even if nothing parsed")
ck("no diagnostic is sampled into a table",
   not re.search(r'Sample\s*\([^)]*SerialOpenOK', code)
   and not re.search(r'Sample\s*\([^)]*BytesWaiting', code)
   and not re.search(r'Sample\s*\([^)]*BytesSeenTotal', code))

print()
print("=== structure ===")
for kw in ("BeginProg", "EndProg"):
    ck("%s exactly once" % kw, len(re.findall(r'^\s*%s\s*$' % kw, code, re.M)) == 1)
ck("Scan and NextScan balanced",
   len(re.findall(r'\bScan\s*\(', code)) == len(re.findall(r'\bNextScan\b', code)))
ck("DataTable and EndTable balanced",
   len(re.findall(r'\bDataTable\s*\(', code)) == len(re.findall(r'\bEndTable\b', code)))
ck("two tables", len(re.findall(r'\bDataTable\s*\(', code)) == 2)
ck("both tables are called",
   "CallTable LightningEvents" in code and "CallTable LightningDaily" in code)
ck("daily table called unconditionally, not behind IfTime",
   re.search(r'CallTable LightningDaily', code) is not None
   and not re.search(r'IfTime[^\n]*\n\s*CallTable LightningDaily', code))

print()
print("=== no contamination from the unit this was copied from ===")
for bad in ("GWLD1", "GLENCORE", "WONDERKOP", "Wonderkop"):
    ck("no %s reference" % bad, bad not in src)
ck("site is QUAGGASKLIP", "Site: QUAGGASKLIP" in src)
ck("names the service that actually exists",
   "systemctl restart lightning-detector" in src
   and "systemctl restart quaggasklip" not in src)
ck("names the config file that actually exists",
   "lightning_config.json" in src and "quaggasklip_config.json" not in src)

print()
print("=== wiring notes name the terminals that actually work ===")
# Records on INT/BCM 26 and the pulse on RST/BCM 19. "TX" is BCM 14, shared with
# the USB HUB HAT's CP2102, and records sent there never arrived through three
# separate transmit methods.
ck("records go from BCM 26 to C2",
   re.search(r'BCM\s*26[^\n]*C2', src) is not None)
ck("the strike pulse goes from BCM 19 to P_SW",
   re.search(r'BCM\s*19[^\n]*P_SW', src) is not None)
ck("names the INT and RST terminals",
   '"INT"' in src and '"RST"' in src)
ck("warns against the TX terminal and BCM 14",
   re.search(r'NOT\s+"TX"', src) is not None and "BCM 14" in src,
   "BCM 14 is shared with the HAT's CP2102 bridge and is contended")
ck("no screw-block position claims", not re.search(r'TB[12]\s+pin\s+\d', src))
ck("covers the cable screen", "screen" in src.lower())

print()
print("=== attribution and language ===")
ck("names METRON (PTY) LTD", "METRON (PTY) LTD" in src)
ck("credits L.J. Esterhuizen", "L.J. Esterhuizen" in src)
ck("pure ASCII", all(ord(c) < 128 for c in src),
   "non-ascii: %r" % [c for c in src if ord(c) >= 128][:5])
ck("no tooling references",
   not re.findall(r'(?i)\bkiro\b|\bclaude\b|\bcopilot\b|\bchatgpt\b|\bLLM\b|generated by',
                  src))

print()
print("=== comment volume ===")
comment_lines = sum(1 for ln in lines if ln.strip().startswith("'"))
code_lines = sum(1 for ln in lines if ln.strip() and not ln.strip().startswith("'"))
ratio = comment_lines / max(code_lines, 1)
ck("comments no more than 1.5x the code", ratio <= 1.5,
   "%d comment / %d code lines = %.2f" % (comment_lines, code_lines, ratio))
# The ratio above is the real guard. This cap is only a backstop against the file
# becoming unreadable, and it has been raised deliberately rather than trimming
# explanation to fit a number.
ck("total under 250 lines", len(src.splitlines()) < 250,
   "%d lines" % len(src.splitlines()))

print()
print("=== agrees with the configuration that is on the unit ===")
cfg = json.load(open(CFG, encoding="utf-8"))
ck("campbell_uart_enabled is true", cfg.get("campbell_uart_enabled") is True)
ck("campbell_uart_baud 9600 matches SerialOpen",
   cfg.get("campbell_uart_baud") == 9600)
ck("campbell_uart_tx_pin 26 matches the INT terminal",
   cfg.get("campbell_uart_tx_pin") == 26, str(cfg.get("campbell_uart_tx_pin")))
ck("pulse_mirror_enabled is true", cfg.get("pulse_mirror_enabled") is True)
ck("pulse_mirror_pin 19 matches the RST terminal",
   cfg.get("pulse_mirror_pin") == 19)
ck("pulse width exceeds one scan, so PulseCount cannot miss it",
   cfg.get("pulse_mirror_width_ms", 0) >= 25,
   "%s ms against a %s ms scan"
   % (cfg.get("pulse_mirror_width_ms"),
      (re.search(r'Const\s+SCAN_MS\s*=\s*(\d+)', code) or [None, "?"])[1]))
ck("irq_pin is 6, the pin the LCO was measured on", cfg.get("irq_pin") == 6,
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
   cfg.get("alert_webhook_token") == "REDACTED" and not cfg.get("stratus_api_key"))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
