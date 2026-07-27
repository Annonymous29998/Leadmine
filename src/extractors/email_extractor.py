"""Email extraction from HTML/text content."""

from __future__ import annotations

import re
from html import unescape
from urllib.parse import unquote

from src.config import CONTEXT_SNIPPET_LEN

# RFC 5322 simplified — practical extraction pattern
EMAIL_PATTERN = re.compile(
    r"""
    (?<![.\w])                          # not preceded by word char or dot
    [a-zA-Z0-9._%+\-]+                  # local part
    @
    [a-zA-Z0-9.\-]+                     # domain
    \.[a-zA-Z]{2,}                      # TLD
    (?![.\w])                           # not followed by word char or dot
    """,
    re.VERBOSE,
)

MAILTO_PATTERN = re.compile(
    r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE,
)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def parse_domains(domains_input: str | list[str]) -> list[str]:
    """Parse comma-separated domain string into normalized list."""
    if isinstance(domains_input, str):
        raw = domains_input.split(",")
    else:
        raw = domains_input
    return [d.strip().lower().lstrip("@") for d in raw if d.strip()]


def email_matches_domains(email: str, allowed_domains: list[str]) -> bool:
    """Return True if email domain is in allowed list (or list is empty)."""
    if not allowed_domains:
        return True
    parts = email.rsplit("@", 1)
    if len(parts) != 2:
        return False
    domain = parts[1].lower()
    return any(domain == d or domain.endswith(f".{d}") for d in allowed_domains)


def context_snippet(text: str, email: str, length: int = CONTEXT_SNIPPET_LEN) -> str:
    """Extract ~length char context around first occurrence of email."""
    idx = text.lower().find(email.lower())
    if idx == -1:
        clean = " ".join(text.split())
        return clean[:length] + ("…" if len(clean) > length else "")

    half = length // 2
    start = max(0, idx - half)
    end = min(len(text), idx + len(email) + half)
    snippet = text[start:end].strip()
    snippet = " ".join(snippet.split())
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet[: length + 3]


def extract_emails_from_text(
    text: str,
    source_url: str = "",
    allowed_domains: list[str] | None = None,
) -> list[tuple[str, str, str]]:
    """
    Extract emails from plain text or HTML.
    Returns list of (email, source_url, context) tuples, deduplicated lowercase.
    """
    if not text:
        return []

    decoded = unescape(text)
    seen: set[str] = set()
    results: list[tuple[str, str, str]] = []

    def add_email(raw: str) -> None:
        email = normalize_email(unquote(raw))
        if email in seen:
            return
        if not EMAIL_PATTERN.fullmatch(email):
            return
        if allowed_domains and not email_matches_domains(email, allowed_domains):
            return
        seen.add(email)
        ctx = context_snippet(decoded, email)
        results.append((email, source_url, ctx))

    for match in MAILTO_PATTERN.finditer(decoded):
        add_email(match.group(1))

    # mailto: links with URL-encoded @ (e.g. Contact%40Gmail.COM)
    encoded_mailto = re.compile(
        r"mailto:([a-zA-Z0-9._%+\-]+(?:%40|@)[a-zA-Z0-9.\-%]+(?:\.[a-zA-Z]{2,}))",
        re.IGNORECASE,
    )
    for match in encoded_mailto.finditer(decoded):
        add_email(match.group(1).replace("%40", "@"))

    for match in EMAIL_PATTERN.finditer(decoded):
        add_email(match.group(0))

    return results
