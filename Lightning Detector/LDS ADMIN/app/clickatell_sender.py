"""Clickatell One API SMS sending helper used by the background alert worker.

This deployment is SMS-only (smelting-plant safety alerts). WhatsApp is not
used. Single endpoint via Clickatell's One API:
    POST https://platform.clickatell.com/v1/message
    Authorization: <CLICKATELL_API_KEY>

Returns (status, provider_message_id) so the worker can persist them.
Raises on hard failure (the worker logs and marks the row failed).
"""
from typing import Tuple
import requests

from .config import settings


API_URL = "https://platform.clickatell.com/v1/message"
TIMEOUT_SECONDS = 15


def send_sms(to_number: str, body: str) -> Tuple[str, str]:
    """Send a single SMS via Clickatell. Returns (status, provider_message_id)."""
    if not settings.CLICKATELL_API_KEY:
        raise RuntimeError("Clickatell API key not configured")

    headers = {
        "Authorization": settings.CLICKATELL_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "messages": [
            {
                "channel": "sms",
                "to": to_number,           # E.164, e.g. +27821234567
                "content": body,
            }
        ]
    }
    resp = requests.post(API_URL, json=payload, headers=headers,
                         timeout=TIMEOUT_SECONDS)
    resp.raise_for_status()
    data = resp.json() or {}
    msgs = data.get("messages") or []
    if not msgs:
        raise RuntimeError(f"Clickatell returned no messages: {data}")
    m = msgs[0]
    accepted = bool(m.get("accepted"))
    msg_id = str(m.get("apiMessageId") or "")
    if not accepted:
        err = m.get("error") or m.get("errorDescription") or "rejected"
        raise RuntimeError(f"Clickatell rejected: {err}")
    return "queued", msg_id
