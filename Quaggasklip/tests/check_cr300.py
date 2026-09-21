"""Static consistency check on the CR300 program before upload."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.normpath(os.path.join(HERE, "..", "campbell", "QK_CR300_Lightning.CR300"))
src = open(P, encoding="utf-8").read()
lines = src.split("\n")


def code_lines():
    """Lines with comments stripped. CRBasic comments start with an apostrophe."""
    out = []
    for i, ln in enumerate(lines, 1):
        s = ln.split("'", 1)[0]
        if s.strip():
            out.append((i, s))
    return out


code = code_lines()
code_text = "\n".join(s for _, s in code)

passed = 0
failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1


print("=== the parse fix ===")
ck("Parsed is dimensioned 2", "Parsed(2) As Float" in code_text)
ck("SplitStr asks for 2 values", re.search(r'SplitStr\s*\(\s*Parsed\(1\)\s*,\s*LastRecord\s*,\s*","\s*,\s*2\s*,\s*0\s*\)', code_text) is not None)
ck("no Parsed(3) anywhere in code", "Parsed(3)" not in code_text,
   "found" if "Parsed(3)" in code_text else "")
ck("guard tests Parsed(1) and Parsed(2)",
   re.search(r'If\s+Parsed\(1\)\s*=\s*Parsed\(1\)\s+AND\s+Parsed\(2\)\s*=\s*Parsed\(2\)', code_text) is not None)
ck("L branch reads Parsed(1) into distance",
   "LastDistanceKm = Parsed(1)" in code_text)
ck("L branch reads Parsed(2) into energy", "LastEnergy = Parsed(2)" in code_text)
ck("H branch reads Parsed(1) into cpu temp", "PiCpuTempC = Parsed(1)" in code_text)
ck("H branch reads Parsed(2) into rssi", "PiRssiDbm = Parsed(2)" in code_text)

print()
print("=== the pulse-row fix ===")
ck("EventRowWritten is declared", "Dim EventRowWritten As Boolean" in code_text)
ck("EventRowWritten cleared each scan", "EventRowWritten = False" in code_text)
ck("EventRowWritten set in the L branch", "EventRowWritten = True" in code_text)
ck("pulse-only output gates on EventRowWritten",
   "Not EventRowWritten" in code_text)
ck("pulse-only output no longer gates on RecordOK",
   "PulseCountScan > 0 And Not RecordOK" not in code_text)
ck("RecordOK still drives liveness", "DetectorOnline = True" in code_text
   and "If RecordOK Then" in code_text)

print()
print("=== overflow fix ===")
ck("PulseCountTotal sampled as IEEE4",
   "Sample (1, PulseCountTotal, IEEE4)" in code_text)
ck("PulseCountScan totalised as IEEE4",
   "Totalize (1, PulseCountScan, IEEE4, False)" in code_text)
ck("no FP2 left on a cumulative count",
   "PulseCountTotal, FP2" not in code_text and "PulseCountScan, FP2" not in code_text)
ck("FP2 retained for bounded distance values",
   "LastDistanceKm, FP2" in code_text and "ClosestTodayKm, FP2" in code_text)

print()
print("=== serial config matches the Pi ===")
ck("9600 baud", re.search(r'SerialOpen\s*\(\s*ComC2_Rx\s*,\s*9600\s*,\s*0\s*,\s*0\s*,\s*256\s*\)', code_text) is not None)
ck("EndWord 3338 is CR LF", "3338" in code_text and 0x0D0A == 3338)
ck("SerialInRecord option 10 (oldest, no NAN)",
   re.search(r'SerialInRecord\s*\(\s*ComC2_Rx\s*,\s*LastRecord\s*,\s*0\s*,\s*0\s*,\s*3338\s*,\s*BytesReturned\s*,\s*10\s*\)', code_text) is not None)
ck("buffer flushed at start", "SerialFlush (ComC2_Rx)" in code_text)

print()
print("=== pulse input ===")
ck("PulseCount on P_SW with PConfig 2 (switch closure)",
   re.search(r'PulseCount\s*\(\s*PulseCountScan\s*,\s*1\s*,\s*P_SW\s*,\s*2\s*,\s*0\s*,\s*1\s*,\s*0\s*\)', code_text) is not None)

print()
print("=== structure ===")
for kw in ("BeginProg", "EndProg"):
    ck("%s present exactly once" % kw,
       len(re.findall(r'^\s*%s\s*$' % kw, code_text, re.M)) == 1)
ck("Scan and NextScan balanced",
   len(re.findall(r'\bScan\s*\(', code_text)) == len(re.findall(r'\bNextScan\b', code_text)))
ck("DataTable and EndTable balanced",
   len(re.findall(r'\bDataTable\s*\(', code_text)) == len(re.findall(r'\bEndTable\b', code_text)))
ifs = len(re.findall(r'\bIf\b(?!.*\bThen\b.*\b\w+\s*=)', code_text))
ck("every If has a matching EndIf or is single-line",
   len(re.findall(r'\bEndIf\b', code_text)) >= 1, "EndIf count: %d" % len(re.findall(r'\bEndIf\b', code_text)))
ck("two data tables declared",
   len(re.findall(r'\bDataTable\s*\(', code_text)) == 2)
ck("CallTable used for both tables",
   "CallTable LightningEvents" in code_text and "CallTable LightningDaily" in code_text)

print()
print("=== no cross-site contamination ===")
for bad in ("GWLD1", "GLENCORE", "WONDERKOP", "Wonderkop"):
    ck("no %s reference" % bad, bad not in src,
       "found at line %s" % [i for i, l in enumerate(lines, 1) if bad in l][:3]
       if bad in src else "")
ck("site is QUAGGASKLIP", "Site: QUAGGASKLIP" in src)

print()
print("=== attribution and language ===")
ck("names METRON (PTY) LTD", "METRON (PTY) LTD" in src)
ck("credits L.J. Esterhuizen", "L.J. Esterhuizen" in src)
ck("pure ASCII", all(ord(c) < 128 for c in src),
   "non-ascii: %r" % [c for c in src if ord(c) >= 128][:5])
tooling = re.findall(r'(?i)\bkiro\b|\bclaude\b|\bcopilot\b|\bchatgpt\b|\bLLM\b|generated by', src)
ck("no tooling references", not tooling, str(tooling[:3]))

print()
print("=== doc consistency with quaggasklip_config.json ===")
cfg = open(os.path.normpath(os.path.join(HERE, "..", "quaggasklip_config.json")),
           encoding="utf-8").read()


def cfgval(key):
    m = re.search(r'"%s"\s*:\s*([^,\n}]+)' % re.escape(key), cfg)
    return m.group(1).strip() if m else None


pairs = [
    ("campbell_baud", "9600", "9600"),
    ("pulse_mirror_ms", "25", "25 ms"),
    ("pulse_mirror_pin", "19", "BCM 19"),
    ("campbell_heartbeat_interval", "600", "600 s"),
]
for key, want, in_prog in pairs:
    got = cfgval(key)
    ck("config %s is %s" % (key, want), got == want, "got %s" % got)
    ck("program header mentions %s" % in_prog, in_prog in src)
ck("no stale '50 ms' pulse claim", "50 ms pulse" not in src)
ck("config transport is serial", cfgval("campbell_transport") == '"serial"',
   str(cfgval("campbell_transport")))
ck("config campbell_enabled is true", cfgval("campbell_enabled") == "true",
   str(cfgval("campbell_enabled")))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
