"""Dropbox feed tests.

Nothing here touches the network. The client's two network methods are replaced
with recorded behavior, which is what lets the change-detection and ingest
logic be tested without credentials or quota.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import dropbox_sync, ingest
from app.db import from_db

from conftest import make_toa5


class FakeDropbox(dropbox_sync.DropboxClient):
    """A client backed by an in-memory folder."""

    def __init__(self, files: dict[str, tuple[str, str]]):
        # files maps path -> (rev, text)
        super().__init__(app_key="k", app_secret="s", refresh_token="r")
        self.files = files
        self.downloads: list[str] = []
        self.listings = 0

    def configured(self) -> bool:
        return True

    def list_files(self, folder, recursive=False):
        self.listings += 1
        out = []
        for i, (path, (rev, text)) in enumerate(sorted(self.files.items())):
            out.append(dropbox_sync.DropboxFile(
                path_lower=path.lower(), path_display=path,
                name=path.rsplit("/", 1)[-1], rev=rev,
                content_hash=f"hash-{rev}", size=len(text.encode()),
                server_modified=f"2026-01-0{i + 1}T00:00:00Z"))
        return out

    def download(self, path):
        self.downloads.append(path)
        for p, (_rev, text) in self.files.items():
            if p.lower() == path.lower():
                return text.encode()
        raise dropbox_sync.DropboxError(f"not found: {path}")

    def download_to_file(self, path, dest_path, max_bytes=None):
        # Model the streaming download using the in-memory content, so the
        # download-tracking and failure behavior above still apply. poll_station
        # streams to a temp file; the double writes the same bytes to it.
        data = self.download(path)
        with open(dest_path, "wb") as fh:
            fh.write(data)
        return len(data)


@pytest.fixture
def station(database):
    sid = database.upsert_station("feed", "Feed Site", "CR1000X")
    return sid


def _enable(database, sid, pattern="*.dat", auto=False, minutes=15):
    database.upsert_dropbox_source(sid, folder_path="/StratusData",
                                  file_pattern=pattern, enabled=True,
                                  interval_secs=minutes * 60,
                                  auto_forecast=auto)


# ---------------------------------------------------------------------------
#  Configuration gating
# ---------------------------------------------------------------------------

def test_unconfigured_client_reports_itself(monkeypatch):
    for var in ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    c = dropbox_sync.DropboxClient()
    assert c.configured() is False
    assert c.describe()["configured"] is False


def test_a_partial_configuration_is_not_configured(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "k")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "s")
    monkeypatch.delenv("DROPBOX_REFRESH_TOKEN", raising=False)
    assert dropbox_sync.DropboxClient().configured() is False


def test_token_request_without_credentials_raises_a_readable_error(monkeypatch):
    for var in ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(dropbox_sync.DropboxError, match="not configured"):
        dropbox_sync.DropboxClient()._access_token()


def test_no_source_configured_is_a_no_op(database, station):
    r = dropbox_sync.poll_station(database, station, client=FakeDropbox({}))
    assert r.status == "no folder configured"
    assert r.downloaded == 0


def test_disabled_source_is_not_polled(database, station):
    database.upsert_dropbox_source(station, "/x", "*.dat", enabled=False,
                                  interval_secs=900, auto_forecast=False)
    r = dropbox_sync.poll_station(database, station, client=FakeDropbox({}))
    assert r.status == "disabled"


def test_unconfigured_dropbox_is_reported_on_the_station(database, station,
                                                        monkeypatch):
    for var in ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    _enable(database, station)
    r = dropbox_sync.poll_station(database, station)
    assert "not configured" in r.status
    assert "DROPBOX_APP_KEY" in r.error
    stored = database.get_dropbox_source(station)
    assert "not configured" in stored["last_status"]


# ---------------------------------------------------------------------------
#  Ingest
# ---------------------------------------------------------------------------

def test_a_new_file_is_downloaded_and_ingested(database, station):
    _enable(database, station)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=48))})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.downloaded == 1
    assert r.rows_added > 0
    assert database.observation_count(station) == r.rows_added
    assert "site.dat" in r.files


def test_an_unchanged_file_is_not_downloaded_again(database, station):
    """The whole reason revisions are stored."""
    _enable(database, station)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    assert len(client.downloads) == 1

    second = dropbox_sync.poll_station(database, station, client=client)
    assert len(client.downloads) == 1, "must not re-download an unchanged file"
    assert second.downloaded == 0
    assert second.skipped_unchanged == 1
    assert "up to date" in second.status


def test_a_new_revision_is_picked_up(database, station):
    _enable(database, station)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    first_count = database.observation_count(station)

    # The logger appended: same path, new revision, more hours.
    client.files["/StratusData/site.dat"] = ("rev2", make_toa5(hours=96))
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.downloaded == 1
    assert len(client.downloads) == 2
    assert database.observation_count(station) > first_count


def test_re_ingesting_an_overlapping_export_does_not_duplicate(database,
                                                              station):
    _enable(database, station)
    text = make_toa5(hours=48)
    client = FakeDropbox({"/StratusData/site.dat": ("rev1", text)})
    dropbox_sync.poll_station(database, station, client=client)
    count = database.observation_count(station)
    # Same content under a new revision, which is what a touched file looks
    # like. The rows must be corrected in place, not added twice.
    client.files["/StratusData/site.dat"] = ("rev2", text)
    dropbox_sync.poll_station(database, station, client=client)
    assert database.observation_count(station) == count


def test_force_re_reads_an_unchanged_file(database, station):
    _enable(database, station)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    dropbox_sync.poll_station(database, station, client=client, force=True)
    assert len(client.downloads) == 2


def test_only_matching_names_are_taken(database, station):
    _enable(database, station, pattern="*.dat")
    client = FakeDropbox({
        "/StratusData/site.dat": ("r1", make_toa5(hours=48)),
        "/StratusData/notes.txt": ("r2", "not a logger file"),
        "/StratusData/photo.jpg": ("r3", "binary-ish"),
    })
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.checked == 1
    assert client.downloads == ["/StratusData/site.dat"]


def test_a_pattern_that_matches_nothing_is_reported(database, station):
    _enable(database, station, pattern="*.csv")
    client = FakeDropbox({"/StratusData/site.dat":
                          ("r1", make_toa5(hours=48))})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.checked == 0
    assert "no files matching" in r.status
    assert client.downloads == []


def test_an_unreadable_file_is_recorded_so_it_is_not_retried_forever(database,
                                                                    station):
    _enable(database, station)
    client = FakeDropbox({"/StratusData/junk.dat": ("r1", "nonsense")})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.downloaded == 0
    assert any("junk.dat" in w for w in r.warnings)
    # Marked as seen, so the next poll does not fetch it again.
    again = dropbox_sync.poll_station(database, station, client=client)
    assert len(client.downloads) == 1
    assert again.skipped_unchanged == 1


def test_a_listing_failure_is_reported_not_raised(database, station):
    _enable(database, station)

    class Broken(FakeDropbox):
        def list_files(self, folder, recursive=False):
            raise dropbox_sync.DropboxError("folder does not exist")

    r = dropbox_sync.poll_station(database, station, client=Broken({}))
    assert r.status == "failed"
    assert "does not exist" in r.error


def test_a_download_failure_skips_one_file_only(database, station):
    _enable(database, station)

    class HalfBroken(FakeDropbox):
        def download(self, path):
            if "bad" in path:
                raise dropbox_sync.DropboxError("download refused")
            return super().download(path)

    client = HalfBroken({
        "/StratusData/a-bad.dat": ("r1", make_toa5(hours=48)),
        "/StratusData/b-good.dat": ("r2", make_toa5(hours=48)),
    })
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.downloaded == 1
    assert any("refused" in w for w in r.warnings)


def test_the_upload_is_recorded_with_its_dropbox_origin(database, station):
    _enable(database, station)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    uploads = database.list_uploads(station)
    assert uploads
    assert uploads[0]["sha256"].startswith("dropbox:")
    assert "dropbox" in uploads[0]["report_json"]


# ---------------------------------------------------------------------------
#  Auto-forecast
# ---------------------------------------------------------------------------

def test_auto_forecast_refreshes_all_three_horizons(database, station):
    _enable(database, station, auto=True)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=24 * 14))})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.forecasts_run == 3
    horizons = sorted(x["horizon_hours"] for x in
                      database.list_runs(station, limit=50))
    assert horizons == [24, 72, 120]


def test_auto_forecast_off_leaves_forecasts_alone(database, station):
    _enable(database, station, auto=False)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("rev1", make_toa5(hours=24 * 14))})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.forecasts_run == 0
    assert database.list_runs(station) == []


def test_auto_forecast_on_a_short_record_warns_rather_than_failing(database,
                                                                  station):
    _enable(database, station, auto=True)
    # Module temperature only: a product-tier weather column that ingests fine
    # but is not something the engine forecasts, so a forecast cannot be made.
    client = FakeDropbox({"/StratusData/mod.dat": (
        "r1",
        '"TOA5","X","CR1000","1","OS","P","1","T"\n'
        '"TIMESTAMP","RECORD","MOD_TEMP_Avg"\n'
        '"TS","RN","Deg C"\n'
        '"","","Avg"\n'
        + "".join(f'"2026-01-01 {h:02d}:00:00","{h}","20.0"\n'
                  for h in range(24)))})
    r = dropbox_sync.poll_station(database, station, client=client)
    assert r.downloaded == 1
    assert r.forecasts_run == 0
    assert any("No forecast yet" in w for w in r.warnings)


# ---------------------------------------------------------------------------
#  Scheduling
# ---------------------------------------------------------------------------

def test_a_never_polled_station_is_due(database, station):
    _enable(database, station)
    assert station in dropbox_sync.due_stations(database)


def test_a_just_polled_station_is_not_due(database, station):
    _enable(database, station, minutes=15)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("r1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    assert station not in dropbox_sync.due_stations(database)


def test_a_station_becomes_due_once_the_interval_elapses(database, station):
    _enable(database, station, minutes=15)
    client = FakeDropbox({"/StratusData/site.dat":
                          ("r1", make_toa5(hours=48))})
    dropbox_sync.poll_station(database, station, client=client)
    later = datetime.now() + timedelta(minutes=16)
    assert station in dropbox_sync.due_stations(database, now=later)


def test_disabled_stations_are_never_due(database, station):
    database.upsert_dropbox_source(station, "/x", "*.dat", enabled=False,
                                  interval_secs=60, auto_forecast=False)
    assert dropbox_sync.due_stations(database) == []


def test_poll_due_survives_a_station_that_explodes(database, station,
                                                  monkeypatch):
    """One bad station must not stop the loop or the others."""
    _enable(database, station)

    def boom(*_a, **_k):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(dropbox_sync, "poll_station", boom)
    results = dropbox_sync.poll_due(database, client=FakeDropbox({}))
    assert len(results) == 1
    assert results[0].status == "failed"
    assert "unexpected" in results[0].error


def test_interval_has_a_floor(database, station):
    database.upsert_dropbox_source(station, "/x", "*.dat", enabled=True,
                                  interval_secs=1, auto_forecast=False)
    stored = database.get_dropbox_source(station)
    assert stored["interval_secs"] >= 60


def test_settings_round_trip(database, station):
    database.upsert_dropbox_source(station, "  /Data/Potch  ", " *.dat ",
                                  enabled=True, interval_secs=1800,
                                  auto_forecast=True)
    s = database.get_dropbox_source(station)
    assert s["folder_path"] == "/Data/Potch"
    assert s["file_pattern"] == "*.dat"
    assert s["enabled"] == 1
    assert s["interval_secs"] == 1800
    assert s["auto_forecast"] == 1
    # Upsert, not insert: saving again replaces.
    database.upsert_dropbox_source(station, "/Other", "*.csv", enabled=False,
                                  interval_secs=600, auto_forecast=False)
    s2 = database.get_dropbox_source(station)
    assert s2["folder_path"] == "/Other"
    assert s2["enabled"] == 0


def test_deleting_a_station_removes_its_feed(database, station):
    _enable(database, station)
    database.delete_station(station)
    assert database.get_dropbox_source(station) is None
    assert database.list_dropbox_files(station) == []
