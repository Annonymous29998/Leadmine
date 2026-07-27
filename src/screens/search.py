"""Search screen — form for extraction parameters."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.widgets import Button, Input, RadioButton, RadioSet, Static, TextArea

from src.config import DEFAULT_MAX_RESULTS, MAX_RESULTS_CAP, load_settings
from src.extractors.email_extractor import parse_domains
from src.models import ExtractionMode, SearchParams
from src.screens.base import ScreenPanel
from src.search.web_search import DDG_FALLBACK_WARNING
from src.user_config import load_user_config, save_user_config
from src.widgets.common import FormLabel, PanelTitle, ValidationError


class SearchScreen(ScreenPanel):
    """Search / configuration form."""

    class StartExtraction(Message):
        def __init__(self, params: SearchParams) -> None:
            self.params = params
            super().__init__()

    DEFAULT_CSS = """
    SearchScreen {
        height: 100%;
    }
    #url-area {
        height: 6;
    }
    #ddg-warning {
        color: #d29922;
        height: auto;
        margin: 1 0 0 0;
        display: none;
    }
    #ddg-warning.visible {
        display: block;
    }
    """

    def compose(self) -> ComposeResult:
        yield PanelTitle("Search — LeadMine Extractor")
        yield FormLabel("Subject / role [required]")
        yield Input(
            placeholder="e.g. engineers, CEO, marketing manager",
            id="subject-input",
        )
        yield FormLabel("Location [optional]")
        yield Input(placeholder="e.g. Lagos, London, Texas", id="location-input")
        yield FormLabel("Email domains [comma-separated, at least one]")
        yield Input(id="domains-input")
        yield FormLabel("Max results")
        yield Input(value=str(DEFAULT_MAX_RESULTS), id="max-results-input")
        yield FormLabel("Extraction mode")
        with RadioSet(id="mode-radio"):
            yield RadioButton("Mode B — URLs / files (no API key)", value=True, id="mode-b")
            yield RadioButton("Mode A — Public web search", id="mode-a")
        yield Static("", id="ddg-warning")
        yield FormLabel("URLs [one per line, Mode B]")
        yield TextArea(id="url-area")
        yield FormLabel("Local file path [Mode B — .html, .htm, .txt, .csv]")
        yield Input(placeholder="/path/to/file.html", id="file-input")
        yield ValidationError("", id="validation-error")
        with Horizontal(id="button-row"):
            yield Button("Start  [Enter/F5]", variant="primary", id="start-btn")

    def on_mount(self) -> None:
        config = load_user_config()
        self.query_one("#domains-input", Input).value = ", ".join(config.domains)
        self._update_ddg_warning()

    def on_radio_set_changed(self, event: RadioSet.Changed) -> None:
        self._update_ddg_warning()

    def _update_ddg_warning(self) -> None:
        warning = self.query_one("#ddg-warning", Static)
        mode_a = self.query_one("#mode-a", RadioButton).value
        settings = load_settings()
        if mode_a and settings.uses_ddg_fallback:
            warning.update(
                f"⚠ DuckDuckGo Lite fallback ({DDG_FALLBACK_WARNING}) — "
                "max 3 pages, 2s delay. Add SERPAPI or Google CSE keys in Settings."
            )
            warning.add_class("visible")
        else:
            warning.update("")
            warning.remove_class("visible")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "start-btn":
            self._submit()

    def action_start(self) -> None:
        self._submit()

    def _submit(self) -> None:
        error_widget = self.query_one("#validation-error", ValidationError)
        error_widget.update("")

        subject = self.query_one("#subject-input", Input).value.strip()
        if not subject:
            error_widget.update("Subject / role is required.")
            return

        domains_raw = self.query_one("#domains-input", Input).value
        domains = parse_domains(domains_raw)
        if not domains:
            error_widget.update("At least one email domain is required.")
            return

        config = load_user_config()
        config.domains = domains
        save_user_config(config)

        max_str = self.query_one("#max-results-input", Input).value.strip()
        try:
            max_results = int(max_str) if max_str else DEFAULT_MAX_RESULTS
        except ValueError:
            error_widget.update("Max results must be a number.")
            return

        if max_results < 1:
            error_widget.update("Max results must be at least 1.")
            return
        max_results = min(max_results, MAX_RESULTS_CAP)

        mode_b = self.query_one("#mode-b", RadioButton).value
        mode = ExtractionMode.URLS if mode_b else ExtractionMode.WEB_SEARCH

        url_list = self.query_one("#url-area", TextArea).text
        file_path = self.query_one("#file-input", Input).value.strip()

        if mode == ExtractionMode.URLS and not url_list.strip() and not file_path:
            error_widget.update("Mode B requires URLs or a local file path.")
            return

        params = SearchParams(
            subject=subject,
            location=self.query_one("#location-input", Input).value.strip(),
            domains=domains,
            max_results=max_results,
            mode=mode,
            url_list=url_list,
            file_path=file_path,
        )
        self.post_message(self.StartExtraction(params))
