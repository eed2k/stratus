"""Validate tailscale-policy.hujson before pasting it into the admin console.

    python validate_policy.py tailscale-policy.hujson

Parses the file the way the console will (HuJSON: comments and trailing commas
are legal), prints the effective policy so you can eyeball who gets what, then
asserts the things that matter for this deployment: no wildcard sources or
destinations, no wildcard ports, no root over Tailscale SSH, and no stray acls
block fighting with grants.

Exit codes: 0 clean, 1 unparseable, 2 parsed but needs review.
"""
import json
import re
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

out = []
in_str = False
esc = False
i = 0
while i < len(src):
    ch = src[i]
    if in_str:
        out.append(ch)
        if esc:
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == '"':
            in_str = False
        i += 1
        continue
    if ch == '"':
        in_str = True
        out.append(ch)
        i += 1
        continue
    if ch == "/" and i + 1 < len(src) and src[i + 1] == "/":
        while i < len(src) and src[i] != "\n":
            i += 1
        continue
    out.append(ch)
    i += 1

stripped = "".join(out)
# trailing commas before } or ]
stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)

try:
    data = json.loads(stripped)
except Exception as exc:
    print("INVALID:", exc)
    raise SystemExit(1)

print("VALID HuJSON")
print("top-level keys:", ", ".join(data.keys()))
print()
print("groups:")
for g, members in data.get("groups", {}).items():
    print(f"  {g} = {members}")
print("tagOwners:")
for t, owners in data.get("tagOwners", {}).items():
    print(f"  {t} <- {owners}")
print("grants:")
for g in data.get("grants", []):
    print(f"  src={g.get('src')} dst={g.get('dst')} ip={g.get('ip')}")
print("ssh:")
for s in data.get("ssh", []):
    print(f"  action={s.get('action')} period={s.get('checkPeriod')} "
          f"src={s.get('src')} dst={s.get('dst')} users={s.get('users')}")

# The whole point is deny-by-default: assert nothing is wide open.
problems = []
for g in data.get("grants", []):
    if "*" in (g.get("dst") or []) or "*" in (g.get("src") or []):
        problems.append(f"wildcard in grant {g}")
    for p in (g.get("ip") or []):
        if p in ("*", "tcp:*"):
            problems.append(f"wildcard port in grant {g}")
for s in data.get("ssh", []):
    if "root" in (s.get("users") or []):
        problems.append("ssh rule permits root")
    if "*" in (s.get("src") or []):
        problems.append("ssh rule src is wildcard")
if data.get("acls"):
    problems.append("an active acls block exists alongside grants")

print()
if problems:
    print("REVIEW:")
    for p in problems:
        print("  -", p)
    raise SystemExit(2)
print("No wildcard or root exposure in the active policy.")
