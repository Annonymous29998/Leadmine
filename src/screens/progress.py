"""Progress screen — spinner, count, URL, scrollable log."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Label, Static

from src.models import LogLevel
from src.screens.base import ScreenPanel
from src.widgets.common import PanelTitle


LOG_COLORS = {
    LogLevel.INFO: "#58a6ff",
    LogLevel.SUCCESS: "#3fb950",
    LogLevel.WARNING: "#d29922",
    LogLevel.ERROR: "#f85149",
}


class ProgressScreen(ScreenPanel):
    """Shows extraction progress and log output."""

    def compose(self) -> ComposeResult:
        yield PanelTitle("Progress")
        yield Static("⠋ Extracting…", id="progress-spinner")
        yield Label("Found: 0 / 0", id="progress-count")
        yield Label("", id="progress-url")
        with VerticalScroll(id="log-view"):
            yield Static("", id="log-content")

    def set_running(self, running: bool) -> None:
        spinner = self.query_one("#progress-spinner", Static)
        spinner.update("⠋ Extracting…" if running else "Done")

    def update_progress(self, url: str, found: int, max_results: int) -> None:
        self.query_one("#progress-count", Label).update(
            f"Found: {found} / {max_results}"
        )
        display_url = url if len(url) <= 80 else url[:77] + "…"
        self.query_one("#progress-url", Label).update(f"Current: {display_url}")

    def append_log(self, level: LogLevel, message: str) -> None:
        log = self.query_one("#log-content", Static)
        color = LOG_COLORS.get(level, "#e0e0e0")
        tag = f"[{level.value}]"
        current = log.renderable if hasattr(log, "renderable") else ""
        line = f"[{color}]{tag}[/] {message}\n"
        if isinstance(current, str):
            log.update(current + line)
        else:
            log.update(line)

    def clear_log(self) -> None:
        self.query_one("#log-content", Static).update("")
        self.query_one("#progress-count", Label).update("Found: 0 / 0")
        self.query_one("#progress-url", Label).update("")
