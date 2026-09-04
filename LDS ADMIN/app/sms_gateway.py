"""SMS gateway client used by the background alert worker.

Deliberately named for the job rather than the supplier. The provider is an
implementation detail of the platform, and its name used to reach client screens
through two routes: the settings page, and - less obviously - the text of a
failed send, which is stored on the message log and rendered on the event detail
page that a client can open. Nothing here puts a supplier name in front of a
client.

This deployment is SMS only. The recipient table still carries legacy `whatsapp`
and `channel` columns, but nothing reads them.

Returns (status, provider_message_id) so the worker can persist both. Raises on
hard failure; the worker logs it and marks the row failed.
"""
from typing import Tuple
import requests

from .config import settings


TIMEOUT_SECONDS = 15


def send_sms(to_number: str, body: str) -> Tuple[str, str]:
    """Send one SMS. Returns (status, provider_message_id).

    Error messages are written for whoever reads the message log, which includes
    clients, so they describe what went wrong operationally and never name the
    supplier or echo its raw payload.
    """
    api_key = settings.sms_api_key
    if not api_key:
        raise RuntimeError("SMS gateway is not configured")
    if not settings.SMS_GATEWAY_URL:
        raise RuntimeError("SMS gateway endpoint is not configured")

    headers = {
        "Authorization": api_key,
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
    resp = requests.post(settings.SMS_GATEWAY_URL, json=payload, headers=headers,
                         timeout=TIMEOUT_SECONDS)
    resp.raise_for_status()
    data = resp.json() or {}
    msgs = data.get("messages") or []
    if not msgs:
        # The upstream body is logged for diagnosis but kept out of the message
        # the client sees.
        raise RuntimeError("SMS gateway accepted the request but returned no "
                           "message record")
    m = msgs[0]
    accepted = bool(m.get("accepted"))
    msg_id = str(m.get("apiMessageId") or "")
    if not accepted:
        err = m.get("error") or m.get("errorDescription") or "rejected"
        raise RuntimeError(f"SMS gateway rejected the message: {err}")
    return "queued", msg_id
