"""Time helpers for the admin panel.

The detector and its recipients are in South Africa, so the panel stores
and displays everything in South African Standard Time (SAST, UTC+2, no
DST) rather than UTC. DB columns are naive datetimes, so the stored value
is naive SAST.
"""
from datetime import datetime, timezone, timedelta

SAST = timezone(timedelta(hours=2), name="SAST")


def now_sast() -> datetime:
    """Current SAST time as a naive datetime suitable for DB storage."""
    return datetime.now(SAST).replace(tzinfo=None)
