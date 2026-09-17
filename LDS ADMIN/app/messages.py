"""SMS alert message text for lightning strikes."""
from datetime import datetime
from typing import Any, Dict, Optional

from .config import settings
from .timeutil import now_sast

_FOOTER = "Ensure all safety protocols are in place."


def _site_name(payload: Dict[str, Any]) -> str:
    """Last-resort location label, from the detector's own reported station_id.

    Callers are expected to pass an explicit site_name resolved from the owning
    client (see alert_worker.resolve_site_name). This path exists only so a
    message still says something truthful if they do not.

    It used to fall back to a deployment-wide SITE_NAME, which named whichever
    client the panel was first set up for and so mislabelled every other client's
    alerts. The station_id is at least reported by the unit that saw the strike,
    so it can never name the wrong client.
    """
    name = str(payload.get("station_id") or "").strip()
    return (name or "SITE").upper()


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
