"""Settings screen — API key configuration."""

from __future__ import annotations

import os
from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Horizontal
from textual.message import Message
from textual.widgets import Button, Input, RadioButton, RadioSet, Static

from src.config import PROJECT_ROOT
from src.screens.base import ScreenPanel
from src.widgets.common import FormLabel, PanelTitle, ValidationError


class SettingsScreen(ScreenPanel):
    """Configure web search API keys."""

    class SettingsSaved(Message):
        pass

    def compose(self) -> ComposeResult:
        yield PanelTitle("Settings")
        yield FormLabel("Search provider")
        with RadioSet(id="provider-radio"):
            yield RadioButton("SerpAPI", value=True, id="provider-serpapi")
            yield RadioButton("Google Custom Search", id="provider-google")
        yield FormLabel("SERPAPI_KEY")
        yield Input(
            password=True,
            placeholder="Set via .env or enter here",
            id="serpapi-key",
        )
        yield FormLabel("GOOGLE_CSE_KEY")
        yield Input(
            password=True,
            placeholder="Google API key",
            id="google-key",
        )
        yield FormLabel("GOOGLE_CSE_ID")
        yield Input(placeholder="Custom Search Engine ID", id="google-cse-id")
        yield ValidationError("", id="settings-error")
        yield Static(
            "Keys are saved to .env in the project root.\n"
            "Mode A requires at least one configured provider.",
            id="settings-note",
        )
        with Horizontal(id="button-row"):
            yield Button("Save  [Enter]", variant="primary", id="save-btn")

    def on_mount(self) -> None:
        env_path = PROJECT_ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("SERPAPI_KEY="):
                    self.query_one("#serpapi-key", Input).value = line.split("=", 1)[1]
                elif line.startswith("GOOGLE_CSE_KEY="):
                    self.query_one("#google-key", Input).value = line.split("=", 1)[1]
                elif line.startswith("GOOGLE_CSE_ID="):
                    self.query_one("#google-cse-id", Input).value = line.split("=", 1)[1]
                elif line.startswith("SEARCH_PROVIDER=google_cse"):
                    self.query_one("#provider-google", RadioButton).value = True

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "save-btn":
            self._save()

    def action_save(self) -> None:
        self._save()

    def _save(self) -> None:
        serpapi = self.query_one("#serpapi-key", Input).value.strip()
        google_key = self.query_one("#google-key", Input).value.strip()
        google_id = self.query_one("#google-cse-id", Input).value.strip()
        provider = (
            "serpapi"
            if self.query_one("#provider-serpapi", RadioButton).value
            else "google_cse"
        )

        env_path = PROJECT_ROOT / ".env"
        lines = [
            f"SERPAPI_KEY={serpapi}",
            f"GOOGLE_CSE_KEY={google_key}",
            f"GOOGLE_CSE_ID={google_id}",
            f"SEARCH_PROVIDER={provider}",
        ]
        env_path.write_text("\n".join(lines) + "\n")

        os.environ["SERPAPI_KEY"] = serpapi
        os.environ["GOOGLE_CSE_KEY"] = google_key
        os.environ["GOOGLE_CSE_ID"] = google_id
        os.environ["SEARCH_PROVIDER"] = provider

        self.query_one("#settings-error", ValidationError).update("")
        self.post_message(self.SettingsSaved())
