"""SMS alert message text for lightning strikes."""
from datetime import datetime
from typing import Any, Dict, Optional

from .config import settings
from .timeutil import now_sast

_FOOTER = "Ensure all safety protocols are in place."


def _site_name(payload: Dict[str, Any]) -> str:
    """Display name for the location line, from SITE_NAME configuration."""
    name = (settings.SITE_NAME or "").strip()
    if not name:
        name = str(payload.get("station_id") or "SITE").strip()
    return name.upper()


def _format_sent_at(when: Optional[datetime] = None) -> str:
    """SAST send time: dd/mm/yyyy HH:MM (24-hour)."""
    dt = when or now_sast()
    return dt.strftime("%d/%m/%Y %H:%M")


def build_lightning_sms(payload: Dict[str, Any], site_name: Optional[str] = None,
                        sent_at: Optional[datetime] = None,
                        stage_name: Optional[str] = None) -> str:
    """Format a production lightning alert from strike data.

    Distance and energy come from the Pi webhook payload. The timestamp in
    brackets is when the message is sent (SAST). Recipients have already been
    selected before this is called.

    `stage_name` is the escalation step that fired, e.g. "Warning" or "Stop work".
    It leads the message because it is the part that tells the reader what to do:
    a distance alone requires them to remember the site's own thresholds. A client
    with no stages defined gets exactly the previous wording, unchanged.
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
    stage = (stage_name or "").strip().upper()
    heading = f"LIGHTNING {stage}" if stage else "LIGHTNING ALERT"
    return (
        f"{heading} [{stamp}] Location: {site} "
        f"Distance {dist}km (Energy: {energy}). {_FOOTER}"
    )
