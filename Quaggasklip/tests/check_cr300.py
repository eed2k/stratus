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
CFG = os.path.normpath(os.path.join(HERE, "..", "quaggasklip_config.json"))

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
ck("no H record branch", not re.search(r'=\s*"H"', code))
ck("no PiCpuTempC variable", "PiCpuTempC" not in code)
ck("no PiRssiDbm variable", "PiRssiDbm" not in code)
ck("no StatusCount variable", "StatusCount" not in code)
ck("no DetectorOnline flag", "DetectorOnline" not in code)
ck("no MinutesSinceRecord", "MinutesSinceRecord" not in code)
ck('only "L," records are accepted, checking shape not just first byte',
   re.search(r'Left\s*\(\s*LastRecord\s*,\s*2\s*\)\s*=\s*"L,"', code) is not None)
ck("a non-L record is counted, not logged",
   len(re.findall(r'ParseErrorCount\s*=\s*ParseErrorCount\s*\+\s*1', code)) == 2,
   "ParseErrorCount increments: %d (expect 2: bad parse, and non-L)"
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
ck("service name is quaggasklip, not lightning-detector",
   "systemctl restart quaggasklip" in src and "lightning-detector" not in src)

print()
print("=== wiring notes are label-based, not position-based ===")
ck("no screw-block position claims",
   not re.search(r'TB[12]\s+pin\s+\d', src))
ck("says to use the silkscreen label", "silkscreen label" in src)
ck("states TX must go to C2", re.search(r'"TX"[^\n]*C2', src) is not None)
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
print("=== agrees with quaggasklip_config.json ===")
cfg = open(CFG, encoding="utf-8").read()


def cfgval(key):
    m = re.search(r'"%s"\s*:\s*([^,\n}]+)' % re.escape(key), cfg)
    return m.group(1).strip() if m else None


ck("campbell_heartbeat_enabled is false",
   cfgval("campbell_heartbeat_enabled") == "false", str(cfgval("campbell_heartbeat_enabled")))
ck("campbell_enabled is true", cfgval("campbell_enabled") == "true")
ck("campbell_transport is serial", cfgval("campbell_transport") == '"serial"')
ck("campbell_baud 9600 matches SerialOpen", cfgval("campbell_baud") == "9600")
ck("pulse_mirror_pin 19 matches the RST note", cfgval("pulse_mirror_pin") == "19")
ck("pulse_mirror_enabled is false", cfgval("pulse_mirror_enabled") == "false")

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
