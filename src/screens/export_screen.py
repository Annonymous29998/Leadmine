"""Export screen — choose formats and save."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.widgets import Button, Checkbox, Input, Static

from src.export.writers import EXPORTERS
from src.models import ExtractedEmail, ExtractionStats, SearchParams
from src.screens.base import ScreenPanel
from src.user_config import load_user_config, save_user_config
from src.widgets.common import FormLabel, PanelTitle, ValidationError


class ExportScreen(ScreenPanel):
    """Export results to CSV, JSON, TXT, Markdown."""

    class ExportDone(Message):
        def __init__(self, paths: list[str]) -> None:
            self.paths = paths
            super().__init__()

    def compose(self) -> ComposeResult:
        yield PanelTitle("Export")
        yield Static("Select export formats:", id="export-hint")
        with Vertical():
            yield Checkbox("CSV", value=True, id="fmt-csv")
            yield Checkbox("JSON", value=True, id="fmt-json")
            yield Checkbox("TXT (one email per line)", value=True, id="fmt-txt")
            yield Checkbox("Markdown report", value=True, id="fmt-md")
            yield Checkbox("Inbox Flow contacts CSV", value=False, id="fmt-inbox-flow")
        yield FormLabel("Export directory")
        yield Input(placeholder="./exports (default)", id="export-path-input")
        yield ValidationError("", id="export-error")
        yield Static("", id="export-status")
        with Horizontal(id="button-row"):
            yield Button("Save  [Enter]", variant="primary", id="export-btn")

    def on_mount(self) -> None:
        config = load_user_config()
        if config.export_path:
            self.query_one("#export-path-input", Input).value = config.export_path

    def action_export(self) -> None:
        self._run_export()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "export-btn":
            self._run_export()

    def _run_export(self) -> None:
        app = self.app
        emails: list[ExtractedEmail] = getattr(app, "results", [])
        params: SearchParams | None = getattr(app, "last_params", None)
        stats: ExtractionStats | None = getattr(app, "extraction_stats", None)

        error = self.query_one("#export-error", ValidationError)
        status = self.query_one("#export-status", Static)
        error.update("")

        if not emails:
            error.update("No results to export. Run an extraction first.")
            return
        if not params:
            error.update("Missing search parameters.")
            return

        export_path_str = self.query_one("#export-path-input", Input).value.strip()
        config = load_user_config()
        config.export_path = export_path_str
        save_user_config(config)
        export_dir = config.resolved_export_dir()

        fmt_map = {
            "fmt-csv": "csv",
            "fmt-json": "json",
            "fmt-txt": "txt",
            "fmt-md": "md",
            "fmt-inbox-flow": "inbox_flow",
        }
        selected = [
            fmt_map[cid]
            for cid in fmt_map
            if self.query_one(f"#{cid}", Checkbox).value
        ]
        if not selected:
            error.update("Select at least one export format.")
            return

        paths: list[str] = []
        for fmt in selected:
            exporter = EXPORTERS[fmt]
            path = exporter(emails, params, stats=stats, export_dir=export_dir)
            paths.append(str(path))

        status.update(f"Saved {len(paths)} file(s) to {export_dir}/")
        self.post_message(self.ExportDone(paths))
