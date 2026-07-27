"""Tests for rich Markdown export."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.export.writers import export_markdown, utc_timestamp
from src.models import ExtractedEmail, ExtractionMode, ExtractionStats, SearchParams


@pytest.fixture
def sample_params() -> SearchParams:
    return SearchParams(
        subject="engineers",
        location="Lagos",
        domains=["gmail.com", "outlook.com"],
        max_results=100,
        mode=ExtractionMode.URLS,
    )


@pytest.fixture
def sample_emails() -> list[ExtractedEmail]:
    return [
        ExtractedEmail(
            email="dev@gmail.com",
            domain="gmail.com",
            source_url="https://example.com",
            context="Contact dev@gmail.com for info",
        )
    ]


def test_markdown_contains_query_metadata_and_utc(
    tmp_path, sample_params, sample_emails
):
    stats = ExtractionStats(total_found=2, unique_count=1)
    path = export_markdown(
        sample_emails, sample_params, stats=stats, export_dir=tmp_path
    )
    content = path.read_text(encoding="utf-8")

    assert "# LeadMine Extractor Report" in content
    assert "## Query Metadata" in content
    assert "| **Subject / role** | engineers |" in content
    assert "| **Location** | Lagos |" in content
    assert "gmail.com" in content
    assert "**Exported (UTC):**" in content
    assert utc_timestamp()[:10] in content  # date portion
    assert "## Summary" in content
    assert "**Total found:** 2" in content
    assert "**Unique emails:** 1" in content
    assert "**Duplicates removed:** 1" in content
    assert "dev@gmail.com" in content
    assert "CAN-SPAM/GDPR" in content


def test_markdown_filename_pattern(tmp_path, sample_params, sample_emails):
    path = export_markdown(sample_emails, sample_params, export_dir=tmp_path)
    assert path.name.startswith("extract_engineers_lagos_")
    assert path.suffix == ".md"
