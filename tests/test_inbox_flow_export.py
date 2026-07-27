"""Tests for Inbox Flow contacts CSV export."""

from __future__ import annotations

import csv

import pytest

from src.export.writers import build_tags, export_inbox_flow_csv, names_from_email
from src.models import ExtractedEmail, ExtractionMode, SearchParams


@pytest.fixture
def sample_params() -> SearchParams:
    return SearchParams(
        subject="Marketing Manager",
        location="Lagos",
        domains=["gmail.com"],
        mode=ExtractionMode.URLS,
    )


@pytest.fixture
def sample_emails() -> list[ExtractedEmail]:
    return [
        ExtractedEmail(
            email="john.doe@gmail.com",
            domain="gmail.com",
            source_url="https://example.com/team",
            context="ctx",
        ),
        ExtractedEmail(
            email="jane@gmail.com",
            domain="gmail.com",
            source_url="file:///tmp/page.html",
            context="ctx",
        ),
    ]


def test_build_tags_subject_and_location():
    params = SearchParams(subject="CEO", location="London")
    assert build_tags(params) == "ceo_london"


def test_build_tags_subject_only():
    params = SearchParams(subject="Engineers", location="")
    assert build_tags(params) == "engineers"


def test_names_from_email():
    assert names_from_email("john.doe@gmail.com") == ("John", "Doe")
    assert names_from_email("jane@gmail.com") == ("Jane", "")
    assert names_from_email("mary_jane_watson@outlook.com") == ("Mary", "Jane Watson")


def test_inbox_flow_csv_columns_and_tags(tmp_path, sample_params, sample_emails):
    path = export_inbox_flow_csv(
        sample_emails, sample_params, export_dir=tmp_path
    )
    assert path.name.startswith("inbox_flow_contacts_marketing_manager_lagos_")

    with path.open(encoding="utf-8") as f:
        rows = list(csv.reader(f))

    assert rows[0] == ["email", "firstName", "lastName", "source", "tags"]
    assert rows[1] == [
        "john.doe@gmail.com",
        "John",
        "Doe",
        "https://example.com/team",
        "marketing_manager_lagos",
    ]
    assert rows[2] == [
        "jane@gmail.com",
        "Jane",
        "",
        "file:///tmp/page.html",
        "marketing_manager_lagos",
    ]
