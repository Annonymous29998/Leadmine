"""Application configuration and theme constants."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from src.models import AppSettings

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EXPORTS_DIR = PROJECT_ROOT / "exports"

# Dark-first palette — near-black bg, cyan accent, square corners
THEME = {
    "background": "#0d0d0d",
    "surface": "#141414",
    "panel": "#1a1a1a",
    "border": "#2a2a2a",
    "accent": "#00d4aa",
    "accent_dim": "#008866",
    "text": "#e0e0e0",
    "text_dim": "#888888",
    "info": "#58a6ff",
    "success": "#3fb950",
    "warning": "#d29922",
    "error": "#f85149",
    "sidebar_active": "#00d4aa22",
}

DEFAULT_DOMAINS = [
    "gmail.com",
    "outlook.com",
    "yahoo.com",
    "hotmail.com",
    "icloud.com",
]

MAX_RESULTS_CAP = 500
DEFAULT_MAX_RESULTS = 100
FETCH_TIMEOUT = 15.0
WEB_SEARCH_RATE_LIMIT = 2.0  # seconds between fetches
CONTEXT_SNIPPET_LEN = 80


def load_settings() -> AppSettings:
    return AppSettings(
        serpapi_key=os.getenv("SERPAPI_KEY", ""),
        google_cse_key=os.getenv("GOOGLE_CSE_KEY", ""),
        google_cse_id=os.getenv("GOOGLE_CSE_ID", ""),
        search_provider=os.getenv("SEARCH_PROVIDER", "serpapi"),
    )


def ensure_exports_dir(export_dir: Path | None = None) -> Path:
    target = export_dir if export_dir is not None else EXPORTS_DIR
    target.mkdir(parents=True, exist_ok=True)
    return target
