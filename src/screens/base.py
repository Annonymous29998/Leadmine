"""Base screen mixin for LeadMine panels."""

from __future__ import annotations

from textual.containers import Vertical
from textual.widget import Widget


class ScreenPanel(Vertical):
    """Main content panel for each screen."""

    DEFAULT_CSS = """
    ScreenPanel {
        background: #0d0d0d;
        padding: 1 2;
        height: 100%;
    }
    """
