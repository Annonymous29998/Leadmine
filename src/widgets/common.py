"""Reusable TUI widgets."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.message import Message
from textual.widgets import Label, ListItem, ListView, Static


class PanelTitle(Static):
    """Section title within a screen panel."""

    DEFAULT_CSS = """
    PanelTitle {
        text-style: bold;
        color: #00d4aa;
        margin-bottom: 1;
        height: 1;
    }
    """


class FormLabel(Static):
    """Form field label."""

    DEFAULT_CSS = """
    FormLabel {
        color: #888888;
        height: 1;
        margin-top: 1;
    }
    """


class ValidationError(Static):
    """Inline validation error message."""

    DEFAULT_CSS = """
    ValidationError {
        color: #f85149;
        height: 1;
        margin-top: 1;
    }
    """


class HelpSection(Static):
    """Help text block with title."""

    def __init__(self, title: str, body: str, **kwargs) -> None:
        super().__init__(**kwargs)
        self._title = title
        self._body = body

    def render(self) -> str:
        return f"[bold #00d4aa]{self._title}[/]\n{self._body}"


class SidebarNav(ListView):
    """Sidebar navigation list."""

    NAV_ITEMS = [
        ("search", "Search"),
        ("progress", "Progress"),
        ("results", "Results"),
        ("export", "Export"),
        ("settings", "Settings"),
        ("help", "Help"),
    ]

    class Navigated(Message):
        def __init__(self, screen_id: str) -> None:
            self.screen_id = screen_id
            super().__init__()

    def compose(self) -> ComposeResult:
        for _id, label in self.NAV_ITEMS:
            yield ListItem(Label(label), id=f"nav-{_id}")

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        if item_id.startswith("nav-"):
            screen_id = item_id.replace("nav-", "")
            self.post_message(self.Navigated(screen_id))


class StatusBar(Static):
    """Bottom status bar showing current state."""

    def __init__(self, **kwargs) -> None:
        super().__init__("Ready", id="status-bar", **kwargs)

    def set_status(self, text: str) -> None:
        self.update(text)


class FooterBar(Static):
    """Shortcut hints footer."""

    FOOTERS = {
        "search": "[/] Palette  [Enter/F5] Start  [Esc] Back  [Q] Quit",
        "progress": "[Ctrl+C] Cancel  [Esc] Back  [Q] Quit",
        "results": "[E] Export  [Esc] Back  [Q] Quit",
        "export": "[Enter] Save  [Esc] Back  [Q] Quit",
        "settings": "[Enter] Save  [Esc] Back  [Q] Quit",
        "help": "[Esc] Back  [Q] Quit",
    }

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault("markup", False)
        super().__init__(self.FOOTERS["search"], id="footer-bar", **kwargs)

    def set_screen(self, screen_id: str) -> None:
        self.update(self.FOOTERS.get(screen_id, self.FOOTERS["search"]))


class CommandPalette(Vertical):
    """Overlay command palette triggered by / or Ctrl+K."""

    COMMANDS = [
        ("Search", "search"),
        ("Results", "results"),
        ("Export", "export"),
        ("Settings", "settings"),
        ("Clear", "clear"),
    ]

    class CommandSelected(Message):
        def __init__(self, command_id: str) -> None:
            self.command_id = command_id
            super().__init__()

    DEFAULT_CSS = """
    CommandPalette {
        align: center middle;
        background: #00000088;
        width: 100%;
        height: 100%;
        layer: overlay;
    }
    CommandPalette > Container {
        width: 60;
        height: auto;
        max-height: 20;
        background: #1a1a1a;
        border: solid #00d4aa;
        padding: 1;
    }
    """

    def compose(self) -> ComposeResult:
        from textual.containers import Container
        from textual.widgets import Input, ListView, ListItem, Label

        with Container():
            yield Input(placeholder="Type a command…", id="palette-input")
            items = ListView(id="palette-list")
            for label, cmd_id in self.COMMANDS:
                items.append(ListItem(Label(label), id=f"cmd-{cmd_id}"))
            yield items

    def on_mount(self) -> None:
        self.query_one("#palette-input", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        from textual.widgets import Input, ListView, ListItem, Label

        query = event.value.lower()
        list_view = self.query_one("#palette-list", ListView)
        list_view.clear()
        for label, cmd_id in self.COMMANDS:
            if query in label.lower():
                list_view.append(ListItem(Label(label), id=f"cmd-{cmd_id}"))

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        if item_id.startswith("cmd-"):
            cmd_id = item_id.replace("cmd-", "")
            self.post_message(self.CommandSelected(cmd_id))

    def on_key(self, event) -> None:
        if event.key == "escape":
            self.remove()
            event.stop()


# Late import to avoid circular refs in compose
from textual.widgets import Input  # noqa: E402
