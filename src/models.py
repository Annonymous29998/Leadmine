"""Shared data models."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class ExtractionMode(str, Enum):
    URLS = "urls"
    WEB_SEARCH = "web_search"


class LogLevel(str, Enum):
    INFO = "INFO"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"
    ERROR = "ERROR"


@dataclass
class LogEntry:
    level: LogLevel
    message: str


@dataclass
class SearchParams:
    subject: str
    location: str = ""
    domains: list[str] = field(default_factory=list)
    max_results: int = 100
    mode: ExtractionMode = ExtractionMode.URLS
    url_list: str = ""
    file_path: str = ""


@dataclass
class ExtractedEmail:
    email: str
    domain: str
    source_url: str
    context: str

    @classmethod
    def from_email(cls, email: str, source_url: str, context: str) -> ExtractedEmail:
        parts = email.rsplit("@", 1)
        domain = parts[1] if len(parts) == 2 else ""
        return cls(email=email, domain=domain, source_url=source_url, context=context)


@dataclass
class ExtractionStats:
    total_found: int
    unique_count: int

    @property
    def duplicates_removed(self) -> int:
        return max(0, self.total_found - self.unique_count)


@dataclass
class ExtractionResult:
    emails: list[ExtractedEmail]
    stats: ExtractionStats


@dataclass
class AppSettings:
    serpapi_key: str = ""
    google_cse_key: str = ""
    google_cse_id: str = ""
    search_provider: str = "serpapi"  # serpapi | google_cse

    @property
    def has_api_keys(self) -> bool:
        return bool(self.serpapi_key) or bool(
            self.google_cse_key and self.google_cse_id
        )

    @property
    def has_web_search(self) -> bool:
        """Mode A is always available — API keys or DuckDuckGo Lite fallback."""
        return True

    @property
    def uses_ddg_fallback(self) -> bool:
        return not self.has_api_keys
