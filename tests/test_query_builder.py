"""Tests for search query builder."""

from src.search.query_builder import build_search_query, build_site_restricted_query


def test_build_search_query_with_all_fields():
    q = build_search_query("engineers", "Lagos", ["gmail.com", "outlook.com"])
    assert "engineers" in q
    assert "Lagos" in q
    assert '"@gmail.com"' in q
    assert '"@outlook.com"' in q
    assert " OR " in q


def test_build_search_query_subject_only():
    q = build_search_query("CEO", "", ["yahoo.com"])
    assert q.startswith("CEO")
    assert '"@yahoo.com"' in q


def test_build_search_query_domains_with_at():
    q = build_search_query("marketing", "Texas", ["@hotmail.com"])
    assert '"@hotmail.com"' in q


def test_build_site_restricted_query():
    q = build_site_restricted_query("engineers", "London")
    assert q == "engineers London"


def test_build_site_restricted_query_no_location():
    q = build_site_restricted_query("CEO", "")
    assert q == "CEO"
