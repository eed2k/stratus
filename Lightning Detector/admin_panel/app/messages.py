"""SMS alert message text for lightning strikes."""
from datetime import datetime
from typing import Any, Dict, Optional

from .config import settings
from .timeutil import now_sast

_FOOTER = "Ensure all safety protocols are in place."


def _site_name(payload: Dict[str, Any]) -> str:
    """Display name for the location line (e.g. GLENCORE WONDERKOP)."""
    name = (settings.SITE_NAME or "").strip()
    if not name:
        name = str(payload.get("station_id") or "SITE").strip()
    return name.upper()


def _format_sent_at(when: Optional[datetime] = None) -> str:
    """SAST send time: dd/mm/yyyy HH:MM (24-hour)."""
    dt = when or now_sast()
    return dt.strftime("%d/%m/%Y %H:%M")


def build_lightning_sms(payload: Dict[str, Any], site_name: Optional[str] = None,
                        sent_at: Optional[datetime] = None) -> str:
    """Format a production lightning SMS from strike data.

    Distance and energy come from the Pi webhook payload. The timestamp in
    brackets is when the SMS is sent (SAST). Recipients are already
    filtered by each group's distance threshold before this is called.
    """
    site = (site_name or _site_name(payload)).strip().upper()
    try:
        dist = int(round(float(payload["distance_km"])))
    except (TypeError, ValueError, KeyError):
        dist = 0
    try:
        energy = int(payload["energy"])
    except (TypeError, ValueError, KeyError):
        energy = 0
    stamp = _format_sent_at(sent_at)
    return (
        f"LIGHTNING ALERT [{stamp}] Location: {site} "
        f"Distance {dist}km (Energy: {energy}). {_FOOTER}"
    )
