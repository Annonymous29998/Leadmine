"""HTTP URL fetching and local file reading for Mode B."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import httpx

from src.config import FETCH_TIMEOUT
from src.extractors.email_extractor import extract_emails_from_text

SUPPORTED_EXTENSIONS = {".html", ".htm", ".txt", ".csv"}


def parse_url_list(text: str) -> list[str]:
    """Parse multiline URL list, one URL per line."""
    urls: list[str] = []
    for line in text.strip().splitlines():
        line = line.strip()
        if line and (line.startswith("http://") or line.startswith("https://")):
            urls.append(line)
    return urls


def read_local_file(path: str) -> tuple[str, str]:
    """Read local file; returns (content, source_label)."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    if p.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: {p.suffix}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    content = p.read_text(encoding="utf-8", errors="replace")
    return content, f"file://{p}"


async def fetch_url(client: httpx.AsyncClient, url: str) -> tuple[str, str]:
    """Fetch URL content. Returns (content, url). Raises on failure."""
    response = await client.get(
        url,
        timeout=FETCH_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "LeadMine-Extractor/1.0 (public-data-only)"},
    )
    response.raise_for_status()
    return response.text, str(response.url)


async def extract_from_urls(
    urls: list[str],
    allowed_domains: list[str],
    max_results: int,
    on_progress: Callable[[str, str], None] | None = None,
    on_log: Callable[[str, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> list[tuple[str, str, str]]:
    """
    Fetch each URL and extract emails.
    Returns list of (email, source_url, context).
    """
    seen: set[str] = set()
    results: list[tuple[str, str, str]] = []

    async with httpx.AsyncClient() as client:
        for url in urls:
            if cancel_check and cancel_check():
                break
            if len(results) >= max_results:
                break

            if on_progress:
                on_progress(url, f"Fetching {url}")

            try:
                content, final_url = await fetch_url(client, url)
                if on_log:
                    on_log("SUCCESS", f"Fetched {final_url} ({len(content)} bytes)")

                for email, src, ctx in extract_emails_from_text(
                    content, final_url, allowed_domains
                ):
                    if email not in seen:
                        seen.add(email)
                        results.append((email, src, ctx))
                        if on_log:
                            on_log("INFO", f"Found: {email}")
                        if len(results) >= max_results:
                            break

            except httpx.TimeoutException:
                if on_log:
                    on_log("WARNING", f"Timeout fetching {url}")
            except httpx.HTTPStatusError as e:
                if on_log:
                    on_log("ERROR", f"HTTP {e.response.status_code} for {url}")
            except Exception as e:
                if on_log:
                    on_log("ERROR", f"Failed {url}: {e}")

    return results[:max_results]


def extract_from_file_content(
    content: str,
    source_label: str,
    allowed_domains: list[str],
    max_results: int,
) -> list[tuple[str, str, str]]:
    """Extract emails from local file content."""
    raw = extract_emails_from_text(content, source_label, allowed_domains)
    return raw[:max_results]
