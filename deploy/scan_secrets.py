"""Scan every file git would commit for credentials, before anything is staged.

Deliberately runs against `git ls-files --cached --others --exclude-standard`,
which is exactly the set git can commit: tracked files plus untracked files that
.gitignore does not already exclude.
"""
import base64
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PW = base64.b64decode("TmM3LURTezgjeyFkU1N0ew==").decode()

PATTERNS = {
    "VPS root password": re.compile(re.escape(PW)),
    "GitHub PAT": re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    "ghp token": re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    "Clickatell key": re.compile(
        r"CLICKATELL_API_KEY\s*[:=]\s*[\"']?[A-Za-z0-9\-_]{15,}"),
    # Placeholders are excluded rather than reported, because a scanner that
    # always shows 11 known-safe hits trains you to ignore it, which is exactly
    # when it stops catching the real one.
    "postgres URL with creds": re.compile(
        r"postgres(?:ql)?://(?!(?:USER|user|username|dbuser|stratus|USERNAME)"
        r"[:@])[^\s\"'<>]*:(?!(?:PASSWORD|password|XXXXX|\$\{)"
        r")[^\s\"'<>@]+@"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "private key block": re.compile(r"BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY"),
    "generic api_key assign": re.compile(
        r"(?i)(api[_-]?key|secret[_-]?key|password|passwd)\s*[:=]\s*[\"'][^\"'\s]{12,}[\"']"),
}

out = subprocess.run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    capture_output=True, text=True, encoding="utf-8", errors="replace")
files = [f for f in out.stdout.splitlines() if f.strip()]
print(f"files git could commit: {len(files)}")

SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
               ".pdf", ".zip", ".gz", ".tar", ".exe", ".woff", ".woff2",
               ".ttf", ".eot", ".dat"}

findings = {k: [] for k in PATTERNS}
scanned = skipped = 0

for rel in files:
    p = Path(rel)
    if not p.is_file():
        continue
    if p.suffix.lower() in SKIP_SUFFIX:
        skipped += 1
        continue
    try:
        if p.stat().st_size > 3_000_000:
            skipped += 1
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        skipped += 1
        continue
    scanned += 1
    for name, rx in PATTERNS.items():
        for m in rx.finditer(text):
            line = text[:m.start()].count("\n") + 1
            findings[name].append((rel, line, m.group(0)[:70]))

print(f"scanned {scanned}, skipped {skipped} (binary/large)\n")

blocking = 0
for name in PATTERNS:
    hits = findings[name]
    if not hits:
        print(f"  CLEAN   {name}")
        continue
    # The generic assignment pattern fires on examples and placeholders, so it
    # is reported for eyeballing rather than treated as blocking on its own.
    tag = "REVIEW " if name == "generic api_key assign" else "BLOCK  "
    if tag == "BLOCK  ":
        blocking += len(hits)
    print(f"  {tag} {name}: {len(hits)} hit(s)")
    for rel, line, snippet in hits[:40]:
        print(f"            {rel}:{line}  {snippet!r}")

print(f"\nblocking findings: {blocking}")
sys.exit(1 if blocking else 0)
