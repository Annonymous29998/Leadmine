"""Tests for extraction dedupe stats."""

from src.services.extraction_worker import _dedupe_emails


def test_dedupe_stats_counts_total_and_unique():
    raw = [
        ("alice@gmail.com", "http://a.com", "ctx1"),
        ("ALICE@gmail.com", "http://b.com", "ctx2"),
        ("bob@gmail.com", "http://c.com", "ctx3"),
    ]
    emails, stats = _dedupe_emails(raw)
    assert stats.total_found == 3
    assert stats.unique_count == 2
    assert stats.duplicates_removed == 1
    assert {e.email for e in emails} == {"alice@gmail.com", "bob@gmail.com"}


def test_dedupe_no_duplicates():
    raw = [
        ("a@gmail.com", "http://a.com", "ctx"),
        ("b@yahoo.com", "http://b.com", "ctx"),
    ]
    _emails, stats = _dedupe_emails(raw)
    assert stats.total_found == 2
    assert stats.unique_count == 2
    assert stats.duplicates_removed == 0
