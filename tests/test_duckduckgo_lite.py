"""Tests for DuckDuckGo Lite fallback search."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from src.models import AppSettings
from src.search.duckduckgo_lite import (
    DDG_LITE_MAX_PAGES,
    is_ddg_challenge_page,
    normalize_ddg_result_url,
    parse_ddg_lite_result_urls,
    search_duckduckgo_lite,
)
from src.search.web_search import DDG_FALLBACK_WARNING, resolve_search_urls

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parse_ddg_lite_result_urls():
    html = _read("ddg_lite_page1.html")
    urls = parse_ddg_lite_result_urls(html)
    assert urls == [
        "https://example.com/team",
        "https://acme.org/contact",
        "https://wrapped.example.net/page",
    ]


def test_normalize_ddg_redirect_url():
    href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwrapped.example.net%2Fpage"
    assert normalize_ddg_result_url(href) == "https://wrapped.example.net/page"


def test_challenge_page_detected_and_parsed_empty():
    html = _read("ddg_lite_challenge.html")
    assert is_ddg_challenge_page(html)
    assert parse_ddg_lite_result_urls(html) == []


def test_search_duckduckgo_lite_max_pages_and_delay():
    page1 = _read("ddg_lite_page1.html")
    page2 = _read("ddg_lite_page2.html")
    responses = [
        httpx.Response(200, text=page1, request=httpx.Request("POST", "https://lite.duckduckgo.com/lite/")),
        httpx.Response(200, text=page2, request=httpx.Request("POST", "https://lite.duckduckgo.com/lite/")),
        httpx.Response(200, text="<html></html>", request=httpx.Request("POST", "https://lite.duckduckgo.com/lite/")),
    ]
    call_count = 0

    async def mock_post(url, **kwargs):
        nonlocal call_count
        response = responses[min(call_count, len(responses) - 1)]
        call_count += 1
        return response

    sleep_mock = AsyncMock()
    logs: list[tuple[str, str]] = []

    async def run():
        with patch("src.search.duckduckgo_lite.httpx.AsyncClient") as client_cls:
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.__aexit__.return_value = None
            client.post = mock_post
            client_cls.return_value = client

            with patch("src.search.duckduckgo_lite.asyncio.sleep", sleep_mock):
                return await search_duckduckgo_lite(
                    "engineers Lagos",
                    max_results=10,
                    on_log=lambda level, msg: logs.append((level, msg)),
                    max_pages=DDG_LITE_MAX_PAGES,
                    delay=2.0,
                )

    urls = asyncio.run(run())

    assert urls == [
        "https://example.com/team",
        "https://acme.org/contact",
        "https://wrapped.example.net/page",
        "https://page-two.example.com/about",
    ]
    assert call_count == 2
    assert sleep_mock.await_count == 1
    sleep_mock.assert_awaited_with(2.0)


def test_resolve_search_urls_uses_ddg_when_no_api_keys():
    settings = AppSettings()
    page1 = _read("ddg_lite_page1.html")

    async def mock_post(url, **kwargs):
        return httpx.Response(
            200,
            text=page1,
            request=httpx.Request("POST", "https://lite.duckduckgo.com/lite/"),
        )

    logs: list[tuple[str, str]] = []

    async def run():
        with patch("src.search.duckduckgo_lite.httpx.AsyncClient") as client_cls:
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.__aexit__.return_value = None
            client.post = mock_post
            client_cls.return_value = client

            with patch("src.search.duckduckgo_lite.asyncio.sleep", AsyncMock()):
                return await resolve_search_urls(
                    "engineers Lagos",
                    10,
                    settings,
                    on_log=lambda level, msg: logs.append((level, msg)),
                )

    urls = asyncio.run(run())

    assert len(urls) == 3
    assert any(DDG_FALLBACK_WARNING in msg for _level, msg in logs)


def test_app_settings_uses_ddg_fallback_without_keys():
    assert AppSettings().uses_ddg_fallback is True
    assert AppSettings(serpapi_key="key").uses_ddg_fallback is False
