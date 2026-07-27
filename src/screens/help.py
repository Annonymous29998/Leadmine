"""Help screen."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import VerticalScroll

from src.screens.base import ScreenPanel
from src.widgets.common import HelpSection, PanelTitle


class HelpScreen(ScreenPanel):
    """Keyboard shortcuts and compliance info."""

    def compose(self) -> ComposeResult:
        yield PanelTitle("Help")
        with VerticalScroll():
            yield HelpSection(
                "Navigation",
                "Use the sidebar or command palette to switch screens.\n"
                "Esc — go back   Q — quit application",
            )
            yield HelpSection(
                "Command Palette (Ctrl+K)",
                "Search — go to search form\n"
                "Results — view extracted emails\n"
                "Export — save results to disk\n"
                "Settings — API key configuration\n"
                "Clear — reset results and logs",
            )
            yield HelpSection(
                "Shortcuts",
                "/ or Ctrl+K — command palette\n"
                "Enter / F5 — start extraction (Search screen)\n"
                "E — export results\n"
                "Ctrl+C — cancel job gracefully (keeps partial results)\n"
                "Esc — back   Q — quit",
            )
            yield HelpSection(
                "Mode B — URLs / Files",
                "Paste URLs (one per line) or provide a local file path.\n"
                "Supported files: .html, .htm, .txt, .csv\n"
                "No API key required.",
            )
            yield HelpSection(
                "Mode A — Web Search",
                "Uses SerpAPI or Google CSE when keys are configured in Settings.\n"
                "Without API keys, falls back to DuckDuckGo Lite (unofficial — slower,\n"
                "max 3 pages, 2s delay between pages).\n"
                "Rate limit for URL extraction: 1 fetch per 2 seconds.",
            )
            yield HelpSection(
                "Export",
                "Saves to ./exports/ (or custom path) in CSV, JSON, TXT, Markdown,\n"
                "or Inbox Flow contacts CSV (email, firstName, lastName, source, tags).\n"
                "Markdown includes query metadata and UTC timestamp.\n"
                "Domains and export path persist in ~/.leadmine/config.json.\n"
                "Filename: extract_{subject}_{location}_{date}.ext",
            )
            yield HelpSection(
                "Compliance",
                "LeadMine Extractor collects publicly available data only.\n"
                "Users are responsible for CAN-SPAM, GDPR, and local regulations.\n"
                "Export only — no email sending functionality.\n\n"
                "Does NOT: LinkedIn login scrape, CAPTCHA bypass,\n"
                "private pages, or proxy farms.",
            )
