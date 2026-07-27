"""Entry point for LeadMine Extractor."""

from __future__ import annotations

from src.app import LeadMineApp


def main() -> None:
    app = LeadMineApp()
    app.run()


if __name__ == "__main__":
    main()
