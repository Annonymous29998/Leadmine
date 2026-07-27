"""Mode A — public web search via SerpAPI, Google CSE, or DuckDuckGo Lite."""

from __future__ import annotations

import asyncio
from typing import Callable

import httpx

from src.config import WEB_SEARCH_RATE_LIMIT
from src.extractors.url_fetcher import extract_from_urls
from src.models import AppSettings
from src.search.duckduckgo_lite import (
    DDG_LITE_MAX_PAGES,
    search_duckduckgo_lite,
)
from src.search.query_builder import build_search_query

DDG_FALLBACK_WARNING = "unofficial — slower"


async def search_serpapi(
    query: str,
    api_key: str,
    max_results: int,
    on_log: Callable[[str, str], None] | None = None,
) -> list[str]:
    """Search via SerpAPI and return result URLs."""
    urls: list[str] = []
    start = 0
    per_page = min(10, max_results)

    async with httpx.AsyncClient(timeout=30.0) as client:
        while len(urls) < max_results:
            params = {
                "q": query,
                "api_key": api_key,
                "engine": "google",
                "num": per_page,
                "start": start,
            }
            response = await client.get("https://serpapi.com/search", params=params)
            response.raise_for_status()
            data = response.json()

            organic = data.get("organic_results", [])
            if not organic:
                break

            for item in organic:
                link = item.get("link")
                if link and link not in urls:
                    urls.append(link)
                    if len(urls) >= max_results:
                        break

            start += per_page
            if start >= max_results or len(organic) < per_page:
                break

            await asyncio.sleep(WEB_SEARCH_RATE_LIMIT)

    if on_log:
        on_log("INFO", f"SerpAPI returned {len(urls)} URLs")
    return urls[:max_results]


async def search_google_cse(
    query: str,
    api_key: str,
    cse_id: str,
    max_results: int,
    on_log: Callable[[str, str], None] | None = None,
) -> list[str]:
    """Search via Google Custom Search Engine and return result URLs."""
    urls: list[str] = []
    start_index = 1

    async with httpx.AsyncClient(timeout=30.0) as client:
        while len(urls) < max_results:
            num = min(10, max_results - len(urls))
            params = {
                "q": query,
                "key": api_key,
                "cx": cse_id,
                "num": num,
                "start": start_index,
            }
            response = await client.get(
                "https://www.googleapis.com/customsearch/v1", params=params
            )
            response.raise_for_status()
            data = response.json()

            items = data.get("items", [])
            if not items:
                break

            for item in items:
                link = item.get("link")
                if link and link not in urls:
                    urls.append(link)

            start_index += len(items)
            if len(items) < num:
                break

            await asyncio.sleep(WEB_SEARCH_RATE_LIMIT)

    if on_log:
        on_log("INFO", f"Google CSE returned {len(urls)} URLs")
    return urls[:max_results]


async def resolve_search_urls(
    query: str,
    max_results: int,
    settings: AppSettings,
    on_log: Callable[[str, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> list[str]:
    """Pick SerpAPI, Google CSE, or DuckDuckGo Lite and return result URLs."""
    if settings.search_provider == "serpapi" and settings.serpapi_key:
        return await search_serpapi(query, settings.serpapi_key, max_results, on_log)

    if settings.google_cse_key and settings.google_cse_id:
        return await search_google_cse(
            query,
            settings.google_cse_key,
            settings.google_cse_id,
            max_results,
            on_log,
        )

    if on_log:
        on_log(
            "WARNING",
            f"No API keys — using DuckDuckGo Lite fallback ({DDG_FALLBACK_WARNING}).",
        )
        on_log(
            "WARNING",
            f"DuckDuckGo Lite: max {DDG_LITE_MAX_PAGES} pages, "
            f"{int(WEB_SEARCH_RATE_LIMIT)}s delay between pages.",
        )

    return await search_duckduckgo_lite(
        query,
        max_results,
        on_log=on_log,
        cancel_check=cancel_check,
        max_pages=DDG_LITE_MAX_PAGES,
        delay=WEB_SEARCH_RATE_LIMIT,
    )


async def web_search_and_extract(
    subject: str,
    location: str,
    domains: list[str],
    max_results: int,
    settings: AppSettings,
    on_progress: Callable[[str, str], None] | None = None,
    on_log: Callable[[str, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> list[tuple[str, str, str]]:
    """Mode A: search web for URLs, then extract emails from each."""
    query = build_search_query(subject, location, domains)
    if on_log:
        on_log("INFO", f"Search query: {query}")

    try:
        urls = await resolve_search_urls(
            query, max_results, settings, on_log, cancel_check
        )
    except httpx.HTTPStatusError as e:
        if on_log:
            on_log("ERROR", f"Search API error: HTTP {e.response.status_code}")
        return []
    except Exception as e:
        if on_log:
            on_log("ERROR", f"Search failed: {e}")
        return []

    if cancel_check and cancel_check():
        return []

    if on_log:
        on_log("INFO", f"Extracting emails from {len(urls)} pages…")

    return await extract_from_urls(
        urls,
        domains,
        max_results,
        on_progress=on_progress,
        on_log=on_log,
        cancel_check=cancel_check,
    )
