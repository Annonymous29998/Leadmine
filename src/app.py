"""LeadMine Extractor — main Textual application."""

from __future__ import annotations

from pathlib import Path

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Static

from src.models import ExtractionResult, LogLevel, SearchParams
from src.services.extraction_worker import ExtractionWorker
from src.widgets.common import (
    CommandPalette,
    FooterBar,
    SidebarNav,
    StatusBar,
)
from src.screens.search import SearchScreen
from src.screens.progress import ProgressScreen
from src.screens.results import ResultsScreen
from src.screens.export_screen import ExportScreen
from src.screens.settings import SettingsScreen
from src.screens.help import HelpScreen


class LeadMineApp(App):
    """LeadMine Extractor TUI."""

    TITLE = "LeadMine Extractor"
    CSS_PATH = Path(__file__).parent / "styles.tcss"

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("escape", "go_back", "Back"),
        Binding("slash", "command_palette", "Palette", show=False),
        Binding("ctrl+k", "command_palette", "Palette", show=False),
        Binding("f5", "start_extraction", "Start", show=False),
        Binding("e", "go_export", "Export", show=False),
        Binding("question_mark", "go_help", "Help", show=False),
        Binding("ctrl+c", "cancel_job", "Cancel", show=False, priority=True),
    ]

    SCREENS = {
        "search": SearchScreen,
        "progress": ProgressScreen,
        "results": ResultsScreen,
        "export": ExportScreen,
        "settings": SettingsScreen,
        "help": HelpScreen,
    }

    def __init__(self) -> None:
        super().__init__()
        self.results = []
        self.extraction_stats = None
        self.last_params: SearchParams | None = None
        self._worker: ExtractionWorker | None = None
        self._current_screen_id = "search"
        self._nav_history: list[str] = []
        self._extracting = False

    def compose(self) -> ComposeResult:
        with Horizontal(id="main-layout"):
            with Vertical(id="sidebar"):
                yield Static("LeadMine\nExtractor", id="sidebar-title")
                yield SidebarNav(id="sidebar-nav")
            with Container(id="content-area"):
                yield SearchScreen(id="screen-search")
        yield StatusBar()
        yield FooterBar()

    def on_mount(self) -> None:
        self._show_screen("search")

    def _get_screen_widget(self, screen_id: str):
        mapping = {
            "search": "#screen-search",
            "progress": "#screen-progress",
            "results": "#screen-results",
            "export": "#screen-export",
            "settings": "#screen-settings",
            "help": "#screen-help",
        }
        selector = mapping.get(screen_id)
        if selector:
            try:
                return self.query_one(selector)
            except Exception:
                pass
        return None

    def _ensure_screen_mounted(self, screen_id: str):
        widget = self._get_screen_widget(screen_id)
        if widget is not None:
            return widget

        cls = self.SCREENS[screen_id]
        container = self.query_one("#content-area", Container)
        widget = cls(id=f"screen-{screen_id}")
        container.mount(widget)
        return widget

    def _show_screen(self, screen_id: str, push_stack: bool = True) -> None:
        if screen_id not in self.SCREENS:
            return

        if push_stack and self._current_screen_id != screen_id:
            self._nav_history.append(self._current_screen_id)

        for sid in self.SCREENS:
            w = self._get_screen_widget(sid)
            if w is None and sid == screen_id:
                w = self._ensure_screen_mounted(sid)
            if w is not None:
                w.display = sid == screen_id

        self._current_screen_id = screen_id
        self.query_one(StatusBar).set_status(f"Screen: {screen_id.title()}")
        self.query_one(FooterBar).set_screen(screen_id)

    def _apply_result(self, result: ExtractionResult) -> None:
        self.results = result.emails
        self.extraction_stats = result.stats
        results = self._ensure_screen_mounted("results")
        results.load_results(result.emails, result.stats)

    def _clear_results(self) -> None:
        self.results = []
        self.extraction_stats = None
        self.last_params = None
        results = self._get_screen_widget("results")
        if results:
            results.clear_results()
        progress = self._get_screen_widget("progress")
        if progress:
            progress.clear_log()
            progress.set_running(False)
        self.query_one(StatusBar).set_status("Results cleared")

    def on_sidebar_nav_navigated(self, event: SidebarNav.Navigated) -> None:
        self._nav_history.clear()
        self._show_screen(event.screen_id, push_stack=False)

    def on_search_screen_start_extraction(self, event: SearchScreen.StartExtraction) -> None:
        self.last_params = event.params
        self._start_extraction(event.params)

    def _start_extraction(self, params: SearchParams) -> None:
        progress = self._ensure_screen_mounted("progress")
        self._show_screen("progress", push_stack=False)
        progress.clear_log()
        progress.set_running(True)
        progress.update_progress("", 0, params.max_results)

        if self._worker:
            self._worker.cancel()

        self._extracting = True
        self._worker = ExtractionWorker(
            params=params,
            on_log=self._on_log,
            on_progress=self._on_progress,
            on_complete=self._on_complete,
            on_cancelled=self._on_cancelled,
            on_error=self._on_error,
        )
        self._worker.start()
        self.query_one(StatusBar).set_status("Extracting…")

    def _on_log(self, level: LogLevel, message: str) -> None:
        progress = self._get_screen_widget("progress")
        if progress:
            progress.append_log(level, message)

    def _on_progress(self, url: str, found: int, max_results: int) -> None:
        progress = self._get_screen_widget("progress")
        if progress:
            progress.update_progress(url, found, max_results)

    def _finish_extraction(self) -> None:
        self._extracting = False
        progress = self._get_screen_widget("progress")
        if progress:
            progress.set_running(False)

    def _on_complete(self, result: ExtractionResult) -> None:
        self._finish_extraction()
        self._apply_result(result)
        self._show_screen("results", push_stack=False)
        s = result.stats
        self.query_one(StatusBar).set_status(
            f"Done — {s.total_found} found, {s.unique_count} unique"
        )

    def _on_cancelled(self, result: ExtractionResult) -> None:
        self._finish_extraction()
        if result.emails:
            self._apply_result(result)
            self._show_screen("results", push_stack=False)
            self.query_one(StatusBar).set_status(
                f"Cancelled — kept {result.stats.unique_count} unique email(s)"
            )
        else:
            self._show_screen("search", push_stack=False)
            self.query_one(StatusBar).set_status("Extraction cancelled")

    def _on_error(self, message: str) -> None:
        self._finish_extraction()
        progress = self._get_screen_widget("progress")
        if progress:
            progress.append_log(LogLevel.ERROR, message)
        self.query_one(StatusBar).set_status(f"Error: {message}")

    def on_export_screen_export_done(self, event: ExportScreen.ExportDone) -> None:
        paths = ", ".join(event.paths)
        self.query_one(StatusBar).set_status(f"Exported: {paths}")

    def on_settings_screen_settings_saved(self, event: SettingsScreen.SettingsSaved) -> None:
        self.query_one(StatusBar).set_status("Settings saved to .env")

    def on_command_palette_command_selected(
        self, event: CommandPalette.CommandSelected
    ) -> None:
        cmd = event.command_id
        palette = self.query(".CommandPalette")
        if palette:
            palette.first().remove()

        if cmd == "clear":
            self._clear_results()
            self._nav_history.clear()
            self._show_screen("search", push_stack=False)
        elif cmd in self.SCREENS:
            self._nav_history.clear()
            self._show_screen(cmd, push_stack=False)

    def action_command_palette(self) -> None:
        if self.query(".CommandPalette"):
            return
        self.mount(CommandPalette())

    def action_start_extraction(self) -> None:
        if self._current_screen_id == "search":
            search = self._get_screen_widget("search")
            if search:
                search.action_start()

    def action_go_export(self) -> None:
        self._show_screen("export")

    def action_go_help(self) -> None:
        self._show_screen("help")

    def action_go_back(self) -> None:
        if self._nav_history:
            prev = self._nav_history.pop()
            self._show_screen(prev, push_stack=False)
        else:
            self._show_screen("search", push_stack=False)

    def action_cancel_job(self) -> None:
        if self._worker and self._extracting:
            self._worker.cancel()
            progress = self._get_screen_widget("progress")
            if progress:
                progress.append_log(LogLevel.WARNING, "Cancellation requested…")
            self.query_one(StatusBar).set_status("Cancelling…")

    def on_key(self, event) -> None:
        if event.key == "enter" and self._current_screen_id == "export":
            export = self._get_screen_widget("export")
            if export:
                export.action_export()
                event.stop()
        elif event.key == "enter" and self._current_screen_id == "settings":
            settings = self._get_screen_widget("settings")
            if settings:
                settings.action_save()
                event.stop()
