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

ck('an "H," record is still recognised explicitly',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"H,"', code) is not None,
   "so the Pi's daily health line does not look like a wiring fault")

# Bound the search to the H branch. An unbounded scan runs into the final Else.
_h = re.search(r'"H,"\s*Then(.*?)(?:\n\s*Else\b|\n\s*EndIf\b)', code, re.S)
_h_branch = (_h.group(1) if _h else "").strip()
ck("the H branch is empty: matched, dropped, never counted", _h_branch == "",
   "counting it would put routine traffic in the fault counter; storing it "
   "would put health in the data. Both are excluded: %r" % _h_branch)
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
ck("the header says bearing cannot be measured",
   re.search(r'(?i)cannot measure bearing', src) is not None)

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
   re.search(r'PulseCount\s*\(\s*PulseScan\s*,\s*1\s*,\s*P_SW\s*,\s*2\s*,\s*0\s*,\s*1\s*,\s*0\s*\)',
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
# "nothing arrived" from "arrived and was consumed". Accumulating it can, and that
# is what proved the BCM 26 wiring delivering all 70 bytes of a burst.
ck("buffer depth is accumulated, not just sampled",
   re.search(r'BytesSeenTotal\s*=\s*BytesSeenTotal\s*\+', code) is not None,
   "BytesSeenTotal above 0 proves bytes reached C2 even if nothing parsed")
ck("BytesWaiting is not published as a bare snapshot",
   re.search(r'Public\s+BytesWaiting', code) is None,
   "it reads 0 by the time the table is looked at, whatever happened")
# Counters alone could not answer why 5 of 5 records were rejected. These can.
ck("framed records are counted separately from stored ones",
   re.search(r'RecordsRead\s*=\s*RecordsRead\s*\+\s*1', code) is not None,
   "RecordsRead up with StrikeCount flat isolates the fault to the content")
ck("the first record received is latched for inspection",
   re.search(r'If\s+Len\s*\(\s*FirstRecord\s*\)\s*=\s*0\s+Then\s+FirstRecord\s*=\s*LastRecord',
             code) is not None,
   "LastRecord is wiped every scan, so it reads empty almost always")
ck("no diagnostic is sampled into a table",
   not re.search(r'Sample\s*\([^)]*SerialOpenOK', code)
   and not re.search(r'Sample\s*\([^)]*BytesWaiting', code)
   and not re.search(r'Sample\s*\([^)]*BytesSeenTotal', code)
   and not re.search(r'Sample\s*\([^)]*RecordsRead', code)
   and not re.search(r'Sample\s*\([^)]*FirstRecord', code)
   and not re.search(r'Sample\s*\([^)]*LPos', code))

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
