"""Sending e-mail through Resend (https://resend.com/docs/api-reference/emails/send-email).

One function, `send_email`. It never raises: a mail problem must not break sign-up or "forgot password", and the caller
cannot do anything useful about it anyway. Failures are logged without the key or the message body (the body holds a link
that works as a password).

Without RESEND_API_KEY nothing is sent. The subject and the link are logged instead, so the flow can be tried on a laptop.
"""

from __future__ import annotations

import html
import logging

import httpx

from app.core.config import Settings

log = logging.getLogger("snackstream.mail")
RESEND_URL = "https://api.resend.com/emails"


def send_email(settings: Settings, to: str, subject: str, text: str, html_body: str | None = None) -> bool:
    """Send one message. Returns True if Resend accepted it (or in log-only mode)."""
    if not settings.mail_enabled:
        log.warning("MAIL (not sent, RESEND_API_KEY is empty) to=%s subject=%s\n%s", to, subject, text)
        return True
    try:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key.get_secret_value()}"},
            json={
                "from": settings.mail_from,
                "to": [to],
                "subject": subject,
                "text": text,
                **({"html": html_body} if html_body else {}),
            },
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        log.error("mail to %s failed: %s", to, type(exc).__name__)
        return False
    if response.status_code >= 300:
        # Resend's error body says why (for example "you can only send testing emails to your own email address").
        log.error("mail to %s refused by Resend: HTTP %s %s", to, response.status_code, response.text[:300])
        return False
    return True


def render_action_email(heading: str, intro: str, button: str, link: str, footer: str) -> tuple[str, str]:
    """A plain, readable message in two forms: (text, html). Inline styles only: mail clients ignore stylesheets."""
    text = f"{heading}\n\n{intro}\n\n{button}: {link}\n\n{footer}\n\nSnackStream"
    h, i, b, ln, f = (html.escape(x) for x in (heading, intro, button, link, footer))
    page = f"""<!doctype html><html lang="vi"><body style="margin:0;background:#fff8ea;font-family:Arial,Helvetica,sans-serif;color:#241811">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:20px;font-weight:800"><span style="color:#241811">Snack</span><span style="color:#c8321c">Stream</span></p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">{h}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#6b5848">{i}</p>
<p style="margin:0 0 24px"><a href="{ln}" style="display:inline-block;background:#241811;color:#fff8ea;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">{b}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b5848">Nếu nút không bấm được, hãy dán đường dẫn này vào trình duyệt:<br><a href="{ln}" style="color:#c8321c;word-break:break-all">{ln}</a></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#6b5848">{f}</p>
</td></tr></table></td></tr></table></body></html>"""
    return text, page
