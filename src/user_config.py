"""Persistent user preferences in ~/.leadmine/config.json."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from src.config import DEFAULT_DOMAINS, EXPORTS_DIR

CONFIG_DIR = Path.home() / ".leadmine"
CONFIG_FILE = CONFIG_DIR / "config.json"


@dataclass
class UserConfig:
    domains: list[str] = field(default_factory=lambda: list(DEFAULT_DOMAINS))
    export_path: str = ""

    def resolved_export_dir(self) -> Path:
        if self.export_path.strip():
            return Path(self.export_path).expanduser().resolve()
        return EXPORTS_DIR


def load_user_config() -> UserConfig:
    if not CONFIG_FILE.exists():
        return UserConfig()
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        domains = data.get("domains", list(DEFAULT_DOMAINS))
        if not isinstance(domains, list):
            domains = list(DEFAULT_DOMAINS)
        return UserConfig(
            domains=[str(d) for d in domains],
            export_path=str(data.get("export_path", "")),
        )
    except (json.JSONDecodeError, OSError):
        return UserConfig()


def save_user_config(config: UserConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(asdict(config), indent=2) + "\n",
        encoding="utf-8",
    )
