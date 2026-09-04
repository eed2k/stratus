"""Publish the Information Center at info.stratusweather.co.za.

Serves the project's PDF documentation for download from a static nginx
container with its own Traefik route. Nothing in the other compose projects is
touched.

WHAT IS PUBLISHED, AND WHAT IS NOT
  Of the 29 PDFs in the repository:
    15  test fixtures of 14 to 28 bytes, written by tests/test_reports_routes.py
        (its FAKE_PDF constant). Not documents; excluded.
     2  duplicate copies of files already listed. Deduplicated by SHA-256.
    12  real, unique documents, of which 5 are published.

  The 5 published documents were scanned for credentials, API tokens, private
  addresses and the wifi SSID before anything was uploaded, and all came back
  clean.

  Seven documents are deliberately withheld from this public URL. They were
  published by an earlier run of this script, so WITHDRAWN below is checked for
  HTTP 404 on every deploy: removing an entry from MANIFEST stops it being
  listed, but only deleting the file stops it being fetched by anyone who has
  the link.
    Installation and setup guides   commissioning detail about our own
                                    infrastructure; not client-facing.
    GWLD1 calibration record        specific to one client's unit.
    AS3935 datasheets and notes     third-party material (ams-OSRAM /
                                    ScioSense) that is theirs to distribute.

THE INDEX IS GENERATED, NOT HAND-WRITTEN
  Sizes and page counts are read from the files at deploy time, and a manifest
  entry whose file is missing aborts the deploy. A hand-maintained list drifts:
  it will happily advertise a document that is not there.
"""
from __future__ import annotations

import base64
import hashlib
import html
import io
import os
import shutil
import sys
import tarfile
import time
from datetime import datetime
from pathlib import Path

import paramiko
from scp import SCPClient

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOST = os.environ.get("DEPLOY_HOST", "139.84.242.126")
USER = os.environ.get("DEPLOY_USER", "root")
PW = os.environ.get("DEPLOY_PW", "")
if not PW:
    sys.exit("Set DEPLOY_PW")

# Infrastructure identifiers keep their original spelling. The container, the
# server directory, the local folder and the Traefik router are named
# "info-centre" on the live host; renaming them here would deploy into a new
# empty directory, start a second container alongside the running one, and
# register duplicate routes. Only the visible title reads "Information Center".
DIR = "/opt/info-centre"
CT = "info-centre"
FQDN = "info.stratusweather.co.za"
NET = "stratus_stratus-network"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
OUT = Path("backups/_deploy_info_centre.txt")

LOCAL = Path("info-centre")
PANEL_CSS = Path("LDS ADMIN/app/static/style.css")

# (section, title, description, source path, served filename)
#
# Grouped so a reader can tell our own documentation from the sensor
# manufacturer's, and so the one client-specific record is not mixed in with
# general material.
MANIFEST = [
    ("System documentation",
     "What the system is and how it performs.",
     [
        ("Lightning Detection System - Datasheet",
         "Full system datasheet: detection principle, coverage, alerting, "
         "reporting and installation requirements.",
         "Lightning Detector/docs/datasheets/Lightning_Detection_System_Datasheet.pdf",
         "lightning-detection-system-datasheet.pdf"),
        ("AS3935 Energy Values - Interpretation",
         "How the sensor's relative energy figure should and should not be "
         "read. The value is a comparative sensor reading, not joules.",
         "Lightning Detector/AS3935_Energy_Values.pdf",
         "as3935-energy-values.pdf"),
     ]),
    ("Client documents",
     "Operational documentation issued with an installation.",
     [
        ("LDS Maintenance",
         "Routine maintenance schedule and what each check covers.",
         "Lightning Detector/docs/client_documents/LDS Maintenance.pdf",
         "lds-maintenance.pdf"),
        ("LDS Power Reliability",
         "Solar and battery sizing, expected autonomy and behavior during an "
         "extended outage.",
         "Lightning Detector/docs/client_documents/LDS Power Reliability.pdf",
         "lds-power-reliability.pdf"),
        ("LDS Security and Data Protection",
         "How detector data is transported, stored and access-controlled.",
         "Lightning Detector/docs/client_documents/LDS Security and Data Protection.pdf",
         "lds-security-and-data-protection.pdf"),
     ]),
]

# Served filenames an earlier run put on the public URL that must no longer be
# reachable. Checked for HTTP 404 after every deploy.
WITHDRAWN = [
    "lightning-detector-setup.pdf",
    "pi-flash-deploy-guide.pdf",
    "as3935-calibration-gwld1.pdf",
    "as3935-datasheet.pdf",
    "as3935-datasheet-alt-revision.pdf",
    "as3935-hardware-design-guide.pdf",
    "as3935-an05-automatic-antenna-tuning.pdf",
]

# Sections whose headings must not appear on the page any more.
WITHDRAWN_SECTIONS = ["Installation and setup guides", "Calibration records",
                      "Manufacturer references"]

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    try:
        OUT.write_text("\n".join(log), encoding="utf-8")
    except Exception:
        pass


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((bool(ok), label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<50} {detail}")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=900):
    for attempt in (1, 2, 3):
        try:
            c = fresh()
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                a = o.read().decode(errors="replace")
                b = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (a or b).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def bash(script: str, timeout=900):
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


def human(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / 1024:.0f} KB"


def page_count(path: Path) -> int | None:
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(path)).pages)
    except Exception:
        return None


def build_site() -> tuple[Path, list[tuple[str, Path, int]]]:
    """Stage the documents and generate index.html. Returns the staged files."""
    site = LOCAL / "site"
    docs = site / "docs"
    if docs.exists():
        shutil.rmtree(docs)
    docs.mkdir(parents=True, exist_ok=True)

    shutil.copyfile(PANEL_CSS, site / "style.css")

    staged: list[tuple[str, Path, int]] = []
    seen_hashes: dict[str, str] = {}
    body: list[str] = []

    for sec_title, sec_sub, entries in MANIFEST:
        rows = []
        for title, desc, src, served in entries:
            p = Path(src)
            if not p.is_file():
                raise SystemExit(f"manifest lists a missing file: {src}")
            data = p.read_bytes()
            h = hashlib.sha256(data).hexdigest()
            if h in seen_hashes:
                say(f"  skipping duplicate: {src} == {seen_hashes[h]}")
                continue
            seen_hashes[h] = served
            (docs / served).write_bytes(data)
            size = len(data)
            pages = page_count(p)
            staged.append((served, p, size))

            meta = human(size)
            if pages:
                meta += f" &middot; {pages} page" + ("" if pages == 1 else "s")
            url = "docs/" + served
            rows.append(f"""      <li class="doc">
        <div class="doc-main">
          <div class="doc-title"><a href="{url}">{html.escape(title)}</a></div>
          <p class="doc-desc">{html.escape(desc)}</p>
        </div>
        <span class="doc-meta">{meta}</span>
        <span class="doc-actions">
          <a href="{url}" class="primary-link">View</a>
          <a href="{url}" download="{served}">Download</a>
        </span>
      </li>""")

        if not rows:
            continue
        body.append(f"""  <section class="info-section">
    <h3>{html.escape(sec_title)}</h3>
    <p class="info-sub">{html.escape(sec_sub)}</p>
    <ul class="doc-list">
{chr(10).join(rows)}
    </ul>
  </section>""")

    total = sum(s for _n, _p, s in staged)

    index = f"""<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Information Center</title>
<meta name="description" content="Documentation for the Stratus Weather
lightning detection system.">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Ccircle cx='128' cy='128' r='120' fill='%231e3a5f'/%3E%3Ccircle cx='128' cy='128' r='32' fill='%23ffffff'/%3E%3C/svg%3E">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="info.css">
</head>
<body class="is-app">
<div class="appwindow">

  <div class="titlebar">
    <span class="titlebar-name">STRATUS WEATHER &nbsp;::&nbsp; Information Center</span>
    <span class="titlebar-meta">{len(staged)} documents &nbsp;|&nbsp; {human(total)}</span>
  </div>

  <main class="workarea">
    <h1>Information Center</h1>

    <p class="info-intro">
      Documentation for the Stratus Weather lightning detection system. Every
      document opens in the browser, or use <strong>Download</strong> to save it.
    </p>

{chr(10).join(body)}

  </main>

  <div class="statusbar">
    <span>Information Center</span>
    <span>{len(staged)} documents</span>
    <span class="statusbar-right">Stratus Weather Lightning Alert System</span>
  </div>
</div>
</body>
</html>
"""
    (site / "index.html").write_text(index, encoding="utf-8")
    return site, staged


def main() -> None:
    section("0. Stage the documents and generate the index")
    if not PANEL_CSS.is_file():
        raise SystemExit(f"missing {PANEL_CSS}")
    site, staged = build_site()
    for served, src, size in staged:
        say(f"  {human(size):>9}  {served:<44} <- {src}")
    say(f"  {len(staged)} documents staged, "
        f"{human(sum(s for _n, _p, s in staged))} total")
    ck(len(staged) == 5, "5 documents staged", str(len(staged)))

    # Nothing withheld may be staged, whatever the manifest says.
    leaked = [n for n, _p, _s in staged if n in WITHDRAWN]
    ck(not leaked, "no withheld document staged", ", ".join(leaked) or "none")

    # Nothing tiny should have crept in: the test fixtures are 14 to 28 bytes.
    tiny = [n for n, _p, s in staged if s < 1000]
    ck(not tiny, "no test-fixture PDFs included", ", ".join(tiny) or "none")

    section("1. Pre-flight on the server")
    pre = bash(f"""
echo "--- DNS ---"
getent hosts {FQDN} || echo "  no A record visible from the server"
echo "--- traefik network ---"
docker network ls --format '{{{{.Name}}}}' | grep -x '{NET}' || echo "  MISSING"
echo "--- hostname not claimed by anything else ---"
# Our own container is expected to hold this route on a re-deploy; the check is
# for a *different* container having taken the hostname.
for c in $(docker ps --format '{{{{.Names}}}}' | grep -v '^{CT}$'); do
  docker inspect $c --format '{{{{json .Config.Labels}}}}' | grep -q '{FQDN}' \
    && echo "  ALREADY ROUTED BY: $c"
done
echo "--- sites before ---"
for u in https://stratusweather.co.za/ https://adminpanel.stratusweather.co.za/login https://lightningdemo.stratusweather.co.za/ ; do
  printf "  %-52s HTTP %s\\n" "$u" "$(curl -s -L -o /dev/null -w '%{{http_code}}' --max-time 20 $u)"
done
echo "--- disk ---"
df -h / | tail -1
""")
    say(pre)
    ck(NET in pre and "MISSING" not in pre, "Traefik network present")
    ck("ALREADY ROUTED BY" not in pre,
       "hostname not claimed by another container")

    section("2. Upload")
    files = ["docker-compose.yml", "nginx.conf", "site/index.html",
             "site/info.css", "site/style.css"]
    files += ["site/docs/" + n for n, _p, _s in staged]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in files:
            tf.add(LOCAL / f, arcname=f)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=900) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/info-{STAMP}.tar.gz")
    finally:
        c.close()

    say(bash(f"""
mkdir -p {DIR}/site/docs
cd {DIR}
rm -rf site/docs
tar -xzf /tmp/info-{STAMP}.tar.gz && echo "extract ok"
rm -f /tmp/info-{STAMP}.tar.gz
echo "--- documents on disk ---"
ls -1 site/docs | sed 's/^/  /'
echo "  count: $(ls -1 site/docs | wc -l)"
echo "--- compose validity ---"
docker compose -f docker-compose.yml config >/dev/null 2>&1 \
  && echo "COMPOSE_VALID" || docker compose -f docker-compose.yml config
"""))

    section("3. Start")
    say(sh(f"cd {DIR} && docker compose up -d 2>&1 | tail -6", 600))
    up = False
    for i in range(36):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i*5}s")
            up = True
            break
        time.sleep(5)
    ck(up, "documentation site container healthy")

    section("4. TLS and the route")
    code = ""
    for attempt in range(12):
        code = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
                  f"https://{FQDN}/").strip()
        if code == "200":
            break
        say(f"    attempt {attempt + 1}: HTTP {code} (waiting for the certificate)")
        time.sleep(15)
    ck(code == "200", f"https://{FQDN}/ serves", f"HTTP {code}")

    say(bash(f"""
echo "--- certificate ---"
echo | openssl s_client -connect {FQDN}:443 -servername {FQDN} 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate 2>/dev/null | sed 's/^/  /' \
  || echo "  could not read the certificate"
echo "--- http redirect ---"
curl -s -o /dev/null -w '  http -> %{{http_code}} %{{redirect_url}}\\n' --max-time 20 http://{FQDN}/
echo "--- headers ---"
curl -s -D - -o /dev/null --max-time 20 https://{FQDN}/ \
  | grep -Ei 'content-security-policy|x-robots-tag|x-frame|x-content-type' | sed 's/^/  /'
"""))

    section("5. Every document downloads")
    lines = []
    for served, _p, size in staged:
        lines.append(
            f'printf "  %-46s %s  %s bytes\\n" "{served}" '
            f'"$(curl -s -o /dev/null -w \'HTTP %{{http_code}}\' --max-time 40 '
            f'https://{FQDN}/docs/{served})" '
            f'"$(curl -s -o /dev/null -w \'%{{size_download}}\' --max-time 40 '
            f'https://{FQDN}/docs/{served})"')
    res = bash("\n".join(lines), 900)
    say(res)
    ok200 = res.count("HTTP 200")
    ck(ok200 == len(staged), "all documents return HTTP 200",
       f"{ok200} of {len(staged)}")

    # Sizes must match what was staged, so a truncated upload is caught.
    mismatch = []
    for served, _p, size in staged:
        for line in res.splitlines():
            if served in line:
                got = line.strip().split()[-2]
                if got.isdigit() and int(got) != size:
                    mismatch.append(f"{served} {got}!={size}")
    ck(not mismatch, "served sizes match the staged files",
       "; ".join(mismatch) or "all match")

    ctype = sh("curl -s -D - -o /dev/null --max-time 25 "
               f"https://{FQDN}/docs/{staged[0][0]} | grep -i content-type")
    say("  " + ctype.strip())
    ck("application/pdf" in ctype.lower(), "PDFs served as application/pdf")

    section("6. The page lists what it should, and nothing it should not")
    page = sh(f"curl -s --max-time 25 https://{FQDN}/")
    ck("<title>Information Center</title>" in page, "title is Information Center")
    ck("Information Center" in page, "heading present")
    for sec_title, _sub, _e in MANIFEST:
        ck(sec_title in page, f"section listed: {sec_title}")
    ck("acme" not in page.lower(), "no test-fixture reports referenced")

    for sec in WITHDRAWN_SECTIONS:
        ck(sec not in page, f"section gone: {sec}")
    ck("ScioSense" not in page, "no manufacturer material referenced")
    ck("GWLD1" not in page, "no client calibration record referenced")
    still = [n for n in WITHDRAWN if n in page]
    ck(not still, "no withheld document linked", ", ".join(still) or "none")
    listed = page.count('class="doc"')
    ck(listed == len(staged), "every staged document is listed",
       f"{listed} of {len(staged)}")

    section("6b. Withheld documents are actually gone")
    say("  A previous run published these. Unlisting is not enough: anyone "
        "holding the link\n  must now get a 404.")
    wlines = [
        f'printf "  %-46s %s\\n" "{n}" '
        f'"$(curl -s -o /dev/null -w \'HTTP %{{http_code}}\' --max-time 30 '
        f'https://{FQDN}/docs/{n})"' for n in WITHDRAWN]
    wres = bash("\n".join(wlines), 600)
    say(wres)
    gone = sum(1 for line in wres.splitlines() if "HTTP 404" in line)
    ck(gone == len(WITHDRAWN), "every withheld document returns 404",
       f"{gone} of {len(WITHDRAWN)}")

    on_disk = bash(f"""
cd {DIR}
echo "--- files actually on disk ---"
ls -1 site/docs | sed 's/^/  /'
echo "  count: $(ls -1 site/docs | wc -l)"
echo "--- any withheld file still present ---"
for f in {' '.join(WITHDRAWN)}; do
  [ -f "site/docs/$f" ] && echo "  STILL PRESENT: $f"
done
echo "  (nothing listed above means none remain)"
""")
    say(on_disk)
    ck("STILL PRESENT" not in on_disk, "no withheld file left on disk")

    section("7. Directory listing is off")
    dl = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 20 "
            f"https://{FQDN}/docs/")
    say(f"  GET /docs/ -> HTTP {dl.strip()}")
    ck(dl.strip() in ("403", "404"), "cannot browse the document directory",
       f"HTTP {dl.strip()}")

    section("8. Nothing else disturbed")
    after = bash(f"""
for u in https://stratusweather.co.za/ https://adminpanel.stratusweather.co.za/login https://lightningdemo.stratusweather.co.za/ https://{FQDN}/ ; do
  printf "  %-52s HTTP %s\\n" "$u" "$(curl -s -L -o /dev/null -w '%{{http_code}}' --max-time 25 $u)"
done
echo "--- containers ---"
docker ps --format '  {{{{.Names}}}}  {{{{.Status}}}}' | grep -Ei 'stratus|lightning|info'
echo "--- info memory ---"
docker stats --no-stream --format '  {{{{.Name}}}}  {{{{.MemUsage}}}}' {CT}
echo "--- disk ---"
df -h / | tail -1
""")
    say(after)
    ck(after.count("HTTP 200") >= 4, "all four sites healthy")

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  URL      https://{FQDN}/")
    say(f"  Location {DIR}")
    say(f"  Remove   cd {DIR} && docker compose down")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        OUT.write_text("\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
