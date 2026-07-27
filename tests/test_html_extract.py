"""Tests for HTML email extraction using fixtures."""

from pathlib import Path

from src.extractors.email_extractor import extract_emails_from_text

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_extract_from_fixture_regex_and_mailto():
    html = _read("sample_page.html")
    results = extract_emails_from_text(html, "https://example.com/team")
    emails = {r[0] for r in results}
    assert "lead.dev@gmail.com" in emails
    assert "support@outlook.com" in emails
    assert "ceo@yahoo.com" in emails
    assert len(emails) == 3


def test_context_snippet_length():
    html = _read("sample_page.html")
    results = extract_emails_from_text(html, "https://example.com/team")
    for _email, source, context in results:
        assert source == "https://example.com/team"
        assert len(context) <= 83


def test_mailto_extraction_from_fixture():
    html = _read("mailto_encoded.html")
    results = extract_emails_from_text(html, "http://x.com")
    assert results[0][0] == "contact@gmail.com"


def test_empty_input():
    assert extract_emails_from_text("") == []
    assert extract_emails_from_text("", allowed_domains=["gmail.com"]) == []
