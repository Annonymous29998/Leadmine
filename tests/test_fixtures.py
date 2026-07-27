"""Tests for duplicate detection via fixtures."""

from pathlib import Path

from src.extractors.email_extractor import extract_emails_from_text

FIXTURES = Path(__file__).parent / "fixtures"


def test_fixture_duplicate_emails_deduped_in_extractor():
    html = (FIXTURES / "duplicate_emails.html").read_text(encoding="utf-8")
    results = extract_emails_from_text(html, "http://example.com", ["gmail.com"])
    emails = [r[0] for r in results]
    assert len(emails) == 2
    assert emails.count("alice@gmail.com") == 1
    assert "bob@gmail.com" in emails
