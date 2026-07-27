"""Background extraction worker with cooperative cancellation."""

from __future__ import annotations

import asyncio
from typing import Callable

from src.config import load_settings
from src.extractors.email_extractor import parse_domains
from src.extractors.url_fetcher import (
    extract_from_file_content,
    extract_from_urls,
    parse_url_list,
    read_local_file,
)
from src.models import (
    ExtractedEmail,
    ExtractionMode,
    ExtractionResult,
    ExtractionStats,
    LogLevel,
    SearchParams,
)
from src.search.web_search import web_search_and_extract


def _dedupe_emails(
    raw: list[tuple[str, str, str]],
) -> tuple[list[ExtractedEmail], ExtractionStats]:
    total_found = len(raw)
    seen: set[str] = set()
    unique: list[ExtractedEmail] = []
    for email, src, ctx in raw:
        key = email.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(ExtractedEmail.from_email(key, src, ctx))
    stats = ExtractionStats(total_found=total_found, unique_count=len(unique))
    return unique, stats


class ExtractionWorker:
    """Runs extraction in a background asyncio task."""

    def __init__(
        self,
        params: SearchParams,
        on_log: Callable[[LogLevel, str], None],
        on_progress: Callable[[str, int, int], None],
        on_complete: Callable[[ExtractionResult], None],
        on_cancelled: Callable[[ExtractionResult], None],
        on_error: Callable[[str], None],
    ) -> None:
        self.params = params
        self.on_log = on_log
        self.on_progress = on_progress
        self.on_complete = on_complete
        self.on_cancelled = on_cancelled
        self.on_error = on_error
        self._cancelled = False
        self._task: asyncio.Task | None = None

    def cancel(self) -> None:
        """Request cooperative cancellation — no forced task interrupt."""
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    def _finalize(self, raw: list[tuple[str, str, str]], max_results: int) -> ExtractionResult:
        unique, stats = _dedupe_emails(raw)
        return ExtractionResult(emails=unique[:max_results], stats=stats)

    async def _run(self) -> None:
        raw: list[tuple[str, str, str]] = []
        max_results = min(self.params.max_results, 500)

        try:
            domains = parse_domains(self.params.domains)

            def log(level_str: str, msg: str) -> None:
                self.on_log(LogLevel(level_str), msg)

            def progress(url: str, _msg: str) -> None:
                self.on_progress(url, len(raw), max_results)

            cancel = lambda: self._cancelled  # noqa: E731

            if self.params.mode == ExtractionMode.WEB_SEARCH:
                self.on_log(LogLevel.INFO, "Mode A: Public web search")
                settings = load_settings()
                raw = await web_search_and_extract(
                    self.params.subject,
                    self.params.location,
                    domains,
                    max_results,
                    settings,
                    on_progress=progress,
                    on_log=log,
                    cancel_check=cancel,
                )
            else:
                self.on_log(LogLevel.INFO, "Mode B: URLs / local files")

                urls = parse_url_list(self.params.url_list)
                if self.params.file_path and not self._cancelled:
                    try:
                        content, label = read_local_file(self.params.file_path)
                        self.on_log(LogLevel.SUCCESS, f"Loaded file: {label}")
                        file_results = extract_from_file_content(
                            content, label, domains, max_results
                        )
                        raw.extend(file_results)
                        for email, _, _ in file_results:
                            if self._cancelled:
                                break
                            self.on_log(LogLevel.INFO, f"Found: {email}")
                    except (FileNotFoundError, ValueError) as e:
                        self.on_log(LogLevel.ERROR, str(e))

                if self._cancelled:
                    result = self._finalize(raw, max_results)
                    self.on_log(
                        LogLevel.WARNING,
                        f"Cancelled — kept {result.stats.unique_count} unique email(s).",
                    )
                    self.on_cancelled(result)
                    return

                if urls and not self._cancelled:
                    self.on_log(LogLevel.INFO, f"Fetching {len(urls)} URL(s)…")
                    url_results = await extract_from_urls(
                        urls,
                        domains,
                        max_results - len(raw),
                        on_progress=progress,
                        on_log=log,
                        cancel_check=cancel,
                    )
                    raw.extend(url_results)

                if not urls and not self.params.file_path:
                    self.on_error("Provide URLs or a local file for Mode B extraction.")
                    return

            if self._cancelled:
                result = self._finalize(raw, max_results)
                self.on_log(
                    LogLevel.WARNING,
                    f"Cancelled — kept {result.stats.unique_count} unique email(s).",
                )
                self.on_cancelled(result)
                return

            result = self._finalize(raw, max_results)
            self.on_log(
                LogLevel.SUCCESS,
                f"Extraction complete — {result.stats.total_found} found, "
                f"{result.stats.unique_count} unique.",
            )
            self.on_complete(result)

        except Exception as e:
            self.on_error(str(e))
