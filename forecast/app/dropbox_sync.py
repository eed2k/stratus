"""Poll a Dropbox folder for logger exports and feed them in continuously.

WHY THIS EXISTS

  A CR300 or CR1000 on a site with connectivity generally drips its table into
  Dropbox: the same .dat path, appended to every few minutes. Uploading that by
  hand defeats the point of a forecast that is supposed to keep up with the
  station. So the same arrangement the main Stratus server already uses is
  reused here: an app key, an app secret and a long-lived refresh token, with a
  folder watched per station.

HOW IT AVOIDS WASTING BANDWIDTH AND QUOTA

  Dropbox stamps every file with a `rev` that changes when the content changes.
  The rev of the last version ingested is stored per path, and a file whose rev
  has not moved is not downloaded. Without that, a poll every fifteen minutes
  would re-download a multi-megabyte export ninety-six times a day to learn
  nothing, on a host with 4.6 GB of disk free.

  Re-ingesting the same rows is harmless when it does happen, because
  observations are keyed on (station, variable, timestamp) and an overlapping
  file corrects rather than duplicates. The rev check is about cost, not
  correctness.

WHY THE ACCESS TOKEN IS NOT STORED

  Dropbox short-lived access tokens last four hours. Only the refresh token is
  configured; an access token is fetched on demand, kept in memory and re-used
  until shortly before it expires. Nothing writes it to disk, so a copy of the
  database is not a copy of a live credential.

WHAT IT WILL NOT DO

  It never writes to Dropbox. Every call used here is read-only: get a token,
  list a folder, download a file. There is no code path in this module that can
  modify or delete anything in the operator's Dropbox.
"""
from __future__ import annotations

import base64
import fnmatch
import json
import os
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime

from . import forecasting, ingest
from .db import Database

TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
LIST_URL = "https://api.dropboxapi.com/2/files/list_folder"
LIST_CONTINUE_URL = "https://api.dropboxapi.com/2/files/list_folder/continue"
DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download"

CTX = ssl.create_default_context()
# Refresh a little early so a long poll cannot straddle the expiry.
TOKEN_SAFETY_SECONDS = 300
# The cap on a single file. It is generous because the file is streamed to disk
# and parsed one line at a time (see poll_station), so a large multi-year export
# no longer has to fit in the 320 MB container: only disk (several GB free) and
# a bounded insert batch are needed. It still exists so a runaway or wrong file
# cannot fill the disk.
MAX_FILE_BYTES = 256 * 1024 * 1024
# Read the download in 64 KB blocks so the whole body is never held in memory.
DOWNLOAD_CHUNK = 1 << 16
DEFAULT_TIMEOUT = 60


class DropboxError(Exception):
    """A Dropbox call failed. Carries a message fit to show an operator."""


@dataclass
class DropboxFile:
    path_lower: str
    path_display: str
    name: str
    rev: str
    content_hash: str
    size: int
    server_modified: str


@dataclass
class PollResult:
    station_id: int
    checked: int = 0
    downloaded: int = 0
    rows_added: int = 0
    skipped_unchanged: int = 0
    forecasts_run: int = 0
    status: str = ""
    error: str = ""
    warnings: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)


class DropboxClient:
    """Minimal read-only Dropbox client.

    Uses urllib rather than a Dropbox SDK. The SDK pulls in a dependency tree
    for four endpoints, and this container is deliberately kept to a web
    framework and a template engine so it fits alongside everything else on a
    951 MB host.
    """

    def __init__(self, app_key: str | None = None,
                 app_secret: str | None = None,
                 refresh_token: str | None = None,
                 timeout: int = DEFAULT_TIMEOUT):
        self.app_key = (app_key
                        or os.environ.get("DROPBOX_APP_KEY", "")).strip()
        self.app_secret = (app_secret
                           or os.environ.get("DROPBOX_APP_SECRET", "")).strip()
        self.refresh_token = (
            refresh_token
            or os.environ.get("DROPBOX_REFRESH_TOKEN", "")).strip()
        self.timeout = timeout
        self._token = ""
        self._token_expires = 0.0

    # -- configuration ----------------------------------------------------

    def configured(self) -> bool:
        return bool(self.app_key and self.app_secret and self.refresh_token)

    def describe(self) -> dict:
        return {
            "configured": self.configured(),
            "app_key_set": bool(self.app_key),
            "app_secret_set": bool(self.app_secret),
            "refresh_token_set": bool(self.refresh_token),
        }

    # -- auth -------------------------------------------------------------

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        if not self.configured():
            raise DropboxError(
                "Dropbox is not configured. DROPBOX_APP_KEY, "
                "DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN must all be set "
                "in the environment.")

        basic = base64.b64encode(
            f"{self.app_key}:{self.app_secret}".encode()).decode()
        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
        }).encode()
        req = urllib.request.Request(
            TOKEN_URL, data=body,
            headers={"Authorization": f"Basic {basic}",
                     "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout,
                                        context=CTX) as r:
                payload = json.loads(r.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            if exc.code in (400, 401):
                raise DropboxError(
                    "Dropbox refused the refresh token. It has been revoked, "
                    "or the app key and secret do not belong to the same app "
                    f"as the token. Dropbox said: {detail}") from exc
            raise DropboxError(
                f"Dropbox token request failed, HTTP {exc.code}: "
                f"{detail}") from exc
        except Exception as exc:                                # noqa: BLE001
            raise DropboxError(
                f"Could not reach Dropbox: {type(exc).__name__}") from exc

        token = payload.get("access_token", "")
        if not token:
            raise DropboxError("Dropbox returned no access token.")
        self._token = token
        self._token_expires = time.time() + max(
            60, int(payload.get("expires_in", 14400)) - TOKEN_SAFETY_SECONDS)
        return self._token

    # -- calls ------------------------------------------------------------

    def _rpc(self, url: str, payload: dict) -> dict:
        token = self._access_token()
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout,
                                        context=CTX) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            if exc.code == 409 and "not_found" in detail:
                raise DropboxError(
                    f"That folder does not exist in the Dropbox account: "
                    f"{payload.get('path', '')!r}") from exc
            raise DropboxError(
                f"Dropbox call failed, HTTP {exc.code}: {detail}") from exc
        except Exception as exc:                                # noqa: BLE001
            raise DropboxError(
                f"Could not reach Dropbox: {type(exc).__name__}") from exc

    def list_files(self, folder: str,
                   recursive: bool = False) -> list[DropboxFile]:
        """Files directly in a folder, or below it when recursive.

        An empty folder path means the root of the app's own folder, which is
        how Dropbox addresses it, so it is passed through as "".
        """
        path = (folder or "").strip()
        if path in ("/", "."):
            path = ""
        if path and not path.startswith("/"):
            path = "/" + path
        path = path.rstrip("/")

        payload = {"path": path, "recursive": bool(recursive),
                   "include_deleted": False,
                   "include_media_info": False,
                   "include_mounted_folders": True,
                   "limit": 2000}
        data = self._rpc(LIST_URL, payload)
        out: list[DropboxFile] = []

        def take(entries):
            for e in entries:
                if e.get(".tag") != "file":
                    continue
                out.append(DropboxFile(
                    path_lower=e.get("path_lower", ""),
                    path_display=e.get("path_display", ""),
                    name=e.get("name", ""),
                    rev=e.get("rev", ""),
                    content_hash=e.get("content_hash", ""),
                    size=int(e.get("size", 0)),
                    server_modified=e.get("server_modified", "")))

        take(data.get("entries", []))
        cursor = data.get("cursor")
        guard = 0
        while data.get("has_more") and cursor and guard < 50:
            guard += 1
            data = self._rpc(LIST_CONTINUE_URL, {"cursor": cursor})
            take(data.get("entries", []))
            cursor = data.get("cursor")
        return out

    def download(self, path: str) -> bytes:
        token = self._access_token()
        # The path travels in a header, so it has to be plain ASCII JSON.
        arg = json.dumps({"path": path}, ensure_ascii=True)
        req = urllib.request.Request(
            DOWNLOAD_URL, data=b"",
            headers={"Authorization": f"Bearer {token}",
                     "Dropbox-API-Arg": arg})
        try:
            with urllib.request.urlopen(req, timeout=max(self.timeout, 120),
                                        context=CTX) as r:
                return r.read(MAX_FILE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise DropboxError(
                f"Download of {path} failed, HTTP {exc.code}: "
                f"{detail}") from exc
        except Exception as exc:                                # noqa: BLE001
            raise DropboxError(
                f"Download of {path} failed: {type(exc).__name__}") from exc

    def download_to_file(self, path: str, dest_path: str,
                         max_bytes: int = MAX_FILE_BYTES) -> int:
        """Stream a Dropbox file to a local path, in blocks.

        Unlike download(), the body is never held in memory: it is written to
        disk as it arrives, which is what lets a multi-year logger export be
        ingested on a 320 MB container. Returns the number of bytes written and
        raises DropboxError if the file exceeds max_bytes.
        """
        token = self._access_token()
        arg = json.dumps({"path": path}, ensure_ascii=True)
        req = urllib.request.Request(
            DOWNLOAD_URL, data=b"",
            headers={"Authorization": f"Bearer {token}",
                     "Dropbox-API-Arg": arg})
        total = 0
        try:
            with urllib.request.urlopen(
                    req, timeout=max(self.timeout, 120), context=CTX) as r, \
                    open(dest_path, "wb") as fh:
                while True:
                    chunk = r.read(DOWNLOAD_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise DropboxError(
                            f"{path} is larger than the "
                            f"{max_bytes // 1048576} MB limit.")
                    fh.write(chunk)
        except DropboxError:
            raise
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise DropboxError(
                f"Download of {path} failed, HTTP {exc.code}: "
                f"{detail}") from exc
        except Exception as exc:                                # noqa: BLE001
            raise DropboxError(
                f"Download of {path} failed: {type(exc).__name__}") from exc
        return total


# ---------------------------------------------------------------------------
#  Streaming download + parse helpers
# ---------------------------------------------------------------------------

def _safe_unlink(path: str | None) -> None:
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


def _download_to_temp(client: "DropboxClient", path: str) -> str:
    """Download a Dropbox file to a temporary file on disk.

    Streams via download_to_file when the client supports it, so the body is
    never resident. Falls back to download() for a client that only exposes the
    in-memory method (the test double). Returns the temp path; the caller is
    responsible for deleting it. Deletes its own partial file on failure.
    """
    fd, tmp = tempfile.mkstemp(prefix="stratus-dat-", suffix=".dat")
    os.close(fd)
    try:
        if hasattr(client, "download_to_file"):
            client.download_to_file(path, tmp)
        else:
            data = client.download(path)
            with open(tmp, "wb") as fh:
                fh.write(data)
    except BaseException:
        _safe_unlink(tmp)
        raise
    return tmp


def _iter_text_lines(path: str) -> Iterator[str]:
    """Yield non-blank, newline-stripped lines from a file, decoded per line.

    Decoding one line at a time (utf-8, then latin-1 for the odd accented
    station name) means the whole file is never held as one string, and the
    blank-line filtering matches what the in-memory parser did with
    splitlines() + a truthiness check.
    """
    with open(path, "rb") as fh:
        for raw in fh:
            try:
                line = raw.decode("utf-8")
            except UnicodeDecodeError:
                line = raw.decode("latin-1", errors="replace")
            line = line.rstrip("\r\n")
            if line.strip():
                yield line


# ---------------------------------------------------------------------------
#  Polling one station
# ---------------------------------------------------------------------------

def poll_station(db: Database, station_id: int,
                 client: DropboxClient | None = None,
                 force: bool = False) -> PollResult:
    """Check a station's folder and ingest anything new.

    `force` ignores the stored revisions and re-downloads, which is the escape
    hatch for a file that was ingested while a column was misnamed.
    """
    result = PollResult(station_id=station_id)
    source = db.get_dropbox_source(station_id)
    if not source:
        result.status = "no folder configured"
        return result
    if not source["enabled"]:
        result.status = "disabled"
        return result

    station = db.get_station(station_id)
    if station is None:
        result.status = "station is gone"
        return result

    client = client or DropboxClient()
    if not client.configured():
        result.status = "Dropbox not configured"
        result.error = ("DROPBOX_APP_KEY, DROPBOX_APP_SECRET and "
                        "DROPBOX_REFRESH_TOKEN must be set on the server.")
        db.record_dropbox_poll(station_id, result.status, result.error, 0, 0)
        return result

    pattern = source["file_pattern"] or "*.dat"
    try:
        files = client.list_files(source["folder_path"])
    except DropboxError as exc:
        result.status = "failed"
        result.error = str(exc)
        db.record_dropbox_poll(station_id, result.status, result.error, 0, 0)
        return result

    matching = [f for f in files
                if fnmatch.fnmatch(f.name.lower(), pattern.lower())]
    result.checked = len(matching)

    if not matching:
        result.status = (f"no files matching {pattern} in "
                         f"{source['folder_path'] or 'the app folder'}")
        db.record_dropbox_poll(station_id, result.status, "", 0, 0)
        return result

    # Oldest first, so a station whose history is split across several exports
    # is loaded in order and the forecast is launched from the true last hour.
    matching.sort(key=lambda f: f.server_modified)

    for f in matching:
        if f.size > MAX_FILE_BYTES:
            result.warnings.append(
                f"{f.name} is {f.size / 1048576:.0f} MB, over the "
                f"{MAX_FILE_BYTES // 1048576} MB limit, so it was skipped.")
            continue
        if not force and db.dropbox_seen_rev(station_id,
                                             f.path_lower) == f.rev:
            result.skipped_unchanged += 1
            continue

        # Stream the file to disk, then parse it one line at a time straight
        # into the batched insert. Nothing here holds the whole file: not the
        # download (chunked to a temp file), not the parse (a generator), not
        # the insert (batched at 20k rows). This is what stopped the container
        # OOM-restarting on a multi-year Quaggasklip export.
        try:
            tmp_path = _download_to_temp(client, f.path_display or f.path_lower)
        except DropboxError as exc:
            result.warnings.append(str(exc))
            continue

        report = ingest.IngestReport()
        try:
            try:
                written = db.insert_observations(
                    station_id,
                    ingest.stream_parse(_iter_text_lines(tmp_path), report,
                                        dedup=False))
            except ingest.IngestError as exc:
                result.warnings.append(f"{f.name}: {exc}")
                # Recorded as seen so a permanently unreadable file is not
                # re-downloaded every fifteen minutes forever.
                db.record_dropbox_file(station_id, f.path_lower, f.rev,
                                       f.content_hash, f.size, 0)
                continue
        finally:
            _safe_unlink(tmp_path)

        db.record_upload(station_id, f.name,
                         f"dropbox:{f.rev}", report.rows_kept,
                         report.rows_skipped, report.first_timestamp,
                         report.last_timestamp,
                         {"source": "dropbox",
                          "path": f.path_display,
                          "mapped": report.mapped,
                          "warnings": report.warnings,
                          "conversions": report.conversions})
        db.record_dropbox_file(station_id, f.path_lower, f.rev,
                               f.content_hash, f.size, report.rows_kept)
        result.downloaded += 1
        result.rows_added += written
        result.files.append(f.name)
        result.warnings.extend(f"{f.name}: {w}" for w in report.warnings)

    if result.downloaded and source["auto_forecast"]:
        station = db.get_station(station_id)
        try:
            summaries = forecasting.run_all_horizons(db, station)
            result.forecasts_run = len(summaries)
        except forecasting.NotEnoughData as exc:
            result.warnings.append(f"No forecast yet: {exc}")

    if result.downloaded:
        result.status = (f"{result.downloaded} file(s) ingested, "
                         f"{result.rows_added:,} readings")
        if result.forecasts_run:
            result.status += f", {result.forecasts_run} forecasts refreshed"
    else:
        result.status = (f"up to date, {result.skipped_unchanged} file(s) "
                         f"unchanged")

    db.record_dropbox_poll(station_id, result.status,
                           "; ".join(result.warnings[:5]),
                           result.checked, result.rows_added)
    return result


def due_stations(db: Database, now: datetime | None = None) -> list[int]:
    """Stations whose interval has elapsed since the last poll."""
    from .db import from_db
    now = now or datetime.now()
    out = []
    for source in db.list_dropbox_sources(only_enabled=True):
        last = source.get("last_polled_at")
        if not last:
            out.append(int(source["station_id"]))
            continue
        try:
            elapsed = (now - from_db(last)).total_seconds()
        except (ValueError, TypeError):
            out.append(int(source["station_id"]))
            continue
        if elapsed >= int(source["interval_secs"]):
            out.append(int(source["station_id"]))
    return out


def poll_due(db: Database,
             client: DropboxClient | None = None) -> list[PollResult]:
    """One pass over everything that is due. Never raises."""
    client = client or DropboxClient()
    results = []
    for station_id in due_stations(db):
        try:
            results.append(poll_station(db, station_id, client=client))
        except Exception as exc:                                # noqa: BLE001
            # A single bad station must not stop the others, and must not take
            # the background task down with it.
            r = PollResult(station_id=station_id, status="failed",
                           error=f"{type(exc).__name__}: {exc}")
            try:
                db.record_dropbox_poll(station_id, r.status, r.error, 0, 0)
            except Exception:                                   # noqa: BLE001
                pass
            results.append(r)
    return results
