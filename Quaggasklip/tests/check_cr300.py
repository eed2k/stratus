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
print("=== lightning only: no health anywhere, not even live ===")
for bad in ("PiCpuTempC", "PiRssiDbm", "StatusCount", "DetectorOnline",
            "MinutesSinceRecord", "HealthRecordCount"):
    ck("no %s variable" % bad, bad not in code)

# THE TRAP: Left(LastRecord,2) = "L," rejected every record while all 70 bytes of
# a five record burst were confirmed arriving, which means the string did not
# begin at "L,". Left cannot see past a stray leading byte and a bit-banged line
# has no UART to resynchronise it.
ck('the record is located with InStr, not tested with Left',
   re.search(r'LPos\s*=\s*InStr\s*\(\s*1\s*,\s*LastRecord\s*,\s*"L,"\s*,\s*2\s*\)',
             code) is not None,
   'Left(...)="L," rejected all 5 of 5 records with all 70 bytes confirmed')
ck("InStr SearchOption is 2, the whole substring",
   re.search(r'InStr\s*\([^)]*"L,"\s*,\s*2\s*\)', code) is not None,
   'option 3 would match a bare "L" or a lone comma')
ck("the parse is gated on LPos being found",
   re.search(r'If\s+LPos\s*>\s*0\s+AND', code) is not None)

# A fragment stored as a real strike is corrupt data that looks reasonable, which
# is worse than a rejected record.
ck("a complete record is proved by its trailing CR",
   re.search(r'Mid\s*\(\s*LastRecord\s*,\s*RecLen\s*,\s*1\s*\)\s*=\s*CHR\s*\(\s*CR_CODE\s*\)',
             code) is not None,
   'without it a split record reads as "L,40,123" and stores as a real strike')
ck("CR_CODE is 13", re.search(r'Const\s+CR_CODE\s*=\s*13', code) is not None)

# The detector no longer transmits health at all: CAMPBELL_HEARTBEAT_ENABLED is
# false, so no "H," record can ever arrive. Handling for it was removed rather
# than left as dead code, which means an H record would now be counted as a parse
# error. That is correct: if one appears, the detector is misconfigured and we
# want to see it rather than have it silently absorbed.
ck("no health handling remains in the logger",
   '"H,"' not in code and "HealthRecordCount" not in code,
   "the detector sends none, so the branch was dead code")
ck("ParseErrorCount covers a bad parse and an unrecognised record",
   len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)) == 2,
   "increments: %d (expect 2)"
   % len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)))

print()
print("=== no bearing and no position: the sensor cannot measure either ===")
# A single-antenna AS3935 gives distance and energy. Any direction field would be
# a fabricated number, and site position does not belong on the wire.
for bad in ("Bearing", "Azimuth", "Direction", "Heading",
            "Latitude", "Longitude", "SiteLat", "SiteLon"):
    ck("no %s variable" % bad, not re.search(r'\b%s\b' % bad, code))
# The prose explaining why lives in deployed/README.md, asserted further down.
# Here we only require that no bearing or position field exists in the code.

print()
print("=== what is stored: distance, energy, timestamp. Nothing else ===")
ev = re.search(r'DataTable\s*\(\s*LightningEvents.*?EndTable', code, re.S)
ck("LightningEvents table found", ev is not None)
if ev:
    body = ev.group(0)
    ck("stores distance", "LastDistanceKm" in body)
    ck("stores energy", "LastEnergy" in body)
    ck("exactly 2 stored fields, the timestamp being implicit",
       len(re.findall(r'\bSample\s*\(', body)) == 2,
       "found %d" % len(re.findall(r'\bSample\s*\(', body)))
    ck("does NOT store the raw record string", "LastRecord" not in body,
       "a raw record in the table would leak non-lightning text into storage")
    ck("does NOT store the pulse count", "PulseCount" not in body,
       "the pulse mirror is a live cross-check, not stored data")
    ck("no aggregate in the event table",
       not re.search(r'Totalize|Maximum|Minimum|Average', body))

# The brief is distance, energy and timestamp. A daily summary is derivable from
# the stored rows, so keeping one here would mean two places that can disagree.
ck("there is no LightningDaily table",
   re.search(r'DataTable\s*\(\s*LightningDaily', code) is None)
for bad in ("StrikesToday", "ClosestTodayKm", "MaxEnergyToday", "PulseCountScan"):
    ck("no %s variable" % bad, bad not in code)
ck("exactly one DataTable", len(re.findall(r'\bDataTable\s*\(', code)) == 1,
   "found %d" % len(re.findall(r'\bDataTable\s*\(', code)))

print()
print("=== the parse ===")
ck("Parsed is dimensioned 2", "Parsed(2) As Float" in code)
# Split the payload, not the whole record: a digit in any leading rubbish would
# otherwise be read as the distance.
ck("SplitStr runs on the payload after \"L,\", not the raw record",
   re.search(r'SplitStr\s*\(\s*Parsed\(1\)\s*,\s*Payload\s*,\s*""\s*,\s*2\s*,\s*0\s*\)',
             code) is not None)
ck("the payload starts after the located \"L,\"",
   re.search(r'Payload\s*=\s*Mid\s*\(\s*LastRecord\s*,\s*LPos\s*\+\s*2\s*,', code)
   is not None)
ck("no Parsed(3) anywhere", "Parsed(3)" not in code)
ck("guard tests Parsed(1) and Parsed(2)",
   re.search(r'Parsed\(1\)\s*=\s*Parsed\(1\)\s+AND\s+Parsed\(2\)\s*=\s*Parsed\(2\)',
             code) is not None)
ck("distance comes from Parsed(1)", "LastDistanceKm = Parsed(1)" in code)
ck("energy comes from Parsed(2)", "LastEnergy = Parsed(2)" in code)

print()
print("=== one row per accepted record, and none otherwise ===")
# A pulse-only row would carry the previous strike's distance and energy, which is
# worse than no row: it is plausible-looking corrupt data.
ck("exactly one CallTable",
   len(re.findall(r'CallTable\s+LightningEvents', code)) == 1,
   "found %d" % len(re.findall(r'CallTable\s+LightningEvents', code)))
ck("the row is written only inside the NAN guard",
   re.search(r'StrikeCount\s*=\s*StrikeCount\s*\+\s*1\s*\n\s*CallTable\s+LightningEvents',
             code) is not None)
ck("no pulse-only row", "EventRowWritten" not in code,
   "it would store the previous strike's values against a new timestamp")

print()
print("=== port and pulse configuration ===")
# Format 3 is binary 8N1 with PakBus off. Format 0 is also 8N1 but leaves PakBus
# running on this same port and filters nulls and every character above 127, which
# makes it both a contender for corruption and a destroyer of the evidence.
ck("ComC2_Rx at 9600, format 3, 256 byte buffer",
   re.search(r'SerialOpen\s*\(\s*ComC2_Rx\s*,\s*9600\s*,\s*3\s*,\s*0\s*,\s*256\s*\)',
             code) is not None,
   "measured: ComC2_Rx delivers, Com1 delivered nothing on this unit")
ck("does not use format 0",
   re.search(r'SerialOpen\s*\([^)]*,\s*0\s*,\s*0\s*,\s*256', code) is None,
   "format 0 filters characters above 127 while hunting for PakBus frames")
ck("buffer flushed at start", "SerialFlush (ComC2_Rx)" in code)
ck("does not use the CR6 spelling ComC1", "ComC1" not in code,
   "CR300 compiler: ComC1 is not defined")
ck("does not open the pair as Com1", not re.search(r'\bCom1\b', code),
   "compiles, but SerialInChk read 0 every time on this unit")
ck("does not use PortPairConfig", "PortPairConfig" not in code,
   "CR300 compiler: PortPairConfig is not defined")
ck("PulseCount on P_SW, PConfig 2 switch closure",
   re.search(r'PulseCount\s*\(\s*PulseScan\s*,\s*1\s*,\s*P_SW\s*,\s*2\s*,\s*0\s*,\s*1\s*,\s*0\s*\)',
             code) is not None)

print()
print("=== the link cannot fail silently ===")
ck("the SerialOpen return value is captured",
   re.search(r'SerialOpenOK\s*=\s*SerialOpen\s*\(', code) is not None,
   "discarding it makes a refused port look identical to a cut wire")
ck("parse failures are counted",
   re.search(r'Public\s+ParseErrorCount', code) is not None,
   "a connected but garbled line must not look identical to a quiet sky")
ck("accepted records are counted",
   re.search(r'Public\s+StrikeCount', code) is not None)
ck("the pulse mirror gives an independent witness",
   re.search(r'Public\s+PulseCountTotal', code) is not None,
   "it does not depend on the serial line at all")
ck("no diagnostic is sampled into a table",
   not re.search(r'Sample\s*\([^)]*SerialOpenOK', code)
   and not re.search(r'Sample\s*\([^)]*ParseErrorCount', code)
   and not re.search(r'Sample\s*\([^)]*StrikeCount', code)
   and not re.search(r'Sample\s*\([^)]*PulseCount', code)
   and not re.search(r'Sample\s*\([^)]*LastRecord', code))
# The commissioning instrumentation is gone from the production program on
# purpose. It lives in git history if it is ever needed again.
for gone in ("RxCode", "BaudSet", "FmtSel", "ReArm", "FirstRecord",
             "BytesSeenTotal", "RecordsRead", "MaxBytesWaiting", "RawLen"):
    ck("no %s left in production" % gone, gone not in code)

print()
print("=== the wire needs inverted polarity, and the header must say so ===")
# The CR300 control terminals use RS-232 logic. The detector inverts in software
# to match; plain TTL is not received. This cost a long diagnosis, so it is
# recorded where someone rewiring the unit will see it.
ck("the header states the terminals use RS-232 logic",
   re.search(r'(?i)RS-232 logic', src) is not None)
ck("the header names the config flag that does the inverting",
   "campbell_uart_invert" in src)
ck("the header warns plain TTL will not work",
   re.search(r'(?i)plain TTL will not be received', src) is not None)

print()
print("=== structure ===")
for kw in ("BeginProg", "EndProg"):
    ck("%s exactly once" % kw, len(re.findall(r'^\s*%s\s*$' % kw, code, re.M)) == 1)
ck("Scan and NextScan balanced",
   len(re.findall(r'\bScan\s*\(', code)) == len(re.findall(r'\bNextScan\b', code)))
ck("DataTable and EndTable balanced",
   len(re.findall(r'\bDataTable\s*\(', code)) == len(re.findall(r'\bEndTable\b', code)))
ck("the table is called", "CallTable LightningEvents" in code)
ck("no IfTime housekeeping left over from the daily table",
   "IfTime" not in code,
   "there is nothing left to reset once a day")

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
print("=== wiring facts the program header must carry ===")
# The header was deliberately trimmed, so only the facts a field engineer needs
# while looking at the program are required here. The rest is asserted against
# deployed/README.md below, which is where the detail now lives.
ck("records go from BCM 26 to C2",
   re.search(r'BCM\s*26[^\n]*C2', src) is not None)
ck("the strike pulse goes from BCM 19 to P_SW",
   re.search(r'BCM\s*19[^\n]*P_SW', src) is not None)
ck("no screw-block position claims", not re.search(r'TB[12]\s+pin\s+\d', src))

print()
print("=== wiring detail lives in deployed/README.md ===")
# These were in the program header and were trimmed out on purpose. They still
# have to exist somewhere, because each one is a trap that has already cost time:
# landing on the TX terminal, grounding the screen at both ends, or expecting a
# bearing the sensor cannot produce.
DOC = os.path.normpath(os.path.join(HERE, "..", "deployed", "README.md"))
doc = open(DOC, encoding="utf-8").read()
_flat = re.sub(r"\s+", " ", doc)

ck("names the INT and RST terminals", "`INT`" in doc and "`RST`" in doc)
ck("warns against the TX terminal and BCM 14",
   "`TX`" in doc and "BCM 14" in doc,
   "BCM 14 is shared with the HAT's CP2102 bridge and is contended")
ck("covers the cable screen", "screen" in doc.lower())
ck("says bearing cannot be measured",
   re.search(r"(?i)cannot resolve direction", _flat) is not None,
   "a single-antenna AS3935 gives distance and energy only")
ck("records the inverted polarity and how it is set",
   "RS-232 logic" in doc and "campbell_uart_invert" in doc)
ck("records that wave_add_generic is used, not wave_add_serial",
   "wave_add_generic" in doc)
ck("does not still claim the link is broken",
   "still wrong" not in doc and "NOT yet working" not in doc,
   "the fault was resolved on 23 September 2026")
ck("does not still advertise the H health record as sent",
   re.search(r"(?i)no longer sent", _flat) is not None,
   "campbell_heartbeat_enabled is false")
for bad in ("GWLD1", "GLENCORE", "WONDERKOP", "Wonderkop"):
    ck("README has no %s reference" % bad, bad not in doc)

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
# No health on the wire to the logger at all. The interval is now irrelevant
# while the flag is false, but it is left at the maximum as a second line of
# defence if the flag is ever flipped by accident.
ck("the detector sends NO health to the logger",
   cfg.get("campbell_heartbeat_enabled") is False,
   "health belongs to the admin panel")
ck("and the interval is still at its maximum as a backstop",
   cfg.get("campbell_heartbeat_interval") == 86400)
ck("the panel still gets an hourly heartbeat",
   cfg.get("heartbeat_webhook_interval") == 3600,
   "this is the only liveness signal, so it must not be disabled")
# The CR300 control terminals use RS-232 logic. This one flag is the difference
# between a working link and bytes that arrive corrupt.
ck("the detector inverts its serial output",
   cfg.get("campbell_uart_invert") is True,
   "plain TTL is not received by C2")
ck("no secret committed",
   cfg.get("alert_webhook_token") == "REDACTED" and not cfg.get("stratus_api_key"))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
