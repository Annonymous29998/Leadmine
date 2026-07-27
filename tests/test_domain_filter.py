"""Tests for domain filtering."""

from src.extractors.email_extractor import (
    email_matches_domains,
    extract_emails_from_text,
    parse_domains,
)


def test_parse_domains_comma_separated():
    assert parse_domains("gmail.com, outlook.com, yahoo.com") == [
        "gmail.com",
        "outlook.com",
        "yahoo.com",
    ]


def test_parse_domains_strips_at():
    assert parse_domains("@gmail.com, @icloud.com") == ["gmail.com", "icloud.com"]


def test_email_matches_domains_exact():
    assert email_matches_domains("user@gmail.com", ["gmail.com"])
    assert not email_matches_domains("user@yahoo.com", ["gmail.com"])


def test_email_matches_domains_subdomain():
    assert email_matches_domains("user@mail.gmail.com", ["gmail.com"])


def test_filter_by_domain():
    html = "Contact: alice@gmail.com and bob@yahoo.com"
    results = extract_emails_from_text(html, "http://example.com", ["gmail.com"])
    emails = [r[0] for r in results]
    assert "alice@gmail.com" in emails
    assert "bob@yahoo.com" not in emails


def test_dedupe_lowercase():
    html = "A@gmail.com and a@gmail.com"
    results = extract_emails_from_text(html, "http://example.com", ["gmail.com"])
    assert len(results) == 1
    assert results[0][0] == "a@gmail.com"
