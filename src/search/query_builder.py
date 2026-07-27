"""Web search query builder for Mode A."""

from __future__ import annotations


def build_search_query(subject: str, location: str, domains: list[str]) -> str:
    """
    Build a public web search query from subject, location, and email domains.
    Example: engineers Lagos "@gmail.com" OR "@outlook.com"
    """
    parts: list[str] = []

    subject = subject.strip()
    if subject:
        parts.append(subject)

    location = location.strip()
    if location:
        parts.append(location)

    if domains:
        domain_clauses = [f'"{d}"' if "@" in d else f'"@{d.lstrip("@")}"' for d in domains]
        parts.append(" OR ".join(domain_clauses))

    return " ".join(parts)


def build_site_restricted_query(subject: str, location: str) -> str:
    """Build query without domain filters (used when domains filter post-fetch)."""
    parts = [subject.strip()]
    if location.strip():
        parts.append(location.strip())
    return " ".join(p for p in parts if p)
