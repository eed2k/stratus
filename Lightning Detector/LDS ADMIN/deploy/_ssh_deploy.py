"""Deploy admin panel to Vultr VPS via SSH/SCP."""
import os
import subprocess
import tempfile
import shutil
import zipfile
import pathlib
import paramiko
from scp import SCPClient

HOST = "139.84.238.225"
USER = "root"
REMOTE = "/opt/lightning-panel"
DOMAIN = "gwld1-admin.dynv6.net"
HOSTKEY = "SHA256:DGqq/wq1jg2gjzIcsJR6W6AFSFCNavJH3ymw1hF6w+s"
HERE = pathlib.Path(__file__).resolve().parent.parent
KEY_PATH = HERE / "deploy" / "keys" / "gwld1_deploy"
SECRET_FILE = HERE / "deploy" / ".deploy_secret"


def _password():
    if os.environ.get("DEPLOY_PASSWORD"):
        return os.environ["DEPLOY_PASSWORD"].strip()
    if SECRET_FILE.is_file():
        return SECRET_FILE.read_text(encoding="utf-8").strip()
    return "pV-9g?52L%JyxYVZ"


def _plink_path():
    p = shutil.which("plink") or r"C:\Program Files\PuTTY\plink.exe"
    return p if os.path.isfile(p) else None


def _pscp_path():
    plink = _plink_path() or ""
    pscp = plink.replace("plink.exe", "pscp.exe")
    if os.path.isfile(pscp):
        return pscp
    return shutil.which("pscp")


def stage_bundle():
    stage = pathlib.Path(tempfile.mkdtemp()) / "bundle"
    stage.mkdir(parents=True)
    for item in HERE.iterdir():
        if item.name.startswith(".venv") or item.name == "data":
            continue
        if item.name.startswith("_"):
            continue
        dest = stage / item.name
        if item.is_dir():

            def _ignore(dir, names):
                return [n for n in names if n in ("__pycache__", "keys")
                        or n.endswith(".pyc")
                        or n in ("panel_bundle.zip", "panel_bundle.b64",
                                 "VULTR_CONSOLE_DEPLOY.sh", "_upload.zip")]

            shutil.copytree(item, dest, ignore=_ignore)
        else:
            shutil.copy2(item, dest)
    shutil.copy2(HERE / ".env.vps", stage / ".env")
    zpath = HERE / "deploy" / "_upload.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(stage):
            for f in files:
                p = pathlib.Path(root) / f
                zf.write(p, p.relative_to(stage))
    return zpath


def run(client, cmd, check=True):
    print(">>>", cmd)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip())
    if err.strip():
        print("ERR:", err.strip())
    if check and code != 0:
        raise SystemExit(f"failed ({code}): {cmd}")
    return out


def _try_key_paramiko():
    if not KEY_PATH.is_file():
        return None
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, key_filename=str(KEY_PATH), timeout=60,
                       look_for_keys=False, allow_agent=False,
                       banner_timeout=60, auth_timeout=60)
        return client, "ssh-key"
    except Exception:
        client.close()
        return None


def _try_key_plink():
    plink = _plink_path()
    if not plink or not KEY_PATH.is_file():
        return None
    test = subprocess.run(
        [plink, "-ssh", f"{USER}@{HOST}", "-batch", "-hostkey", HOSTKEY,
         "-i", str(KEY_PATH), "echo KEY_OK"],
        capture_output=True, text=True, timeout=60,
    )
    if test.returncode != 0 or "KEY_OK" not in (test.stdout or ""):
        return None
    return _plink_client(plink, use_key=True), "plink-key"


def _plink_client(plink, use_key=False):
    pw = _password()

    class PlinkClient:
        def _base(self):
            cmd = [plink, "-ssh", f"{USER}@{HOST}", "-batch", "-hostkey", HOSTKEY]
            if use_key:
                cmd.extend(["-i", str(KEY_PATH)])
            else:
                cmd.extend(["-pw", pw])
            return cmd

        def exec_command(self, cmd, timeout=600):
            r = subprocess.run(self._base() + [cmd],
                                 capture_output=True, text=True, timeout=timeout)

            class _Ch:
                def recv_exit_status(self):
                    return r.returncode

            class _Out:
                def __init__(self):
                    self.channel = _Ch()

                def read(self):
                    return (r.stdout or "").encode()

            class _Err:
                def read(self):
                    return (r.stderr or "").encode()

            return None, _Out(), _Err()

        def get_transport(self):
            raise NotImplementedError("plink mode")

        def close(self):
            pass

    return PlinkClient()


def connect_ssh():
    hit = _try_key_paramiko()
    if hit:
        return hit

    hit = _try_key_plink()
    if hit:
        return hit

    pw = _password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=pw, timeout=60,
                       look_for_keys=False, allow_agent=False,
                       banner_timeout=60, auth_timeout=60)
        return client, "password"
    except paramiko.AuthenticationException:
        client.close()

    plink = _plink_path()
    if plink:
        test = subprocess.run(
            [plink, "-ssh", f"{USER}@{HOST}", "-pw", pw, "-batch",
             "-hostkey", HOSTKEY, "echo PLINK_OK"],
            capture_output=True, text=True, timeout=60,
        )
        if test.returncode == 0 and "PLINK_OK" in (test.stdout or ""):
            return _plink_client(plink, use_key=False), "plink-password"

    raise SystemExit(
        "\nSSH login failed (password rejected).\n\n"
        "Do ONE of these:\n"
        "  A) Vultr -> View Console -> paste deploy/CONSOLE_ADD_KEY.sh\n"
        "     Then run RUN_DEPLOY.bat again (uses SSH key, no password).\n"
        "  B) Vultr -> Settings -> Reset Root Password\n"
        "     Put the new password in deploy/.deploy_secret (one line)\n"
        "     Then run RUN_DEPLOY.bat again.\n"
    )


def upload_zip(zpath, mode):
    if mode in ("ssh-key", "password"):
        return
    plink = _plink_path()
    pscp = _pscp_path()
    if not plink or not pscp:
        raise SystemExit("pscp/plink not found (install PuTTY)")
    base = [pscp, "-batch", "-hostkey", HOSTKEY]
    if "key" in mode:
        base.extend(["-i", str(KEY_PATH)])
    else:
        base.extend(["-pw", _password()])
    r = subprocess.run(base + [str(zpath), f"{USER}@{HOST}:/tmp/panel_upload.zip"],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise SystemExit(f"pscp failed: {r.stderr or r.stdout}")


def main():
    print("==> Building bundle...")
    zpath = stage_bundle()
    print("   ", zpath, f"({zpath.stat().st_size} bytes)")

    print("==> Connecting SSH...")
    client, mode = connect_ssh()
    print(f"    Connected via {mode}.")

    run(client, f"mkdir -p {REMOTE}")
    if mode in ("ssh-key", "password"):
        with SCPClient(client.get_transport()) as scp:
            scp.put(str(zpath), "/tmp/panel_upload.zip")
    else:
        upload_zip(zpath, mode)
    print("    Uploaded.")

    run(client, "apt-get update -qq && apt-get install -y -qq unzip rsync curl 2>/dev/null || true",
        check=False)
    run(client, f"mkdir -p {REMOTE}_new && unzip -o /tmp/panel_upload.zip -d {REMOTE}_new")
    run(client, f"rsync -a {REMOTE}_new/ {REMOTE}/")
    # Bundles are built on Windows; strip CRLF so bash scripts run cleanly.
    run(client, f"cd {REMOTE} && sed -i 's/\\r$//' deploy/*.sh", check=False)
    run(client, f"chmod +x {REMOTE}/deploy/*.sh", check=False)
    run(client, f"cd {REMOTE} && DOMAIN={DOMAIN} bash deploy/deploy_on_vps.sh")

    out = run(client, "curl -s http://127.0.0.1:8000/login | head -c 400")
    if "STRATUS WEATHER" in out or "Log In" in out:
        print("VERIFY: new UI on localhost")
    elif "Sign in" in out:
        print("WARN: still old UI")
    client.close()
    print(f"\nDEPLOY_OK https://{DOMAIN}")


if __name__ == "__main__":
    main()
