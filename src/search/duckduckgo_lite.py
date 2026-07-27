"""DuckDuckGo Lite fallback search — no API key required."""

from __future__ import annotations

import asyncio
import re
from typing import Callable
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from src.config import WEB_SEARCH_RATE_LIMIT

DDG_LITE_URL = "https://lite.duckduckgo.com/lite/"
DDG_LITE_MAX_PAGES = 3
DDG_LITE_USER_AGENT = (
    "Mozilla/5.0 (compatible; LeadMine-Extractor/1.0; +public-data-only)"
)

_EXTERNAL_LINK_RE = re.compile(
    r"""<a[^>]+href=["']([^"']+)["']""",
    re.IGNORECASE,
)


def is_ddg_challenge_page(html: str) -> bool:
    """Return True when DDG serves a CAPTCHA / anomaly challenge."""
    markers = ("anomaly-modal", "challenge-form", "error-lite@duckduckgo.com")
    return any(marker in html for marker in markers)


def normalize_ddg_result_url(href: str) -> str | None:
    """Normalize a DDG lite result href to a plain HTTP(S) URL."""
    href = href.strip()
    if not href:
        return None

    if href.startswith("//"):
        href = f"https:{href}"

    if "duckduckgo.com/l/" in href and "uddg=" in href:
        parsed = urlparse(href)
        uddg = parse_qs(parsed.query).get("uddg", [None])[0]
        if uddg:
            href = unquote(uddg)
        else:
            return None

    if "duckduckgo.com" in href:
        return None

    if href.startswith("http://") or href.startswith("https://"):
        return href

    return None


def parse_ddg_lite_result_urls(html: str) -> list[str]:
    """Extract external result URLs from a DuckDuckGo Lite HTML page."""
    if is_ddg_challenge_page(html):
        return []

    seen: set[str] = set()
    urls: list[str] = []
    for match in _EXTERNAL_LINK_RE.finditer(html):
        normalized = normalize_ddg_result_url(match.group(1))
        if normalized and normalized not in seen:
            seen.add(normalized)
            urls.append(normalized)
    return urls


def _page_post_data(query: str, offset: int) -> dict[str, str]:
    data = {"q": query}
    if offset > 0:
        data.update(
            {
                "s": str(offset),
                "nextParams": "",
                "v": "l",
                "o": "json",
                "dc": str(offset + 1),
                "api": "d.js",
            }
        )
    return data


async def search_duckduckgo_lite(
    query: str,
    max_results: int,
    on_log: Callable[[str, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    max_pages: int = DDG_LITE_MAX_PAGES,
    delay: float = WEB_SEARCH_RATE_LIMIT,
) -> list[str]:
    """
    Search DuckDuckGo Lite HTML endpoint (unofficial fallback).
    Fetches up to max_pages with delay seconds between page requests.
    """
    urls: list[str] = []
    offset = 0
    headers = {"User-Agent": DDG_LITE_USER_AGENT}

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for page in range(1, max_pages + 1):
            if cancel_check and cancel_check():
                break
            if len(urls) >= max_results:
                break

            if page > 1:
                await asyncio.sleep(delay)

            if on_log:
                on_log("INFO", f"DuckDuckGo Lite page {page}/{max_pages}…")

            response = await client.post(
                DDG_LITE_URL,
                data=_page_post_data(query, offset),
                headers=headers,
            )
            response.raise_for_status()
            html = response.text

            if is_ddg_challenge_page(html):
                if on_log:
                    on_log(
                        "WARNING",
                        "DuckDuckGo Lite returned a challenge page — try again later.",
                    )
                break

            page_urls = parse_ddg_lite_result_urls(html)
            if not page_urls:
                break

            for url in page_urls:
                if url not in urls:
                    urls.append(url)
                    if len(urls) >= max_results:
                        break

            if len(page_urls) < 2:
                break

            offset += len(page_urls)

    if on_log:
        on_log("INFO", f"DuckDuckGo Lite returned {len(urls)} URL(s)")
    return urls[:max_results]
