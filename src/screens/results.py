"""Results screen — DataTable of extracted emails."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import DataTable, Static

from src.models import ExtractedEmail, ExtractionStats
from src.screens.base import ScreenPanel
from src.widgets.common import PanelTitle


class ResultsScreen(ScreenPanel):
    """Displays extracted emails in a DataTable."""

    def compose(self) -> ComposeResult:
        yield PanelTitle("Results")
        yield Static("0 found · 0 unique", id="results-summary")
        table = DataTable(id="results-table", zebra_stripes=True)
        table.add_columns("Email", "Domain", "Source URL", "Context")
        yield table

    def load_results(
        self,
        emails: list[ExtractedEmail],
        stats: ExtractionStats | None = None,
    ) -> None:
        table = self.query_one("#results-table", DataTable)
        table.clear()
        for em in emails:
            ctx = em.context if len(em.context) <= 80 else em.context[:77] + "…"
            src = em.source_url if len(em.source_url) <= 60 else em.source_url[:57] + "…"
            table.add_row(em.email, em.domain, src, ctx)

        if stats:
            dupes = stats.duplicates_removed
            summary = (
                f"{stats.total_found} found · {stats.unique_count} unique"
                + (f" · {dupes} duplicate(s) removed" if dupes else "")
            )
        else:
            summary = f"{len(emails)} found · {len(emails)} unique"
        self.query_one("#results-summary", Static).update(summary)

    def clear_results(self) -> None:
        self.query_one("#results-table", DataTable).clear()
        self.query_one("#results-summary", Static).update("0 found · 0 unique")
